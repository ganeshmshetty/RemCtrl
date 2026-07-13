# Persistence, Storage, and Security

RemoteCtrl manages local data stores and credentials securely on the user's host machine.

---

## 1. Storage Location

All configuration, logs, and profiles are stored under the Electron user data directory (`app.getPath('userData')`):
*   **macOS**: `~/Library/Application Support/RemoteCtrl/`
*   **Windows**: `%APPDATA%\RemoteCtrl\`
*   **Linux**: `~/.config/RemoteCtrl/`

---

## 2. File Orchestration (`storage.ts`)

Filesystem updates are managed by `src/main/storage.ts`. To prevent data corruption during write operations (e.g. system power failures or sudden application terminations), RemoteCtrl employs an **Atomic Write Pattern**:

1.  The payload is formatted as a JSON string.
2.  The data is written to a temporary sibling file (e.g. `settings.json.tmp`).
3.  The main process executes `fs.renameSync()` to atomically replace the target file (e.g. `settings.json`) with the temp file.

---

## 3. Secure API Key Storage

API keys must never be stored in plain text or leaked to client-side logs. RemoteCtrl secures API credentials using **OS-Level Native Encryption**:
*   **Encryption**: Before keys are written to `api-keys.json`, they are encrypted using Electron's `safeStorage` API.
*   **safeStorage**: This API leverages macOS Keychain, Windows DPAPI, or Linux secret service providers to encrypt keys bound to the local user account.
*   **Decryption**: When a session starts, keys are decrypted in memory in the Main process and passed directly to the LLM model client. Decrypted keys never enter the Renderer process.

---

## 4. Browser Profiles

Custom Chrome profiles (storing session cookies, cache files, and browser history) are saved under:
```
[userData]/browser-profiles/[profileName]/
```
When launching persistent browser contexts, Playwright mounts this directory. This allows users to remain logged into websites (such as GitHub, Gmail, or Slack) across automated runs without re-authenticating.
