// popup.js — RemoteCtrl Extension Popup Controller

// ── DOM refs ──────────────────────────────────────────────────────────────────
const connBadge       = document.getElementById('connBadge');
const connText        = document.getElementById('connText');
const tabRecord       = document.getElementById('tabRecord');
const tabWorkflows    = document.getElementById('tabWorkflows');
const paneRecord      = document.getElementById('paneRecord');
const paneWorkflows   = document.getElementById('paneWorkflows');

const idleView       = document.getElementById('idleView');
const activeView     = document.getElementById('activeView');
const wfNameInput    = document.getElementById('wfNameInput');
const startRecBtn    = document.getElementById('startRecBtn');
const stopRecBtn     = document.getElementById('stopRecBtn');
const recCount       = document.getElementById('recCount');
const stepsFeed      = document.getElementById('stepsFeed');
const recFeedback    = document.getElementById('recFeedback');

const wfList         = document.getElementById('wfList');
const refreshWfBtn   = document.getElementById('refreshWfBtn');

const toastEl        = document.getElementById('toast');

// ── State ─────────────────────────────────────────────────────────────────────
let pollTimer = null;

// ── Tab Nav ───────────────────────────────────────────────────────────────────
function setTab(tab) {
  [tabRecord, tabWorkflows].forEach(t => t.classList.remove('active'));
  [paneRecord, paneWorkflows].forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  
  if (tab.id === 'tabRecord') paneRecord.classList.add('active');
  else paneWorkflows.classList.add('active');
}

tabRecord.addEventListener('click',    () => setTab(tabRecord));
tabWorkflows.addEventListener('click', () => { setTab(tabWorkflows); loadWorkflows(); });
refreshWfBtn.addEventListener('click', () => loadWorkflows());

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, duration = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ── Feedback ──────────────────────────────────────────────────────────────────
function showFeedback(el, msg, type = 'ok', autoClear = 4000) {
  el.textContent = msg;
  el.className = `feedback ${type}`;
  if (autoClear) {
    setTimeout(() => { el.className = 'feedback'; }, autoClear);
  }
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ── Connection & Initial State ────────────────────────────────────────────────
async function syncState() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    updateConnBadge(res.isConnected, res.recState?.isRecording);
    if (res.recState?.isRecording) {
      showActiveRecording(res.recState);
    } else {
      showIdleRecording();
    }
  });
}

function updateConnBadge(connected, recording) {
  if (recording) {
    connBadge.className = 'conn-badge recording-badge';
    connText.textContent = 'Recording';
  } else if (connected) {
    connBadge.className = 'conn-badge on';
    connText.textContent = 'Connected';
  } else {
    connBadge.className = 'conn-badge';
    connText.textContent = 'Offline';
  }
}

// Listen for broadcasts from service worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CONN_STATE') {
    updateConnBadge(msg.isConnected, false);
    return;
  }
  if (msg.type === 'DESKTOP_MSG') {
    const desktop = msg.payload || {};
    if (desktop.type === 'SYNC_SUCCESS') {
      showFeedback(recFeedback, 'Imported into RemoteCtrl. Review it in the app before running.', 'ok', 7000);
      loadWorkflows();
    } else if (desktop.type === 'SYNC_ERROR') {
      showFeedback(recFeedback, desktop.error || 'RemoteCtrl could not import this recording.', 'err', 7000);
    }
  }
});

