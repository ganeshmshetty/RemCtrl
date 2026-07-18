# UI improvement log

## 2026-07-19 · Session clarity and renderer resilience

- Added a live session-status chip to the title bar for ready, working, paused, approval-needed, and waiting-for-controller states.
- Added semantic tab/tabpanel and menu roles to the session sidebar, plus keyboard-resizable split-pane handles with visible focus states.
- Reworked the agent empty state to explain the browser coworker model and provide clearer task examples.
- Guarded the controller WebRTC hook when the Electron preload bridge is unavailable, keeping local renderer smoke testing error-free.

Verified:

- `npm run typecheck`
- `npm test` — 16 files, 43 tests passed
- `npm run build:renderer`
- Local Vite smoke check in the in-app browser, including local-session transition and fresh-tab console error check

Still needs manual verification:

- Electron-hosted WebRTC host/controller pairing, takeover approval, and stream reconnect behavior.
- Keyboard resize behavior at the minimum and maximum sidebar widths in the packaged desktop window.
- Full repository lint cleanup; the current baseline reports unrelated main-process and renderer issues.

## 2026-07-19 · Remote session state surfaces

- Reworked browser waiting, host approval, connecting, stream-waiting, and disconnected states into a shared state-card pattern.
- Made the host PIN treatment clearer, added a security explanation, and gave controller approval a readable requester/task summary.
- Added explicit status copy and next actions for each remote-session transition without changing the underlying signaling or approval handlers.

Verified:

- `npm run typecheck:all`
- `npm test` — 16 files, 43 tests passed
- `npm run build:renderer`
- Local renderer smoke check with a fresh local session and no console errors
- Keyboard sidebar resize: `aria-valuenow` changed from 384 to 400 on ArrowLeft

## 2026-07-19 · Reference-informed command surface

Reference patterns reviewed from the existing `research/` folder and disposable external clones of NanoBrowser, OpenCode, Plane, shadcn/ui, browser-use, and Palot. The most relevant patterns were task-first history, compact tool/activity rows, resilient desktop sidebars, grouped command palettes, and explicit empty/error states.

- Added a keyboard-first command palette with grouped actions for new sessions, agent/workflow navigation, sidebar visibility, settings, and local-session start.
- Added title-bar access plus `⌘K`/`Ctrl+K`, arrow-key navigation, Enter-to-run, Escape-to-close, search filtering, empty results, and visible shortcut hints.
- Kept the implementation native to the existing React/Electron renderer and did not add external runtime dependencies or copy whole application surfaces.

## 2026-07-19 · Long-run automation guardrails

- Replaced the fixed three-minute agent timeout with a two-hour ceiling plus a fifteen-minute inactivity watchdog.
- Made task cancellation interrupt pause waits, workflow retry backoff, and semantic browser waits through a shared abortable primitive.
- Kept manual takeover pauses open-ended so a user is not disconnected while completing a slow approval or human step.
- Added focused coverage for abort behavior, pause/resume, and failure-vs-cancellation state.

Verified:

- `npm test` — 18 files, 47 tests passed
- `npm run typecheck:all`
- `npm run build:renderer`
- `npm run build:main`
