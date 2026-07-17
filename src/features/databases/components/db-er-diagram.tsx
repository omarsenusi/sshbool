import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react"
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { DbSchemaDto, DbTableDto } from "@/lib/ipc/types"
import { cn } from "@/lib/utils"

type Props = {
  schema: DbSchemaDto | undefined
  onSelectTable?: (schema: string, table: DbTableDto) => void
}

type LayoutNode = {
  id: string
  schema: string
  table: DbTableDto
  x: number
  y: number
  w: number
  h: number
}

type Edge = {
  id: string
  from: string
  to: string
  label: string
}

type Pos = { x: number; y: number }

const NODE_W = 240
const COL_GAP = 72
const ROW_GAP = 36
const BAND_GAP = 56
const PAD = 64
const HEADER_H = 34
const ROW_H = 20
const MAX_COLS = 8
/** Soft cap for a single vertical stack before wrapping into another column. */
const MAX_STACK_H = 980
const MINIMAP_W = 200
const MINIMAP_H = 140
/** Target landscape aspect for the whole diagram (width / height). */
const TARGET_ASPECT = 1.55

function shortType(t: string) {
  return t
    .replace(/character varying/gi, "varchar")
    .replace(/timestamp with time zone/gi, "timestamptz")
    .replace(/timestamp without time zone/gi, "timestamp")
    .replace(/double precision/gi, "float8")
    .trim()
}

function nodeHeight(colCount: number) {
  const shown = Math.min(colCount, MAX_COLS)
  const extra = colCount > MAX_COLS ? 1 : 0
  return HEADER_H + (shown + extra) * ROW_H + 8
}

function packGrid(
  ids: string[],
  tableById: Map<string, { schema: string; table: DbTableDto }>,
  originX: number,
  originY: number,
  cols: number,
): LayoutNode[] {
  const colY = Array.from({ length: Math.max(1, cols) }, () => originY)
  const nodes: LayoutNode[] = []
  ids.forEach((id, i) => {
    const { schema: sch, table } = tableById.get(id)!
    const h = nodeHeight(table.columns.length)
    const col = i % cols
    const x = originX + col * (NODE_W + COL_GAP)
    const y = colY[col]!
    nodes.push({ id, schema: sch, table, x, y, w: NODE_W, h })
    colY[col] = y + h + ROW_GAP
  })
  return nodes
}

/** Split a tall list into several side-by-side stacks so the map stays wide. */
function packWrappedStacks(
  ids: string[],
  tableById: Map<string, { schema: string; table: DbTableDto }>,
  startX: number,
  startY: number,
  maxStackH: number,
): { nodes: LayoutNode[]; nextX: number; height: number } {
  const nodes: LayoutNode[] = []
  let x = startX
  let y = startY
  let colStartY = startY
  let maxY = startY
  let stacks = 1

  for (const id of ids) {
    const { schema: sch, table } = tableById.get(id)!
    const h = nodeHeight(table.columns.length)
    if (y > colStartY && y + h - colStartY > maxStackH) {
      x += NODE_W + COL_GAP
      y = colStartY
      stacks++
    }
    nodes.push({ id, schema: sch, table, x, y, w: NODE_W, h })
    y += h + ROW_GAP
    maxY = Math.max(maxY, y)
  }

  const nextX = x + NODE_W + BAND_GAP
  return { nodes, nextX, height: maxY - startY }
}

