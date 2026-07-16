//! Argon2id KDF + AES-256-GCM envelopes.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{password_hash::SaltString, Algorithm, Argon2, Params, Version};
use domain::DomainError;
use rand::RngCore;
use zeroize::{Zeroize, Zeroizing};

const NONCE_LEN: usize = 12;

/// Derive a 32-byte KEK from password + salt.
pub fn derive_kek(
    password: &str,
    salt: &[u8],
    m_kib: u32,
    t: u32,
    p: u32,
) -> Result<[u8; 32], DomainError> {
    let params =
        Params::new(m_kib, t, p, Some(32)).map_err(|e| DomainError::Crypto(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| DomainError::Crypto(e.to_string()))?;
    Ok(out)
}

/// Default Argon2id params (memory KiB, iterations, parallelism).
pub fn default_kdf_params() -> (u32, u32, u32) {
    (64 * 1024, 3, 1)
}

/// Random salt (16 bytes).
pub fn random_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

/// Random 32-byte DEK.
pub fn random_dek() -> Zeroizing<[u8; 32]> {
    let mut dek = Zeroizing::new([0u8; 32]);
    rand::thread_rng().fill_bytes(dek.as_mut());
    dek
}

/// Encrypt with AES-256-GCM. Returns nonce || ciphertext.
pub fn aead_seal(key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, DomainError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| DomainError::Crypto(e.to_string()))?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let mut ct = cipher
        .encrypt(
            nonce,
            aes_gcm::aead::Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| DomainError::Crypto("encrypt failed".into()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.append(&mut ct);
    Ok(out)
}

/// Decrypt AES-256-GCM envelope (nonce || ciphertext).
pub fn aead_open(key: &[u8; 32], envelope: &[u8], aad: &[u8]) -> Result<Vec<u8>, DomainError> {
    if envelope.len() < NONCE_LEN + 16 {
        return Err(DomainError::Crypto("envelope too short".into()));
    }
    let (nonce_bytes, ct) = envelope.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| DomainError::Crypto(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, aes_gcm::aead::Payload { msg: ct, aad })
        .map_err(|_| DomainError::Unauthorized("bad_password"))
}

/// Wrap DEK with KEK.
pub fn wrap_dek(kek: &[u8; 32], dek: &[u8; 32]) -> Result<Vec<u8>, DomainError> {
    aead_seal(kek, dek, b"sshbool-dek-v1")
}

/// Unwrap DEK with KEK.
pub fn unwrap_dek(kek: &[u8; 32], wrapped: &[u8]) -> Result<Zeroizing<[u8; 32]>, DomainError> {
    let plain = aead_open(kek, wrapped, b"sshbool-dek-v1")?;
    if plain.len() != 32 {
        return Err(DomainError::Crypto("invalid dek length".into()));
    }
    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&plain);
    Ok(dek)
}

/// Password verifier (HMAC-like via AEAD of fixed string).
pub fn make_verifier(kek: &[u8; 32]) -> Result<Vec<u8>, DomainError> {
    aead_seal(kek, b"sshbool-vault-ok", b"verifier")
}

pub fn check_verifier(kek: &[u8; 32], verifier: &[u8]) -> Result<(), DomainError> {
    let plain = aead_open(kek, verifier, b"verifier")?;
    if plain.as_slice() == b"sshbool-vault-ok" {
        Ok(())
    } else {
        Err(DomainError::Unauthorized("bad_password"))
    }
}

/// Encode salt for argon2 SaltString helpers if needed.
#[allow(dead_code)]
pub fn salt_string(salt: &[u8]) -> Result<SaltString, DomainError> {
    SaltString::encode_b64(salt).map_err(|e| DomainError::Crypto(e.to_string()))
}

/// Zeroize helper re-export.
pub use zeroize::Zeroize as _;

/// Clear a key buffer.
pub fn clear_key(key: &mut [u8]) {
    key.zeroize();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_open_roundtrip() {
        let key = *random_dek();
        let sealed = aead_seal(&key, b"hello", b"aad").unwrap();
        let plain = aead_open(&key, &sealed, b"aad").unwrap();
        assert_eq!(plain, b"hello");
    }

    #[test]
    fn wrap_unwrap_dek() {
        let kek = *random_dek();
        let dek = random_dek();
        let wrapped = wrap_dek(&kek, &dek).unwrap();
        let unwrapped = unwrap_dek(&kek, &wrapped).unwrap();
        assert_eq!(*unwrapped, *dek);
    }
}
