/**
 * @file TopNav.tsx
 * @description Top header navigation and status bar component.
 * Integrates with the window manager's draggable region and provides buttons to trigger settings overlays or switch view modes.
 * Displays connection pill states indicating active session status (Local, Host/Controller with PIN, or Disconnected).
 * Coordinates termination events: clean closes local/remote browsers or WebRTC servers via window.RemoteCtrlAPI
 * and resets connection state using the useConnectionStore Zustand store.
 * Key exports: TopNav (function component).
 */

import { Settings } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useUIStore } from '../stores/useUIStore';

export function TopNav() {
  const { role, hostState, controllerState, pin, reset } = useConnectionStore();
  const { openSettings } = useUIStore();

  const isConnected = 
    hostState === 'SESSION_ACTIVE' || 
    hostState === 'AGENT_EXECUTING' || 
    hostState === 'HUMAN_TAKEOVER' ||
    hostState === 'WAITING_FOR_CONTROLLER' ||
    hostState === 'AWAITING_HOST_APPROVAL' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  function handleDisconnect() {
    if (window.RemoteCtrlAPI) {
      if (role === 'local') {
        window.RemoteCtrlAPI.browser.close();
      }
      if (hostState !== 'IDLE') {
        window.RemoteCtrlAPI.host.stop();
      }
      if (controllerState !== 'IDLE') {
        window.RemoteCtrlAPI.controller.disconnect();
      }
    }
    reset();
  }

  function handleOpenSettings() {
    openSettings();
  }

  return (
    <div className="top-nav">
      <div className="top-nav-left drag-region">
      </div>
      <div className="top-nav-right no-drag">
        {role === 'local' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.8 }}>
              <div className="connection-pill-dot connected"></div>
              <span style={{ fontWeight: 500, fontSize: 13 }}>Local Session</span>
            </div>
            <button
              className="top-nav-mini-btn"
              onClick={() => window.RemoteCtrlAPI?.app.showMiniWindow(true)}
              title="Switch to Mini Prompt Window"
            >
              Mini Window ↗
            </button>
            <button 
              className="top-nav-stop-btn"
              onClick={handleDisconnect}
              title="Stop Local Session"
            >
              Stop
            </button>
          </div>
        ) : isConnected ? (
          <div className="connection-pill">
            <div className="connection-pill-dot connected"></div>
            <span style={{ fontWeight: 500, marginRight: 4 }}>Connected:</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{pin}</span>
            <button 
              className="disconnect-btn"
              onClick={handleDisconnect}
              title="Disconnect"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="connection-pill" style={{ opacity: 0.7 }}>
            <div className="connection-pill-dot"></div>
            <span>Not connected</span>
          </div>
        )}
        <button className="icon-btn" onClick={handleOpenSettings} title="Settings">
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}

