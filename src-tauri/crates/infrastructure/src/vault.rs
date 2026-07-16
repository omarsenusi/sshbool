//! Vault service: init / unlock / lock + secret envelopes.

use std::sync::Arc;

use domain::vault::VaultStatus;
use domain::DomainError;
use serde_json::json;
use sqlx::SqlitePool;
use tokio::sync::RwLock;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::{
    aead_open, aead_seal, check_verifier, default_kdf_params, derive_kek, make_verifier,
    random_dek, random_salt, unwrap_dek, wrap_dek,
};

/// In-memory vault state.
pub struct VaultService {
    pool: SqlitePool,
    dek: RwLock<Option<Zeroizing<[u8; 32]>>>,
}

impl VaultService {
    /// Create vault service bound to a pool (migrations already applied).
    pub fn new(pool: SqlitePool) -> Arc<Self> {
        Arc::new(Self {
            pool,
            dek: RwLock::new(None),
        })
    }

    /// Pool handle.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Status.
    pub async fn status(&self) -> Result<VaultStatus, DomainError> {
        let row: Option<(i64,)> = sqlx::query_as("SELECT COUNT(*) FROM vault")
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| DomainError::Crypto(e.to_string()))?;
        let initialized = row.map(|r| r.0 > 0).unwrap_or(false);
        let locked = self.dek.read().await.is_none();
        let biometric = if initialized {
            let bio: (i64,) = sqlx::query_as("SELECT biometric_enabled FROM vault LIMIT 1")
                .fetch_one(&self.pool)
                .await
                .unwrap_or((0,));
            bio.0 != 0
        } else {
            false
        };
        Ok(VaultStatus {
            initialized,
            locked: !initialized || locked,
            biometric,
        })
    }

    /// Initialize singleton vault.
    pub async fn init(&self, password: &str) -> Result<(), DomainError> {
        if password.len() < 8 {
            return Err(DomainError::Validation {
                field: "password".into(),
                message: "must be at least 8 characters".into(),
            });
        }
        let status = self.status().await?;
        if status.initialized {
            return Err(DomainError::Conflict("vault already initialized".into()));
        }
        let salt = random_salt();
        let (m, t, p) = default_kdf_params();
        let mut kek = derive_kek(password, &salt, m, t, p)?;
        let dek = random_dek();
        let wrapped = wrap_dek(&kek, &dek)?;
        let verifier = make_verifier(&kek)?;
        let now = chrono::Utc::now().timestamp_millis();
        let id = Uuid::now_v7().to_string();
        let params = json!({ "m": m, "t": t, "p": p }).to_string();

        sqlx::query(
            r#"INSERT INTO vault
            (id, kdf, kdf_salt, kdf_params, verifier, wrapped_data_key, keychain_backed, biometric_enabled, auto_lock_secs, created_at, updated_at)
            VALUES (?, 'argon2id', ?, ?, ?, ?, 0, 0, 900, ?, ?)"#,
        )
        .bind(&id)
        .bind(&salt[..])
        .bind(&params)
        .bind(&verifier)
        .bind(&wrapped)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| DomainError::Crypto(e.to_string()))?;

        *self.dek.write().await = Some(dek);
        crate::crypto::clear_key(&mut kek);
        Ok(())
    }

    /// Unlock vault.
    pub async fn unlock(&self, password: &str) -> Result<(), DomainError> {
        let row = sqlx::query_as::<_, (Vec<u8>, String, Vec<u8>, Vec<u8>)>(
            "SELECT kdf_salt, kdf_params, verifier, wrapped_data_key FROM vault LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DomainError::Crypto(e.to_string()))?;

        let Some((salt, params_json, verifier, wrapped)) = row else {
            return Err(DomainError::NotFound {
                entity: "vault",
                id: None,
            });
        };
        let params: serde_json::Value =
            serde_json::from_str(&params_json).map_err(|e| DomainError::Crypto(e.to_string()))?;
        let m = params["m"].as_u64().unwrap_or(65536) as u32;
        let t = params["t"].as_u64().unwrap_or(3) as u32;
        let p = params["p"].as_u64().unwrap_or(1) as u32;
        let mut kek = derive_kek(password, &salt, m, t, p)?;
        check_verifier(&kek, &verifier)?;
        let dek = unwrap_dek(&kek, &wrapped)?;
        *self.dek.write().await = Some(dek);
        crate::crypto::clear_key(&mut kek);
        Ok(())
    }

    /// Lock vault.
    pub async fn lock(&self) -> Result<(), DomainError> {
        *self.dek.write().await = None;
        Ok(())
    }

    async fn require_dek(&self) -> Result<Zeroizing<[u8; 32]>, DomainError> {
        self.dek
            .read()
            .await
            .clone()
            .ok_or(DomainError::Unauthorized("locked"))
    }

    /// Encrypt a secret under DEK.
    pub async fn seal_secret(
        &self,
        plaintext: &[u8],
        aad: &str,
    ) -> Result<(Vec<u8>, Vec<u8>), DomainError> {
        let dek = self.require_dek().await?;
        let envelope = aead_seal(&dek, plaintext, aad.as_bytes())?;
        let (nonce, ct) = envelope.split_at(12);
        Ok((ct.to_vec(), nonce.to_vec()))
    }

    /// Decrypt a secret.
    pub async fn open_secret(
        &self,
        ciphertext: &[u8],
        nonce: &[u8],
        aad: &str,
    ) -> Result<Vec<u8>, DomainError> {
        let dek = self.require_dek().await?;
        let mut envelope = Vec::with_capacity(nonce.len() + ciphertext.len());
        envelope.extend_from_slice(nonce);
        envelope.extend_from_slice(ciphertext);
        aead_open(&dek, &envelope, aad.as_bytes())
    }

    /// Encrypted vault backup blob (base64).
    pub async fn backup(&self, password: &str) -> Result<String, DomainError> {
        self.unlock(password).await?;
        let bytes = tokio::fs::read(crate::db::default_db_path())
            .await
            .map_err(|e| DomainError::Crypto(e.to_string()))?;
        let salt = random_salt();
        let (m, t, p) = default_kdf_params();
        let kek = derive_kek(password, &salt, m, t, p)?;
        let sealed = aead_seal(&kek, &bytes, b"sshbool-backup-v1")?;
        let mut out = Vec::new();
        out.extend_from_slice(&salt);
        out.extend_from_slice(&m.to_le_bytes());
        out.extend_from_slice(&t.to_le_bytes());
        out.extend_from_slice(&p.to_le_bytes());
        out.extend_from_slice(&sealed);
        Ok(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &out,
        ))
    }

    /// Restore from backup blob.
    pub async fn restore(&self, blob_b64: &str, password: &str) -> Result<(), DomainError> {
        use base64::Engine;
        let raw = base64::engine::general_purpose::STANDARD
            .decode(blob_b64)
            .map_err(|e| DomainError::Crypto(e.to_string()))?;
        if raw.len() < 16 + 12 + 12 {
            return Err(DomainError::Crypto("backup too short".into()));
        }
        let salt = &raw[0..16];
        let m = u32::from_le_bytes(raw[16..20].try_into().unwrap());
        let t = u32::from_le_bytes(raw[20..24].try_into().unwrap());
        let p = u32::from_le_bytes(raw[24..28].try_into().unwrap());
        let sealed = &raw[28..];
        let kek = derive_kek(password, salt, m, t, p)?;
        let plain = aead_open(&kek, sealed, b"sshbool-backup-v1")?;
        let path = crate::db::default_db_path();
        self.lock().await?;
        self.pool.close().await;
        tokio::fs::write(&path, plain)
            .await
            .map_err(|e| DomainError::Crypto(e.to_string()))?;
        Ok(())
    }
}
