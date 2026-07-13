/**
 * @file webrtc-manager.ts
 * @description Singleton manager governing the creation, teardown, and window binding of the SignalingClient instance.
 * @module main/webrtc-manager
 * 
 * Key Exports:
 * - `webRTCManager`: Singleton instances exposing `setWindow()`, `getOrCreateClient()`, `destroyClient()`, and `getClient()`.
 * 
 * Mechanics & Relations:
 * - Lazily instantiates the WebSocket signaling coordinator (`SignalingClient`) and connects it to the main `BrowserWindow` for event routing.
 * - Serves as the middle layer between WebRTC IPC triggers (`webrtc.ipc.ts`) and signaling channel dispatches (`signaling-client.ts`).
 */

import { BrowserWindow } from 'electron';
import { SignalingClient } from './signaling-client.js';

class WebRTCManager {
  private client: SignalingClient | null = null;
  private currentWindow: BrowserWindow | null = null;

  setWindow(win: BrowserWindow) {
    this.currentWindow = win;
  }

  getOrCreateClient(): SignalingClient {
    if (!this.client) {
      if (!this.currentWindow) throw new Error("No main window set in WebRTCManager");
      this.client = new SignalingClient(this.currentWindow);
    }
    return this.client;
  }

  destroyClient() {
    if (this.client) {
      this.client.disconnect();
    }
    this.client = null;
  }

  getClient(): SignalingClient | null {
    return this.client;
  }
}

export const webRTCManager = new WebRTCManager();
