//! Windows RDP launch — secure xRDP greeter flow.
//!
//! Auto-login: FreeRDP connects without protocol-level password (like mstsc),
//! then types the password via SDL credential dialog and xRDP greeter (in-window only).
//! Manual login: mstsc.exe + temp `.rdp` with `prompt for credentials:i:1`.

#![allow(dead_code)]

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::Manager;
use zeroize::Zeroizing;

const CREATE_NO_WINDOW: u32 = 0x08000000;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

const FREERDP_DOWNLOAD_URLS: &[&str] = &[
    "https://ci.freerdp.com/job/freerdp-nightly-windows/arch=win64,label=vs2022/lastSuccessfulBuild/artifact/build/Release/*zip*/Release.zip",
    "https://ci.freerdp.com/job/freerdp-nightly-windows/arch=win64,label=vs2017/lastSuccessfulBuild/artifact/build/Release/*zip*/Release.zip",
    "https://ci.freerdp.com/job/freerdp-nightly-windows/arch=win64,label=vs2013/lastSuccessfulBuild/artifact/build/Release/*zip*/Release.zip",
];

const FREERDP_CLIENT_NAMES: &[&str] = &["sdl-freerdp.exe", "sdl3-freerdp.exe", "wfreerdp.exe"];

const FREERDP_ARTIFACT_DOWNLOADS: &[(&str, &str)] = &[(
    "https://ci.freerdp.com/job/freerdp-nightly-windows/arch=win64,label=vs2017/lastSuccessfulBuild/artifact/install/bin/sdl-freerdp.exe",
    "sdl-freerdp.exe",
)];

pub struct RdpLaunchOpts<'a> {
    pub connect_host: &'a str,
    pub local_port: u16,
    pub username: &'a str,
    pub password: &'a str,
    pub domain: &'a str,
    pub freerdp_candidates: &'a [PathBuf],
    pub share_clipboard: bool,
    pub smart_sizing: bool,
    pub admin_mode: bool,
    pub full_screen: bool,
    pub width: u32,
    pub height: u32,
    pub color_depth: u32,
}

pub struct MstscLaunchOpts<'a> {
    pub connect_host: &'a str,
    pub local_port: u16,
    pub username: &'a str,
    pub password: &'a str,
    pub domain: &'a str,
    pub share_clipboard: bool,
    pub smart_sizing: bool,
    pub admin_mode: bool,
    pub full_screen: bool,
    pub width: u32,
    pub height: u32,
    pub color_depth: u32,
    pub connection_type: u8,
}

/// Resolve candidate paths for the bundled FreeRDP sidecar.
pub fn freerdp_sidecar_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in [
                "sdl-freerdp.exe",
                "sdl3-freerdp.exe",
                "wfreerdp-x86_64-pc-windows-msvc.exe",
                "wfreerdp.exe",
            ] {
                paths.push(dir.join(name));
            }
        }
    }

    if let Ok(resource) = app.path().resource_dir() {
        for name in [
            "sdl-freerdp.exe",
            "binaries/sdl-freerdp.exe",
            "sdl3-freerdp.exe",
            "wfreerdp-x86_64-pc-windows-msvc.exe",
            "binaries/wfreerdp-x86_64-pc-windows-msvc.exe",
            "wfreerdp.exe",
        ] {
            paths.push(resource.join(name));
        }
    }

    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/wfreerdp-x86_64-pc-windows-msvc.exe"),
    );

    if let Some(local) = dirs::data_local_dir() {
        let rdp = local.join("sshbool").join("rdp");
        for name in FREERDP_CLIENT_NAMES {
            paths.push(rdp.join(name));
        }
    }

    paths
}

pub fn launch_with_protocol_password(opts: &RdpLaunchOpts<'_>) -> Result<(), String> {
    if opts.username.is_empty() || opts.password.is_empty() {
        return Err("username and password are required for RDP auto-login".into());
    }
    kill_stale_freerdp();
    let addr = format!("{}:{}", opts.connect_host, opts.local_port);
    clear_loopback_creds(opts.connect_host, &addr);

    let bin = find_freerdp_client(opts.freerdp_candidates).ok_or_else(|| {
        "FreeRDP 3.x is not installed. Run: powershell -File scripts/download-freerdp.ps1"
            .to_string()
    })?;

    launch_freerdp(&bin, opts)?;
    tracing::info!(
        "RDP: FreeRDP {} connected to {addr} user={} (xRDP greeter auto-login scheduled)",
        bin.display(),
        opts.username
    );
    Ok(())
}

/// True when a FreeRDP 3.x client is available for xRDP greeter auto-login.
pub fn freerdp_stdin_available(extra_candidates: &[PathBuf]) -> bool {
    find_freerdp_client(extra_candidates).is_some()
}

