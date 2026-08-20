import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  HOST_AUTOCOMPLETE_MAX_RESULTS,
  HostSearchRow,
  HostSelectedChip,
  hostMatchesQuery,
} from '@/features/connections/components/host-search-row';
import { ipc } from '@/lib/ipc/commands';
import type { HostDto } from '@/lib/ipc/types';
import { cn } from '@/lib/utils';

interface HostAutocompleteProps {
  hosts: HostDto[];
  excludeHostIds?: string[];
  selectedHostId: string | null;
  onSelect: (hostId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputId?: string;
}

export function HostAutocomplete({
  hosts,
  excludeHostIds = [],
  selectedHostId,
  onSelect,
  disabled,
  placeholder = 'Search by name or IP…',
  className,
  inputId,
}: HostAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const excluded = useMemo(() => new Set(excludeHostIds), [excludeHostIds]);
  const hostById = useMemo(() => new Map(hosts.map((h) => [h.id, h])), [hosts]);

  const candidates = useMemo(
    () => hosts.filter((h) => !excluded.has(h.id)),
    [hosts, excluded],
  );

  const [remoteIds, setRemoteIds] = useState<string[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRemoteIds([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void ipc
        .hostsSearch(q)
        .then((rows) => setRemoteIds(rows.map((r) => r.id)))
        .catch(() => setRemoteIds([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const { results, hasMore } = useMemo(() => {
    const q = query.trim();
    const seen = new Set<string>();
    const out: HostDto[] = [];

    const push = (host: HostDto | undefined) => {
      if (!host || excluded.has(host.id) || seen.has(host.id)) return;
      seen.add(host.id);
      out.push(host);
    };

    if (!q) {
      for (const host of candidates) {
        push(host);
      }
    } else {
      for (const host of candidates) {
        if (hostMatchesQuery(host, q)) push(host);
      }
      for (const id of remoteIds) {
        push(hostById.get(id));
      }
    }

    const total = out.length;
    return {
      results: out.slice(0, HOST_AUTOCOMPLETE_MAX_RESULTS),
      hasMore: total > HOST_AUTOCOMPLETE_MAX_RESULTS,
    };
  }, [query, candidates, remoteIds, hostById, excluded]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const selectedHost = selectedHostId ? hostById.get(selectedHostId) : undefined;

  return (
    <div ref={rootRef} className={cn('relative max-w-md w-full space-y-2', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={inputId}
          value={query}
          disabled={disabled}
          placeholder={selectedHost ? `Selected: ${selectedHost.label}` : placeholder}
          className="h-8 max-w-md pl-8 text-xs"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        />

        {open && results.length > 0 && (
          <div className="absolute top-[calc(100%+4px)] z-50 max-w-md w-full rounded-xl border border-border/70 bg-popover p-1 shadow-md ring-1 ring-foreground/10">
            <div role="listbox" className="space-y-0.5 p-0.5">
              {results.map((host) => (
                <HostSearchRow
                  key={host.id}
                  host={host}
                  selected={host.id === selectedHostId}
                  onClick={() => {
                    onSelect(host.id);
                    setQuery('');
                    setOpen(false);
                  }}
                />
              ))}
            </div>
            {hasMore && (
              <p className="border-t border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground">
                Showing {HOST_AUTOCOMPLETE_MAX_RESULTS} matches — refine your search
              </p>
            )}
          </div>
        )}

        {open && query.trim() && results.length === 0 && (
          <div className="absolute top-[calc(100%+4px)] z-50 max-w-md w-full rounded-xl border border-border/70 bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
            No hosts match &quot;{query.trim()}&quot;
          </div>
        )}
      </div>

      {selectedHost && (
        <HostSelectedChip
          host={selectedHost}
          onClear={() => {
            onSelect(null);
            setQuery('');
          }}
        />
      )}
    </div>
  );
}
