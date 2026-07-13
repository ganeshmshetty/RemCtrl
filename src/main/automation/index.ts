/**
 * @file index.ts
 * @description Central barrel file and orchestrator wrapper for the automation subsystem, exposing agent and workflow execution handles.
 * Key Exported APIs: `automationOrchestrator` singleton instance, interfaces like `AutomationOrchestrator`, and re-exports of execution lifecycle control methods (`runAgent`, `cancelAgent`, `runWorkflow`, `cancelWorkflow`, `submitCheckpointResponse`, `closeBrowser`).
 * Internal Mechanics: Coordinates active task types, checks busy status of the agent loops, delegates pause/resume requests down to the engine level, and releases pooled Playwright browser resources on termination.
 * Relations: Direct entry point for renderer-facing IPC channels (defined in `agent.ipc.ts` and `webrtc.ipc.ts`) to pilot tasks and workflow pipelines.
 */

import { runAgent, cancelAgent, isAgentRunning, setAgentPaused } from './execution-engine.js';
import { runWorkflow, cancelWorkflow, isWorkflowRunning, setWorkflowPaused } from './workflow-executor.js';
import { submitCheckpointResponse } from './human-checkpoint.js';
import { closeBrowser } from './browser-pool.js';

import { ensureCursorOverlay, moveCursorTo, moveCursorToLocator } from './cursor-overlay.js';

export {
  runAgent,
  cancelAgent,
  isAgentRunning,
  setAgentPaused,
  runWorkflow,
  cancelWorkflow,
  isWorkflowRunning,
  setWorkflowPaused,
  submitCheckpointResponse,
  closeBrowser as closeStagehand,
  closeBrowser,
  ensureCursorOverlay,
  moveCursorTo,
  moveCursorToLocator,
};

export { sessionHistory } from './agent-history.js';

export interface AutomationOrchestrator {
  isBusy(): boolean;
  getActiveTaskType(): 'agent' | 'workflow' | null;
  setPaused(paused: boolean): void;
  cancelActiveTask(): void;
  closePool(): Promise<void>;
}

export const automationOrchestrator: AutomationOrchestrator = {
  isBusy(): boolean {
    return isAgentRunning() || isWorkflowRunning();
  },
  getActiveTaskType(): 'agent' | 'workflow' | null {
    if (isAgentRunning()) return 'agent';
    if (isWorkflowRunning()) return 'workflow';
    return null;
  },
  setPaused(paused: boolean): void {
    setAgentPaused(paused);
    setWorkflowPaused(paused);
  },
  cancelActiveTask(): void {
    if (isAgentRunning()) cancelAgent();
    if (isWorkflowRunning()) cancelWorkflow();
  },
  async closePool(): Promise<void> {
    await closeBrowser();
  },
};
