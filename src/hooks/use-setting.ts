import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ipc } from "@/lib/ipc/commands"
import {
  settingDefault,
  type SettingsKey,
  type SettingsValues,
} from "@/lib/settings-defaults"

export function useSetting<K extends SettingsKey>(key: K) {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ["settings", key],
    queryFn: async (): Promise<SettingsValues[K]> => {
      const raw = await ipc.settingsGet(key)
      if (raw === null || raw === undefined) return settingDefault(key)
      return raw as SettingsValues[K]
    },
  })

  const mutation = useMutation({
    mutationFn: async (value: SettingsValues[K]) => {
      await ipc.settingsSet(key, value)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", key] })
    },
  })

  return {
    value: (query.data ?? settingDefault(key)) as SettingsValues[K],
    isLoading: query.isLoading,
    setValue: mutation.mutate,
    setValueAsync: mutation.mutateAsync,
    isSaving: mutation.isPending,
  }
}

/** Read a setting once outside React. */
export async function readSetting<K extends SettingsKey>(
  key: K
): Promise<SettingsValues[K]> {
  const raw = await ipc.settingsGet(key)
  if (raw === null || raw === undefined) return settingDefault(key)
  return raw as SettingsValues[K]
}
