# RemoteCtrl — Project Status & Roadmap

## Completed Phases
- **Phase A — UX Restructuring**: Local mode streaming, Home screen hierarchy overhaul, fixed navigation states.
- **Phase B — Persistent Browser Profile**: Direct usage of the host's native Chrome binary, persistent `userDataDir` for logged-in sessions, first-launch onboarding.
- **Phase C & D — Tray & Mini Window**: System tray integration, global keyboard shortcut (Cmd+Shift+Space), and floating mini-prompt window.
- **Phase E — Browser Extension**: Chrome extension with local WebSocket bridge for manual workflow recording and real-session automation.
- **Phase F — Agent Architecture Refactor**: Transitioned from multi-tier DynamicPlanner ReAct loop to an atomic, single-tier tool calling loop (`@ai-sdk`).
- **Phase G — Stagehand Dependency Removal**: Ripped out `@browserbasehq/stagehand` completely to eliminate 500ms+ init latency, memory leaks, and connection timeouts. Implemented lightweight `browser-pool.ts` connection singleton and optimized native browser tools (`agent-tools.ts`).
- **Phase H — CI/CD Optimization**: Restructured Github Actions (`build.yml` and Cask update workflows) to skip redundant builds and verify fast Homebrew installations.

---

## Active & Upcoming Roadmap

### Milestone 1: Multi-Mode Connection & Core UI
- [ ] **Multi-Mode Browser Onboarding & Settings UI** `[High Impact, Medium Complexity]`
  Present a beautiful first-launch onboarding selector (and configurable Settings toggle) allowing users to choose their preferred browser automation mode:
  - **Seamless Extension Bridge**: Control active daily Chrome tabs via local WebSocket bridge (`ext-server.ts`) with zero restarts.
  - **Dedicated Playwright Browser**: Isolated, sandboxed browser window with support for switching/adding custom profiles stored in persistent `userDataDir` folders.
  - **Existing CDP Debug Instance**: Connect to developer Chrome instances running with `--remote-debugging-port=9222`.
- [ ] **Docked Desktop Sidebar UI** `[High Impact, High Complexity]`
  Collapse the floating `MiniWindow.tsx` overlay into a vertically docked desktop sidebar that sits flush against the edge of the user's active Chrome window to provide a frictionless side-by-side automation control layout.

### Milestone 2: Set-of-Mark & Visual Grounding (Stage 2 Fallback)
- [ ] **Set-of-Mark (SoM) & Axis Grid Overlays for Vision Fallback** `[High Impact, High Complexity]`
  - **Set-of-Mark Overlay**: Inject numbered visual boxes (`[1]`, `[2]`) around interactive elements prior to taking screenshots so vision models (like Gemini 3.5 Flash) select elements by multiple-choice ID with 96%+ accuracy rather than guessing spatial pixels.
  - **Normalized Axis Grid Overlay**: When interacting with unlabelled canvas surfaces (e.g., Google Maps, Figma, WebGL games), overlay translucent coordinate grid lines and ruler tick marks so vision models can output accurate normalized `(x, y)` coordinates paired with CDP hardware mouse dispatch (`Input.dispatchMouseEvent`).
  - **Safe Visual Overlays Container & Self-Exclusion (`data-remctrl-exclude`)**: Tag all visual overlays (Set-of-Mark boxes, coordinate grids, cursor overlay) with `data-remctrl-exclude="true"` and `pointer-events: none` inside a single unified `#remctrl-overlay-root` container so the DOM serializer never hallucinates about its own UI or intercepts mouse clicks. Inject SoM boxes strictly for the instant of screenshot capture before any action executes.
- [ ] **Cross-Frame & Shadow DOM Element Discovery (`dom-snapshot.ts`)** `[High Impact, Medium Complexity]`
  - **Frame-Scoped Heuristic Scanning**: Walk every active frame (`page.frames()`) and namespace `data-remctrl-index` by frame URL/ID so interactive elements inside embedded iframes (auth widgets, checkout boxes) are discovered.
  - **Shadow DOM Piercing & Accessibility Tree**: Recurse into open `shadowRoot` trees and combine heuristic scanning with Playwright's native accessibility tree (`page.accessibility.snapshot()` / `ariaSnapshot()`) to capture custom Web Components.
  - **Lazy Locator Resolution & Stale Reference Recovery (`agent-tools.ts`)**: Resolve element targets lazily at action execution time (`getByTestId`, `getByRole`, semantic locators) and use a lightweight `MutationObserver` watchdog to detect stale DOM subtrees before acting.
