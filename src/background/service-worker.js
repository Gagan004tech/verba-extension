import { MESSAGE_TYPES, createMessage } from "../shared/message-types.js";
import { parseIntent } from "../nlu/intent-parser.js";
import { rankByJaroWinkler } from "../matching/jaro-winkler.js";

// Enable the side panel to open on action icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[VERBA] Error setting panel behavior:", error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("[VERBA] Extension installed & service worker active.");
});

// --- Content-script tab tracking (P3) ---------------------------------
// Content scripts announce themselves on load; we remember which tab(s)
// are ready so SCAN_FIELDS / FILL_FIELD have somewhere to go.
const readyTabs = new Set();
let lastReadyTabId = null;

function getTargetTabId() {
  if (lastReadyTabId) return lastReadyTabId;
  const [anyReady] = [...readyTabs];
  return anyReady ?? null;
}

// --- Message routing broker --------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.TRANSCRIPT_STREAM:
      console.log("[VERBA] Received transcript from UI:", payload.text);
      // Hand-off 3: passed to Module B (P2) below. Fire-and-forget - the
      // side panel doesn't wait on a response for this one.
      handleTranscript(payload.text);
      return false;

    case MESSAGE_TYPES.VAULT_FETCH:
      sendResponse({ status: "VAULT_READY" });
      return false;

    case MESSAGE_TYPES.CONTENT_SCRIPT_READY:
      if (sender.tab?.id) {
        readyTabs.add(sender.tab.id);
        lastReadyTabId = sender.tab.id;
        console.log(`[VERBA] Content script ready on tab ${sender.tab.id} (${payload?.url ?? message.url})`);
      }
      sendResponse({ ok: true });
      return false;

    case MESSAGE_TYPES.SPEAK_CONFIRMATION:
      // The side panel (src/sidepanel/index.js) already listens for this
      // broadcast directly and calls speakReadback() itself - the broker
      // doesn't need to do anything here. Nothing emits this yet: the
      // match payload's requiresConfirmation flag that's meant to trigger
      // it is Module C/D's Nov Week 3 handoff, not built in this repo.
      // This case exists purely so it doesn't fall through to "Unknown
      // message type" below.
      return false;

    default:
      console.warn("[VERBA] Unknown message type:", type);
      return false;
  }
});

/**
 * Module B entry point (P2): parse a transcript into an intent + slots,
 * then broadcast the result for the next stage of the pipeline.
 *
 * @param {string} text
 */
async function handleTranscript(text) {
  const result = await parseIntent(text);
  console.log("[VERBA][NLU] Parsed intent:", result);

  chrome.runtime
    .sendMessage(createMessage(MESSAGE_TYPES.INTENT_PARSED, { transcript: text, ...result }))
    .catch(() => {
      // No listener in the side panel right now - safe to ignore.
    });

  if (result.intent === "FILL_FIELD") {
    handleFillFieldIntent(result);
  }
}

/**
 * The missing link between P2's NLU output and P3's content script:
 * takes a parsed FILL_FIELD intent, asks the active tab's content script
 * to scan the page (Module C), ranks the returned fields against the
 * spoken field description with P2's Jaro-Winkler utility, and tells the
 * content script to fill the best match (Module D execution).
 *
 * This is a first-cut wiring of pieces that already exist, not the
 * "full-pipeline" integration the roadmap schedules for Nov Week 4:
 *  - content.js's scanFieldsStub doesn't build real labels yet (its own
 *    TODO says "weighted label generator (W3)"), so matching falls back
 *    to each field's `id` attribute. Fields with no native `id` fall back
 *    to a synthetic "field-N" label that isn't a real selector, so they
 *    can't be targeted by FILL_FIELD yet - that's a gap in the stub
 *    scanner itself, not something patched over here.
 *  - "from my profile" commands (slots.profileKey set) are intentionally
 *    skipped below: vault.js only has encrypt()/decrypt(), no
 *    save/retrieve wired to chrome.storage yet, so there's no vault value
 *    to fetch.
 *  - The semantic embedding matcher and the CONFIRM/CANCEL safety gate
 *    aren't wired in here either, for the same reason - fuse those in
 *    once P3's real scanner and the confirmation flow land.
 *
 * @param {{slots: {field: string, value: string|null, profileKey: string|null}}} result
 */
async function handleFillFieldIntent(result) {
  const { field, value, profileKey } = result.slots || {};

  if (profileKey) {
    console.warn(
      `[VERBA] "${field}" resolved to profile key "${profileKey}", but the vault has no ` +
        "storage-backed save/retrieve yet - skipping until that's wired up."
    );
    return;
  }
  if (!field || !value) {
    console.warn("[VERBA] FILL_FIELD intent missing a field or value:", result);
    return;
  }

  const tabId = getTargetTabId();
  if (!tabId) {
    console.warn("[VERBA] No content script has registered yet - can't scan or fill.");
    return;
  }

  chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.SCAN_FIELDS }, (scanResponse) => {
    if (chrome.runtime.lastError) {
      return console.warn("[VERBA] SCAN_FIELDS failed:", chrome.runtime.lastError.message);
    }
    const fields = scanResponse?.fields || [];
    console.log(`[VERBA] SCAN_FIELDS found ${fields.length} field(s):`, fields);
    if (fields.length === 0) {
      return console.warn("[VERBA] SCAN_FIELDS returned no fields.");
    }

    const candidateLabels = fields.map((f) => f.label || f.id);
    const ranked = rankByJaroWinkler(field, candidateLabels);
    console.log(`[VERBA] Jaro-Winkler ranking for "${field}":`, ranked);
    const best = ranked[0];

    // Provisional threshold, same order of magnitude as the zero-shot
    // classifier's - there's no tuned value for this yet since it's
    // matching against synthetic id-based labels, not real page labels.
    if (!best || best.score < 0.55) {
      return console.warn(`[VERBA] No confident field match for "${field}". Best guess:`, best);
    }

    const matchedField = fields.find((f) => (f.label || f.id) === best.label);
    if (!matchedField?.id) {
      return console.warn("[VERBA] Matched field has no usable id/selector:", matchedField);
    }

    console.log(`[VERBA] Filling "#${matchedField.id}" with "${value}" (score ${best.score.toFixed(2)})`);
    requestFill(`#${matchedField.id}`, value, tabId);
  });
}

// --- Outbound helpers: background → content script (P3) ---------------
// SCAN_FIELDS / FILL_FIELD flow the opposite direction from the cases
// above - background calls the content script, not the reverse - so
// they're functions here rather than switch cases. Callable directly
// from this service worker's own DevTools console for manual testing.

function requestScan(tabId = getTargetTabId()) {
  if (!tabId) return console.warn("[VERBA] No content script has registered yet.");
  chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.SCAN_FIELDS }, (response) => {
    if (chrome.runtime.lastError) return console.warn("[VERBA] SCAN_FIELDS failed:", chrome.runtime.lastError.message);
    console.log("[VERBA] SCAN_FIELDS response:", response);
  });
}

function requestFill(selector, value, tabId = getTargetTabId()) {
  if (!tabId) return console.warn("[VERBA] No content script has registered yet.");
  chrome.tabs.sendMessage(
    tabId,
    { type: MESSAGE_TYPES.FILL_FIELD, payload: { selector, value } },
    (response) => {
      if (chrome.runtime.lastError) return console.warn("[VERBA] FILL_FIELD failed:", chrome.runtime.lastError.message);
      console.log("[VERBA] FILL_FIELD response:", response);
    }
  );
}

// expose for manual testing in the service-worker DevTools console
self.requestScan = requestScan;
self.requestFill = requestFill;