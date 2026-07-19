# Task 8 report — Local Whisper speech setup

## Status

DONE_WITH_CONCERNS

## Implemented

- Added a main-process local Whisper model manager that downloads the pinned official `ggml-tiny.en.bin` endpoint to `<Electron userData>/whisper/ggml-tiny.en.bin`, streams progress, supports cancel/retry, removes partial files, and verifies SHA-1 `bd577a113a864445d4c299885e0cb97d4ba92b5f` before atomically installing the model.
- Added narrow, setup-only IPC: `speech:getSetupState`, `speech:downloadModel`, `speech:cancelDownload`, and `speech:retryDownload`, plus main-to-renderer state updates. No renderer-supplied URL, model path, audio payload, or remote transport is accepted.
- Added a separate persisted `microphoneAudioEnabled` setting. Settings exposes distinct Download model and Enable microphone audio controls. The microphone switch remains disabled until the model is verified installed.
- Replaced the active browser Web Speech path with a local readiness gate. No `SpeechRecognition`, `webkitSpeechRecognition`, cloud fallback, fake transcript, browser microphone capture, IPC audio payload, or WebRTC audio path remains in the transcription flow.
- Preserved the existing push-to-talk and hands-free control semantics in Chat and Mini Window. They are disabled until model verification, explicit microphone enablement, and a runtime availability signal are all true; setup actions direct users to the local Whisper settings.
- Kept AI/LLM provider, model, API-key, and credential settings unchanged.

## Changed paths

- `src/main/speech/whisper-model-manager.ts` and focused tests
- `src/main/speech/whisper-runtime.ts` and focused tests
- `src/main/ipc/speech.ipc.ts` and focused tests
- `src/main/ipc-handlers.ts`, `src/main/ipc/settings.ipc.ts`, `src/main/storage.ts`
- `src/shared/types.ts`, `src/shared/schemas.ts`, `src/preload/index.cjs`
- `src/renderer/hooks/useSpeechToText.ts` and focused test
- `src/renderer/stores/useWorkflowStore.ts`, `src/renderer/App.tsx`
- `src/renderer/screens/Settings.tsx`, `src/renderer/screens/Settings.css`, `src/renderer/screens/ChatInputBar.tsx`, and `src/renderer/screens/MiniWindow.tsx`

## Verification

- `npm test` — passed: 29 test files, 78 tests.
- `npm run typecheck:all` — passed.
- `npm run build` — passed for renderer and Electron main/preload output.
- `git diff --check` — passed.
- Focused `npx eslint src/main/speech/whisper-runtime.ts src/renderer/hooks/useSpeechToText.ts` — passed.
- Repository-wide `npm run lint` still fails on 141 existing findings outside Task 8; the two Task 8 findings it originally surfaced were fixed and the focused lint command above is clean.

## Concern: native runner packaging

Actual transcription is intentionally unavailable. The runtime adapter returns `native-runner-not-packaged` with the explicit message that this build does not include a native `whisper.cpp` runner. The current Electron package only includes `dist/**/*`; it has no signed/bundled macOS, Windows, and Linux runner artifacts, architecture manifest, code-signing policy, or CI packaging matrix. Shipping a native runner without those contracts would not be production-safe.

The downloader, verification flow, IPC/state updates, settings controls, and speech gating are complete. A follow-up must add and validate per-platform native runner artifacts before microphone capture and on-device transcription can be enabled.
