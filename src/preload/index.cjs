/**
 * @file index.cjs
 * @description Secure Electron preload script that acts as the IPC bridge between the main and renderer processes.
 * Exposes a structured, type-safe global object `window.RemoteCtrlAPI` to the renderer via `contextBridge.exposeInMainWorld`.
 * Exposes namespace APIs (`host`, `controller`, `browser`, `webrtc`, `agent`, `app`, `settings`, `workflows`, and a pub/sub listener registration hub `on`).
 * Internally wraps Electron's `ipcRenderer.invoke` and event listener bindings, preventing direct exposure of the `ipcRenderer` module for enhanced security.
 * Connects UI actions (Zustand stores, React components, and WebRTC hooks) with background browser processes and low-level system methods.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose narrow typed API to renderer.
 * Never expose raw ipcRenderer — only specific, named channels.
 */
contextBridge.exposeInMainWorld('RemoteCtrlAPI', {
  // ── Host Controls ──────────────────────────────────────────────────────────
  host: {
    start: (options) => ipcRenderer.invoke('host:start', options),
    stop: () => ipcRenderer.invoke('host:stop'),
    approveController: (controllerId, intent) =>
      ipcRenderer.invoke('host:approveController', controllerId, intent),
    rejectController: (controllerId) =>
      ipcRenderer.invoke('host:rejectController', controllerId),
  },

  // ── Controller Controls ───────────────────────────────────────────────────
  controller: {
    connect: (pin, intent) => ipcRenderer.invoke('controller:connect', { pin, intent }),
    disconnect: () => ipcRenderer.invoke('controller:disconnect'),
  },

  // ── Browser Controls ──────────────────────────────────────────────────────
  browser: {
    launch: (startUrl) => ipcRenderer.invoke('browser:launch', startUrl),
    launchRecording: () => ipcRenderer.invoke('browser:launchRecording'),
    startWorkflowRecording: (payload) => ipcRenderer.invoke('browser:startWorkflowRecording', payload),
    getWorkflowRecording: () => ipcRenderer.invoke('browser:getWorkflowRecording'),
    saveWorkflowRecording: () => ipcRenderer.invoke('browser:saveWorkflowRecording'),
    discardWorkflowRecording: () => ipcRenderer.invoke('browser:discardWorkflowRecording'),
    close: () => ipcRenderer.invoke('browser:close'),
    getSources: () => ipcRenderer.invoke('browser:getSources'),
    resetProfile: () => ipcRenderer.invoke('browser:resetProfile'),
    injectMouse: (payload) => ipcRenderer.invoke('browser:injectMouse', payload),
    injectKeyboard: (payload) => ipcRenderer.invoke('browser:injectKeyboard', payload),
    startAgent: (payload) => ipcRenderer.invoke('browser:startAgent', payload),
    rewindAndRerunAgent: (payload) => ipcRenderer.invoke('browser:rewindAndRerunAgent', payload),
    cancelAgent: () => ipcRenderer.invoke('browser:cancelAgent'),
    startWorkflow: (payload) => ipcRenderer.invoke('browser:startWorkflow', payload),
    cancelWorkflow: () => ipcRenderer.invoke('browser:cancelWorkflow'),
    setTakeoverActive: (active) => ipcRenderer.invoke('browser:setTakeoverActive', active),
    getTabs: () => ipcRenderer.invoke('browser:getTabs'),
    switchTab: (tabId) => ipcRenderer.invoke('browser:switchTab', tabId),
    goBack: () => ipcRenderer.invoke('browser:goBack'),
    goForward: () => ipcRenderer.invoke('browser:goForward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
    closeTab: (tabId) => ipcRenderer.invoke('browser:closeTab', tabId),
    newTab: () => ipcRenderer.invoke('browser:newTab'),
    submitCheckpoint: (checkpointId, response) => ipcRenderer.invoke('browser:submitCheckpoint', checkpointId, response),
  },

  // ── WebRTC Signal Relay ───────────────────────────────────────────────────
  webrtc: {
    sendSignal: (signal) => ipcRenderer.invoke('webrtc:sendSignal', signal),
  },

  // ── Agent Session Management ──────────────────────────────────────────────
  agent: {
    clearHistory: (sessionId) => ipcRenderer.invoke('agent:clearHistory', sessionId),
    listRecoverableRuns: () => ipcRenderer.invoke('agent:listRecoverableRuns'),
    discardRecoverableRun: (id) => ipcRenderer.invoke('agent:discardRecoverableRun', id),
    resumeRecoverableRun: (id) => ipcRenderer.invoke('agent:resumeRecoverableRun', id),
    listRunHistory: () => ipcRenderer.invoke('agent:listRunHistory'),
    saveRunHistory: (item) => ipcRenderer.invoke('agent:saveRunHistory', item),
    deleteRunHistory: (id) => ipcRenderer.invoke('agent:deleteRunHistory', id),
    clearRunHistory: () => ipcRenderer.invoke('agent:clearRunHistory'),
  },

  // ── App / Diagnostics ─────────────────────────────────────────────────────
  app: {
    getDiagnostics: () => ipcRenderer.invoke('app:getDiagnostics'),
    showMainWindow: () => ipcRenderer.invoke('app:showMainWindow'),
    hideMiniWindow: () => ipcRenderer.invoke('app:hideMiniWindow'),
    showMiniWindow: (hideMain) => ipcRenderer.invoke('app:showMiniWindow', hideMain),
    setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('app:setIgnoreMouseEvents', ignore),
    resizeToContent: (contentHeight) => ipcRenderer.invoke('app:resizeToContent', contentHeight),
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    hasApiKey: (provider) => ipcRenderer.invoke('settings:hasApiKey', provider),
    setApiKey: (provider, value) =>
      ipcRenderer.invoke('settings:setApiKey', provider, value),
    getSignalingUrl: () => ipcRenderer.invoke('settings:getSignalingUrl'),
    setSignalingUrl: (url) => ipcRenderer.invoke('settings:setSignalingUrl', url),
    getPreferredProvider: () => ipcRenderer.invoke('settings:getPreferredProvider'),
    setPreferredProvider: (provider) =>
      ipcRenderer.invoke('settings:setPreferredProvider', provider),
    getPreferredModel: () => ipcRenderer.invoke('settings:getPreferredModel'),
    setPreferredModel: (model) => ipcRenderer.invoke('settings:setPreferredModel', model),
    fetchModels: (provider) => ipcRenderer.invoke('settings:fetchModels', provider),
    getAvailableModels: (provider) => ipcRenderer.invoke('settings:getAvailableModels', provider),
    getBrowserMode: () => ipcRenderer.invoke('settings:getBrowserMode'),
    setBrowserMode: (mode) => ipcRenderer.invoke('settings:setBrowserMode', mode),
    getHeadlessMode: () => ipcRenderer.invoke('settings:getHeadlessMode'),
    setHeadlessMode: (headless) => ipcRenderer.invoke('settings:setHeadlessMode', headless),
    getKeepBrowserOpenOnQuit: () => ipcRenderer.invoke('settings:getKeepBrowserOpenOnQuit'),
    setKeepBrowserOpenOnQuit: (keepOpen) => ipcRenderer.invoke('settings:setKeepBrowserOpenOnQuit', keepOpen),
    getBrowserProfile: () => ipcRenderer.invoke('settings:getBrowserProfile'),
    setBrowserProfile: (profile) => ipcRenderer.invoke('settings:setBrowserProfile', profile),
    getCustomProfiles: () => ipcRenderer.invoke('settings:getCustomProfiles'),
    addCustomProfile: (name) => ipcRenderer.invoke('settings:addCustomProfile', name),
    deleteCustomProfile: (name) => ipcRenderer.invoke('settings:deleteCustomProfile', name),
    getUseVisionCUA: () => ipcRenderer.invoke('settings:getUseVisionCUA'),
    setUseVisionCUA: (useCua) => ipcRenderer.invoke('settings:setUseVisionCUA', useCua),
    getCustomBaseUrl: (provider) => ipcRenderer.invoke('settings:getCustomBaseUrl', provider),
    setCustomBaseUrl: (provider, url) => ipcRenderer.invoke('settings:setCustomBaseUrl', provider, url),
    getTheme: () => ipcRenderer.invoke('settings:getTheme'),
    setTheme: (theme) => ipcRenderer.invoke('settings:setTheme', theme),
    getGlobalShortcut: () => ipcRenderer.invoke('settings:getGlobalShortcut'),
    setGlobalShortcut: (shortcut) => ipcRenderer.invoke('settings:setGlobalShortcut', shortcut),
    getSpeechToTextEnabled: () => ipcRenderer.invoke('settings:getSpeechToTextEnabled'),
    setSpeechToTextEnabled: (enabled) => ipcRenderer.invoke('settings:setSpeechToTextEnabled', enabled),
    getSpeechInputMode: () => ipcRenderer.invoke('settings:getSpeechInputMode'),
    setSpeechInputMode: (mode) => ipcRenderer.invoke('settings:setSpeechInputMode', mode),
  },

  // ── Workflows ─────────────────────────────────────────────────────────────
  workflows: {
    list: () => ipcRenderer.invoke('workflows:list'),
    save: (workflow) => ipcRenderer.invoke('workflows:save', workflow),
    delete: (workflowId) => ipcRenderer.invoke('workflows:delete', workflowId),
  },

  // ── Scoped task policy ───────────────────────────────────────────────────
  policy: {
    getScope: () => ipcRenderer.invoke('policy:getScope'),
    setScope: (scope) => ipcRenderer.invoke('policy:setScope', scope),
    approve: (approvalId, approved) => ipcRenderer.invoke('policy:resolveApproval', { approvalId, approved }),
    getAudit: () => ipcRenderer.invoke('policy:getAudit'),
  },

  // ── Event Listeners (Main -> Renderer push) ───────────────────────────────
  // Returns an unsubscribe function so components can clean up on unmount.
  on: {
    hostStateChange: (cb) => {
      const listener = (_event, state) => cb(state);
      ipcRenderer.on('host:stateChange', listener);
      return () => ipcRenderer.removeListener('host:stateChange', listener);
    },
    controllerStateChange: (cb) => {
      const listener = (_event, state) => cb(state);
      ipcRenderer.on('controller:stateChange', listener);
      return () => ipcRenderer.removeListener('controller:stateChange', listener);
    },
    controllerJoinRequest: (cb) => {
      const listener = (_event, request) => cb(request);
      ipcRenderer.on('controller:joinRequest', listener);
      return () => ipcRenderer.removeListener('controller:joinRequest', listener);
    },
    pin: (cb) => {
      const listener = (_event, pin) => cb(pin);
      ipcRenderer.on('host:pin', listener);
      return () => ipcRenderer.removeListener('host:pin', listener);
    },
    agentStatus: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('agent:status', listener);
      return () => ipcRenderer.removeListener('agent:status', listener);
    },
    agentLog: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('agent:log', listener);
      return () => ipcRenderer.removeListener('agent:log', listener);
    },
    workflowRecordedStep: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('workflow:recordedStep', listener);
      return () => ipcRenderer.removeListener('workflow:recordedStep', listener);
    },
    workflowCreated: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('workflow:created', listener);
      return () => ipcRenderer.removeListener('workflow:created', listener);
    },
    workflowRecordingState: (cb) => {
      const listener = (_event, state) => cb(state);
      ipcRenderer.on('workflow:recordingState', listener);
      return () => ipcRenderer.removeListener('workflow:recordingState', listener);
    },
    error: (cb) => {
      const listener = (_event, message) => cb(message);
      ipcRenderer.on('app:error', listener);
      return () => ipcRenderer.removeListener('app:error', listener);
    },
    webrtcSignal: (cb) => {
      const listener = (_event, signal) => {
        cb(signal);
      };
      ipcRenderer.on('webrtc:signal', listener);
      return () => ipcRenderer.removeListener('webrtc:signal', listener);
    },
    captureMetadata: (cb) => {
      const listener = (_event, meta) => cb(meta);
      ipcRenderer.on('browser:captureMetadata', listener);
      return () => ipcRenderer.removeListener('browser:captureMetadata', listener);
    },
    windowTitle: (cb) => {
      const listener = (_event, title) => cb(title);
      ipcRenderer.on('browser:windowTitle', listener);
      return () => ipcRenderer.removeListener('browser:windowTitle', listener);
    },
    workflowRunStatus: (cb) => {
      const listener = (_event, status) => cb(status);
      ipcRenderer.on('workflow:runStatus', listener);
      return () => ipcRenderer.removeListener('workflow:runStatus', listener);
    },
    workflowStepStatus: (cb) => {
      const listener = (_event, status) => cb(status);
      ipcRenderer.on('workflow:stepStatus', listener);
      return () => ipcRenderer.removeListener('workflow:stepStatus', listener);
    },
    tabsChange: (cb) => {
      const listener = (_event, tabs) => cb(tabs);
      ipcRenderer.on('browser:tabsChange', listener);
      return () => ipcRenderer.removeListener('browser:tabsChange', listener);
    },
    screencastFrame: (cb) => {
      const listener = (_event, frameData) => cb(frameData);
      ipcRenderer.on('screencast:frame', listener);
      return () => ipcRenderer.removeListener('screencast:frame', listener);
    },
    agentCheckpoint: (cb) => {
      const listener = (_, payload) => cb(payload);
      ipcRenderer.on('browser:agentCheckpoint', listener);
      return () => ipcRenderer.removeListener('browser:agentCheckpoint', listener);
    },
    openSettings: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('app:openSettings', listener);
      return () => ipcRenderer.removeListener('app:openSettings', listener);
    },
    firstLaunch: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('browser:firstLaunch', listener);
      return () => ipcRenderer.removeListener('browser:firstLaunch', listener);
    },
    startLocalSession: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('app:startLocalSession', listener);
      return () => ipcRenderer.removeListener('app:startLocalSession', listener);
    },
    globalShortcut: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('app:globalShortcut', listener);
      return () => ipcRenderer.removeListener('app:globalShortcut', listener);
    },
    themeChanged: (cb) => {
      const listener = (_event, theme) => cb(theme);
      ipcRenderer.on('settings:themeChanged', listener);
      return () => ipcRenderer.removeListener('settings:themeChanged', listener);
    },
    agentStarted: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('agent:started', listener);
      return () => ipcRenderer.removeListener('agent:started', listener);
    },
    policyApprovalRequested: (cb) => {
      const listener = (_event, approval) => cb(approval);
      ipcRenderer.on('policy:approvalRequested', listener);
      return () => ipcRenderer.removeListener('policy:approvalRequested', listener);
    },
    policyAudit: (cb) => {
      const listener = (_event, event) => cb(event);
      ipcRenderer.on('policy:audit', listener);
      return () => ipcRenderer.removeListener('policy:audit', listener);
    },
  },
});
