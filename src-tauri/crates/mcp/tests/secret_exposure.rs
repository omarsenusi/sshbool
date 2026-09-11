//! Secret exposure tests and structural verification that MCP crate never references key material or vault APIs.

use infrastructure::redact;
use std::fs;
use std::path::Path;

#[test]
fn test_no_vault_symbols_in_crate() {
    let src_dir = Path::new("src");
    assert!(src_dir.exists(), "src directory missing in mcp crate");

    let forbidden_symbols = [
        "keys_export",
        "keys_import",
        "keys_generate",
        "credentials_create",
        "credentials_list",
        "vault_unlock",
        "vault_init",
        "vault_change_password",
        "vault_backup",
        "master_password",
        "token_blob",
    ];

    let mut violations = Vec::new();

    fn scan_dir(dir: &Path, forbidden: &[&str], violations: &mut Vec<String>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                scan_dir(&path, forbidden, violations);
            } else if path.extension().and_then(|s| s.to_str()) == Some("rs") {
                let content = fs::read_to_string(&path).unwrap();
                // Strip #[cfg(test)] blocks or test modules if any
                for (line_idx, line) in content.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("//") {
                        continue;
                    }
                    for &sym in forbidden {
                        if line.contains(sym) {
                            violations.push(format!(
                                "Forbidden symbol `{sym}` found in {}:{}",
                                path.display(),
                                line_idx + 1
                            ));
                        }
                    }
                }
            }
        }
    }

    scan_dir(src_dir, &forbidden_symbols, &mut violations);

    assert!(
        violations.is_empty(),
        "Vault symbol isolation test failed! Violations found:\n{}",
        violations.join("\n")
    );
}

#[test]
fn test_redaction_covers_all_sensitive_patterns() {
    let test_cases = [
        ("AWS Key", "AKIA1234567890ABCDEF", "[REDACTED]"),
        (
            "GitHub Token",
            "ghp_123456789012345678901234567890123456",
            "[REDACTED]",
        ),
        ("OpenAI Key", "sk-12345678901234567890", "[REDACTED]"),
        ("Slack Token", "xoxb-1234567890-1234567890", "[REDACTED]"),
        (
            "MCP Token",
            "sbmcp_123456789012345678901234567890",
            "[REDACTED]",
        ),
    ];

    for (label, input, expected) in test_cases {
        let output = redact(input);
        assert_eq!(output, expected, "Failed for pattern: {label}");
    }
}
