/**
 * @file App.tsx
 * @description Main entry component and layout coordinator for the Electron renderer process.
 * Handles app-wide theme application (light, dark, system), settings loading, and conditional rendering of the MiniWindow.
 * Registers global Electron IPC listeners via window.RemoteCtrlAPI (e.g., hostStateChange, agentLog, startLocalSession)
 * to synchronize main-process events with Zustand stores (useConnectionStore, useAgentStore, useUIStore, useSettingsStore).
 * Displays primary screens dynamically: ConnectionPlaceholder (idle), LocalSession, or ControllerSession, alongside Settings and WorkflowEditorModal.
 */

import { useEffect, useState } from 'react';
import { useConnectionStore } from './stores/useConnectionStore';
import { useAgentStore } from './stores/useAgentStore';
import { useUIStore } from './stores/useUIStore';
import { TopNav } from './screens/TopNav';
import { ControllerSession } from './screens/ControllerSession';
import { LocalSession } from './screens/LocalSession';
import { ConnectionPlaceholder } from './screens/ConnectionPlaceholder';
import { Settings } from './screens/Settings';
import { MiniWindow } from './screens/MiniWindow';
import { WorkflowEditorModal } from './screens/WorkflowEditorModal';
import { CommandPalette } from './screens/CommandPalette';
import { useSettingsStore } from './stores/useWorkflowStore';
import * as Tooltip from '@radix-ui/react-tooltip';
import './screens/App.css';

export default function App() {
  const { role, setHostState, setControllerState, setPendingControllerId, setPin, setError } =
    useConnectionStore();
  const { handleAgentStatus, handleAgentLog, handleWorkflowRunStatus, handleWorkflowStepStatus, handleAgentCheckpoint } = useAgentStore();
  const { isSettingsOpen, openSettings } = useUIStore();
  const { theme, loadSettings } = useSettingsStore();
  const [showFirstLaunchBanner, setShowFirstLaunchBanner] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);



  useEffect(() => {
    const root = document.documentElement;
    const isMac = /mac/i.test(navigator.platform);
    root.classList.toggle('platform-macos', isMac);
    return () => root.classList.remove('platform-macos');
  }, []);

  // Theme observer
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

    const applyTheme = () => {
      let activeTheme = theme;
      if (theme === 'system') {
        activeTheme = mediaQuery.matches ? 'light' : 'dark';
      }
      
      if (activeTheme === 'light') {
        root.classList.add('light-theme');
      } else {
        root.classList.remove('light-theme');
      }
    };

    applyTheme();

    const listener = () => {
      if (theme === 'system') applyTheme();
    };
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, [theme]);

  // Wire Main -> Renderer push events
  useEffect(() => {
    if (!window.RemoteCtrlAPI) return; // Running in browser dev mode without Electron

    const unsubs = [
      window.RemoteCtrlAPI.on.hostStateChange((state) => setHostState(state)),
      window.RemoteCtrlAPI.on.controllerStateChange((state) => setControllerState(state)),
      window.RemoteCtrlAPI.on.controllerJoinRequest(({ controllerId, intent }) => {
        setPendingControllerId(controllerId);
        useConnectionStore.getState().setPendingControllerIntent(intent);
      }),
      window.RemoteCtrlAPI.on.pin((pin) => setPin(pin)),
      window.RemoteCtrlAPI.on.agentStatus((payload) => handleAgentStatus(payload)),
      window.RemoteCtrlAPI.on.agentLog((payload) => handleAgentLog(payload)),
      window.RemoteCtrlAPI.on.workflowRunStatus((status) => handleWorkflowRunStatus(status)),
      window.RemoteCtrlAPI.on.workflowStepStatus((status) => handleWorkflowStepStatus(status)),
      window.RemoteCtrlAPI.on.workflowRecordingState((state) => {
        const store = useAgentStore.getState();
        if (!state) {
          store.setRecordingState({
            recordingState: 'idle',
            recordingSessionId: null,
            recordingTask: null,
            recordingStepCount: 0,
            recordingError: null,
          });
          return;
        }
        store.setRecordingState({
          recordingState: state.status,
          recordingSessionId: state.id,
          recordingTask: state.initialInstruction,
          recordingStepCount: state.capturedStepCount,
          recordingError: state.error ?? null,
        });
      }),
      window.RemoteCtrlAPI.on.agentCheckpoint((payload) => handleAgentCheckpoint(payload)),
      window.RemoteCtrlAPI.on.error((msg) => setError(msg)),
      window.RemoteCtrlAPI.on.openSettings(() => openSettings()),
      window.RemoteCtrlAPI.on.firstLaunch(() => {
        setShowFirstLaunchBanner(true);
        setTimeout(() => setShowFirstLaunchBanner(false), 12000);
      }),
      window.RemoteCtrlAPI.on.startLocalSession(() => {
        void (async () => {
          useConnectionStore.getState().setRole('local');
          try {
            await window.RemoteCtrlAPI?.browser.launch();
            await window.RemoteCtrlAPI?.app.showMiniWindow(true);
          } catch (err) {
            useConnectionStore.getState().reset();
            useConnectionStore.getState().setError(
              `Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        })();
      }),
      window.RemoteCtrlAPI.on.themeChanged((newTheme) => {
        useSettingsStore.setState({ theme: newTheme as any });
      }),
      window.RemoteCtrlAPI.on.agentStarted((payload) => {
        const store = useAgentStore.getState();
        if (store.activeCommandId !== payload.commandId) {
          store.startNewExecution('agent', payload.commandId, payload.instruction);
          store.appendMessage({
            id: `user-${payload.commandId}`,
            sender: 'user',
            type: 'prompt',
            text: payload.instruction,
            timestamp: Date.now(),
          });
        }
      }),
    ];

    void window.RemoteCtrlAPI.browser.getWorkflowRecording().then((state) => {
      if (!state) return;
      useAgentStore.getState().setRecordingState({
        recordingState: state.status,
        recordingSessionId: state.id,
        recordingTask: state.initialInstruction,
        recordingStepCount: state.capturedStepCount,
        recordingError: state.error ?? null,
      });
    }).catch(() => {});

    return () => unsubs.forEach((u) => u());
  }, []);

  if (window.location.search.includes('mini=true')) {
    return (
      <Tooltip.Provider>
        <MiniWindow />
      </Tooltip.Provider>
    );
  }

  return (
    <Tooltip.Provider>
      <div className="app-shell">
        <TopNav />
        {showFirstLaunchBanner && (
          <div className="first-launch-banner">
            <span>🎉 First launch! Log into the sites you want the AI to access — it'll remember them forever.</span>
            <button onClick={() => setShowFirstLaunchBanner(false)}>✕</button>
          </div>
        )}
        <div className="main-content">
          {role === 'idle' ? (
            <div className="home-screen">
              <ConnectionPlaceholder />
            </div>
          ) : role === 'local' ? (
            <LocalSession />
          ) : (
            <ControllerSession />
          )}
        </div>
        {isSettingsOpen && <Settings />}
        <WorkflowEditorModal />
        <CommandPalette />
      </div>
    </Tooltip.Provider>
  );
}
