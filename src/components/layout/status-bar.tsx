import { useVaultStore } from "@/stores/vault.store"

export function StatusBar() {
  const status = useVaultStore((s) => s.status)

  return (
    <footer className="bg-sidebar border-border text-muted-foreground flex h-[var(--statusbar-h)] shrink-0 items-center justify-between border-t px-3 text-[11px]">
      <div className="flex items-center gap-3">
        <span>
          Vault:{" "}
          {!status
            ? "…"
            : !status.initialized
              ? "not set up"
              : status.locked
                ? "locked"
                : "unlocked"}
        </span>
      </div>
      <div>SSHBool 0.1.0</div>
    </footer>
  )
}
