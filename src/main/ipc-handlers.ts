import { ipcMain, BrowserWindow } from 'electron';
import {
  ApproveControllerSchema,
  ConnectPinSchema,
  SetApiKeySchema,
  SetSignalingUrlSchema,
  SetPreferredProviderSchema,
  LocalWorkflowSchema,
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
} from './storage.js';
import { SignalingClient } from './signaling-client.js';

let signalingClient: SignalingClient | null = null;

function getOrCreateClient(win: BrowserWindow): SignalingClient {
  if (!signalingClient) signalingClient = new SignalingClient(win);
  return signalingClient;
}

function destroyClient() {
  signalingClient?.disconnect();
  signalingClient = null;
}

export function registerIpcHandlers(win: BrowserWindow) {

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

  // ── Host ──────────────────────────────────────────────────────────────────

  ipcMain.handle('host:start', async () => {
    destroyClient();
    const client = getOrCreateClient(win);
    const url = getSignalingUrl();
    await client.startHost(url);
  });

  ipcMain.handle('host:stop', async () => {
    destroyClient();
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

  ipcMain.handle('controller:connect', async (_e, pin: unknown) => {
    const { pin: p } = ConnectPinSchema.parse({ pin });
    destroyClient();
    const client = getOrCreateClient(win);
    const url = getSignalingUrl();
    await client.connectAsController(url, p);
  });

  ipcMain.handle('controller:disconnect', async () => {
    destroyClient();
  });

  // ── Browser ───────────────────────────────────────────────────────────────

  ipcMain.handle('browser:resetProfile', async () => {
    console.log('[main] browser:resetProfile — Phase 2 not yet implemented');
  });
}
