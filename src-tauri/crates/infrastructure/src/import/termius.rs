//! Termius importer.
//!
//! Termius keeps its data in a Chromium IndexedDB LevelDB directory, with each
//! record encrypted individually using libsodium's `crypto_secretbox`
//! (XSalsa20-Poly1305). The 32-byte key lives in the OS keychain.
//!
//! Rather than implement a LevelDB reader, we do what the reference exporter
//! does (<https://github.com/ZacharyZcR/termius-exporter>): read the `.log` and
//! `.ldb` files as raw bytes and scrape base64 ciphertext blocks out of them.
//! This is resilient to LevelDB format changes and, importantly, also recovers
//! records from compacted/obsolete pages.
//!
//! Envelope layout, little-endian:
//!
//! ```text
//! byte  0        version (must be 4)
//! byte  1        options
//! bytes 2..26    24-byte nonce
//! bytes 26..     ciphertext || Poly1305 tag
//! ```
//!
//! # Divergence from the reference exporter
//!
//! The reference builds its host list from `connection_type` records, which are
//! Termius's *session history*, not its saved hosts. On a real profile that
//! yields thousands of rows (every past session, including one-off connections)
//! rather than the host list the user actually sees. We instead treat the
//! `address` + `label` records as hosts, and use session history only as a
//! secondary source of usernames and ports.
//!
//! It also attaches a password to a host whenever *any* identity shares its
//! username. On a real profile `root` had 30 distinct passwords, so that
//! attribution is frequently wrong. We only attach a password when the match is
//! unambiguous, and flag the rest for the user to resolve.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use base64::Engine;
use crypto_secretbox::aead::{Aead, KeyInit};
use crypto_secretbox::{Key, Nonce, XSalsa20Poly1305};
use serde_json::Value;

use super::{
    ImportError, ImportPreview, ImportSource, ImportedHost, ImportedKey, ImportedSnippet,
    MatchConfidence, SourceAvailability, SourceInfo,
};

/// Keychain services Termius has shipped under.
const KEY_SERVICES: [&str; 2] = ["Termius", "com.termius.mac"];
/// Keychain account names Termius has shipped under.
const KEY_ACCOUNTS: [&str; 4] = ["localKey", "TermiusKey", "key", "masterKey"];

/// Envelope version byte we know how to open.
const ENVELOPE_VERSION: u8 = 4;
/// Nonce occupies bytes 2..26 of the envelope.
const NONCE_RANGE: std::ops::Range<usize> = 2..26;
/// Ciphertext starts after the nonce.
const CIPHERTEXT_START: usize = 26;

/// The Termius import source.
pub struct TermiusSource;

/// Candidate LevelDB directories, most-specific first.
///
/// The reference exporter only handles Windows properly; these cover the
/// sandboxed and non-sandboxed macOS layouts plus the Linux ones (Termius
/// ships as both a plain Electron app and a Snap).
fn db_candidates() -> Vec<PathBuf> {
    let leveldb = ["Termius", "IndexedDB", "file__0.indexeddb.leveldb"];
    let join = |base: PathBuf| -> PathBuf {
        let mut p = base;
        for part in leveldb {
            p.push(part);
        }
        p
    };

    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };

    if cfg!(target_os = "macos") {
        let app_support = home.join("Library").join("Application Support");
        vec![
            // Sandboxed (Mac App Store) build.
            join(
                home.join("Library")
                    .join("Containers")
                    .join("com.termius.mac")
                    .join("Data")
                    .join("Library")
                    .join("Application Support"),
            ),
            // Direct download build.
            join(app_support),
        ]
    } else if cfg!(target_os = "windows") {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        vec![join(base)]
    } else {
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"));
        vec![
            join(config),
            // Snap package keeps a per-revision config tree.
            join(
                home.join("snap")
                    .join("termius-app")
                    .join("current")
                    .join(".config"),
            ),
            join(
                home.join(".var")
                    .join("app")
                    .join("com.termius.Termius")
                    .join("config"),
            ),
        ]
    }
}