// ── Recording SVG Icons (Clean Developer Tooling) ────────────────────────────
function stepIcon(ev) {
  if (!ev) return '';
  if (ev.event === 'click') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;
  }
  if (ev.event === 'input') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M18 12h.01M7 16h10M10 12h.01M14 12h.01"/></svg>`;
  }
  if (ev.event === 'navigation' || ev.event === 'page_visit') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>`;
  }
  return '•';
}

function stepDesc(ev) {
  if (!ev) return '';
  if (ev.event === 'click') {
    return `Click ${ev.raw?.text ? `"${ev.raw.text.slice(0, 40)}"` : (ev.automation?.selector || 'element')}`;
  }
  if (ev.event === 'input') {
    if (ev.raw?.sensitive) return `Skipped a sensitive value in ${ev.raw?.fieldName || 'a field'}`;
    return `Type "${(ev.raw?.value || '').slice(0, 30)}" into ${ev.raw?.fieldName || ev.automation?.selector || 'field'}`;
  }
  if (ev.event === 'navigation' || ev.event === 'page_visit') {
    return `Navigate to ${ev.url || ''}`;
  }
  return JSON.stringify(ev).slice(0, 60);
}

function showIdleRecording() {
  idleView.style.display = 'flex';
  idleView.style.flexDirection = 'column';
  idleView.style.gap = '12px';
  activeView.style.display = 'none';
  stopPolling();
}

function showActiveRecording(recState) {
  idleView.style.display = 'none';
  activeView.style.display = 'flex';
  updateStepsFeed(recState.events || []);
  startPolling();
}

// ── Recording: polling for live updates ──────────────────────────────────────
function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollRecState, 800);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function pollRecState() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    if (res.recState?.isRecording) {
      updateConnBadge(res.isConnected, true);
      updateStepsFeed(res.recState.events || []);
    } else {
      showIdleRecording();
    }
  });
}

function updateStepsFeed(events) {
  recCount.textContent = `${events.length} action${events.length !== 1 ? 's' : ''}`;

  if (events.length === 0) {
    stepsFeed.innerHTML = '<div class="steps-empty">Perform clicks or typings on the webpage to record steps…</div>';
    return;
  }

  // Show last 20 events, newest at bottom
  const toShow = events.slice(-20);
  stepsFeed.innerHTML = toShow.map((ev, i) => `
    <div class="step-row">
      <span class="step-num">#${events.length - toShow.length + i + 1}</span>
      <span class="step-icon-wrapper">${stepIcon(ev)}</span>
      <span class="step-text" title="${esc(stepDesc(ev))}">${esc(stepDesc(ev))}</span>
    </div>
  `).join('');

  // Auto-scroll to bottom
  stepsFeed.scrollTop = stepsFeed.scrollHeight;
}

// ── Recording: start ─────────────────────────────────────────────────────────
startRecBtn.addEventListener('click', async () => {
  const name = wfNameInput.value.trim() || `Workflow ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const startUrl = tabs?.[0]?.url || '';

  startRecBtn.disabled = true;
  chrome.runtime.sendMessage({ action: 'START_RECORDING', workflowName: name, startUrl, tabId: tabs?.[0]?.id }, (res) => {
    startRecBtn.disabled = false;
    if (res?.ok) {
      wfNameInput.value = '';
      showActiveRecording({ events: [] });
      updateConnBadge(true, true);
    } else {
      showFeedback(recFeedback, 'Could not start recording.', 'err');
    }
  });
});

// ── Recording: stop ───────────────────────────────────────────────────────────
stopRecBtn.addEventListener('click', () => {
  stopRecBtn.disabled = true;
  chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }, (res) => {
    stopRecBtn.disabled = false;
    showIdleRecording();
    syncState();

    if (res?.ok && res.workflow) {
      const wf = res.workflow;
      const msg = res.queuedForSync
        ? `Saved "${wf.name}" (${wf.steps?.length || 0} steps). Importing into RemoteCtrl…`
        : `Saved "${wf.name}" locally. RemoteCtrl will import it when connected.`;
      showFeedback(recFeedback, msg, 'ok', 7000);
      loadWorkflows();
    } else {
      showFeedback(recFeedback, res?.error || 'Recording saved locally.', 'err');
    }
  });
});

// ── Saved Workflows ───────────────────────────────────────────────────────────
function loadWorkflows() {
  chrome.runtime.sendMessage({ action: 'LIST_WORKFLOWS' }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      wfList.innerHTML = '<div class="wf-empty"><div class="wf-empty-icon">⚠️</div>Failed to load workflows</div>';
      return;
    }

    const workflows = res.workflows || [];
    if (workflows.length === 0) {
      wfList.innerHTML = `
        <div class="wf-empty">
          <div class="wf-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17h6M9 13h6M9 9h1"/></svg>
          </div>
          No saved workflows yet
        </div>
      `;
      return;
    }

    wfList.innerHTML = workflows.map(wf => {
      const date = new Date(wf.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const stepCount = wf.steps?.length || wf.eventCount || 0;
      return `
        <div class="wf-item">
          <div class="wf-info">
            <div class="wf-name" title="${esc(wf.name)}">${esc(wf.name)}</div>
            <div class="wf-meta">${stepCount} steps · ${date}</div>
          </div>
          <span class="wf-meta">Review in RemoteCtrl</span>
        </div>
      `;
    }).join('');

  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
syncState();
