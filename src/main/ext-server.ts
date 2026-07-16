/**
 * @file ext-server.ts
 * @description Local WebSocket bridge server enabling communications between the Electron app and the companion Chrome Extension.
 * @module main/ext-server
 * 
 * Key Exports:
 * - `startExtensionBridgeServer(port)`: Spawns the WS server on 127.0.0.1, enforces Origin security checks, and registers event processors.
 * - `stopExtensionBridgeServer()`: Terminates all active client connections and tears down the WS server.
 * - `broadcastToExtensions(type, payload)`: Transmits real-time agent/workflow logs and execution status updates to connected extension clients.
 * 
 * Mechanics & Relations:
 * - Validates received messages via Zod validation payloads (`ExtSaveWorkflowPayloadSchema`, `ExtStartAutomationPayloadSchema`, `ExtRunWorkflowPayloadSchema`).
 * - Invokes `launchBrowser` in `browser-manager.ts` and initiates agent/workflow processes (`runAgent`, `runWorkflow`) inside the automation runner.
 * - Propagates state updates to all opened Electron renderers using `BrowserWindow.getAllWindows()`.
 */

import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { saveWorkflow, listWorkflows, getPreferredProvider, getApiKey } from './storage.js';
import { runAgent, isAgentRunning, runWorkflow, isWorkflowRunning } from './automation/index.js';
import { launchBrowser } from './browser-manager.js';
import type { LocalWorkflow, AgentWorkflowBatchPayload } from '../shared/types.js';
import {
  ExtSaveWorkflowPayloadSchema,
  ExtStartAutomationPayloadSchema,
  ExtRunWorkflowPayloadSchema,
} from '../shared/schemas.js';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
let isExecutionStarting = false;

export function startExtensionBridgeServer(port = 45456): void {
  if (wss) return;

  try {
    wss = new WebSocketServer({ port, host: '127.0.0.1' });

    wss.on('connection', (ws, req) => {
      const origin = req.headers.origin;
      if (origin && !origin.startsWith('chrome-extension://')) {
        console.warn(`[ext-server] Unauthorized WebSocket connection attempt from origin: ${origin}`);
        ws.close(1008, 'Unauthorized origin');
        return;
      }
      clients.add(ws);
      console.log('[ext-server] Chrome Extension connected');

      // Send immediate connection acknowledgement status
      ws.send(JSON.stringify({ type: 'CONN_ACK', status: 'connected' }));

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString('utf-8'));
          await handleExtensionMessage(ws, msg);
        } catch (err) {
          console.error('[ext-server] Error parsing message from extension:', err);
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
      });
    });

    console.log(`[ext-server] Chrome Extension bridge listening on ws://127.0.0.1:${port}`);
  } catch (err) {
    console.error('[ext-server] Failed to start WebSocket server:', err);
  }
}

export function stopExtensionBridgeServer(): void {
  for (const client of clients) {
    try {
      client.terminate();
    } catch {
      // ignore
    }
  }
  clients.clear();
  if (wss) {
    wss.close();
    wss = null;
  }
}

