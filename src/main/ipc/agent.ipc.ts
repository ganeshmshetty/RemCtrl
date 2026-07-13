/**
 * @file agent.ipc.ts
 * @description Main process IPC handlers managing agent loop triggers, prompts, workflow executions, pause/takeover state, and checkpoint resolution.
 * Key Exported APIs: `registerAgentIpc` function to register Electron IPC handlers.
 * Internal Mechanics: Coordinates with the automation engine via `runAgent`, `runWorkflow`, `cancelAgent`, and `cancelWorkflow`.
 * Schema Verification: Uses Zod schemas like `AgentPromptPayloadSchema`, `AgentWorkflowBatchSchema`, and `CheckpointResponseSchema` to validate IPC payloads.
 * Relations: Relies on `automationOrchestrator` and `sessionHistory` to manage global agent execution state, and broadcasts events (`agent:status`, `agent:log`, etc.) back to all active renderer windows.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { z } from 'zod';
import { AgentPromptPayloadSchema, AgentWorkflowBatchSchema, CheckpointResponseSchema, AgentRewindPayloadSchema } from '../../shared/schemas.js';
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
  sessionHistory,
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
        (step) => broadcast('workflow:recordedStep', step),
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

  ipcMain.handle('agent:clearHistory', async () => {
    sessionHistory.clear();
    return { ok: true };
  });

  ipcMain.handle('browser:rewindAndRerunAgent', async (_e, rawPayload: unknown) => {
    let payload;
    try {
      payload = AgentRewindPayloadSchema.parse(rawPayload);
    } catch (err) {
      return { ok: false, error: `Invalid rewind payload: ${err instanceof Error ? err.message : String(err)}` };
    }

    const provider = getPreferredProvider();
    const apiKey = getApiKey(provider);

    if (!apiKey && provider !== 'vertex') {
      return { ok: false, error: `No API key set for provider: ${provider}` };
    }

    try {
      sessionHistory.rewindTo(payload.snapshotId);
      await runAgent(
        payload.commandId,
        payload.action,
        payload.newInstruction,
        apiKey,
        provider,
        (status) => broadcast('agent:status', status),
        (log) => broadcast('agent:log', log),
        (step) => broadcast('workflow:recordedStep', step),
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
