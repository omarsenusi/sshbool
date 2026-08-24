import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {

  Copy,
  Check,
  Trash2,
  Search,
  ArrowUpDown,
  Filter,
  RefreshCw,
  CheckSquare,
  Square,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ipc } from "@/lib/ipc/commands"
import { KnownHostDto } from "@/lib/ipc/types"
import { toast } from "@/stores/toast.store"

type SortField = "host" | "port" | "keyType" | "date"
type SortOrder = "asc" | "desc"

type KnownHostKeysPanelProps = {
  /** When true, hides the page header (used inside Key Manager tabs). */
  embedded?: boolean
}

export function KnownHostKeysPanel({ embedded = false }: KnownHostKeysPanelProps) {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")
  const [algoFilter, setAlgoFilter] = useState<string>("all")
  const [sortField, setSortField] = useState<SortField>("date")
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  const { data: knownHosts = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["known_hosts"],
    queryFn: async () => {
      const list = await ipc.knownHostsList()
      return list as KnownHostDto[]
    },
  })

  // Bulk Delete Mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await ipc.knownHostsDelete(id)
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["known_hosts"] })
      toast.success(
        `Revoked trust for ${variables.length} ${variables.length === 1 ? "host key" : "host keys"}`
      )
      setSelectedIds(new Set())
      setIsBulkDeleting(false)
    },
    onError: (err) => {
      toast.error(`Bulk revocation failed: ${String(err)}`)
      setIsBulkDeleting(false)
    },
  })

  // Statistics
  const stats = useMemo(() => {
    const total = knownHosts.length
    const ed25519Count = knownHosts.filter((h) => h.keyType.includes("ed25519")).length
    const rsaCount = knownHosts.filter((h) => h.keyType.includes("rsa")).length
    const ecdsaCount = knownHosts.filter((h) => h.keyType.includes("ecdsa")).length

    return { total, ed25519Count, rsaCount, ecdsaCount }
  }, [knownHosts])

  // Filtered & Sorted list
  const processedHosts = useMemo(() => {
    return knownHosts
      .filter((h) => {
        const matchesSearch =
          h.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
          h.keyType.toLowerCase().includes(searchQuery.toLowerCase()) ||
          h.fingerprintSha256.toLowerCase().includes(searchQuery.toLowerCase()) ||
          String(h.port).includes(searchQuery)

        const matchesAlgo =
          algoFilter === "all" || h.keyType.toLowerCase().includes(algoFilter.toLowerCase())

        return matchesSearch && matchesAlgo
      })
      .sort((a, b) => {
        let cmp = 0
        if (sortField === "host") cmp = a.host.localeCompare(b.host)
        else if (sortField === "port") cmp = a.port - b.port
        else if (sortField === "keyType") cmp = a.keyType.localeCompare(b.keyType)
        else if (sortField === "date") cmp = a.firstSeenAt - b.firstSeenAt

        return sortOrder === "asc" ? cmp : -cmp
      })
  }, [knownHosts, searchQuery, algoFilter, sortField, sortOrder])

  const totalPages = Math.ceil(processedHosts.length / pageSize) || 1
  const validCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (validCurrentPage - 1) * pageSize
  const paginatedHosts = useMemo(() => {
    return processedHosts.slice(startIndex, startIndex + pageSize)
  }, [processedHosts, startIndex, pageSize])

  const toggleSelectAll = () => {
    if (selectedIds.size === processedHosts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(processedHosts.map((h) => h.id)))
    }
  }

  const toggleSelectId = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return
    if (
      window.confirm(
        `Revoke trust for ${selectedIds.size} host key(s)? Next connection will prompt for verification.`
      )
    ) {
      setIsBulkDeleting(true)
      bulkDeleteMutation.mutate(Array.from(selectedIds))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {!embedded && (
        <header className="border-b border-border flex shrink-0 items-center justify-between gap-4 px-5 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">Host Keys Manager</h2>
              <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                {stats.total} Saved
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Manage trusted SSH server fingerprints (`known_hosts`) and revoke trust when needed.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="h-8 text-xs gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            {selectedIds.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className="h-8 text-xs gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Revoke {selectedIds.size} Selected
              </Button>
            )}
          </div>
        </header>
      )}

      {/* Body Area */}
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${embedded ? "p-4" : "p-5"}`}>
        {/* Search & Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5 shrink-0">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter by host, port, algorithm, or fingerprint..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md bg-background border border-input pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-ring transition-colors"
            />
          </div>

          <div className="flex items-center gap-2">
            {embedded && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isRefetching}
                  className="h-8 text-xs gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                {selectedIds.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkDelete}
                    disabled={isBulkDeleting}
                    className="h-8 text-xs gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke {selectedIds.size}
                  </Button>
                )}
              </>
            )}
            <div className="flex items-center gap-1.5">
              <Select value={algoFilter} onValueChange={(v) => { if (v) setAlgoFilter(v) }}>
                <SelectTrigger className="h-8 text-xs w-[120px] bg-background">
                  <div className="flex items-center gap-1.5 truncate">
                    <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Algorithm" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Algos</SelectItem>
                  <SelectItem value="ed25519">Ed25519</SelectItem>
                  <SelectItem value="rsa">RSA</SelectItem>
                  <SelectItem value="ecdsa">ECDSA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Select value={sortField} onValueChange={(v) => { if (v) setSortField(v as SortField) }}>
                <SelectTrigger className="h-8 text-xs w-[140px] bg-background">
                  <div className="flex items-center gap-1.5 truncate">
                    <ArrowUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Sort By" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Date Verified</SelectItem>
                  <SelectItem value="host">Host IP</SelectItem>
                  <SelectItem value="port">Port</SelectItem>
                  <SelectItem value="keyType">Algorithm</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                className="h-8 text-[11px] font-mono px-2.5"
              >
                {sortOrder.toUpperCase()}
              </Button>
            </div>
          </div>
        </div>

        {/* Compact Table View */}
        <div className="flex-1 border border-border rounded-lg overflow-hidden bg-card/40 flex flex-col">
          <div className="overflow-x-auto overflow-y-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-muted/40 text-muted-foreground border-b border-border sticky top-0 z-10 backdrop-blur-xs">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {selectedIds.size > 0 && selectedIds.size === processedHosts.length ? (
                        <CheckSquare className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Square className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </th>
                  <th className="p-3 font-medium">Server Host</th>
                  <th className="p-3 font-medium">Algorithm</th>
                  <th className="p-3 font-medium">SHA-256 Fingerprint</th>
                  <th className="p-3 font-medium">Verified Date</th>
                  <th className="p-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                      Loading trusted host keys...
                    </td>
                  </tr>
                ) : processedHosts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                      <ShieldAlert className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-50" />
                      <p className="font-medium text-foreground">No trusted host keys found</p>
                      <p className="text-[11px] mt-0.5">
                        {searchQuery ? "No entries match your search query." : "Saved SSH server keys will appear here."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedHosts.map((item) => {
                    const isSelected = selectedIds.has(item.id)

                    return (
                      <tr
                        key={item.id}
                        className={`transition-colors hover:bg-muted/30 ${
                          isSelected ? "bg-muted/50" : ""
                        }`}
                      >
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleSelectId(item.id)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {isSelected ? (
                              <CheckSquare className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <Square className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>

                        <td className="p-3 font-mono font-medium text-foreground">
                          {item.host}:{item.port}
                        </td>

                        <td className="p-3">
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-mono font-medium bg-muted text-muted-foreground border border-border">
                            {item.keyType}
                          </span>
                        </td>

                        <td className="p-3 font-mono text-[11px] text-muted-foreground break-all select-all">
                          {item.fingerprintSha256}
                        </td>

                        <td className="p-3 text-muted-foreground text-[11px]">
                          {new Date(item.firstSeenAt).toLocaleDateString()}
                        </td>

                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopy(item.fingerprintSha256, `${item.id}-sha`)}
                              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              {copiedId === `${item.id}-sha` ? (
                                <Check className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Revoke trust for host ${item.host}:${item.port}? Reconnecting will require verification.`
                                  )
                                ) {
                                  bulkDeleteMutation.mutate([item.id])
                                }
                              }}
                              className="h-7 px-2 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Pagination Controls */}
          {processedHosts.length > 0 && (
            <div className="border-t border-border px-4 py-2 bg-muted/20 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground shrink-0">
              <div>
                Showing{" "}
                <span className="font-medium text-foreground">
                  {processedHosts.length === 0 ? 0 : startIndex + 1}
                </span>{" "}
                to{" "}
                <span className="font-medium text-foreground">
                  {Math.min(startIndex + pageSize, processedHosts.length)}
                </span>{" "}
                of <span className="font-medium text-foreground">{processedHosts.length}</span> entries
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px]">Rows per page:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      if (v) {
                        setPageSize(Number(v))
                        setCurrentPage(1)
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs w-[70px] bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="15">15</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[11px] mr-1">
                    Page <span className="font-medium text-foreground">{validCurrentPage}</span> of{" "}
                    <span className="font-medium text-foreground">{totalPages}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={validCurrentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={validCurrentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
