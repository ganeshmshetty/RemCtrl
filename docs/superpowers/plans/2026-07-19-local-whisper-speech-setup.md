# Local Whisper Speech Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local Whisper model setup flow and honest runtime gate while removing browser Web Speech from active transcription.

**Architecture:** The main process owns a tested, injectable model manager that downloads the pinned GGML model to Electron user data, hashes it, and broadcasts serializable setup state. Narrow preload IPC exposes setup actions and the persisted microphone-audio consent separately. Renderer state consumes that contract; the existing Chat/Mini composition semantics call a local-only hook whose typed runtime adapter reports `native-runner-not-packaged` rather than transcribing.

**Tech Stack:** Electron 42, TypeScript, Node `fetch`/streams/crypto/fs, Zod, React, Zustand, Vitest, Vite, esbuild, electron-builder.

## Global Constraints

- Use `ggml-tiny.en.bin` under Electron app data.
- Pin SHA-1 `bd577a113a864445d4c299885e0cb97d4ba92b5f` and reject mismatches.
- Use the official whisper.cpp model endpoint; no fake transcription, Web Speech, cloud speech, or LLM provider removal.
- No audio over IPC/WebRTC/remote agent protocols; this task exposes only setup state and runtime availability.
- Microphone audio requires both verified model installation and explicit user enablement, plus runtime availability.
- Preserve push-to-talk/hands-free behavior once the runtime is available.
- Do not modify Task 4 shell files or unrelated user-owned worktree changes.

---

### Task 1: Define shared local-Whisper contracts and storage setting

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/schemas.ts`
- Modify: `src/main/storage.ts`
- Test: `src/main/speech/whisper-contracts.test.ts`

**Interfaces:**
- Produces `WhisperModelState`, `WhisperSetupState`, `WhisperRuntimeAvailability`, `WhisperRuntimeReason`, and `RemoteCtrlAPI` method/event types.
- Produces `getMicrophoneAudioEnabled()` and `setMicrophoneAudioEnabled(enabled: boolean)` without changing AI provider fields.

- [ ] **Step 1: Write the failing contract tests** asserting the default microphone setting is false and the unavailable runtime reason is serializable.
- [ ] **Step 2: Run `npm test -- src/main/speech/whisper-contracts.test.ts` and confirm failure because the contracts do not exist.**
- [ ] **Step 3: Add the exact shared discriminated unions and persisted setting schema; keep the existing speech input mode type.**
- [ ] **Step 4: Run the focused test and confirm it passes.**
- [ ] **Step 5: Commit with `git add src/shared src/main/storage.ts src/main/speech/whisper-contracts.test.ts && git commit -m "feat: define local whisper setup contracts"`.**

### Task 2: Implement model download, verification, cancellation, and retry

**Files:**
- Create: `src/main/speech/whisper-model-manager.ts`
- Create: `src/main/speech/whisper-model-manager.test.ts`

**Interfaces:**
- Consumes shared Whisper constants/types.
- Produces `createWhisperModelManager(dependencies)` with `getState()`, `download()`, `cancel()`, `retry()`, and `dispose()`.

- [ ] **Step 1: Write failing tests for the pinned URL/hash, app-data destination, progress events, cancellation cleanup, retry after failure, successful digest verification, and mismatch rejection.**
- [ ] **Step 2: Run the focused test and verify it fails on missing manager exports.**
- [ ] **Step 3: Implement the injectable manager using a temporary file, streamed response body, SHA-1 hashing, atomic rename, `AbortController`, and deterministic serializable states. Do not add resume or unpinned URLs.**
- [ ] **Step 4: Run the focused tests and confirm all pass, including no final model file after cancel/hash mismatch.**
- [ ] **Step 5: Commit with `git add src/main/speech/whisper-model-manager.ts src/main/speech/whisper-model-manager.test.ts && git commit -m "feat: add verified local whisper model manager"`.**

### Task 3: Add explicit unavailable runtime adapter

**Files:**
- Create: `src/main/speech/whisper-runtime.ts`
- Create: `src/main/speech/whisper-runtime.test.ts`

**Interfaces:**
- Produces `createLocalWhisperRuntime()` implementing `getAvailability()` and `transcribe()`.

- [ ] **Step 1: Write failing tests that assert the adapter reports `native-runner-not-packaged` and rejects transcription without reading audio or invoking a fallback.**
- [ ] **Step 2: Run the focused test and confirm it fails because the adapter is missing.**
- [ ] **Step 3: Implement the typed adapter with no native dependency, no process spawn, no Web Speech, and a stable explanatory error.**
- [ ] **Step 4: Run the focused tests and confirm they pass.**
- [ ] **Step 5: Commit with `git add src/main/speech/whisper-runtime.ts src/main/speech/whisper-runtime.test.ts && git commit -m "feat: add honest local whisper runtime adapter"`.**

### Task 4: Wire main IPC and renderer preload contracts

**Files:**
- Create: `src/main/ipc/speech.ipc.ts`
- Create: `src/main/ipc/speech.ipc.test.ts`
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/ipc/renderer-events.ts`
- Modify: `src/main/ipc/settings.ipc.ts`
- Modify: `src/preload/index.cjs`
- Modify: `src/shared/types.ts`

