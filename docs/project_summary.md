# Project Summary: SSHBool

This document provides a comprehensive technical overview of **SSHBool**, detailing its vision, architecture, tech stack, data model, security mechanisms, and feature implementations.

---

## 1. Vision & Strategy

**SSHBool** is a native, premium, blazing-fast desktop workspace that unifies remote infrastructure workflows. 
Instead of fragmenting work across terminal emulators, SFTP clients, database GUIs, Docker panels, and browser tabs, SSHBool operates on a **"Connect once, do everything"** model. 

### Core Product Pillars
1. **Native Performance**: Built on Rust core + Tauri v2, avoiding the heavy memory footprint of Electron. Cold starts are sub-second (< 800ms).
2. **Premium UX**: Keyboard-first design featuring modern glassmorphism, dynamic color themes, and fluid animations.
3. **Security by Default**: Secure local memory storage, Argon2id key derivation, AES-256 encrypted local vaults, and support for hardware keys (FIDO2/YubiKey).
4. **Multiplexed Transport**: One active SSH connection multiplexes multiple channels for Shell, SFTP, Docker, DB queries, Kubernetes, and diagnostics.
5. **Local-First, Cloud-Optional**: All host data, credentials, and settings live locally. Optional pairing for multi-device sync is fully end-to-end encrypted (E2EE).

---

## 2. Technical Stack

| Layer | Technologies / Libraries |
|---|---|
| **Shell/OS Desktop Wrapper** | **Tauri v2** (Rust) |
| **Frontend Framework** | **React 19** + **TypeScript** + **Vite** |
| **Routing & Navigation** | **TanStack Router** |
| **State Management** | **Zustand** (Local UI state), **TanStack Query (v5)** (Server data fetching/caching) |
| **Styling & Components** | **TailwindCSS v4**, **Base UI**, **Shadcn** (utility patterns) |
| **Terminal Emulator** | **Xterm.js** + WebGL/Canvas renderers + WebLinks & Fit addons |
| **Text Editor** | **Monaco Editor** (Remote files syntax-highlighting & diffing) |
| **Backend Language** | **Rust** (Clean/Hexagonal Architecture) |
| **Database Storage** | **SQLite** + **SQLx** (Encrypted via **SQLCipher** AES-256) |
| **Crypto & KDF** | **Argon2id** (KDF), **Ring** / **RustCrypto** (Enveloping) |
| **SSH Transport** | **russh** (Async SSH client library in Rust) |

---

## 3. Architecture & Codebase Layout

The project follows a **Hexagonal / Clean Architecture** pattern inside the Rust backend and a **Feature-based Structure** in the React frontend.

### Folder Structure
```
sshbool/
├── docs/                      # Single source of truth specifications
├── src/                       # Frontend React Workspace
│   ├── components/            # Shared UI components (layout, buttons, overlays)
│   ├── features/              # Feature-isolated code
│   │   ├── home/              # Overview, statistics, last server, audit preview
│   │   ├── connections/       # Host connection tree, connection states, tags
│   │   ├── terminal/          # Xterm workspace integration
│   │   ├── sftp/              # Dual-pane file manager
│   │   ├── editor/            # Remote Monaco file editor
│   │   ├── databases/         # Auto-detection and query client runner
│   │   ├── kubernetes/        # Kubernetes Pods/Deployments listing & logs
│   │   └── vault/             # Vault unlock screens, SSH key management
│   ├── lib/                   # IPC wrappers, general utils, schemas
│   └── stores/                # Zustand global stores (layout, connection, sessions)
├── src-tauri/                 # Backend Rust Workspace
│   ├── crates/
│   │   ├── domain/            # Entities, abstract repositories, domain errors
│   │   ├── infrastructure/    # Concrete DB execution, Crypto wrapper, SSH Manager
│   │   └── application/       # Use cases and domain coordination services
│   ├── src/
│   │   ├── commands/          # Tauri IPC Command endpoints (hosts, vault, phase2, phase3)
│   │   ├── error.rs           # IPC-friendly serialized error maps
│   │   └── lib.rs             # Tauri builders, command setup, and app bootstrap
│   └── Cargo.toml             # Rust workspace dependencies
└── package.json               # NodeJS dependencies and bundler scripts
```

---

## 4. How SSHBool Works (Core Flows)

### A. Bootstrapping & Vault Security
1. On start, `src-tauri/src/lib.rs` executes `AppState::bootstrap()`.
2. It checks if `sshbool.db` exists and whether the vault is initialized.
3. If locked, the frontend displays `UnlockScreen`. The user enters the master password.
4. The backend derives the SQLCipher key using **Argon2id** from the master password and unlocks the SQLite pool.
5. In-memory data structures are initialized, and the SQLite connections are established.

### B. Multiplexed SSH Connections
1. The user selects a host from the side panel and clicks **Connect**.
2. Frontend calls `ipc.sessionOpen(hostId)`.
3. The backend connection manager (`infrastructure/src/ssh/manager.rs`):
   - Opens a single TCP socket to the remote host (optionally traversing SOCKS5/HTTP proxies or Jump Hosts).
   - Performs SSH handshake and authenticates using passwords, local private keys, SSH agents, or FIDO2 hardware tokens.
   - Caches the open active connection wrapper in a global `ConnectionMap`.
4. When a user opens terminal tabs, SFTP file panels, Docker explorers, or Database queries, Tauri initiates independent async SSH channels over the **same, single TCP connection**, ensuring no overhead or duplicate connections are created.

### C. Database Auto-Detection & Query Execution
1. In the **Databases** feature, users can click **Scan Server**.
2. Backend runs a custom light-weight bash script on the remote host over SSH:
   - Probes local ports `5432` (Postgres), `3306` (MySQL), `6379` (Redis), `27017` (MongoDB) by checking `/proc/net/tcp` or `ss` sockets.
   - Runs local CLI commands (e.g. `psql -l`, `mysql -e 'SHOW DATABASES'`) without password prompts where peer-auth allows, to inspect running database schemas.
   - Returns structured string maps of found databases back to Tauri.
3. Frontend renders the detected database engines as beautiful cards with vendor-matching gradients (Blue Postgres, Orange MySQL, Red Redis, Green MongoDB).
4. Users click **Add** to automatically create database profiles in their Vault.
5. Query commands run the target CLI client on the remote host and return the raw output table inside a custom Unix terminal console output component.

---

## 5. Security Architecture

1. **At-Rest Encryption**: All database records (including hosts metadata, snippets, notes) are stored in an encrypted SQLite database using **SQLCipher (AES-256)**.
2. **In-Flight Encryption**: Remote commands, transfers, and console streams run strictly inside SSH-2 channels.
3. **Secret Enveloping**: Highly sensitive columns (passwords, private keys, auth tokens) are double-encrypted in the database. They are sealed using an internal `sealed_secret` wrapper and only decrypted inside Rust secure memory blocks when initiating connection handshakes.
4. **Zeroization**: Cryptographic keys and plaintext passwords implement Rust's `Zeroize` trait to overwrite their memory space with zeros as soon as they drop out of scope.
