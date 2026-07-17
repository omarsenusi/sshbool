//! Phase 3 commands: databases, k8s, devtools, sync, audit, plugins.

use infrastructure::AppState;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;

fn db(e: sqlx::Error) -> AppError {
    AppError::Db {
        engine: "sqlite".into(),
        message: e.to_string(),
    }
}

async fn audit(
    state: &AppState,
    action: &str,
    target: Option<&str>,
    result: &str,
    meta: Option<Value>,
) {
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let _ = sqlx::query(
        "INSERT INTO audit_log (id, at, actor, action, target, metadata_json, result) VALUES (?, ?, 'local', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(now)
    .bind(action)
    .bind(target)
    .bind(meta.map(|m| m.to_string()))
    .bind(result)
    .execute(state.vault.pool())
    .await;
}

// ── Database clients (remote CLI over SSH) ───────────────────────────

fn shell_escape_single_quoted(s: &str) -> String {
    s.replace('\'', "'\\''")
}

struct DbConn {
    ssh_host_id: String,
    engine: String,
    host: String,
    port: i64,
    database: String,
    username: String,
    password: Option<String>,
}

async fn load_credential_secret(
    state: &AppState,
    credential_id: &str,
) -> Result<Option<String>, AppError> {
    let row: Option<(Vec<u8>, Vec<u8>)> =
        sqlx::query_as("SELECT ciphertext, nonce FROM credentials WHERE id = ?")
            .bind(credential_id)
            .fetch_optional(state.vault.pool())
            .await
            .map_err(db)?;

    let Some((ct, nonce)) = row else {
        return Ok(None);
    };
    let plain = state
        .vault
        .open_secret(&ct, &nonce, &format!("cred:{credential_id}"))
        .await?;
    String::from_utf8(plain)
        .map_err(|e| AppError::Crypto {
            message: e.to_string(),
        })
        .map(Some)
}

async fn load_db_connection(state: &AppState, connection_id: &str) -> Result<DbConn, AppError> {
    let row: Option<(
        Option<String>,
        String,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT host_id, engine, host, port, database_name, username, credential_id FROM db_connections WHERE id = ?",
    )
    .bind(connection_id)
    .fetch_optional(state.vault.pool())
    .await
    .map_err(db)?;

    let Some((ssh_host_id, engine, host, port, database, username, credential_id)) = row else {
        return Err(AppError::NotFound {
            entity: "db_connection".into(),
            id: Some(connection_id.to_string()),
        });
    };

    let ssh_host = ssh_host_id.ok_or_else(|| AppError::Validation {
        field: "hostId".into(),
        message: "DB connection must be bound to an SSH host for remote CLI queries".into(),
    })?;

    let password = if let Some(cid) = credential_id {
        load_credential_secret(state, &cid).await?
    } else {
        None
    };

    Ok(DbConn {
        ssh_host_id: ssh_host,
        engine: engine.clone(),
        host: host.unwrap_or_else(|| "127.0.0.1".into()),
        port: port.unwrap_or({
            if matches!(engine.as_str(), "mysql" | "mariadb") {
                3306
            } else {
                5432
            }
        }),
        database: database.unwrap_or_default(),
        username: username.unwrap_or_else(|| {
            if matches!(engine.as_str(), "mysql" | "mariadb") {
                "root".into()
            } else {
                "postgres".into()
            }
        }),
        password,
    })
}

fn pg_env(password: &Option<String>) -> String {
    match password {
        Some(p) => format!("PGPASSWORD='{}' ", shell_escape_single_quoted(p)),
        None => "PGPASSWORD='' ".into(),
    }
}

fn mysql_auth(password: &Option<String>) -> String {
    match password {
        Some(p) => format!("-p'{}'", shell_escape_single_quoted(p)),
        None => String::new(),
    }
}

fn parse_tsv(out: &str) -> (Vec<String>, Vec<Vec<String>>) {
    let lines: Vec<&str> = out.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return (vec![], vec![]);
    }
    let headers = lines[0].split('\t').map(|s| s.to_string()).collect();
    let rows = lines[1..]
        .iter()
        .map(|l| l.split('\t').map(|s| s.to_string()).collect())
        .collect();
    (headers, rows)
}

fn looks_like_select(sql: &str) -> bool {
    let t = sql.trim().to_uppercase();
    t.starts_with("SELECT")
        || t.starts_with("WITH")
        || t.starts_with("SHOW")
        || t.starts_with("DESCRIBE")
        || t.starts_with("DESC ")
}

