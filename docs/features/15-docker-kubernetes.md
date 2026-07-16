# Feature 15 — Docker & Kubernetes

Backend: `infrastructure/docker/*`, `infrastructure/kubernetes/*` (doc 05 §3.5); domain `containers`;
UI `features/containers`.

## 1. Scope checklist

Containers · Images · Volumes · Networks · Compose · Logs · Restart · Shell · Stats.
(Kubernetes support included as an extension of this feature, feature-gated.)

## 2. Connectivity model

- No local Docker Desktop dependency — we talk to the **remote** host's Docker Engine by forwarding
  its Unix socket (`/var/run/docker.sock`) over a `direct-tcpip`-style channel on the existing SSH
  connection (reusing the multiplexed connection, doc 01 §7), then speaking the Docker Engine API
  over that forwarded stream via **bollard**.
- Requires the connecting user to have docker socket access on the remote host (group `docker` or
  root); if absent, a clear `AppError` explains the permission requirement rather than failing silently.
- Kubernetes (feature-gated behind `kubernetes` Cargo feature) connects similarly: the remote
  `kubeconfig`/API server is reached via a forwarded port, using the **kube** crate.

## 3. Containers tab

- `ContainersTab` lists all containers (running + stopped) with name, image, status, ports, live
  CPU/mem (from `ContainerStats` polling), and inline actions: start/stop/restart/remove.
- **Shell** action (`docker_exec`) opens a new terminal pane running `docker exec -it <id> sh` (or
  configured shell), fully integrated with the Terminal feature (doc `features/12-terminal.md`) —
  splits/tabs/recording all work identically on a container shell.
- **Logs** (`docker_logs_start/stop`) streams via `docker://logs/{containerId}` into a virtualized,
  follow-tailing `ContainerLogsView` with search and stream (stdout/stderr) filters.
- **Stats** (`docker_stats_start`) streams via `docker://stats/{containerId}` into a live
  CPU/mem/net/block-IO view, reusing the dashboard's lightweight chart primitives (doc 06 §4.6).
- Destructive actions (remove, force-stop) require confirmation; removing a running container
  warns explicitly.

## 4. Images tab

- `ImagesTab` lists images (repo, tag, size, created, dangling flag) with pull (`docker_pull`,
  streams progress as a `TransferJob`-style job), remove, and prune-dangling actions.
- Pulling shows layered progress (per-layer download %) similar to the Docker CLI.

## 5. Volumes & Networks tabs

- `docker_list_volumes`/`docker_list_networks` show usage (which containers mount/attach), with
  remove actions guarded when still in use (Docker's own constraint, surfaced as a friendly error).

## 6. Compose tab

- Auto-discovers `docker-compose.yml`/`compose.yaml` files under configured project roots (or
  manually added via `compose_files`, doc 04 §3.6) on the remote host.
- `ComposeProjectCard` shows project name, service count, up/down state; actions `compose_action`
  (up/down/restart) execute `docker compose <cmd>` via an exec channel with streamed output shown
  inline (not a full terminal takeover, but a dismissible output panel).
- Compose file content is cached (`compose_files.content_cache`) for quick display/diff; edits open
  in the Remote Editor (doc `features/13-remote-editor.md`) for full Monaco/YAML support.

## 7. Kubernetes panel (feature-gated)

- `KubernetesPanel`: `ContextPicker` (from `k8s_contexts`), `PodsTab` (namespace-scoped pod list
  with status/restarts/age), `PodLogsView` (streamed, follow-tailing like container logs), pod
  shell exec (opens a terminal pane), and basic manifest apply/delete for common resource kinds.
- This panel ships behind a settings toggle / Cargo feature so users who don't need k8s pay zero
  runtime/bundle cost for it (dynamic import on the frontend, feature flag on the backend).

## 8. Commands & events

`docker_list_containers`, `docker_container_action`, `docker_exec`, `docker_logs_start/stop`,
`docker_stats_start`, `docker_list_images`, `docker_pull`, `docker_image_remove`,
`docker_list_volumes`, `docker_list_networks`, `compose_list`, `compose_action`, `k8s_list_pods`,
`k8s_pod_logs` (doc 07 §4.6). Events: `docker://logs/{containerId}`, `docker://stats/{containerId}`.

## 9. Acceptance criteria

- List, start/stop/restart/remove containers on a real remote Docker host; shell into a running
  container and run commands interactively.
- Stream logs and stats for a busy container without UI jank (virtualized, throttled).
- Pull an image with visible per-layer progress; prune dangling images.
- Bring a real compose project up/down and see status reflected correctly.
- With the `kubernetes` feature disabled, the K8s panel and its bundle are entirely absent from
  the shipped app (verified via bundle analysis).