function connectedComponents(
  ids: string[],
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
): string[][] {
  const seen = new Set<string>()
  const comps: string[][] = []
  for (const start of ids) {
    if (seen.has(start)) continue
    const stack = [start]
    const comp: string[] = []
    seen.add(start)
    while (stack.length) {
      const id = stack.pop()!
      comp.push(id)
      for (const n of [...(outgoing.get(id) ?? []), ...(incoming.get(id) ?? [])]) {
        if (!seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
      }
    }
    comps.push(comp)
  }
  comps.sort((a, b) => b.length - a.length)
  return comps
}

/**
 * Landscape ER layout: FK layers left→right, tall layers wrap into extra columns,
 * islands fill a wide grid, components packed in rows so the map uses full width+height.
 */
function buildLayout(tables: { schema: string; table: DbTableDto }[]): {
  nodes: LayoutNode[]
  edges: Edge[]
} {
  const idOf = (sch: string, name: string) => `${sch}.${name}`
  const byName = new Map<string, string>()
  for (const { schema: sch, table } of tables) {
    byName.set(table.name, idOf(sch, table.name))
    byName.set(`${sch}.${table.name}`, idOf(sch, table.name))
  }

  const ids = tables.map(({ schema: sch, table }) => idOf(sch, table.name))
  const idSet = new Set(ids)
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]))
  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]))

  const edges: Edge[] = []
  for (const { schema: sch, table } of tables) {
    const fromId = idOf(sch, table.name)
    for (const fk of table.foreignKeys) {
      const targetId =
        byName.get(`${sch}.${fk.refTable}`) ??
        byName.get(fk.refTable) ??
        [...byName.entries()].find(([k]) => k.endsWith(`.${fk.refTable}`))?.[1]
      if (!targetId || !idSet.has(targetId) || targetId === fromId) continue
      outgoing.get(fromId)!.push(targetId)
      incoming.get(targetId)!.push(fromId)
      edges.push({
        id: `${fromId}>${fk.column}>${targetId}`,
        from: fromId,
        to: targetId,
        label: fk.column,
      })
    }
  }

  const tableById = new Map(
    tables.map(({ schema: sch, table }) => [idOf(sch, table.name), { schema: sch, table }]),
  )

  const degree = (id: string) =>
    (incoming.get(id)?.length ?? 0) + (outgoing.get(id)?.length ?? 0)

  const islands = ids
    .filter((id) => degree(id) === 0)
    .sort((a, b) => a.localeCompare(b))
  const linked = ids.filter((id) => degree(id) > 0)
  const components = connectedComponents(linked, outgoing, incoming)

  const n = Math.max(ids.length, 1)
  // Soft height budget so many tables wrap sideways into a landscape map
  const stackH = Math.max(
    520,
    Math.min(MAX_STACK_H, Math.round(Math.sqrt((n * NODE_W * 180) / TARGET_ASPECT))),
  )

  type Block = { nodes: LayoutNode[]; w: number; h: number }
  const blocks: Block[] = []

  for (const comp of components) {
    const rank = new Map<string, number>()
    const visiting = new Set<string>()
    const depth = (id: string): number => {
      if (rank.has(id)) return rank.get(id)!
      if (visiting.has(id)) return 0
      visiting.add(id)
      const refs = (outgoing.get(id) ?? []).filter((t) => comp.includes(t))
      const d = refs.length === 0 ? 0 : 1 + Math.max(...refs.map(depth))
      visiting.delete(id)
      rank.set(id, d)
      return d
    }
    for (const id of comp) depth(id)

    const layers = new Map<number, string[]>()
    for (const id of comp) {
      const r = rank.get(id) ?? 0
      if (!layers.has(r)) layers.set(r, [])
      layers.get(r)!.push(id)
    }

    // Barycenter ordering (parents of neighbors) to cut crossings
    const maxRank = Math.max(0, ...layers.keys())
    for (let pass = 0; pass < 3; pass++) {
      for (let r = 1; r <= maxRank; r++) {
        const list = layers.get(r)
        if (!list) continue
        const prev = layers.get(r - 1) ?? []
        const idx = new Map(prev.map((id, i) => [id, i]))
        list.sort((a, b) => {
          const avg = (id: string) => {
            const parents = (outgoing.get(id) ?? []).filter((p) => idx.has(p))
            if (parents.length === 0) return idx.size / 2
            return parents.reduce((s, p) => s + (idx.get(p) ?? 0), 0) / parents.length
          }
          return avg(a) - avg(b) || degree(b) - degree(a) || a.localeCompare(b)
        })
      }
    }

    const placed: LayoutNode[] = []
    let cursorX = 0
    let blockH = 0
    for (let r = 0; r <= maxRank; r++) {
      const list = layers.get(r) ?? []
      if (list.length === 0) continue
      const packed = packWrappedStacks(list, tableById, cursorX, 0, stackH)
      placed.push(...packed.nodes)
      cursorX = packed.nextX
      blockH = Math.max(blockH, packed.height)
    }

    // Vertically center stacks within the block
    const byX = new Map<number, LayoutNode[]>()
    for (const n of placed) {
      if (!byX.has(n.x)) byX.set(n.x, [])
      byX.get(n.x)!.push(n)
    }
    for (const col of byX.values()) {
      const top = Math.min(...col.map((n) => n.y))
      const bottom = Math.max(...col.map((n) => n.y + n.h))
      const shift = (blockH - (bottom - top)) / 2 - top
      for (const n of col) n.y += shift
    }

    const minBX = Math.min(...placed.map((n) => n.x))
    const maxBX = Math.max(...placed.map((n) => n.x + n.w))
    const minBY = Math.min(...placed.map((n) => n.y))
    const maxBY = Math.max(...placed.map((n) => n.y + n.h))
    blocks.push({
      nodes: placed,
      w: Math.max(NODE_W, maxBX - minBX),
      h: Math.max(40, maxBY - minBY),
    })
  }

  if (islands.length > 0) {
    const islandCols = Math.max(
      2,
      Math.min(10, Math.ceil(Math.sqrt(islands.length * TARGET_ASPECT))),
    )
    const islandNodes = packGrid(islands, tableById, 0, 0, islandCols)
    const w =
      Math.max(...islandNodes.map((n) => n.x + n.w)) -
      Math.min(...islandNodes.map((n) => n.x))
    const h =
      Math.max(...islandNodes.map((n) => n.y + n.h)) -
      Math.min(...islandNodes.map((n) => n.y))
    blocks.push({ nodes: islandNodes, w, h })
  }

  // Meta-pack blocks into landscape rows
  const avgBlockW =
    blocks.reduce((s, b) => s + b.w, 0) / Math.max(blocks.length, 1) || NODE_W * 4
  const rowBudget = Math.max(
    avgBlockW * 1.2,
    Math.sqrt(blocks.reduce((s, b) => s + b.w * b.h, NODE_W * 400) * TARGET_ASPECT),
  )

  const nodes: LayoutNode[] = []
  let rowX = PAD
  let rowY = PAD
  let rowH = 0

  for (const block of blocks) {
    if (rowX > PAD && rowX + block.w > PAD + rowBudget) {
      rowY += rowH + BAND_GAP * 1.4
      rowX = PAD
      rowH = 0
    }
    const ox = Math.min(...block.nodes.map((n) => n.x))
    const oy = Math.min(...block.nodes.map((n) => n.y))
    for (const n of block.nodes) {
      nodes.push({
        ...n,
        x: rowX + (n.x - ox),
        y: rowY + (n.y - oy),
      })
    }
    rowX += block.w + BAND_GAP
    rowH = Math.max(rowH, block.h)
  }

  // If still too tall/narrow, expand island-style: redistribute into wider grid
  if (nodes.length > 0) {
    let minX = Math.min(...nodes.map((n) => n.x))
    let minY = Math.min(...nodes.map((n) => n.y))
    let maxX = Math.max(...nodes.map((n) => n.x + n.w))
    let maxY = Math.max(...nodes.map((n) => n.y + n.h))
    let w = maxX - minX
    let h = maxY - minY
    if (h > 0 && w / h < 1.05 && nodes.length >= 8) {
      // Fallback: full landscape grid ordered by connectivity
      const ordered = [...ids].sort(
        (a, b) => degree(b) - degree(a) || a.localeCompare(b),
      )
      const cols = Math.max(
        3,
        Math.min(12, Math.ceil(Math.sqrt(ordered.length * TARGET_ASPECT))),
      )
      const grid = packGrid(ordered, tableById, PAD, PAD, cols)
      nodes.length = 0
      nodes.push(...grid)
      minX = Math.min(...nodes.map((n) => n.x))
      minY = Math.min(...nodes.map((n) => n.y))
      maxX = Math.max(...nodes.map((n) => n.x + n.w))
      maxY = Math.max(...nodes.map((n) => n.y + n.h))
      w = maxX - minX
      h = maxY - minY
    }

    // Normalize origin
    const dx = PAD - minX
    const dy = PAD - minY
    for (const n of nodes) {
      n.x += dx
      n.y += dy
    }
  }

  return { nodes, edges }
}