fn build_db_cmd(conn: &DbConn, sql: &str, structured: bool) -> Result<String, AppError> {
    let sql_escaped = shell_escape_single_quoted(sql);
    match conn.engine.as_str() {
        "postgres" | "postgresql" => {
            let env = pg_env(&conn.password);
            let fmt = if structured {
                "-A -F $'\\t' --pset footer=off"
            } else {
                ""
            };
            Ok(format!(
                "{env}psql -h {} -p {} -U {} -d {} {fmt} -c '{sql_escaped}' 2>&1",
                conn.host, conn.port, conn.username, conn.database
            ))
        }
        "mysql" | "mariadb" => {
            let auth = mysql_auth(&conn.password);
            let db_arg = if conn.database.is_empty() {
                String::new()
            } else {
                format!(" {}", conn.database)
            };
            let batch = if structured { "-B" } else { "" };
            Ok(format!(
                "mysql -h {} -P {} -u {} {auth}{db_arg} {batch} -e '{sql_escaped}' 2>&1",
                conn.host, conn.port, conn.username
            ))
        }
        "redis" => Ok(format!(
            "redis-cli -h {} -p {} {} 2>&1",
            conn.host, conn.port, sql
        )),
        "mongo" | "mongodb" => Ok(format!(
            "mongosh --quiet mongodb://{}:{}/{} --eval '{sql_escaped}' 2>&1",
            conn.host, conn.port, conn.database
        )),
        "sqlite" => Ok(format!("sqlite3 {} '{sql_escaped}' 2>&1", conn.database)),
        other => Err(AppError::Validation {
            field: "engine".into(),
            message: format!("unsupported engine: {other}"),
        }),
    }
}

async fn exec_db(
    state: &AppState,
    conn: &DbConn,
    sql: &str,
    structured: bool,
) -> Result<(String, Option<(Vec<String>, Vec<Vec<String>>)>, i64), AppError> {
    let cmd = build_db_cmd(conn, sql, structured)?;
    let started = chrono::Utc::now().timestamp_millis();
    let out = state
        .connections
        .exec_command(&conn.ssh_host_id, &cmd)
        .await?;
    let duration = chrono::Utc::now().timestamp_millis() - started;

    let lower = out.to_lowercase();
    let is_error = out.lines().any(|l| {
        let t = l.trim();
        t.starts_with("ERROR")
            || t.starts_with("error:")
            || t.contains("Access denied for user")
            || t.contains("FATAL:")
    });
    if is_error && !structured {
        return Err(AppError::Validation {
            field: "sql".into(),
            message: out.trim().to_string(),
        });
    }
    if is_error && structured && !out.lines().any(|l| l.contains('\t')) {
        return Err(AppError::Validation {
            field: "sql".into(),
            message: out.trim().to_string(),
        });
    }
    let _ = lower;

    let parsed = if structured {
        let (headers, rows) = parse_tsv(&out);
        if headers.is_empty() {
            None
        } else {
            Some((headers, rows))
        }
    } else {
        None
    };

    Ok((out, parsed, duration))
}

#[tauri::command]
pub async fn db_connections_list(state: State<'_, Arc<AppState>>) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(
        String,
        Option<String>,
        String,
        String,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT id, host_id, engine, name, host, port, database_name, username FROM db_connections ORDER BY name",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, host_id, engine, name, host, port, database_name, username)| {
                json!({
                    "id": id, "hostId": host_id, "engine": engine, "name": name,
                    "host": host, "port": port, "database": database_name, "username": username
                })
            },
        )
        .collect())
}

#[tauri::command]
pub async fn db_connections_upsert(
    state: State<'_, Arc<AppState>>,
    conn: Value,
) -> Result<String, AppError> {
    let id = conn["id"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO db_connections
        (id, host_id, engine, name, host, port, database_name, username, credential_id, ssl_json, tunnel_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET host_id=excluded.host_id, engine=excluded.engine, name=excluded.name,
          host=excluded.host, port=excluded.port, database_name=excluded.database_name,
          username=excluded.username, credential_id=excluded.credential_id, updated_at=excluded.updated_at"#,
    )
    .bind(&id)
    .bind(conn["hostId"].as_str())
    .bind(conn["engine"].as_str().unwrap_or("postgres"))
    .bind(conn["name"].as_str().unwrap_or("db"))
    .bind(conn["host"].as_str())
    .bind(conn["port"].as_i64())
    .bind(conn["database"].as_str())
    .bind(conn["username"].as_str())
    .bind(conn["credentialId"].as_str())
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    audit(&state, "db.connection.upsert", Some(&id), "ok", None).await;
    Ok(id)
}

#[tauri::command]
pub async fn db_connections_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM db_connections WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}

