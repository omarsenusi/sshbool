//! Shared shell safety and name validation helpers.

use domain::DomainError;

/// Validates and single-quote escapes a remote path to prevent shell injection.
pub fn validate_safe_remote_path(path: &str) -> Result<String, DomainError> {
    if path
        .chars()
        .any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')' | '\n' | '\r'))
    {
        return Err(DomainError::Validation {
            field: "path".into(),
            message: "path contains disallowed shell characters".into(),
        });
    }
    let escaped = path.replace('\'', "'\\''");
    Ok(format!("'{escaped}'"))
}

/// Validates a container ID or container name string.
pub fn validate_container_id(id: &str) -> Result<&str, DomainError> {
    let valid = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if !valid {
        return Err(DomainError::Validation {
            field: "container_id".into(),
            message: "invalid container ID or name format".into(),
        });
    }
    Ok(id)
}

/// Validates a systemd unit name string.
pub fn validate_systemd_unit(unit: &str) -> Result<(), DomainError> {
    let valid = !unit.is_empty()
        && unit.len() <= 256
        && unit
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@'));
    if !valid {
        return Err(DomainError::Validation {
            field: "unit".into(),
            message: "invalid systemd unit name".into(),
        });
    }
    Ok(())
}

/// Validates a Kubernetes resource name or namespace string.
pub fn validate_k8s_name<'a>(
    name: &'a str,
    field_name: &'static str,
) -> Result<&'a str, DomainError> {
    let valid = !name.is_empty()
        && name.len() <= 253
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    if !valid {
        return Err(DomainError::Validation {
            field: field_name.into(),
            message: format!("invalid {field_name} format"),
        });
    }
    Ok(name)
}
