/**
 * @file useWebRTC.ts
 * @description React hooks orchestrating the WebRTC connection, audio/video streaming, and data channels.
 * Exports the `useHostWebRTC` and `useControllerWebRTC` hooks, along with connection status states.
 * Internally sets up RTCPeerConnection with STUN servers, manages an ICE candidate queuing mechanism,
 * and maintains reliable and input data channels (`RemoteCtrl-reliable` / `RemoteCtrl-input`).
 * Connects WebRTC signaling with the main process using IPC via `window.RemoteCtrlAPI`, forwarding 
 * canvas screencast streams and remote inputs (mouse, keyboard) to synchronize the interactive session.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { DataChannelMessage } from '../../shared/types';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export type WebRTCStatus = 'idle' | 'launching' | 'capturing' | 'connecting' | 'streaming' | 'error';

// ─── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Queue-flushing wrapper around addIceCandidate.
 * ICE candidates that arrive before setRemoteDescription must be buffered
 * and applied once the remote description is present.
 */
function makeIceQueue(pc: RTCPeerConnection) {
  const queue: RTCIceCandidateInit[] = [];
  let remoteSet = false;

  async function flush() {
    while (queue.length) {
      const c = queue.shift()!;
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('[webrtc] addIceCandidate after flush failed', e); }
    }
  }

  return {
    async markRemoteSet() {
      remoteSet = true;
      await flush();
    },
    async add(candidate: RTCIceCandidateInit) {
      if (!remoteSet) {
        queue.push(candidate);
      } else {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn('[webrtc] addIceCandidate failed', e); }
      }
    },
  };
}

// ─── Host-side WebRTC hook ─────────────────────────────────────────────────────
// Uses the modern getDisplayMedia() approach. The main process intercepts this
// via session.setDisplayMediaRequestHandler and selects the Playwright window.

