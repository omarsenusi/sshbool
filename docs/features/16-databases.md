# Feature 16 — Built-in Database Clients

Backend: `infrastructure/databases/*` (doc 05 §3.6); domain `datastores`; UI `features/databases`.

## 1. Scope checklist

Built-in clients for MySQL · MariaDB · PostgreSQL · Redis · MongoDB · SQLite.

## 2. Connectivity model

- Database connections (`db_connections` table, doc 04 §3.7) can target:
  1. A database directly reachable from the user's machine, or
  2. A database only reachable **from the remote host** (typical: private RDS/managed DB, or a DB
     bound to `localhost` on the server) — in this case SSHBool transparently opens a **local port
     forward** through the host's SSH connection (`tunnel_binder.rs`) and points the DB driver at
     `127.0.0.1:<local-port>`, so "tunnel through this host" is just a checkbox in `DbConnectionDialog`.
- Credentials are stored via the vault (`credential_id` FK), never inline in the connection row.

## 3. SQL engines (MySQL/MariaDB/PostgreSQL/SQLite)

- Single `SqlClient` adapter built on **SQLx**, parameterized to the specific driver at runtime.
- `db_introspect` returns a `SchemaDto` (databases/schemas → tables → columns/types/keys/indexes)
  populating `SchemaTree` in the sidebar and powering SQL autocomplete in `QueryEditor`.
- `db_run_query` executes arbitrary SQL with bound parameters where applicable; results stream into
  a virtualized `ResultGrid` (large result sets are paged/streamed, never fully buffered in memory —
  see doc 23). Read-only vs. mutating statements are distinguished so destructive queries
  (`DROP`, `DELETE` without `WHERE`, `TRUNCATE`) trigger `ConfirmDestructiveQueryDialog`.
- `SavedQueries` and `QueryHistory` persist per connection (doc 04 §3.7); results exportable to
  CSV/JSON (`db_export_result`).

## 4. Redis

- `RedisClient` wraps the `redis` crate; `RedisConsole` provides a REPL-style command input
  (`redis_command({ connectionId, args[] })`) plus higher-level browsing: key browser (scan by
  pattern, TTL, type-aware value viewer for strings/lists/sets/hashes/streams).
- Pub/Sub and monitor-style live views are a fast-follow (tracked in doc 28) — v1 focuses on
  command execution + key browsing, which covers the majority of ops/debugging use cases.

## 5. MongoDB

- `MongoClient` wraps the official `mongodb` driver; `MongoQueryPanel` supports `mongo_find`
  (filter/projection/sort/limit) with a document tree viewer, plus a raw-command escape hatch for
  power users who need aggregation pipelines beyond the guided UI.

## 6. Safety & UX guardrails

- Every connection is tested before saving (`db_test`) with a clear success/failure reason.
- Query execution shows timing and row count; long-running queries are cancellable
  (`CancellationToken`, doc 05 §5) without killing the underlying connection.
- No engine's credentials or raw connection strings are ever logged (doc 22 redaction rules apply
  identically here).

## 7. Commands

`db_list`, `db_upsert`, `db_delete`, `db_test`, `db_introspect`, `db_run_query`, `db_saved_list`,
`db_saved_upsert`, `db_history`, `db_export_result`, `redis_command`, `mongo_find` (doc 07 §4.7).

## 8. Acceptance criteria

- Connect directly and via SSH-tunneled forward to each of the six engines against real instances.
- Schema introspection populates the tree and drives autocomplete correctly for MySQL and Postgres.
- A `DROP TABLE` prompts the destructive-query confirmation; a `SELECT` on a large table streams
  into the grid without freezing the UI.
- Redis key browser correctly type-switches its value viewer; Mongo find returns and renders
  nested documents legibly.
