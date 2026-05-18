import { ipcMain, BrowserWindow, desktopCapturer } from 'electron';
import {
  ApproveControllerSchema,
  ConnectPinSchema,
  SetApiKeySchema,
  SetSignalingUrlSchema,
  SetPreferredProviderSchema,
  LocalWorkflowSchema,
  RemoteMousePayloadSchema,
  RemoteKeyboardPayloadSchema,
  AgentPromptSchema,
} from '../shared/schemas.js';
import {
  hasApiKey,
  setApiKey,
  getSignalingUrl,
  setSignalingUrl,
  getPreferredProvider,
  setPreferredProvider,
  listWorkflows,
  saveWorkflow,
  deleteWorkflow,
  getApiKey,
} from './storage.js';
import { SignalingClient } from './signaling-client.js';
import { launchBrowser, closeBrowser, getCaptureMetadata, injectMouse, injectKeyboard, isBrowserRunning } from './browser-manager.js';
import { runAgentCommand, cancelAgentCommand, isAgentRunning } from './agent-executor.js';
import { runWorkflow, cancelWorkflow, isWorkflowRunning } from './workflow-executor.js';
import type { AgentWorkflowBatchPayload } from '../shared/types.js';

let signalingClient: SignalingClient | null = null;
let currentWindow: BrowserWindow | null = null;
let isRegistered = false;

export function setMainWindow(win: BrowserWindow) {
  currentWindow = win;
  if (!isRegistered) {
    registerIpcHandlers();
    isRegistered = true;
  }
}

function getOrCreateClient(): SignalingClient {
  if (!signalingClient) {
    if (!currentWindow) throw new Error("No main window set in ipc-handlers");
    signalingClient = new SignalingClient(currentWindow);
  }
  return signalingClient;
}

function destroyClient() {
  if (signalingClient) {
    signalingClient.disconnect();
  }
  signalingClient = null;
}