/// Download and install FreeRDP into local app data when missing.
pub fn provision_freerdp_bundle() -> Result<PathBuf, String> {
    let install_dir = freerdp_install_dir()?;
    if let Some(existing) = find_freerdp_in_dir(&install_dir) {
        if freerdp_client_usable(&existing) {
            remove_legacy_wfreerdp(&install_dir);
            return Ok(existing);
        }
        tracing::warn!(
            "RDP: installed FreeRDP at {} is unusable — re-downloading",
            existing.display()
        );
    }

    let zip_path = install_dir.join("freerdp-release.zip");
    let mut last_error = String::from("no download URLs configured");
    for url in FREERDP_DOWNLOAD_URLS {
        match download_file(url, &zip_path) {
            Ok(()) => {
                let extract_root = install_dir.join("extract-tmp");
                let _ = std::fs::remove_dir_all(&extract_root);
                std::fs::create_dir_all(&extract_root).map_err(|e| e.to_string())?;
                if let Err(e) = extract_zip(&zip_path, &extract_root) {
                    last_error = e;
                    let _ = std::fs::remove_file(&zip_path);
                    let _ = std::fs::remove_dir_all(&extract_root);
                    continue;
                }
                let _ = std::fs::remove_file(&zip_path);
                if let Some(release_dir) = find_release_dir(&extract_root) {
                    flatten_freerdp_release(&release_dir);
                } else {
                    flatten_freerdp_release(&extract_root);
                }
                let _ = std::fs::remove_dir_all(&extract_root);

                if let Some(bin) = find_freerdp_in_dir(&install_dir) {
                    if freerdp_client_usable(&bin) {
                        remove_legacy_wfreerdp(&install_dir);
                        tracing::info!("RDP: provisioned FreeRDP at {}", bin.display());
                        return Ok(bin);
                    }
                    last_error = format!(
                        "downloaded FreeRDP at {} is not a usable 3.x client",
                        bin.display()
                    );
                    continue;
                }
                last_error = "FreeRDP archive did not contain a client binary".into();
            }
            Err(e) => last_error = e,
        }
    }

    for (url, filename) in FREERDP_ARTIFACT_DOWNLOADS {
        let dest = install_dir.join(filename);
        match download_file(url, &dest) {
            Ok(()) if dest.is_file() && freerdp_client_usable(&dest) => {
                remove_legacy_wfreerdp(&install_dir);
                tracing::info!("RDP: provisioned FreeRDP artifact at {}", dest.display());
                return Ok(dest);
            }
            Ok(()) => {
                last_error = format!("artifact {filename} is not a usable FreeRDP 3.x client")
            }
            Err(e) => last_error = e,
        }
    }

    Err(format!("Failed to download FreeRDP: {last_error}"))
}

#[allow(dead_code)]
pub fn freerdp_available(extra_candidates: &[PathBuf]) -> bool {
    freerdp_stdin_available(extra_candidates)
}

#[repr(C)]
struct FileTime {
    dw_low_date_time: u32,
    dw_high_date_time: u32,
}

#[repr(C)]
struct CredentialW {
    flags: u32,
    type_: u32,
    target_name: *mut u16,
    comment: *mut u16,
    last_written: FileTime,
    credential_blob_size: u32,
    credential_blob: *mut u8,
    persist: u32,
    attribute_count: u32,
    attributes: *mut std::ffi::c_void,
    target_alias: *mut u16,
    user_name: *mut u16,
}

#[link(name = "advapi32")]
extern "system" {
    fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
    fn CredDeleteW(target_name: *const u16, type_: u32, flags: u32) -> i32;
}

const CRED_TYPE_GENERIC: u32 = 1;
const CRED_PERSIST_SESSION: u32 = 1;

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn write_session_credential(target: &str, username: &str, password: &str) -> bool {
    let mut target_w = to_wide(target);
    let mut user_w = to_wide(username);
    let password_bytes: Vec<u8> = password
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();

    let cred = CredentialW {
        flags: 0,
        type_: CRED_TYPE_GENERIC,
        target_name: target_w.as_mut_ptr(),
        comment: std::ptr::null_mut(),
        last_written: FileTime {
            dw_low_date_time: 0,
            dw_high_date_time: 0,
        },
        credential_blob_size: password_bytes.len() as u32,
        credential_blob: password_bytes.as_ptr() as *mut u8,
        persist: CRED_PERSIST_SESSION,
        attribute_count: 0,
        attributes: std::ptr::null_mut(),
        target_alias: std::ptr::null_mut(),
        user_name: user_w.as_mut_ptr(),
    };

    let ret = unsafe { CredWriteW(&cred, 0) != 0 };
    if ret {
        tracing::debug!("RDP: wrote session credential for {target}");
    } else {
        tracing::warn!("RDP: failed to write session credential for {target}");
    }
    ret
}

pub fn delete_session_credential(target: &str) -> bool {
    let target_w = to_wide(target);
    unsafe { CredDeleteW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0) != 0 }
}

