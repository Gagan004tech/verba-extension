import { MESSAGE_TYPES, createMessage } from "../shared/message-types.js";
import { parseIntents, parseIntent } from "../nlu/intent-parser.js";
import { rankFieldsFused, rankFieldsFast, MATCH_THRESHOLD } from "../matching/fused-matcher.js";
import { ProfileVault } from "../vault/vault.js";

// Enable the side panel to open on action icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[VERBA] Error setting panel behavior:", error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("[VERBA] Extension installed & service worker active.");
});

// --- Content-script tab tracking & auto-injection ---------------------
// Remembers which tab(s) are ready, queries activeTab dynamically, and
// auto-injects content.js if the extension was reloaded while a tab stayed open.
const readyTabs = new Set();
let lastReadyTabId = null;

async function getTargetTabId() {
  const isWebTab = (t) =>
    t &&
    t.id &&
    (!t.url ||
      (!t.url.startsWith("chrome://") &&
       !t.url.startsWith("chrome-extension://") &&
       !t.url.startsWith("edge://") &&
       !t.url.startsWith("devtools://") &&
       !t.url.startsWith("about:")));

  // 1. Try to find the active web tab in the current or last focused window
  let activeTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs && tabs[0] && isWebTab(tabs[0])) activeTab = tabs[0];
  } catch (e) {}

  if (!activeTab) {
    try {
      const tabs = await chrome.tabs.query({ active: true });
      const found = tabs.find(isWebTab);
      if (found) activeTab = found;
      else if (tabs && tabs[0]) activeTab = tabs[0];
    } catch (e) {}
  }

  const tabId = (activeTab && isWebTab(activeTab) ? activeTab.id : null) ?? lastReadyTabId ?? [...readyTabs][0] ?? null;
  if (!tabId) return null;

  // 2. Ping the target tab to verify the content script is responsive
  const isAlive = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.PING }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) resolve(false);
      else resolve(true);
    });
  });

  if (isAlive) {
    readyTabs.add(tabId);
    lastReadyTabId = tabId;
    return tabId;
  }

  // 3. Content script was not responsive (e.g. extension was reloaded while tab stayed open)
  // Auto-inject content script dynamically using scripting API and the manifest's resolved path!
  try {
    if (chrome.scripting?.executeScript) {
      const manifest = chrome.runtime.getManifest();
      const contentScriptFiles = manifest?.content_scripts?.[0]?.js || ["src/content/content.js"];
      await chrome.scripting.executeScript({
        target: { tabId },
        files: contentScriptFiles,
      });
      console.log(`[VERBA] Auto-injected content script (${contentScriptFiles.join(", ")}) into tab ${tabId}`);
      readyTabs.add(tabId);
      lastReadyTabId = tabId;
      await new Promise((r) => setTimeout(r, 150));
      return tabId;
    }
  } catch (err) {
    console.warn(`[VERBA] Failed to auto-inject content script into tab ${tabId}:`, err?.message || err);
  }

  return tabId;
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
      ProfileVault.fetchValue(payload?.key).then((res) => sendResponse(res));
      return true;

    case MESSAGE_TYPES.VAULT_STATUS:
      ProfileVault.getStatus().then((res) => sendResponse(res));
      return true;

    case MESSAGE_TYPES.VAULT_UNLOCK:
      ProfileVault.unlock(payload?.passphrase)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ status: "error", error: err.message || "Invalid passphrase" }));
      return true;

    case MESSAGE_TYPES.VAULT_LOCK:
      ProfileVault.lock().then((res) => sendResponse(res));
      return true;

    case MESSAGE_TYPES.VAULT_SAVE:
      ProfileVault.saveProfile(payload?.profile, payload?.passphrase)
        .then(() => ProfileVault.unlock(payload?.passphrase))
        .then(() => sendResponse({ status: "ok" }))
        .catch((err) => sendResponse({ status: "error", error: err.message || "Failed to save profile" }));
      return true;

    case MESSAGE_TYPES.VAULT_CLEAR:
      ProfileVault.clearProfile().then((res) => sendResponse(res));
      return true;

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
    // Retry sending INTENT_PARSED up to 3 times with short delays.
    // On the very first command the sidepanel listener may not yet be
    // registered (Vite module execution is async), so we give it a chance
    // to settle before giving up.
    const msg = createMessage(MESSAGE_TYPES.INTENT_PARSED, { transcript: text, ...result });
    let sent = false;
    for (let attempt = 0; attempt < 3 && !sent; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 150));
      try {
        await chrome.runtime.sendMessage(msg);
        sent = true;
      } catch (_) {
        // Listener not ready yet — retry
      }
    }

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
    const tabId = await getTargetTabId();
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
    const tabId = await getTargetTabId();
    requestAction({ action: "CLICK", target: slots.target }, tabId);
    return;
  }

  // 5. Scroll commands
  if (intent.startsWith("SCROLL_")) {
    const tabId = await getTargetTabId();
    requestAction({ action: intent }, tabId);
    return;
  }

  // 6. Form reset / clear
  if (intent === "RESET_FORM") {
    const tabId = await getTargetTabId();
    requestAction({ action: "RESET_FORM" }, tabId);
    return;
  }

  if (intent === "CLEAR_FIELD") {
    // Clear targeted field
    const tabId = await getTargetTabId();
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
  let fillValue = value;

  if (profileKey) {
    const vaultRes = await ProfileVault.fetchValue(profileKey);
    if (vaultRes.status === "locked") {
      chrome.runtime
        .sendMessage(
          createMessage(MESSAGE_TYPES.SPEAK_CONFIRMATION, {
            text: "Please unlock your profile in the side panel.",
          })
        )
        .catch(() => {});
      return;
    }
    if (vaultRes.status === "missing" || !vaultRes.value) {
      chrome.runtime
        .sendMessage(
          createMessage(MESSAGE_TYPES.SPEAK_CONFIRMATION, {
            text: `No ${profileKey} found in your saved profile.`,
          })
        )
        .catch(() => {});
      return;
    }
    fillValue = vaultRes.value;
  }

  if (!field || !fillValue) {
    console.warn("[VERBA] FILL_FIELD intent missing a field or value:", result);
    return;
  }

  const tabId = await getTargetTabId();
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

    // Fused matching: fast synchronous scoring (synonym dictionary + Jaro-Winkler)
    // runs in <1ms and handles 99% of field queries without network/model loading delays.
    let ranked = rankFieldsFast(field, fields, { threshold: MATCH_THRESHOLD });

    // If fast ranking is confident, proceed immediately!
    // If not confident, try semantic embedding ranking with a strict timeout so form
    // filling NEVER hangs indefinitely if the ONNX model is slow/downloading.
    if (!ranked.length || !ranked[0].isConfident) {
      try {
        console.log(`[VERBA] Fast matching below threshold for "${field}", trying fused/semantic...`);
        const fusedPromise = rankFieldsFused(field, fields, { threshold: MATCH_THRESHOLD });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Fused matching timeout")), 1500)
        );
        const fusedRanked = await Promise.race([fusedPromise, timeoutPromise]);
        if (fusedRanked && fusedRanked.length && fusedRanked[0].isConfident) {
          ranked = fusedRanked;
        }
      } catch (err) {
        console.warn("[VERBA] Fused matching fallback:", err?.message || err);
      }
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

    // Never log raw decrypted value
    console.log(`[VERBA] Filling ${matchedField.selector} ("${best.label}") (score ${best.score.toFixed(3)})`);
    requestFill(matchedField.selector, fillValue, tabId);
  });
}

