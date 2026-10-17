import { MESSAGE_TYPES, createMessage } from "../shared/message-types.js";
import { parseIntents, parseIntent } from "../nlu/intent-parser.js";
import { rankFieldsFused, rankFieldsFast, MATCH_THRESHOLD } from "../matching/fused-matcher.js";

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

// --- Safety Confirmation Gate State (Month 2) --------------------------
// Intercepts sensitive fills and submit actions, speaks a prompt, and waits
// for spoken "yes/confirm" or "no/cancel" before proceeding.
let pendingConfirmation = null;

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

    case MESSAGE_TYPES.FIELDS_CHANGED:
      // P3 (W4): content.js's MutationObserver saw the page's fields change.
      console.log(`[VERBA] Page fields changed on tab ${sender.tab?.id}: ${payload?.count} fillable field(s)`);
      return false;

    case MESSAGE_TYPES.SPEAK_CONFIRMATION:
      // The side panel listens for this broadcast directly and calls speakReadback().
      return false;

    default:
      console.warn("[VERBA] Unknown message type:", type);
      return false;
  }
});

/**
 * Module B entry point (P2): parse transcript into intents + slots,
 * supports compound commands ("fill name as Alex and click submit"),
 * and dispatches each intent sequentially through the full pipeline.
 *
 * @param {string} text
 */
async function handleTranscript(text) {
  const intentResults = await parseIntents(text);
  console.log(`[VERBA][NLU] Parsed ${intentResults.length} intent(s):`, intentResults);

  for (const result of intentResults) {
    chrome.runtime
      .sendMessage(createMessage(MESSAGE_TYPES.INTENT_PARSED, { transcript: text, ...result }))
      .catch(() => {
        // Safe to ignore if side panel listener is not yet open
      });

    await dispatchIntent(result, text);
  }
}

/**
 * Dispatches an individual parsed intent through the pipeline.
 *
 * @param {{ intent: string, confidence: number, source: string, slots: object }} result
 * @param {string} rawTranscript
 */
async function dispatchIntent(result, rawTranscript) {
  const { intent, slots } = result;

  // 1. Check Confirmation Gate State
  if (pendingConfirmation) {
    if (intent === "CONFIRM") {
      console.log("[VERBA][Gate] User confirmed action:", pendingConfirmation.action);
      const actionToExecute = pendingConfirmation;
      pendingConfirmation = null;

      chrome.runtime
        .sendMessage(createMessage(MESSAGE_TYPES.CONFIRMATION_RESOLVED, { status: "confirmed", action: actionToExecute.action }))
        .catch(() => {});

      chrome.runtime
        .sendMessage(createMessage(MESSAGE_TYPES.SPEAK_CONFIRMATION, { text: "Action confirmed. Proceeding." }))
        .catch(() => {});

      if (actionToExecute.action === "SUBMIT") {
        requestAction({ action: "SUBMIT" }, actionToExecute.tabId);
      } else if (actionToExecute.action === "FILL_FIELD") {
        requestFill(actionToExecute.selector, actionToExecute.value, actionToExecute.tabId);
      }
      return;
    }

    if (intent === "CANCEL") {
      console.log("[VERBA][Gate] User cancelled action:", pendingConfirmation.action);
      pendingConfirmation = null;

      chrome.runtime
        .sendMessage(createMessage(MESSAGE_TYPES.CONFIRMATION_RESOLVED, { status: "cancelled" }))
        .catch(() => {});

      chrome.runtime
        .sendMessage(createMessage(MESSAGE_TYPES.SPEAK_CONFIRMATION, { text: "Action cancelled." }))
        .catch(() => {});
      return;
    }
  }

  // 2. Intercept sensitive / final actions via Confirmation Gate
  if (intent === "SUBMIT") {
    const tabId = getTargetTabId();
    pendingConfirmation = { action: "SUBMIT", tabId, timestamp: Date.now() };

    chrome.runtime
      .sendMessage(
        createMessage(MESSAGE_TYPES.SPEAK_CONFIRMATION, {
          text: "Are you sure you want to submit the form? Say yes to confirm, or no to cancel.",
        })
      )
      .catch(() => {});

    chrome.runtime
      .sendMessage(createMessage(MESSAGE_TYPES.CONFIRMATION_REQUIRED, { action: "SUBMIT" }))
      .catch(() => {});
    return;
  }

  // 3. Form field fill
  if (intent === "FILL_FIELD") {
    await handleFillFieldIntent(result);
    return;
  }

  // 4. In-page click
  if (intent === "CLICK") {
    requestAction({ action: "CLICK", target: slots.target });
    return;
  }

  // 5. Scroll commands
  if (intent.startsWith("SCROLL_")) {
    requestAction({ action: intent });
    return;
  }

  // 6. Form reset / clear
  if (intent === "RESET_FORM") {
    requestAction({ action: "RESET_FORM" });
    return;
  }

  if (intent === "CLEAR_FIELD") {
    // Clear targeted field
    const tabId = getTargetTabId();
    if (tabId && slots.field) {
      chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.SCAN_FIELDS }, async (scanResponse) => {
        const fields = scanResponse?.fields || [];
        const ranked = rankFieldsFast(slots.field, fields, { threshold: MATCH_THRESHOLD });
        if (ranked.length > 0 && ranked[0].isConfident) {
          requestFill(ranked[0].field.selector, "", tabId);
        }
      });
    }
    return;
  }
}

