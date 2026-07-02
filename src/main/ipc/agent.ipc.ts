import { ipcMain, BrowserWindow } from 'electron';
import { z } from 'zod';
import { AgentPromptSchema, AgentWorkflowBatchSchema, CheckpointResponseSchema } from '../../shared/schemas.js';
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

export function registerAgentIpc(win: BrowserWindow) {
  ipcMain.handle('browser:startAgent', async (_e, rawPayload: unknown) => {
    if (isWorkflowRunning()) {
      return { ok: false, error: 'A workflow is already running.' };
    }
    if (isAgentRunning()) {
      return { ok: false, error: 'An agent command is already running.' };
    }

    let payload;
    try {
      payload = AgentPromptSchema.parse(rawPayload);
    } catch (err) {
      return { ok: false, error: `Invalid agent payload: ${err instanceof Error ? err.message : String(err)}` };
    }
    const provider = getPreferredProvider();
    const apiKey = getApiKey(provider);

    if (!apiKey) {
      return { ok: false, error: `No API key set for provider: ${provider}` };
    }

    try {
      await runAgent(
        payload.commandId,
        payload.action,
        payload.instruction,
        apiKey,
        provider,
        (status) => { if (!win.isDestroyed()) win.webContents.send('agent:status', status); },
        (log) => { if (!win.isDestroyed()) win.webContents.send('agent:log', log); },
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
      (status) => { if (!win.isDestroyed()) win.webContents.send('workflow:runStatus', status); },
      (stepStatus) => { if (!win.isDestroyed()) win.webContents.send('workflow:stepStatus', stepStatus); },
      (log) => { if (!win.isDestroyed()) win.webContents.send('agent:log', log); },
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
