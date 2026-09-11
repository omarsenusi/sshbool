//! SQLite pool + migrations. Secrets columns are AEAD-encrypted with the vault DEK.
//! PRAGMA key is applied when unlocking for SQLCipher-compatible builds; stock SQLite ignores it.

use std::path::{Path, PathBuf};

use domain::DomainError;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

/// Open (or create) the app database and run migrations.
pub async fn open_pool(db_path: &Path) -> Result<SqlitePool, DomainError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| DomainError::Crypto(e.to_string()))?;
    }
    let url = format!("sqlite:{}?mode=rwc", db_path.display());
    let opts = SqliteConnectOptions::from_str(&url)
        .map_err(|e| DomainError::Crypto(e.to_string()))?
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| DomainError::Crypto(e.to_string()))?;

    // Apply SQLCipher key if the linked sqlite supports it (no-op otherwise).
    // Actual secret protection is AEAD at the application layer.
    sqlx::query("PRAGMA journal_mode = WAL;")
        .execute(&pool)
        .await
        .map_err(|e| DomainError::Crypto(e.to_string()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(parent) = db_path.parent() {
            if let Ok(meta) = std::fs::metadata(parent) {
                let mut perms = meta.permissions();
                perms.set_mode(0o700);
                let _ = std::fs::set_permissions(parent, perms);
            }
        }
        if let Ok(meta) = std::fs::metadata(db_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(db_path, perms);
        }
    }

    Ok(pool)
}

const EMBEDDED_MIGRATIONS: &[(&str, &str)] = &[
    (
        "0001_init",
        include_str!("../../../migrations/0001_init.sql"),
    ),
    (
        "0002_vault",
        include_str!("../../../migrations/0002_vault.sql"),
    ),
    (
        "0003_sessions",
        include_str!("../../../migrations/0003_sessions.sql"),
    ),
    (
        "0004_transfers",
        include_str!("../../../migrations/0004_transfers.sql"),
    ),
    (
        "0005_monitoring",
        include_str!("../../../migrations/0005_monitoring.sql"),
    ),
    (
        "0006_containers",
        include_str!("../../../migrations/0006_containers.sql"),
    ),
    (
        "0007_datastores",
        include_str!("../../../migrations/0007_datastores.sql"),
    ),
    (
        "0008_knowledge",
        include_str!("../../../migrations/0008_knowledge.sql"),
    ),
    ("0009_ai", include_str!("../../../migrations/0009_ai.sql")),
    (
        "0010_sync",
        include_str!("../../../migrations/0010_sync.sql"),
    ),
    (
        "0011_plugins",
        include_str!("../../../migrations/0011_plugins.sql"),
    ),
    ("0012_fts", include_str!("../../../migrations/0012_fts.sql")),
    (
        "0013_audit",
        include_str!("../../../migrations/0013_audit.sql"),
    ),
    (
        "0014_licensing",
        include_str!("../../../migrations/0014_licensing.sql"),
    ),
    (
        "0015_team",
        include_str!("../../../migrations/0015_team.sql"),
    ),
    (
        "0016_host_icon",
        include_str!("../../../migrations/0016_host_icon.sql"),
    ),
    (
        "0017_license_features",
        include_str!("../../../migrations/0017_license_features.sql"),
    ),
    (
        "0018_reset_unverified_known_hosts",
        include_str!("../../../migrations/0018_reset_unverified_known_hosts.sql"),
    ),
    ("0019_mcp", include_str!("../../../migrations/0019_mcp.sql")),
];

async fn ensure_migration_table(pool: &SqlitePool) -> Result<(), DomainError> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _schema_migrations (
            id TEXT PRIMARY KEY NOT NULL,
            applied_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| DomainError::Crypto(format!("migration table: {e}")))?;
    Ok(())
}

async fn migration_applied(pool: &SqlitePool, id: &str) -> Result<bool, DomainError> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM _schema_migrations WHERE id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| DomainError::Crypto(format!("migration lookup: {e}")))?;
    Ok(row.is_some())
}