#[tauri::command]
pub async fn db_query(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    sql: String,
) -> Result<Value, AppError> {
    let conn = load_db_connection(&state, &connection_id).await?;
    let structured = looks_like_select(&sql)
        && matches!(
            conn.engine.as_str(),
            "postgres" | "postgresql" | "mysql" | "mariadb"
        );

    let (out, parsed, duration) = exec_db(&state, &conn, &sql, structured).await?;

    let row_count = parsed.as_ref().map(|(_, rows)| rows.len() as i64);
    let hid = Uuid::now_v7().to_string();
    let started = chrono::Utc::now().timestamp_millis() - duration;
    sqlx::query(
        "INSERT INTO query_history (id, db_connection_id, sql, ran_at, duration_ms, row_count, error) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(&hid)
    .bind(&connection_id)
    .bind(&sql)
    .bind(started)
    .bind(duration)
    .bind(row_count)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    audit(
        &state,
        "db.query",
        Some(&connection_id),
        "ok",
        Some(json!({ "ms": duration })),
    )
    .await;

    if let Some((columns, rows)) = parsed {
        Ok(json!({
            "durationMs": duration,
            "columns": columns,
            "rows": rows,
            "rowCount": rows.len(),
            "output": if out.trim().is_empty() { Value::Null } else { Value::String(out) }
        }))
    } else {
        Ok(json!({ "output": out, "durationMs": duration }))
    }
}

#[tauri::command]
pub async fn db_introspect(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
) -> Result<Value, AppError> {
    let conn = load_db_connection(&state, &connection_id).await?;

    let (tables_sql, columns_sql, pk_sql, fk_sql) = match conn.engine.as_str() {
        "postgres" | "postgresql" => (
            "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE' ORDER BY table_schema, table_name",
            "SELECT table_schema, table_name, column_name, data_type, is_nullable, COALESCE(column_default,'') FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name, ordinal_position",
            "SELECT kcu.table_schema, kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema WHERE tc.constraint_type='PRIMARY KEY'",
            "SELECT kcu.table_schema, kcu.table_name, kcu.column_name, ccu.table_name, ccu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema WHERE tc.constraint_type='FOREIGN KEY'",
        ),
        "mysql" | "mariadb" => (
            "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name",
            "SELECT table_schema, table_name, column_name, data_type, is_nullable, IFNULL(column_default,'') FROM information_schema.columns WHERE table_schema=DATABASE() ORDER BY table_name, ordinal_position",
            "SELECT kcu.table_schema, kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema=DATABASE()",
            "SELECT kcu.table_schema, kcu.table_name, kcu.column_name, kcu.referenced_table_name, kcu.referenced_column_name FROM information_schema.key_column_usage kcu WHERE kcu.table_schema=DATABASE() AND kcu.referenced_table_name IS NOT NULL",
        ),
        other => {
            return Err(AppError::Validation {
                field: "engine".into(),
                message: format!("introspection not supported for: {other}"),
            })
        }
    };

    let table_rows = exec_db(&state, &conn, tables_sql, true)
        .await?
        .1
        .map(|(_, r)| r)
        .unwrap_or_default();
    let col_rows = exec_db(&state, &conn, columns_sql, true)
        .await?
        .1
        .map(|(_, r)| r)
        .unwrap_or_default();
    let pk_rows = exec_db(&state, &conn, pk_sql, true)
        .await?
        .1
        .map(|(_, r)| r)
        .unwrap_or_default();
    let fk_rows = exec_db(&state, &conn, fk_sql, true)
        .await?
        .1
        .map(|(_, r)| r)
        .unwrap_or_default();

    let mut pk_set = std::collections::HashSet::new();
    for r in &pk_rows {
        if r.len() >= 3 {
            pk_set.insert(format!("{}|{}|{}", r[0], r[1], r[2]));
        }
    }

    let mut fk_map: std::collections::HashMap<String, Vec<Value>> =
        std::collections::HashMap::new();
    for r in &fk_rows {
        if r.len() >= 5 {
            let key = format!("{}|{}", r[0], r[1]);
            fk_map.entry(key).or_default().push(json!({
                "column": r[2],
                "refTable": r[3],
                "refColumn": r[4],
            }));
        }
    }

    let mut col_map: std::collections::HashMap<String, Vec<Value>> =
        std::collections::HashMap::new();
    for r in &col_rows {
        if r.len() >= 6 {
            let key = format!("{}|{}", r[0], r[1]);
            let pk_key = format!("{}|{}|{}", r[0], r[1], r[2]);
            col_map.entry(key).or_default().push(json!({
                "name": r[2],
                "dataType": r[3],
                "nullable": r[4] == "YES",
                "defaultValue": if r[5].is_empty() { Value::Null } else { Value::String(r[5].clone()) },
                "isPrimaryKey": pk_set.contains(&pk_key),
            }));
        }
    }

    let mut schema_map: std::collections::BTreeMap<String, Vec<Value>> =
        std::collections::BTreeMap::new();
    for r in &table_rows {
        if r.len() >= 2 {
            let schema = r[0].clone();
            let table = r[1].clone();
            let key = format!("{schema}|{table}");
            let fks = fk_map.remove(&key).unwrap_or_default();
            let columns = col_map.remove(&key).unwrap_or_default();
            schema_map.entry(schema.clone()).or_default().push(json!({
                "name": table,
                "schema": schema,
                "columns": columns,
                "foreignKeys": fks,
            }));
        }
    }

    let schemas: Vec<Value> = schema_map
        .into_iter()
        .map(|(name, tables)| json!({ "name": name, "tables": tables }))
        .collect();

    Ok(json!({ "schemas": schemas }))
}

#[tauri::command]
pub async fn db_table_preview(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    table: String,
    schema: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Value, AppError> {
    let conn = load_db_connection(&state, &connection_id).await?;
    let lim = limit.unwrap_or(100).clamp(1, 1000);
    let off = offset.unwrap_or(0).max(0);

    let sql = match conn.engine.as_str() {
        "postgres" | "postgresql" => {
            let sch = schema.as_deref().unwrap_or("public");
            let tbl = table.replace('"', "\"\"");
            let sch_esc = sch.replace('"', "\"\"");
            format!("SELECT * FROM \"{sch_esc}\".\"{tbl}\" LIMIT {lim} OFFSET {off}")
        }
        "mysql" | "mariadb" => {
            let tbl = table.replace('`', "``");
            format!("SELECT * FROM `{tbl}` LIMIT {lim} OFFSET {off}")
        }
        other => {
            return Err(AppError::Validation {
                field: "engine".into(),
                message: format!("preview not supported for: {other}"),
            })
        }
    };

    let (_, parsed, duration) = exec_db(&state, &conn, &sql, true).await?;
    let Some((columns, rows)) = parsed else {
        return Err(AppError::Validation {
            field: "table".into(),
            message: "no data returned".into(),
        });
    };

    Ok(json!({
        "columns": columns,
        "rows": rows,
        "rowCount": rows.len(),
        "durationMs": duration,
    }))
}

#[tauri::command]
pub async fn db_detect(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Value, AppError> {
    let script = r#"
check_port() {
    port_hex=$(printf "%04X" $1)
    if grep -E "[0-9A-F]{8}:${port_hex} " /proc/net/tcp >/dev/null 2>&1; then
        return 0
    fi
    if command -v ss >/dev/null 2>&1; then
        ss -tln | grep -q ":$1 " && return 0
    fi
    if command -v netstat >/dev/null 2>&1; then
        netstat -tln | grep -q ":$1 " && return 0
    fi
    return 1
}

# 1. Postgres (5432)
if check_port 5432 || command -v psql >/dev/null 2>&1; then
    dbs=""
    if command -v psql >/dev/null 2>&1; then
        dbs=$(psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false;" 2>/dev/null)
        if [ -z "$dbs" ]; then
            dbs=$(psql -U postgres -d postgres -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false;" 2>/dev/null)
        fi
    fi
    if [ -z "$dbs" ]; then
        dbs="postgres"
    fi
    echo "postgres:127.0.0.1:5432:postgres:$(echo "$dbs" | tr '\n' ',' | sed 's/,$//')"
fi

# 2. MySQL / MariaDB (3306)
if check_port 3306 || command -v mysql >/dev/null 2>&1; then
    dbs=""
    if command -v mysql >/dev/null 2>&1; then
        dbs=$(mysql -h 127.0.0.1 -P 3306 -u root -e "SHOW DATABASES;" -B -N 2>/dev/null)
        if [ -z "$dbs" ]; then
            dbs=$(mysql -u root -e "SHOW DATABASES;" -B -N 2>/dev/null)
        fi
    fi
    if [ -z "$dbs" ]; then
        dbs="mysql"
    fi
    echo "mysql:127.0.0.1:3306:root:$(echo "$dbs" | tr '\n' ',' | sed 's/,$//')"
fi

# 3. Redis (6379)
if check_port 6379 || command -v redis-cli >/dev/null 2>&1; then
    dbs=""
    if command -v redis-cli >/dev/null 2>&1; then
        dbs=$(redis-cli -h 127.0.0.1 -p 6379 info keyspace 2>/dev/null | grep -E '^db[0-9]+:' | cut -d: -f1)
    fi
    if [ -z "$dbs" ]; then
        dbs="db0"
    fi
    echo "redis:127.0.0.1:6379::$(echo "$dbs" | tr '\n' ',' | sed 's/,$//')"
fi

# 4. MongoDB (27017)
if check_port 27017 || command -v mongosh >/dev/null 2>&1 || command -v mongo >/dev/null 2>&1; then
    dbs=""
    if command -v mongosh >/dev/null 2>&1; then
        dbs=$(mongosh --quiet --eval "db.adminCommand('listDatabases').databases.map(d => d.name).join(',')" 2>/dev/null)
    elif command -v mongo >/dev/null 2>&1; then
        dbs=$(mongo --quiet --eval "db.adminCommand('listDatabases').databases.map(d => d.name).join(',')" 2>/dev/null)
    fi
    if [ -z "$dbs" ]; then
        dbs="admin"
    fi
    echo "mongodb:127.0.0.1:27017:root:$(echo "$dbs" | tr '\n' ',' | sed 's/,$//')"
fi
"#;

    let out = state.connections.exec_command(&host_id, script).await?;
    let mut detected = Vec::new();

    for line in out.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 5 {
            let engine = parts[0].to_string();
            let host = parts[1].to_string();
            let port = parts[2].parse::<i64>().unwrap_or(0);
            let username = parts[3].to_string();
            let databases: Vec<String> = parts[4]
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            detected.push(json!({
                "engine": engine,
                "host": host,
                "port": port,
                "username": username,
                "databases": databases,
            }));
        }
    }

    Ok(Value::Array(detected))
}

#[tauri::command]
pub async fn saved_queries_list(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, name, sql FROM saved_queries WHERE db_connection_id = ? ORDER BY name",
    )
    .bind(&connection_id)
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, name, sql)| json!({ "id": id, "name": name, "sql": sql }))
        .collect())
}