export function useHostWebRTC(isSessionActive: boolean) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!isSessionActive) return;

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let videoChannel: RTCDataChannel | null = null;

    let cleanupSignal: (() => void) | undefined;
    let cleanupAgentStatus: (() => void) | undefined;
    let cleanupAgentLog: (() => void) | undefined;
    let cleanupWorkflowRunStatus: (() => void) | undefined;
    let cleanupWorkflowStepStatus: (() => void) | undefined;
    let cleanupScreencastFrame: (() => void) | undefined;
    let cleanupTabsChange: (() => void) | undefined;
    let cleanupAgentCheckpoint: (() => void) | undefined;

    async function startWebRTC() {
      try {
        setStatus('launching');

        // 1. Launch Playwright browser (reuses if already running)
        await window.RemoteCtrlAPI.browser.launch();
        if (cancelled) return;

        setStatus('connecting');

        // 2. Create peer connection
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        
        const iceQueue = makeIceQueue(pc);

        // Data Channels
        const reliableChannel = pc.createDataChannel('RemoteCtrl-reliable', { ordered: true });
        const inputChannel = pc.createDataChannel('RemoteCtrl-input', { ordered: false, maxRetransmits: 0 });
        videoChannel = pc.createDataChannel('RemoteCtrl-video', { ordered: false, maxRetransmits: 0 });

        // Register screencast frame listener
        cleanupScreencastFrame = window.RemoteCtrlAPI.on.screencastFrame((frameData: Uint8Array) => {
          if (cancelled || !videoChannel || videoChannel.readyState !== 'open') return;
          try {
            videoChannel.send(frameData as unknown as ArrayBuffer);
          } catch (e) {
            console.warn('[host-webrtc] Failed to send frame', e);
          }
        });

        const handleDataMessage = async (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data) as DataChannelMessage;
            if (msg.type === 'REMOTE_INPUT_MOUSE') {
              await window.RemoteCtrlAPI.browser.injectMouse(msg.payload as any);
            } else if (msg.type === 'REMOTE_INPUT_KEYBOARD') {
              await window.RemoteCtrlAPI.browser.injectKeyboard(msg.payload as any);
            } else if (msg.type === 'SWITCH_TAB') {
              await window.RemoteCtrlAPI.browser.switchTab((msg.payload as any).tabId);
            } else if (msg.type === 'BROWSER_ACTION') {
              const payload = msg.payload as any;
              if (payload.action === 'goBack') await window.RemoteCtrlAPI.browser.goBack();
              else if (payload.action === 'goForward') await window.RemoteCtrlAPI.browser.goForward();
              else if (payload.action === 'reload') await window.RemoteCtrlAPI.browser.reload();
              else if (payload.action === 'navigate' && payload.url) await window.RemoteCtrlAPI.browser.navigate(payload.url);
              else if (payload.action === 'closeTab' && payload.tabId) await window.RemoteCtrlAPI.browser.closeTab(payload.tabId);
              else if (payload.action === 'newTab') await window.RemoteCtrlAPI.browser.newTab();
            } else if (msg.type === 'AGENT_PROMPT') {
              const payload = msg.payload as any;
              if (payload.commandId === '__cancel__') {
                await window.RemoteCtrlAPI.browser.cancelAgent();
                return;
              }
              const res = await window.RemoteCtrlAPI.browser.startAgent(payload);
              if (!res.ok) {
                const errMsg: DataChannelMessage = {
                  type: 'AGENT_STATUS_UPDATE',
                  version: '1.0',
                  timestamp: Date.now(),
                  payload: {
                    commandId: (msg.payload as any).commandId ?? 'unknown',
                    state: 'failed',
                    error: res.error,
                  },
                };
                reliableChannel.send(JSON.stringify(errMsg));
              }
            } else if (msg.type === 'AGENT_WORKFLOW_BATCH') {
              const res = await window.RemoteCtrlAPI.browser.startWorkflow(msg.payload as any);
              if (!res.ok) {
                const errMsg: DataChannelMessage = {
                  type: 'WORKFLOW_RUN_STATUS',
                  version: '1.0',
                  timestamp: Date.now(),
                  payload: {
                    workflowRunId: (msg.payload as any).workflowRunId ?? 'unknown',
                    state: 'failed',
                    error: res.error,
                  },
                };
                reliableChannel.send(JSON.stringify(errMsg));
              }
            } else if (msg.type === 'WORKFLOW_CANCEL') {
              await window.RemoteCtrlAPI.browser.cancelWorkflow();
            } else if (msg.type === 'AGENT_CHECKPOINT_RESPONSE') {
              const payload = msg.payload as any;
              await window.RemoteCtrlAPI.browser.submitCheckpoint(payload.checkpointId, payload.response);
            }
          } catch (err) {
            console.error('[host-webrtc] Error handling data channel message:', err);
          }
        };

        reliableChannel.onmessage = handleDataMessage;
        inputChannel.onmessage = handleDataMessage;

        reliableChannel.onopen = async () => {
          // Send initial tabs when reliable channel opens
          try {
            const initialTabs = await window.RemoteCtrlAPI.browser.getTabs();
            reliableChannel.send(JSON.stringify({
              type: 'TAB_LIST',
              version: '1.0',
              timestamp: Date.now(),
              payload: initialTabs,
            } satisfies DataChannelMessage));
          } catch (err) {
            console.error('[host-webrtc] Failed to send initial tabs:', err);
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (pc?.iceConnectionState === 'disconnected' || pc?.iceConnectionState === 'failed') {
            console.log('[host-webrtc] ICE disconnected/failed. Initiating ICE restart...');
            pc.restartIce();
            pc.createOffer({ iceRestart: true }).then(offer => {
              pc!.setLocalDescription(offer);
              window.RemoteCtrlAPI.webrtc.sendSignal({
                type: 'offer',
                sdpType: pc!.localDescription!.type,
                sdpStr: pc!.localDescription!.sdp,
              });
            });
          }
        };

        // Forward agent status/log events from Main process back to Controller
        cleanupAgentStatus = window.RemoteCtrlAPI.on.agentStatus((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'AGENT_STATUS_UPDATE',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });
        cleanupAgentLog = window.RemoteCtrlAPI.on.agentLog((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'AGENT_LOG',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });
        cleanupAgentCheckpoint = window.RemoteCtrlAPI.on.agentCheckpoint((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'AGENT_CHECKPOINT',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });

        // Relay workflow status events back to Controller
        cleanupWorkflowRunStatus = window.RemoteCtrlAPI.on.workflowRunStatus((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'WORKFLOW_RUN_STATUS',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });
        cleanupWorkflowStepStatus = window.RemoteCtrlAPI.on.workflowStepStatus((payload) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'WORKFLOW_STEP_STATUS',
              version: '1.0',
              timestamp: Date.now(),
              payload,
            } satisfies DataChannelMessage));
          }
        });

        // Forward tab changes
        cleanupTabsChange = window.RemoteCtrlAPI.on.tabsChange((tabs) => {
          if (reliableChannel.readyState === 'open') {
            reliableChannel.send(JSON.stringify({
              type: 'TAB_LIST',
              version: '1.0',
              timestamp: Date.now(),
              payload: tabs,
            } satisfies DataChannelMessage));
          }
        });




        // Outgoing ICE → relay to controller via signaling
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            window.RemoteCtrlAPI.webrtc.sendSignal({
              type: 'ice-candidate',
              candidate: e.candidate.toJSON(),
            });
          }
        };

        pc.onconnectionstatechange = () => {
          console.log('[host-webrtc] Connection state:', pc?.connectionState);
          if (pc?.connectionState === 'disconnected' || pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
            console.log('[host-webrtc] Controller disconnected. Cancelling active agents and workflows...');
            window.RemoteCtrlAPI.browser.cancelAgent().catch(() => {});
            window.RemoteCtrlAPI.browser.cancelWorkflow().catch(() => {});
          }
        };

        // 5. Listen for controller's answer and ICE candidates
        cleanupSignal = window.RemoteCtrlAPI.on.webrtcSignal(async (raw) => {
          if (cancelled || !pc) return;
          const signal = raw as { type: string; sdpType?: string; sdpStr?: string; candidate?: RTCIceCandidateInit };
          try {
            if (signal.type === 'answer' && signal.sdpStr) {
              console.log('[host-webrtc] Got answer from controller');
              await pc.setRemoteDescription(new RTCSessionDescription({
                type: (signal.sdpType ?? 'answer') as RTCSdpType,
                sdp: signal.sdpStr,
              }));
              await iceQueue.markRemoteSet();
              setStatus('streaming');
            } else if (signal.type === 'ice-candidate' && signal.candidate) {
              await iceQueue.add(signal.candidate);
            }
          } catch (err) {
            console.error('[host-webrtc] signal handling error', err);
          }
        });

        // 6. Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('[host-webrtc] Sending offer');
        // Send plain JSON with SDP as flat strings — nested objects get stripped in socket.io relay
        window.RemoteCtrlAPI.webrtc.sendSignal({
          type: 'offer',
          sdpType: pc.localDescription!.type,
          sdpStr: pc.localDescription!.sdp,
        });

      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setStatus('error');
          console.error('[host-webrtc]', msg);
        }
      }
    }

    startWebRTC();

    return () => {
      cancelled = true;
      cleanupSignal?.();
      cleanupAgentStatus?.();
      cleanupAgentLog?.();
      cleanupWorkflowRunStatus?.();
      cleanupWorkflowStepStatus?.();
      cleanupScreencastFrame?.();
      cleanupTabsChange?.();
      cleanupAgentCheckpoint?.();
      pc?.close();
      pc = null;
      setStatus('idle');
      setError(null);
    };
  }, [isSessionActive]);

  return { status, error, videoRef };
}
// ─── Controller-side WebRTC hook ───────────────────────────────────────────────
// The PC and signal listener are created on mount (not gated by isSessionActive)
// so they're always ready when the offer arrives from the host.

