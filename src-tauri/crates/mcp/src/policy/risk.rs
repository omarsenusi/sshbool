//! Shell-aware risk classifier.

use crate::policy::obfuscation::detect_obfuscation;
use crate::policy::paths::is_system_path_write;
use crate::policy::rules::{RULESET_VERSION, RULE_CATALOG};
use crate::policy::tier::Tier;
use std::collections::HashSet;

/// Result of risk classification for a command.
#[derive(Debug, Clone)]
pub struct RiskAssessment {
    pub tier: Tier,
    pub reasons: Vec<String>,
    pub ruleset_version: u32,
    pub is_compound: bool,
    pub is_obfuscated: bool,
}

/// Tokenizes a shell command line into simple command tokens, handling quotes.
/// Fails closed (returns Err) on unbalanced quotes or invalid escape sequences.
pub fn tokenize_simple_shell(cmd: &str) -> Result<Vec<String>, &'static str> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    for c in cmd.chars() {
        if escaped {
            current.push(c);
            escaped = false;
            continue;
        }

        match c {
            '\\' if !in_single => {
                escaped = true;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            c if c.is_whitespace() && !in_single && !in_double => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            c => {
                current.push(c);
            }
        }
    }

    if in_single || in_double || escaped {
        return Err("Unbalanced quotes or trailing escape");
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    Ok(tokens)
}

/// Checks if command contains compound structure operators (pipes, logic AND/OR, redirects, backticks, newlines).
pub fn is_compound_command(cmd: &str) -> bool {
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;
    let mut chars = cmd.chars().peekable();

    while let Some(c) = chars.next() {
        if escaped {
            escaped = false;
            continue;
        }

        match c {
            '\\' if !in_single => escaped = true,
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            _ if in_single || in_double => {}
            ';' | '\n' | '\r' | '`' => return true,
            '$' if chars.peek() == Some(&'(') => return true,
            '&' => {
                if chars.peek() == Some(&'&') {
                    return true;
                }
            }
            '|' => return true,
            '>' => return true,
            _ => {}
        }
    }

    false
}

/// Known informational read-only commands that return Tier::Safe
static KNOWN_READONLY_COMMANDS: &[&str] = &[
    "ls",
    "cat",
    "head",
    "tail",
    "less",
    "stat",
    "file",
    "du",
    "df",
    "find",
    "grep",
    "awk",
    "sed",
    "ps",
    "top",
    "free",
    "uptime",
    "uname",
    "whoami",
    "id",
    "date",
    "env",
    "which",
    "journalctl",
    "ip",
    "ss",
    "netstat",
    "ping",
    "dig",
    "curl",
    "nslookup",
    "traceroute",
    "lsof",
    "mount",
    "lsblk",
    "sensors",
    "echo",
    "printf",
    "pwd",
    "hostname",
];

/// Known bounded write commands that return Tier::Write
static KNOWN_WRITE_COMMANDS: &[&str] = &[
    "mkdir",
    "touch",
    "cp",
    "mv",
    "ln",
    "chmod",
    "sed",
    "tee",
    "git",
    "apt",
    "pip",
    "npm",
    "systemctl",
    "docker",
    "service",
];

