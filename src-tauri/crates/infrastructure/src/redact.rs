//! Shared redaction layer for outputs, previews, metadata, and logs.

use regex::Regex;
use std::sync::OnceLock;

static REDACT_REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();

fn get_redact_regexes() -> &'static Vec<Regex> {
    REDACT_REGEXES.get_or_init(|| {
        let patterns = [
            r"(?i)(secret|token|passwd|pwd|access[_-]?key|private[_-]?key)\s*[:=]\s*\S+",
            r"(?i)aws_(access_key_id|secret_access_key)\s*[:=]\s*\S+",
            r"AKIA[0-9A-Z]{16}",
            r"gh[pousr]_[A-Za-z0-9]{36,}",
            r"sk-[A-Za-z0-9]{20,}",
            r"xox[baprs]-[A-Za-z0-9-]{10,}",
            r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
            r"(?i)(mysql|postgres|postgresql|mongodb(\+srv)?|redis|amqp)://[^\s:@/]+:[^\s@/]+@",
            r"-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----",
            r"sbmcp_[A-Za-z0-9_-]{20,}",
            r"(?i)password\s*[:=]\s*\S+",
            r"(?i)api[_-]?key\s*[:=]\s*\S+",
            r"Bearer\s+[A-Za-z0-9\-._~+/]+=*",
        ];
        patterns
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect()
    })
}

/// Redacts sensitive patterns (passwords, tokens, API keys, private keys, connection strings) from text.
pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for re in get_redact_regexes() {
        out = re.replace_all(&out, "[REDACTED]").into_owned();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_patterns() {
        let input = r#"
        password=my_secret_pass
        api_key=12345
        AKIAIOSFODNN7EXAMPLE
        ghp_16fdA7000000000000000000000000000000
        sk-12345678901234567890
        xoxb-1234567890-1234567890
        mysql://user:secretpass@localhost:3306/db
        sbmcp_abcdefghijklmnopqrstuvwxyz123456
        -----BEGIN RSA PRIVATE KEY-----
        MIIEowIBAAKCAQEA...
        -----END RSA PRIVATE KEY-----
        "#;
        let redacted = redact(input);
        assert!(!redacted.contains("my_secret_pass"));
        assert!(!redacted.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(!redacted.contains("ghp_16fdA7000000000000000000000000000000"));
        assert!(!redacted.contains("secretpass"));
        assert!(!redacted.contains("sbmcp_abcdefghijklmnopqrstuvwxyz123456"));
        assert!(redacted.contains("[REDACTED]"));
    }
}
