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

## 2026-07-19 · Workflow recovery and review polish

- Added `Run again` and agent handoff actions to failed workflow runs so a failed deterministic step has a clear next move.
- Made workflow step disclosures keyboard accessible and added Escape-to-close behavior to the editor dialog.
- Preserved original workflow creation timestamps when editing an existing workflow.
- Made condition polling observe the automation abort signal, avoiding hidden polling after cancellation.

## 2026-07-19 · Network and provider recovery

- Added bounded retries around transient agent-loop failures, preserving the current browser state and journaled actions between attempts.
- Re-enabled Socket.IO reconnection with exponential delay and replayed host PIN/controller-intent handshakes after transport recovery.
- Changed remote connection interruption copy from a terminal-looking error to an explicit automatic-reconnect state when signaling is retrying.
- Fixed the command-palette new-session path so clearing the renderer also clears the main-process prompt context; a visually new chat no longer inherits old turns.
- Keyed model-history context by the renderer session id so concurrent task windows do not share hidden prior turns.

Verified:

- `npm test` — 19 files, 48 tests passed
- `npm run typecheck:all`
- `npm run build:renderer`
- `npm run build:main`
- Focused lint for signaling and execution seams; the execution file retains one pre-existing `any` warning in its summary cast.

Verified:

- `npm test` — 19 files, 48 tests passed
- `npm run typecheck:all`
- `npm run build:renderer`
- `npm run build:main`
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

## 2026-07-19 · Interrupted-run recovery

- Added atomic per-run checkpoint metadata alongside the existing action journal. A stale `running` checkpoint is surfaced as `interrupted` after restart with its last step and action.
- Added main/preload APIs to list and dismiss recoverable runs.
- Added an agent-panel recovery banner that offers a state-aware continuation prompt for interrupted agent tasks and a workflow-specific resume action for saved workflows.

## 2026-07-19 · Workflow recovery

- Workflow checkpoints now retain the saved workflow identity and the last active step.
- After a renderer or main-process interruption, the Agent panel can resume the saved workflow on its owning host and recheck the current step before continuing.
- If the saved workflow was deleted or the browser belongs to another host, the recovery banner explains why it cannot proceed instead of silently discarding the checkpoint.

## 2026-07-19 · Remote stream resilience

- A transient WebRTC disconnect now enters a visible reconnecting state and gives ICE restart a grace period instead of immediately cancelling active host automation.
- If the stream cannot return, the UI explains that the host task is still running, separating browser-work continuity from the viewer connection.
- Human-in-the-loop checkpoints now close an abort/registration race without leaking pending callbacks.

## 2026-07-19 · Activity language and typography

- Activated the bundled Geist variable font and made it the shared application typeface instead of relying on a platform-dependent fallback.
- Refined agent activity into a compact numbered timeline with explicit running/completed/failed icons, per-step elapsed time, and an overall step-duration summary.
- Kept the activity disclosure behavior from the existing agent panel while borrowing the compact tool/reasoning hierarchy from OpenCode and Onlook.

## 2026-07-19 · Shared response surfaces

- Moved Markdown response styling out of inline declarations into a reusable tokenized stylesheet.
- Standardized code cards, copy actions, headings, lists, inline code, and links for dark/light theme inheritance and keyboard-visible interaction.

Verified:

- Fresh local renderer smoke test in the in-app browser after starting a local session.
- `npm test` — 19 files, 48 tests passed
- `npm run typecheck`
- `npm run build:renderer`

Verified:

- `npm test` — 18 files, 47 tests passed
- `npm run typecheck:all`
- `npm run build:renderer`
- `npm run build:main`
