# RemoteCtrl Agent & UI Enhancements To-Do

This document tracks upcoming core functionality enhancements focusing exclusively on Agent logic, Task Execution, and their respective UI/UX implementations.

## 1. Core Agent & Task Execution Enhancements

- [✅] **Manual Takeover / Agent Pause & Resume Integration**
  - **Concept**: Treat manual takeover as a collaborative "human assist" mode rather than just an override.
  - **Implementation**: 
    - Modify `agent-executor.ts` and `workflow-executor.ts` to listen for a `takeover_active` event via IPC.
    - When active, the agent's multi-step ReAct loop (Observe -> Decide -> Act) pauses immediately. 
    - When the user releases takeover, the agent captures a fresh page fingerprint, evaluates the new state, and dynamically generates the next prompt to continue toward the overarching goal.

- [✅] **True LLM Task Planning (`task-planner.ts`)**
  - **Concept**: Move from static heuristic-based planning to dynamic LLM decomposition.
  - **Implementation**: 
    - Hook the `TaskPlanner.generateSubtasks()` method directly to the LLM. 
    - Send the high-level prompt, returning a structured JSON schema of actionable subtasks (Navigation, Extraction, Interaction).
    - Track dependencies between subtasks to ensure execution order.

- [✅] **Interactive Human-in-the-Loop (`human-checkpoint.ts`)**
  - **Concept**: The agent should proactively ask for help instead of silently failing or guessing.
  - **Implementation**: 
    - If `UncertaintyDetector` fires (e.g., low confidence on a captcha or login wall), pause execution and emit an `AGENT_CHECKPOINT_REQUIRED` event containing context and multiple-choice options.

- [✅] **Task Self-Evaluation (`task-evaluator.ts`)**
  - **Concept**: Prevent silent failures where the agent incorrectly marks a task as successful.
  - **Implementation**: 
    - After completion, invoke the `TaskEvaluator` to verify the output (e.g., "Did I actually extract 10 jobs?"). If the check fails, automatically trigger a replan to fix the gaps.

## 2. UI/UX Enhancements for Agents

- [✅] **Agent Pause / Manual Control Overlay**
  - **Details**: When the user clicks "Takeover", the `Agent Status` badge should change to a pulsating amber "Agent Paused - Manual Control Active". The video stream should display a subtle border or overlay indicating the human is driving.

- [ ] **Task Planner Timeline & Progress View**
  - **Details**: For complex tasks, show a step-by-step checklist in the right sidebar. Each generated subtask should have a visual status icon (Pending ⚪, Running 🔄, Completed ✅, Failed ❌), updating in real-time.

- [✅] **Interactive Chat Prompts for Checkpoints**
  - **Details**: When the agent requires human intervention (`human-checkpoint`), it shouldn't just be text. Render a specialized chat bubble containing actionable buttons (e.g., "Option A", "Option B") or a dedicated input field for the user to steer the agent.

- [ ] **Visual Action Bounding Boxes**
  - **Details**: During the agent's "Observe" phase, use Stagehand's element detection to draw temporary, labeled bounding boxes directly over the WebRTC video stream. This allows the user to see exactly what elements the agent is considering interacting with.

## 3. Chat Window & Execution Log Overhaul

- [✅] **De-clutter the Chat Interface**
  - **Concept**: The chat window should strictly be a conversational interface for high-level commands and final summaries, not a dumping ground for raw execution logs or transient errors.
  - **Implementation Details**:
    - **No Log Bubbles**: Remove individual chat bubbles for standard execution logs (e.g., "Clicking button", "Waiting for network").
    - **Inline Status Text**: The active agent chat bubble should have a dynamic, inline "current action" subtext that updates in place (e.g., *Looking at the page...* ➔ *Clicking 'Login'...*).
    - **Consolidated Summaries**: Once a task finishes, the agent sends *one* chat bubble summarizing the result (e.g., "I successfully extracted the data and saved it.").
    
- [✅] **Dedicated Execution Console / Drawer**
  - **Concept**: Power users still need to see logs for debugging, but they shouldn't live in the chat.
  - **Implementation Details**:
    - Add a collapsible "Execution Console" or terminal-style drawer at the bottom of the UI (or in a separate tab).
    - All raw Stagehand logs, CDP events, and stack traces get routed here.
    - Include filters (Info, Warnings, Errors) and auto-scroll capabilities.

- [✅] **Actionable Error Bubbles**
  - **Concept**: Only critical, actionable errors should make it to the chat.
  - **Implementation Details**:
    - If the agent fails catastrophically and cannot auto-replan, it sends a chat bubble explaining the failure in human terms (e.g., "I couldn't get past the login screen.").
    - Provide a "Try Again" or "Takeover" button directly inside that error chat bubble.

## 4. Workflow Editor UX

- [ ] **Simplify Workflow Action Types**
  - **Concept**: Hide the "Act / Observe / Extract" technical dropdown from the end-user.
  - **Implementation Details**:
    - Remove the action type dropdown in the Workflow Editor UI.
    - Default all user-created steps to "act" (as the underlying Stagehand agent can dynamically infer when to extract or observe based on natural language instructions).
