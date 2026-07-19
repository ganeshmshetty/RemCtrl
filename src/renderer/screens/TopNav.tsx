/**
 * @file TopNav.tsx
 * @description Top header navigation and status bar component.
 * Integrates with the window manager's draggable region and provides buttons to trigger settings overlays or switch view modes.
 * Displays connection pill states indicating active session status (Local, Host/Controller with PIN, or Disconnected).
 * Coordinates termination events: clean closes local/remote browsers or WebRTC servers via window.RemoteCtrlAPI
 * and resets connection state using the useConnectionStore Zustand store.
 * Key exports: TopNav (function component).
 */

import { Activity, ArrowLeft, CircleAlert, Command as CommandIcon, PanelRight, Pause, Settings, Wifi } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useUIStore } from '../stores/useUIStore';
import { useAgentStore } from '../stores/useAgentStore';
import * as Tooltip from '@radix-ui/react-tooltip';

export function confirmAndCloseSession(confirmExit: () => boolean, closeSession: () => void): boolean {
  if (!confirmExit()) return false;
  closeSession();
  return true;
}

export function TopNav() {
  const { role, hostState, controllerState, pin, reset } = useConnectionStore();
  const { agentStatus, workflowRunState, chatHistory } = useAgentStore();
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
        : 'Workspace';
  const sessionStatus = getSessionStatus({ role, hostState, agentStatus, workflowRunState, pendingApproval: chatHistory.some((message) => message.type === 'checkpoint') });
  const StatusIcon = sessionStatus?.Icon;

  function closeSession() {
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

  function handleDisconnect() {
    closeSession();
  }

  function handleLeave() {
    confirmAndCloseSession(
      () => window.confirm('Leave this session? The active browser will close and the session will be reset.'),
      closeSession,
    );
  }

  function handleOpenSettings() {
    openSettings();
  }

  return (
    <div className="top-nav">
      <div className="top-nav-left drag-region">
        {role === 'local' && (
          <NavTooltip text="Back / Leave Local Session">
            <button className="top-nav-leave-btn no-drag" onClick={handleLeave} aria-label="Back and leave local session">
              <ArrowLeft size={14} aria-hidden="true" />
              <span>Leave</span>
            </button>
          </NavTooltip>
        )}
        <div className="top-nav-brand">
          <span>RemoteCtrl</span>
        </div>
        <span className="top-nav-context">{workspaceLabel}</span>
        {sessionStatus && StatusIcon && <span className={`top-nav-status ${sessionStatus.tone}`} aria-live="polite">
          <StatusIcon size={12} aria-hidden="true" />
          <span>{sessionStatus.label}</span>
        </span>}
      </div>
      <div className="top-nav-right no-drag">
        <button className="top-nav-command-trigger" onClick={() => window.dispatchEvent(new Event('remotectrl:open-command-palette'))} aria-label="Open command palette">
          <CommandIcon size={13} /><span>Command</span><kbd>⌘K</kbd>
        </button>
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

function getSessionStatus({ role, hostState, agentStatus, workflowRunState, pendingApproval }: {
  role: ReturnType<typeof useConnectionStore.getState>['role'];
  hostState: ReturnType<typeof useConnectionStore.getState>['hostState'];
  agentStatus: ReturnType<typeof useAgentStore.getState>['agentStatus'];
  workflowRunState: ReturnType<typeof useAgentStore.getState>['workflowRunState'];
  pendingApproval: boolean;
}) {
  if (pendingApproval) return { label: 'Needs your input', tone: 'warning', Icon: CircleAlert };
  if (agentStatus === 'running' || workflowRunState === 'running') return { label: 'Working', tone: 'active', Icon: Activity };
  if (agentStatus === 'paused') return { label: 'Paused', tone: 'warning', Icon: Pause };
  if (role === 'host' && hostState === 'WAITING_FOR_CONTROLLER') return { label: 'Waiting for controller', tone: 'idle', Icon: Wifi };
  return null;
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
