# RemoteCtrl Agent Developer Portal

Welcome to the RemoteCtrl codebase reference guide. This file serves as the primary map for AI agents and developer tools to navigate the directories, code files, and architectural documentation.

---

## 1. Project Summary

RemoteCtrl is a cross-platform remote browser control desktop application built using **Electron**, **React**, **TypeScript**, **Playwright**, and **WebRTC**. It features:
1.  **Detached Browser Runs**: Automated tasks run on a local persistent context that is fully visible and controllable.
2.  **Autonomous Agent Loop**: An AI-driven ReAct loop that acts on DOM snapshots, resolves selectors on the fly, and prompts human-takeover checkpoints for barriers like CAPTCHAs or 2FA.
3.  **Low-Latency WebRTC Control**: Remote controller applications can stream the browser screen in real-time and coordinate mouse/keyboard events over data channels.
4.  **Workflows Replay**: Workflow steps can be saved, checked, branched, and replayed with an automated self-healing selector loop.

---

## 2. Core Codebase Index

Navigate the functional modules using the absolute links below:

### Main Process (automation & storage)
*   **[src/main/automation/agent-loop.ts](../src/main/automation/agent-loop.ts)**: Orchestrates the Vercel AI SDK v5 tool execution loop, formatting log commands, and logging actions to the journal.
*   **[src/main/automation/execution-engine.ts](../src/main/automation/execution-engine.ts)**: High-level ReAct runner, managing timeouts, retry fallbacks, and model resolver instances.
*   **[src/main/automation/workflow-executor.ts](../src/main/automation/workflow-executor.ts)**: Drives deterministic replay step transitions and triggers the AI self-healing selector engine.
*   **[src/main/automation/session-journal.ts](../src/main/automation/session-journal.ts)**: Event database streaming user instructions and agent steps to JSONL for time-travel rewinds.
*   **[src/main/automation/selector-generator.ts](../src/main/automation/selector-generator.ts)**: Computes stable CSS and XPath element targets using unique properties and anchored sibling relationships.
*   **[src/main/automation/dom-snapshot.ts](../src/main/automation/dom-snapshot.ts)**: Custom DOM parser filtering the webpage layout and assigning indices to visible elements.
*   **[src/main/browser-manager.ts](../src/main/browser-manager.ts)**: Configures Playwright persistent contexts, tabs, and maps and injects incoming mouse/keyboard coordinate actions.
*   **[src/main/storage.ts](../src/main/storage.ts)**: Manages local data persistence, settings directories, and uses OS-level encryption (`safeStorage`) to secure API keys.

### Shared & Preload Interface
*   **[src/shared/schemas.ts](../src/shared/schemas.ts)**: Strict Zod validation schemas validating settings, IPC commands, and extension packets.
*   **[src/shared/types.ts](../src/shared/types.ts)**: Common types and schemas for WebRTC signaling, input payloads, and IPC models.
*   **[src/preload/index.cjs](../src/preload/index.cjs)**: The Electron secure ContextBridge exposing safe handlers and listeners to the frontend.

### Renderer stores & UI Screens
*   **[src/renderer/stores/useAgentStore.ts](../src/renderer/stores/useAgentStore.ts)**: Zustand store for agent loops, log timelines, checkpoints, and run logs.
*   **[src/renderer/stores/useConnectionStore.ts](../src/renderer/stores/useConnectionStore.ts)**: Zustand store for P2P connection coordinates, status, and active channels.
*   **[src/renderer/stores/useWorkflowStore.ts](../src/renderer/stores/useWorkflowStore.ts)**: Zustand store managing workflows list and settings config.
*   **[src/renderer/screens/AgentPanel.tsx](../src/renderer/screens/AgentPanel.tsx)**: Displays the agent feed list, collapsable execution logs, and workflow recording controllers.
*   **[src/renderer/screens/BrowserPanel.tsx](../src/renderer/screens/BrowserPanel.tsx)**: Renders the remote canvas feed, address bar controls, and intercepts cursor coordinates to stream remote mouse events.
*   **[src/renderer/screens/WorkflowEditorModal.tsx](../src/renderer/screens/WorkflowEditorModal.tsx)**: Edit panel to add, configure, and save manual or AI-recorded workflow routines.

---

## 3. Architecture Documentation

Read the modular documentation guides for detailed descriptions of specific system segments:

*   **[Core Architecture Guide](../docs/architecture.md)**: Details of process isolation boundaries, main process systems, and rendering layers.
*   **[Autonomous AI Agent Engine](../docs/automation-agent.md)**: Deep dive into the tool call ReAct loop, DOM parser indexing, selector heuristics, and human interruption checkpoints.
*   **[Workflows, Replay, & Self-Healing](../docs/workflows-replay.md)**: Reviews workflow branching logic, replay transitions, self-healing selectors, and JSONL session logging.
*   **[WebRTC Remote Control & Streaming](../docs/webrtc-remote.md)**: Details WebRTC signaling exchanges, CDP screencast video frames, and remote coordinate translations.
*   **[Storage, Persistence, & Security](../docs/storage-security.md)**: Covers Electron userData layouts, atomic writes, safeStorage credential bindings, and persistent Chrome profiles.