/// First candidate directory that exists.
fn find_db() -> Option<PathBuf> {
    db_candidates().into_iter().find(|p| p.is_dir())
}

/// Read the 32-byte local key from the OS keychain.
///
/// Linux is intentionally unsupported here — pulling in secret-service would
/// add a dbus system dependency to the build. Linux users supply the key
/// manually, which the UI already offers as a fallback everywhere.
///
/// Each lookup is a synchronous, ACL-checked keychain round trip that can take
/// seconds, so the result is cached: `probe()` and `scan()` would otherwise
/// repeat the whole 8-way search on every call.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn key_from_keychain() -> Option<Vec<u8>> {
    use std::sync::OnceLock;
    static CACHED: OnceLock<Option<Vec<u8>>> = OnceLock::new();

    CACHED
        .get_or_init(|| {
            for service in KEY_SERVICES {
                for account in KEY_ACCOUNTS {
                    let Ok(entry) = keyring::Entry::new(service, account) else {
                        continue;
                    };
                    if let Ok(secret) = entry.get_password() {
                        if let Some(key) = parse_key(&secret) {
                            return Some(key);
                        }
                    }
                }
            }
            None
        })
        .clone()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn key_from_keychain() -> Option<Vec<u8>> {
    None
}

/// Accept the key as base64 or hex; it must decode to exactly 32 bytes.
pub(crate) fn parse_key(raw: &str) -> Option<Vec<u8>> {
    let trimmed: String = raw.split_whitespace().collect();
    if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(bytes) = hex::decode(&trimmed) {
            return Some(bytes);
        }
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(trimmed.as_bytes())
        .ok()?;
    (bytes.len() == 32).then_some(bytes)
}