/// Native Windows mstsc launch — safe, clean, and zero-leak.
///
/// By default, credentials are NOT injected via `cmdkey` or Credential Manager
/// to protect passwords from being exposed in Windows Process Lists (Task Manager / Event 4688)
/// and to avoid NLA negotiation conflicts on non-Windows targets (such as Linux xRDP).
///
/// NOTE TO DEVELOPERS:
/// If you want to re-enable automatic password passing to mstsc via Windows Credential Manager:
/// Uncomment the `AUTO_LOGIN_INJECTION` blocks below.
pub fn launch_mstsc(opts: &MstscLaunchOpts<'_>) -> Result<(), String> {
    let addr = format_address(opts.connect_host, opts.local_port);
    let qualified_user = qualified_username(opts.domain, opts.username);

    // =========================================================================
    // [AUTO_LOGIN_INJECTION BLOCK - DISABLED FOR SECURITY & STABILITY]
    //
    // To enable automatic password injection into mstsc.exe via Windows Credential Manager:
    // 1. Uncomment the lines below.
    // 2. Also uncomment the corresponding cleanup block in the background thread below.
    //
    // let has_password = !opts.password.is_empty() && !qualified_user.is_empty();
    // let targets = if has_password {
    //     let list = vec![
    //         format!("TERMSRV/{addr}"),
    //         format!("TERMSRV/{}", opts.connect_host),
    //         format!("TERMSRV/{}:{}", opts.connect_host, opts.local_port),
    //     ];
    //     for target in &list {
    //         write_session_credential(target, &qualified_user, opts.password);
    //         let _ = no_window("cmdkey")
    //             .args([
    //                 &format!("/generic:{target}"),
    //                 &format!("/user:{qualified_user}"),
    //                 &format!("/pass:{}", opts.password),
    //             ])
    //             .status();
    //     }
    //     list
    // } else {
    //     Vec::new()
    // };
    // =========================================================================

    let mut lines = vec![
        format!("full address:s:{addr}"),
        "prompt for credentials:i:1".to_string(),
        "authentication level:i:0".to_string(),
        "enablecredsspsupport:i:0".to_string(),
        "negotiate security layer:i:0".to_string(),
        format!("redirectclipboard:i:{}", u8::from(opts.share_clipboard)),
        format!("smart sizing:i:{}", u8::from(opts.smart_sizing)),
        format!("administrative session:i:{}", u8::from(opts.admin_mode)),
        format!("screen mode id:i:{}", if opts.full_screen { 2 } else { 1 }),
        format!("desktopwidth:i:{}", opts.width),
        format!("desktopheight:i:{}", opts.height),
        format!("session bpp:i:{}", opts.color_depth),
        format!("connection type:i:{}", opts.connection_type),
    ];
    if !qualified_user.is_empty() {
        lines.push(format!("username:s:{qualified_user}"));
    }

    let rdp_content = format!("{}\r\n", lines.join("\r\n"));
    let temp_dir = std::env::temp_dir().join(format!("sshbool-rdp-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("create temp dir: {e}"))?;
    let rdp_path = temp_dir.join("connection.rdp");
    std::fs::write(&rdp_path, rdp_content.as_bytes())
        .map_err(|e| format!("write RDP file: {e}"))?;

    let mut cmd = Command::new("mstsc.exe");
    cmd.arg(&rdp_path)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    cmd.spawn()
        .map(|_| {
            tracing::info!("RDP: mstsc launched cleanly to {addr} (safe manual prompt)");
            let cleanup_dir = temp_dir.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(30));
                // =============================================================
                // [CLEANUP BLOCK FOR AUTO_LOGIN - UNCOMMENT IF RE-ENABLED]
                // for t in cleanup_targets {
                //     delete_session_credential(&t);
                //     let _ = no_window("cmdkey").args([&format!("/delete:{t}")]).status();
                // }
                // =============================================================
                let _ = std::fs::remove_dir_all(cleanup_dir);
            });
        })
        .map_err(|e| format!("failed to start mstsc.exe: {e}"))
}

pub fn launch_mstsc_manual(opts: &MstscLaunchOpts<'_>) -> Result<(), String> {
    launch_mstsc(opts)
}

