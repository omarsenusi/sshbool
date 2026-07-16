//! Typed identifiers.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident) => {
        /// Strongly-typed UUID identifier.
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub struct $name(pub String);

        impl $name {
            /// Create a new time-ordered UUID v7 id.
            pub fn new() -> Self {
                Self(Uuid::now_v7().to_string())
            }

            /// Borrow as str.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }
    };
}

id_type!(HostId);
id_type!(GroupId);
id_type!(KeyId);
id_type!(CredentialId);
id_type!(SessionId);
id_type!(PaneId);
id_type!(JobId);
id_type!(SnippetId);
id_type!(NoteId);
