# RemoteCtrl Agent Guidelines

This directory acts as the central source of truth for AI agents and coding assistants working on the RemoteCtrl codebase.

## Project Summary
RemoteCtrl is a remote browser control desktop application built with **Electron + React + TypeScript + Playwright + WebRTC**. It enables users to run local and remote browser automations, build workflows with a drag-and-drop editor, stream browser interactions via WebRTC, and manage persistent Chrome profiles.

---

## Technical Constraints & Guidelines

### 1. Architectural Boundaries
- **Renderer Isolation**: The React renderer MUST NOT access Node.js APIs or electron imports directly. All operations must go through the Secure Context Bridge exposed on `window.RemoteCtrlAPI`.
- **IPC Validation**: All IPC payloads received in the main process (`src/main/ipc/`) MUST be validated using Zod schemas defined in `src/shared/schemas.ts` before execution.
- **State Management**: Use Zustand stores (`src/renderer/stores/`) to coordinate client UI states, connection status, workflow definitions, and agent logs.

### 2. Configuration & Data Storage
All persistent user data is located under the user config directory:
- **API Keys**: Saved in `~/.config/RemoteCtrl/api-keys.json` (must never leak into renderer state or logs).
- **Settings**: Saved in `~/.config/RemoteCtrl/settings.json`.
- **Workflows**: Saved in `~/.config/RemoteCtrl/workflows.json`.
- **Browser Profiles**: Custom isolated directories are stored in `~/.config/RemoteCtrl/browser-profiles/[profileName]`.

### 3. Browser & Execution Lifecycle
- **Detached Persistent Browsers**: If `keepBrowserOpenOnQuit` is enabled, the browser is launched as a detached background process on port `9223` (`INTERNAL_CDP_PORT`) and connected via `connectOverCDP` to `127.0.0.1`.
- **Clean Fallbacks**: Startup logic always checks if a Chrome process is already running on the port before launching a new context to avoid directory locking errors.
- **Graceful Quit**: The `'before-quit'` event handler in `index.ts` blocks default quitting with `e.preventDefault()`, executes asynchronous cleanups, and then calls `app.quit()` when done.

### 4. UI & Aesthetics
- **Brighter Thoughts & Steps**: Log step-pills inside the `AgentPanel` use `var(--text-secondary)` for optimal readability.
- **Collapsable Groups**: Consecutive log step-pills (`msg.type === 'log'`) are grouped into the `<CollapsableLogs>` component to prevent chat interface clutter.
- **Design Invariants**: Follow styling tokens defined in `src/renderer/index.css` for consistent glassmorphism, high-contrast text layout, and animated states.
