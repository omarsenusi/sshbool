//! Shared RDP credential resolution (vault + UI placeholder handling).

pub const PASSWORD_PLACEHOLDER: &str = "••••••••";

/// Resolve the effective RDP password from UI input and optional vault secret.
pub fn resolve_rdp_password(
    ui_password: &str,
    use_ssh_credentials: bool,
    vault_password: Option<&str>,
) -> String {
    let mut password = ui_password.to_string();

    if password == PASSWORD_PLACEHOLDER || (use_ssh_credentials && password.is_empty()) {
        if let Some(vault_pass) = vault_password.filter(|p| !p.is_empty()) {
            password = vault_pass.to_string();
        } else {
            password.clear();
        }
    }

    password
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_placeholder_and_uses_vault() {
        assert_eq!(
            resolve_rdp_password(PASSWORD_PLACEHOLDER, true, Some("secret")),
            "secret"
        );
    }

    #[test]
    fn manual_password_when_not_using_ssh() {
        assert_eq!(
            resolve_rdp_password("manual-pass", false, Some("vault")),
            "manual-pass"
        );
    }

    #[test]
    fn empty_when_placeholder_without_vault() {
        assert_eq!(
            resolve_rdp_password(PASSWORD_PLACEHOLDER, true, None),
            ""
        );
    }
}
