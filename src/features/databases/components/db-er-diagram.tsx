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

const NODE_W = 260
const COL_GAP = 100
const ROW_GAP = 28
const PAD = 48
const HEADER_H = 34
const ROW_H = 20
const MAX_COLS = 8
const MINIMAP_W = 180
const MINIMAP_H = 120

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

/** Wide layered layout: FK parents left → children right; many columns of space. */
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

  const rank = new Map<string, number>()
  const visiting = new Set<string>()
  function depth(id: string): number {
    if (rank.has(id)) return rank.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const refs = outgoing.get(id) ?? []
    const d = refs.length === 0 ? 0 : 1 + Math.max(...refs.map(depth))
    visiting.delete(id)
    rank.set(id, d)
    return d
  }
  for (const id of ids) depth(id)

  // Islands (no FKs either way): spread across extra horizontal slots for width
  const islands = ids.filter(
    (id) =>
      (outgoing.get(id)?.length ?? 0) === 0 && (incoming.get(id)?.length ?? 0) === 0,
  )
  const connected = ids.filter((id) => !islands.includes(id))

  const layers = new Map<number, string[]>()
  for (const id of connected) {
    const r = rank.get(id) ?? 0
    if (!layers.has(r)) layers.set(r, [])
    layers.get(r)!.push(id)
  }
  for (const list of layers.values()) {
    list.sort((a, b) => {
      const da = (incoming.get(a)?.length ?? 0) + (outgoing.get(a)?.length ?? 0)
      const db = (incoming.get(b)?.length ?? 0) + (outgoing.get(b)?.length ?? 0)
      return db - da || a.localeCompare(b)
    })
  }

  const maxRank = Math.max(0, ...[...layers.keys()], 0)
  // Place islands in additional columns to the right so canvas stays wide
  const islandCols = Math.max(2, Math.ceil(Math.sqrt(Math.max(islands.length, 1))))

  const tableById = new Map(
    tables.map(({ schema: sch, table }) => [idOf(sch, table.name), { schema: sch, table }]),
  )

  const nodes: LayoutNode[] = []

  for (let r = 0; r <= maxRank; r++) {
    const list = layers.get(r) ?? []
    let y = PAD
    for (const id of list) {
      const { schema: sch, table } = tableById.get(id)!
      const h = nodeHeight(table.columns.length)
      nodes.push({
        id,
        schema: sch,
        table,
        x: PAD + r * (NODE_W + COL_GAP),
        y,
        w: NODE_W,
        h,
      })
      y += h + ROW_GAP
    }
  }

  const baseX = PAD + (maxRank + 1) * (NODE_W + COL_GAP) + (connected.length ? COL_GAP : 0)
  islands.sort((a, b) => a.localeCompare(b))
  islands.forEach((id, i) => {
    const { schema: sch, table } = tableById.get(id)!
    const h = nodeHeight(table.columns.length)
    const col = i % islandCols
    const row = Math.floor(i / islandCols)
    // Estimate row y from previous islands in same col — approximate with uniform stride
    const stride = 160
    nodes.push({
      id,
      schema: sch,
      table,
      x: baseX + col * (NODE_W + COL_GAP),
      y: PAD + row * stride,
      w: NODE_W,
      h,
    })
  })

  // Fix island vertical packing properly per column
  for (let c = 0; c < islandCols; c++) {
    const colNodes = nodes.filter((n) => {
      const idx = islands.indexOf(n.id)
      return idx >= 0 && idx % islandCols === c
    })
    colNodes.sort((a, b) => a.y - b.y)
    let y = PAD
    for (const n of colNodes) {
      n.y = y
      y += n.h + ROW_GAP
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
    return { minX: 0, minY: 0, maxX: 1200, maxY: 800, width: 1200, height: 800 }
  }
  const width = Math.max(1200, maxX + PAD)
  const height = Math.max(800, maxY + PAD)
  return { minX, minY, maxX, maxY, width, height }
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
    const pad = 32
    const zx = (el.clientWidth - pad) / b.width
    const zy = (el.clientHeight - pad) / b.height
    const next = Math.min(1, Math.max(0.25, Math.min(zx, zy) * 0.98))
    setZoom(next)
    setPan({ x: pad / 2, y: pad / 2 })
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
    setZoom((z) => Math.min(1.8, Math.max(0.2, +(z + delta).toFixed(3))))
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
          onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
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
              const x1 = from.x + from.w
              const y1 = from.y + 20
              const x2 = to.x
              const y2 = to.y + 20
              const dx = Math.max(40, Math.abs(x2 - x1) * 0.4)
              const d = `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
              return (
                <path
                  key={e.id}
                  d={d}
                  fill="none"
                  strokeWidth={active && related ? 2 : 1.25}
                  stroke="rgb(14 165 233 / 0.45)"
                  markerEnd="url(#er-arrow)"
                  opacity={related && !active ? 0.08 : 1}
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
