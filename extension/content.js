// content.js — RemoteCtrl Recording Content Script
// Captures clicks, inputs, and navigations during active recording sessions.
// Uses same NoiseReducer pattern as reference autopattern extension.

(function () {
  'use strict';

  // Guard: inject only once per page
  if (window.__remoteCtrlRecorderAttached) return;
  window.__remoteCtrlRecorderAttached = true;

  let isRecording = false;
  let inputTimer = null;

  // ── Selector Builder ─────────────────────────────────────────────────────────
  function getSelector(el) {
    if (!el || !el.tagName) return null;
    const esc = (val) => (window.CSS && CSS.escape ? CSS.escape(val) : val.replace(/["\\]/g, '\\$&'));
    // Prefer stable IDs/data-testid
    if (el.id && !el.id.match(/^\d|[^a-zA-Z0-9_-]/)) return `#${el.id}`;
    if (el.getAttribute('data-testid')) return `[data-testid="${esc(el.getAttribute('data-testid'))}"]`;
    if (el.getAttribute('aria-label')) return `${el.tagName.toLowerCase()}[aria-label="${esc(el.getAttribute('aria-label'))}"]`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${esc(el.name)}"]`;
    // Fallback: tag + first class
    const cls = el.className && typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).find(c => c && !c.includes(':') && !c.match(/\d{3,}/))
      : null;
    return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
  }

  function getXPath(el) {
    if (!el || el.nodeType !== 1) return null;
    let path = '';
    let node = el;
    while (node && node.nodeType === 1) {
      let idx = 1;
      let sib = node.previousSibling;
      while (sib) {
        if (sib.nodeType === 1 && sib.nodeName === node.nodeName) idx++;
        sib = sib.previousSibling;
      }
      path = `/${node.nodeName.toLowerCase()}[${idx}]` + path;
      node = node.parentNode;
    }
    return path;
  }

  // ── Event Sender ─────────────────────────────────────────────────────────────
  function send(event) {
    if (!isRecording) return;
    try {
      chrome.runtime.sendMessage({ action: 'RECORD_EVENT', event }, (res) => {
        if (chrome.runtime.lastError) { /* extension context lost, ignore */ }
      });
    } catch (_) { /* extension unloaded */ }
  }

  // ── Navigation Reporting Helper & Interceptors ──────────────────────────────
  function reportNavigation() {
    send({ event: 'navigation', url: location.href, title: document.title, timestamp: Date.now() });
  }

  const origPush = history.pushState.bind(history);
  history.pushState = function (...args) {
    origPush(...args);
    reportNavigation();
  };
  const origReplace = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    origReplace(...args);
    reportNavigation();
  };
  window.addEventListener('popstate', reportNavigation);

  // ── Click Capture ─────────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    if (!isRecording) return;
    const rawTarget = e.target;
    const el = rawTarget?.closest?.('button, a, input, select, textarea, [role="button"], [role="link"]') || rawTarget;
    const tag = el?.tagName?.toLowerCase();
    // Skip invisible elements and trivial containers
    if (!tag || ['html', 'body', 'script', 'style'].includes(tag)) return;

    send({
      event: 'click',
      timestamp: Date.now(),
      url: location.href,
      automation: {
        selector: getSelector(el),
        xpath: getXPath(el),
        tag,
        inputType: el.getAttribute?.('type') || null
      },
      raw: {
        text: (el.innerText || el.value || el.getAttribute?.('aria-label') || '').trim().slice(0, 80)
      }
    });
  }, true);

  // ── Input Capture (debounced 350ms) ───────────────────────────────────────────
  document.addEventListener('input', (e) => {
    if (!isRecording) return;
    const el = e.target;
    const tag = el?.tagName?.toLowerCase();
    if (!tag || !['input', 'textarea', 'select'].includes(tag)) return;

    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      const fieldIdentifier = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('autocomplete')]
        .filter(Boolean).join(' ');
      const isPassword = el.type === 'password' || el.getAttribute('autocomplete') === 'current-password';
      const isCreditCard = el.getAttribute('autocomplete')?.includes('cc') || /card|cvv|cvc/i.test(fieldIdentifier);
      const isSecret = /otp|one[- ]?time|verification|access.?code|token|secret|api.?key|recovery/i.test(fieldIdentifier);
      const rawVal = el.value || '';
      const isSensitive = isPassword || isCreditCard || isSecret;
      const recordedValue = isSensitive ? '[REQUIRES_USER_INPUT]' : rawVal;

      send({
        event: 'input',
        timestamp: Date.now(),
        url: location.href,
        automation: {
          selector: getSelector(el),
          xpath: getXPath(el),
          tag,
          inputType: el.type || null
        },
        raw: {
          value: recordedValue,
          fieldName: el.name || el.id || el.placeholder || el.getAttribute('aria-label') || null,
          length: rawVal.length,
          sensitive: isSensitive,
        }
      });
    }, 350);
  }, true);

  // ── Listen for recording state changes from background ────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'SET_RECORDING') {
      isRecording = msg.isRecording;
    }
  });

  // ── Init: ask background for current state ────────────────────────────────────
  try {
    chrome.runtime.sendMessage({ action: 'GET_STATE' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.recState?.isRecording) {
        isRecording = true;
        if (!window.__remoteCtrlPageVisited) {
          window.__remoteCtrlPageVisited = true;
          send({
            event: 'page_visit',
            url: location.href,
            title: document.title,
            timestamp: Date.now()
          });
        }
      }
    });
  } catch (_) {}

})();
