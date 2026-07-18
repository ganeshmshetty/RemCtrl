# RemoteCtrl senior-engineering pass

This is the active memory for the ongoing product pass. Items are checked off only after implementation and verification.

## Reference study

- [x] Clone requested repositories into `reference/` (read-only): browser-use, agent-browser, rustdesk, onlook, n8n.
- [x] Review existing `research/` material, including NanoBrowser, OpenCode, Plane, Stagehand, browser-use, and browserless.
- [x] Extract patterns for resilient agent loops, session/activity state, remote connection lifecycle, AI-native visual language, and workflow execution/canvas UX.

## Audit findings

- [ ] Agent runs have a hard three-minute timeout, which is too short for real browser work and can leave an in-flight model call detached.
- [ ] Agent and workflow lifecycle state is process-memory-only; a renderer restart cannot recover or explain an active run.
- [ ] Agent history is a singleton and is not keyed by session, so separate sessions can contaminate one another.
- [x] Cancellation and pause handling are not uniformly interruptible: waits, retry backoff, and some browser operations do not observe the abort signal.
- [ ] Workflow retry exists but is not journaled as a resumable checkpoint and does not surface a durable recovery action to the user.
- [ ] The renderer has a working command palette and state cards, but activity, errors, and run history are still visually fragmented and partly inline-styled.
- [ ] Remote connection lifecycle has no single user-facing recovery model for reconnecting, stale signaling, or browser-stream interruption.
- [ ] Full-repository lint has a large existing baseline; changed seams should become clean without pretending unrelated debt is fixed.

## Implementation queue

### Stability first

- [x] Introduce a durable automation-run journal/checkpoint seam with bounded event retention and atomic writes.
- [ ] Make task cancellation, retry backoff, waits, and browser readiness abort-aware.
- [x] Replace the fixed agent timeout with inactivity/step watchdogs and explicit long-run limits.
- [x] Add safe retry classification for transient provider/browser failures and preserve partial results.
- [ ] Add resume/recover APIs and UI actions for interrupted agent/workflow runs.
- [x] Add focused tests for cancellation, timeout, journal recovery, and retry behavior.

### Design language and UX

- [x] Establish shared surface, typography, status, focus, and motion tokens from the existing Geist foundation.
- [x] Consolidate activity into a deliberate timeline with expandable details, elapsed time, and clear terminal states.
- [ ] Replace remaining generic/inline controls in the core task and workflow surfaces with consistent primitives.
- [x] Improve remote session connection/reconnect/takeover flows with explicit next actions.

### Capability polish

- [x] Improve workflow builder review/run experience with step status, failure context, and recovery affordances.
- [ ] Verify packaged Electron behavior, renderer smoke flows, tests, typechecks, and builds.
- [ ] Commit each coherent implementation increment with a descriptive message.

## Verification log

- Initial baseline: `npm test`, typechecks, renderer build, and focused lint were previously green for the existing pass; full lint still contains unrelated baseline findings.
- Reference clones are ignored by `.gitignore` and must not be edited.
