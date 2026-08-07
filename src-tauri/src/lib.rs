//! SSHBool Tauri application crate.
#![allow(clippy::type_complexity, clippy::too_many_arguments)]

mod commands;
mod container;
mod error;
mod events;

use std::sync::Arc;

use infrastructure::AppState;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

#[cfg(target_os = "windows")]
mod win32 {
    #[link(name = "kernel32")]
    extern "system" {
        pub fn GetConsoleWindow() -> *mut std::ffi::c_void;
    }
    #[link(name = "user32")]
    extern "system" {
        pub fn ShowWindow(hwnd: *mut std::ffi::c_void, nCmdShow: i32) -> i32;
    }
}

#[cfg(target_os = "windows")]
fn hide_console_window() {
    unsafe {
        let hwnd = win32::GetConsoleWindow();
        if !hwnd.is_null() {
            win32::ShowWindow(hwnd, 0); // 0 is SW_HIDE
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // #[cfg(target_os = "windows")]
    // hide_console_window();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("sshbool=info".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            println!("[DEBUG] Single instance triggered with args: {:?}", args);
            if let Some(mut path) = dirs::home_dir() {
                path.push("sshbool_activation_log.txt");
                let _ = std::fs::write(path, format!("Args: {:?}", args));
            }
            let _ = app.emit("single-instance-deep-link", &args);
            let _ = app.emit("deep-link://new-url", &args);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.emit("single-instance-deep-link", &args);
                let _ = window.emit("deep-link://new-url", &args);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            if let Err(e) = app.deep_link().register_all() {
                tracing::warn!("Failed to register deep link URL schemes: {e}");
            }

            // ── Deep-link startup args ───────────────────────────────────
            // If this instance was launched directly with a sshbool:// URL
            // (e.g. registry protocol handler), emit it immediately to the
            // frontend. Also write it to a handoff file so the primary
            // dev-mode instance can pick it up via the poller below.
            {
                let args: Vec<String> = std::env::args().collect();
                tracing::info!("[STARTUP] args = {:?}", args);
                let deep_link_arg = args
                    .iter()
                    .skip(1)
                    .find(|a| a.starts_with("sshbool://"))
                    .cloned();
                if let Some(url) = deep_link_arg {
                    tracing::info!("[STARTUP] deep link detected in args: {}", url);
                    // Write to handoff file so any running primary instance can read it
                    if let Some(mut path) = dirs::home_dir() {
                        path.push("sshbool_deep_link_handoff.txt");
                        let _ = std::fs::write(&path, &url);
                    }
                    let _ = app.emit("single-instance-deep-link", vec![url.clone()]);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("single-instance-deep-link", vec![url]);
                    }
                }
            }

            // ── File-based deep-link poller ──────────────────────────────
            // Poll for the handoff file written by secondary instances.
            // This is the reliable fallback when single-instance IPC is
            // not wiring up correctly in dev mode.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if let Some(mut path) = dirs::home_dir() {
                        path.push("sshbool_deep_link_handoff.txt");
                        if path.exists() {
                            if let Ok(url) = std::fs::read_to_string(&path) {
                                let url = url.trim().to_string();
                                if !url.is_empty() {
                                    tracing::info!("[POLLER] picked up deep link: {}", url);
                                    let _ = std::fs::remove_file(&path);
                                    let _ =
                                        handle.emit("single-instance-deep-link", vec![url.clone()]);
                                    if let Some(window) = handle.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                        let _ = window.emit("single-instance-deep-link", vec![url]);
                                    }
                                }
                            }
                        }
                    }
                });
            }

            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let state = AppState::bootstrap()
                    .await
                    .map_err(|e| format!("bootstrap failed: {e}"))?;
                handle.manage(state);
                Ok::<(), String>(())
            })?;

            // ── System Tray ────────────────────────────────────────────
            let icon = app.default_window_icon().expect("no default icon").clone();

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("SSHBool — Left-click for quick menu, Right-click to open app")
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();
                    match event {
                        // ── Left click: show / restore main window ───
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            if let Some(main) = app.get_webview_window("main") {
                                let _ = main.show();
                                let _ = main.unminimize();
                                let _ = main.set_focus();
                            }
                        }
                        // ── Right click: toggle popup menu ────────────
                        TrayIconEvent::Click {
                            button: MouseButton::Right,
                            button_state: MouseButtonState::Up,
                            position,
                            ..
                        } => {
                            // If popup already exists → destroy it (toggle off)
                            if let Some(win) = app.get_webview_window("tray_popup") {
                                let _ = win.close();
                                return;
                            }

                            // Check if there are active connections to adjust window height
                            let state = app.state::<Arc<AppState>>();
                            let active_sessions_count = tauri::async_runtime::block_on(async {
                                let pool = state.vault.pool();
                                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions")
                                    .fetch_one(pool)
                                    .await
                                    .unwrap_or(0)
                            });

                            // Compute position & dynamic height
                            let x = position.x;
                            let y = position.y;
                            let w = 300_f64;
                            let h = if active_sessions_count > 0 {
                                320_f64
                            } else {
                                190_f64
                            };

                            // Try to get monitor height for Y positioning
                            let monitor_h = app
                                .get_webview_window("main")
                                .and_then(|mw| mw.current_monitor().ok().flatten())
                                .map(|m| m.size().height as f64 / m.scale_factor())
                                .unwrap_or(1080.0);
                            let popup_y = if y > monitor_h / 2.0 {
                                y - h - 8.0 // above icon (taskbar at bottom)
                            } else {
                                y + 8.0 // below icon (taskbar at top)
                            };
                            let popup_x = (x - w / 2.0).max(4.0);
                            let url = tauri::WebviewUrl::App("index.html?mode=tray".into());
                            let _ = tauri::WebviewWindowBuilder::new(app, "tray_popup", url)
                                .title("SSHBool Quick Menu")
                                .inner_size(w, h)
                                .position(popup_x, popup_y)
                                .decorations(false)
                                .always_on_top(true)
                                .skip_taskbar(true)
                                .shadow(true)
                                .visible(true)
                                .build();
                        }
                        _ => {}
                    }
                })
                .build(app)
                .expect("failed to build tray icon");
            // ──────────────────────────────────────────────────────────

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            } else if window.label() == "tray_popup" {
                // Let the tray popup close/destroy itself naturally
            }
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
            commands::phase2::rdp_launch_native,
            commands::phase2::workspace_window_open,
            commands::phase2::window_minimize,
            commands::phase2::window_toggle_maximize,
            commands::phase2::window_close,
            commands::phase2::window_toggle_pin,
            commands::phase2::tray_get_data,
            commands::phase2::workspace_window_open_with_host,
            commands::phase2::app_quit,
            commands::phase2::tray_close,
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
