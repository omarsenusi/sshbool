//! Team workspace client cache (Phase 4 stub).

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

#[tauri::command]
pub async fn team_status(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    let row: Option<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, team_id, team_name, role FROM team_memberships ORDER BY joined_at DESC LIMIT 1",
    )
    .fetch_optional(state.vault.pool())
    .await
    .map_err(db)?;
    let policy: Option<(String,)> = if let Some((_, tid, _, _)) = &row {
        sqlx::query_as("SELECT policy_json FROM team_policies WHERE team_id = ?")
            .bind(tid)
            .fetch_optional(state.vault.pool())
            .await
            .map_err(db)?
    } else {
        None
    };
    Ok(match row {
        Some((id, team_id, team_name, role)) => json!({
            "membershipId": id,
            "teamId": team_id,
            "teamName": team_name,
            "role": role,
            "policy": policy.and_then(|(p,)| serde_json::from_str::<Value>(&p).ok()),
        }),
        None => json!({ "membershipId": null, "teamId": null }),
    })
}

#[tauri::command]
pub async fn team_join_stub(
    state: State<'_, Arc<AppState>>,
    invite_code: String,
) -> Result<Value, AppError> {
    crate::commands::license::require_feature(&state, "team").await?;
    let team_id = format!("team-{}", invite_code.chars().take(8).collect::<String>());
    let id = Uuid::now_v7().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO team_memberships (id, team_id, team_name, role, invite_code, joined_at) VALUES (?, ?, ?, 'member', ?, ?)",
    )
    .bind(&id)
    .bind(&team_id)
    .bind(format!("Team {invite_code}"))
    .bind(&invite_code)
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;

    let default_policy = json!({
        "minLockTimeoutMinutes": 15,
        "requireFido2": false,
        "strictHostKeys": true
    });
    sqlx::query(
        "INSERT INTO team_policies (id, team_id, policy_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(team_id) DO UPDATE SET policy_json=excluded.policy_json, updated_at=excluded.updated_at",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(&team_id)
    .bind(default_policy.to_string())
    .bind(now)
    .execute(state.vault.pool())
    .await
    .map_err(db)?;

    // Apply local policy hooks into settings.
    team_apply_policy(state.clone(), team_id.clone()).await?;
    Ok(json!({ "membershipId": id, "teamId": team_id }))
}

#[tauri::command]
pub async fn team_list_shared(state: State<'_, Arc<AppState>>) -> Result<Vec<Value>, AppError> {
    let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, team_id, name, metadata_json FROM shared_directories ORDER BY name",
    )
    .fetch_all(state.vault.pool())
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(id, team_id, name, meta)| {
            json!({ "id": id, "teamId": team_id, "name": name, "metadata": meta })
        })
        .collect())
}

#[tauri::command]
pub async fn team_apply_policy(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<(), AppError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT policy_json FROM team_policies WHERE team_id = ?")
            .bind(&team_id)
            .fetch_optional(state.vault.pool())
            .await
            .map_err(db)?;
    let Some((policy_json,)) = row else {
        return Ok(());
    };
    let policy: Value = serde_json::from_str(&policy_json).unwrap_or(json!({}));
    let now = chrono::Utc::now().timestamp_millis();
    if let Some(mins) = policy["minLockTimeoutMinutes"].as_i64() {
        sqlx::query("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('security.lockTimeoutMinutes', ?, ?)")
            .bind(mins.to_string())
            .bind(now)
            .execute(state.vault.pool())
            .await
            .map_err(db)?;
    }
    if let Some(strict) = policy["strictHostKeys"].as_bool() {
        sqlx::query("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('security.strictHostKeys', ?, ?)")
            .bind(if strict { "true" } else { "false" })
            .bind(now)
            .execute(state.vault.pool())
            .await
            .map_err(db)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn retention_prune(
    state: State<'_, Arc<AppState>>,
    days: Option<u32>,
) -> Result<Value, AppError> {
    let days = days.unwrap_or(30) as i64;
    let cutoff = chrono::Utc::now().timestamp_millis() - days * 86_400_000;
    let a = sqlx::query("DELETE FROM metric_series WHERE bucket_start < ?")
        .bind(cutoff)
        .execute(state.vault.pool())
        .await
        .map_err(db)?
        .rows_affected();
    let b = sqlx::query("DELETE FROM audit_log WHERE at < ?")
        .bind(cutoff)
        .execute(state.vault.pool())
        .await
        .map_err(db)?
        .rows_affected();
    let c = sqlx::query("DELETE FROM query_history WHERE ran_at < ?")
        .bind(cutoff)
        .execute(state.vault.pool())
        .await
        .map_err(db)?
        .rows_affected();
    Ok(json!({
        "cutoff": cutoff,
        "deleted": { "metricSeries": a, "auditLog": b, "queryHistory": c }
    }))
}
