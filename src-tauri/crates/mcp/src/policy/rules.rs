//! Versioned ruleset table for risk classification.

use crate::policy::tier::Tier;

pub const RULESET_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct CommandRule {
    pub id: &'static str,
    pub tier: Tier,
    pub reason: &'static str,
}

pub static RULE_CATALOG: &[CommandRule] = &[
    // ── Destroy / Irreversible ──────────────────────────────────────────
    CommandRule {
        id: "destroy.rm_recursive",
        tier: Tier::Dangerous,
        reason: "Deletes files recursively or forcefully",
    },
    CommandRule {
        id: "destroy.disk_wipe",
        tier: Tier::Dangerous,
        reason: "Wipes disk partitions, file systems, or raw block devices",
    },
    CommandRule {
        id: "destroy.find_delete",
        tier: Tier::Dangerous,
        reason: "Bulk deletes files matched by find or rsync",
    },
    CommandRule {
        id: "destroy.git_clean_reset",
        tier: Tier::Dangerous,
        reason: "Forcefully cleans or resets git repository state",
    },
    CommandRule {
        id: "destroy.container_prune",
        tier: Tier::Dangerous,
        reason: "Prunes or forcefully removes containers, volumes, or Kubernetes resources",
    },
    // ── Availability ────────────────────────────────────────────────────
    CommandRule {
        id: "avail.system_shutdown",
        tier: Tier::Dangerous,
        reason: "Shuts down, reboots, or halts the system",
    },
    CommandRule {
        id: "avail.service_stop",
        tier: Tier::Dangerous,
        reason: "Stops, disables, or masks critical services or networking",
    },
    CommandRule {
        id: "avail.process_kill",
        tier: Tier::Dangerous,
        reason: "Kills processes forcefully",
    },
    CommandRule {
        id: "avail.firewall_flush",
        tier: Tier::Dangerous,
        reason: "Flushes firewall rules or disables network security interfaces",
    },
    CommandRule {
        id: "avail.fork_bomb",
        tier: Tier::Dangerous,
        reason: "Contains a process exhaustion / fork bomb pattern",
    },
    // ── Privilege / Identity ────────────────────────────────────────────
    CommandRule {
        id: "priv.sudo_su",
        tier: Tier::Dangerous,
        reason: "Executes commands with elevated privileges (sudo / su / doas)",
    },
    CommandRule {
        id: "priv.chmod_chown_system",
        tier: Tier::Dangerous,
        reason: "Modifies ownership or permissions on system paths or recursively",
    },
    CommandRule {
        id: "priv.user_group_mod",
        tier: Tier::Dangerous,
        reason: "Modifies system user accounts, passwords, or sudoers configuration",
    },
    // ── Package / System State ──────────────────────────────────────────
    CommandRule {
        id: "pkg.remove",
        tier: Tier::Dangerous,
        reason: "Uninstalls or purges system packages or global runtime modules",
    },
    // ── Data ────────────────────────────────────────────────────────────
    CommandRule {
        id: "data.drop_truncate",
        tier: Tier::Dangerous,
        reason: "Drops or truncates database tables or schemas",
    },
    CommandRule {
        id: "data.unbounded_delete_update",
        tier: Tier::Dangerous,
        reason: "Executes SQL DELETE or UPDATE without a WHERE clause",
    },
    CommandRule {
        id: "data.redis_flush",
        tier: Tier::Dangerous,
        reason: "Flushes Redis databases or shuts down the datastore",
    },
    // ── Evidence Tampering ──────────────────────────────────────────────
    CommandRule {
        id: "evidence.clear_logs_history",
        tier: Tier::Dangerous,
        reason: "Clears shell history, vacuoms journalctl, or truncates system log files",
    },
    // ── Write / Bounded Modify ──────────────────────────────────────────
    CommandRule {
        id: "write.file_create_modify",
        tier: Tier::Write,
        reason: "Creates or modifies files or directories",
    },
    CommandRule {
        id: "write.service_control",
        tier: Tier::Write,
        reason: "Starts or restarts a service",
    },
    CommandRule {
        id: "write.pkg_install",
        tier: Tier::Write,
        reason: "Installs a package or dependency",
    },
];
