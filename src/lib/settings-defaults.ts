/** Typed settings keys and defaults persisted via settings_get/set. */

export const SETTINGS = {
  connections: {
    defaultPort: "connections.defaultPort",
    defaultUsername: "connections.defaultUsername",
    defaultAuthMethod: "connections.defaultAuthMethod",
    autoConnectOnSelect: "connections.autoConnectOnSelect",
    keepaliveSecs: "connections.keepaliveSecs",
  },
  editor: {
    fontSize: "editor.fontSize",
    tabSize: "editor.tabSize",
    wordWrap: "editor.wordWrap",
    font: "editor.font",
    minimap: "editor.minimap",
    autoSave: "editor.autoSave",
  },
  sftp: {
    remoteStartPath: "sftp.remoteStartPath",
    confirmDelete: "sftp.confirmDelete",
    showHidden: "sftp.showHidden",
    openFileIn: "sftp.openFileIn",
  },
  updates: {
    autoUpdate: "updates.autoUpdate",
  },
} as const

export type AuthMethodDefault = "key" | "password" | "agent"
export type EditorWordWrap = "off" | "on"
export type SftpOpenFileIn = "popout" | "editor"

export interface SettingsValues {
  "connections.defaultPort": number
  "connections.defaultUsername": string
  "connections.defaultAuthMethod": AuthMethodDefault
  "connections.autoConnectOnSelect": boolean
  "connections.keepaliveSecs": number
  "editor.fontSize": number
  "editor.tabSize": number
  "editor.wordWrap": EditorWordWrap
  "editor.font": string | null
  "editor.minimap": boolean
  "editor.autoSave": boolean
  "sftp.remoteStartPath": string
  "sftp.confirmDelete": boolean
  "sftp.showHidden": boolean
  "sftp.openFileIn": SftpOpenFileIn
  "updates.autoUpdate": boolean
}

export type SettingsKey = keyof SettingsValues

export const SETTINGS_DEFAULTS: SettingsValues = {
  "connections.defaultPort": 22,
  "connections.defaultUsername": "root",
  "connections.defaultAuthMethod": "key",
  "connections.autoConnectOnSelect": false,
  "connections.keepaliveSecs": 60,
  "editor.fontSize": 13,
  "editor.tabSize": 4,
  "editor.wordWrap": "off",
  "editor.font": null,
  "editor.minimap": false,
  "editor.autoSave": false,
  "sftp.remoteStartPath": ".",
  "sftp.confirmDelete": true,
  "sftp.showHidden": false,
  "sftp.openFileIn": "popout",
  "updates.autoUpdate": false,
}

export function settingDefault<K extends SettingsKey>(key: K): SettingsValues[K] {
  return SETTINGS_DEFAULTS[key]
}
