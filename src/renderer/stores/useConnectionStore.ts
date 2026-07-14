/**
 * @file useConnectionStore.ts
 * @description Zustand store managing WebRTC session states, connection roles, signaling, and remote browser session settings.
 * Exports the `useConnectionStore` hook to provide reactive session roles ('host', 'controller', 'local', 'idle') and session states.
 * Internally holds connection metadata (like connection pins, pending controller IDs, error strings) and a `sendData` callback.
 * Closely integrates with the WebRTC hooks/mechanisms to coordinate peer-to-peer data channel signaling and browser sync.
 */

import { create } from 'zustand';
import type { HostSessionState, ControllerSessionState } from '../../shared/types';

type SessionRole = 'idle' | 'host' | 'controller' | 'local';

interface ConnectionState {
  role: SessionRole;
  pin: string | null;
  hostState: HostSessionState;
  controllerState: ControllerSessionState;
  pendingControllerId: string | null; // for host approval modal
  error: string | null;
  sendData: ((msg: any, reliable?: boolean) => void) | null;

  // Actions
  setRole: (role: SessionRole) => void;
  setPin: (pin: string | null) => void;
  setHostState: (state: HostSessionState) => void;
  setControllerState: (state: ControllerSessionState) => void;
  setPendingControllerId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setSendData: (fn: ((msg: any, reliable?: boolean) => void) | null) => void;
  reset: () => void;
}

const initialState = {
  role: 'idle' as SessionRole,
  pin: null,
  hostState: 'IDLE' as HostSessionState,
  controllerState: 'IDLE' as ControllerSessionState,
  pendingControllerId: null,
  error: null,
  sendData: null,
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  ...initialState,

  setRole: (role) => set({ role }),
  setPin: (pin) => set({ pin }),
  setHostState: (hostState) => set({ hostState }),
  setControllerState: (controllerState) => set({ controllerState }),
  setPendingControllerId: (pendingControllerId) => set({ pendingControllerId }),
  setError: (error) => set({ error }),
  setSendData: (sendData) => set({ sendData }),
  reset: () => set(initialState),
}));