/// Classifies a shell command line string and assigns risk tier + human-readable reasons.
pub fn classify_command(cmd: &str) -> RiskAssessment {
    let mut reasons = HashSet::new();
    let mut max_tier = Tier::Safe;
    let mut is_obfuscated = false;

    // 1. Length check
    if cmd.len() > 4096 {
        reasons.insert("Command is unusually long".to_string());
        max_tier = Tier::Dangerous;
    }

    // 2. Control character check
    if cmd
        .chars()
        .any(|c| (c as u32) < 32 && c != '\t' && c != '\n' && c != '\r')
    {
        reasons.insert("Command contains control characters".to_string());
        max_tier = Tier::Dangerous;
    }

    // 3. Obfuscation detection
    let obf_signals = detect_obfuscation(cmd);
    if !obf_signals.is_empty() {
        is_obfuscated = true;
        max_tier = Tier::Dangerous;
        for sig in obf_signals {
            reasons.insert(sig.reason.to_string());
        }
    }

    // 4. Compound structure check
    let is_compound = is_compound_command(cmd);
    if is_compound {
        reasons.insert("Command combines multiple operations".to_string());
        max_tier = Tier::Dangerous;
    }

    // 5. Lexer parsing
    let tokens = match tokenize_simple_shell(cmd) {
        Ok(t) => t,
        Err(_) => {
            reasons.insert("Command could not be parsed safely".to_string());
            return RiskAssessment {
                tier: Tier::Dangerous,
                reasons: reasons.into_iter().collect(),
                ruleset_version: RULESET_VERSION,
                is_compound,
                is_obfuscated,
            };
        }
    };

    if tokens.is_empty() {
        return RiskAssessment {
            tier: max_tier,
            reasons: reasons.into_iter().collect(),
            ruleset_version: RULESET_VERSION,
            is_compound,
            is_obfuscated,
        };
    }

    let cmd_name = tokens[0].trim_start_matches("./"); // strip local path prefix
    let base_cmd = std::path::Path::new(cmd_name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(cmd_name);

    // Rule catalog evaluation
    let lower_cmd = cmd.to_lowercase();
    for rule in RULE_CATALOG {
        match rule.id {
            "destroy.rm_recursive" => {
                if base_cmd == "rm" && (lower_cmd.contains("-r") || lower_cmd.contains("-f")) {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "destroy.disk_wipe" => {
                if matches!(
                    base_cmd,
                    "shred" | "truncate" | "fdisk" | "parted" | "sgdisk" | "wipefs" | "dd"
                ) || lower_cmd.contains("mkfs")
                {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "destroy.find_delete" => {
                if base_cmd == "find"
                    && (lower_cmd.contains("-delete") || lower_cmd.contains("-exec rm"))
                    || lower_cmd.contains("rsync --delete")
                {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "destroy.git_clean_reset" => {
                if base_cmd == "git"
                    && (lower_cmd.contains("clean -fdx")
                        || lower_cmd.contains("reset --hard")
                        || lower_cmd.contains("push --force"))
                {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "destroy.container_prune" => {
                if (base_cmd == "docker"
                    && (lower_cmd.contains("system prune")
                        || lower_cmd.contains("volume rm")
                        || lower_cmd.contains("rm -f")))
                    || (base_cmd == "kubectl" && lower_cmd.contains("delete"))
                    || base_cmd == "helm" && lower_cmd.contains("uninstall")
                {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "avail.system_shutdown" => {
                if matches!(
                    base_cmd,
                    "shutdown" | "reboot" | "halt" | "poweroff" | "init"
                ) {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "avail.service_stop" => {
                if (base_cmd == "systemctl"
                    && (lower_cmd.contains("stop")
                        || lower_cmd.contains("disable")
                        || lower_cmd.contains("mask")))
                    || (base_cmd == "service" && lower_cmd.contains("stop"))
                {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "avail.process_kill" => {
                if matches!(base_cmd, "kill" | "killall" | "pkill") {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "priv.sudo_su" => {
                if matches!(base_cmd, "sudo" | "su" | "doas") {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "priv.chmod_chown_system" => {
                if (matches!(base_cmd, "chmod" | "chown") && lower_cmd.contains("-r"))
                    || lower_cmd.contains("777")
                {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "priv.user_group_mod" => {
                if matches!(
                    base_cmd,
                    "usermod"
                        | "userdel"
                        | "useradd"
                        | "groupmod"
                        | "passwd"
                        | "chpasswd"
                        | "visudo"
                ) {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "pkg.remove" => {
                if matches!(
                    base_cmd,
                    "apt" | "apt-get" | "dnf" | "yum" | "zypper" | "pacman" | "apk"
                ) && (lower_cmd.contains("remove")
                    || lower_cmd.contains("purge")
                    || lower_cmd.contains("autoremove"))
                {
                    max_tier = max_tier.max(rule.tier);
                    reasons.insert(rule.reason.to_string());
                }
            }
            "evidence.clear_logs_history"
                if lower_cmd.contains("history -c")
                    || lower_cmd.contains("journalctl --vacuum")
                    || lower_cmd.contains("unset histfile")
                    || (lower_cmd.contains("/var/log")
                        && (base_cmd == "rm" || base_cmd == "truncate")) =>
            {
                max_tier = max_tier.max(rule.tier);
                reasons.insert(rule.reason.to_string());
            }
            _ => {}
        }
    }

    let is_readonly_cmd = KNOWN_READONLY_COMMANDS.contains(&base_cmd)
        && !(base_cmd == "sed" && lower_cmd.contains("-i"))
        && !(base_cmd == "find" && (lower_cmd.contains("-delete") || lower_cmd.contains("-exec")));

    // Path sensitivity write escalation (only for mutating or non-readonly commands)
    if !is_readonly_cmd {
        for tok in &tokens[1..] {
            if is_system_path_write(tok) {
                max_tier = max_tier.max(Tier::Dangerous);
                reasons.insert(format!("Target path '{tok}' is a protected system path"));
            }
        }
    }

    // Unknown command check
    if !is_readonly_cmd && !KNOWN_WRITE_COMMANDS.contains(&base_cmd) && max_tier < Tier::Dangerous {
        max_tier = Tier::Dangerous;
        reasons.insert("Unrecognised command — effect unknown".to_string());
    } else if KNOWN_WRITE_COMMANDS.contains(&base_cmd) && max_tier < Tier::Write {
        max_tier = Tier::Write;
        reasons.insert("Modifies system state or files".to_string());
    }

    RiskAssessment {
        tier: max_tier,
        reasons: reasons.into_iter().collect(),
        ruleset_version: RULESET_VERSION,
        is_compound,
        is_obfuscated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_risk_classification_baseline() {
        let res = classify_command("ls -la /var/log");
        assert_eq!(res.tier, Tier::Safe);

        let res2 = classify_command("rm -rf /var/lib/app");
        assert_eq!(res2.tier, Tier::Dangerous);

        let res3 = classify_command("mkdir /tmp/newdir");
        assert_eq!(res3.tier, Tier::Write);
    }
}