export function useControllerWebRTC(_isSessionActive: boolean) {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reliableChannelRef = useRef<RTCDataChannel | null>(null);
  const inputChannelRef = useRef<RTCDataChannel | null>(null);
  const onMessageRef = useRef<((msg: DataChannelMessage) => void) | null>(null);

  // Always-on: create PC and listen for signals on mount
  useEffect(() => {
    let cancelled = false;
    console.log('[ctrl-webrtc] Mounting, creating RTCPeerConnection');

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const iceQueue = makeIceQueue(pc);

    pc.ondatachannel = (e) => {
      const channel = e.channel;
      if (channel.label === 'RemoteCtrl-reliable') {
        reliableChannelRef.current = channel;
        channel.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data) as DataChannelMessage;
            onMessageRef.current?.(msg);
          } catch { /* ignore malformed */ }
        };
      } else if (channel.label === 'RemoteCtrl-input') {
        inputChannelRef.current = channel;
      } else if (channel.label === 'RemoteCtrl-video') {
        setStatus('streaming');
        channel.onmessage = (ev) => {
          if (!canvasRef.current || !ev.data) return;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const blob = new Blob([ev.data as ArrayBuffer], { type: 'image/jpeg' });
          createImageBitmap(blob).then((bitmap) => {
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
          }).catch(err => {
            console.error('[ctrl-webrtc] Failed to paint remote frame', err);
          });
        };
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[ctrl-webrtc] Connection state: ${pc.connectionState}`);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        window.RemoteCtrlAPI.webrtc.sendSignal({
          type: 'ice-candidate',
          candidate: e.candidate.toJSON(),
        });
      }
    };

    const cleanupSignal = window.RemoteCtrlAPI.on.webrtcSignal(async (raw) => {
      if (cancelled) return;
      const signal = raw as {
        type: string;
        sdpType?: string; sdpStr?: string;  // flat SDP fields
        candidate?: RTCIceCandidateInit;
      };
      try {
        if (signal.type === 'offer' && signal.sdpStr) {
          console.log('[ctrl-webrtc] Got offer, calling setRemoteDescription');
          setStatus('connecting');
          await pc.setRemoteDescription(new RTCSessionDescription({
            type: (signal.sdpType ?? 'offer') as RTCSdpType,
            sdp: signal.sdpStr,
          }));
          console.log('[ctrl-webrtc] setRemoteDescription done, flushing ICE');
          await iceQueue.markRemoteSet();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log('[ctrl-webrtc] Sending answer');
          window.RemoteCtrlAPI.webrtc.sendSignal({
            type: 'answer',
            sdpType: pc.localDescription!.type,
            sdpStr: pc.localDescription!.sdp,
          });
        } else if (signal.type === 'ice-candidate' && signal.candidate) {
          await iceQueue.add(signal.candidate);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ctrl-webrtc] SIGNAL ERROR: ${msg}`);
          setError(msg);
          setStatus('error');
        }
      }
    });

    return () => {
      cancelled = true;
      cleanupSignal();
      pc.close();
      reliableChannelRef.current = null;
      inputChannelRef.current = null;
      setStatus('idle');
      setError(null);
    };
  }, []); // <-- mount once, always listening

  const sendData = useCallback((msg: DataChannelMessage, reliable = true) => {
    const channel = reliable ? reliableChannelRef.current : inputChannelRef.current;
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(msg));
    } else {
      console.warn('[ctrl-webrtc] Cannot send data, channel not open');
    }
  }, []);

  const onMessage = useCallback((cb: (msg: DataChannelMessage) => void) => {
    onMessageRef.current = cb;
  }, []);

  return { canvasRef, status, error, sendData, onMessage };
}
