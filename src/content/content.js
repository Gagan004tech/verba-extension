// src/content/content.js
// P3 — Web Interactions & Execution (Module C/D)
//
// Same content as the standalone W1 harness, now living inside the
// real repo. Message routing goes through P1's real service worker
// instead of the throwaway mock-broker.js — delete that file from
// your local dev setup, it's no longer needed.
//
// TODO (W2/W3/W4) — see scanFieldsStub / fillFieldStub below.

(function () {
  'use strict';

  const MESSAGE_TYPES = {
    PING: 'PING',
    SCAN_FIELDS: 'SCAN_FIELDS',
    FILL_FIELD: 'FILL_FIELD',
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
      return false;
    }

    switch (message.type) {
      case MESSAGE_TYPES.PING:
        sendResponse({ ok: true, from: 'content-script', url: location.href });
        return false;

      case MESSAGE_TYPES.SCAN_FIELDS:
        // TODO (W2/W3): replace with real scanner + weighted labels
        sendResponse({ ok: true, fields: scanFieldsStub() });
        return false;

      case MESSAGE_TYPES.FILL_FIELD:
        // TODO (W4): replace with native-value injector
        sendResponse(fillFieldStub(message.payload));
        return false;

      default:
        return false;
    }
  });

  function scanFieldsStub() {
    const inputs = document.querySelectorAll('input, select, textarea');
    return Array.from(inputs).map((el, i) => ({
      id: el.id || `field-${i}`,
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      label: null, // TODO: weighted label generator (W3)
    }));
  }

  function fillFieldStub(payload) {
    if (!payload || !payload.selector || payload.value === undefined) {
      return { ok: false, error: 'missing selector or value' };
    }
    const el = document.querySelector(payload.selector);
    if (!el) return { ok: false, error: 'element not found' };

    // NOTE: direct assignment only works on plain HTML forms. The
    // native setter override (W4) is needed for React/Angular inputs.
    el.value = payload.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
  }

  chrome.runtime.sendMessage(
    { type: 'CONTENT_SCRIPT_READY', url: location.href },
    () => {
      if (chrome.runtime.lastError) {
        // Expected until the broker has a case for this message type,
        // or if nobody's listening yet — safe to ignore.
      }
    }
  );
})();