#[tauri::command]
pub async fn saved_queries_upsert(
    state: State<'_, Arc<AppState>>,
    query: Value,
) -> Result<String, AppError> {
    let id = query["id"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO saved_queries (id, db_connection_id, name, sql, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, sql=excluded.sql, updated_at=excluded.updated_at"#,
    )
    .bind(&id)
    .bind(query["connectionId"].as_str().unwrap_or(""))
    .bind(query["name"].as_str().unwrap_or("query"))
    .bind(query["sql"].as_str().unwrap_or(""))
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(id)
}

// ── Kubernetes (kubectl over SSH) ────────────────────────────────────

#[tauri::command]
pub async fn k8s_contexts_list(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Vec<Value>, AppError> {
    let out = state
        .connections
        .exec_command(&host_id, "kubectl config get-contexts -o name 2>&1")
        .await?;
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.contains("error"))
        .map(|name| json!({ "name": name.trim() }))
        .collect())
}

#[tauri::command]
pub async fn k8s_get_pods(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    namespace: Option<String>,
) -> Result<Vec<Value>, AppError> {
    let ns = namespace.unwrap_or_else(|| "default".into());
    let out = state
        .connections
        .exec_command(
            &host_id,
            &format!(
                "kubectl get pods -n {ns} -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,READY:.status.containerStatuses[*].ready,RESTARTS:.status.containerStatuses[*].restartCount,AGE:.metadata.creationTimestamp --no-headers 2>&1"
            ),
        )
        .await?;
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.len() < 2 {
                return None;
            }
            Some(json!({
                "name": p[0], "status": p[1],
                "ready": p.get(2).copied().unwrap_or(""),
                "restarts": p.get(3).copied().unwrap_or(""),
                "age": p.get(4).copied().unwrap_or(""),
            }))
        })
        .collect())
}

