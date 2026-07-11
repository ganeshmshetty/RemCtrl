# RemoteCtrl

Remote browser control desktop app — Electron + React + TypeScript.

## Architecture

```
src/
  main/                   Electron main process (Node.js)
    automation/           AI Agent execution engine, tools, planner & workflow executors
      agent-loop.ts       Core AI step-by-step tool generation loop
      agent-tools.ts      Playwright browser tool wrappers (goto, act, observe, extract, scroll, etc.)
      cursor-overlay.ts   Stagehand-inspired visual cursor overlay script injector
      human-checkpoint.ts Interactive human takeover & checkpoint prompts
      workflow-executor.ts Workflow runner and task evaluations
      ... (planner, resolver, stall-detector, logger)
    ipc/                  Electron IPC handler registrations
      agent.ipc.ts        Agent prompt execution signaling handlers
      browser.ipc.ts      Browser lifecycle (launch, tabs, keyboard/mouse events)
      settings.ipc.ts     Application settings & multi-profile configurations
      webrtc.ipc.ts       WebRTC signaling & connection setup
      workflow.ipc.ts     Workflow storage CRUD operations
    browser-manager.ts    Playwright context, tab tracking, dynamic/detached launcher
    ext-server.ts         WebSocket server bridge for Chrome Extension integrations
    index.ts              App lifecycle, tray creation, window management, and graceful exits
    storage.ts            Filesystem-backed JSON store for settings, workflows, and API keys
  preload/
    index.cjs             Secure contextBridge API (renderer ↔ main)
  renderer/               React UI (browser context)
    screens/              Panels & view screens
      AgentPanel.tsx      AI Agent console, chat feed with collapsable steps
      BrowserPanel.tsx    Remote browser screen capture & WebRTC streaming panel
      Settings.tsx        Configuration panels for models, keys, and custom profiles
      WorkflowsPanel.tsx  Workflow listing and run triggers
      WorkflowEditorModal.tsx Drag-and-drop workflow editor
      MiniWindow.tsx      Minimal Spotlight-like floating controller overlay
    stores/               Zustand state managers
      useAgentStore.ts    Agent logs, run history, and streaming chat history
      useConnectionStore.ts Peer-to-peer signaling & connection state
      useUIStore.ts       View transitions and routing states
      useWorkflowStore.ts App configurations, profiles, and workflow definitions
    index.css             Global design system CSS tokens and components
  shared/
    types.ts              Shared TypeScript interfaces and types
    schemas.ts            Zod schemas for IPC and store configuration validations
```

## Development

```bash
# Install dependencies
npm install

# Run renderer only (browser dev mode)
npm run dev:renderer

# Build main process
npm run build:main

# Run full Electron app (requires renderer to be built or dev server running)
npm run dev

# Typecheck renderer
npx tsc --project tsconfig.app.json --noEmit

# Typecheck main process
npx tsc --project tsconfig.main.json --noEmit

# Build everything
npm run build
```

## Implementation Status

*Implementation complete. Currently in Bug Fixes & Enhancements Phase.*

## Key Constraints

- Renderer never accesses Node APIs directly — only through `window.RemoteCtrlAPI`
- All IPC payloads validated with Zod in main process before use
- API keys stored in `~/.config/RemoteCtrl/api-keys.json` (never in renderer state)
- Workflows stored in `~/.config/RemoteCtrl/workflows.json`
- Settings stored in `~/.config/RemoteCtrl/settings.json`
- Custom Chrome profiles stored under `~/.config/RemoteCtrl/browser-profiles/`
