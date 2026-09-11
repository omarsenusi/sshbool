import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"

/**
 * By default, @monaco-editor/react loads Monaco from jsDelivr CDN.
 * In desktop apps, CSP blocks external script loading, which leaves the editor stuck on "Loading…".
 * Point loader at local monaco-editor package and instantiate Vite web workers locally.
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