**Interfaces:**
- Adds `speech:getSetupState`, `speech:downloadModel`, `speech:cancelDownload`, `speech:retryDownload`, and `settings:get/setMicrophoneAudioEnabled`.
- Adds `on.speechStateChanged(callback)` and sends state to every live renderer window.

- [ ] **Step 1: Write failing IPC tests for registration, validated action routing, and state broadcast.**
- [ ] **Step 2: Run focused IPC tests and verify missing channel registrations fail.**
- [ ] **Step 3: Register one speech manager per main process, connect manager events to renderer broadcast, validate no renderer-supplied URL/path/hash, and add narrow preload wrappers/listener cleanup.**
- [ ] **Step 4: Run focused IPC tests and confirm pass.**
- [ ] **Step 5: Commit with `git add src/main/ipc/speech.ipc.ts src/main/ipc/speech.ipc.test.ts src/main/ipc-handlers.ts src/main/ipc/renderer-events.ts src/main/ipc/settings.ipc.ts src/preload/index.cjs src/shared/types.ts && git commit -m "feat: expose local whisper setup IPC"`.**

### Task 5: Replace Web Speech hook with local readiness gate

**Files:**
- Modify: `src/renderer/hooks/useSpeechToText.ts`
- Modify: `src/renderer/screens/miniWindowSpeech.ts`
- Modify: `src/renderer/screens/miniWindowSpeech.test.ts`
- Modify: `src/renderer/stores/useWorkflowStore.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- `useSpeechToText` consumes `enabled`, `mode`, `modelInstalled`, `runtimeAvailable`, and `onTranscript`; it never accesses `SpeechRecognition`, `webkitSpeechRecognition`, `getUserMedia`, or remote APIs.
- Renderer settings state exposes `whisperSetup` and `microphoneAudioEnabled` with setup actions.

- [ ] **Step 1: Write failing renderer gate tests for every prerequisite and the explicit unavailable message.**
- [ ] **Step 2: Run focused renderer tests and confirm they fail against the browser-recognition behavior.**
- [ ] **Step 3: Replace the hook with a local-only adapter gate, wire startup state/event loading in the store/App, and keep composition helpers unchanged except for gate input names.**
- [ ] **Step 4: Run focused renderer tests and confirm pass.**
- [ ] **Step 5: Commit with `git add src/renderer/hooks/useSpeechToText.ts src/renderer/screens/miniWindowSpeech.ts src/renderer/screens/miniWindowSpeech.test.ts src/renderer/stores/useWorkflowStore.ts src/renderer/App.tsx && git commit -m "feat: gate speech controls on local whisper readiness"`.**

### Task 6: Update Chat/Mini controls and Settings UI

**Files:**
- Modify: `src/renderer/screens/ChatInputBar.tsx`
- Modify: `src/renderer/screens/MiniWindow.tsx`
- Modify: `src/renderer/screens/Settings.tsx`
- Modify: `src/renderer/screens/Settings.css`

**Interfaces:**
- Consumes setup state/actions and the local hook from Task 5.
- Produces separate visible Download/verify and Enable microphone audio controls, progress/cancel/retry actions, local-only privacy copy, and disabled speech controls with a setup/runtime explanation.

- [ ] **Step 1: Add focused pure UI-state assertions for separate model/microphone gating where existing renderer test patterns allow it.**
- [ ] **Step 2: Run the focused renderer tests and confirm the new expectations fail.**
- [ ] **Step 3: Implement settings controls without removing AI tab/provider settings; update both Chat and Mini to use `microphoneAudioEnabled` and local readiness, preserving pointer/click push-to-talk/hands-free semantics.**
- [ ] **Step 4: Run focused tests and inspect the rendered source for zero Web Speech references and no audio payload path.**
- [ ] **Step 5: Commit with `git add src/renderer/screens/ChatInputBar.tsx src/renderer/screens/MiniWindow.tsx src/renderer/screens/Settings.tsx src/renderer/screens/Settings.css && git commit -m "feat: add local whisper setup and microphone controls"`.**

### Task 7: Report packaging concern and full validation

**Files:**
- Create: `.superpowers/sdd/task-8-report.md`
- Modify: only Task 8 files from Tasks 1–6

- [ ] **Step 1: Re-read the brief and inspect `git diff --name-only` to verify no Task 4 files or unrelated worktree changes are included.**
- [ ] **Step 2: Run `npm test`, `npm run typecheck:all`, `npm run build`, `npm run lint`, and `git diff --check`; record exact results.**
- [ ] **Step 3: Self-review the diff for provider preservation, Web Speech removal, no audio IPC/WebRTC, exact URL/hash, download safety, and UI gating.**
- [ ] **Step 4: Write the report with `DONE_WITH_CONCERNS`, exact native-runner limitation, changed paths, tests, and packaging considerations.**
- [ ] **Step 5: Commit the report and final Task 8 implementation with `git add .superpowers/sdd/task-8-report.md <only-reviewed-task-8-files> && git commit -m "feat: add local whisper speech setup flow"`.**