/**
 * Executes a parsed FILL_FIELD intent:
 * Asks content script to scan the page (Module C),
 * ranks fields using P2's Fused Matching Engine (synonym + Jaro-Winkler + semantic),
 * and dispatches value injection (Module D).
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

  chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.SCAN_FIELDS }, async (scanResponse) => {
    if (chrome.runtime.lastError) {
      return console.warn("[VERBA] SCAN_FIELDS failed:", chrome.runtime.lastError.message);
    }
    const fields = scanResponse?.fields || [];
    console.log(`[VERBA] SCAN_FIELDS found ${fields.length} field(s):`, fields);
    if (fields.length === 0) {
      return console.warn("[VERBA] SCAN_FIELDS returned no fields.");
    }

    // Fused matching: combines custom synonym dictionary, Jaro-Winkler lexical
    // similarity, and semantic embeddings via Transformers.js
    let ranked;
    try {
      ranked = await rankFieldsFused(field, fields, { threshold: MATCH_THRESHOLD });
    } catch (err) {
      console.warn("[VERBA] Fallback to fast synchronous matching:", err);
      ranked = rankFieldsFast(field, fields, { threshold: MATCH_THRESHOLD });
    }

    console.log(
      `[VERBA] Fused field ranking for "${field}":`,
      ranked.slice(0, 5).map((r) => ({
        label: r.label,
        score: +r.score.toFixed(3),
        breakdown: r.breakdown,
        selector: r.field.selector,
      }))
    );

    const best = ranked[0];

    if (!best || !best.isConfident) {
      return console.warn(`[VERBA] No confident field match for "${field}". Best guess:`, best);
    }

    const matchedField = best.field;
    if (!matchedField.selector) {
      return console.warn("[VERBA] Matched field has no selector:", matchedField);
    }

    console.log(`[VERBA] Filling ${matchedField.selector} ("${best.label}") with "${value}" (score ${best.score.toFixed(3)})`);
    requestFill(matchedField.selector, value, tabId);
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

function requestAction(payload, tabId = getTargetTabId()) {
  if (!tabId) return console.warn("[VERBA] No content script has registered yet.");
  chrome.tabs.sendMessage(
    tabId,
    { type: MESSAGE_TYPES.EXECUTE_ACTION, payload },
    (response) => {
      if (chrome.runtime.lastError) return console.warn("[VERBA] EXECUTE_ACTION failed:", chrome.runtime.lastError.message);
      console.log("[VERBA] EXECUTE_ACTION response:", response);
    }
  );
}

// expose for manual testing in the service-worker DevTools console
self.requestScan = requestScan;
self.requestFill = requestFill;
self.requestAction = requestAction;

// P3 (W3): dump each field's label candidates as JSON to hand to P2.
// Usage in this DevTools console: requestLabelDump(), then
// copy(JSON.stringify(lastDump, null, 2))
function requestLabelDump(tabId = getTargetTabId()) {
  if (!tabId) return console.warn("[VERBA] No content script has registered yet.");
  chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.SCAN_FIELDS }, (r) => {
    if (chrome.runtime.lastError || !r?.ok) {
      return console.warn("[VERBA] dump failed:", chrome.runtime.lastError?.message || r?.error);
    }
    self.lastDump = {
      url: r.url,
      fields: r.fields.map((f) => ({
        name: f.name, id: f.id, tag: f.tag, type: f.type,
        label: f.label, candidates: f.candidates
      }))
    };
    console.log("[VERBA] dump ready: run copy(JSON.stringify(lastDump, null, 2))");
  });
}
self.requestLabelDump = requestLabelDump;
