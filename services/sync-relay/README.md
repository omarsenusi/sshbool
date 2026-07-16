# Sync relay stub (Phase 4)

Local ciphertext blob store for SSHBool client sync testing. Not a production multi-tenant service.

```bash
cd services/sync-relay
cargo run
# listens on http://127.0.0.1:8787
```

Endpoints: `GET /health`, `POST /v1/push`, `GET /v1/pull`, `POST /v1/devices`.
