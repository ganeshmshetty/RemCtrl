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

async function dbDeleteWorkflow(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workflows', 'readwrite');
    tx.objectStore('workflows').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Session Storage (Recording State) ────────────────────────────────────────
// Using chrome.storage.session so state survives service-worker restarts within a session

async function getRecState() {
  const data = await chrome.storage.session.get('recState');
  return data.recState || { isRecording: false, workflowName: '', startUrl: '', events: [] };
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
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
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

connectDesktop();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId() {
  return crypto.randomUUID();
}

/**
 * Compile raw recorded events into clean LocalWorkflow steps
 */
function compileSteps(events, startUrl) {
  const steps = [];
  let stepNum = 0;

  for (const ev of events) {
    stepNum++;
    const id = `step-${stepNum}`;

    if (ev.event === 'page_visit' || ev.event === 'navigation') {
      steps.push({ id, action: 'navigate', url: ev.url, description: `Navigate to ${ev.url}` });
    } else if (ev.event === 'click') {
      const sel = ev.automation?.selector || ev.automation?.xpath || ev.automation?.tag || 'element';
      const text = ev.raw?.text ? ` "${ev.raw.text.slice(0, 40)}"` : '';
      steps.push({ id, action: 'click', selector: sel, description: `Click${text}` });
    } else if (ev.event === 'input') {
      const sel = ev.automation?.selector || ev.automation?.xpath || ev.automation?.tag || 'input';
      const val = ev.raw?.value || '';
      const field = ev.raw?.fieldName || sel;
      steps.push({ id, action: 'input', selector: sel, value: val, description: `Type "${val}" into ${field}` });
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
      sendResponse({ isConnected, recState });
      return;
    }

    // ── Start Recording
    if (msg.action === 'START_RECORDING') {
      const newState = {
        isRecording: true,
        workflowName: msg.workflowName || `Workflow ${new Date().toLocaleDateString()}`,
        startUrl: msg.startUrl || '',
        events: []
      };
      await setRecState(newState);

      // Notify all content scripts
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (t.id) chrome.tabs.sendMessage(t.id, { action: 'SET_RECORDING', isRecording: true }).catch(() => {});
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

      // Notify content scripts
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (t.id) chrome.tabs.sendMessage(t.id, { action: 'SET_RECORDING', isRecording: false }).catch(() => {});
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
        source: 'recorded'
      };

      // Save locally
      await dbSaveWorkflow(workflow);

      // Sync to desktop if connected
      const synced = sendToDesktop({
        type: 'EXT_SAVE_RECORDED_WORKFLOW',
        payload: {
          id: workflow.id,
          name: workflow.name,
          startUrl: workflow.startUrl,
          steps: workflow.steps,
          description: `Recorded from browser — ${steps.length} steps`
        }
      });

      sendResponse({ ok: true, workflow, synced });
      return;
    }

    // ── Record Event (from content script)
    if (msg.action === 'RECORD_EVENT') {
      recEventQueue = recEventQueue.then(async () => {
        const recState = await getRecState();
        if (!recState.isRecording) {
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

    // ── Delete Workflow
    if (msg.action === 'DELETE_WORKFLOW') {
      await dbDeleteWorkflow(msg.id);
      sendResponse({ ok: true });
      return;
    }

    // ── Automate Page (send prompt to desktop)
    if (msg.action === 'AUTOMATE_PAGE') {
      const sent = sendToDesktop({
        type: 'EXT_START_AUTOMATION',
        payload: {
          url: msg.url,
          title: msg.title,
          instruction: msg.instruction
        }
      });
      if (sent) {
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'RemoteCtrl Desktop is not connected. Launch the desktop app first.' });
      }
      return;
    }

    // ── Run Saved Workflow via Desktop
    if (msg.action === 'RUN_WORKFLOW') {
      const sent = sendToDesktop({
        type: 'EXT_RUN_WORKFLOW',
        payload: { workflowId: msg.workflowId, name: msg.name }
      });
      sendResponse({ ok: sent, error: sent ? undefined : 'Desktop not connected.' });
      return;
    }

    sendResponse({ ok: false, error: 'Unknown action' });
  })();

  return true; // keep sendResponse channel open
});
