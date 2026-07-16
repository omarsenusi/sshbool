#!/usr/bin/env node
/**
 * IPC type sync stub: copies hand-maintained types as the generated contract.
 * When Rust DTOs use ts-rs, replace this with `cargo test -p application --features export-ts`.
 */
import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(root, "src/lib/ipc/types.ts")
const outDir = join(root, "src/lib/schemas")
mkdirSync(outDir, { recursive: true })
copyFileSync(src, join(outDir, "ipc-types.snapshot.ts"))
console.log("gen:ipc OK (snapshot refreshed)")
