/**
 * @file agent.ipc.ts
 * @description Main process IPC handlers managing agent loop triggers, prompts, workflow executions, pause/takeover state, and checkpoint resolution.
 * Key Exported APIs: `registerAgentIpc` function to register Electron IPC handlers.
 * Internal Mechanics: Coordinates with the automation engine via `runAgent`, `runWorkflow`, `cancelAgent`, and `cancelWorkflow`.
 * Schema Verification: Uses Zod schemas like `AgentPromptPayloadSchema`, `AgentWorkflowBatchSchema`, and `CheckpointResponseSchema` to validate IPC payloads.
 * Relations: Relies on `automationOrchestrator` and `sessionHistory` to manage global agent execution state, and broadcasts events (`agent:status`, `agent:log`, etc.) back to all active renderer windows.
 */

import { ipcMain } from 'electron';
import { z } from 'zod';
import { AgentPromptPayloadSchema, AgentWorkflowBatchSchema, CheckpointResponseSchema, AgentRewindPayloadSchema, RecordingSessionStartSchema } from '../../shared/schemas.js';
import { getPreferredProvider, getApiKey, saveTaskScope, listAutomationHistory, saveAutomationHistory, deleteAutomationHistory, clearAutomationHistory } from '../storage.js';
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
import type { AgentWorkflowBatchPayload, AutomationRunHistoryItem } from '../../shared/types.js';
import { policyGate } from '../policy/policy-gate.js';
import { webRTCManager } from '../webrtc-manager.js';
import { prepareAgentRun } from './agent-preflight.js';
import { broadcastToRenderers as broadcast } from './renderer-events.js';
import { recordingSession } from '../automation/recording-session.js';
import { listRunCheckpoints, removeRunCheckpoint } from '../automation/run-checkpoint.js';

