# 04 — Database Schema

## 1. Storage model

- **Engine:** SQLite via **SQLx**, encrypted at rest with **SQLCipher** (AES‑256).
- **Location:** app data dir (`$APPDATA/com.abdug.sshbool/` on Windows, `~/Library/Application Support/…` on macOS, `$XDG_DATA_HOME/…` on Linux). File: `sshbool.db`.
- **Encryption key:** the SQLCipher key is derived from the **master password** via Argon2id, or
  loaded from a **data key wrapped in the OS keychain** for biometric/OS unlock. See doc 22 §Key hierarchy.
- **Migrations:** forward‑only, versioned SQL in `src-tauri/migrations/`, applied by SQLx at startup
  inside a transaction. Each migration is idempotent‑safe and never drops user data destructively
  without an explicit backup step.
- **Conventions:** `snake_case`; UUID (v7, time‑ordered) text PKs stored as `TEXT`; timestamps as
  `INTEGER` epoch‑millis (UTC); booleans as `INTEGER` 0/1; soft delete via `deleted_at` where useful.
- **Secret columns** (passwords, passphrases, private keys, tokens) are **never stored plaintext**;
  they hold an **encrypted envelope** (see §Vault). The DB encryption is defense‑in‑depth on top.

## 2. Entity–relationship overview

```
groups 1─* hosts *─* tags            hosts *─1 identities
hosts 1─* port_forwards               hosts *─1 jump_hosts(self-ref via hosts)
vault 1─* credentials                 vault 1─* ssh_keys
hosts 1─* sessions 1─* recordings     sessions 1─* session_panes
transfer_jobs 1─* transfer_items
hosts 1─* host_snapshots (rolling)    metric_series (time buckets)
db_connections 1─* saved_queries
snippets, notes, templates            command_history *─1 hosts
plugins 1─* plugin_permissions        sync_state, sync_changes, devices
settings (kv), audit_log, known_hosts
```

## 3. Tables

Below, `PK` = primary key, `FK` = foreign key, `NN` = NOT NULL, `IX` = indexed.

### 3.1 Connections context

**`groups`** — folders/groups for organizing hosts (self‑nesting tree).
| col | type | notes |
|---|---|---|
| id | TEXT PK | uuidv7 |
| parent_id | TEXT FK→groups.id | nullable (root) |
| name | TEXT NN | |
| color | TEXT | color label |
| icon | TEXT | icon key |
| sort_order | INTEGER NN | |
| created_at / updated_at | INTEGER NN | |

**`hosts`** — a server/connection profile.
| col | type | notes |
|---|---|---|
| id | TEXT PK | |
| group_id | TEXT FK→groups.id | nullable |
| label | TEXT NN | display name |
| hostname | TEXT NN | host/IP |
| port | INTEGER NN | default 22 |
| username | TEXT | |
| identity_id | TEXT FK→identities.id | preferred auth identity |
| auth_method | TEXT NN | `password`\|`key`\|`agent`\|`interactive`\|`fido2` |
| jump_host_id | TEXT FK→hosts.id | ProxyJump (self‑ref, nullable) |
| proxy_id | TEXT FK→proxies.id | SOCKS/HTTP proxy |
| use_compression | INTEGER NN | |
| keepalive_secs | INTEGER | |
| connection_sharing | INTEGER NN | ControlMaster‑like |
| terminal_profile_id | TEXT FK→terminal_profiles.id | |
| startup_command | TEXT | run on connect |
| environment | TEXT (json) | env vars |
| color | TEXT | label |
| is_favorite | INTEGER NN | |
| is_pinned | INTEGER NN | |
| notes | TEXT | |
| last_connected_at | INTEGER | IX |
| connect_count | INTEGER NN | |
| created_at / updated_at | INTEGER NN | |
| deleted_at | INTEGER | soft delete |
Indexes: `IX(group_id)`, `IX(is_favorite)`, `IX(is_pinned)`, `IX(last_connected_at)`, FTS on `label,hostname,notes`.

**`identities`** — reusable auth identity (username + key/credential reference).
| id PK | name NN | username | ssh_key_id FK→ssh_keys.id | credential_id FK→credentials.id | agent_forwarding INT | created_at/updated_at |

**`proxies`** — SOCKS/HTTP proxy definitions.
| id PK | name NN | kind (`socks5`\|`http`) | host NN | port NN | username | credential_id FK | created_at/updated_at |

**`tags`** — `id PK | name NN unique | color`. **`host_tags`** — join `(host_id, tag_id)` PK.

**`port_forwards`** — per host tunnels.
| id PK | host_id FK NN | kind (`local`\|`remote`\|`dynamic`) | bind_addr | bind_port | dest_addr | dest_port | auto_start INT | label | created_at |