fn format_address(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn qualified_username(domain: &str, username: &str) -> String {
    if username.is_empty() {
        return String::new();
    }
    if domain.is_empty() {
        username.to_string()
    } else {
        format!("{domain}\\{username}")
    }
}

fn clear_loopback_creds(connect_host: &str, connect_addr: &str) {
    for target in [
        format!("TERMSRV/{connect_host}"),
        format!("TERMSRV/{connect_addr}"),
        "TERMSRV/127.0.0.1".to_string(),
        "TERMSRV/localhost".to_string(),
    ] {
        delete_session_credential(&target);
        let _ = no_window("cmdkey")
            .args([&format!("/delete:{target}")])
            .status();
    }
}

fn kill_stale_freerdp() {
    for image in [
        "wfreerdp.exe",
        "xfreerdp.exe",
        "sdl3-freerdp.exe",
        "sdl-freerdp.exe",
    ] {
        let _ = no_window("taskkill")
            .args(["/F", "/IM", image, "/T"])
            .status();
    }
}

fn no_window(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd
}

fn launch_freerdp(bin: &Path, opts: &RdpLaunchOpts<'_>) -> Result<(), String> {
    let addr = format!("{}:{}", opts.connect_host, opts.local_port);
    let base_args = build_freerdp_base_args(opts, &addr);

    let profiles: &[(&str, &[&str])] = &[
        (
            "tls",
            &["/sec:tls", "-gfx", "/bpp:24", "/network:lan", "/gdi:sw"],
        ),
        (
            "rdp",
            &["/sec:rdp", "-gfx", "/bpp:24", "/network:lan", "/gdi:sw"],
        ),
    ];

    let mut last_err = String::new();
    for (name, profile) in profiles {
        let mut args = base_args.clone();
        args.extend(profile.iter().map(|s| (*s).to_string()));
        tracing::info!("RDP: FreeRDP connect to {addr} (profile={name})");
        match spawn_freerdp_connect(bin, &args, opts.username, opts.password) {
            Ok(()) => return Ok(()),
            Err(e) => {
                tracing::warn!("RDP: FreeRDP profile {name} failed: {e}");
                last_err = e;
                kill_stale_freerdp();
            }
        }
    }
    Err(last_err)
}

fn build_freerdp_base_args(opts: &RdpLaunchOpts<'_>, addr: &str) -> Vec<String> {
    let _ = opts.color_depth;
    let mut args = vec![
        format!("/v:{addr}"),
        format!("/u:{}", opts.username),
        "/cert:ignore".to_string(),
        "/relax-order-checks".to_string(),
        "/log-level:WARN".to_string(),
        "/timeout:15000".to_string(),
        "/title:FreeRDP".to_string(),
    ];
    if !opts.domain.is_empty() {
        args.push(format!("/d:{}", opts.domain));
    }
    args.push(if opts.share_clipboard {
        "+clipboard".into()
    } else {
        "-clipboard".into()
    });
    if opts.smart_sizing {
        args.push("/smart-sizing".into());
    }
    if opts.admin_mode {
        args.push("/admin".into());
    }
    if opts.full_screen {
        args.push("/f".into());
    } else {
        args.push(format!("/size:{}x{}", opts.width, opts.height));
    }
    args
}

fn spawn_freerdp_connect(
    bin: &Path,
    args: &[String],
    username: &str,
    password: &str,
) -> Result<(), String> {
    let _ = username;
    let log_path = freerdp_install_dir()
        .map(|dir| dir.join("last-freerdp.log"))
        .unwrap_or_else(|_| std::env::temp_dir().join("sshbool-freerdp.log"));
    let log_file = std::fs::File::create(&log_path)
        .map_err(|e| format!("create FreeRDP log {}: {e}", log_path.display()))?;

    let mut cmd = Command::new(bin);
    if let Some(dir) = freerdp_runtime_dir(bin) {
        cmd.current_dir(dir);
    }
    cmd.args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::from(log_file))
        .creation_flags(CREATE_NEW_PROCESS_GROUP);

    allow_child_foreground();

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {}: {e}", bin.display()))?;

    let freerdp_pid = child.id();

    schedule_freerdp_auto_login(freerdp_pid, Zeroizing::new(password.to_string()));

    std::thread::sleep(std::time::Duration::from_millis(4000));
    match child.try_wait() {
        Ok(Some(status)) => {
            let log = std::fs::read_to_string(&log_path).unwrap_or_default();
            let tail = log.lines().rev().take(8).collect::<Vec<_>>().join("\n");
            Err(format!(
                "FreeRDP exited before xRDP greeter ({status}). {}",
                if tail.is_empty() {
                    format!("See {}", log_path.display())
                } else {
                    tail
                }
            ))
        }
        Ok(None) => {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        }
        Err(e) => Err(format!("failed to check FreeRDP process: {e}")),
    }
}

fn find_freerdp_client(extra_candidates: &[PathBuf]) -> Option<PathBuf> {
    if let Ok(install_dir) = freerdp_install_dir() {
        ensure_freerdp_runtime_files(&install_dir);
        for name in FREERDP_CLIENT_NAMES {
            let bin = install_dir.join(name);
            if bin.is_file() && freerdp_client_usable(&bin) {
                return Some(bin);
            }
        }
    }

    for bin in extra_candidates {
        if bin.is_file() && freerdp_client_usable(bin) {
            return Some(bin.clone());
        }
    }

    find_freerdp(extra_candidates).filter(|bin| freerdp_client_usable(bin))
}

fn freerdp_client_usable(bin: &Path) -> bool {
    matches!(freerdp_major_version(bin), Some(major) if major >= 3)
}

fn freerdp_runtime_dir(bin: &Path) -> Option<PathBuf> {
    if let Ok(install_dir) = freerdp_install_dir() {
        for name in FREERDP_CLIENT_NAMES {
            if install_dir.join(name).is_file() {
                return Some(install_dir);
            }
        }
    }
    bin.parent().map(Path::to_path_buf)
}

fn find_freerdp(extra_candidates: &[PathBuf]) -> Option<PathBuf> {
    if let Ok(install_dir) = freerdp_install_dir() {
        if let Some(bin) = find_freerdp_in_dir(&install_dir) {
            return Some(bin);
        }
    }

    let mut candidates: Vec<PathBuf> = extra_candidates.to_vec();
    candidates.extend(
        [
            "wfreerdp.exe",
            "wfreerdp",
            "sdl3-freerdp.exe",
            "sdl3-freerdp",
            "xfreerdp.exe",
            "xfreerdp",
            r"C:\Program Files\FreeRDP\wfreerdp.exe",
            r"C:\Program Files\FreeRDP\bin\wfreerdp.exe",
            r"C:\Program Files (x86)\FreeRDP\wfreerdp.exe",
            r"C:\msys64\mingw64\bin\wfreerdp.exe",
            r"C:\msys64\ucrt64\bin\wfreerdp.exe",
        ]
        .iter()
        .map(PathBuf::from),
    );

    for bin in candidates {
        if bin.is_file() {
            return Some(bin);
        }
        if bin.components().count() == 1 {
            if let Some(found) = where_exe(&bin) {
                return Some(found);
            }
        }
    }
    None
}