// --- Outbound helpers: background → content script (P3) ---------------
// SCAN_FIELDS / FILL_FIELD flow the opposite direction from the cases
// above - background calls the content script, not the reverse - so
// they're functions here rather than switch cases. Callable directly
// from this service worker's own DevTools console for manual testing.

async function requestScan(tabId = null) {
  const targetId = tabId || (await getTargetTabId());
  if (!targetId) return console.warn("[VERBA] No content script or active tab available to scan.");
  chrome.tabs.sendMessage(targetId, { type: MESSAGE_TYPES.SCAN_FIELDS }, (response) => {
    if (chrome.runtime.lastError) return console.warn("[VERBA] SCAN_FIELDS failed:", chrome.runtime.lastError.message);
    console.log("[VERBA] SCAN_FIELDS response:", response);
  });
}

async function requestFill(selector, value, tabId = null) {
  const targetId = tabId || (await getTargetTabId());
  if (!targetId) return console.warn("[VERBA] No content script or active tab available to fill.");
  chrome.tabs.sendMessage(
    targetId,
    { type: MESSAGE_TYPES.FILL_FIELD, payload: { selector, value } },
    (response) => {
      if (chrome.runtime.lastError) return console.warn("[VERBA] FILL_FIELD failed:", chrome.runtime.lastError.message);
      console.log("[VERBA] FILL_FIELD response:", response);
    }
  );
}

async function requestAction(payload, tabId = null) {
  const targetId = tabId || (await getTargetTabId());
  if (!targetId) return console.warn("[VERBA] No content script or active tab available to execute action.");
  chrome.tabs.sendMessage(
    targetId,
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
async function requestLabelDump(tabId = null) {
  const targetId = tabId || (await getTargetTabId());
  if (!targetId) return console.warn("[VERBA] No content script or active tab available to dump.");
  chrome.tabs.sendMessage(targetId, { type: MESSAGE_TYPES.SCAN_FIELDS }, (r) => {
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
