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
import { useSettingsStore } from './stores/useWorkflowStore';

export default function App() {
  if (window.location.search.includes('mini=true')) {
    return <MiniWindow />;
  }

  const { role, setHostState, setControllerState, setPendingControllerId, setPin, setError } =
    useConnectionStore();
  const { handleAgentStatus, handleAgentLog, handleWorkflowRunStatus, handleWorkflowStepStatus, handleAgentCheckpoint } = useAgentStore();
  const { isSettingsOpen, openSettings } = useUIStore();
  const { theme, loadSettings } = useSettingsStore();
  const [showFirstLaunchBanner, setShowFirstLaunchBanner] = useState(false);

  useEffect(() => {
    loadSettings();
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
      window.RemoteCtrlAPI.on.controllerJoinRequest((id) => setPendingControllerId(id)),
      window.RemoteCtrlAPI.on.pin((pin) => setPin(pin)),
      window.RemoteCtrlAPI.on.agentStatus((payload) => handleAgentStatus(payload)),
      window.RemoteCtrlAPI.on.agentLog((payload) => handleAgentLog(payload)),
      window.RemoteCtrlAPI.on.workflowRunStatus((status) => handleWorkflowRunStatus(status)),
      window.RemoteCtrlAPI.on.workflowStepStatus((status) => handleWorkflowStepStatus(status)),
      window.RemoteCtrlAPI.on.agentCheckpoint((payload) => handleAgentCheckpoint(payload)),
      window.RemoteCtrlAPI.on.error((msg) => setError(msg)),
      window.RemoteCtrlAPI.on.openSettings(() => openSettings()),
      window.RemoteCtrlAPI.on.firstLaunch(() => {
        setShowFirstLaunchBanner(true);
        setTimeout(() => setShowFirstLaunchBanner(false), 12000);
      }),
      window.RemoteCtrlAPI.on.startLocalSession(() => {
        useConnectionStore.getState().setRole('local');
        window.RemoteCtrlAPI?.browser.launch();
        window.RemoteCtrlAPI?.app.showMiniWindow(true);
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  return (
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
    </div>
  );
}
