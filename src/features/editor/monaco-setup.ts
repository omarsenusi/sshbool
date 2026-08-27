import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import editorWorker from "monaco-editor/editor/editor.worker?worker"
import cssWorker from "monaco-editor/language/css/css.worker?worker"
import htmlWorker from "monaco-editor/language/html/html.worker?worker"
import jsonWorker from "monaco-editor/language/json/json.worker?worker"
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker"

/**
 * @monaco-editor/react loads Monaco from jsDelivr by default. Tauri CSP
 * (`script-src 'self'`) blocks that, so the editor stays on "Loading…" forever
 * with only a console error. Point the loader at the bundled package and serve
 * language workers from Vite instead of the CDN.
 */
const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker
  }
}

monacoGlobal.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker()
      case "css":
      case "scss":
      case "less":
        return new cssWorker()
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker()
      case "typescript":
      case "javascript":
        return new tsWorker()
      default:
        return new editorWorker()
    }
  },
}

loader.config({ monaco })
