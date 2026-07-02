# RemCtrl Domain & Architecture Glossary

This document defines the core domain concepts and architectural vocabulary for RemCtrl, serving as the canonical reference for module seams, interfaces, and design discussions.

## Architectural Vocabulary (from `/codebase-design`)
- **Module**: A logical boundary of encapsulation defined by an **interface** and an **implementation**.
- **Interface**: The simplified surface area that callers see and depend on (methods, events, parameters).
- **Implementation**: The complex machinery hidden behind the module's interface.
- **Depth (Deep Module)**: A module whose interface is simple and small compared to the complexity of its implementation.
- **Shallow Module**: A module whose interface is nearly as complex as its implementation, offering little leverage or encapsulation.
- **Seam**: The architectural boundary where two modules meet or communicate (e.g., IPC boundary, network boundary).
- **Adapter**: A translation layer that sits behind a seam to convert external protocols into internal interfaces.
- **Locality**: The principle that code required to understand or modify a feature should live together within a single module boundary.
- **Leverage**: The architectural benefit achieved when a simple interface allows callers to invoke powerful, complex operations.

---

## Core Domain Modules

### 1. Automation Orchestrator
- **Description**: The deep module responsible for executing automated tasks in the browser, whether they are static step-by-step workflows ("Recipes") or autonomous goal-seeking loops ("Agents").
- **Interface Seam**: Exposes a unified execution interface (`executeTask`, `cancelTask`, `pauseTask`, `resumeTask`) to IPC handlers and session controllers.
- **Hidden Implementation**: Encapsulates Stagehand singleton initialization, Playwright CDP connection pooling, the `StallDetector` loop analysis, exponential backoff retries, and execution timing logs.

### 2. Settings & Storage
- **Description**: The deep module responsible for persisting user preferences, API keys, model selections, and saved recipes to disk.
- **Interface Seam**: Exposes a unified transactional key-value interface over IPC (`get(key)`, `set(key, val)`, `subscribe(key)`) rather than individual property wrappers.
- **Hidden Implementation**: Handles Zod schema validation, default fallback values, disk synchronization (`settings.json`, `api-keys.json`), and atomic IPC event broadcasting.

### 3. Remote Control Session
- **Description**: The deep adapter module responsible for connecting two RemCtrl instances (Host and Controller) for live desktop streaming and remote interaction.
- **Interface Seam**: Exposes a high-level session control interface (`connect(pin)`, `disconnect()`, `sendInput(event)`).
- **Hidden Implementation**: Encapsulates Socket.io signaling, RTCPeerConnection negotiation, ICE candidate buffering queues, and Playwright CDP screencasting.