#[tauri::command]
pub async fn k8s_get_deployments(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    namespace: Option<String>,
) -> Result<Vec<Value>, AppError> {
    let ns = namespace.unwrap_or_else(|| "default".into());
    let out = state
        .connections
        .exec_command(
            &host_id,
            &format!("kubectl get deploy -n {ns} --no-headers 2>&1"),
        )
        .await?;
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.is_empty() {
                return None;
            }
            Some(json!({
                "name": p[0],
                "ready": p.get(1).copied().unwrap_or(""),
                "upToDate": p.get(2).copied().unwrap_or(""),
                "available": p.get(3).copied().unwrap_or(""),
                "age": p.get(4).copied().unwrap_or(""),
            }))
        })
        .collect())
}

#[tauri::command]
pub async fn k8s_logs(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    namespace: String,
    pod: String,
    tail: Option<u32>,
) -> Result<String, AppError> {
    let n = tail.unwrap_or(100);
    state
        .connections
        .exec_command(
            &host_id,
            &format!("kubectl logs -n {namespace} {pod} --tail={n} 2>&1"),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn k8s_apply(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    manifest: String,
) -> Result<String, AppError> {
    let escaped = manifest.replace('\'', "'\\''");
    let out = state
        .connections
        .exec_command(
            &host_id,
            &format!("printf '%s' '{escaped}' | kubectl apply -f - 2>&1"),
        )
        .await?;
    audit(&state, "k8s.apply", Some(&host_id), "ok", None).await;
    Ok(out)
}

// ── Dev Tools ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn devtools_probe(
    state: State<'_, Arc<AppState>>,
    host_id: String,
) -> Result<Value, AppError> {
    let out = state
        .connections
        .exec_command(
            &host_id,
            r#"
echo '---GIT---'; git --version 2>&1
echo '---NODE---'; node -v 2>&1; npm -v 2>&1
echo '---PYTHON---'; python3 --version 2>&1
echo '---PHP---'; php -v 2>&1 | head -n1
echo '---GO---'; go version 2>&1
echo '---RUST---'; rustc --version 2>&1
echo '---DOCKER---'; docker --version 2>&1
echo '---KUBECTL---'; kubectl version --client --short 2>&1
echo '---ADB---'; adb version 2>&1 | head -n1
echo '---FLUTTER---'; flutter --version 2>&1 | head -n1
"#,
        )
        .await?;
    let mut map = serde_json::Map::new();
    let mut section = String::new();
    for line in out.lines() {
        if let Some(name) = line.strip_prefix("---").and_then(|s| s.strip_suffix("---")) {
            section = name.to_lowercase();
            continue;
        }
        if section.is_empty() || line.trim().is_empty() {
            continue;
        }
        let entry = map
            .entry(section.clone())
            .or_insert_with(|| Value::String(String::new()));
        if let Value::String(s) = entry {
            if !s.is_empty() {
                s.push('\n');
            }
            s.push_str(line.trim());
        }
    }
    Ok(Value::Object(map))
}

#[tauri::command]
pub async fn devtools_git_status(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    path: String,
) -> Result<String, AppError> {
    state
        .connections
        .exec_command(
            &host_id,
            &format!("cd {path} && git status -sb && git remote -v 2>&1"),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn devtools_run(
    state: State<'_, Arc<AppState>>,
    host_id: String,
    command: String,
) -> Result<String, AppError> {
    // Allowlisted diagnostic helpers only.
    let allowed = [
        "ping -c 3",
        "dig +short",
        "curl -I",
        "nslookup",
        "traceroute",
    ];
    if !allowed.iter().any(|p| command.starts_with(p)) {
        return Err(AppError::Validation {
            field: "command".into(),
            message: format!("allowed prefixes: {}", allowed.join(", ")),
        });
    }
    state
        .connections
        .exec_command(&host_id, &command)
        .await
        .map_err(Into::into)
}

// ── Cloud Sync (E2E local device pairing stub + encrypted export) ────

#[tauri::command]
pub async fn sync_status(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let row: Option<(
        i64,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
    )> = sqlx::query_as(
        "SELECT enabled, endpoint, account_id, last_pull_at, last_push_at FROM sync_state LIMIT 1",
    )
    .fetch_optional(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(match row {
        Some((enabled, endpoint, account_id, last_pull, last_push)) => json!({
            "enabled": enabled != 0,
            "endpoint": endpoint,
            "accountId": account_id,
            "lastPullAt": last_pull,
            "lastPushAt": last_push,
        }),
        None => json!({ "enabled": false, "endpoint": null, "accountId": null }),
    })
}

#[tauri::command]
pub async fn sync_configure(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
    endpoint: Option<String>,
) -> Result<(), AppError> {
    if enabled {
        crate::commands::license::require_feature(&state, "sync").await?;
    }
    let now = chrono::Utc::now().timestamp_millis();
    let existing: Option<(String,)> = sqlx::query_as("SELECT id FROM sync_state LIMIT 1")
        .fetch_optional(state.vault.pool())
        .await
        .map_err(db)?;
    if let Some((id,)) = existing {
        sqlx::query("UPDATE sync_state SET enabled = ?, endpoint = ? WHERE id = ?")
            .bind(if enabled { 1 } else { 0 })
            .bind(&endpoint)
            .bind(&id)
            .execute(state.vault.pool())
            .await
            .map_err(db)?;
    } else {
        let id = Uuid::now_v7().to_string();
        sqlx::query(
            "INSERT INTO sync_state (id, enabled, endpoint, account_id, last_pull_at, last_push_at, vector_clock_json, root_key_wrapped) VALUES (?, ?, ?, NULL, NULL, NULL, '{}', NULL)",
        )
        .bind(&id)
        .bind(if enabled { 1 } else { 0 })
        .bind(&endpoint)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
        let _ = now;
    }
    audit(
        &state,
        "sync.configure",
        None,
        "ok",
        Some(json!({ "enabled": enabled })),
    )
    .await;
    Ok(())
}

#[tauri::command]
pub async fn sync_enable(
    state: State<'_, Arc<AppState>>,
    endpoint: String,
) -> Result<(), AppError> {
    sync_configure(state, true, Some(endpoint)).await
}

#[tauri::command]
pub async fn sync_disable(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    sync_configure(state, false, None).await
}

#[tauri::command]
pub async fn sync_push(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    crate::commands::license::require_feature(&state, "sync").await?;
    let bundle = sync_export_bundle(state.clone()).await?;
    let endpoint: Option<(Option<String>,)> =
        sqlx::query_as("SELECT endpoint FROM sync_state LIMIT 1")
            .fetch_optional(state.vault.pool())
            .await
            .map_err(db)?;
    let base = endpoint
        .and_then(|e| e.0)
        .unwrap_or_else(|| "http://127.0.0.1:8787".into());
    let client = reqwest::Client::new();
    let url = format!("{}/v1/push", base.trim_end_matches('/'));
    let res = client
        .post(&url)
        .json(&bundle)
        .send()
        .await
        .map_err(|e| AppError::Connection {
            message: format!("sync push: {e}"),
            retryable: true,
        })?;
    let status = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(json!({ "ok": true }));
    let now = chrono::Utc::now().timestamp_millis();
    let _ = sqlx::query("UPDATE sync_state SET last_push_at = ?")
        .bind(now)
        .execute(state.vault.pool())
        .await;
    let _ = sqlx::query("UPDATE sync_changes SET acked = 1 WHERE acked = 0")
        .execute(state.vault.pool())
        .await;
    audit(
        &state,
        "sync.push",
        None,
        "ok",
        Some(json!({ "http": status })),
    )
    .await;
    Ok(json!({ "pushed": 1, "relay": body, "httpStatus": status }))
}

#[tauri::command]
pub async fn sync_pull(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    crate::commands::license::require_feature(&state, "sync").await?;
    let endpoint: Option<(Option<String>,)> =
        sqlx::query_as("SELECT endpoint FROM sync_state LIMIT 1")
            .fetch_optional(state.vault.pool())
            .await
            .map_err(db)?;
    let base = endpoint
        .and_then(|e| e.0)
        .unwrap_or_else(|| "http://127.0.0.1:8787".into());
    let client = reqwest::Client::new();
    let url = format!("{}/v1/pull", base.trim_end_matches('/'));
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Connection {
            message: format!("sync pull: {e}"),
            retryable: true,
        })?;
    let body: Value = res.json().await.map_err(|e| AppError::Internal {
        message: e.to_string(),
    })?;
    let now = chrono::Utc::now().timestamp_millis();
    let _ = sqlx::query("UPDATE sync_state SET last_pull_at = ?")
        .bind(now)
        .execute(state.vault.pool())
        .await;
    // LWW: store remote blob as sync_changes if present
    let mut pulled = 0;
    if let Some(items) = body["items"].as_array() {
        for item in items {
            let id = Uuid::now_v7().to_string();
            let ct = item["ciphertextB64"]
                .as_str()
                .and_then(|s| {
                    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s).ok()
                })
                .unwrap_or_default();
            let nonce = item["nonceB64"]
                .as_str()
                .and_then(|s| {
                    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s).ok()
                })
                .unwrap_or_default();
            if ct.is_empty() {
                continue;
            }
            let _ = sqlx::query(
                "INSERT INTO sync_changes (id, entity_type, entity_id, op, ciphertext, nonce, rev, acked, created_at) VALUES (?, 'bundle', 'remote', 'pull', ?, ?, 1, 1, ?)",
            )
            .bind(&id)
            .bind(&ct)
            .bind(&nonce)
            .bind(now)
            .execute(state.vault.pool())
            .await;
            pulled += 1;
        }
    }
    audit(
        &state,
        "sync.pull",
        None,
        "ok",
        Some(json!({ "pulled": pulled })),
    )
    .await;
    Ok(json!({ "pulled": pulled, "conflicts": 0 }))
}

#[tauri::command]
pub async fn sync_unpair(
    state: State<'_, Arc<AppState>>,
    device_id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM devices WHERE id = ?")
        .bind(&device_id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    audit(&state, "sync.unpair", Some(&device_id), "ok", None).await;
    Ok(())
}

#[tauri::command]
pub async fn sync_resolve_conflict(
    _state: State<'_, Arc<AppState>>,
    entity: String,
    choice: String,
) -> Result<(), AppError> {
    // LWW stub — accept local|remote choice without further action in v1.
    if !matches!(choice.as_str(), "local" | "remote") {
        return Err(AppError::Validation {
            field: "choice".into(),
            message: "local|remote".into(),
        });
    }
    let _ = entity;
    Ok(())
}

#[tauri::command]
pub async fn sync_export_bundle(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    // Export host metadata (no secrets) + queue encrypted change for multi-device sync.
    let hosts: Vec<(String, String, String, i64)> =
        sqlx::query_as("SELECT id, label, hostname, port FROM hosts WHERE deleted_at IS NULL")
            .fetch_all(state.vault.pool())
            .await
            .map_err(db)?;
    let payload = json!({ "hosts": hosts.iter().map(|(id, label, hostname, port)| {
        json!({ "id": id, "label": label, "hostname": hostname, "port": port })
    }).collect::<Vec<_>>(), "exportedAt": chrono::Utc::now().timestamp_millis() });
    let plain = payload.to_string();
    let (ct, nonce) = state
        .vault
        .seal_secret(plain.as_bytes(), "sync:bundle")
        .await?;
    let change_id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO sync_changes (id, entity_type, entity_id, op, ciphertext, nonce, rev, acked, created_at) VALUES (?, 'bundle', 'hosts', 'export', ?, ?, 1, 0, ?)",
    )
    .bind(&change_id)
    .bind(&ct)
    .bind(&nonce)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    sqlx::query("UPDATE sync_state SET last_push_at = ?")
        .bind(now)
        .execute(state.vault.pool())
        .await
        .ok();
    Ok(json!({
        "changeId": change_id,
        "ciphertextB64": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &ct),
        "nonceB64": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &nonce),
    }))
}

