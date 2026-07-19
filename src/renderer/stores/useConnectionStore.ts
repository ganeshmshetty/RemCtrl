/**
 * @file useConnectionStore.ts
 * @description Zustand store managing WebRTC session states, connection roles, signaling, and remote browser session settings.
 * Exports the `useConnectionStore` hook to provide reactive session roles ('host', 'controller', 'local', 'idle') and session states.
 * Internally holds connection metadata (like connection pins, pending controller IDs, error strings) and a `sendData` callback.
 * Closely integrates with the WebRTC hooks/mechanisms to coordinate peer-to-peer data channel signaling and browser sync.
 */

import { create } from 'zustand';
import type { ControllerSessionState, DataChannelMessage, HostSessionState } from '../../shared/types';

type SessionRole = 'idle' | 'host' | 'controller' | 'local';

interface ConnectionState {
  role: SessionRole;
  pin: string | null;
  hostState: HostSessionState;
  controllerState: ControllerSessionState;
  pendingControllerId: string | null; // for host approval modal
  pendingControllerIntent: string | null;
  isTrustedHost: boolean;
  error: string | null;
  pendingTakeover: boolean;
  sendData: ((msg: DataChannelMessage, reliable?: boolean) => void) | null;

  // Actions
  setRole: (role: SessionRole) => void;
  setPin: (pin: string | null) => void;
  setHostState: (state: HostSessionState) => void;
  setControllerState: (state: ControllerSessionState) => void;
  setPendingControllerId: (id: string | null) => void;
  setPendingControllerIntent: (intent: string | null) => void;
  setTrustedHost: (trusted: boolean) => void;
  setError: (error: string | null) => void;
  setPendingTakeover: (pending: boolean) => void;
  setSendData: (fn: ((msg: DataChannelMessage, reliable?: boolean) => void) | null) => void;
  reset: () => void;
}

const initialState = {
  role: 'idle' as SessionRole,
  pin: null,
  hostState: 'IDLE' as HostSessionState,
  controllerState: 'IDLE' as ControllerSessionState,
  pendingControllerId: null,
  pendingControllerIntent: null,
  isTrustedHost: false,
  error: null,
  pendingTakeover: false,
  sendData: null,
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  ...initialState,

  setRole: (role) => set({ role }),
  setPin: (pin) => set({ pin }),
  setHostState: (hostState) => set({ hostState }),
  setControllerState: (controllerState) => set({ controllerState }),
  setPendingControllerId: (pendingControllerId) => set({ pendingControllerId }),
  setPendingControllerIntent: (pendingControllerIntent) => set({ pendingControllerIntent }),
  setTrustedHost: (isTrustedHost) => set({ isTrustedHost }),
  setError: (error) => set({ error }),
  setPendingTakeover: (pendingTakeover) => set({ pendingTakeover }),
  setSendData: (sendData) => set({ sendData }),
  reset: () => set(initialState),
}));
