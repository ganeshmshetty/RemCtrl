import { BrowserWindow } from 'electron';
import { setScreencastWindow } from './screencast.js';
import { setBrowserNotifyWindow } from './browser-manager.js';
import { webRTCManager } from './webrtc-manager.js';

import { registerSettingsIpc } from './ipc/settings.ipc.js';
import { registerWorkflowIpc } from './ipc/workflow.ipc.js';
import { registerBrowserIpc } from './ipc/browser.ipc.js';
import { registerAgentIpc } from './ipc/agent.ipc.js';
import { registerWebRtcIpc } from './ipc/webrtc.ipc.js';

let currentWindow: BrowserWindow | null = null;
let isRegistered = false;

export function setMainWindow(win: BrowserWindow) {
  currentWindow = win;
  setScreencastWindow(win);
  setBrowserNotifyWindow(win);
  webRTCManager.setWindow(win);
  
  if (!isRegistered) {
    registerIpcHandlers(win);
    isRegistered = true;
  }
}

export function getMainWindow() { return currentWindow; }

function registerIpcHandlers(win: BrowserWindow) {
  registerSettingsIpc();
  registerWorkflowIpc();
  registerBrowserIpc();
  registerAgentIpc(win);
  registerWebRtcIpc(win);
}
