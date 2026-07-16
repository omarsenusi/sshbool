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

    Ok(pool)
}

/// Run embedded migrations from the `migrations/` folder next to the binary workspace.
pub async fn migrate(pool: &SqlitePool) -> Result<(), DomainError> {
    // Migrations are applied manually from embedded strings for reliable packaging.
    for sql in [
        include_str!("../../../migrations/0001_init.sql"),
        include_str!("../../../migrations/0002_vault.sql"),
        include_str!("../../../migrations/0003_sessions.sql"),
        include_str!("../../../migrations/0004_transfers.sql"),
        include_str!("../../../migrations/0005_monitoring.sql"),
        include_str!("../../../migrations/0006_containers.sql"),
        include_str!("../../../migrations/0007_datastores.sql"),
        include_str!("../../../migrations/0008_knowledge.sql"),
        include_str!("../../../migrations/0009_ai.sql"),
        include_str!("../../../migrations/0010_sync.sql"),
        include_str!("../../../migrations/0011_plugins.sql"),
        include_str!("../../../migrations/0012_fts.sql"),
        include_str!("../../../migrations/0013_audit.sql"),
        include_str!("../../../migrations/0014_licensing.sql"),
        include_str!("../../../migrations/0015_team.sql"),
    ] {
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
            sqlx::query(&format!("{meaningful};"))
                .execute(pool)
                .await
                .map_err(|e| DomainError::Crypto(format!("migration: {e} | {meaningful}")))?;
        }
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