export function registerAgentIpc() {
  recordingSession.setListener((state) => broadcast('workflow:recordingState', state));

  ipcMain.handle('browser:startWorkflowRecording', async (_e, rawPayload: unknown) => {
    if (isWorkflowRunning() || isAgentRunning()) {
      return { ok: false, error: 'Stop the active automation run before starting a recording.' };
    }
    try {
      const payload = RecordingSessionStartSchema.parse(rawPayload ?? {});
      return { ok: true, state: recordingSession.start(payload.initialInstruction) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('browser:getWorkflowRecording', async () => recordingSession.getState());

  ipcMain.handle('browser:saveWorkflowRecording', async () => {
    if (isAgentRunning()) {
      return { ok: false, error: 'Wait for the current recording prompt to finish before saving.' };
    }
    const result = await recordingSession.save();
    if (result.ok) broadcast('workflow:created');
    return result;
  });

  ipcMain.handle('browser:discardWorkflowRecording', async () => {
    recordingSession.discard();
    return { ok: true };
  });

  ipcMain.handle('browser:startAgent', async (_e, rawPayload: unknown) => {
    // Preserve admission precedence: active runs are reported before payload
    // parsing, as in the original IPC handler.
    if (isWorkflowRunning()) return { ok: false, error: 'A workflow is already running.' };
    if (isAgentRunning()) return { ok: false, error: 'An agent command is already running.' };

    let payload;
    try {
      payload = AgentPromptPayloadSchema.parse(rawPayload);
    } catch (err) {
      return { ok: false, error: `Invalid agent payload: ${err instanceof Error ? err.message : String(err)}` };
    }

    const preflight = prepareAgentRun(
      { mode: 'start', executionMode: payload.executionMode, instruction: payload.instruction },
      {
        isWorkflowRunning,
        isAgentRunning,
        isTrustedHost: () => Boolean(webRTCManager.getClient()?.isTrustedHost()),
        getTaskScope: () => policyGate.getScope() as Record<string, unknown> | null,
        setTaskScope: (scope) => policyGate.setScope(scope as unknown as Parameters<typeof policyGate.setScope>[0]),
        saveTaskScope: (scope) => saveTaskScope(scope as unknown as Parameters<typeof saveTaskScope>[0]),
        getPreferredProvider: () => getPreferredProvider(),
        getApiKey,
      },
    );
    if (!preflight.ok) return preflight;
    const { securityMode, provider, apiKey } = preflight;

    broadcast('agent:started', {
      commandId: payload.commandId,
      instruction: payload.instruction,
    });

    void runAgent(
        payload.commandId,
        payload.action,
        payload.instruction,
        apiKey,
        provider,
        (status) => broadcast('agent:status', status),
        (log) => broadcast('agent:log', { ...log, commandId: payload.commandId }),
        (step) => broadcast('workflow:recordedStep', step),
        securityMode,
        async (loopResult) => {
          if (!payload.recordingSessionId) return;
          // Recording is best-effort at run completion: an agent task that
          // succeeded should not be reported as failed merely because the UI
          // discarded its recording session while the run was winding down.
          recordingSession.append(payload.recordingSessionId, payload.instruction, loopResult.executionTrace);
        },
      )
      .catch((err) => {
        // runAgent normally converts failures to status events. This is a last
        // resort for an unexpected programming error in the detached task.
        const error = err instanceof Error ? err.message : String(err);
        console.error('[agent] Unexpected detached execution error:', err);
        broadcast('agent:status', { commandId: payload.commandId, state: 'failed', error });
      });

    return { ok: true };
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

  ipcMain.handle('agent:listRecoverableRuns', async () => listRunCheckpoints());

  ipcMain.handle('agent:discardRecoverableRun', async (_event, rawId: unknown) => {
    const id = z.string().min(1).safeParse(rawId);
    if (!id.success) return { ok: false };
    await removeRunCheckpoint(id.data);
    return { ok: true };
  });

  ipcMain.handle('agent:listRunHistory', async () => listAutomationHistory());

  ipcMain.handle('agent:saveRunHistory', async (_event, rawItem: unknown) => {
    try {
      const item = rawItem as AutomationRunHistoryItem;
      if (!item || typeof item.id !== 'string' || !item.id || !Array.isArray(item.chatHistory)) {
        return { ok: false, error: 'Invalid session history item.' };
      }
      saveAutomationHistory(item);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('agent:deleteRunHistory', async (_event, id: unknown) => {
    if (typeof id === 'string') deleteAutomationHistory(id);
    return { ok: true };
  });

  ipcMain.handle('agent:clearRunHistory', async () => {
    clearAutomationHistory();
    return { ok: true };
  });

  ipcMain.handle('browser:rewindAndRerunAgent', async (_e, rawPayload: unknown) => {
    if (isWorkflowRunning()) {
      return { ok: false, error: 'A workflow is already running.' };
    }
    if (isAgentRunning()) {
      return { ok: false, error: 'An agent command is already running.' };
    }

    let payload;
    try {
      payload = AgentRewindPayloadSchema.parse(rawPayload);
    } catch (err) {
      return { ok: false, error: `Invalid rewind payload: ${err instanceof Error ? err.message : String(err)}` };
    }

    const preflight = prepareAgentRun(
      { mode: 'rewind', executionMode: payload.executionMode },
      {
        isWorkflowRunning,
        isAgentRunning,
        isTrustedHost: () => Boolean(webRTCManager.getClient()?.isTrustedHost()),
        getTaskScope: () => policyGate.getScope() as Record<string, unknown> | null,
        setTaskScope: (scope) => policyGate.setScope(scope as unknown as Parameters<typeof policyGate.setScope>[0]),
        saveTaskScope: (scope) => saveTaskScope(scope as unknown as Parameters<typeof saveTaskScope>[0]),
        getPreferredProvider: () => getPreferredProvider(),
        getApiKey,
      },
    );
    if (!preflight.ok) return preflight;
    const { securityMode, provider, apiKey } = preflight;

    try {
      await sessionHistory.rewindTo(payload.snapshotId);
      await runAgent(
        payload.commandId,
        payload.action,
        payload.newInstruction,
        apiKey,
        provider,
        (status) => broadcast('agent:status', status),
        (log) => broadcast('agent:log', { ...log, commandId: payload.commandId }),
        (step) => broadcast('workflow:recordedStep', step),
        securityMode,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
