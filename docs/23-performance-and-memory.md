# 23 — Performance & Memory Optimization

Consolidates the "performance first" pillar (doc 00 §2, doc 01 §8, doc 06 §8) into concrete
budgets, techniques, and verification methods.

## 1. Performance budget (targets)

| Metric | Target | Notes |
|---|---|---|
| Cold start (app launch → interactive Home) | < 800 ms | measured on mid-range hardware, release build |
| Connect to saved host (auth → first shell prompt) | < 1.2 s on LAN | includes handshake + auth + PTY alloc |
| Idle RAM (app open, no sessions) | < 180 MB | webview + Rust core combined |
| Per active terminal session RAM | < 15 MB | scrollback-capped |
| UI input latency (keystroke → terminal echo, local test) | < 16 ms | one frame at 60Hz |
| Dashboard widget re-render rate | ≤ 4 Hz | throttled regardless of sampling rate |
| Command palette open → results | < 50 ms | for a DB with 10k+ hosts/snippets |
| SFTP directory listing (1000 entries) | < 300 ms render | virtualized list |

These are **gates**, not aspirations — doc 24 wires perf regression checks into CI where feasible
(startup timing, bundle size budget) and manual profiling passes before each release (doc 25).

## 2. Why Tauri + Rust (recap)

- No embedded Chromium/Node runtime duplication (unlike Electron) — the OS's native webview is
  reused, and all heavy lifting (SSH, crypto, DB, parsing) runs in compiled Rust, not JS.
  This is the single biggest lever behind the RAM and cold-start targets above.

## 3. Backend performance techniques

- **Actor-per-connection** (doc 01 §8): avoids lock contention on the SSH socket; channel I/O is
  dispatched without a global mutex, so N sessions on the same host don't serialize each other.
- **`spawn_blocking`/`rayon`** for CPU-bound work (Argon2 KDF, key generation, compression) keeps
  the async executor's worker threads free for I/O, preventing latency spikes across unrelated sessions.
- **Streaming everywhere**: SFTP transfers, DB result sets, docker logs/stats, AI responses — never
  buffer an entire payload in memory before forwarding to the UI. Backpressure is applied at the
  slowest link (typically the network) rather than growing an in-memory queue unbounded.
- **Bounded ring buffers**: `metric_series` (doc 04 §5), terminal scrollback, log views — every
  unbounded-looking stream has an explicit cap enforced close to the source, not just "cleaned up
  later," so peak memory is predictable even under sustained load (e.g., a noisy log tail left
  running overnight).
- **Connection sharing** (doc `features/10-ssh-connections.md` §2): one handshake serves terminal +
  SFTP + metrics + docker for a host, avoiding N-times the TCP/crypto handshake cost.
- **Compile-time query checking** (SQLx `query!`) catches schema/query mismatches at build time
  rather than via runtime errors or ORM reflection overhead.

## 4. Frontend performance techniques

- **Virtualize every long list** (doc 06 §8): file lists, process lists, result grids, log views,
  command history — `@tanstack/react-virtual` renders only visible rows regardless of dataset size.
- **Imperative hot paths**: terminal byte streams and live metric ticks write directly into
  xterm/canvas primitives, bypassing React's reconciliation entirely for the highest-frequency data
  (doc 06 §2.3, §8) — React state is reserved for things that actually need to trigger UI diffing.
- **Code splitting**: Monaco, xterm's WebGL addon, and entire feature panels (Docker, Databases,
  K8s) are dynamically imported on first use, keeping the initial bundle (and thus cold-start
  parse/eval cost) minimal — a user who never opens the Database client never pays for its JS.
- **Memoization discipline**: widget subtrees (`React.memo`), derived selectors in Zustand
  (fine-grained subscriptions instead of whole-store subscriptions) to avoid cascade re-renders
  when unrelated state changes.
- **Event throttling/coalescing**: high-frequency backend events (metrics, stats, progress) are
  throttled server-side (doc 07 §3) to the frontend's actual useful refresh rate (≤4Hz for charts),
  rather than pushing every sample and relying on the frontend to drop frames.
- **Motion cost control**: animations restricted to `transform`/`opacity` (GPU-compositable,
  doc 08 §5), and disabled under `prefers-reduced-motion`.

## 5. Memory optimization specifics

| Concern | Bound | Mechanism |
|---|---|---|
| Terminal scrollback | configurable, default 10,000 lines/pane | xterm ring buffer + eviction |
| `metric_series` rows | capped per host per metric | delete trigger / ring buffer (doc 04 §5) |
| `command_history`/`query_history`/`audit_log` | retention window (default 90 days) | scheduled prune task |
| Transfer buffers | fixed-size chunk (e.g. 256KB–1MB) reused per stream, not per file | streaming write, no full-file buffering |
| DB result sets (SQL/Mongo/Redis) | paged/streamed, default page size cap | never `SELECT *` fully materialized into a Vec unbounded |
| Docker log/stats views | virtualized + capped in-memory line buffer, older lines evicted | mirrors terminal scrollback pattern |
| Recording files | written to disk incrementally, not buffered in RAM | streamed asciicast writer |
| Secrets in memory | scoped to operation lifetime, zeroized on drop | `secrecy`/`zeroize` (doc 22 §5) |

### Enforcement note (shipped)

- `retention_prune({ days })` Tauri command deletes old `metric_series`, `audit_log`, and
  `query_history` rows (default 30 days). Callable from Settings → General.
- Dashboard sampling keeps ~1h of series per host (see monitoring command cleanup).
- Massif / soak CI jobs remain aspirational (doc 24); not yet in the merge gate.

## 6. Profiling & verification

- **Rust**: `cargo flamegraph`/`tokio-console` for async task diagnostics; `dhat`/`valgrind
  massif` (Linux CI job) for heap profiling on suspected leak paths (long-lived actors, plugin host).
- **Frontend**: React DevTools Profiler for render cost; Chrome/WebView DevTools Performance panel
  for frame timing on the terminal/dashboard hot paths; bundle-size tracked via a CI budget check
  (fails if a route's chunk grows past its allotted size — doc 24).
- **End-to-end**: a scripted soak test (doc 24) runs a multi-hour session with active terminal
  output, live dashboard polling, and a background transfer, asserting RAM stays within the
  budgeted growth curve (no unbounded climb).

## 7. Acceptance criteria

- All targets in §1 are met on the CI-designated reference hardware profile before each release
  (doc 25 release checklist references this doc).
- 24-hour soak test shows RAM growth bounded and recoverable (returns near baseline after closing
  sessions), confirming no leak in the actor/event-subscription lifecycle.
- Disabling a dashboard tab or closing a log view measurably stops the corresponding background
  sampling/streaming (verified via network/exec call counts, not just UI state).
