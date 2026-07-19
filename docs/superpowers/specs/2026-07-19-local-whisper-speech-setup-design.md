# Local Whisper Speech Setup Design

## Goal

Replace the browser Web Speech transcription path with a local Whisper setup flow that downloads and verifies the official `ggml-tiny.en.bin` model under Electron app data, gives the user an explicit microphone-audio consent switch, and never claims transcription capability without a packaged native runner.

## Decisions

- The model URL is the documented whisper.cpp Hugging Face endpoint for `ggml-tiny.en.bin`.
- The pinned SHA-1 is `bd577a113a864445d4c299885e0cb97d4ba92b5f`.
- The model is stored at `<app userData>/whisper/ggml-tiny.en.bin`; partial downloads use a separate temporary file and are removed on cancel or failure.
- Download, verify, cancel, retry, and state inspection are main-process operations exposed through narrow preload IPC.
- Model state is derived from the verified model file on startup and in-memory download state is broadcast to all renderer windows through `speech:stateChanged`.
- Microphone audio enablement is a separate persisted setting. It is never inferred from model installation and cannot make controls usable by itself.
- The runtime boundary is a typed `LocalWhisperRuntime` adapter. This task deliberately ships no native executable or native dependency because the project has no cross-platform runner packaging contract. The adapter returns a stable unavailable reason and a transcription call fails with that reason.
- `useSpeechToText.ts` is retained as a renderer-facing hook name for the existing Chat and Mini Window composition behavior, but contains no Web Speech API access, no online fallback, and no `getUserMedia` path. It only exposes the local readiness gate and reports the unavailable runtime.
- The existing AI/LLM provider settings remain unchanged. No audio is placed on WebRTC, agent data-channel messages, or remote signaling.

## State and data flow

```text
Settings UI
  ├─ download/verify button ──> preload ──> speech IPC ──> model manager ──> appData file
  ├─ cancel/retry ────────────> preload ──> speech IPC
  └─ microphone switch ───────> settings IPC ──> persisted settings.json

main model manager ──speech:stateChanged──> preload ──> Zustand setup state
                                                    ├─ Settings status/progress
                                                    └─ Chat/Mini speech readiness gate
```

The model manager validates the final file by streaming SHA-1, checks the exact filename and expected digest, and only moves a verified temporary file into place. HTTP failures, malformed response bodies, cancellation, and digest mismatch produce user-safe error text and return to a non-installed state. Retrying starts a fresh download.

Speech controls are enabled only when all of these are true: model state is `installed`, microphone audio is explicitly enabled, and the runtime adapter reports `available`. In this task the last condition is always false in production builds, so the UI presents the concrete packaging limitation and a setup action instead of starting capture.

## UI behavior

The General settings Speech input group becomes Local Whisper speech. It contains:

1. A local-only privacy explanation: audio remains on this device when a runner is available and is never sent to Web Speech or remote agent protocols.
2. Model status, model size, and SHA-1 verification status.
3. A separate Download and verify / Cancel / Retry control with determinate progress.
4. A separate Enable microphone audio switch, disabled until the model is verified and clearly marked as not sufficient while the native runner is unavailable.
5. Push-to-talk and Hands-free mode selection, retained from the existing behavior.

Chat and Mini Window preserve their push-to-talk and hands-free event semantics. Their microphone buttons are disabled while setup/runtime prerequisites are missing and expose a useful title/status message; they never start browser recognition.

## Tests

- Model manager tests cover destination safety, progress, cancellation, retry/failure cleanup, success hash validation, and hash mismatch rejection.
- Runtime adapter tests assert the explicit unavailable reason and that transcription never invokes a nonexistent runner.
- IPC tests assert the setup channels are registered and route through the manager/settings boundary without exposing raw IPC.
- Renderer gate tests assert model installation, microphone consent, runtime availability, and error state each affect whether speech may start.
- Existing Mini Window composition tests remain intact; full typecheck, tests, build, lint, and diff checks are run before commit.

## Packaging concern

Official whisper.cpp documents building and invoking `whisper-cli`, but this Electron project currently packages only the esbuild output and has no platform-specific native runner artifacts, download manifest, signing policy, or CI build matrix. Shipping a runner without those contracts would be unsafe across macOS, Windows, and Linux. The adapter therefore reports `native-runner-not-packaged` explicitly; model setup is complete and testable, but actual transcription remains unavailable until a future task supplies and validates signed per-platform runner artifacts.
