# Autonomous AI Agent Engine

RemoteCtrl features a powerful autonomous agent loop designed to generate and execute browser interactions based on natural language user instructions.

---

## 1. The Core Loop: `runToolLoop`

The agent execution loop is implemented in `src/main/automation/agent-loop.ts`. It leverages the **Vercel AI SDK v5** via `generateText` with tool calling.

```
[User Prompt] ────> [LLM / generateText]
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
   [Tool Call]                      [Final Message]
        │                                 │
   [Playwright Action]                    ▼
        │                              [Done]
   [HTML DOM Snapshot]
        │
        ▼
   [onStepFinish] ───> Log to Journal
```

### execution-engine.ts
The `runAgent` function in `src/main/automation/execution-engine.ts` coordinates:
1.  Initializing the `TaskSession` and `ExecutionLogger`.
2.  Retrieving the model configuration via `model-resolver.ts`.
3.  Injecting the virtual cursor overlay onto the current tab.
4.  Compacting historical prompts via `agent-history.ts` to keep context windows low.
5.  Orchestrating fallback retries when tools fail.

---

## 2. Interactive Element Mapping (`dom-snapshot.ts`)

To prevent sending massive, raw HTML payloads to the LLM (which is slow and expensive), RemoteCtrl uses a custom serializer in `src/main/automation/dom-snapshot.ts`:
*   **Indices**: Clickable, input, and focusable elements are identified and tagged with a temporary unique attribute: `data-remctrl-index="N"`.
*   **Markdown Representation**: The DOM tree is filtered and compiled into a clean, numbered Markdown list.
*   **LLM Observation**: The LLM calls `observe()` to obtain this list (e.g. `[3] <button>Submit</button>`), allowing it to refer to elements by index (e.g. `act({ action: "click", index: 3 })`) instead of parsing raw selectors.

---

## 3. Selector Heuristic Chain (`selector-generator.ts`)

When the LLM acts on an index, the main process must resolve that index into a stable CSS or XPath selector before executing it. The generator in `src/main/automation/selector-generator.ts` evaluates candidate selectors in a prioritized order:

1.  **Unique ID**: Checks if the element has an ID and escapes it (e.g., `#username`).
2.  **Unique Attributes**: Evaluates unique elements by checking attributes like `name`, `type`, `role`, or `placeholder`.
3.  **Unique Text Content**: If a button or link has unique text, compiles a normalized XPath: `//button[normalize-space()='Submit']`.
4.  **Role + Accessible Name**: Composes role-based XPath queries.
5.  **Anchored Ancestor Path**: Relativizes paths to the nearest stable ID ancestor (e.g. `#main-content //div[2]/input`).
6.  **Structural Fallback**: Composes raw, absolute element hierarchy coordinates if all else fails.

---

## 4. Human Checkpoint Bridge (`human-checkpoint.ts`)

When the agent encounters blockades (such as CAPTCHAs, 2FA prompt screens, or actions requiring payment approvals), the executor calls the `askUser` tool defined in `src/main/automation/human-checkpoint.ts`.
*   **Suspension**: The AI loop execution halts.
*   **UI Alert**: A checkpoint modal is pushed to the React `AgentPanel.tsx`.
*   **Takeover**: The user can manually complete the check in the browser, input requested details, or select from pre-defined choices.
*   **Resumption**: Upon submission, the abort controller resumes the ReAct loop with the human's input.
