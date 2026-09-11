# Security Policy

## Supported Versions

Currently, the SSHBool project is in active development. Only the latest release on the main branch is officially supported for security updates. 

| Version              | Supported          |
| -------------------- | ------------------ |
| v0.1.7 and later     | :white_check_mark: |
| Before v0.1.4        | :x:                |

## Reporting a Vulnerability

We take the security of SSHBool and our users' data very seriously. If you discover a vulnerability, we would like to know about it so we can take steps to address it as quickly as possible.

Please do **not** report security vulnerabilities through public GitHub issues. 

Instead, please report them by sending an email to our security team or the maintainer (replace with actual contact info, e.g., `security@sshbool.com`). We will acknowledge receipt of your vulnerability report and strive to send you regular updates about our progress.

## Security Architecture Overview

SSHBool is designed with a defense-in-depth approach to protect user credentials, connections, and metadata:

- **Local Encryption at Rest:** Sensitive credentials, private keys, and secrets stored in the local SQLite database are individually encrypted at rest using application-layer AEAD (AES-256-GCM) with Data Encryption Keys (DEK) derived from the Master Password via Argon2id.
- **Secure Memory:** Sensitive keys and passwords are held in zeroizing wrappers (`secrecy`/`zeroize`) that scrub memory upon drop, minimizing exposure to memory-reading malware.
- **Biometric Integration:** Support for OS-level biometric authentication (Windows Hello, TouchID, Linux Secret Service) to securely unwrap the Data Encryption Key (DEK).
- **Capability Sandboxing:** The Tauri frontend is strictly sandboxed. There is no ambient filesystem or shell access from the webview; all privileged actions route through strictly-typed Rust commands.
- **Connection Integrity:** Strict host-key verification (TOFU/strict modes) prevents MITM attacks on SSH connections.
- **Network Security:** All external API calls (sync, AI, updates) enforce full TLS certificate chain validation.

For more detailed information regarding the security architecture, threat model, and key hierarchy, please refer to the internal documentation located in `docs/22-security.md`.
