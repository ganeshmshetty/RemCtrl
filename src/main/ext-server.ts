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
 * - Accepts validated extension recording imports and persists them as desktop workflows.
 * - Never executes browser automation: RemoteCtrl's Playwright pipeline remains the sole executor.
 * - Propagates state updates to all opened Electron renderers using `BrowserWindow.getAllWindows()`.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { BrowserWindow } from 'electron';
import { saveWorkflow } from './storage.js';
import type { LocalWorkflow } from '../shared/types.js';
import {
  ExtSaveWorkflowPayloadSchema,
} from '../shared/schemas.js';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function startExtensionBridgeServer(port = 45456): void {
  if (wss) return;

  try {
    const server = new WebSocketServer({ port, host: '127.0.0.1' });
    wss = server;

    server.once('error', (err) => {
      if (wss === server) wss = null;
      console.error(`[ext-server] Failed to start WebSocket server on port ${port}:`, err);
    });

    server.on('connection', (ws, req) => {
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

    server.once('listening', () => {
      console.log(`[ext-server] Chrome Extension bridge listening on ws://127.0.0.1:${port}`);
    });
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
      const requestId = typeof msg.payload?.requestId === 'string' ? msg.payload.requestId : undefined;
      const parsed = ExtSaveWorkflowPayloadSchema.safeParse(msg.payload || {});
      if (!parsed.success) {
        ws.send(JSON.stringify({ type: 'SYNC_ERROR', requestId, error: 'Desktop could not validate this recorded workflow.' }));
        break;
      }
      const payload = parsed.data;
      const now = Date.now();
      const newWorkflow: LocalWorkflow = {
        id: payload.id,
        name: payload.name,
        description: payload.description || 'Recorded directly from Chrome Extension',
        steps: payload.steps,
        source: 'chrome_ext',
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

      ws.send(JSON.stringify({ type: 'SYNC_SUCCESS', requestId: payload.requestId, workflowId: newWorkflow.id }));
      break;
    }

    default:
      console.warn('[ext-server] Unknown message type:', msg.type);
  }
}