#[tauri::command]
pub async fn sync_pair_device(
    state: State<'_, Arc<AppState>>,
    name: String,
    public_key_b64: String,
) -> Result<String, AppError> {
    use base64::Engine;
    let pk = base64::engine::general_purpose::STANDARD
        .decode(public_key_b64.as_bytes())
        .map_err(|e| AppError::Validation {
            field: "publicKeyB64".into(),
            message: e.to_string(),
        })?;
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO devices (id, name, platform, public_key, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(std::env::consts::OS)
    .bind(&pk)
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;
    audit(&state, "sync.pair", Some(&id), "ok", None).await;
    Ok(id)
}

#[tauri::command]
pub async fn sync_devices_list(state: State<'_, Arc<AppState>>) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT id, name, platform, last_seen_at FROM devices ORDER BY created_at DESC",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, name, platform, last_seen)| {
            json!({ "id": id, "name": name, "platform": platform, "lastSeenAt": last_seen })
        })
        .collect())
}

// ── Audit ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn audit_list(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<Value>, AppError> {
    let lim = limit.unwrap_or(100) as i64;
    let rows: Vec<(
        String,
        i64,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT id, at, actor, action, target, metadata_json, result FROM audit_log ORDER BY at DESC LIMIT ?",
    )
    .bind(lim)
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, at, actor, action, target, meta, result)| {
            json!({
                "id": id, "at": at, "actor": actor, "action": action,
                "target": target, "metadata": meta, "result": result
            })
        })
        .collect())
}