function boundsOf(nodes: LayoutNode[], positions: Record<string, Pos>) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const p = positions[n.id] ?? { x: n.x, y: n.y }
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + n.w)
    maxY = Math.max(maxY, p.y + n.h)
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 1600, maxY: 1000, width: 1600, height: 1000 }
  }
  // Tight world size around content (no huge empty strip)
  const width = Math.max(maxX + PAD, minX + 400)
  const height = Math.max(maxY + PAD, minY + 300)
  return { minX, minY, maxX, maxY, width, height }
}

/** Route FK line between nearest sides of two boxes. */
function edgePath(from: LayoutNode, to: LayoutNode): string {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const dx = tc.x - fc.x
  const dy = tc.y - fc.y
  let x1: number
  let y1: number
  let x2: number
  let y2: number
  let c1x: number
  let c1y: number
  let c2x: number
  let c2y: number

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal-ish: leave right/left edges
    if (dx >= 0) {
      x1 = from.x + from.w
      y1 = from.y + Math.min(from.h - 8, Math.max(16, from.h * 0.22))
      x2 = to.x
      y2 = to.y + Math.min(to.h - 8, Math.max(16, to.h * 0.22))
    } else {
      x1 = from.x
      y1 = from.y + Math.min(from.h - 8, Math.max(16, from.h * 0.22))
      x2 = to.x + to.w
      y2 = to.y + Math.min(to.h - 8, Math.max(16, to.h * 0.22))
    }
    const bend = Math.max(48, Math.abs(x2 - x1) * 0.45)
    c1x = x1 + (dx >= 0 ? bend : -bend)
    c1y = y1
    c2x = x2 + (dx >= 0 ? -bend : bend)
    c2y = y2
  } else {
    // Vertical-ish: leave bottom/top
    if (dy >= 0) {
      x1 = from.x + from.w / 2
      y1 = from.y + from.h
      x2 = to.x + to.w / 2
      y2 = to.y
    } else {
      x1 = from.x + from.w / 2
      y1 = from.y
      x2 = to.x + to.w / 2
      y2 = to.y + to.h
    }
    const bend = Math.max(40, Math.abs(y2 - y1) * 0.45)
    c1x = x1
    c1y = y1 + (dy >= 0 ? bend : -bend)
    c2x = x2
    c2y = y2 + (dy >= 0 ? -bend : bend)
  }
  return `M${x1} ${y1} C${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`
}

