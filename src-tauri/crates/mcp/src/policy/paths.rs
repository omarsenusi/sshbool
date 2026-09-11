//! Path sensitivity and hard-invariant path matching.

use regex::Regex;
use std::sync::OnceLock;

static SENSITIVE_PATH_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();

fn get_sensitive_path_regexes() -> &'static Vec<Regex> {
    SENSITIVE_PATH_PATTERNS.get_or_init(|| {
        let patterns = [
            r"^/etc/shadow$",
            r"^/etc/gshadow$",
            r"^/etc/sudoers$",
            r"^/etc/sudoers\.d/.*$",
            r".*/\.ssh/id_.*$",
            r".*/\.ssh/.*_key$",
            r".*/\.ssh/authorized_keys$",
            r".*/\.gnupg(/.*)?$",
            r".*/\.aws/credentials$",
            r".*/\.kube/config$",
            r".*/\.docker/config\.json$",
            r".*/\.netrc$",
            r".*/\.pgpass$",
            r".*/\.my\.cnf$",
            r".*/\.npmrc$",
            r".*/\.pypirc$",
            r".*/\.git-credentials$",
            r".*/\.env(\..*)?$",
            r".*\.pem$",
            r".*\.key$",
            r".*\.pfx$",
            r".*\.p12$",
            r".*\.jks$",
            r".*/id_rsa$",
            r".*/id_ed25519$",
            r".*/id_ecdsa$",
            r"^/proc/[0-9]+/environ$",
            r"^/proc/[0-9]+/mem$",
        ];
        patterns.iter().filter_map(|p| Regex::new(p).ok()).collect()
    })
}

/// Normalizes path lexically (collapsing `.` and `..`, resolving `~`).
pub fn normalize_path(path: &str) -> String {
    let mut clean = path.trim().to_string();
    if clean.starts_with("~/") || clean == "~" {
        clean = format!("/home/user{}", &clean[1..]);
    }

    // Collapse double slashes
    while clean.contains("//") {
        clean = clean.replace("//", "/");
    }

    // Resolve . and ..
    let mut parts: Vec<&str> = Vec::new();
    for seg in clean.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }

    if clean.starts_with('/') {
        format!("/{}", parts.join("/"))
    } else {
        parts.join("/")
    }
}

/// Returns true if the path is in the forbidden sensitive read set.
pub fn is_sensitive_read_path(path: &str) -> bool {
    let norm = normalize_path(path);
    get_sensitive_path_regexes()
        .iter()
        .any(|re| re.is_match(&norm))
}

/// Returns true if writing/deleting under this path escalates to DANGEROUS.
pub fn is_system_path_write(path: &str) -> bool {
    let norm = normalize_path(path);
    let system_prefixes = [
        "/etc",
        "/boot",
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/var/lib",
        "/var/log",
        "/opt",
        "/srv",
        "/root",
        "/sys",
        "/proc",
        "/dev",
        "/home/user/.ssh",
        "/home/user/.gnupg",
        "/home/user/.aws",
        "/home/user/.kube",
        "/home/user/.docker/config.json",
    ];
    system_prefixes
        .iter()
        .any(|prefix| norm == *prefix || norm.starts_with(&format!("{prefix}/")))
}

/// Returns true if `delete_path` violates hard invariants (e.g. system roots or root paths).
pub fn is_hard_deny_delete_path(path: &str) -> bool {
    let norm = normalize_path(path);
    if norm == "/" || norm.is_empty() {
        return true;
    }
    let protected = [
        "/",
        "/etc",
        "/boot",
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/var",
        "/opt",
        "/srv",
        "/root",
        "/home/user/.ssh",
    ];
    if protected.contains(&norm.as_str()) {
        return true;
    }
    // Path with fewer than two segments (e.g. "/etc", "/var")
    let segments: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sensitive_paths() {
        assert!(is_sensitive_read_path("/etc/shadow"));
        assert!(is_sensitive_read_path("/etc/../etc/shadow"));
        assert!(is_sensitive_read_path("~/.ssh/id_rsa"));
        assert!(is_sensitive_read_path("/app/.env"));
        assert!(is_sensitive_read_path("/app/.env.production"));
        assert!(!is_sensitive_read_path("/var/log/nginx/error.log"));
    }

    #[test]
    fn test_hard_deny_delete() {
        assert!(is_hard_deny_delete_path("/"));
        assert!(is_hard_deny_delete_path("/etc"));
        assert!(is_hard_deny_delete_path("~/.ssh"));
        assert!(!is_hard_deny_delete_path("/tmp/test_dir/file.txt"));
    }
}