#[tauri::command]
pub async fn audit_export(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    let rows = audit_list(state, Some(10_000)).await?;
    Ok(serde_json::to_string_pretty(&rows).unwrap_or_default())
}

// ── Plugin SDK v1 ────────────────────────────────────────────────────

#[tauri::command]
pub async fn plugins_list(state: State<'_, Arc<AppState>>) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(String, String, String, String, String, i64)> = sqlx::query_as(
        "SELECT id, slug, name, version, source, enabled FROM plugins ORDER BY name",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, slug, name, version, source, enabled)| {
            json!({
                "id": id, "slug": slug, "name": name, "version": version,
                "source": source, "enabled": enabled != 0
            })
        })
        .collect())
}

#[tauri::command]
pub async fn plugins_install(
    state: State<'_, Arc<AppState>>,
    manifest: Value,
) -> Result<String, AppError> {
    if manifest["paid"].as_bool().unwrap_or(false) {
        crate::commands::license::require_feature(&state, "marketplace_paid").await?;
    }
    let slug = manifest["slug"]
        .as_str()
        .ok_or_else(|| AppError::Validation {
            field: "slug".into(),
            message: "required".into(),
        })?
        .to_string();
    let name = manifest["name"].as_str().unwrap_or(&slug).to_string();
    let version = manifest["version"].as_str().unwrap_or("0.1.0").to_string();
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"INSERT INTO plugins (id, slug, name, version, source, enabled, manifest_json, installed_at, updated_at)
           VALUES (?, ?, ?, ?, 'local', 0, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET name=excluded.name, version=excluded.version,
             manifest_json=excluded.manifest_json, updated_at=excluded.updated_at"#,
    )
    .bind(&id)
    .bind(&slug)
    .bind(&name)
    .bind(&version)
    .bind(manifest.to_string())
    .bind(now)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;

    if let Some(caps) = manifest["permissions"].as_array() {
        let plugin_id: (String,) = sqlx::query_as("SELECT id FROM plugins WHERE slug = ?")
            .bind(&slug)
            .fetch_one(state.vault.pool())
            .await
            .map_err(db)?;
        for cap in caps {
            if let Some(c) = cap.as_str() {
                let pid = Uuid::now_v7().to_string();
                let _ = sqlx::query(
                    "INSERT INTO plugin_permissions (id, plugin_id, capability, granted, granted_at) VALUES (?, ?, ?, 0, NULL)",
                )
                .bind(&pid)
                .bind(&plugin_id.0)
                .bind(c)
                .execute(state.vault.pool())
                .await;
            }
        }
        audit(&state, "plugin.install", Some(&slug), "ok", None).await;
        return Ok(plugin_id.0);
    }
    audit(&state, "plugin.install", Some(&slug), "ok", None).await;
    Ok(id)
}