fn freerdp_install_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| "no local app data directory".to_string())?
        .join("sshbool")
        .join("rdp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn find_freerdp_in_dir(root: &Path) -> Option<PathBuf> {
    ensure_freerdp_runtime_files(root);

    for name in FREERDP_CLIENT_NAMES {
        let direct = root.join(name);
        if direct.is_file() {
            return Some(direct);
        }
    }

    fn walk(dir: &Path) -> Option<PathBuf> {
        let mut found: Option<PathBuf> = None;
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(nested) = walk(&path) {
                    found = pick_preferred_client(found, nested);
                }
            } else if is_freerdp_client(path.file_name()?.to_str()?) {
                found = pick_preferred_client(found, path);
            }
        }
        found
    }

    let found = walk(root)?;
    if let Some(parent) = found.parent() {
        flatten_freerdp_release(parent);
    }
    for name in FREERDP_CLIENT_NAMES {
        let flat = root.join(name);
        if flat.is_file() {
            return Some(flat);
        }
    }
    Some(found)
}

fn is_freerdp_client(name: &str) -> bool {
    FREERDP_CLIENT_NAMES
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn pick_preferred_client(current: Option<PathBuf>, candidate: PathBuf) -> Option<PathBuf> {
    let rank = |path: &Path| -> usize {
        path.file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| {
                FREERDP_CLIENT_NAMES
                    .iter()
                    .position(|name| n.eq_ignore_ascii_case(name))
            })
            .unwrap_or(FREERDP_CLIENT_NAMES.len())
    };
    match current {
        None => Some(candidate),
        Some(existing) if rank(&candidate) < rank(&existing) => Some(candidate),
        Some(existing) => Some(existing),
    }
}

fn find_release_dir(root: &Path) -> Option<PathBuf> {
    if root
        .file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("Release"))
    {
        return Some(root.to_path_buf());
    }
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path
                .file_name()
                .is_some_and(|n| n.eq_ignore_ascii_case("Release"))
            {
                return Some(path);
            }
            if let Some(nested) = find_release_dir(&path) {
                return Some(nested);
            }
        }
    }
    None
}

fn freerdp_major_version(bin: &Path) -> Option<u32> {
    let output = Command::new(bin)
        .arg("/version")
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let rest = text.split("version ").nth(1)?;
    rest.split('.').next()?.trim().parse().ok()
}

fn remove_legacy_wfreerdp(install_dir: &Path) {
    let legacy = install_dir.join("wfreerdp.exe");
    if !legacy.is_file() {
        return;
    }
    if install_dir.join("sdl-freerdp.exe").is_file()
        || install_dir.join("sdl3-freerdp.exe").is_file()
    {
        tracing::info!("RDP: removing legacy wfreerdp.exe (pre-3.x)");
        let _ = std::fs::remove_file(legacy);
    }
}

fn flatten_freerdp_release(release_dir: &Path) {
    let install_dir = match freerdp_install_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };
    let Ok(entries) = std::fs::read_dir(release_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let Some(name) = src.file_name() else {
            continue;
        };
        let dest = install_dir.join(name);
        if dest.exists() {
            let _ = std::fs::remove_file(&dest);
        }
        let _ = std::fs::copy(&src, &dest);
    }
}

/// Copy companion DLLs from nested Release/ folders into the install root.
fn ensure_freerdp_runtime_files(root: &Path) {
    for nested in [root.join("Release"), root.join("Release").join("Release")] {
        if nested.is_dir() {
            flatten_freerdp_release(&nested);
        }
    }
}

fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let dest_str = dest.to_string_lossy();
    let output = Command::new("curl.exe")
        .args(["-fsSL", "-o", dest_str.as_ref(), url])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("curl failed to start: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("curl download failed: {stderr}"));
    }
    if !dest.is_file() || dest.metadata().map(|m| m.len()).unwrap_or(0) < 1024 {
        return Err("downloaded file is missing or too small".into());
    }
    Ok(())
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let zip_str = zip_path.to_string_lossy();
    let dest_str = dest.to_string_lossy();
    let output = Command::new("tar.exe")
        .args(["-xf", zip_str.as_ref(), "-C", dest_str.as_ref()])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("tar failed to start: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tar extract failed: {stderr}"));
    }
    Ok(())
}

fn where_exe(name: &Path) -> Option<PathBuf> {
    let out = Command::new("where.exe")
        .arg(name)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout)
        .ok()?
        .lines()
        .next()
        .map(|l| PathBuf::from(l.trim()))
        .filter(|p| p.is_file())
}

/// Let the next spawned GUI process steal foreground (Windows 10+ lock).
fn allow_child_foreground() {
    #[link(name = "user32")]
    extern "system" {
        fn AllowSetForegroundWindow(process_id: u32) -> i32;
    }
    const ASFW_ANY: u32 = 0xFFFF_FFFF;
    unsafe {
        AllowSetForegroundWindow(ASFW_ANY);
    }
}

