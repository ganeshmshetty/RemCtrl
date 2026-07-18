/**
 * @file signaling-client.ts
 * @description Socket.io WebSocket client coordinating WebRTC signaling handshakes, connection rooms, and host/controller session flows.
 * @module main/signaling-client
 * 
 * Key Exports:
 * - `SignalingClient` class: Exposes `startHost()`, `connectAsController()`, `approveController()`, `rejectController()`, `sendSignal()`, and `disconnect()`.
 * 
 * Mechanics & Relations:
 * - Establishes socket connections, implements a 5-attempt unique PIN registration mechanism, and forwards WebRTC SDP/ICE candidates.
 * - Pushes session updates (`host:stateChange`, `controller:stateChange`, `host:pin`, `webrtc:signal`) to the Electron renderer via `webContents.send()`.
 * - Instantiated by `webrtc-manager.ts` and triggered by IPC routes inside `webrtc.ipc.ts` to orchestrate remote desktop control.
 */

import { io, Socket } from 'socket.io-client';
import { BrowserWindow } from 'electron';
import type { HostSessionState, ControllerSessionState } from '../shared/types.js';

function generatePin(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

/**
 * Manages the Socket.io connection to the signaling server.
 * Lives in the Electron main process. Pushes all state changes
 * to the renderer via win.webContents.send().
 */
export class SignalingClient {
  private socket: Socket | null = null;
  private role: 'host' | 'controller' | null = null;
  private trustedHost = false;
  private hostPin: string | null = null;
  private controllerPin: string | null = null;
  private controllerIntent: string | null = null;
  private handshakeComplete = false;

  constructor(private readonly win: BrowserWindow) {}

  getRole() { return this.role; }
  isTrustedHost() { return this.role === 'host' && this.trustedHost; }
  isConnected() { return this.socket?.connected ?? false; }

  // ─── Push helpers ────────────────────────────────────────────────────────

  private send(channel: string, ...args: unknown[]) {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(channel, ...args);
    }
  }

  private pushHostState(s: HostSessionState) { this.send('host:stateChange', s); }
  private pushCtrlState(s: ControllerSessionState) { this.send('controller:stateChange', s); }
  private pushError(msg: string) { this.send('app:error', msg); }

  // ─── Host mode ───────────────────────────────────────────────────────────

  async startHost(signalingUrl: string, trusted = false): Promise<void> {
    this.role = 'host';
    this.trustedHost = trusted;
    this.hostPin = null;
    this.controllerPin = null;
    this.controllerIntent = null;
    this.handshakeComplete = false;
    this.pushHostState('REGISTERING_PIN');

    const socket = this.createSocket(signalingUrl);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      socket.once('connect', async () => {
        let registered = false;
        let attempts = 0;
        let pin = '';
        
        while (!registered && attempts < 5) {
          pin = generatePin();
          attempts++;
          
          try {
            const isDev = process.env.NODE_ENV === 'development';
            const displayPin = isDev ? pin : `${pin.slice(0, 3)}${'*'.repeat(pin.length - 3)}`;
            console.log(`[signaling] Registering PIN: ${displayPin}...`);
            const success = await new Promise<boolean>((res, rej) => {
              socket.emit(
                'host:register',
                { pin, capabilities: { version: '0.1.0', platform: process.platform } },
                (ack: { success: boolean; error?: string }) => {
                  if (!ack.success) {
                    console.warn(`[signaling] PIN registration failed: ${ack.error}`);
                    if (ack.error === 'PIN already in use') {
                      res(false);
                    } else {
                      rej(new Error(ack.error));
                    }
                  } else {
                    console.log(`[signaling] PIN ${pin} registered successfully`);
                    res(true);
                  }
                }
              );
            });
            
            registered = success;
          } catch (err) {
            this.pushError(`PIN registration failed: ${err instanceof Error ? err.message : String(err)}`);
            this.pushHostState('DISCONNECTED');
            socket.disconnect();
            return reject(err);
          }
        }
        
        if (!registered) {
          const err = new Error('Could not generate a unique PIN after 5 attempts');
          this.pushError(err.message);
          this.pushHostState('DISCONNECTED');
          socket.disconnect();
          return reject(err);
        }

        this.send('host:pin', pin);
        this.hostPin = pin;
        this.handshakeComplete = true;
        this.pushHostState('WAITING_FOR_CONTROLLER');
        resolve();
      });

      socket.once('connect_error', (err) => {
        this.pushError(`Cannot reach signaling server: ${err.message}`);
        this.pushHostState('DISCONNECTED');
        reject(err);
      });

      // Auto-forward WebRTC signals from socket to renderer
      socket.on('webrtc:signal', (payload: { signal: unknown }) => {
        this.send('webrtc:signal', payload.signal);
      });

      // Controller joined → show approval modal
      socket.on('controller:joined', ({ controllerId, intent }: { controllerId: string; intent: string }) => {
        this.pushHostState('AWAITING_HOST_APPROVAL');
        this.send('controller:joinRequest', { controllerId, intent });
      });

      // Controller left
      socket.on('peer:disconnected', () => {
        this.pushHostState('WAITING_FOR_CONTROLLER');
        this.pushError('Controller disconnected');
      });

      socket.on('disconnect', (reason) => {
        if (reason !== 'io client disconnect') {
          this.pushHostState('DISCONNECTED');
          this.pushError('Lost connection to signaling server. Retrying…');
        }
      });
    });
  }

  approveController(controllerId: string) {
    this.socket?.emit('host:approve', { controllerId });
    this.pushHostState('SESSION_ACTIVE');
  }

  rejectController(controllerId: string) {
    this.socket?.emit('host:reject', { controllerId });
    this.pushHostState('WAITING_FOR_CONTROLLER');
  }

  // ─── Controller mode ─────────────────────────────────────────────────────

  async connectAsController(signalingUrl: string, pin: string, intent: string): Promise<void> {
    this.role = 'controller';
    this.controllerPin = pin;
    this.controllerIntent = intent;
    this.handshakeComplete = false;
    this.pushCtrlState('SIGNALING_CONNECTING');

    const socket = this.createSocket(signalingUrl);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        socket.emit(
          'controller:join',
          { pin, intent },
          (ack: { success: boolean; error?: string }) => {
            if (!ack.success) {
              const msg = ack.error ?? 'Failed to join session';
              this.pushError(msg);
              this.pushCtrlState('DISCONNECTED');
              socket.disconnect();
              return reject(new Error(msg));
            }
            this.pushCtrlState('WAITING_FOR_HOST_APPROVAL');
            this.handshakeComplete = true;
            resolve();
          }
        );
      });

      socket.once('connect_error', (err) => {
        this.pushError(`Cannot reach signaling server: ${err.message}`);
        this.pushCtrlState('DISCONNECTED');
        reject(err);
      });

      // Auto-forward WebRTC signals from socket to renderer
      socket.on('webrtc:signal', (payload: { signal: unknown }) => {
        this.send('webrtc:signal', payload.signal);
      });

      socket.on('host:approved', () => {
        this.pushCtrlState('SESSION_ACTIVE');
      });

      socket.on('host:rejected', () => {
        this.pushCtrlState('DISCONNECTED');
        this.pushError('Host rejected your connection request');
      });

      socket.on('room:error', ({ message }: { message: string }) => {
        this.pushError(message);
        this.pushCtrlState('DISCONNECTED');
      });

      socket.on('peer:disconnected', () => {
        this.pushCtrlState('DISCONNECTED');
        this.pushError('Host disconnected');
      });

      socket.on('disconnect', (reason) => {
        if (reason !== 'io client disconnect') {
          this.pushCtrlState('DISCONNECTED');
          this.pushError('Lost connection to signaling server. Retrying…');
        }
      });
    });
  }

  // ─── Phase 2 hook ────────────────────────────────────────────────────────

  sendSignal(sender: 'host' | 'controller', signal: unknown) {
    this.socket?.emit('webrtc:signal', { sender, signal });
  }

  onSignal(cb: (payload: { sender: string; signal: unknown }) => void) {
    this.socket?.on('webrtc:signal', cb);
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    const wasRole = this.role;
    this.role = null;
    this.trustedHost = false;
    this.hostPin = null;
    this.controllerPin = null;
    this.controllerIntent = null;
    this.handshakeComplete = false;
    if (wasRole === 'host') this.pushHostState('IDLE');
    else if (wasRole === 'controller') this.pushCtrlState('IDLE');
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private createSocket(url: string): Socket {
    console.log(`[signaling] Connecting to ${url}...`);
    const socket = io(url, {
      // Reconnect is safe because the established handshake is replayed below.
      // Without replaying the room registration, Socket.IO would reconnect a
      // transport while silently losing the host/controller membership.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.2,
      timeout: 10000,
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log(`[signaling] Connected to ${url} (ID: ${socket.id})`);
      if (!this.handshakeComplete || socket !== this.socket) return;

      if (this.role === 'host' && this.hostPin) {
        this.pushHostState('REGISTERING_PIN');
        socket.emit(
          'host:register',
          { pin: this.hostPin, capabilities: { version: '0.1.0', platform: process.platform } },
          (ack: { success: boolean; error?: string }) => {
            if (ack.success) {
              this.pushHostState('WAITING_FOR_CONTROLLER');
            } else {
              this.pushError(`Could not restore host session: ${ack.error ?? 'registration rejected'}`);
              this.pushHostState('DISCONNECTED');
            }
          },
        );
      } else if (this.role === 'controller' && this.controllerPin && this.controllerIntent) {
        this.pushCtrlState('SIGNALING_CONNECTING');
        socket.emit(
          'controller:join',
          { pin: this.controllerPin, intent: this.controllerIntent },
          (ack: { success: boolean; error?: string }) => {
            if (ack.success) {
              this.pushCtrlState('WAITING_FOR_HOST_APPROVAL');
            } else {
              this.pushError(`Could not restore controller session: ${ack.error ?? 'join rejected'}`);
              this.pushCtrlState('DISCONNECTED');
            }
          },
        );
      }
    });

    socket.on('connect_error', (err) => {
      console.error(`[signaling] Connection error for ${url}:`, err.message);
    });

    socket.on('reconnect_attempt', (attempt) => {
      console.log(`[signaling] Reconnect attempt ${attempt} for ${url}...`);
    });

    return socket;
  }
}
