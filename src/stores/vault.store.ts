import { create } from "zustand"

import type { VaultStatusDto } from "@/lib/ipc/types"

type VaultState = {
  status: VaultStatusDto | null
  setStatus: (status: VaultStatusDto) => void
  clear: () => void
}

export const useVaultStore = create<VaultState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
  clear: () => set({ status: null }),
}))
