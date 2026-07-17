//! SSHBool Tauri application crate.

mod commands;
mod container;
mod error;
mod events;

use std::sync::Arc;

use infrastructure::AppState;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("sshbool=info".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let state = AppState::bootstrap()
                    .await
                    .map_err(|e| format!("bootstrap failed: {e}"))?;
                handle.manage(state);
                Ok::<(), String>(())
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault::vault_status,
            commands::vault::vault_init,
            commands::vault::vault_unlock,
            commands::vault::vault_lock,
            commands::vault::vault_backup,
            commands::vault::vault_restore,
            commands::vault::keys_list,
            commands::vault::keys_generate,
            commands::vault::keys_import,
            commands::vault::keys_import_file,
            commands::vault::keys_export_public,
            commands::vault::keys_export_private,
            commands::vault::keys_export_private_file,
            commands::vault::keys_rename,
            commands::vault::keys_delete,
            commands::vault::keys_copy_public,
            commands::vault::credentials_list,
            commands::vault::credentials_create,
            commands::vault::credentials_delete,
            commands::hosts::hosts_list_tree,
            commands::hosts::hosts_get,
            commands::hosts::hosts_create,
            commands::hosts::hosts_update,
            commands::hosts::hosts_delete,
            commands::hosts::hosts_toggle_favorite,
            commands::hosts::hosts_toggle_pin,
            commands::hosts::hosts_search,
            commands::hosts::hosts_list_recent,
            commands::hosts::hosts_import,
            commands::hosts::hosts_import_commit,
            commands::hosts::hosts_export,
            commands::hosts::groups_create,
            commands::hosts::groups_rename,
            commands::hosts::groups_delete,
            commands::hosts::tags_list,
            commands::hosts::tags_add,
            commands::hosts::tags_remove,
            commands::hosts::known_hosts_list,
            commands::hosts::known_hosts_trust,
            commands::hosts::session_open,
            commands::hosts::session_close,
            commands::sessions::pane_open,
            commands::sessions::pane_close,
            commands::sessions::pane_resize,
            commands::sessions::pane_write,
            commands::sessions::pane_scrollback,
            commands::sessions::sessions_list,
            commands::sessions::command_history_search,
            commands::transfers::sftp_list_dir,
            commands::transfers::sftp_stat,
            commands::transfers::sftp_mkdir,
            commands::transfers::sftp_rename,
            commands::transfers::sftp_delete,
            commands::transfers::sftp_copy,
            commands::transfers::sftp_chmod,
            commands::transfers::sftp_read,
            commands::transfers::sftp_write,
            commands::transfers::local_home,
            commands::transfers::local_list_dir,
            commands::transfers::local_mkdir,
            commands::transfers::local_rename,
            commands::transfers::local_delete,
            commands::transfers::transfer_upload,
            commands::transfers::transfer_upload_many,
            commands::transfers::transfer_download,
            commands::transfers::transfers_list,
            commands::transfers::transfer_pause,
            commands::transfers::transfer_resume,
            commands::transfers::transfer_cancel,
            commands::productivity::snippets_list,
            commands::productivity::snippets_upsert,
            commands::productivity::snippets_delete,
            commands::productivity::snippets_run,
            commands::productivity::notes_list,
            commands::productivity::notes_upsert,
            commands::productivity::notes_delete,
            commands::productivity::templates_list,
            commands::productivity::templates_render,
            commands::productivity::search_global,
            commands::productivity::settings_get,
            commands::productivity::settings_set,
            commands::productivity::keybindings_list,
            commands::productivity::keybindings_set,
            commands::productivity::app_info,
            commands::phase2::proxies_list,
            commands::phase2::proxies_upsert,
            commands::phase2::port_forwards_upsert,
            commands::phase2::port_forwards_delete,
            commands::phase2::port_forwards_list,
            commands::phase2::port_forwards_start,
            commands::phase2::port_forwards_stop,
            commands::monitoring::monitoring_start,
            commands::monitoring::monitoring_stop,
            commands::monitoring::monitoring_snapshot,
            commands::monitoring::monitoring_series,
            commands::monitoring::processes_list,
            commands::monitoring::process_kill,
            commands::monitoring::services_list,
            commands::monitoring::service_control,
            commands::phase2::docker_list_containers,
            commands::phase2::docker_container_action,
            commands::phase2::docker_list_images,
            commands::phase2::docker_logs,
            commands::phase2::docker_compose_action,
            commands::phase2::ai_providers_list,
            commands::phase2::ai_providers_upsert,
            commands::phase2::ai_send,
            commands::phase2::ai_explain_command,
            commands::phase2::ai_generate_command,
            commands::phase2::recording_start,
            commands::phase2::recording_stop,
            commands::phase2::folders_compare,
            commands::phase2::auth_fido2_status,
            commands::phase2::editor_git_status,
            commands::phase2::editor_diff,
            commands::phase3::db_connections_list,
            commands::phase3::db_connections_upsert,
            commands::phase3::db_connections_delete,
            commands::phase3::db_query,
            commands::phase3::db_introspect,
            commands::phase3::db_table_preview,
            commands::phase3::db_detect,
            commands::phase3::saved_queries_list,
            commands::phase3::saved_queries_upsert,
            commands::phase3::k8s_contexts_list,
            commands::phase3::k8s_get_pods,
            commands::phase3::k8s_get_deployments,
            commands::phase3::k8s_logs,
            commands::phase3::k8s_apply,
            commands::phase3::devtools_probe,
            commands::phase3::devtools_git_status,
            commands::phase3::devtools_run,
            commands::phase3::sync_status,
            commands::phase3::sync_configure,
            commands::phase3::sync_export_bundle,
            commands::phase3::sync_pair_device,
            commands::phase3::sync_devices_list,
            commands::phase3::audit_list,
            commands::phase3::audit_export,
            commands::phase3::plugins_list,
            commands::phase3::plugins_install,
            commands::phase3::plugins_set_enabled,
            commands::phase3::plugins_uninstall,
            commands::phase3::sync_enable,
            commands::phase3::sync_disable,
            commands::phase3::sync_push,
            commands::phase3::sync_pull,
            commands::phase3::sync_unpair,
            commands::phase3::sync_resolve_conflict,
            commands::phase3::plugins_search_marketplace,
            commands::license::license_status,
            commands::license::license_activate,
            commands::license::license_clear,
            commands::team::team_status,
            commands::team::team_join_stub,
            commands::team::team_list_shared,
            commands::team::team_apply_policy,
            commands::team::retention_prune,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SSHBool");
}

pub use container::AppContainer;
pub use error::AppError;

/// Shared managed state alias.
pub type ManagedState = Arc<AppState>;