/// Pull every plausible base64 envelope out of raw LevelDB bytes.
///
/// Termius envelopes start with version byte 4, which base64-encodes to a
/// leading `BA`. Scanning bytes (not text) avoids the lossy UTF-8 round-trip
/// the reference exporter works around with latin1.
pub(crate) fn scrape_blocks(bytes: &[u8]) -> Vec<&[u8]> {
    fn is_b64(b: u8) -> bool {
        b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'='
    }

    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 2 <= bytes.len() {
        if bytes[i] == b'B' && bytes[i + 1] == b'A' {
            let mut end = i + 2;
            while end < bytes.len() && is_b64(bytes[end]) {
                end += 1;
            }
            if end - i >= 32 {
                out.push(&bytes[i..end]);
                i = end;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Decrypt one scraped block, returning plaintext on success.
pub(crate) fn decrypt_block(block: &[u8], key: &[u8]) -> Option<String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(block)
        .ok()?;
    if data.first() != Some(&ENVELOPE_VERSION) || data.len() <= CIPHERTEXT_START {
        return None;
    }
    let cipher = XSalsa20Poly1305::new(Key::from_slice(key));
    let nonce = Nonce::from_slice(&data[NONCE_RANGE]);
    let plaintext = cipher.decrypt(nonce, &data[CIPHERTEXT_START..]).ok()?;
    String::from_utf8(plaintext).ok()
}

/// A decoded Termius record, bucketed by shape.
#[derive(Default)]
pub(crate) struct Records {
    /// Saved hosts: `{ address, label, os_name, … }`.
    pub hosts: Vec<Value>,
    /// Session history: `{ host, user_name, connection_type, … }`.
    pub sessions: Vec<Value>,
    /// Credentials: `{ username, password, label, … }`.
    pub identities: Vec<Value>,
    /// SSH keys: `{ label, private_key, passphrase, … }`.
    pub keys: Vec<Value>,
    /// Snippets: `{ label, script }`.
    pub snippets: Vec<Value>,
}

/// Sort decoded JSON documents into buckets by their field shape.
pub(crate) fn classify(documents: impl IntoIterator<Item = String>) -> Records {
    let mut out = Records::default();
    for doc in documents {
        if !doc.starts_with('{') {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&doc) else {
            continue;
        };
        let has = |k: &str| value.get(k).is_some_and(|v| !v.is_null());

        if has("private_key") {
            out.keys.push(value);
        } else if has("script") && has("label") {
            out.snippets.push(value);
        } else if value.get("username").is_some() && value.get("password").is_some() {
            out.identities.push(value);
        } else if has("address") && value.get("label").is_some() {
            out.hosts.push(value);
        } else if has("host") && has("user_name") && has("connection_type") {
            out.sessions.push(value);
        }
    }
    out
}

/// Read a string field, treating empty as absent.
fn str_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Read a port field, accepting both numeric and string encodings.
fn port_field(value: &Value, key: &str) -> Option<u16> {
    let raw = value.get(key)?;
    raw.as_u64()
        .or_else(|| raw.as_str().and_then(|s| s.parse().ok()))
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p > 0)
}

/// Turn a Termius key label into something usable as a vault key name.
///
/// Termius labels an imported key with the path it was read from, which can be
/// a full Windows path (`C:\Users\…\ssh_private.ppk`) or a POSIX one. Those
/// make unwieldy vault entries, so reduce a path-like label to its file stem
/// and leave hand-typed labels alone.
fn key_label_from(label: &str) -> String {
    let looks_like_path = label.contains('/') || label.contains('\\');
    if !looks_like_path {
        return label.to_string();
    }
    let file = label
        .rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(label);
    let stem = file
        .rsplit_once('.')
        .map(|(stem, _ext)| stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or(file);
    if stem.is_empty() {
        label.to_string()
    } else {
        stem.to_string()
    }
}

/// Build the preview from classified records.
pub(crate) fn build_preview(records: Records) -> ImportPreview {
    let mut warnings = Vec::new();

    // Password candidates per username. Termius stores no usable foreign key
    // between an identity and a host on the local side, so username is the
    // only join available — and it is often not unique.
    let mut passwords_by_user: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for identity in &records.identities {
        let (Some(user), Some(password)) = (
            str_field(identity, "username"),
            str_field(identity, "password"),
        ) else {
            continue;
        };
        passwords_by_user.entry(user).or_default().insert(password);
    }

    // Session history supplies the username/port a host was last reached with.
    let mut session_user: HashMap<String, String> = HashMap::new();
    let mut session_port: HashMap<String, u16> = HashMap::new();
    for session in &records.sessions {
        let Some(host) = str_field(session, "host") else {
            continue;
        };
        if let Some(user) = str_field(session, "user_name") {
            session_user.entry(host.clone()).or_insert(user);
        }
        if let Some(port) = port_field(session, "port") {
            session_port.entry(host).or_insert(port);
        }
    }

    let mut keys: Vec<ImportedKey> = Vec::new();
    let mut seen_key_labels: BTreeSet<String> = BTreeSet::new();
    for (index, key) in records.keys.iter().enumerate() {
        let Some(private_key) = str_field(key, "private_key") else {
            continue;
        };
        let mut label = str_field(key, "label")
            .map(|l| key_label_from(&l))
            .unwrap_or_else(|| format!("Termius key {}", index + 1));
        // Labels are user-supplied and not guaranteed unique.
        if !seen_key_labels.insert(label.clone()) {
            label = format!("{label} ({})", index + 1);
            seen_key_labels.insert(label.clone());
        }
        keys.push(ImportedKey {
            label,
            private_key,
            passphrase: str_field(key, "passphrase"),
        });
    }

    let mut hosts: Vec<ImportedHost> = Vec::new();
    let mut seen: BTreeSet<(String, u16)> = BTreeSet::new();
    let mut ambiguous_count = 0usize;

    for host in &records.hosts {
        let Some(address) = str_field(host, "address") else {
            continue;
        };
        let label = str_field(host, "label").unwrap_or_else(|| address.clone());
        let port = port_field(host, "port")
            .or_else(|| session_port.get(&address).copied())
            .unwrap_or(22);
        if !seen.insert((address.clone(), port)) {
            continue;
        }

        let username = str_field(host, "username")
            .or_else(|| str_field(host, "user_name"))
            .or_else(|| session_user.get(&address).cloned());

        // Attribute a password only when it is unambiguous.
        let (password, confidence, note) = match username
            .as_ref()
            .and_then(|u| passwords_by_user.get(u).map(|set| (u, set)))
        {
            Some((_, set)) if set.len() == 1 => (
                set.iter().next().cloned(),
                Some(MatchConfidence::Inferred),
                None,
            ),
            Some((user, set)) => {
                ambiguous_count += 1;
                (
                    None,
                    Some(MatchConfidence::Ambiguous),
                    Some(format!(
                        "Termius holds {} different passwords for \"{user}\" and does not record which one this host uses — set it after importing.",
                        set.len()
                    )),
                )
            }
            None => (None, None, None),
        };

        hosts.push(ImportedHost {
            label,
            hostname: address,
            port,
            username,
            group: None,
            notes: str_field(host, "os_name").map(|os| format!("OS: {os}")),
            key_label: None,
            password,
            password_confidence: confidence,
            password_note: note,
        });
    }

    hosts.sort_by_key(|h| h.label.to_lowercase());

    let snippets = records
        .snippets
        .iter()
        .filter_map(|s| {
            Some(ImportedSnippet {
                label: str_field(s, "label")?,
                script: str_field(s, "script")?,
            })
        })
        .collect();

    if ambiguous_count > 0 {
        warnings.push(format!(
            "{ambiguous_count} host(s) matched more than one saved password. Termius does not link passwords to hosts locally, so those were left blank rather than guessed."
        ));
    }
    if !records.keys.is_empty() {
        warnings.push(format!(
            "{} SSH key(s) found. Termius does not record which host uses which key locally, so keys are imported into the vault and must be attached to hosts manually.",
            records.keys.len()
        ));
    }
    if hosts.is_empty() && !records.sessions.is_empty() {
        warnings.push(
            "No saved hosts were found, but session history was. Termius may be storing hosts in a newer format than this importer understands.".into(),
        );
    }

    ImportPreview {
        hosts,
        keys,
        snippets,
        warnings,
    }
}

/// Read every LevelDB page in `dir` and return decrypted plaintexts.
fn decrypt_dir(dir: &Path, key: &[u8]) -> Result<(Vec<String>, usize, usize), ImportError> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| ImportError::Unreadable(format!("read Termius data directory: {e}")))?;

    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e == "log" || e == "ldb")
        })
        .collect();
    files.sort();

    if files.is_empty() {
        return Err(ImportError::Unreadable(
            "Termius data directory contains no LevelDB pages".into(),
        ));
    }

    let mut seen: BTreeSet<Vec<u8>> = BTreeSet::new();
    let mut plaintexts = Vec::new();
    let mut total = 0usize;

    for file in files {
        let bytes = std::fs::read(&file)
            .map_err(|e| ImportError::Unreadable(format!("read {}: {e}", file.display())))?;
        for block in scrape_blocks(&bytes) {
            // The same record appears in several pages after compaction.
            if !seen.insert(block.to_vec()) {
                continue;
            }
            total += 1;
            if let Some(text) = decrypt_block(block, key) {
                plaintexts.push(text);
            }
        }
    }

    let decrypted = plaintexts.len();
    Ok((plaintexts, decrypted, total))
}

