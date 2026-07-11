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
          <div className="connection-pill">
            <div className="connection-pill-dot connected"></div>
            <span style={{ fontWeight: 500 }}>Local Session</span>
            <button
              className="disconnect-btn"
              style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
              onClick={() => window.RemoteCtrlAPI?.app.showMiniWindow(true)}
              title="Switch to Mini Prompt Window"
            >
              Mini Window ↗
            </button>
            <button 
              className="disconnect-btn"
              onClick={handleDisconnect}
              title="Stop Local Session"
            >
              Stop
            </button>
          </div>
        ) : isConnected ? (
          <div className="connection-pill">
            <div className="connection-pill-dot connected"></div>
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

