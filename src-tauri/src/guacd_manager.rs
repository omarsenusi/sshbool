//! Lifecycle manager for the bundled or system `guacd` daemon.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use tauri::Manager;
use tokio::sync::Mutex;
use tracing::{info, warn};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const GUACD_HOST: &str = "127.0.0.1";
const GUACD_PORT: u16 = 4822;

static GUACD_CHILD: LazyLock<Mutex<Option<Child>>> = LazyLock::new(|| Mutex::new(None));
static PROVISION_ATTEMPTED: AtomicBool = AtomicBool::new(false);

/// Ensure guacd is listening on 127.0.0.1:4822.
pub async fn ensure_guacd_running(app: Option<&tauri::AppHandle>) -> Result<(), String> {
    if guacd_reachable().await {
        return Ok(());
    }

    if let Ok(exe) = find_guacd_binary(app) {
        spawn_guacd_process(&exe).await?;
        return wait_for_guacd().await;
    }

    if !PROVISION_ATTEMPTED.swap(true, Ordering::SeqCst) {
        match provision_guacd_bundle(app, false) {
            Ok(msg) => info!("guacd provision: {msg}"),
            Err(e) => warn!("guacd auto-provision failed: {e}"),
        }
    }

    if guacd_reachable().await {
        return Ok(());
    }

    if let Ok(exe) = find_guacd_binary(app) {
        spawn_guacd_process(&exe).await?;
        return wait_for_guacd().await;
    }

    Err(provision_help_message())
}

/// Run the download/setup script (Docker container or manual bundle).
pub fn provision_guacd_bundle(
    app: Option<&tauri::AppHandle>,
    install_docker: bool,
) -> Result<String, String> {
    let script = find_download_script(app)?;
    let repo_root = script
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "Could not resolve repo root for download-guacd.ps1".to_string())?;

    let mut args = vec![
        "-NoProfile".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-File".to_string(),
        script.to_string_lossy().into_owned(),
    ];

    if install_docker {
        args.push("-InstallDocker".to_string());
    } else {
        args.push("-UseDocker".to_string());
        args.push("-Force".to_string());
    }

    let mut cmd = Command::new("powershell");
    cmd.args(&args)
        .current_dir(repo_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run download-guacd.ps1: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}").trim().to_string();

    if output.status.success() {
        Ok(if combined.is_empty() {
            "guacd setup completed".into()
        } else {
            combined
        })
    } else if install_docker {
        Ok(combined)
    } else {
        Err(if combined.is_empty() {
            provision_help_message()
        } else {
            format!("{combined}\n\n{}", provision_help_message())
        })
    }
}

pub async fn shutdown_guacd() {
    let mut guard = GUACD_CHILD.lock().await;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
}

async fn spawn_guacd_process(exe: &Path) -> Result<(), String> {
    let bin_dir = exe
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    info!("Starting guacd from {}", exe.display());

    let mut cmd = Command::new(exe);
    cmd.arg("-b")
        .arg(GUACD_HOST)
        .arg("-l")
        .arg(GUACD_PORT.to_string())
        .arg("-f")
        .current_dir(&bin_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
        cmd.env("OPENSSL_MODULES", &bin_dir);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn guacd ({}): {e}", exe.display()))?;

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                warn!("guacd stderr: {line}");
            }
        });
    }

    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                info!("guacd stdout: {line}");
            }
        });
    }

    let mut guard = GUACD_CHILD.lock().await;
    *guard = Some(child);
    Ok(())
}

async fn wait_for_guacd() -> Result<(), String> {
    for _ in 0..30 {
        if guacd_reachable().await {
            info!("guacd is ready on {GUACD_HOST}:{GUACD_PORT}");
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    Err(format!(
        "guacd did not become ready on {GUACD_HOST}:{GUACD_PORT}. {}",
        provision_help_message()
    ))
}

async fn guacd_reachable() -> bool {
    tokio::net::TcpStream::connect((GUACD_HOST, GUACD_PORT))
        .await
        .is_ok()
}

fn find_download_script(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("scripts")
            .join("download-guacd.ps1"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("download-guacd.ps1"),
    ];

    if let Some(handle) = app {
        if let Ok(resource) = handle.path().resource_dir() {
            candidates.push(resource.join("scripts").join("download-guacd.ps1"));
        }
    }

    for path in candidates {
        if path.is_file() {
            return Ok(path);
        }
    }

    Err("download-guacd.ps1 not found in app resources".into())
}

fn guacd_binary_names() -> Vec<&'static str> {
    if cfg!(windows) {
        vec!["guacd.exe", "guacd-x86_64-pc-windows-msvc.exe"]
    } else if cfg!(target_os = "macos") {
        vec![
            "guacd",
            "guacd-aarch64-apple-darwin",
            "guacd-x86_64-apple-darwin",
        ]
    } else {
        vec!["guacd", "guacd-x86_64-unknown-linux-gnu"]
    }
}

fn find_guacd_binary(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    let names = guacd_binary_names();
    let mut candidates: Vec<PathBuf> = Vec::new();

    for name in &names {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join(name));
                candidates.push(dir.join("guacd").join(name));
                candidates.push(dir.join("binaries").join("guacd").join(name));
            }
        }

        if let Some(handle) = app {
            if let Ok(resource) = handle.path().resource_dir() {
                candidates.push(resource.join(name));
                candidates.push(resource.join("binaries").join("guacd").join(name));
                candidates.push(resource.join("guacd").join(name));
            }
        }

        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join("guacd")
                .join(name),
        );
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(name),
        );

        if let Some(local) = dirs::data_local_dir() {
            candidates.push(local.join("sshbool").join("guacd").join(name));
        }
    }

    for path in candidates {
        if path.is_file() {
            return Ok(path);
        }
    }

    for name in &names {
        if let Ok(output) = Command::new(*name).arg("--version").output() {
            if output.status.success() || !output.stdout.is_empty() || !output.stderr.is_empty() {
                return Ok(PathBuf::from(*name));
            }
        }
    }

    Err(provision_help_message())
}

fn provision_help_message() -> String {
    "guacd is required for in-app RDP. Install Docker Desktop, then click Set up guacd in Remote Desktop, or run: npm run download-guacd -- -UseDocker".into()
}
