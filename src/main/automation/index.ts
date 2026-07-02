/**
 * Automation Orchestrator — Deep module seam for browser automation
 *
 * Encapsulates:
 * - Singleton Stagehand CDP pooling and lifecycle (stagehand-pool)
 * - ReAct dynamic agent loops with stall detection and retry strategies
 * - Linear and jump-based workflow recipe execution
 * - Human-in-the-loop checkpoint management
 */

import { runAgent, cancelAgent, isAgentRunning, setAgentPaused } from './agent-runner.js';
import { cancelAgentCommand } from './agent-executor.js';
import { runWorkflow, cancelWorkflow, isWorkflowRunning, setWorkflowPaused } from './workflow-executor.js';
import { submitCheckpointResponse } from './human-checkpoint.js';
import { closeStagehand } from './stagehand-pool.js';

export {
  runAgent,
  cancelAgent,
  isAgentRunning,
  setAgentPaused,
  cancelAgentCommand,
  runWorkflow,
  cancelWorkflow,
  isWorkflowRunning,
  setWorkflowPaused,
  submitCheckpointResponse,
  closeStagehand,
};

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
    await closeStagehand();
  },
};
