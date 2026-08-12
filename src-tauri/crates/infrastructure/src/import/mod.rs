//! Modular importers for third-party SSH clients.
//!
//! Every source implements [`ImportSource`], so adding a client (SecureCRT,
//! PuTTY, Royal TSX, …) means adding a module here and registering it in
//! [`sources`] — the IPC layer and the UI stay unchanged.
//!
//! Importers are strictly read-only with respect to the foreign application:
//! they parse its files and never write to them.

use serde::{Deserialize, Serialize};

pub mod termius;

/// Whether a source can be read on this machine right now.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SourceAvailability {
    /// Data was found and can be read.
    Ready,
    /// The app is installed but something is missing (locked key, no data).
    NeedsInput {
        /// Human-readable explanation of what is missing.
        reason: String,
    },
    /// No trace of the application on this machine.
    NotFound,
}

/// What an importer advertises about itself before it runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    /// Stable identifier used by the IPC layer (e.g. `termius`).
    pub id: String,
    /// Display name.
    pub name: String,
    /// One-line description of what will be read.
    pub description: String,
    /// Where the data was found, if anywhere.
    pub detected_path: Option<String>,
    /// Current availability.
    pub availability: SourceAvailability,
    /// True when the source can supply secrets (passwords / private keys).
    pub supports_secrets: bool,
}

/// Confidence that an imported secret belongs to the host it is attached to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MatchConfidence {
    /// The source linked them explicitly (by id).
    Exact,
    /// Inferred, and the inference was unambiguous.
    Inferred,
    /// Inferred, but more than one candidate existed — do not auto-apply.
    Ambiguous,
}

/// A host discovered in a foreign client, normalized to SSHBool's model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedHost {
    /// Display label.
    pub label: String,
    /// Hostname or IP.
    pub hostname: String,
    /// Port.
    pub port: u16,
    /// Login user, when known.
    pub username: Option<String>,
    /// Group / folder path in the source, if any.
    pub group: Option<String>,
    /// Free-form note carried over from the source.
    pub notes: Option<String>,
    /// Label of the SSH key this host uses, matched against [`ImportedKey`].
    pub key_label: Option<String>,
    /// Password, when the source held one and it could be attributed.
    pub password: Option<String>,
    /// How confident we are that `password` belongs to this host.
    pub password_confidence: Option<MatchConfidence>,
    /// Why the password is ambiguous, shown in the preview UI.
    pub password_note: Option<String>,
}

/// An SSH private key discovered in a foreign client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedKey {
    /// Display label.
    pub label: String,
    /// Private key PEM.
    pub private_key: String,
    /// Passphrase protecting the PEM, if the source stored one.
    pub passphrase: Option<String>,
}

/// A saved command snippet discovered in a foreign client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSnippet {
    /// Display label.
    pub label: String,
    /// Script body.
    pub script: String,
}

/// Everything an importer found, before the user chooses what to keep.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// Hosts found.
    pub hosts: Vec<ImportedHost>,
    /// Keys found.
    pub keys: Vec<ImportedKey>,
    /// Snippets found.
    pub snippets: Vec<ImportedSnippet>,
    /// Non-fatal problems worth showing the user.
    pub warnings: Vec<String>,
}

/// A third-party client SSHBool can import from.
pub trait ImportSource {
    /// Stable id, used over IPC.
    fn id(&self) -> &'static str;

    /// Describe this source and whether it can be read right now.
    fn probe(&self) -> SourceInfo;

    /// Read and normalize everything this source holds.
    ///
    /// `secret` is source-specific (for Termius, an optional manually supplied
    /// local key). Importers must not mutate the foreign application's data.
    fn scan(&self, secret: Option<&str>) -> Result<ImportPreview, ImportError>;
}

/// Failure modes shared by all importers.
#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    /// The source's data directory could not be located.
    #[error("{0}")]
    NotFound(String),
    /// The decryption key could not be obtained.
    #[error("{0}")]
    KeyUnavailable(String),
    /// The data was found but could not be read or decoded.
    #[error("{0}")]
    Unreadable(String),
}

/// Every importer known to the app.
pub fn sources() -> Vec<Box<dyn ImportSource + Send + Sync>> {
    vec![Box::new(termius::TermiusSource)]
}

/// Look up a single importer by id.
pub fn source_by_id(id: &str) -> Option<Box<dyn ImportSource + Send + Sync>> {
    sources().into_iter().find(|s| s.id() == id)
}
