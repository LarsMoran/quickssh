# AGENTS.md

## Project Goal
Build `quickssh` as a lightweight desktop MVP for managing SSH-based Docker hosts from one place.

Primary user outcome:
- quickly switch between predefined hosts/workspaces
- inspect running containers on a selected host
- view recent and live container logs
- start/stop local port forwards to remote services

## Product Scope (MVP)
`quickssh` should provide a simple, fast UI with minimal setup:

- Host workspaces:
  - add/edit/remove hosts (name, ssh target, optional notes)
  - quick host selection from sidebar/list

- Containers view:
  - fetch container list from selected host
  - show status, name, image, ports
  - refresh on demand

- Logs view:
  - open logs for a chosen container
  - show tail + follow mode
  - basic search/filter in visible logs (optional for first cut)

- Port forwarding:
  - create local -> remote forward rules
  - show active forwards and allow stop/restart
  - validate local port conflicts before start

## Technical Direction
- Desktop app with `Tauri`.
- Rust backend commands orchestrate `ssh` and `docker` CLI.
- Frontend focuses on fast operator UX (host switch < 1 click).
- Keep credentials out of app storage where possible (prefer ssh-agent/keys).

## Non-Goals (MVP)
- No Kubernetes support.
- No remote deploy/orchestration workflows.
- No multi-user auth model.

## Quality Bar
- Reliable host switching and command execution.
- Clear error states (ssh unavailable, docker unavailable, auth failure).
- Predictable process cleanup for log streams and port-forward subprocesses.
- Minimal but readable UI on desktop and laptop resolutions.

## Next Steps
1. Scaffold Tauri project structure.
2. Implement host workspace persistence.
3. Add container listing command.
4. Add logs streaming command.
5. Add port-forward lifecycle management.
6. Wire UI flows for all MVP features.
