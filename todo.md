# RemoteCtrl TODO List

## High Priority
- [ ] **Browser Resolution Strategy**: Implement dynamic browser targeting for production:
  - Default to using the user's natively installed Chrome/Edge in a temporary, isolated profile.
  - Add an "Advanced Setting" allowing users to use their Default Profile (with a warning that they must close their browser first).
  - **Fallback**: If no compatible local browser is found, dynamically ask the user to download the Playwright Chromium binary into a manageable directory (e.g. `app.getPath('userData')/browsers`) so it can be cleanly updated, deleted, or uninstalled with the app.

## Medium Priority (UX / Performance)

## Low Priority / Enhancements
- [ ] **Stall Nudge UI**: Stall nudge messages from `stall-detector.ts` are currently only logged to the console. Surface these actionable hints in the UI for the Controller.

---

## Recently Completed
- [x] **Signaling Server Optimization**: Eliminated all O(n) room iterations in the socket.io signaling server by introducing a `socketToPin` O(1) reverse lookup map.
- [x] **Workflow Editor UX**: Implemented drag-and-drop workflow step reordering using `@dnd-kit` for a much smoother editing experience.
- [x] **API Key Security**: Implemented Electron `safeStorage` to encrypt API keys before storing them in JSON, utilizing OS-level keychain encryption.
- [x] **Local / Solo Mode**: Added ability to launch the browser and use Agent/Workflow panels without spinning up WebRTC or hosting.
- [x] **Event-Driven Cancellation**: Replaced 200ms `setInterval` polling in `execution-engine.ts` with `AbortController` for zero-latency, clean cancellation.
- [x] **WebRTC Reliability**: Added Google public STUN servers to `ICE_SERVERS` so WebRTC connects reliably across NATs and over the internet.
- [x] **UI Reactivity**: Fixed `useConnectionStore.getState()` usage in `BrowserPanel.tsx` that was breaking React re-renders for `pendingControllerId` and `pin`.
- [x] **Playwright Context Error**: Fixed `Object reference chain is too long` error in Playwright by returning `null;` after `window.open()` evaluates in the browser context.
- [x] **Dynamic Agent Steps**: Added `new_tab` and `done` actions to the Agent execution loop so the LLM can open new tabs and explicitly complete goals.
- [x] **Codebase Refactor**: Consolidated `agent-executor.ts` and `task-planner.ts` into a unified `execution-engine.ts` with proper ReAct loop.
