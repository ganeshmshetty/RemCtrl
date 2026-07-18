// service-worker.js — RemoteCtrl Extension Background (Module, MV3)
//
// Architecture:
//   - Recording state lives in chrome.storage.session (survives SW restarts within browser session)
//   - Recorded workflow events are accumulated there
//   - On stop: compile → save to IndexedDB → sync to RemoteCtrl Desktop via WebSocket
//   - WebSocket auto-reconnects every 4s when desktop is offline

// ── IndexedDB ─────────────────────────────────────────────────────────────────
let _db = null;

function getDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open('RemoteCtrlExtDB', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('workflows', { keyPath: 'id' });
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

async function dbSaveWorkflow(wf) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workflows', 'readwrite');
    tx.objectStore('workflows').put(wf);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbListWorkflows() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workflows', 'readonly');
    const req = tx.objectStore('workflows').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Session Storage (Recording State) ────────────────────────────────────────
// Using chrome.storage.session so state survives service-worker restarts within a session

async function getRecState() {
  const data = await chrome.storage.session.get('recState');
  return data.recState || { isRecording: false, workflowName: '', startUrl: '', tabId: null, events: [] };
}

async function setRecState(state) {
  await chrome.storage.session.set({ recState: state });
}

// ── WebSocket Bridge to RemoteCtrl Desktop ────────────────────────────────────
const WS_URL = 'ws://127.0.0.1:45456';
let ws = null;
let isConnected = false;
let reconnectTimer = null;

function connectDesktop() {
  if (typeof WebSocket === 'undefined') {
    isConnected = false;
    broadcastConnectionState();
    return;
  }

  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return; // 0: CONNECTING, 1: OPEN
  clearTimeout(reconnectTimer);

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      isConnected = true;
      broadcastConnectionState();
      void syncPendingWorkflows();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'SYNC_SUCCESS' && msg.workflowId) {
          void updateSyncState(msg.workflowId, 'synced');
        } else if (msg.type === 'SYNC_ERROR' && msg.requestId) {
          void updateSyncState(msg.requestId, 'pending', msg.error || 'Desktop could not import this workflow.');
        }
        // Relay desktop messages to popup if open
        chrome.runtime.sendMessage({ type: 'DESKTOP_MSG', payload: msg }).catch(() => {});
      } catch (_) {}
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      isConnected = false;
      ws = null;
      broadcastConnectionState();
      reconnectTimer = setTimeout(connectDesktop, 4000);
    };
  } catch (err) {
    isConnected = false;
    ws = null;
    reconnectTimer = setTimeout(connectDesktop, 4000);
  }
}

function broadcastConnectionState() {
  chrome.runtime.sendMessage({ type: 'CONN_STATE', isConnected }).catch(() => {});
}

function sendToDesktop(msg) {
  if (typeof WebSocket !== 'undefined' && ws && ws.readyState === 1) { // 1 = OPEN
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch (_) {}
  }
  return false;
}

async function updateSyncState(id, syncState, lastSyncError = undefined) {
  const workflows = await dbListWorkflows();
  const workflow = workflows.find((item) => item.id === id);
  if (!workflow) return;
  await dbSaveWorkflow({ ...workflow, syncState, lastSyncError, updatedAt: Date.now() });
}

function sendWorkflowImport(workflow) {
  return sendToDesktop({
    type: 'EXT_SAVE_RECORDED_WORKFLOW',
    payload: {
      id: workflow.id,
      requestId: workflow.id,
      name: workflow.name,
      steps: workflow.steps,
      description: workflow.description,
    },
  });
}

async function syncPendingWorkflows() {
  const workflows = await dbListWorkflows();
  for (const workflow of workflows) {
    if (workflow.syncState !== 'synced') sendWorkflowImport(workflow);
  }
}

connectDesktop();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId() {
  return crypto.randomUUID();
}

function replayableSelector(event) {
  const selector = event.automation?.selector;
  // A tag name, generic placeholder, or XPath fallback is not a dependable
  // Playwright target. Imports should omit uncertain actions rather than replay
  // them against the wrong element.
  if (!selector || selector === 'element' || /^[a-z][a-z0-9-]*$/i.test(selector)) return null;
  return selector;
}

/**
 * Compile raw recorded events into clean LocalWorkflow steps
 */