function registerIpcHandlers() {

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:hasApiKey', async (_e, provider: unknown) => {
    const { provider: p } = SetApiKeySchema.pick({ provider: true }).parse({ provider });
    return hasApiKey(p);
  });

  ipcMain.handle('settings:setApiKey', async (_e, provider: unknown, value: unknown) => {
    const parsed = SetApiKeySchema.parse({ provider, value });
    setApiKey(parsed.provider, parsed.value);
  });

  ipcMain.handle('settings:getSignalingUrl', async () => getSignalingUrl());

  ipcMain.handle('settings:setSignalingUrl', async (_e, url: unknown) => {
    const { url: u } = SetSignalingUrlSchema.parse({ url });
    setSignalingUrl(u);
  });

  ipcMain.handle('settings:getPreferredProvider', async () => getPreferredProvider());

  ipcMain.handle('settings:setPreferredProvider', async (_e, provider: unknown) => {
    const { provider: p } = SetPreferredProviderSchema.parse({ provider });
    setPreferredProvider(p);
  });

  // ── Workflows ─────────────────────────────────────────────────────────────

  ipcMain.handle('workflows:list', async () => listWorkflows());

  ipcMain.handle('workflows:save', async (_e, workflow: unknown) => {
    saveWorkflow(LocalWorkflowSchema.parse(workflow));
  });

  ipcMain.handle('workflows:delete', async (_e, workflowId: unknown) => {
    if (typeof workflowId !== 'string' || !workflowId) throw new Error('Invalid workflowId');
    deleteWorkflow(workflowId);
  });

  // ── WebRTC Signaling Connection ───────────────────────────────────────────

  ipcMain.handle('host:start', async () => {
    destroyClient();
    const client = getOrCreateClient();
    const url = getSignalingUrl();
    try {
      await client.startHost(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('app:error', msg);
    }
    return { ok: true };
  });

  ipcMain.handle('host:stop', async () => {
    destroyClient();
    await closeBrowser();
  });

  ipcMain.handle('host:approveController', async (_e, controllerId: unknown) => {
    const { controllerId: id } = ApproveControllerSchema.parse({ controllerId });
    signalingClient?.approveController(id);
  });

  ipcMain.handle('host:rejectController', async (_e, controllerId: unknown) => {
    const { controllerId: id } = ApproveControllerSchema.parse({ controllerId });
    signalingClient?.rejectController(id);
  });

  // ── Controller ────────────────────────────────────────────────────────────

  ipcMain.handle('controller:connect', async (_e, pin: string) => {
    const parsed = ConnectPinSchema.parse({ pin });
    destroyClient();
    const client = getOrCreateClient();
    const url = getSignalingUrl();
    try {
      await client.connectAsController(url, parsed.pin);
    } catch (err) {
      // Error already sent to renderer by pushError
    }
    return { ok: true };
  });

  ipcMain.handle('controller:disconnect', async () => {
    destroyClient();
  });

  // ── Browser Management ────────────────────────────────────────────────────

  ipcMain.handle('browser:launch', async (_e, startUrl?: unknown) => {
    try {
      const title = await launchBrowser(
        typeof startUrl === 'string' ? startUrl : undefined,
        (meta) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('browser:captureMetadata', meta); },
        (title) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('browser:windowTitle', title); },
      );
      return title;
    } catch (err) {
      console.error('[ipc] Failed to launch browser:', err);
      throw err;
    }
  });

  ipcMain.handle('browser:close', async () => {
    await closeBrowser();
  });

  ipcMain.handle('browser:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  });

  ipcMain.handle('browser:injectMouse', async (_e, payload: unknown) => {
    const parsed = RemoteMousePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.error('[ipc] Invalid mouse payload:', parsed.error);
      return;
    }
    const meta = getCaptureMetadata();
    if (meta) {
      await injectMouse(parsed.data, meta);
    }
  });

  ipcMain.handle('browser:injectKeyboard', async (_e, payload: unknown) => {
    const parsed = RemoteKeyboardPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.error('[ipc] Invalid keyboard payload:', parsed.error);
      return;
    }
    await injectKeyboard(parsed.data);
  });

  ipcMain.handle('browser:resetProfile', async () => {
    await closeBrowser();
    console.log('[main] browser:resetProfile done');
  });

  // ── Agent Execution ───────────────────────────────────────────────────────

  ipcMain.handle('browser:startAgent', async (_e, rawPayload: unknown) => {
    const payload = AgentPromptSchema.parse(rawPayload);
    try {
      await runAgentCommand(
        payload,
        (status) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('agent:status', status); },
        (log) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('agent:log', log); },
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('browser:cancelAgent', async () => {
    cancelAgentCommand();
    return { ok: true };
  });

  // ── Workflow Execution ────────────────────────────────────────────────────

  ipcMain.handle('browser:startWorkflow', async (_e, rawPayload: unknown) => {
    // Basic shape validation
    const p = rawPayload as any;
    if (!p || typeof p !== 'object' || !p.workflowRunId || !Array.isArray(p.steps)) {
      return { ok: false, error: 'Invalid workflow payload' };
    }
    if (isWorkflowRunning()) {
      return { ok: false, error: 'A workflow is already running.' };
    }
    if (isAgentRunning()) {
      return { ok: false, error: 'An agent command is running. Cancel it first.' };
    }

    const batch = rawPayload as AgentWorkflowBatchPayload;

    runWorkflow(
      batch,
      (status) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('workflow:runStatus', status); },
      (stepStatus) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('workflow:stepStatus', stepStatus); },
      (log) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('agent:log', log); },
    ).catch((err) => {
      console.error('[workflow] Unexpected error:', err);
    });

    return { ok: true };
  });

  ipcMain.handle('browser:cancelWorkflow', async () => {
    cancelWorkflow();
    return { ok: true };
  });

  // ── Diagnostics ────────────────────────────────────────────────────

  ipcMain.handle('app:getDiagnostics', async () => {
    const provider = (() => { try { return getPreferredProvider(); } catch { return 'unknown'; } })();
    return {
      browserRunning: isBrowserRunning(),
      agentRunning: isAgentRunning(),
      workflowRunning: isWorkflowRunning(),
      signalingConnected: signalingClient !== null,
      signalingRole: signalingClient?.getRole() ?? null,
      hasOpenAIKey: hasApiKey('openai'),
      hasAnthropicKey: hasApiKey('anthropic'),
      preferredProvider: provider,
      platform: process.platform,
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node,
      appVersion: require('electron').app.getVersion(),
    };
  });

  // ── WebRTC Signal Relay ───────────────────────────────────────────────────

  ipcMain.handle('webrtc:sendSignal', async (_e, signal: unknown) => {
    const t = (signal as any)?.type ?? '?';
    const role = signalingClient?.getRole();
    console.log(`[ipc] webrtc:sendSignal role=${role ?? '(no client)'}, type=${t}`);
    // Only relay when a client exists and has a valid role
    if (signalingClient && (role === 'host' || role === 'controller')) {
      signalingClient.sendSignal(role, signal);
    }
  });
}
