# RemoteCtrl

**Remote browser control and AI agent automation — as a desktop app.**

RemoteCtrl is an Electron desktop application that lets you remotely control a browser over WebRTC and run AI agents against it. A **host** machine launches a Playwright-managed browser and streams it live; a **controller** connects via a PIN to see, control, and automate that browser — all without exposing it to the internet.

> [!IMPORTANT]
> This project is currently in active development. Core features are stable, but some rough edges remain.

---

## Features

- **Live Browser Streaming** — WebRTC-based screen capture with <100ms latency for real-time remote viewing.
- **Remote Input Injection** — Mouse and keyboard events are forwarded precisely, with coordinate mapping between controller and host viewports.
- **AI Agent Execution** — Give natural-language instructions to an LLM-powered agent (via [Stagehand](https://github.com/browserbasehq/stagehand)) that acts, extracts, and observes the live browser page.
- **Smart Workflows** — Build reusable automation recipes with human-readable steps: `navigate`, `do`, `collect`, and conditional `check` branches.
- **Human-in-the-Loop (HITL)** — Agent pauses on blockers (CAPTCHAs, 2FA) and hands control back to a human, then resumes.
- **Multi-Provider AI** — Supports OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Nebius Token Factory, and OpenRouter. Per-provider custom base URLs are supported.
- **Self-Healing Agents** — A `StallDetector` monitors agent loop state and triggers a `StrategyGenerator` to reformulate its approach when stuck.
- **Secure IPC** — Renderer never touches Node APIs directly; all calls go through a typed `contextBridge` with Zod-validated payloads.

---

## How It Works

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

Sessions are established with a short PIN. The host approves each incoming connection. Once connected, the controller sees a live stream of the browser and can:
- Send mouse/keyboard inputs for manual control.
- Issue natural-language prompts to the AI agent.
- Run saved workflows step-by-step.

---

## Getting Started

### Prerequisites

- Node.js 20+
- A supported API key (OpenAI, Anthropic, Gemini, etc.)

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
│   │   ├── agent.ipc.ts    # Agent and workflow IPC handlers
│   │   ├── browser.ipc.ts  # Browser control IPC handlers
│   │   ├── settings.ipc.ts # Settings IPC handlers
│   │   └── workflow.ipc.ts # Workflow CRUD IPC handlers
│   └── automation/         # AI agent and workflow engine
│       ├── index.ts              # AutomationOrchestrator (public seam)
│       ├── execution-engine.ts   # Unified ReAct agent loop (DynamicPlanner-driven)
│       ├── task-session.ts       # Lifecycle state machine (running/paused/cancelled)
│       ├── task-planner.ts       # DynamicPlanner: per-step goal decomposition
│       ├── task-evaluator.ts     # Post-step result quality evaluation
│       ├── strategy-generator.ts # Reformulates approach after failed steps
│       ├── stall-detector.ts     # Detects agent loops and stuck DOM states
│       ├── instruction-parser.ts # LLM-based navigation intent extraction
│       ├── workflow-executor.ts  # Smart Workflow jump-based step runner
│       ├── human-checkpoint.ts   # HITL pause/resume callback mechanism
│       ├── stagehand-pool.ts     # Singleton Stagehand instance pool
│       ├── model-resolver.ts     # Unified model and Stagehand config resolution
│       └── provider-profiles.ts  # Registry of LLM provider configs
├── preload/
│   └── index.cjs           # contextBridge API (renderer ↔ main)
├── renderer/               # React UI (browser context)
│   ├── main.tsx
│   ├── App.tsx             # Event wiring for main→renderer push events
│   ├── screens/            # UI panels: Agent, Browser, Workflows, Settings
│   ├── stores/             # Zustand state (connection, agent, workflow, settings)
│   └── index.css           # Global CSS with design tokens
└── shared/
    ├── types.ts            # Shared TypeScript types and RemoteCtrlAPI interface
    ├── schemas.ts          # Zod validation schemas for all IPC payloads
    └── default-models.ts   # Bundled fallback model lists per provider
```

---

## Configuration

Settings are persisted to the platform user data directory (e.g. `~/Library/Application Support/RemoteCtrl/`):

| File | Contents |
|---|---|
| `settings.json` | Signaling URL, preferred provider, custom base URLs, browser mode |
| `api-keys.json` | API keys (never exposed to the renderer) |
| `workflows.json` | Saved local workflows |
| `models.json` | Locally cached model lists fetched from provider APIs |

### Supported AI Providers

| Provider | Protocol | Notes |
|---|---|---|
| OpenAI | Native | GPT-4o, o3-mini, etc. |
| Anthropic | Native | Claude 3.5 Sonnet, etc. |
| Google Gemini | Native | Gemini 2.5 Pro/Flash |
| Groq | OpenAI-compatible | Llama 3.3 70B |
| DeepSeek | OpenAI-compatible | DeepSeek Chat |
| Nebius Token Factory | OpenAI-compatible | Custom base URL |
| OpenRouter | OpenAI-compatible | Access to many models |

Custom base URLs can be configured per provider in the Settings screen.

---

## Architecture Notes

- **Security**: The renderer process has zero access to Node.js APIs. All privileged operations are handled in the main process and exposed via a narrow, Zod-validated `contextBridge` API (`window.RemoteCtrlAPI`).

- **Agents vs. Workflows**: Agents use a `DynamicPlanner`-driven ReAct loop to handle open-ended goals — the planner decides the next action at each step based on current page state and a running scratchpad. Workflows are deterministic recipes with explicit jump-based branching, designed to run the same way every time. See [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md) and [WORKFLOW_ARCHITECTURE.md](./WORKFLOW_ARCHITECTURE.md) for details.

- **Unified Execution Engine**: A single `ExecutionEngine` handles all agent instructions regardless of complexity. Simple one-shot commands and complex multi-step tasks go through the same `DynamicPlanner` ReAct loop — the planner naturally exits after one step for simple tasks.

- **TaskSession**: Both the agent and workflow executors own their lifecycle state (running / paused / cancelled) through a `TaskSession` instance rather than scattered module-level booleans. This makes the pause/cancel state machine auditable in one place.

- **Stagehand Pool**: A singleton Stagehand instance is reused across steps to avoid ~500ms re-initialization costs and to preserve accumulated selector cache.

- **Provider Profiles**: `provider-profiles.ts` is the single source of truth for each provider's protocol, default model, Stagehand prefix, and base URL.

---

## Signaling Server

A lightweight Socket.io signaling server is included for local use or self-hosting:

```bash
npm run server
```

By default, the app connects to a hosted signaling server. You can override this in Settings.
