# Feature 20 — Built-in AI Assistant

Backend: `infrastructure/ai/*` (doc 05 §3.7); domain `ai`; UI `features/ai`.

## 1. Scope checklist

Built-in AI assistant · Explain Linux commands · Generate commands · Analyze logs · Explain errors
· Optimize SSH · Docker assistant · Kubernetes assistant · Generate Nginx config · Generate Apache
config · Generate Docker Compose · Generate Laravel commands · Generate SQL queries · Translate
terminal output.

## 2. Provider model (bring-your-own or local)

- `AiProviderClient` port (doc 05 §1.10) with adapters for **OpenAI**, **Anthropic**, **Ollama**
  (local models — fully offline AI, consistent with the offline-first pillar), and a **custom**
  OpenAI-compatible endpoint (covers most self-hosted/proxy setups).
- Users configure their own API key (stored via the vault as a `credential`) in `AiSettingsDialog`;
  SSHBool never bundles a shared key/proxy for paid providers — this avoids us bearing inference
  cost and keeps the trust model simple ("your key, your data flows directly to your chosen provider").
- **Ollama** is the recommended default for security-conscious users: zero data leaves the machine.

## 3. Context assembly & redaction (critical)

- Every AI request is built by `infrastructure/ai/context.rs` from explicit, user-visible
  "context chips" (`ContextChips`): active host (name/OS only, never credentials), last command
  and its output, or an explicit selection (log excerpt, error text, SQL schema).
- **Before any request leaves the app**, a redaction pass strips patterns matching secrets
  (private keys, tokens, connection strings with embedded passwords, common credential patterns)
  from the outgoing payload — mirroring the redaction rules in doc 22. Users can also disable
  "send command output" context entirely and type free-form questions only.
- Conversations are optionally persisted (`ai_conversations`/`ai_messages`, doc 04 §3.9); this is
  **local-only by default** and explicitly excluded from cloud Sync (doc
  `features/19-sync-backup.md` §6) unless a user opts in.

## 4. Chat surface

- `AiCopilotPanel` in the secondary sidebar: `ChatThread` with markdown + syntax-highlighted code
  blocks, each code block offering **Copy** and **Run in terminal** (sends to the active pane via
  `pane_write` after an explicit click — never auto-executed).
- Streaming via `ai_send` → `ai://token/{requestId}` events into `useAiStream`, so responses render
  token-by-token like modern chat UIs.

## 5. Quick actions (task-specific prompts)

Each quick action is a dedicated command with a purpose-built system prompt
(`infrastructure/ai/prompts.rs`) rather than a generic chat message, so outputs are consistently
structured and scoped:

| Action | Command | Behavior |
|---|---|---|
| Explain command | `ai_explain_command` | Plain-language breakdown of a shell command, flag by flag |
| Generate command | `ai_generate_command` | Natural-language intent → shell command, OS-aware, with a safety note for destructive ones |
| Analyze logs | `ai_analyze_logs` | Summarize, cluster errors, highlight likely root cause in a log excerpt |
| Explain error | `ai_explain_error` | Take a stack trace/error string → likely cause + fix suggestions |
| Optimize SSH | (chat with `optimize-ssh` prompt) | Reviews a host's config (compression, keepalive, ciphers) and suggests changes |
| Docker assistant | (chat, docker context) | Answers scoped to the active container/compose context |
| Kubernetes assistant | (chat, k8s context) | Answers scoped to the active pod/namespace context |
| Generate Nginx config | `ai_generate_config({ kind: "nginx" })` | Spec (domain, proxy target, TLS) → ready config, opens in Remote Editor |
| Generate Apache config | `ai_generate_config({ kind: "apache" })` | Same pattern for Apache vhosts |
| Generate Docker Compose | `ai_generate_config({ kind: "compose" })` | Services/spec → `docker-compose.yml` |
| Generate Laravel commands | (chat, laravel context) | Suggests the right `artisan` invocation for a described task |
| Generate SQL queries | `ai_generate_sql` | Natural language + introspected schema (doc `features/16-databases.md`) → SQL, shown in `QueryEditor` before running (never auto-run) |
| Translate terminal output | `ai_translate_output` | Translates selected output/errors to the user's chosen language |

All "Generate config" outputs open directly in the Remote Editor / Query Editor as a **draft** —
the user reviews and explicitly saves/runs, preserving the "AI suggests, human confirms" boundary
everywhere destructive or state-changing actions are involved.

## 6. Safety boundaries

- The assistant **never** executes commands, writes files, or runs queries on its own — every
  code block/generated artifact requires an explicit user click to run/save/upload.
- Generated shell commands flagged as potentially destructive (`rm -rf`, `dd`, `mkfs`, force-push,
  etc., via a small pattern list) get an inline warning badge before the Run button.

## 7. Commands & events

`ai_providers_list/upsert`, `ai_send`, `ai_explain_command`, `ai_generate_command`,
`ai_analyze_logs`, `ai_explain_error`, `ai_generate_config`, `ai_generate_sql`,
`ai_translate_output`, `ai_conversations_list` (doc 07 §4.9). Events: `ai://token/{requestId}`,
`ai://done/{requestId}`.

## 8. Acceptance criteria

- Configure an OpenAI key and an Ollama local endpoint; both stream responses correctly.
- A log excerpt containing an embedded password is redacted before leaving the app (verified via
  a network capture in dev/test).
- "Run in terminal" only ever executes after an explicit click, never automatically.
- Generate an Nginx config from a plain-language spec, open it in the editor, and successfully
  upload-on-save to a real host.
- Disabling "send command output" context is respected — subsequent requests contain no host output.