export function broadcastToExtensions(type: string, payload: unknown): void {
  const msg = JSON.stringify({ type, payload });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

async function handleExtensionMessage(ws: WebSocket, msg: { type: string; payload?: any }): Promise<void> {
  switch (msg.type) {
    case 'PING':
      ws.send(JSON.stringify({ type: 'PONG', version: '1.0.0' }));
      break;

    case 'EXT_SAVE_RECORDED_WORKFLOW': {
      const parsed = ExtSaveWorkflowPayloadSchema.safeParse(msg.payload || {});
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'SYNC_ERROR', error: 'Invalid workflow payload' }));
        break;
      }
      const payload = parsed.data;
      const now = Date.now();
      const newWorkflow: LocalWorkflow = {
        id: payload.id || crypto.randomUUID(),
        name: payload.name || `Recorded Workflow ${new Date().toLocaleDateString()}`,
        description: payload.description || 'Recorded directly from Chrome Extension',
        startUrl: payload.startUrl || 'about:blank',
        steps: Array.isArray(payload.steps) ? payload.steps : [],
        createdAt: now,
        updatedAt: now,
      };

      saveWorkflow(newWorkflow);

      // Notify open Electron renderer windows so their workflow stores update immediately
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) {
          w.webContents.send('workflow:created', newWorkflow);
        }
      });

      ws.send(JSON.stringify({ type: 'SYNC_SUCCESS', workflowId: newWorkflow.id }));
      break;
    }

    case 'EXT_START_AUTOMATION': {
      const parsed = ExtStartAutomationPayloadSchema.safeParse(msg.payload || {});
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'AUTOMATION_ERROR', error: 'Invalid start automation payload.' }));
        break;
      }
      const { url, instruction } = parsed.data;

      if (isExecutionStarting || isWorkflowRunning() || isAgentRunning()) {
        ws.send(JSON.stringify({ type: 'AUTOMATION_ERROR', error: 'An automation task is already running or starting on the desktop.' }));
        break;
      }
      isExecutionStarting = true;

      const provider = getPreferredProvider();
      const apiKey = getApiKey(provider);

      if (!apiKey && provider !== 'vertex') {
        isExecutionStarting = false;
        ws.send(JSON.stringify({ type: 'AUTOMATION_ERROR', error: `No API key set for provider: ${provider}` }));
        break;
      }

      // Launch browser
      try {
        await launchBrowser(url || 'about:blank');
      } catch (err) {
        isExecutionStarting = false;
        ws.send(JSON.stringify({
          type: 'AUTOMATION_ERROR',
          error: `Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`
        }));
        break;
      }
      isExecutionStarting = false;

      const commandId = crypto.randomUUID();
      ws.send(JSON.stringify({ type: 'AUTOMATION_STARTED', commandId }));

      // Run agent asynchronously
      runAgent(
        commandId,
        'act',
        instruction,
        apiKey,
        provider,
        (status) => {
          BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send('agent:status', status);
          });
          broadcastToExtensions('agent:status', status);
        },
        (log) => {
          BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send('agent:log', log);
          });
          broadcastToExtensions('agent:log', log);
        }
      ).catch((err) => {
        console.error('[ext-server] Agent run error:', err);
      });

      break;
    }

    case 'EXT_RUN_WORKFLOW': {
      const parsed = ExtRunWorkflowPayloadSchema.safeParse(msg.payload || {});
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'RUN_WORKFLOW_ERROR', error: 'Invalid run workflow payload.' }));
        break;
      }
      const { workflowId } = parsed.data;

      if (isExecutionStarting || isWorkflowRunning() || isAgentRunning()) {
        ws.send(JSON.stringify({ type: 'RUN_WORKFLOW_ERROR', error: 'An automation task is already running or starting on the desktop.' }));
        break;
      }
      isExecutionStarting = true;

      const workflows = listWorkflows();
      const workflow = workflows.find((w) => w.id === workflowId);
      if (!workflow) {
        isExecutionStarting = false;
        ws.send(JSON.stringify({ type: 'RUN_WORKFLOW_ERROR', error: `Workflow not found with ID: ${workflowId}` }));
        break;
      }

      // Launch browser
      try {
        await launchBrowser(workflow.startUrl || 'about:blank');
      } catch (err) {
        isExecutionStarting = false;
        ws.send(JSON.stringify({
          type: 'RUN_WORKFLOW_ERROR',
          error: `Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`
        }));
        break;
      }
      isExecutionStarting = false;

      const workflowRunId = crypto.randomUUID();
      const batch: AgentWorkflowBatchPayload = {
        workflowRunId,
        workflowId: workflow.id,
        name: workflow.name,
        startUrl: workflow.startUrl,
        steps: workflow.steps,
      };

      ws.send(JSON.stringify({ type: 'RUN_WORKFLOW_STARTED', workflowRunId }));

      runWorkflow(
        batch,
        (status) => {
          BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send('workflow:runStatus', status);
          });
          broadcastToExtensions('workflow:runStatus', status);
        },
        (stepStatus) => {
          BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send('workflow:stepStatus', stepStatus);
          });
          broadcastToExtensions('workflow:stepStatus', stepStatus);
        },
        (log) => {
          BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send('agent:log', log);
          });
          broadcastToExtensions('agent:log', log);
        }
      ).catch((err) => {
        console.error('[ext-server] Workflow run error:', err);
      });

      break;
    }

    default:
      console.warn('[ext-server] Unknown message type:', msg.type);
  }
}