impl ImportSource for TermiusSource {
    fn id(&self) -> &'static str {
        "termius"
    }

    fn probe(&self) -> SourceInfo {
        let path = find_db();
        let availability = match &path {
            None => SourceAvailability::NotFound,
            Some(_) if key_from_keychain().is_some() => SourceAvailability::Ready,
            Some(_) => SourceAvailability::NeedsInput {
                reason: if cfg!(any(target_os = "macos", target_os = "windows")) {
                    "Termius data found, but its encryption key could not be read from the keychain. Paste the key manually to continue.".into()
                } else {
                    "Termius data found. Paste its encryption key to continue — reading the Linux keyring is not supported.".into()
                },
            },
        };

        SourceInfo {
            id: self.id().into(),
            name: "Termius".into(),
            description: "Import hosts, SSH keys and snippets from a local Termius installation."
                .into(),
            detected_path: path.map(|p| p.display().to_string()),
            availability,
            supports_secrets: true,
        }
    }

    fn scan(&self, secret: Option<&str>) -> Result<ImportPreview, ImportError> {
        let dir = find_db().ok_or_else(|| {
            ImportError::NotFound(
                "No Termius installation found on this machine. Checked the standard data directories for this OS.".into(),
            )
        })?;

        let key = match secret.map(str::trim).filter(|s| !s.is_empty()) {
            Some(raw) => parse_key(raw).ok_or_else(|| {
                ImportError::KeyUnavailable(
                    "That key is not valid — expected 32 bytes as base64 (~44 characters, usually ending in \"=\") or 64 hex characters.".into(),
                )
            })?,
            None => key_from_keychain().ok_or_else(|| {
                ImportError::KeyUnavailable(
                    "Termius's encryption key could not be read from the keychain. Open Keychain Access, search for \"Termius\", copy the password from the localKey entry, and paste it here.".into(),
                )
            })?,
        };

        let (plaintexts, decrypted, total) = decrypt_dir(&dir, &key)?;

        if total > 0 && decrypted == 0 {
            return Err(ImportError::KeyUnavailable(
                "Found encrypted Termius data but none of it could be decrypted — the key does not match this installation.".into(),
            ));
        }

        let mut preview = build_preview(classify(plaintexts));

        // Partial decryption is normal: LevelDB retains superseded pages whose
        // records were written under an older key. Only mention it if a
        // meaningful share failed, so the user can judge completeness.
        if total > 0 && decrypted * 10 < total * 9 {
            preview.warnings.push(format!(
                "Decrypted {decrypted} of {total} stored records. The rest are likely stale entries left behind by Termius and can usually be ignored."
            ));
        }

        Ok(preview)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crypto_secretbox::aead::{AeadCore, OsRng};

    fn seal(key: &[u8], plaintext: &str) -> Vec<u8> {
        let cipher = XSalsa20Poly1305::new(Key::from_slice(key));
        let nonce = XSalsa20Poly1305::generate_nonce(&mut OsRng);
        let ct = cipher.encrypt(&nonce, plaintext.as_bytes()).unwrap();
        let mut envelope = vec![ENVELOPE_VERSION, 0];
        envelope.extend_from_slice(&nonce);
        envelope.extend_from_slice(&ct);
        base64::engine::general_purpose::STANDARD
            .encode(envelope)
            .into_bytes()
    }

    /// Phase timing against a real profile. Prints no secret values.
    /// Run with: `cargo test -p infrastructure --release profile_real -- --ignored --nocapture`
    #[test]
    #[ignore = "requires a local Termius installation"]
    fn profile_real_profile() {
        use std::time::Instant;

        let Some(dir) = find_db() else {
            println!("no Termius install");
            return;
        };
        let Some(key) = key_from_keychain() else {
            println!("no keychain key");
            return;
        };

        let t = Instant::now();
        let mut pages = Vec::new();
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = entry.path();
            if p.extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| x == "log" || x == "ldb")
            {
                pages.push(std::fs::read(&p).unwrap());
            }
        }
        let total_bytes: usize = pages.iter().map(|p| p.len()).sum();
        println!(
            "read     : {:?} ({} pages, {:.1} MB)",
            t.elapsed(),
            pages.len(),
            total_bytes as f64 / 1e6
        );

        let t = Instant::now();
        let mut blocks = Vec::new();
        for p in &pages {
            blocks.extend(scrape_blocks(p));
        }
        println!("scrape   : {:?} ({} candidates)", t.elapsed(), blocks.len());

        let t = Instant::now();
        let mut seen = BTreeSet::new();
        let mut unique = Vec::new();
        for b in blocks {
            if seen.insert(b.to_vec()) {
                unique.push(b);
            }
        }
        println!("dedup    : {:?} ({} unique)", t.elapsed(), unique.len());

        let t = Instant::now();
        let mut texts = Vec::new();
        for b in &unique {
            if let Some(s) = decrypt_block(b, &key) {
                texts.push(s);
            }
        }
        println!("decrypt  : {:?} ({} ok)", t.elapsed(), texts.len());

        let t = Instant::now();
        let records = classify(texts);
        println!("classify : {:?}", t.elapsed());

        let t = Instant::now();
        let preview = build_preview(records);
        println!(
            "build    : {:?} ({} hosts)",
            t.elapsed(),
            preview.hosts.len()
        );
    }

    #[test]
    fn parses_base64_and_hex_keys() {
        let key = [7u8; 32];
        let b64 = base64::engine::general_purpose::STANDARD.encode(key);
        assert_eq!(parse_key(&b64).unwrap(), key);
        assert_eq!(parse_key(&hex::encode(key)).unwrap(), key);
        // Whitespace from a copy/paste is tolerated.
        assert_eq!(parse_key(&format!("  {b64}  ")).unwrap(), key);
    }

    #[test]
    fn rejects_keys_of_the_wrong_length() {
        assert!(parse_key("").is_none());
        assert!(parse_key("dG9vIHNob3J0").is_none());
        assert!(parse_key("not base64 at all !!!").is_none());
    }

    #[test]
    fn round_trips_an_envelope() {
        let key = [3u8; 32];
        let block = seal(&key, r#"{"label":"web-01"}"#);
        assert_eq!(
            decrypt_block(&block, &key).as_deref(),
            Some(r#"{"label":"web-01"}"#)
        );
    }

    #[test]
    fn rejects_a_wrong_key_without_panicking() {
        let block = seal(&[3u8; 32], "secret");
        assert!(decrypt_block(&block, &[9u8; 32]).is_none());
    }

    #[test]
    fn ignores_envelopes_with_an_unknown_version() {
        let mut envelope = vec![9u8, 0];
        envelope.extend_from_slice(&[0u8; 24]);
        envelope.extend_from_slice(&[1u8; 32]);
        let block = base64::engine::general_purpose::STANDARD
            .encode(envelope)
            .into_bytes();
        assert!(decrypt_block(&block, &[3u8; 32]).is_none());
    }

    #[test]
    fn scrapes_blocks_out_of_surrounding_binary_noise() {
        let key = [5u8; 32];
        let block = seal(&key, r#"{"address":"10.0.0.1","label":"core"}"#);
        let mut page = vec![0x00, 0xFF, 0x42, 0x00];
        page.extend_from_slice(&block);
        page.extend_from_slice(&[0x00, 0x01, 0xFE]);

        let found = scrape_blocks(&page);
        assert_eq!(found.len(), 1);
        assert!(decrypt_block(found[0], &key).is_some());
    }

    #[test]
    fn treats_saved_hosts_not_session_history_as_hosts() {
        let records = classify(vec![
            r#"{"version":1,"address":"10.0.0.1","label":"core-sw","os_name":"ios"}"#.into(),
            // Session history for the same box must not become a second host.
            r#"{"host":"10.0.0.1","user_name":"admin","connection_type":"ssh","port":22}"#.into(),
        ]);
        assert_eq!(records.hosts.len(), 1);
        assert_eq!(records.sessions.len(), 1);

        let preview = build_preview(records);
        assert_eq!(preview.hosts.len(), 1);
        let host = &preview.hosts[0];
        assert_eq!(host.hostname, "10.0.0.1");
        assert_eq!(host.label, "core-sw");
        // Username is backfilled from session history.
        assert_eq!(host.username.as_deref(), Some("admin"));
    }

    #[test]
    fn attaches_a_password_only_when_it_is_unambiguous() {
        let preview = build_preview(classify(vec![
            r#"{"address":"10.0.0.1","label":"a","username":"solo"}"#.into(),
            r#"{"username":"solo","password":"only-one","label":""}"#.into(),
        ]));
        let host = &preview.hosts[0];
        assert_eq!(host.password.as_deref(), Some("only-one"));
        assert_eq!(host.password_confidence, Some(MatchConfidence::Inferred));
    }

    #[test]
    fn refuses_to_guess_between_competing_passwords() {
        let preview = build_preview(classify(vec![
            r#"{"address":"10.0.0.1","label":"a","username":"root"}"#.into(),
            r#"{"username":"root","password":"one","label":""}"#.into(),
            r#"{"username":"root","password":"two","label":""}"#.into(),
        ]));
        let host = &preview.hosts[0];
        assert!(
            host.password.is_none(),
            "must not pick a password at random"
        );
        assert_eq!(host.password_confidence, Some(MatchConfidence::Ambiguous));
        assert!(host.password_note.is_some());
        assert!(preview.warnings.iter().any(|w| w.contains("more than one")));
    }

    #[test]
    fn deduplicates_hosts_by_address_and_port() {
        let preview = build_preview(classify(vec![
            r#"{"address":"10.0.0.1","label":"first","port":22}"#.into(),
            r#"{"address":"10.0.0.1","label":"duplicate","port":22}"#.into(),
            r#"{"address":"10.0.0.1","label":"other-port","port":2222}"#.into(),
        ]));
        assert_eq!(preview.hosts.len(), 2);
    }

    #[test]
    fn shortens_path_like_key_labels() {
        assert_eq!(
            key_label_from(r"C:\Users\Josh\OneDrive - CENTRA\Keys\ssh_private.ppk"),
            "ssh_private"
        );
        assert_eq!(
            key_label_from("/Users/Josh//Downloads/aus-credentials/freedom-prod-keys.pem"),
            "freedom-prod-keys"
        );
        // A plain label is left untouched, dots and all.
        assert_eq!(key_label_from("Kinetix SSH Key"), "Kinetix SSH Key");
        assert_eq!(
            key_label_from("mikrotik_controller.pem"),
            "mikrotik_controller.pem"
        );
    }

    #[test]
    fn disambiguates_duplicate_key_labels() {
        let preview = build_preview(classify(vec![
            r#"{"label":"id_rsa","private_key":"-----BEGIN A-----","passphrase":""}"#.into(),
            r#"{"label":"id_rsa","private_key":"-----BEGIN B-----","passphrase":"pp"}"#.into(),
        ]));
        assert_eq!(preview.keys.len(), 2);
        assert_ne!(preview.keys[0].label, preview.keys[1].label);
        assert_eq!(preview.keys[1].passphrase.as_deref(), Some("pp"));
    }

    #[test]
    fn keeps_key_records_out_of_the_identity_bucket() {
        // A key record also carrying username/password fields must stay a key.
        let records = classify(vec![
            r#"{"label":"k","private_key":"-----BEGIN X-----","username":"u","password":"p"}"#
                .into(),
        ]);
        assert_eq!(records.keys.len(), 1);
        assert_eq!(records.identities.len(), 0);
    }

    #[test]
    fn accepts_ports_encoded_as_strings() {
        let preview = build_preview(classify(vec![
            r#"{"address":"10.0.0.1","label":"a","port":"2222"}"#.into(),
        ]));
        assert_eq!(preview.hosts[0].port, 2222);
    }

    #[test]
    fn defaults_to_port_22_when_absent_or_invalid() {
        let preview = build_preview(classify(vec![
            r#"{"address":"10.0.0.1","label":"a"}"#.into(),
            r#"{"address":"10.0.0.2","label":"b","port":0}"#.into(),
        ]));
        assert!(preview.hosts.iter().all(|h| h.port == 22));
    }

    #[test]
    fn skips_malformed_documents_without_failing_the_import() {
        let preview = build_preview(classify(vec![
            "not json at all".into(),
            "{ truncated".into(),
            r#"{"address":"10.0.0.1","label":"good"}"#.into(),
        ]));
        assert_eq!(preview.hosts.len(), 1);
    }
}