**`known_hosts`** — trusted host fingerprints.
| id PK | host NN | port NN | key_type NN | fingerprint_sha256 NN | first_seen_at | last_seen_at | IX(host,port) |

### 3.2 Vault / secrets context

**`vault`** — one row (singleton) describing the vault crypto params.
| id PK | kdf (`argon2id`) | kdf_salt BLOB NN | kdf_params (json: m,t,p) | verifier BLOB NN | wrapped_data_key BLOB NN | keychain_backed INT | biometric_enabled INT | auto_lock_secs INT | created_at/updated_at |

**`credentials`** — encrypted passwords/tokens.
| id PK | name NN | kind (`password`\|`token`\|`passphrase`) | ciphertext BLOB NN | nonce BLOB NN | aad TEXT | created_at/updated_at |

**`ssh_keys`** — key material (private encrypted, public plaintext).
| col | type | notes |
|---|---|---|
| id PK | | |
| name NN | | |
| key_type | TEXT NN | `ed25519`\|`rsa`\|`ecdsa`\|`ed25519-sk`\|`ecdsa-sk` |
| public_key | TEXT NN | OpenSSH pub |
| private_ciphertext | BLOB | encrypted priv (null for hardware‑only) |
| private_nonce | BLOB | |
| fingerprint_sha256 | TEXT NN IX | |
| comment | TEXT | |
| has_passphrase | INTEGER NN | |
| hardware_backed | INTEGER NN | FIDO2/YubiKey |
| source | TEXT | `generated`\|`imported`\|`agent` |
| created_at/updated_at | INTEGER NN | |

### 3.3 Sessions context

**`sessions`** — a live/historical connection session.
| id PK | host_id FK NN | started_at NN IX | ended_at | exit_reason | client_version | created_at |

**`session_panes`** — terminal panes within a session (split layout).
| id PK | session_id FK NN | kind (`shell`\|`sftp`\|`editor`\|`dashboard`) | layout_json | title | created_at |

**`recordings`** — session recordings (asciicast‑style).
| id PK | session_id FK NN | pane_id FK | path NN | format (`asciicast-v2`) | size_bytes | duration_ms | created_at |

**`command_history`** — executed commands (for palette/history/AI).
| id PK | host_id FK | command NN | cwd | exit_code | ran_at IX | duration_ms | FTS(command) |

### 3.4 Transfers context

**`transfer_jobs`** — an upload/download/sync job.
| id PK | host_id FK NN | kind (`upload`\|`download`\|`sync`) | source_root | dest_root | status (`queued`\|`running`\|`paused`\|`done`\|`error`\|`canceled`) | total_bytes | transferred_bytes | total_items | done_items | error | created_at | updated_at |

**`transfer_items`** — per‑file progress for resume.
| id PK | job_id FK NN | rel_path NN | size_bytes | transferred_bytes | status | checksum | mtime | created_at | updated_at |

**`sftp_bookmarks`** — `id PK | host_id FK | path NN | label | created_at`.

### 3.5 Monitoring context

**`host_snapshots`** — latest sampled snapshot (upsert, one recent row set per host, rolling).
| id PK | host_id FK NN | sampled_at NN IX | cpu_pct | mem_used | mem_total | swap_used | swap_total | load1/load5/load15 | uptime_secs | processes | net_rx_bps | net_tx_bps | temp_c | raw_json |

**`metric_series`** — down‑sampled time buckets for charts (ring‑buffered, capped rows/host).
| id PK | host_id FK NN | metric TEXT NN | bucket_start INTEGER NN | value REAL | IX(host_id, metric, bucket_start) |

**`disk_usage`** — per filesystem (latest).
| id PK | host_id FK NN | mount NN | fstype | size_bytes | used_bytes | sampled_at |

### 3.6 Containers context

**`docker_hosts`** — link a host to a docker endpoint. `id PK | host_id FK NN | socket_path | tls_json | created_at`.
Container/image/volume state is **not persisted** (queried live); only **saved compose files** and
**favorites** are stored:
**`compose_files`** — `id PK | host_id FK | path NN | name | content_cache | updated_at`.
**`k8s_contexts`** — `id PK | host_id FK | name NN | kubeconfig_ref | namespace | created_at`.

### 3.7 DataStores context

**`db_connections`** — DB client connection profiles (secrets in `credentials`).
| id PK | host_id FK (nullable, if tunneled) | engine (`mysql`\|`mariadb`\|`postgres`\|`redis`\|`mongodb`\|`sqlite`) | name NN | host | port | database | username | credential_id FK | ssl_json | tunnel_json | created_at/updated_at |

