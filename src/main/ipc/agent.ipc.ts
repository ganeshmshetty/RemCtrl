import { ipcMain, BrowserWindow } from 'electron';
import { z } from 'zod';
import { AgentPromptPayloadSchema, AgentWorkflowBatchSchema, CheckpointResponseSchema } from '../../shared/schemas.js';
import { getPreferredProvider, getApiKey } from '../storage.js';
import {
  runAgent,
  cancelAgent,
  isAgentRunning,
  runWorkflow,
  cancelWorkflow,
  isWorkflowRunning,
  submitCheckpointResponse,
  automationOrchestrator,
} from '../automation/index.js';
import type { AgentWorkflowBatchPayload } from '../../shared/types.js';

function broadcast(channel: string, ...args: any[]) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  });
}

export function registerAgentIpc(_win: BrowserWindow) {
  ipcMain.handle('browser:startAgent', async (_e, rawPayload: unknown) => {
    if (isWorkflowRunning()) {
      return { ok: false, error: 'A workflow is already running.' };
    }
    if (isAgentRunning()) {
      return { ok: false, error: 'An agent command is already running.' };
    }

    let payload;
    try {
      payload = AgentPromptPayloadSchema.parse(rawPayload);
    } catch (err) {
      return { ok: false, error: `Invalid agent payload: ${err instanceof Error ? err.message : String(err)}` };
    }
    const provider = getPreferredProvider();
    const apiKey = getApiKey(provider);

    // Vertex AI uses Application Default Credentials — no API key required
    if (!apiKey && provider !== 'vertex') {
      return { ok: false, error: `No API key set for provider: ${provider}` };
    }

    try {
      await runAgent(
        payload.commandId,
        payload.action,
        payload.instruction,
        apiKey,
        provider,
        (status) => broadcast('agent:status', status),
        (log) => broadcast('agent:log', log),
        payload.variables,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('browser:cancelAgent', async () => {
    cancelAgent();
    return { ok: true };
  });

  ipcMain.handle('browser:setTakeoverActive', async (_e, active: unknown) => {
    const isPaused = Boolean(active);
    automationOrchestrator.setPaused(isPaused);
    return { ok: true };
  });

  ipcMain.handle('browser:submitCheckpoint', async (_e, rawCheckpointId: unknown, rawResponse: unknown) => {
    try {
      const checkpointId = z.string().min(1).parse(rawCheckpointId);
      const response = CheckpointResponseSchema.parse(rawResponse);
      await submitCheckpointResponse(checkpointId, response);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('browser:startWorkflow', async (_e, rawPayload: unknown) => {
    let batch: AgentWorkflowBatchPayload;
    try {
      batch = AgentWorkflowBatchSchema.parse(rawPayload);
    } catch (err) {
      return { ok: false, error: `Invalid workflow payload: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (isWorkflowRunning()) {
      return { ok: false, error: 'A workflow is already running.' };
    }
    if (isAgentRunning()) {
      return { ok: false, error: 'An agent command is running. Cancel it first.' };
    }

    runWorkflow(
      batch,
      (status) => broadcast('workflow:runStatus', status),
      (stepStatus) => broadcast('workflow:stepStatus', stepStatus),
      (log) => broadcast('agent:log', log),
    ).catch((err) => {
      console.error('[workflow] Unexpected error:', err);
    });

    return { ok: true };
  });

  ipcMain.handle('browser:cancelWorkflow', async () => {
    cancelWorkflow();
    return { ok: true };
  });
}
