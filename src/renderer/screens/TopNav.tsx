/**
 * @file TopNav.tsx
 * @description Top header navigation and status bar component.
 * Integrates with the window manager's draggable region and provides buttons to trigger settings overlays or switch view modes.
 * Displays connection pill states indicating active session status (Local, Host/Controller with PIN, or Disconnected).
 * Coordinates termination events: clean closes local/remote browsers or WebRTC servers via window.RemoteCtrlAPI
 * and resets connection state using the useConnectionStore Zustand store.
 * Key exports: TopNav (function component).
 */

import { Command, PanelRight, Settings } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useUIStore } from '../stores/useUIStore';
import * as Tooltip from '@radix-ui/react-tooltip';

export function TopNav() {
  const { role, hostState, controllerState, pin, reset } = useConnectionStore();
  const { openSettings, isSidebarOpen, toggleSidebar } = useUIStore();

  const isConnected = 
    hostState === 'SESSION_ACTIVE' || 
    hostState === 'AGENT_EXECUTING' || 
    hostState === 'HUMAN_TAKEOVER' ||
    hostState === 'WAITING_FOR_CONTROLLER' ||
    hostState === 'AWAITING_HOST_APPROVAL' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  const workspaceLabel = role === 'local'
    ? 'Local workspace'
    : role === 'host'
      ? 'Host session'
      : role === 'controller'
        ? 'Remote session'
        : 'Ready';

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
        <div className="top-nav-brand">
          <span className="top-nav-brand-mark"><Command size={14} /></span>
          <span>RemoteCtrl</span>
        </div>
        <span className="top-nav-context">{workspaceLabel}</span>
      </div>
      <div className="top-nav-right no-drag">
        {role === 'local' ? (
          <div className="session-actions">
            <div className="session-indicator">
              <div className="connection-pill-dot connected"></div>
              <span>Local session</span>
            </div>
            <NavTooltip text="Switch to Mini Prompt Window">
              <button
                className="top-nav-mini-btn"
                onClick={() => window.RemoteCtrlAPI?.app.showMiniWindow(true)}
              >
                Mini Window ↗
              </button>
            </NavTooltip>
            <NavTooltip text="Stop Local Session">
              <button 
                className="top-nav-stop-btn"
                onClick={handleDisconnect}
              >
                Stop
              </button>
            </NavTooltip>
          </div>
        ) : isConnected ? (
          <div className="connection-pill">
            <div className="connection-pill-dot connected"></div>
            <span className="connection-pill-label">Connected</span>
            <span className="connection-pill-pin">{pin}</span>
            <NavTooltip text="Disconnect">
              <button 
                className="disconnect-btn"
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            </NavTooltip>
          </div>
        ) : null}
        {role !== 'idle' && (
          <NavTooltip text={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}>
            <button 
              className={`icon-btn ${isSidebarOpen ? 'active' : ''}`} 
              onClick={toggleSidebar} 
            >
              <PanelRight size={15} style={{ color: isSidebarOpen ? 'var(--accent)' : 'inherit' }} />
            </button>
          </NavTooltip>
        )}
        <NavTooltip text="Settings">
          <button className="icon-btn" onClick={handleOpenSettings}>
            <Settings size={15} />
          </button>
        </NavTooltip>
      </div>
    </div>
  );
}

function NavTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root delayDuration={0}>
      <Tooltip.Trigger asChild>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="top-nav-tooltip" sideOffset={5} side="bottom">
          {text}
          <Tooltip.Arrow className="top-nav-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