**`saved_queries`** — `id PK | db_connection_id FK NN | name NN | sql NN | created_at/updated_at`. FTS(name, sql).
**`query_history`** — `id PK | db_connection_id FK | sql NN | ran_at IX | duration_ms | row_count | error`.

### 3.8 Knowledge / productivity context

**`snippets`** — `id PK | name NN | body NN | language | tags_json | shortcut | usage_count | is_favorite INT | created_at/updated_at`. FTS(name, body).
**`notes`** — `id PK | host_id FK (nullable) | title NN | body_md NN | color | pinned INT | created_at/updated_at`. FTS(title, body_md).
**`templates`** — `id PK | name NN | kind (`nginx`\|`apache`\|`compose`\|`systemd`\|`custom`) | body NN | variables_json | created_at/updated_at`.

### 3.9 AI context

**`ai_providers`** — `id PK | kind (`openai`\|`anthropic`\|`ollama`\|`custom`) | name | base_url | model | credential_id FK | enabled INT | created_at/updated_at`.
**`ai_conversations`** — `id PK | host_id FK (nullable) | title | created_at/updated_at`.
**`ai_messages`** — `id PK | conversation_id FK NN | role (`user`\|`assistant`\|`system`\|`tool`) | content NN | tokens | created_at`.

### 3.10 Sync context

**`devices`** — `id PK | name NN | platform | public_key BLOB NN | last_seen_at | created_at` (paired devices for E2E sync).
**`sync_state`** — singleton `id PK | enabled INT | endpoint | account_id | last_pull_at | last_push_at | vector_clock_json | root_key_wrapped BLOB`.
**`sync_changes`** — outbox/inbox of encrypted change‑sets. `id PK | entity_type | entity_id | op (`upsert`\|`delete`) | ciphertext BLOB NN | nonce BLOB | rev INTEGER | acked INT | created_at | IX(acked, created_at)`.

### 3.11 Plugins context

**`plugins`** — `id PK | slug NN unique | name NN | version NN | source (`marketplace`\|`local`) | enabled INT | manifest_json NN | installed_at | updated_at`.
**`plugin_permissions`** — `id PK | plugin_id FK NN | capability NN | granted INT | granted_at` (capability e.g. `hosts.read`, `net.connect`, `fs.read`).

### 3.12 Cross-cutting

**`settings`** — key/value app settings. `key TEXT PK | value TEXT (json) | updated_at`.
**`terminal_profiles`** — `id PK | name NN | font_family | font_size | line_height | color_scheme_json | cursor_style | scrollback | bell | created_at/updated_at`.
**`themes`** — `id PK | name NN | kind (`app`\|`terminal`) | tokens_json NN | source | created_at`.
**`keybindings`** — `id PK | command NN | keys NN | when_context | created_at` (user overrides).
**`audit_log`** — security‑relevant events. `id PK | at INTEGER NN IX | actor | action NN | target | metadata_json | result`. Append‑only; never contains secret values.

## 4. Full‑text search (global search / command palette)

SQLite **FTS5** virtual tables mirror searchable columns via triggers:
`fts_hosts`, `fts_snippets`, `fts_notes`, `fts_commands`, `fts_queries`. A single
`SearchService` query (doc 05) unions them with ranking for the global palette.

## 5. Data lifecycle & limits (memory/disk hygiene)

- `metric_series` capped to N buckets/host (ring buffer via delete trigger) — see doc 23.
- `command_history`, `query_history`, `audit_log` retention configurable (default 90 days).
- Recordings stored as files on disk, only metadata in DB.
- Soft‑deleted hosts purged after 30 days (background task).

## 6. Migration list (initial)

```
0001_init.sql            groups, hosts, identities, proxies, tags, host_tags,
                         port_forwards, known_hosts, settings, terminal_profiles,
                         themes, keybindings
0002_vault.sql           vault, credentials, ssh_keys
0003_sessions.sql        sessions, session_panes, recordings, command_history
0004_transfers.sql       transfer_jobs, transfer_items, sftp_bookmarks
0005_monitoring.sql      host_snapshots, metric_series, disk_usage
0006_containers.sql      docker_hosts, compose_files, k8s_contexts
0007_datastores.sql      db_connections, saved_queries, query_history
0008_knowledge.sql       snippets, notes, templates
0009_ai.sql              ai_providers, ai_conversations, ai_messages
0010_sync.sql            devices, sync_state, sync_changes
0011_plugins.sql         plugins, plugin_permissions
0012_fts.sql             FTS5 tables + triggers
0013_audit.sql           audit_log
```
