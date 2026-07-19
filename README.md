# RemoteCtrl

> **Delegate the task, not the browser.**

RemoteCtrl is a task-scoped browser coworker: it lets a user delegate one approved task inside their own authenticated browser to an AI agent or remote operator, intervene when needed, and turn a successful session into a reusable workflow. It combines a visible browser workspace with an agent console, workflow editor, local browser profiles, visual guidance, and local Whisper speech-to-text.

This repository is a hackathon-ready development build. It is designed to make the main demo path easy to run locally while keeping credentials, browser profiles, and workflow data on the host machine.

## Why RemoteCtrl

Existing products solve pieces of the problem, but they generally optimize for a different unit of access: a whole machine, an agent-owned browser, a developer automation API, or a predefined workflow. RemoteCtrl is built around **one approved browser task**.

The user keeps the authenticated browser session. An agent performs the delegated work; the user can pause, approve an exception, complete MFA manually, or take over. Once the work succeeds, the interaction can be saved and replayed as a workflow.

### Market landscape

This capability matrix is based on the source-linked market study in [research/remotectrl-market](research/remotectrl-market/) and the architecture reference repositories in `research/`. A ✓ marks a documented, first-class focus; — means it is not the product’s core position in this comparison.

| Product | AI browser agent | User’s browser session/profile | Human takeover or approval | Reusable browser workflows | Remote operator | Task-scoped policy for agent actions |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| [RustDesk](https://github.com/rustdesk/rustdesk) | — | ✓ | — | — | ✓ | — |
| [browser-use](https://github.com/browser-use/browser-use) | ✓ | — | — | — | — | — |
| [Stagehand](https://github.com/browserbase/stagehand) | ✓ | — | — | — | — | — |
| [Nanobrowser](https://github.com/nanobrowser/nanobrowser) | ✓ | ✓ | — | — | — | — |
| [n8n](https://github.com/n8n-io/n8n) | — | — | — | ✓ | — | — |
| [browserless](https://github.com/browserless/browserless), Playwright, Puppeteer | — | — | — | — | — | — |
| **RemoteCtrl** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

RemoteCtrl’s distinction is the combined row: task-scoped agent execution inside a user-controlled browser, with human intervention and workflow replay in the same product.

### The task boundary

The policy layer can evaluate browser-specific execution context: the current browser session, the acting agent/operator, the open site, the requested capability, the action type, the declared task scope, and whether an approval is required. That is stronger than telling a model to “only do the approved task”; it gives the runtime a place to block or request approval before an agent action executes.

**Current boundary:** RemoteCtrl enforces scope for agent actions and provides human takeover. It does **not** claim that remote human mouse and keyboard input is scope-enforced. The included demo proves workflow self-healing and the integrated agent → workflow → human-intervention path; it is not a claim of comprehensive remote-input policy enforcement.

### Demo narrative

Use one concrete operations scenario: a technician updates one customer record in a user’s authenticated web app. The user declares the task; the agent or technician performs it; an unrelated agent action is blocked or requires approval; the user completes MFA or takes over if needed; then the successful sequence becomes a reusable workflow. This presents the system as one coherent product rather than a list of disconnected features.

## What you can demo

- Ask an AI agent to navigate and operate a Chromium browser through Playwright.
- Observe numbered interactive elements and let the agent act on stable element references.
- Record, edit, save, and replay workflows with selector recovery and retry behavior.
- Use local or remote browser sessions, including an approval step before a controller can interact.
- Load the companion Chrome extension to automate the active page or record browser interactions.
- Enable local Whisper speech-to-text after downloading and verifying the model in Settings.
- Run the included offline client portal demo as a deterministic workflow target.

## Architecture

RemoteCtrl is split across the Electron process boundary:

```text
React renderer
  -> preload contextBridge (window.RemoteCtrlAPI)
  -> Electron IPC handlers
  -> main process services
       -> Playwright / Chrome CDP
       -> agent and workflow execution
       -> local JSON storage + OS credential encryption
       -> WebRTC signaling and extension bridge
```

- `src/main/` owns Electron lifecycle, browser management, agent execution, workflow execution, IPC, storage, WebRTC, and the local Whisper runtime.
- `src/preload/` exposes the narrow renderer-to-main API. Renderer code does not access Node APIs directly.
- `src/renderer/` contains the React screens, panels, settings, browser surface, chat input, workflow editor, and Zustand stores.
- `src/shared/` contains types, Zod schemas, provider defaults, and IPC contracts shared across processes.
- `server/` contains the optional Socket.IO signaling server for remote sessions.
- `extension/` contains the Manifest V3 Chrome extension and its localhost bridge client.
- `demo-site/` contains the offline-friendly workflow target used for presentations.
- `research/` contains architecture notes from browser-use and Stagehand and other reference material.

The main agent loop uses Vercel AI SDK tool calls, Playwright browser tools, compact DOM observations, selector heuristics, execution journals, checkpoints, and retry/resume paths. See [docs/automation-agent.md](docs/automation-agent.md) and [docs/architecture.md](docs/architecture.md).

## Tech stack

- Electron 42
- React 19 and TypeScript
- Vite and esbuild
- Playwright with Chromium/CDP
- Vercel AI SDK with provider adapters for OpenAI, Anthropic, Google Gemini, Google Vertex AI, Groq, DeepSeek, Nebius, and OpenRouter
- WebRTC and Socket.IO for remote sessions
- Zustand, Zod, Radix UI, Tailwind CSS, and Vitest
- Transformers.js with a pinned ONNX Whisper tiny English model for local speech-to-text

## Getting started

### Prerequisites

- Node.js with npm. Use a current LTS release; Node 20+ is recommended for the Electron and TypeScript toolchain.
- macOS, Windows, or Linux.
- A Chromium-compatible browser is installed automatically by Playwright during dependency installation. A system Chrome/Chromium/Edge installation is also supported for local browser mode.
- An API key for at least one configured AI provider if you want to run agent or recovery flows. Vertex AI can use Google Application Default Credentials instead of an API key.
- Microphone permission only if you want local Whisper speech-to-text.

### Install

macOS/Linux:

```bash
./scripts/setup.sh
```

Windows PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup.ps1
```

The setup scripts verify Node/npm, install from `package-lock.json` with `npm ci`, and install Playwright's Chromium browser through the package `postinstall` hook. They do not overwrite an existing `.env`; this repository currently does not include a `.env.example`, so provider credentials should be entered in the app Settings screen.

### Run the Electron app

```bash
npm run dev
```

This starts the Vite renderer and the Electron main process together. For focused development:

```bash
npm run dev:renderer   # renderer only at http://localhost:5173
npm run dev:main       # build main process and launch Electron
```

For a production-style local run after building:

```bash
npm run build
npm start
```

### Configure the app

Open Settings inside RemoteCtrl and configure the provider/model you want to use. API keys are handled by the Electron main process and encrypted with `safeStorage` when the operating-system credential service is available; they are not exposed to the React renderer or committed to the repository.

Supported provider profiles and their default model families include:

| Provider | Default model | Credential path |
| --- | --- | --- |
| OpenAI | `gpt-4o` | API key in Settings |
| Anthropic | `claude-3-5-sonnet-latest` | API key in Settings |
| Google Gemini | `gemini-2.5-pro` | API key in Settings |
| Google Vertex AI | `gemini-2.5-flash` | Google ADC and project configuration |
| Groq | `llama-3.3-70b-versatile` | API key in Settings |
| DeepSeek | `deepseek-chat` | API key in Settings |
| Nebius | `meta-llama/Llama-3.3-70B-Instruct` | API key in Settings |
| OpenRouter | `anthropic/claude-3.5-sonnet` | API key in Settings |

Optional Vertex AI setup uses the environment variables recognized by the resolver (`GOOGLE_VERTEX_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `GCP_PROJECT`, or `GCLOUD_PROJECT`) and `GOOGLE_APPLICATION_CREDENTIALS`, or local Google ADC via `gcloud auth application-default login`.

Other settings include browser mode/profile, headless mode, signaling URL, vision controls, theme, shortcut, and speech input mode. The default signaling URL is `https://remotectrl-signaling.onrender.com`.

### Local Whisper speech-to-text

Speech is local-only and optional. In Settings:

1. Start the local Whisper model download.
2. Wait for integrity verification to finish.
3. Enable microphone audio and grant the OS microphone permission.
4. Use push-to-talk or hands-free input according to the selected speech mode.

The app downloads a pinned `onnx-community/whisper-tiny.en` model into Electron user data, verifies its file sizes and SHA-256 digests, and runs inference locally through Transformers.js. Runtime configuration uses local model files only and disables remote model/cache access. Audio is not sent through the remote session or signaling server. The capture path currently limits a transcription segment to 60 seconds.

### Optional signaling server

Remote host/controller sessions use the Socket.IO server. Run it locally when you want to test the full remote flow without the hosted endpoint:

```bash
npm run server
```

The server listens on port `3001` by default. Override it for a local session with:

```bash
PORT=3010 npm run server
```

On Windows PowerShell:

```powershell
$env:PORT = '3010'; npm run server
```

Then set the signaling URL in Settings to `http://localhost:3010` (or the reachable URL for the machine hosting the server). The signaling server uses short-lived PIN rooms, host approval, WebSocket transport, and basic failed-attempt rate limiting. It is a hackathon server and should not be exposed publicly without additional authentication, TLS, monitoring, and deployment hardening.

## Demo workflow

The included client portal is static and does not require credentials or external network access:

```bash
python3 -m http.server 4173 --directory demo-site
```

Open [http://localhost:4173/index.html](http://localhost:4173/index.html), then create or run a workflow that:

1. Opens the portal.
2. Opens domain setup.
3. Fills `#domainName` with `acme.example`.
4. Selects `cloudflare` in `#dnsProvider`.
5. Clicks `#continueButton`.
6. Verifies the success page.

See [demo-site/README.md](demo-site/README.md) for the exact presentation flow and selector details.

## Chrome extension

The extension connects to the desktop bridge at `ws://127.0.0.1:45456`.

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the repository's `extension/` directory.
5. Pin the extension and open it on a page.

The extension can delegate the active page and record interactions. Password values are masked before a recorded workflow is sent to the desktop bridge. See [extension/README.md](extension/README.md).

## Quality checks

Run the full verification set before submitting a hackathon build:

```bash
npm test
npm run typecheck:all
npm run lint
npm run build
git diff --check
```

Useful focused commands:

```bash
npx vitest run src/main/automation src/main/ipc src/main/speech src/renderer/hooks
npm run build:renderer
npm run build:main
```

The app can be packaged for macOS, Windows, and Linux with:

```bash
npm run pack
```

Packaging requires the platform-specific Electron builder prerequisites and signing/notarization configuration for production distribution. The repository currently publishes no demo binary or test account.

## Policy, data, security, and limitations

- Settings, workflows, automation history, model metadata, and browser profiles are stored under Electron's `app.getPath('userData')`.
- Typical locations are `~/Library/Application Support/RemoteCtrl/` on macOS, `%APPDATA%\\RemoteCtrl\\` on Windows, and `~/.config/RemoteCtrl/` on Linux.
- API keys use Electron `safeStorage` (Keychain on macOS, DPAPI on Windows, and the platform secret service on Linux when available). The README does not claim encryption is guaranteed on every environment.
- Browser profiles may contain authenticated cookies and history. Treat the user-data directory as sensitive.
- Remote sessions stream browser frames and forward approved controller input. Use a trusted signaling endpoint and do not share session PINs publicly.
- Task policy can express capability, origin/domain/path, action-count, expiry, and approval requirements. Domain restrictions are optional and controlled by the task policy toggle; local sessions intentionally retain direct-control behavior.
- The demo workflow documents self-healing behavior, not comprehensive remote-input policy enforcement.
- The project is a hackathon build. Production deployment still needs signed installers, a hardened signaling deployment, stronger identity/access controls, observability, and a security review.

More detail: [docs/storage-security.md](docs/storage-security.md), [docs/webrtc-remote.md](docs/webrtc-remote.md), and [docs/workflows-replay.md](docs/workflows-replay.md).

## Repository guide

```text
src/main/automation/   agent loop, browser tools, workflow execution, retries
src/main/ipc/          validated renderer/main IPC handlers
src/main/speech/       local Whisper model manager and runtime
src/renderer/           React screens, stores, browser and workflow UI
src/shared/             types, schemas, defaults, IPC contracts
server/                 optional Socket.IO signaling server
extension/              Manifest V3 browser extension
demo-site/              offline workflow demo target
docs/                   architecture, security, workflow, and design notes
research/               browser-use and Stagehand architecture research
scripts/                macOS/Linux and Windows developer setup scripts
```

## How Codex and GPT-5.6 were used

Codex was used as a senior engineering collaborator for planning, architecture research, implementation delegation, UI/UX refinement, stability work, local Whisper integration, testing, and documentation. Luna agents were used for bounded implementation and research tasks, while the main session coordinated changes and verified the final documentation.

This documentation pass was informed by Codex session:

```text
019f769b-288e-7da1-bdf6-9f11b22a5b7a
```

## Engineering decisions

- Keep browser automation and credentials in the Electron main process; expose only typed, narrow IPC methods to the renderer.
- Prefer compact DOM observations and stable semantic selectors before visual fallback so agent actions remain inspectable and recoverable.
- Store workflows and history locally with atomic writes so an interrupted run is less likely to corrupt state.
- Keep remote transport separate from local automation and require an explicit host approval step before controller input is accepted.
- Make speech-to-text opt-in and local, with a pinned model manifest and integrity verification.
- Keep the hackathon demo deterministic through a static local site instead of relying on an external SaaS account.

## Future work

- Add signed release artifacts and CI for macOS, Windows, and Linux.
- Harden signaling authentication, authorization, TLS, and abuse controls.
- Add richer automation observability and long-running soak tests.
- Improve model download resume UX and package the local inference path for all release targets.
- Add end-to-end tests for remote sessions, extension recording, and full workflow replay.

## License

RemoteCtrl is licensed under the [MIT License](LICENSE).
