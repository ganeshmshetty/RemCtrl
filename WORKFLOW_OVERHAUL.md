# RemoteCtrl Workflow Architecture Plan

This document outlines the architectural shift from an AI-interpreted workflow system to a deterministic, two-layer execution model. This design is heavily inspired by the paradigms used in Stagehand v3, but extended with robust self-healing and selector fallback mechanisms.

## 1. The Current Drawbacks

Our current system treats Agent Tools and Workflow Steps as the same conceptual entity. When a workflow is saved or executed, it relies heavily on LLM interpretation. This leads to several critical issues:

*   **Non-Deterministic Replay:** Workflows save steps as natural language instructions. During playback, the LLM must re-reason the page structure to execute the step, which is slow, expensive, and prone to hallucinations.
*   **Ephemeral Addressing:** The `observe()` tool assigns temporary `[data-remctrl-index="2"]` attributes. These are highly fragile and completely invalidate upon page reload.
*   **Poor User Editability:** The user cannot easily manually correct a broken selector without confusing the AI.
*   **High Latency & Token Cost:** Replaying a 10-step form fill currently requires 10 separate LLM calls.

## 2. The RemoteCtrl Dual-Layer Architecture

We will adopt a architecture that bridges the gap between AI exploration and deterministic execution, but with a critical safety net: **Self-Healing AI Fallback**.

### Layer 1: Agent Execution & Auto-Recording (AI-Driven)
When the LLM uses `act({ index: 2, action: "click" })`:
1.  The `agent-tools.ts` resolves the index to the actual DOM element.
2.  **Selector Generation Priority Engine:** It computes a stable locator using a strict priority chain:
    *   Unique `id`
    *   Stable attributes (`data-testid`, `aria-label`, `name`)
    *   Role + Accessible Name
    *   Text content (scoped to nearest stable ancestor)
    *   Relative XPath (anchored to nearest stable ancestor)
3.  The action is executed.
4.  An IPC event `recordStep` is emitted, appending a strictly typed, deterministic step to the recording. Crucially, it captures a semantic `description` of what it just did.

### Layer 2: Deterministic Workflow Primitives
The Workflow Editor and `schemas.ts` use explicit primitives:

```typescript
type WorkflowStep =
  | { type: 'navigate', url: string }
  | { type: 'click', selector: string, description: string } 
  | { type: 'fill', selector: string, value: string, description: string }
  | { type: 'select', selector: string, value: string, description: string }
  | { type: 'keypress', key: string }
  | { type: 'wait', ms: number }
  | { type: 'extract', instruction: string, variableName: string } // AI-driven
  | { type: 'check', condition: string, onTrue: string, onFalse: string } // AI-driven branching
```

### Layer 3: Pure Playwright Executor with Self-Healing AI
`workflow-executor.ts` will attempt a "fast path" Playwright execution. If (and only if) the layout has drifted and the selector fails, it degrades gracefully back into the AI loop.

**Execution Loop with Self-Heal:**
```typescript
for (const step of workflow.steps) {
  if (step.type === 'click' || step.type === 'fill') {
    try {
      // ⚡️ FAST PATH: Zero-LLM deterministic execution
      const locator = page.locator(step.selector);
      await locator.waitFor({ timeout: 3000 });
      if (step.type === 'click') await locator.click();
      else await locator.fill(resolve(step.value));
    } catch (err) {
      // SELF-HEAL PATH: Selector is stale (layout drifted)
      // We drop into a single-step AI repair pass using the stored 'description'
      console.log(`Selector failed. Self-healing using description: "${step.description}"`);
      const repairedSelector = await triggerAIFallback(page, step.description);
      
      // Execute with repaired selector
      if (step.type === 'click') await page.locator(repairedSelector).click();
      else await page.locator(repairedSelector).fill(resolve(step.value));
      
      // 💾 Persist the repaired selector back to the workflow so it's fast next time
      updateWorkflowStepSelector(step.id, repairedSelector);
    }
  }
  // ... handle navigate, extract, check, etc.
}
```

## 3. Implementation Roadmap

1.  **Schema Overhaul & Migration:** Update `src/shared/schemas.ts` for the new `WorkflowStep` types (including `check`). Implement a migration layer that gracefully flags or converts v1 `workflows.json` files so users don't lose data.
2.  **Selector Generation Engine:** Implement the priority-chain selector generator in `main/automation/` to avoid the fragility of absolute XPaths.
3.  **Auto-Recorder Hook:** Update `agent-tools.ts` to trigger the selector engine and dispatch the recorded step (with semantic description) via IPC.
4.  **UI Updates:** Refactor `WorkflowEditorModal.tsx` to render explicit fields. Surface a "fragility warning" if a selector relies heavily on positional indices (e.g., `nth-child`).
5.  **Executor Rewrite & Self-Healing:** Refactor `workflow-executor.ts` to implement the Fast Path / Self-Heal loop.
