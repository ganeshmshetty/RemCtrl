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
