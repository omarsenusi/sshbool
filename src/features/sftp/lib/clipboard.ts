import { create } from "zustand"
import type { SftpEntryDto } from "@/lib/ipc/types"

export type PaneSide = "local" | "remote"

export type SftpClipboard = {
  hostId: string
  side: PaneSide
  mode: "copy" | "cut"
  entries: SftpEntryDto[]
} | null

type ClipState = {
  clipboard: SftpClipboard
  setClipboard: (clip: SftpClipboard) => void
  clearClipboard: () => void
}

export const useSftpClipboard = create<ClipState>((set) => ({
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
  clearClipboard: () => set({ clipboard: null }),
}))