function compileSteps(events, startUrl) {
  const steps = [];
  let stepNum = 0;

  if (startUrl) {
    steps.push({
      id: `step-${++stepNum}`,
      type: 'navigate',
      url: startUrl,
      description: `Open ${startUrl}`,
      onFailure: 'stop',
    });
  }

  for (const ev of events) {
    const id = `step-${++stepNum}`;

    if (ev.event === 'page_visit' || ev.event === 'navigation') {
      if (ev.url && ev.url !== startUrl) {
        steps.push({ id, type: 'navigate', url: ev.url, description: `Open ${ev.url}`, onFailure: 'stop' });
      }
    } else if (ev.event === 'click') {
      const sel = replayableSelector(ev);
      if (!sel) continue;
      const text = ev.raw?.text ? ` "${ev.raw.text.slice(0, 40)}"` : '';
      steps.push({ id, type: 'click', selector: sel, description: `Click${text}`, onFailure: 'self_heal' });
    } else if (ev.event === 'input') {
      const sel = replayableSelector(ev);
      if (!sel) continue;
      const val = ev.raw?.value || '';
      const field = ev.raw?.fieldName || sel;
      if (!ev.raw?.sensitive && val !== '[MASKED]' && val !== '[REQUIRES_USER_INPUT]') {
        steps.push({
          id,
          type: 'fill',
          selector: sel,
          value: val,
          description: `Fill ${field}`,
          onFailure: 'self_heal',
          postcondition: { kind: 'field_value', selector: sel, value: val },
        });
      }
    }
  }

  return steps;
}

// ── Message Router ────────────────────────────────────────────────────────────
let recEventQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    // ── Connection status query
    if (msg.action === 'GET_STATE') {
      const recState = await getRecState();
      // Popups need the complete state; content scripts must only ever see the
      // recording flag for the single tab the user explicitly selected.
      const scopedState = _sender.tab
        ? { ...recState, isRecording: recState.isRecording && recState.tabId === _sender.tab.id }
        : recState;
      sendResponse({ isConnected, recState: scopedState });
      return;
    }

    // ── Start Recording
    if (msg.action === 'START_RECORDING') {
      const newState = {
        isRecording: true,
        workflowName: msg.workflowName || `Workflow ${new Date().toLocaleDateString()}`,
        startUrl: msg.startUrl || '',
        tabId: msg.tabId ?? null,
        events: []
      };
      await setRecState(newState);

      if (newState.tabId) {
        chrome.tabs.sendMessage(newState.tabId, { action: 'SET_RECORDING', isRecording: true }).catch(() => {});
      }

      sendResponse({ ok: true });
      return;
    }

    // ── Stop Recording
    if (msg.action === 'STOP_RECORDING') {
      const recState = await getRecState();
      if (!recState.isRecording) {
        sendResponse({ ok: false, error: 'Not recording' });
        return;
      }

      // Mark stopped first
      const stoppedState = { ...recState, isRecording: false };
      await setRecState(stoppedState);

      if (recState.tabId) {
        chrome.tabs.sendMessage(recState.tabId, { action: 'SET_RECORDING', isRecording: false }).catch(() => {});
      }

      // Compile steps
      const events = recState.events || [];
      let startUrl = recState.startUrl || '';
      if (!startUrl && events.length > 0) {
        startUrl = events.find(e => e.event === 'page_visit' || e.event === 'navigation')?.url || events[0]?.url || '';
      }

      const steps = compileSteps(events, startUrl);
      const now = Date.now();
      const workflow = {
        id: generateId(),
        name: recState.workflowName,
        startUrl,
        steps,
        eventCount: events.length,
        createdAt: now,
        updatedAt: now,
        source: 'chrome_ext',
        syncState: 'pending',
      };

      // Save locally
      await dbSaveWorkflow(workflow);

      // A socket write is not a sync. Desktop acknowledges the durable import.
      const queuedForSync = steps.length > 0 && sendWorkflowImport(workflow);

      sendResponse({ ok: steps.length > 0, workflow, queuedForSync, error: steps.length ? undefined : 'No replayable steps were recorded.' });
      return;
    }

    // ── Record Event (from content script)
    if (msg.action === 'RECORD_EVENT') {
      recEventQueue = recEventQueue.then(async () => {
        const recState = await getRecState();
        if (!recState.isRecording || !recState.tabId || _sender.tab?.id !== recState.tabId) {
          sendResponse({ ok: false });
          return;
        }
        const updated = { ...recState, events: [...recState.events, msg.event] };
        await setRecState(updated);
        sendResponse({ ok: true, count: updated.events.length });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return;
    }

    // ── List Workflows (from popup)
    if (msg.action === 'LIST_WORKFLOWS') {
      const workflows = await dbListWorkflows();
      workflows.sort((a, b) => b.createdAt - a.createdAt);
      sendResponse({ ok: true, workflows });
      return;
    }

    sendResponse({ ok: false, error: 'Unknown action' });
  })();

  return true; // keep sendResponse channel open
});
