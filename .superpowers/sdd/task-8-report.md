# Task 8 report — Local Whisper ONNX foundation

## Status

DONE_WITH_CONCERNS

## Commit

- `c1a6210 feat: add pinned local whisper onnx foundation`

## Implemented

- Replaced the active single-file GGML manager with a directory-based, pinned Transformers.js ONNX manifest for `onnx-community/whisper-tiny.en` at immutable revision `3a6d57ee9c665610614068e8592d8baee0188181`.
- The manifest lists 12 required files with exact byte sizes and SHA-256 digests, including the quantized encoder and merged decoder LFS objects.
- Downloads stream every asset into a temporary directory, publish aggregate progress, support cancellation/retry, verify every file’s size and SHA-256 digest, and rename only the fully verified directory into place.
- Install replacement uses a previous-directory handoff so a completed temporary directory is promoted before the prior model is removed. Temporary handles close in `finally` before cleanup on stream errors, integrity failures, and cancellation.
- Added `@huggingface/transformers` and `onnxruntime-web`, Vite WASM asset inclusion, dependency optimization, and ES worker output configuration.
- Added `src/renderer/workers/local-whisper.worker.ts` with a narrow injectable pipeline seam. It enables local models, disables remote models and browser/filesystem caches, configures the ONNX WASM path, requests `local_files_only` with `q8`, accepts only finite non-empty `Float32Array` samples, and returns final trimmed text.
- Added direct manifest, download/integrity/atomic-install/cleanup-ordering/retry tests and local-only worker configuration/audio contract tests.
- Hardened speech setup IPC to reject renderer-supplied payloads beyond Electron’s event argument. No model URL, filesystem path, or audio payload is exposed through preload/main setup channels.
- Did not change Chat, Mini Window, Settings, `useSpeechToText`, microphone capture, or UI behavior.

## Changed paths

- `package.json`, `package-lock.json`, `vite.config.ts`
- `src/main/speech/whisper-model-manager.ts`
- `src/main/speech/whisper-model-manager.test.ts`
- `src/renderer/workers/local-whisper.worker.ts`
- `src/renderer/workers/local-whisper.worker.test.ts`
- `src/main/ipc/speech.ipc.ts`
- `src/main/ipc/speech.ipc.test.ts`

## Verification

- Focused tests: 3 files, 10 tests passed.
- `npm run build`: renderer and Electron main/preload builds passed.
- `git diff --check`: passed.
- `npm test` was run before the final speech-IPC payload hardening: 29 files / 83 tests passed, with 3 failures. The speech failure was fixed and is covered by the focused suite; the 2 remaining failures are in the pre-existing untracked `src/main/ipc/settings.ipc.test.ts`, which targets an options-injection API not present in the current settings IPC implementation.
- `npm run typecheck:all`: blocked by the same untracked settings test, which calls `registerSettingsIpc` with an argument although the current function accepts none. The focused foundation files produced no type errors.

## Concerns

- This is intentionally a foundation-only commit. The local worker is not wired to microphone capture, Chat, Mini Window, Settings, or preload APIs; a follow-up task must add that seam without exposing arbitrary filesystem paths or remote model access.
- The model assets are downloaded from the pinned upstream revision during setup; audio inference remains local-only once installed because the worker sets `env.allowRemoteModels = false` and passes `local_files_only: true`.
- The unrelated untracked settings test remains untouched and unstaged, along with `.codex/hooks.json`, `ENGINEERING_TODO.md`, and deleted `todo.md`.
