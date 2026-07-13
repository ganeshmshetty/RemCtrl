# Workflows, Replay, and Self-Healing

RemoteCtrl enables users to record autonomous steps during an agent run and compile them into structured, replayable workflows.

---

## 1. Replay Engine Architecture

The workflow replay loop is defined in `src/main/automation/workflow-executor.ts`. Unlike standard loops that iterate sequentially, RemoteCtrl uses a **jump-based transition engine** to support complex execution flows.

### Step Types
Workflows are built from the following steps (defined in `src/shared/types.ts`):
*   **`navigate`**: Navigates to a specific URL (forces SSL protocol completion if missing).
*   **`click` / `fill` / `select` / `keypress`**: Standard Playwright DOM actions.
*   **`wait`**: Halts execution for a specified duration in milliseconds.
*   **`extract`**: Calls a sub-agent to parse specific data items on the current domain.
*   **`check`**: Evaluates whether specific text or elements exist on the screen. If yes/no, branches execution by jumping to custom step IDs (`onTrue` / `onFalse`).

---

## 2. Self-Healing Mechanism

During deterministic replays, selectors can break if the website layout changes. Rather than failing the workflow, RemoteCtrl executes an **AI-driven self-healing pipeline**:

```
[Replay Action] ───> Selector Fails to Resolve
                          │
                          ▼
                 [onFailure: 'self_heal']
                          │
                          ▼
            [Spawns runToolLoop (1 Step)]
             "Locate & click the element"
                          │
                          ▼
                 [Healed Selector]
                          │
                          ▼
               Save to workflows.json
                          │
                          ▼
                  Resume Replay
```

1.  **Trigger**: If an action step with `onFailure: 'self_heal'` fails (due to timeout or missing elements), the executor intercepts the error.
2.  **Context Compilation**: The executor extracts the failed step description and details.
3.  **Local Agent Execution**: It invokes a single-turn `runToolLoop` instance asking the LLM to complete only that specific missing action (e.g. "Find the login button and click it").
4.  **Selector Extraction**: Once the LLM performs the step using observe/act, `rawAct` extracts the newly resolved stable selector.
5.  **Persistence**: The executor updates the step selector on disk (in `workflows.json` via `storage.ts`) so subsequent runs execute the new selector instantly.
6.  **Resume**: The workflow resumes from the next step.

---

## 3. Session Journal (`session-journal.ts`)

To support features like time-travel and easy workflow creation, RemoteCtrl uses an append-only JSONL event database in `src/main/automation/session-journal.ts`.

### Log Snapshots
As the agent runs, the loop appends `JournalSnapshot` payloads:
*   `user_message`: Records instructions.
*   `agent_step`: Records the tool inputs, Playwright output results, and clean summaries.

### Time-Travel Rewinds
If a user edits a message mid-conversation, the UI issues a rewind command:
```typescript
journal.rewindTo(snapshotId);
```
The journal truncates all events recorded after the specified snapshot ID and rewrites the `.jsonl` log file, allowing the agent to resume execution from that exact historical state without conversational amnesia.

### Workflow Exports
When exporting a session to a workflow, `extractWorkflow()` iterates through the snapshots, filtering out logs (like `think` or `notifyUser`) and translating browser tool operations (like `act({ action: 'fill' })`) into clean, structured schema steps.
