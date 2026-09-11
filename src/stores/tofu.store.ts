import { create } from "zustand"

export type PendingFingerprint = {
  hostId: string
  host: string
  port: number
  fingerprint: string
  fingerprintMd5?: string
  keyType: string
  opts?: { label?: string; openPane?: boolean }
}

export type PendingKeyPassphrase = {
  hostId: string
  opts?: { label?: string; openPane?: boolean }
}

export type PendingHostKeyChanged = {
  hostId: string
  expected: string
  actual: string
}

type TofuState = {
  pendingFingerprint: PendingFingerprint | null
  pendingKeyPassphrase: PendingKeyPassphrase | null
  pendingHostKeyChanged: PendingHostKeyChanged | null
  setPendingFingerprint: (data: PendingFingerprint | null) => void
  setPendingKeyPassphrase: (data: PendingKeyPassphrase | null) => void
  setPendingHostKeyChanged: (data: PendingHostKeyChanged | null) => void
}

export const useTofuStore = create<TofuState>((set) => ({
  pendingFingerprint: null,
  pendingKeyPassphrase: null,
  pendingHostKeyChanged: null,
  setPendingFingerprint: (pendingFingerprint) => set({ pendingFingerprint }),
  setPendingKeyPassphrase: (pendingKeyPassphrase) =>
    set({ pendingKeyPassphrase }),
  setPendingHostKeyChanged: (pendingHostKeyChanged) =>
    set({ pendingHostKeyChanged }),
}))
