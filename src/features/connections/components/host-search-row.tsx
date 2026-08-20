import { Check, Star, X } from 'lucide-react';
import { hostAccent, hostLetter } from '@/features/connections/host-appearance';
import type { HostDto } from '@/lib/ipc/types';
import { cn } from '@/lib/utils';

const MAX_RESULTS = 6;

interface HostSearchRowProps {
  host: HostDto;
  selected?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}

function HostAvatar({ host, size = 'sm' }: { host: HostDto; size?: 'sm' | 'md' }) {
  const accent = hostAccent(host);
  const hasIcon = !!host.icon;
  const dim = size === 'md' ? 'size-7 text-xs' : 'size-6 text-[11px]';

  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded font-semibold text-white',
        dim,
      )}
      style={{ backgroundColor: hasIcon ? 'transparent' : accent }}
    >
      {hasIcon ? (
        <img src={host.icon!} alt="" className="size-full object-cover" />
      ) : (
        hostLetter(host.label)
      )}
    </span>
  );
}

export function HostSelectedChip({ host, onClear }: { host: HostDto; onClear: () => void }) {
  const connection = `${host.username ? `${host.username}@` : ''}${host.hostname}:${host.port}`;

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-primary/35 bg-primary/5 px-2.5 py-2 shadow-2xs">
      <HostAvatar host={host} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden />
          <p className="truncate text-xs font-medium">{host.label}</p>
          {host.isFavorite && <Star className="size-3 shrink-0 fill-current text-warning" />}
        </div>
        <p className="truncate font-mono text-[10px] text-muted-foreground">{connection}</p>
      </div>
      <button
        type="button"
        aria-label={`Clear ${host.label}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        onClick={onClear}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function HostSearchRow({ host, selected, interactive = true, onClick }: HostSearchRowProps) {
  const connection = `${host.username ? `${host.username}@` : ''}${host.hostname}:${host.port}`;

  const content = (
    <>
      <HostAvatar host={host} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{host.label}</span>
          {host.isFavorite && <Star className="size-3 shrink-0 fill-current text-warning" />}
        </div>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{connection}</span>
      </div>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
    </>
  );

  const className = cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
    interactive && 'hover:bg-muted/60',
    selected && 'bg-primary/10 ring-1 ring-primary/25',
  );

  if (!interactive) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={className}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export function hostMatchesQuery(host: HostDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    host.label,
    host.hostname,
    host.username ?? '',
    String(host.port),
    `${host.username ?? ''}@${host.hostname}:${host.port}`,
    host.notes ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export { MAX_RESULTS as HOST_AUTOCOMPLETE_MAX_RESULTS };
