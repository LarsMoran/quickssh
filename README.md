# quickssh

Lightweight Tauri desktop MVP to manage SSH-based Docker hosts.

## Implemented in this scaffold

- Host workspace persistence to local JSON storage:
  - add/edit/delete host
  - select active host
- Container listing for selected host via SSH:
  - `ssh <target> docker ps --format '{{json .}}'`
  - fields: name, status, image, ports
- Desktop-first UI for host switching and container refresh.

## Run locally

1. Install dependencies:
   - `npm install`
2. Start in development mode:
   - `npm run tauri dev`

## Notes

- Hosts are stored in the OS local data directory under `quickssh/workspaces.json`.
- Authentication relies on local SSH setup (`ssh-agent`/keys), no credentials are stored in app config.