export function DbErDiagram({ schema, onSelectTable }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.75)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [positions, setPositions] = useState<Record<string, Pos>>({})
  const [layoutKey, setLayoutKey] = useState(0)

  const panDrag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const nodeDrag = useRef<{
    id: string
    px: number
    py: number
    ox: number
    oy: number
    moved: boolean
  } | null>(null)
  const minimapDrag = useRef(false)
  const dragRaf = useRef(0)

  const { baseNodes, edges } = useMemo(() => {
    const tables: { schema: string; table: DbTableDto }[] = []
    for (const g of schema?.schemas ?? []) {
      for (const t of g.tables) tables.push({ schema: g.name, table: t })
    }
    if (tables.length === 0) return { baseNodes: [] as LayoutNode[], edges: [] as Edge[] }
    const { nodes, edges } = buildLayout(tables)
    return { baseNodes: nodes, edges }
  }, [schema, layoutKey])

  // Seed positions when layout changes
  useEffect(() => {
    const next: Record<string, Pos> = {}
    for (const n of baseNodes) next[n.id] = { x: n.x, y: n.y }
    setPositions(next)
  }, [baseNodes])

  const nodes = useMemo(
    () =>
      baseNodes.map((n) => {
        const p = positions[n.id]
        return p ? { ...n, x: p.x, y: p.y } : n
      }),
    [baseNodes, positions],
  )

  const { width, height } = useMemo(() => boundsOf(baseNodes, positions), [baseNodes, positions])

  const related = useMemo(() => {
    if (!hover) return null
    const s = new Set<string>([hover])
    for (const e of edges) {
      if (e.from === hover) s.add(e.to)
      if (e.to === hover) s.add(e.from)
    }
    return s
  }, [hover, edges])

  const fitView = useCallback(() => {
    const el = viewportRef.current
    if (!el || baseNodes.length === 0) return
    const b = boundsOf(baseNodes, positions)
    const contentW = Math.max(1, b.maxX - b.minX + PAD)
    const contentH = Math.max(1, b.maxY - b.minY + PAD)
    const pad = 40
    const zx = (el.clientWidth - pad * 2) / contentW
    const zy = (el.clientHeight - pad * 2) / contentH
    const next = Math.min(1.15, Math.max(0.12, Math.min(zx, zy)))
    // Center the diagram in the viewport
    const panX = (el.clientWidth - contentW * next) / 2 - b.minX * next
    const panY = (el.clientHeight - contentH * next) / 2 - b.minY * next
    setZoom(next)
    setPan({ x: panX, y: panY })
  }, [baseNodes, positions])

  useEffect(() => {
    const t = window.setTimeout(fitView, 30)
    return () => window.clearTimeout(t)
    // only on schema/layout reset — not every drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, layoutKey])

  const onWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.06 : 0.06
    setZoom((z) => Math.min(1.8, Math.max(0.12, +(z + delta).toFixed(3))))
  }, [])

  const onViewportPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return
      if ((e.target as HTMLElement).closest("[data-er-node]")) return
      if ((e.target as HTMLElement).closest("[data-er-minimap]")) return
      panDrag.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [pan],
  )

  const onViewportPointerMove = useCallback((e: ReactPointerEvent) => {
    if (panDrag.current) {
      const d = panDrag.current
      setPan({
        x: d.ox + (e.clientX - d.px),
        y: d.oy + (e.clientY - d.py),
      })
    }
  }, [])

  const onViewportPointerUp = useCallback(() => {
    panDrag.current = null
    minimapDrag.current = false
  }, [])

  const jumpMinimap = useCallback(
    (e: ReactPointerEvent) => {
      const el = e.currentTarget as HTMLElement
      const rect = el.getBoundingClientRect()
      const mx = (e.clientX - rect.left) / rect.width
      const my = (e.clientY - rect.top) / rect.height
      const vp = viewportRef.current
      if (!vp) return
      setPan({
        x: -(mx * width * zoom - vp.clientWidth / 2),
        y: -(my * height * zoom - vp.clientHeight / 2),
      })
    },
    [width, height, zoom],
  )

  if (baseNodes.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-xs">
        Load a connection with tables to view the ER diagram.
      </div>
    )
  }

  const vp = viewportRef.current
  const viewW = vp?.clientWidth ?? 800
  const viewH = vp?.clientHeight ?? 600
  const miniScaleX = MINIMAP_W / width
  const miniScaleY = MINIMAP_H / height
  const miniScale = Math.min(miniScaleX, miniScaleY)
  const viewRect = {
    x: (-pan.x / zoom) * miniScale,
    y: (-pan.y / zoom) * miniScale,
    w: (viewW / zoom) * miniScale,
    h: (viewH / zoom) * miniScale,
  }

  return (
    <div className="bg-background relative flex min-h-0 w-full flex-1 flex-col">
      <div className="border-border absolute top-3 right-3 z-30 flex items-center gap-0.5 rounded-md border bg-background/90 p-1 shadow-md backdrop-blur">
        <Button
          size="icon-xs"
          variant="ghost"
          title="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.12, z - 0.1))}
        >
          <ZoomOut className="size-3.5" />
        </Button>
        <span className="text-muted-foreground w-11 text-center font-mono text-[10px]">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          title="Zoom in"
          onClick={() => setZoom((z) => Math.min(1.8, z + 0.1))}
        >
          <ZoomIn className="size-3.5" />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Fit" onClick={fitView}>
          <Maximize2 className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          title="Reset layout"
          onClick={() => setLayoutKey((k) => k + 1)}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>

      <div
        ref={viewportRef}
        className="relative min-h-0 w-full flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
      >
        <div
          className="absolute top-0 left-0 origin-top-left will-change-transform"
          style={{
            width,
            height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg width={width} height={height} className="pointer-events-none absolute inset-0">
            <defs>
              <marker
                id="er-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 Z" fill="rgb(14 165 233 / 0.75)" />
              </marker>
              <pattern id="er-dots" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="1" fill="currentColor" className="text-muted-foreground/25" />
              </pattern>
            </defs>
            <rect width={width} height={height} fill="url(#er-dots)" />

            {edges.map((e) => {
              const from = nodes.find((n) => n.id === e.from)
              const to = nodes.find((n) => n.id === e.to)
              if (!from || !to) return null
              const active = !related || related.has(e.from) || related.has(e.to)
              return (
                <path
                  key={e.id}
                  d={edgePath(from, to)}
                  fill="none"
                  strokeWidth={active && related ? 2 : 1.15}
                  stroke="rgb(14 165 233 / 0.4)"
                  markerEnd="url(#er-arrow)"
                  opacity={related && !active ? 0.07 : 1}
                />
              )
            })}
          </svg>

          {nodes.map((node) => {
            const dimmed = related != null && !related.has(node.id)
            const focused = hover === node.id
            return (
              <div
                key={node.id}
                data-er-node
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (nodeDrag.current?.moved) return
                  onSelectTable?.(node.schema, node.table)
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  const n = nodes.find((x) => x.id === node.id)
                  if (!n) return
                  nodeDrag.current = {
                    id: node.id,
                    px: e.clientX,
                    py: e.clientY,
                    ox: n.x,
                    oy: n.y,
                    moved: false,
                  }
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const d = nodeDrag.current
                  if (!d || d.id !== node.id) return
                  const nx = d.ox + (e.clientX - d.px) / zoom
                  const ny = d.oy + (e.clientY - d.py) / zoom
                  if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) {
                    d.moved = true
                  }
                  if (dragRaf.current) cancelAnimationFrame(dragRaf.current)
                  dragRaf.current = requestAnimationFrame(() => {
                    dragRaf.current = 0
                    setPositions((prev) => ({ ...prev, [d.id]: { x: nx, y: ny } }))
                  })
                }}
                onPointerUp={() => {
                  window.setTimeout(() => {
                    nodeDrag.current = null
                  }, 0)
                }}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  "absolute select-none overflow-hidden rounded-lg border bg-card shadow-md",
                  "cursor-grab active:cursor-grabbing",
                  focused
                    ? "z-10 border-sky-500 ring-2 ring-sky-500/25"
                    : "border-border/80",
                  dimmed && "opacity-20",
                )}
                style={{ left: node.x, top: node.y, width: node.w }}
              >
                <div className="border-border/60 flex items-center gap-2 border-b bg-sky-500/10 px-2.5 py-2">
                  <span className="truncate text-[12px] font-semibold">{node.table.name}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[9px]">
                    {node.schema}
                  </span>
                </div>
                <div className="px-2 py-1">
                  {node.table.columns.slice(0, MAX_COLS).map((col) => {
                    const fk = node.table.foreignKeys.some((f) => f.column === col.name)
                    return (
                      <div
                        key={col.name}
                        className="flex h-5 items-center gap-1 font-mono text-[10px]"
                      >
                        {col.isPrimaryKey ? (
                          <span className="rounded bg-amber-500/20 px-1 text-[8px] font-bold text-amber-500">
                            PK
                          </span>
                        ) : fk ? (
                          <span className="rounded bg-sky-500/20 px-1 text-[8px] font-bold text-sky-500">
                            FK
                          </span>
                        ) : (
                          <span className="w-[17px]" />
                        )}
                        <span className="min-w-0 truncate">{col.name}</span>
                        <span className="text-muted-foreground ml-auto shrink-0 text-[9px]">
                          {shortType(col.dataType)}
                        </span>
                      </div>
                    )
                  })}
                  {node.table.columns.length > MAX_COLS && (
                    <div className="text-muted-foreground px-1 text-[9px]">
                      +{node.table.columns.length - MAX_COLS} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Minimap */}
        <div
          data-er-minimap
          className="border-border bg-background/95 absolute right-3 bottom-3 z-30 overflow-hidden rounded-md border shadow-lg backdrop-blur"
          style={{ width: MINIMAP_W, height: MINIMAP_H }}
          onPointerDown={(e) => {
            e.stopPropagation()
            minimapDrag.current = true
            jumpMinimap(e)
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!minimapDrag.current) return
            jumpMinimap(e)
          }}
          onPointerUp={() => {
            minimapDrag.current = false
          }}
        >
          <div className="text-muted-foreground absolute top-1 left-1.5 z-10 text-[9px] font-semibold tracking-wide uppercase opacity-70">
            Overview
          </div>
          <svg width={MINIMAP_W} height={MINIMAP_H} className="block">
            <rect width={MINIMAP_W} height={MINIMAP_H} className="fill-muted/40" />
            {nodes.map((n) => (
              <rect
                key={n.id}
                x={n.x * miniScale}
                y={n.y * miniScale}
                width={Math.max(3, n.w * miniScale)}
                height={Math.max(2, n.h * miniScale)}
                className="fill-sky-500/70"
                rx={1}
              />
            ))}
            <rect
              x={Math.max(0, viewRect.x)}
              y={Math.max(0, viewRect.y)}
              width={Math.min(MINIMAP_W, Math.max(12, viewRect.w))}
              height={Math.min(MINIMAP_H, Math.max(12, viewRect.h))}
              fill="none"
              stroke="rgb(56 189 248)"
              strokeWidth={1.5}
              className="pointer-events-none"
            />
          </svg>
        </div>
      </div>

      <div className="text-muted-foreground border-border flex shrink-0 items-center justify-between border-t px-3 py-1 text-[10px]">
        <span>
          {nodes.length} tables · {edges.length} relations
        </span>
        <span className="opacity-70">
          Drag tables to move · Drag canvas to pan · Scroll zoom · Minimap bottom-right
        </span>
      </div>
    </div>
  )
}