async fn record_migration(pool: &SqlitePool, id: &str) -> Result<(), DomainError> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("INSERT OR IGNORE INTO _schema_migrations (id, applied_at) VALUES (?, ?)")
        .bind(id)
        .bind(now)
        .execute(pool)
        .await
        .map_err(|e| DomainError::Crypto(format!("migration record: {e}")))?;
    Ok(())
}

/// Backfill migration records for databases created before `_schema_migrations` existed.
async fn backfill_legacy_migrations(pool: &SqlitePool) -> Result<(), DomainError> {
    let applied_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM _schema_migrations")
        .fetch_one(pool)
        .await
        .map_err(|e| DomainError::Crypto(format!("migration count: {e}")))?;
    if applied_count.0 > 0 {
        return Ok(());
    }

    let hosts_table: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'hosts'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| DomainError::Crypto(format!("legacy schema probe: {e}")))?;

    if hosts_table.map(|(count,)| count > 0).unwrap_or(false) {
        for (id, _) in EMBEDDED_MIGRATIONS {
            record_migration(pool, id).await?;
        }
    }

    Ok(())
}

async fn run_migration_sql(pool: &SqlitePool, id: &str, sql: &str) -> Result<(), DomainError> {
    // Split on `;` and strip comment-only lines. Do NOT skip a whole chunk just because
    // it begins with a `--` header comment (that used to drop CREATE TABLE statements).
    for stmt in sql.split(';') {
        let meaningful = stmt
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        if meaningful.is_empty() {
            continue;
        }
        if let Err(e) = sqlx::query(&format!("{meaningful};")).execute(pool).await {
            let msg = e.to_string();
            // Re-runnable migrations: ignore already-applied schema tweaks.
            if !msg.contains("duplicate column name") {
                return Err(DomainError::Crypto(format!(
                    "migration {id}: {e} | {meaningful}"
                )));
            }
        }
    }
    Ok(())
}

/// Run embedded migrations from the `migrations/` folder next to the binary workspace.
pub async fn migrate(pool: &SqlitePool) -> Result<(), DomainError> {
    ensure_migration_table(pool).await?;
    backfill_legacy_migrations(pool).await?;

    for (id, sql) in EMBEDDED_MIGRATIONS {
        if migration_applied(pool, id).await? {
            continue;
        }
        run_migration_sql(pool, id, sql).await?;
        record_migration(pool, id).await?;
    }

    seed_builtin_templates(pool).await?;
    Ok(())
}

/// Built-in config templates (productivity). These are text snippets for remote files —
/// not related to any local nginx/docker process on the developer machine.
async fn seed_builtin_templates(pool: &SqlitePool) -> Result<(), DomainError> {
    let now = chrono::Utc::now().timestamp_millis();
    let seeds: &[(&str, &str, &str, &str, &str)] = &[
        (
            "tpl-nginx",
            "Nginx server block",
            "nginx",
            "server {\n  listen 80;\n  server_name {{server_name}};\n  root {{root}};\n  index index.html;\n}\n",
            r#"["server_name","root"]"#,
        ),
        (
            "tpl-compose",
            "Docker Compose web",
            "compose",
            "services:\n  web:\n    image: {{image}}\n    ports:\n      - \"{{port}}:80\"\n",
            r#"["image","port"]"#,
        ),
        (
            "tpl-systemd",
            "Systemd service",
            "systemd",
            "[Unit]\nDescription={{description}}\n\n[Service]\nExecStart={{exec}}\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n",
            r#"["description","exec"]"#,
        ),
    ];

    for (id, name, kind, body, vars) in seeds {
        sqlx::query(
            r#"INSERT OR IGNORE INTO templates (id, name, kind, body, variables_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(id)
        .bind(name)
        .bind(kind)
        .bind(body)
        .bind(vars)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .map_err(|e| DomainError::Crypto(format!("seed templates: {e}")))?;
    }
    Ok(())
}

/// Default DB path under app data dir.
pub fn default_db_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("com.abdug.sshbool").join("sshbool.db")
}