#[tauri::command]
pub async fn plugins_search_marketplace(
    _state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<Vec<Value>, AppError> {
    let catalog = vec![
        json!({
            "slug": "sample-theme",
            "name": "Sample Theme",
            "version": "0.1.0",
            "description": "Free bundled theme sample",
            "paid": false,
            "permissions": ["ui.theme"]
        }),
        json!({
            "slug": "ops-snippets-pack",
            "name": "Ops Snippets Pack",
            "version": "1.0.0",
            "description": "Paid curated sysadmin snippets",
            "paid": true,
            "permissions": ["snippets.write"]
        }),
        json!({
            "slug": "nginx-wizard",
            "name": "Nginx Wizard",
            "version": "0.2.0",
            "description": "Config helpers for nginx",
            "paid": false,
            "permissions": ["templates.read"]
        }),
    ];
    let q = query.to_lowercase();
    Ok(catalog
        .into_iter()
        .filter(|item| {
            if q.is_empty() {
                return true;
            }
            item["name"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(&q)
                || item["slug"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&q)
        })
        .collect())
}

#[tauri::command]
pub async fn plugins_set_enabled(
    state: State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<(), AppError> {
    sqlx::query("UPDATE plugins SET enabled = ?, updated_at = ? WHERE id = ?")
        .bind(if enabled { 1 } else { 0 })
        .bind(chrono::Utc::now().timestamp_millis())
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    // Enabling requires all permissions granted — soft check.
    if enabled {
        let pending: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM plugin_permissions WHERE plugin_id = ? AND granted = 0",
        )
        .bind(&id)
        .fetch_one(state.vault.pool())
        .await
        .unwrap_or((0,));
        if pending.0 > 0 {
            // Auto-grant for v1 local plugins (marketplace will require explicit grant).
            sqlx::query(
                "UPDATE plugin_permissions SET granted = 1, granted_at = ? WHERE plugin_id = ?",
            )
            .bind(chrono::Utc::now().timestamp_millis())
            .bind(&id)
            .execute(state.vault.pool())
            .await
            .map_err(db)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn plugins_uninstall(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM plugins WHERE id = ?")
        .bind(&id)
        .execute(state.vault.pool())
        .await
        .map_err(db)?;
    Ok(())
}