/// FreeRDP SDL shows a credential dialog; xRDP greeter renders inside the session window.
fn schedule_freerdp_auto_login(freerdp_pid: u32, password: Zeroizing<String>) {
    std::thread::spawn(move || {
        allow_child_foreground();
        tracing::info!("RDP: auto-login thread started (freerdp pid={freerdp_pid})");

        for attempt in 0..30 {
            if freerdp_credential_dialog_visible() {
                tracing::info!("RDP: credential dialog visible (attempt {})", attempt + 1);
                if submit_freerdp_credential_dialog(password.as_str()) {
                    tracing::info!("RDP: credential dialog accepted (attempt {})", attempt + 1);
                    break;
                }
                tracing::info!(
                    "RDP: credential dialog fill incomplete (attempt {})",
                    attempt + 1
                );
            }
            if attempt + 1 < 30 {
                std::thread::sleep(std::time::Duration::from_millis(400));
            }
        }

        // Brief paint delay before greeter polling (credential dialog may have just closed).
        std::thread::sleep(std::time::Duration::from_millis(2000));

        let mut greeter_submits = 0u32;
        for attempt in 0..40 {
            if freerdp_credential_dialog_visible() {
                tracing::info!("RDP: credential dialog retry during greeter phase ({attempt})");
                let _ = submit_freerdp_credential_dialog(password.as_str());
            } else if find_freerdp_window(freerdp_pid).is_some() {
                tracing::info!(
                    "RDP: greeter auto-login attempt {} (pid={freerdp_pid})",
                    attempt + 1
                );
                if submit_xrdp_greeter_login(freerdp_pid, password.as_str()) {
                    greeter_submits += 1;
                }
                if !freerdp_login_screen_visible(freerdp_pid) {
                    tracing::info!("RDP: login screen no longer visible — auto-login done");
                    break;
                }
            } else {
                tracing::info!(
                    "RDP: FreeRDP window not found for pid {} (attempt {})",
                    freerdp_pid,
                    attempt + 1
                );
                if greeter_submits >= 2 && !freerdp_login_screen_visible(freerdp_pid) {
                    break;
                }
            }
            if attempt + 1 < 40 {
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
    });
}

fn title_is_credential_dialog(title: &str) -> bool {
    title.to_ascii_lowercase().contains("credentials required")
}

fn title_is_freerdp_session(title: &str) -> bool {
    let t = title.to_ascii_lowercase();
    // FreeRDP SDL renames the window once xRDP greeter loads (e.g. "Login to hostname").
    t.starts_with("freerdp") || t.starts_with("login to")
}

fn freerdp_credential_dialog_visible() -> bool {
    find_visible_window(title_is_credential_dialog).is_some()
}

fn freerdp_login_screen_visible(freerdp_pid: u32) -> bool {
    find_freerdp_window(freerdp_pid).is_some_and(|hwnd| {
        window_title(hwnd).is_some_and(|title| title_is_freerdp_session(&title))
    })
}

fn window_title(hwnd: isize) -> Option<String> {
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
    }
    let mut buf = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

/// Visible top-level window owned by the FreeRDP process (title match preferred).
fn find_freerdp_window(freerdp_pid: u32) -> Option<isize> {
    use std::sync::Mutex;

    struct EnumCtx {
        pid: u32,
        title_match: Mutex<Option<isize>>,
        any_visible: Mutex<Option<isize>>,
    }

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            lp_enum_func: Option<unsafe extern "system" fn(isize, isize) -> i32>,
            lparam: isize,
        ) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, process_id: *mut u32) -> u32;
        fn IsWindowVisible(hwnd: isize) -> i32;
    }

    unsafe extern "system" fn enum_callback(hwnd: isize, lparam: isize) -> i32 {
        let ctx = &*(lparam as *const EnumCtx);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let mut window_pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut window_pid);
        if window_pid != ctx.pid {
            return 1;
        }
        if let Some(title) = window_title(hwnd) {
            if title_is_credential_dialog(&title) {
                return 1;
            }
            if title_is_freerdp_session(&title) {
                *ctx.title_match.lock().unwrap() = Some(hwnd);
                return 0;
            }
        }
        if ctx.any_visible.lock().unwrap().is_none() {
            *ctx.any_visible.lock().unwrap() = Some(hwnd);
        }
        1
    }

    let ctx = EnumCtx {
        pid: freerdp_pid,
        title_match: Mutex::new(None),
        any_visible: Mutex::new(None),
    };
    unsafe {
        EnumWindows(Some(enum_callback), &ctx as *const EnumCtx as isize);
    }
    let title_match = *ctx.title_match.lock().unwrap();
    let any_visible = *ctx.any_visible.lock().unwrap();
    title_match
        .or(any_visible)
        .or_else(|| find_visible_window(title_is_freerdp_session))
}

#[link(name = "user32")]
extern "system" {
    fn SendInput(count: u32, inputs: *mut std::ffi::c_void, cb_size: i32) -> u32;
}

/// SDL credential dialog: Username, Domain, Password, then Accept/Cancel.
/// Click the password field — Tab navigation is unreliable when Domain is focused.
fn submit_freerdp_credential_dialog(password: &str) -> bool {
    let hwnd = match find_visible_window(title_is_credential_dialog) {
        Some(hwnd) => hwnd,
        None => return false,
    };

    allow_child_foreground();
    let _ = focus_freerdp_window(hwnd);

    const PASSWORD_Y: f32 = 0.58;
    const ACCEPT_X: f32 = 0.38;
    const ACCEPT_Y: f32 = 0.78;

    tracing::info!("RDP: filling SDL credential dialog hwnd={hwnd} (unicode input)");
    click_window_relative(hwnd, 0.50, PASSWORD_Y);
    std::thread::sleep(std::time::Duration::from_millis(300));
    type_unicode_text(password);
    std::thread::sleep(std::time::Duration::from_millis(150));
    send_vk_return();
    std::thread::sleep(std::time::Duration::from_millis(120));
    click_window_relative(hwnd, ACCEPT_X, ACCEPT_Y);
    std::thread::sleep(std::time::Duration::from_millis(400));

    !freerdp_credential_dialog_visible()
}

