//! Domain layer — entities, ports, and domain errors. No I/O.

#![deny(warnings)]
#![warn(missing_docs)]

pub mod connections;
pub mod error;
pub mod ids;
pub mod vault;

pub use error::DomainError;
