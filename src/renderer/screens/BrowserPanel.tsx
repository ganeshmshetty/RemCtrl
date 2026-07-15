/**
 * @file BrowserPanel.tsx
 * @description Central browser viewport component rendering the interactive browser screencast.
 * Displays tabs and address bar navigation for local browser runs or remote streams.
 * Renders the screencast stream using either an HTML5 canvas for local sessions (consuming frame byte buffers via window.RemoteCtrlAPI.on.screencastFrame)
 * or a video element coupled with useControllerWebRTC / useHostWebRTC hooks for peer-to-peer streaming.
 * Provides a takeover layer that captures mouse clicks, movements, scroll wheels, and keyboard keypresses, injecting inputs back into the browser via WebRTC or direct IPC.
 * Key exports: BrowserPanel (function component).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, X, Plus, Loader2, Copy, Check } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useAgentStore } from '../stores/useAgentStore';
import { useControllerWebRTC, useHostWebRTC } from '../hooks/useWebRTC';
import { ChatInputBar } from './ChatInputBar';
import type { TabInfo, AgentStatusPayload, AgentLogPayload, WorkflowRunStatus, WorkflowStepStatus, AgentCheckpointPayload } from '../../shared/types';
import * as ContextMenu from '@radix-ui/react-context-menu';
import './BrowserPanel.css';

function useLocalScreencast(isLocal: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isLocal || !window.RemoteCtrlAPI) return;

    let seq = 0;
    let latestDrawnSeq = 0;

    const cleanup = window.RemoteCtrlAPI.on.screencastFrame((frameData: Uint8Array) => {
      const frameSeq = ++seq;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const blob = new Blob([frameData as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
      createImageBitmap(blob)
        .then((bitmap) => {
          if (frameSeq < latestDrawnSeq) {
            bitmap.close();
            return;
          }
          latestDrawnSeq = frameSeq;
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
        })
        .catch(() => {});
    });

    return () => cleanup();
  }, [isLocal]);

  return canvasRef;
}

export function BrowserPanel() {
  const { role, controllerState, hostState, error, pin, pendingControllerId } = useConnectionStore();
  const { isTakeoverActive } = useAgentStore();
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [hasCopiedPin, setCopiedPin] = useState(false);

  const isLocal = role === 'local';

  const isConnected = 
    isLocal ||
    hostState === 'SESSION_ACTIVE' || 
    hostState === 'AGENT_EXECUTING' || 
    hostState === 'HUMAN_TAKEOVER' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  const isConnecting = 
    ['SIGNALING_CONNECTING', 'WAITING_FOR_HOST_APPROVAL', 'WEBRTC_CONNECTING'].includes(controllerState);

  const isHostWaiting = ['REGISTERING_PIN', 'SIGNALING_CONNECTING', 'WAITING_FOR_CONTROLLER', 'AWAITING_HOST_APPROVAL'].includes(hostState);

  const isHost = hostState !== 'IDLE' && hostState !== 'REGISTERING_PIN' && hostState !== 'WAITING_FOR_CONTROLLER' && hostState !== 'AWAITING_HOST_APPROVAL';
  const isController = controllerState !== 'IDLE';

  const [showHostStream, setShowHostStream] = useState(false);
  const hostRTC = useHostWebRTC(isConnected && isHost);
  const ctrlRTC = useControllerWebRTC(isConnected && isController);
  const localCanvasRef = useLocalScreencast((isConnected && isLocal) || (isHost && showHostStream));

  const canvasRef = isController ? ctrlRTC.canvasRef : localCanvasRef;
  const hostSendData = useCallback((msg: any, _reliable = true) => {
    if (msg.type === 'BROWSER_ACTION') {
      const { action, url, tabId } = msg.payload;
      if (action === 'navigate') window.RemoteCtrlAPI?.browser.navigate(url);
      else if (action === 'goBack') window.RemoteCtrlAPI?.browser.goBack();
      else if (action === 'goForward') window.RemoteCtrlAPI?.browser.goForward();
      else if (action === 'reload') window.RemoteCtrlAPI?.browser.reload();
      else if (action === 'closeTab') window.RemoteCtrlAPI?.browser.closeTab(tabId);
      else if (action === 'newTab') window.RemoteCtrlAPI?.browser.newTab();
    } else if (msg.type === 'SWITCH_TAB') {
      window.RemoteCtrlAPI?.browser.switchTab(msg.payload.tabId);
    } else if (msg.type === 'REMOTE_INPUT_MOUSE') {
      window.RemoteCtrlAPI?.browser.injectMouse(msg.payload);
    } else if (msg.type === 'REMOTE_INPUT_KEYBOARD') {
      window.RemoteCtrlAPI?.browser.injectKeyboard(msg.payload);
    } else if (msg.type === 'AGENT_PROMPT') {
      if (msg.payload.commandId === '__cancel__') {
        window.RemoteCtrlAPI?.browser.cancelAgent();
      } else {
        window.RemoteCtrlAPI?.browser.startAgent(msg.payload);
      }
    } else if (msg.type === 'AGENT_WORKFLOW_BATCH') {
      window.RemoteCtrlAPI?.browser.startWorkflow(msg.payload);
    }
  }, []);
  const sendData = (isHost || isLocal) ? hostSendData : ctrlRTC.sendData;
  const rtcStatus = isHost ? hostRTC.status : ctrlRTC.status;

  const lastMoveTimeRef = useRef<number>(0);

  useEffect(() => {
    useConnectionStore.getState().setSendData(sendData);
  }, [sendData]);

  useEffect(() => {
    const activeTab = tabs.find(t => t.active);
    if (activeTab && activeTab.url !== urlInput) {
      setUrlInput(activeTab.url);
    }
  }, [tabs]);

  useEffect(() => {
    if (isHost || isLocal) {
      window.RemoteCtrlAPI?.browser.getTabs().then((t) => setTabs(t || []));
      const cleanup = window.RemoteCtrlAPI?.on.tabsChange((newTabs) => {
        setTabs(newTabs);
      });
      return () => cleanup?.();
    }
  }, [isHost, isLocal]);

  useEffect(() => {
    if (isHost || isLocal) {
      ctrlRTC.onMessage(() => {});
      return;
    }

    ctrlRTC.onMessage((msg) => {
      const store = useAgentStore.getState();
      if (msg.type === 'AGENT_STATUS_UPDATE') {
        store.handleAgentStatus(msg.payload as AgentStatusPayload);
      } else if (msg.type === 'AGENT_LOG') {
        store.handleAgentLog(msg.payload as AgentLogPayload);
      } else if (msg.type === 'WORKFLOW_RUN_STATUS') {
        store.handleWorkflowRunStatus(msg.payload as WorkflowRunStatus);
      } else if (msg.type === 'WORKFLOW_STEP_STATUS') {
        store.handleWorkflowStepStatus(msg.payload as WorkflowStepStatus);
      } else if (msg.type === 'AGENT_CHECKPOINT') {
        store.handleAgentCheckpoint(msg.payload as AgentCheckpointPayload);
      } else if (msg.type === 'TAB_LIST') {
        setTabs(msg.payload as TabInfo[]);
      }
    });

    return () => {
      ctrlRTC.onMessage(() => {});
    };
  }, [isHost, isLocal, ctrlRTC.onMessage]);

  function handleBrowserAction(action: 'goBack' | 'goForward' | 'reload' | 'navigate' | 'closeTab' | 'newTab', tabId?: string) {
    sendData({
      type: 'BROWSER_ACTION',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action, url: urlInput, tabId },
    }, true);
  }

  function handleSwitchTab(tabId: string) {
    sendData({
      type: 'SWITCH_TAB',
      version: '1.0',
      timestamp: Date.now(),
      payload: { tabId },
    }, true);
  }

  const getCoords = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { xPercent: 0, yPercent: 0 };
    const rect = el.getBoundingClientRect();
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    return {
      xPercent: Math.max(0, Math.min(1, relX / rect.width)),
      yPercent: Math.max(0, Math.min(1, relY / rect.height)),
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    const now = Date.now();
    if (now - lastMoveTimeRef.current < 16) return;
    lastMoveTimeRef.current = now;
    const { xPercent, yPercent } = getCoords(e.clientX, e.clientY);
    sendData({
      type: 'REMOTE_INPUT_MOUSE',
      version: '1.0',
      timestamp: now,
      payload: { action: 'move', xPercent, yPercent }
    }, false);
  };

  const handleMouseEvent = (e: React.MouseEvent<HTMLDivElement>, action: 'click' | 'down' | 'up') => {
    if (!isTakeoverActive) return;
    const { xPercent, yPercent } = getCoords(e.clientX, e.clientY);
    let button: 'left' | 'middle' | 'right' = 'left';
    if (e.button === 1) button = 'middle';
    if (e.button === 2) button = 'right';
    sendData({
      type: 'REMOTE_INPUT_MOUSE',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action, xPercent, yPercent, button }
    }, true);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    const { xPercent, yPercent } = getCoords(e.clientX, e.clientY);
    sendData({
      type: 'REMOTE_INPUT_MOUSE',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action: 'scroll', xPercent, yPercent, deltaY: e.deltaY }
    }, false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    e.preventDefault();
    sendData({
      type: 'REMOTE_INPUT_KEYBOARD',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action: 'down', key: e.key }
    }, true);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    e.preventDefault();
    sendData({
      type: 'REMOTE_INPUT_KEYBOARD',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action: 'up', key: e.key }
    }, true);
  };


  function handleApprove() {
    if (pendingControllerId) {
      window.RemoteCtrlAPI?.host.approveController(pendingControllerId);
    }
  }

  function handleReject() {
    if (pendingControllerId) {
      window.RemoteCtrlAPI?.host.rejectController(pendingControllerId);
    }
  }

  function handleStopHosting() {
    if (isLocal) {
      window.RemoteCtrlAPI?.browser.close();
    } else {
      window.RemoteCtrlAPI?.host.stop();
    }
    useConnectionStore.getState().reset();
  }

  function handleCopyPin() {
    if (pin) {
      navigator.clipboard.writeText(pin);
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2000);
    }
  }

  return (
    <div className="browser-panel">
      <div className="browser-stage">
        <div className={`browser-window ${isTakeoverActive ? 'takeover-active' : ''}`}>
        {/* Browser Nav / Tabs */}
        {isConnected && tabs.length > 0 && (
        <div className="ctrl-toolbar">
          <div className="ctrl-tabs-row">
            <div className="ctrl-tabs">
              {tabs.map((tab) => (
                <ContextMenu.Root key={tab.id}>
                  <ContextMenu.Trigger asChild>
                    <div className={`ctrl-tab ${tab.active ? 'ctrl-tab-active' : ''}`} onClick={() => handleSwitchTab(tab.id)}>
                      <span className="ctrl-tab-title truncate">{tab.title}</span>
                      <button className="ctrl-tab-close" onClick={(e) => { e.stopPropagation(); handleBrowserAction('closeTab', tab.id); }}><X size={10} /></button>
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="context-menu-content">
                      <ContextMenu.Item className="context-menu-item" onClick={() => handleBrowserAction('reload')}>
                        Reload Tab
                      </ContextMenu.Item>
                      <ContextMenu.Item className="context-menu-item" onClick={() => handleBrowserAction('closeTab', tab.id)}>
                        Close Tab
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              ))}
              <button className="ctrl-tab-new" onClick={() => handleBrowserAction('newTab')}><Plus size={14} /></button>
            </div>
          </div>
          <div className="ctrl-address-row">
            <div className="ctrl-nav-btns">
              <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('goBack')}><ChevronLeft size={14} /></button>
              <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('goForward')}><ChevronRight size={14} /></button>
              <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('reload')}><RotateCw size={12} /></button>
            </div>
            <form className="ctrl-address-bar" onSubmit={(e) => { e.preventDefault(); handleBrowserAction('navigate'); }}>
              <input type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)} className="ctrl-url-input" />
            </form>
          </div>
        </div>
      )}

      {/* Video / Canvas Container */}
      <div className="browser-video-container">
        {isHostWaiting ? (
          <div className="browser-loading" style={{ gap: 20 }}>
            {['REGISTERING_PIN', 'SIGNALING_CONNECTING', 'WAITING_FOR_CONTROLLER'].includes(hostState) && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 600 }}>Waiting for Controller</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' }}>Share this PIN to allow remote control:</div>
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', margin: '24px 0' }}>
                  <div style={{ 
                    fontSize: '48px', 
                    fontFamily: 'var(--font-mono)', 
                    fontWeight: 700, 
                    letterSpacing: '0.1em',
                    color: 'var(--accent)',
                    minHeight: '60px',
                    display: 'flex',
                    alignItems: 'center',
                  }}>
                    {pin ? (
                      <span className="animate-pop-in">{pin}</span>
                    ) : (
                      <span className="animate-pulse" style={{ filter: 'blur(5px)', opacity: 0.4, userSelect: 'none' }}>000000000</span>
                    )}
                  </div>
                  <button 
                    className="icon-btn" 
                    onClick={handleCopyPin}
                    style={{ 
                      position: 'absolute',
                      left: 'calc(100% + 12px)',
                      width: '36px', 
                      height: '36px', 
                      border: '1px solid var(--border)',
                      opacity: pin ? 1 : 0.5,
                      pointerEvents: pin ? 'auto' : 'none'
                    }}
                    title="Copy PIN"
                  >
                    {hasCopiedPin ? <Check size={18} color="var(--success)" /> : <Copy size={18} />}
                  </button>
                </div>
                <button className="btn btn-ghost" onClick={handleStopHosting} style={{ color: 'var(--danger)' }}>
                  Stop Hosting
                </button>
              </div>
            )}
            {hostState === 'AWAITING_HOST_APPROVAL' && (
              <div className="session-approval animate-fade-in" style={{
                background: 'var(--bg-overlay)', padding: 24, borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16
              }}>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>Controller wants to connect</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {pendingControllerId}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button className="btn btn-danger" onClick={handleReject}>Reject</button>
                  <button className="btn btn-primary" onClick={handleApprove}>Approve</button>
                </div>
              </div>
            )}
          </div>
        ) : isConnecting ? (
          <div className="browser-loading">
            <Loader2 size={32} className="animate-spin" style={{ marginBottom: 8 }} />
            <div>Connecting...</div>
          </div>
        ) : isConnected ? (
          <>
            {(isLocal || isController || showHostStream) && (
              <canvas ref={canvasRef} className="browser-video" />
            )}
            {isHost && !showHostStream && (
              <div className="browser-loading" style={{ flexDirection: 'column' }}>
                <div style={{ marginBottom: 16 }}>Screen sharing is active.</div>
                <button className="btn btn-primary" onClick={() => setShowHostStream(true)}>Preview Stream</button>
              </div>
            )}
            {isHost && showHostStream && (
              <button className="btn btn-ghost" style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)' }} onClick={() => setShowHostStream(false)}>
                Hide Stream
              </button>
            )}
            {!isLocal && rtcStatus !== 'streaming' && (
              <div className="browser-loading">
                <Loader2 size={24} className="animate-spin" style={{ marginBottom: 8 }} />
                <div>Waiting for stream...</div>
              </div>
            )}
            {isTakeoverActive && (
              <div
                className="takeover-overlay"
                tabIndex={0}
                onMouseMove={handleMouseMove}
                onMouseDown={(e) => handleMouseEvent(e, 'down')}
                onMouseUp={(e) => handleMouseEvent(e, 'up')}
                onWheel={handleWheel}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onContextMenu={(e) => e.preventDefault()}
                ref={(el) => {
                  el?.focus();
                }}
              />
            )}
          </>
        ) : (
          <div className="browser-loading" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
            <div>{error ?? 'Disconnected'}</div>
            <button 
              className="btn btn-primary" 
              onClick={() => {
                useConnectionStore.getState().reset();
                window.RemoteCtrlAPI?.browser.close();
                window.RemoteCtrlAPI?.host.stop();
              }}
            >
              Return to Home
            </button>
          </div>
        )}
      </div>
      </div>
      </div>
      <ChatInputBar />
    </div>
  );
}
