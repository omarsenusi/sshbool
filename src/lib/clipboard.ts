import { invoke } from "@tauri-apps/api/core"
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager"

export async function clipboardWriteText(text: string): Promise<void> {
  try {
    await writeText(text)
    return
  } catch {
    /* fall through */
  }
  await invoke("clipboard_write_text", { text })
}

export async function clipboardReadText(): Promise<string> {
  try {
    const text = await readText()
    if (text) return text
  } catch {
    /* fall through */
  }
  try {
    return await invoke<string>("clipboard_read_text")
  } catch {
    return ""
  }
}
