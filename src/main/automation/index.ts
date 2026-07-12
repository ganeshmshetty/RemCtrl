/**
 * Automation Orchestrator — Deep module seam for browser automation
 *
 * Encapsulates:
 * - Direct Playwright CDP pooling and lifecycle (browser-pool)
 * - Unified ReAct agent pipeline via ExecutionEngine
 * - Linear and jump-based workflow recipe execution
 * - Human-in-the-loop checkpoint management
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