/// xRDP greeter is centered in the FreeRDP client canvas.
fn submit_xrdp_greeter_login(freerdp_pid: u32, password: &str) -> bool {
    let hwnd = match find_freerdp_window(freerdp_pid) {
        Some(hwnd) => hwnd,
        None => {
            tracing::info!("RDP: greeter submit skipped — no window for pid {freerdp_pid}");
            return false;
        }
    };

    let title = window_title(hwnd).unwrap_or_default();
    tracing::info!("RDP: greeter submit hwnd={hwnd} title=\"{title}\" mode=scancode");

    allow_child_foreground();
    let _ = focus_freerdp_window(hwnd);

    const CANVAS_CENTER: (f32, f32) = (0.50, 0.50);
    const PASSWORD: (f32, f32) = (0.50, 0.54);
    const OK_BTN: (f32, f32) = (0.42, 0.62);

    click_window_relative(hwnd, CANVAS_CENTER.0, CANVAS_CENTER.1);
    std::thread::sleep(std::time::Duration::from_millis(200));
    click_window_relative(hwnd, PASSWORD.0, PASSWORD.1);
    std::thread::sleep(std::time::Duration::from_millis(300));
    type_text_scancode(password);
    std::thread::sleep(std::time::Duration::from_millis(150));
    send_vk_return();
    std::thread::sleep(std::time::Duration::from_millis(120));
    click_window_relative(hwnd, OK_BTN.0, OK_BTN.1);
    true
}

fn focus_freerdp_window(hwnd: isize) -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn SetForegroundWindow(hwnd: isize) -> i32;
        fn BringWindowToTop(hwnd: isize) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, process_id: *mut u32) -> u32;
        fn GetCurrentThreadId() -> u32;
        fn AttachThreadInput(from: u32, to: u32, attach: i32) -> i32;
    }

    unsafe {
        let mut pid = 0u32;
        let target_thread = GetWindowThreadProcessId(hwnd, &mut pid);
        let current_thread = GetCurrentThreadId();
        let attached = if target_thread != 0 && target_thread != current_thread {
            AttachThreadInput(current_thread, target_thread, 1) != 0
        } else {
            false
        };

        BringWindowToTop(hwnd);
        let focused = SetForegroundWindow(hwnd) != 0;
        if !focused {
            tracing::debug!("RDP: SetForegroundWindow failed (pid {pid})");
        }

        std::thread::sleep(std::time::Duration::from_millis(200));

        if attached {
            AttachThreadInput(current_thread, target_thread, 0);
        }

        focused
    }
}

