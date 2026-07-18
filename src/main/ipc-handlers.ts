/**
 * @file ipc-handlers.ts
 * @description Central registry and initializer for Electron Inter-Process Communication (IPC) handlers, bridging the Main and Renderer processes.
 * @module main/ipc-handlers
 * 
 * Key Exports:
 * - `setMainWindow(win)`: Registers the primary Electron `BrowserWindow`, assigns it to managers, and triggers sub-module registrations.
 * - `getMainWindow()`: Retrieves the current active `BrowserWindow` reference.
 * 
 * Mechanics & Relations:
 * - Delegates IPC registration to specialized sub-modules: settings, workflow, browser, agent, and WebRTC handlers.
 * - Propagates the window reference to `screencast.ts`, `browser-manager.ts`, and `webrtc-manager.ts` so they can push async payloads (screencast frames, logs, WebRTC signals) back to the frontend.
 */

import { BrowserWindow } from 'electron';
import { setScreencastWindow } from './screencast.js';
import { setBrowserNotifyWindow } from './browser-manager.js';
import { webRTCManager } from './webrtc-manager.js';

import { registerSettingsIpc } from './ipc/settings.ipc.js';
import { registerWorkflowIpc } from './ipc/workflow.ipc.js';
import { registerBrowserIpc } from './ipc/browser.ipc.js';
import { registerAgentIpc } from './ipc/agent.ipc.js';
import { registerWebRtcIpc } from './ipc/webrtc.ipc.js';
import { registerPolicyIpc } from './ipc/policy.ipc.js';

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
  registerAgentIpc();
  registerWebRtcIpc(win);
  registerPolicyIpc();
}