- [x] **Browser-Use Numbered DOM Snapshot & Action Pipeline** `[Medium Impact, Medium Complexity]`
  Implement a comprehensive index-based observation and interaction system inspired by `browser-use` (`clickable_elements.py`, `serializer.py`, `eval_serializer.py`):
  - **Numbered Interactive Element Snapshot (`observe`)**: Scans active elements using multi-signal heuristics (tags, roles, event handlers, `cursor: pointer`, search keywords), tags each element with `data-remctrl-index="N"`, and returns a numbered tree (`[1]<input ... />`, `[2]<button ...>`).
  - **Enriched Form & Validation Attributes**: Automatically enriches `<select>` dropdowns with top options (`options="Opt1|Opt2"`), date inputs with ISO format hints (`format="YYYY-MM-DD"`), and form validation/state attributes (`checked`, `required`, `min`, `max`, `pattern`).
  - **Deterministic Index Action Execution (`act`)**: Supports calling `act({ index: N, action: "click" })` directly targeting `[data-remctrl-index="N"]` with smooth pointer movement and click ripple animation (`cursor-overlay.ts`).

### Milestone 3: High-Performance Scraping & Data Extraction
- [x] **DOM-to-Markdown Conversion** `[Medium Impact, Low Complexity]`
  Strip non-content scripts/styles and convert page HTML trees into clean Markdown table/header formats before feeding context to the LLM to save tokens and improve scraping accuracy. Implemented structure-aware markdown extraction with embedded `[N]` interactive element index markers (`extractDOMAsMarkdown`).
- [ ] **Structured Data Extraction Schema & Constrained Generation (`generateObject`)** `[High Impact, Medium Complexity]`
  - Allow users to pass an optional JSON Schema/Pydantic structure so `extract` and `collect` steps return validated, formatted JSON ready for CSV/Excel export.
  - Integrate Vercel AI SDK's `generateObject` for `collect` steps, passing a Zod schema converted from the user's JSON Schema to guarantee schema-validated JSON with automatic retry-on-invalid-output.
  - **Heuristic Pagination Extraction Loop**: Reuse `observe()` to heuristically detect `"next"` / `"load more"` / `rel="next"` buttons among indexed interactive elements, validating and deduping schema items per page rather than at the end so bad pages fail fast.
- [ ] **Structured In-Page Helper Scripts (`browser_script`)** `[Low Impact, Medium Complexity]`
  Support executing custom in-page JavaScript helper scripts that emit structured dictionaries (`emit_output`, tables, pagination feeds) back to the agent engine for instant bulk extraction without repeated DOM lookups.

### Milestone 4: Replayable Workflows & Conversational Resume
- [ ] **Conversational Resume (Task State Persistence & Checkpoint Breakpoints)** `[High Impact, High Complexity]`
  - If an agent run is cancelled, pauses, or fails, persist the step history and browser context. Enable the user to submit a correction prompt (e.g., "Try entering the login details again") and click Resume to continue from that exact step instead of restarting the run.
  - **Playwright State Snapshotting**: Persist Playwright context storage state (`context.storageState()`) for cookies/localStorage/sessionStorage plus current URL and step index.
  - **Chat History & Token Compaction**: Key chat message arrays by run ID on disk. Implement token compaction (`_maybe_compact_messages`) to summarize older tool results while keeping recent turns verbatim.
  - **Synthetic `askUser()` Breakpoint**: Leverage the existing `askUser` checkpoint primitive to pause execution cleanly on user request or error, allowing the user to type a correction and resume seamlessly without restarting the run.
- [ ] **Editable AI-Recorded Workflows with Parameterized Variables** `[High Impact, High Complexity]`
  Allow saving completed AI agent runs into visual drag-and-drop workflow cards (`WorkflowEditorModal.tsx`). Support converting typed inputs into parameterized variables (`{{variable_name}}`) so users can replay recorded clicks deterministically at 10x speed while injecting custom input values and selective AI extraction steps.
- [ ] **Workflow Creation UX Refactor** `[Medium Impact, Medium Complexity]`
  Deprecate manual "from-scratch" step selector creation. Streamline `WorkflowsPanel.tsx` and `WorkflowEditorModal.tsx` so workflows originate purely from AI-Recorded Runs or Chrome Extension live recordings, keeping the modal focused on editing variables (`{{var}}`), reordering steps, and adding AI evaluation checkpoints.

### Milestone 5: Execution Robustness & Resource Management
- [ ] **Execution Robustness, Timeout Wrappers & Memory Cleanup** `[High Impact, Medium Complexity]`
  - **Safe Tool Wrappers (`safeAct`)**: Wrap every Playwright tool call with explicit target liveness checks (`isTargetAlive`) and timeouts so interrupted navigations or destroyed execution contexts return clean error strings to the LLM instead of crashing the run.
  - **Loop Detection & Nudge Watchdog**: Detect when the agent repeats the same action or URL 3+ times consecutively without progress and inject an automatic system warning to break unproductive loops.
  - **Memory & Listener Cleanup**: Evict old screenshot blobs to disk-by-reference after N steps, guard `addInitScript` against duplicate `addEventListener` piling across navigations, and properly close dead WebSocket recording clients in `ext-server.ts`.
