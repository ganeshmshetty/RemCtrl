# Remote Browser Agent Plan

This document outlines the technical design, architectural integration, and implementation plan for the **Remote Browser Agent** powered by Stagehand and Playwright in the RemoteCtrl desktop application.

---

## 1. Architectural Strategy

The Remote Browser Agent allows the Controller to run natural language automation tasks and pre-defined workflows on the Host machine's browser. To ensure security, performance, and robustness:
1. **Execution Environment Pays:** Stagehand runs exclusively in the Host's Main process. It accesses the Host's local API keys (configured via Settings and stored securely in `~/.config/RemoteCtrl/api-keys.json`). No API keys are sent over the network.
2. **Headed Visible Browser Session:** The agent runs visibly inside the Host's launched Playwright browser context, giving the Host user full visibility of agentic actions.
3. **CDP Screencasting Pipeline:** Active browser page frames are captured via CDP screencasting (`Page.startScreencast`) in the Main process, piped to the Renderer via Electron IPC, painted onto a `<canvas>`, and streamed to the Controller via WebRTC.
4. **Coordinate Mapping Precision:** Since coordinates are calculated relative to the active canvas stream, coordinate translation uses authoritative viewport dimension metadata, bypassing complex multi-display OS window coordinates.

---

## 2. Multi-Tab Tracking and Management

To support robust web automation, the agent environment supports multi-tab management, allowing Stagehand to run across multiple pages and enabling the Controller to see and switch tabs:

### 2.1 Tab Management Pipeline
- **Page Registration:** The Main process's `browser-manager` hooks into the active context's `page` creation event:
  ```typescript
  context.on('page', (p: Page) => {
    const entry = registerPage(p);
    activePageEntry = entry;
    startScreencast(p).then(() => emitTabsChange());
  });
  ```
- **Active Page Lifecycle:** Open tabs are tracked as `TabInfo` structures:
  ```typescript
  interface TabInfo {
    id: string;
    url: string;
    title: string;
    active: boolean;
  }
  ```
- **Screencast Switch Hook:** Switching tabs brings the new Playwright `Page` to the front, detaches the CDP session from the old page, starts a new CDP session on the target page, and announces the update to the Controller over the WebRTC data channel (`TAB_LIST`):
  ```typescript
  export async function switchTab(tabId: string): Promise<void> {
    const targetEntry = pages.find(p => p.id === tabId);
    if (targetEntry && targetEntry !== activePageEntry) {
      activePageEntry = targetEntry;
      await activePageEntry.page.bringToFront();
      await startScreencast(activePageEntry.page);
      emitTabsChange();
    }
  }
  ```

---

## 3. Dual Browser Execution Modes

RemoteCtrl supports two distinct execution environments configured by the Host settings:

1. **Internal Browser Mode (`internal`):**
   - Playwright launches its own Chromium browser server in headed mode.
   - App sets a dedicated user data directory to isolate cookies, history, and localStorage from the user's primary browser.
   - Provides a clean, sandboxed workspace ideal for predictable agent execution.

2. **Local Chrome Mode (`local_chrome`):**
   - Connects to an existing, active instance of Google Chrome running on the Host machine via Chrome DevTools Protocol (`chromium.connectOverCDP` on port `9222`).
   - Requires the Host user to start Chrome with `--remote-debugging-port=9222`.
   - Allows the remote agent to run tasks directly in pre-authenticated sessions (e.g., already logged into complex portals, SaaS apps), drastically extending utility.

---

## 4. Execution Loop & Stagehand Integration

The agent execution loop handles ad-hoc natural-language prompts as well as multi-step workflows.

```
       Controller                        Host (Renderer)                   Host (Main)
┌──────────────────────┐             ┌─────────────────────┐         ┌─────────────────────┐
│                      │  Prompt     │                     │  IPC    │                     │
│  Submits AI Prompt   │────────────>│  Forwards to Main   │────────>│ Initializes Stage   │
│                      │             │                     │         │ hand with active    │
│                      │             │                     │         │ page and API key    │
│                      │             │                     │         │                     │
│                      │             │                     │         │ Runs action:        │
│                      │             │                     │         │ `page.act(prompt)`  │
│                      │             │                     │         │                     │
│                      │             │                     │  Logs   │                     │
│  Receives progress   │<────────────│  Forwards logs/     │<────────│ Intercepts Stage    │
│  and status updates  │   Status    │  status updates     │         │ hand logger events  │
│                      │             │                     │         │                     │
└──────────────────────┘             └─────────────────────┘         └─────────────────────┘
```

### 4.1 Log & Status Interception
Stagehand's internal progress logging is captured by passing a custom logger configuration during initialization:
```typescript
const stagehand = new Stagehand({
  page: getPage(),
  env: 'LOCAL',
  apiKey: openAiKey,
  logger: (logLine) => {
    // Send logs back to Renderer -> Controller
    emitAgentLog({ level: 'info', message: logLine.message });
  }
});
```

### 4.2 Step-by-Step Workflow Runs
Workflows are sent from the Controller as an `AGENT_WORKFLOW_BATCH` payload, comprising ordered steps:
- **Steps:** A list of `{ action: 'act' | 'observe' | 'extract', instruction: string }` definitions.
- **Execution Queue:** The Host executes these steps sequentially. If a step fails, the queue halts, a `WORKFLOW_STEP_STATUS` (state: `failed`) is emitted, and the workflow is marked `failed`.
- **Navigation Start:** If the workflow specifies a `startUrl`, the Host browser navigates to that page before step 1.

---

## 5. Taking Control & Cancellation Mechanics

To prevent race conditions between the autonomous agent and manual takeover:

1. **Instant Interrupt Strategy:**
   - Because Stagehand does not offer native runtime pause/resume during an active LLM-driven step, RemoteCtrl utilizes a cooperative cancellation model.
   - Clicking **Takeover** or **Cancel** sends a cancellation request.
   - The Main process sets the active execution state to `cancelling`.
   - The active Stagehand command is halted or aborted, throwing a clean abort error to terminate the promise chain.
   
2. **Transitioning State:**
   - Once Stagehand exits, the Host process moves into the `HUMAN_TAKEOVER` state.
   - The WebRTC reliable and unreliable data channels immediately become receptive to keyboard and mouse coordinates injected through Playwright `page.mouse` and `page.keyboard`.
   - Upon release of manual control, the system transitions back to `SESSION_ACTIVE`. The Controller can now invoke a new prompt starting from the newly established browser state.

---

## 6. Security and Isolation Guarantees

- **Authoritative Approval Loop:** No remote commands (takeover or prompts) can execute until the Host user explicitly approves the Controller joining by PIN.
- **No Key Leaks:** Raw API keys never touch the network or the Renderer processes.
- **Sandbox Boundary:** When running in internal mode, the browser is strictly isolated from default user accounts, protecting Host credentials.
