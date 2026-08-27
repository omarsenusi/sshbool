//! OS credential store helpers for optional vault auto-unlock.

use domain::DomainError;

const SERVICE: &str = "sshbool";
const ACCOUNT: &str = "vault-master-password";

/// Store the master password in the OS keychain / credential manager.
pub fn set_master_password(password: &str) -> Result<(), DomainError> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| DomainError::Crypto(format!("keychain entry: {e}")))?;
    entry
        .set_password(password)
        .map_err(|e| DomainError::Crypto(format!("keychain store: {e}")))
}

/// Read the master password from the OS keychain / credential manager.
pub fn get_master_password() -> Result<String, DomainError> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| DomainError::Crypto(format!("keychain entry: {e}")))?;
    entry
        .get_password()
        .map_err(|e| DomainError::Crypto(format!("keychain read: {e}")))
}

/// Remove the stored master password.
pub fn clear_master_password() {
    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        let _ = entry.delete_credential();
    }
}