fn click_window_relative(hwnd: isize, x_frac: f32, y_frac: f32) {
    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct MouseInput {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    union InputUnion {
        mi: MouseInput,
    }

    #[repr(C)]
    struct Input {
        type_: u32,
        u: InputUnion,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetClientRect(hwnd: isize, rect: *mut Rect) -> i32;
        fn ClientToScreen(hwnd: isize, point: *mut Point) -> i32;
        fn GetSystemMetrics(index: i32) -> i32;
    }

    const INPUT_MOUSE: u32 = 0;
    const MOUSEEVENTF_MOVE: u32 = 0x0001;
    const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
    const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
    const MOUSEEVENTF_ABSOLUTE: u32 = 0x8000;

    unsafe {
        let mut client = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetClientRect(hwnd, &mut client) == 0 {
            return;
        }
        let width = (client.right - client.left).max(1);
        let height = (client.bottom - client.top).max(1);
        let mut pt = Point {
            x: (width as f32 * x_frac.clamp(0.0, 1.0)) as i32,
            y: (height as f32 * y_frac.clamp(0.0, 1.0)) as i32,
        };
        if ClientToScreen(hwnd, &mut pt) == 0 {
            return;
        }
        let screen_w = 65535i32;
        let screen_h = 65535i32;
        let abs_x = pt.x * screen_w / GetSystemMetrics(0);
        let abs_y = pt.y * screen_h / GetSystemMetrics(1);

        let mut move_click = [
            Input {
                type_: INPUT_MOUSE,
                u: InputUnion {
                    mi: MouseInput {
                        dx: abs_x,
                        dy: abs_y,
                        mouse_data: 0,
                        dw_flags: MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE,
                        time: 0,
                        dw_extra_info: 0,
                    },
                },
            },
            Input {
                type_: INPUT_MOUSE,
                u: InputUnion {
                    mi: MouseInput {
                        dx: 0,
                        dy: 0,
                        mouse_data: 0,
                        dw_flags: MOUSEEVENTF_LEFTDOWN,
                        time: 0,
                        dw_extra_info: 0,
                    },
                },
            },
            Input {
                type_: INPUT_MOUSE,
                u: InputUnion {
                    mi: MouseInput {
                        dx: 0,
                        dy: 0,
                        mouse_data: 0,
                        dw_flags: MOUSEEVENTF_LEFTUP,
                        time: 0,
                        dw_extra_info: 0,
                    },
                },
            },
        ];
        SendInput(
            move_click.len() as u32,
            move_click.as_mut_ptr().cast(),
            std::mem::size_of::<Input>() as i32,
        );
    }
}

fn send_vk(vk: u16, flags: u32) {
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct KeybdInput {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    union InputUnion {
        ki: KeybdInput,
    }

    #[repr(C)]
    struct Input {
        type_: u32,
        u: InputUnion,
    }

    const INPUT_KEYBOARD: u32 = 1;

    let mut input = Input {
        type_: INPUT_KEYBOARD,
        u: InputUnion {
            ki: KeybdInput {
                w_vk: vk,
                w_scan: 0,
                dw_flags: flags,
                time: 0,
                dw_extra_info: 0,
            },
        },
    };
    unsafe {
        SendInput(
            1,
            (&mut input as *mut Input).cast(),
            std::mem::size_of::<Input>() as i32,
        );
    }
}

fn send_vk_return() {
    const VK_RETURN: u16 = 0x0D;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    send_vk(VK_RETURN, 0);
    send_vk(VK_RETURN, KEYEVENTF_KEYUP);
}

fn type_unicode_text(text: &str) {
    const KEYEVENTF_UNICODE: u32 = 0x0004;
    const KEYEVENTF_KEYUP: u32 = 0x0002;

    for ch in text.encode_utf16() {
        send_vk_with_scan(ch, KEYEVENTF_UNICODE);
        send_vk_with_scan(ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
        std::thread::sleep(std::time::Duration::from_millis(12));
    }
}

/// Scan-code typing for the remote xRDP canvas (Unicode SendInput does not forward).
fn type_text_scancode(text: &str) {
    const VK_SHIFT: u16 = 0x10;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const KEYEVENTF_SCANCODE: u32 = 0x0008;
    const KEYEVENTF_UNICODE: u32 = 0x0004;
    const MAPVK_VK_TO_VSC: u32 = 0;

    #[link(name = "user32")]
    extern "system" {
        fn VkKeyScanW(ch: u16) -> i16;
        fn MapVirtualKeyW(vk: u32, map_type: u32) -> u32;
    }

    for ch in text.encode_utf16() {
        let vk_scan = unsafe { VkKeyScanW(ch) };
        if vk_scan == -1 {
            send_vk_with_scan(ch, KEYEVENTF_UNICODE);
            send_vk_with_scan(ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
            std::thread::sleep(std::time::Duration::from_millis(12));
            continue;
        }
        let vk = (vk_scan & 0xFF) as u16;
        let shift_needed = ((vk_scan >> 8) & 0xFF) != 0;
        let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) as u16 };

        if shift_needed {
            send_scancode(VK_SHIFT, 0, KEYEVENTF_SCANCODE);
        }
        send_scancode(vk, scan, KEYEVENTF_SCANCODE);
        send_scancode(vk, scan, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP);
        if shift_needed {
            send_scancode(VK_SHIFT, 0, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP);
        }
        std::thread::sleep(std::time::Duration::from_millis(12));
    }
}

fn send_scancode(vk: u16, scan: u16, flags: u32) {
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct KeybdInput {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    union InputUnion {
        ki: KeybdInput,
    }

    #[repr(C)]
    struct Input {
        type_: u32,
        u: InputUnion,
    }

    const INPUT_KEYBOARD: u32 = 1;

    let mut input = Input {
        type_: INPUT_KEYBOARD,
        u: InputUnion {
            ki: KeybdInput {
                w_vk: vk,
                w_scan: scan,
                dw_flags: flags,
                time: 0,
                dw_extra_info: 0,
            },
        },
    };
    unsafe {
        SendInput(
            1,
            (&mut input as *mut Input).cast(),
            std::mem::size_of::<Input>() as i32,
        );
    }
}

fn send_vk_with_scan(scan: u16, flags: u32) {
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct KeybdInput {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[repr(C)]
    union InputUnion {
        ki: KeybdInput,
    }

    #[repr(C)]
    struct Input {
        type_: u32,
        u: InputUnion,
    }

    const INPUT_KEYBOARD: u32 = 1;

    let mut input = Input {
        type_: INPUT_KEYBOARD,
        u: InputUnion {
            ki: KeybdInput {
                w_vk: 0,
                w_scan: scan,
                dw_flags: flags,
                time: 0,
                dw_extra_info: 0,
            },
        },
    };
    unsafe {
        SendInput(
            1,
            (&mut input as *mut Input).cast(),
            std::mem::size_of::<Input>() as i32,
        );
    }
}

fn find_visible_window(title_matches: fn(&str) -> bool) -> Option<isize> {
    use std::sync::atomic::{AtomicIsize, Ordering};

    struct EnumCtx {
        found: AtomicIsize,
        matcher: fn(&str) -> bool,
    }

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            lp_enum_func: Option<unsafe extern "system" fn(isize, isize) -> i32>,
            lparam: isize,
        ) -> i32;
        fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
    }

    unsafe extern "system" fn enum_callback(hwnd: isize, lparam: isize) -> i32 {
        let ctx = &*(lparam as *const EnumCtx);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len <= 0 {
            return 1;
        }
        let title = String::from_utf16_lossy(&buf[..len as usize]);
        if (ctx.matcher)(&title) {
            ctx.found.store(hwnd, Ordering::SeqCst);
            return 0;
        }
        1
    }

    let ctx = EnumCtx {
        found: AtomicIsize::new(0),
        matcher: title_matches,
    };
    unsafe {
        EnumWindows(Some(enum_callback), &ctx as *const EnumCtx as isize);
        let hwnd = ctx.found.load(Ordering::SeqCst);
        if hwnd == 0 {
            None
        } else {
            Some(hwnd)
        }
    }
}
