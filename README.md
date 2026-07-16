# RemoteCtrl

**Your personal AI-powered browser assistant — as a desktop app.**

RemoteCtrl is an easy-to-use desktop application that lets you remotely view, control, and automate a web browser. Whether you want to control a browser on another computer, or have a smart AI assistant perform online tasks for you, RemoteCtrl makes it simple and secure.

> [!IMPORTANT]
> This project is currently in active development. Core features are working great, but you might occasionally run into rough edges as we continue to improve the app.

---

## 🌟 What can you do with RemoteCtrl?

- **Watch in Real-Time**: See a live video stream of a remote web browser with virtually no delay.
- **Take Control**: Use your own mouse and keyboard to click and type on the remote browser just like you were sitting in front of it.
- **AI Web Assistant**: Ask the built-in AI agent (powered by leading models like ChatGPT, Claude, and Gemini) to do things for you in plain English—like "extract the pricing plans from this website" or "book a flight to New York."
- **Automate Repetitive Tasks**: Build your own "Workflows" using a simple drag-and-drop editor. Create recipes that navigate to pages, click buttons, collect information, and check conditions automatically.
- **Step in when needed**: If the AI gets stuck (for example, on a CAPTCHA or a login screen), it will pause and let you take over. Once you're done, the AI resumes its task!
- **Works Offline / Locally**: Don't want to connect to another computer? You can run the browser, your agents, and workflows entirely on your own machine.
- **Private and Secure**: Your AI API keys are securely encrypted on your computer and never sent anywhere else.

---

## 🚀 Getting Started

To use the AI features, you will need an API key from a supported provider (like OpenAI, Anthropic, or Google Gemini). Simply enter your key in the Settings screen, and you're ready to go!

### Supported AI Providers
You can choose the AI brain that works best for you:
- **OpenAI** (ChatGPT)
- **Anthropic** (Claude)
- **Google Gemini**
- **DeepSeek**
- **Groq**, **OpenRouter**, and **Nebius Token Factory**

---

<br>
<br>

# 🛠️ For Developers

If you want to look under the hood, contribute to the code, or build RemoteCtrl from scratch, this section is for you!

## How It Works (Architecture Overview)

```
┌─────────────────────────────┐        WebRTC / Socket.io        ┌───────────────────┐
│         Host Machine        │ ◄────────────────────────────────► │  Controller App   │
│                             │                                    │                   │
│  Electron Main Process      │  ← Signaling (PIN-based pairing)  │  React UI         │
│    Playwright browser       │  ← Video stream (WebRTC)          │  Remote control   │
│    Stagehand AI agent       │  → Mouse / keyboard events        │  Workflow runner  │
│    Workflow executor        │  → Agent commands                  │                   │
└─────────────────────────────┘                                    └───────────────────┘
```

Sessions are established with a short PIN. The host approves each incoming connection. Once connected, the controller sees a live stream of the browser via WebRTC.

## Development Setup

### Prerequisites
- Node.js 20+
- A supported API key

### Installation

```bash
git clone https://github.com/ganeshmshetty/RemCtrl.git
cd RemCtrl
npm install
# This also runs `playwright install chromium` automatically
```

### Running in Development

```bash
# Start the full Electron app (renderer + main, hot-reload)
npm run dev

# Or run the renderer only in a browser (no Electron)
npm run dev:renderer
```

### Building for Production

```bash
# Type-check everything first
npx tsc --project tsconfig.app.json --noEmit
npx tsc --project tsconfig.main.json --noEmit

# Build renderer + main
npm run build

# Package into a distributable (macOS DMG, Windows NSIS, Linux AppImage)
npm run pack
```

---

## Project Structure

```
src/
├── main/                   # Electron main process (Node.js)
│   ├── index.ts            # App lifecycle and window creation
│   ├── storage.ts          # Settings, workflow, and API key storage
│   ├── ipc-handlers.ts     # IPC handler registrations
│   ├── browser-manager.ts  # Playwright browser lifecycle and input injection
│   ├── ipc/                # Per-domain IPC modules
│   └── automation/         # AI agent and workflow engine
├── preload/
│   └── index.cjs           # contextBridge API (renderer ↔ main)
├── renderer/               # React UI (browser context)
│   ├── screens/            # UI panels: Agent, Browser, Workflows, Settings
│   ├── stores/             # Zustand state (connection, agent, workflow, settings)
│   └── index.css           # Global CSS with design tokens
└── shared/
    ├── types.ts            # Shared TypeScript types and RemoteCtrlAPI interface
    ├── schemas.ts          # Zod validation schemas for all IPC payloads
    └── default-models.ts   # Bundled fallback model lists per provider
```

---

## Configuration & Storage

Settings are persisted to the platform user data directory (e.g. `~/Library/Application Support/RemoteCtrl/`):

| File | Contents |
|---|---|
| `settings.json` | Signaling URL, preferred provider, custom base URLs, browser mode |
| `api-keys.json` | Encrypted API keys via OS keychain (never exposed to the renderer) |
| `workflows.json` | Saved local workflows |
| `models.json` | Locally cached model lists fetched from provider APIs |

---

## Architecture Notes

- **Security**: The renderer process has zero access to Node.js APIs. All privileged operations are handled in the main process and exposed via a narrow, Zod-validated `contextBridge` API (`window.RemoteCtrlAPI`).
- **Agents vs. Workflows**: Agents use a `DynamicPlanner`-driven ReAct loop to handle open-ended goals. Workflows are deterministic recipes with explicit jump-based branching, designed to run the same way every time.
- **Unified Execution Engine**: A single `ExecutionEngine` handles all agent instructions regardless of complexity. 
- **TaskSession**: Both the agent and workflow executors own their lifecycle state (running / paused / cancelled) through a `TaskSession` instance rather than scattered module-level booleans.
- **Event-Driven Cancellation**: The execution engine uses an `AbortController` for zero-latency, clean cancellation instead of polling.
- **Stagehand Pool**: A singleton Stagehand instance is reused across steps to avoid ~500ms re-initialization costs.

---

## Signaling Server

A lightweight Socket.io signaling server is included for local use or self-hosting:

```bash
npm run server
```

By default, the app connects to a hosted signaling server. You can override this in Settings.
