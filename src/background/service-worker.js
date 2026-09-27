// Enable the side panel to open on action icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[VERBA] Error setting panel behavior:", error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("[VERBA] Extension installed & service worker active.");
});

// --- Content-script tab tracking (P3) ---------------------------------
// Content scripts announce themselves on load; we remember which tab(s)
// are ready so SCAN_FIELDS / FILL_FIELD have somewhere to go once P2's
// parsed intents start driving them (full-pipeline wiring, Nov).
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
    case "TRANSCRIPT_STREAM":
      console.log("[VERBA] Received transcript from UI:", payload.text);
      // Hand-off 3: Ready to pass to Module B (P2)
      break;

    case "VAULT_FETCH":
      sendResponse({ status: "VAULT_READY" });
      break;

    case "CONTENT_SCRIPT_READY":
      if (sender.tab?.id) {
        readyTabs.add(sender.tab.id);
        lastReadyTabId = sender.tab.id;
        console.log(`[VERBA] Content script ready on tab ${sender.tab.id} (${payload?.url ?? message.url})`);
      }
      sendResponse({ ok: true });
      break;

    case "SPEAK_CONFIRMATION":
      // The side panel (src/sidepanel/index.js) already listens for this
      // broadcast directly and calls speakReadback() itself — the broker
      // doesn't need to do anything here. This case exists purely so it
      // doesn't fall through to "Unknown message type" below.
      break;

    default:
      console.warn("[VERBA] Unknown message type:", type);
  }
  return true;
});

// --- Outbound helpers: background → content script (P3) ---------------
// SCAN_FIELDS / FILL_FIELD flow the opposite direction from the cases
// above — background calls the content script, not the reverse — so
// they're functions here rather than switch cases. Callable directly
// from this service worker's own DevTools console for manual testing,
// same as the old mock-broker.js, now against the real broker.

function requestScan(tabId = getTargetTabId()) {
  if (!tabId) return console.warn("[VERBA] No content script has registered yet.");
  chrome.tabs.sendMessage(tabId, { type: "SCAN_FIELDS" }, (response) => {
    if (chrome.runtime.lastError) return console.warn("[VERBA] SCAN_FIELDS failed:", chrome.runtime.lastError.message);
    console.log("[VERBA] SCAN_FIELDS response:", response);
  });
}

function requestFill(selector, value, tabId = getTargetTabId()) {
  if (!tabId) return console.warn("[VERBA] No content script has registered yet.");
  chrome.tabs.sendMessage(
    tabId,
    { type: "FILL_FIELD", payload: { selector, value } },
    (response) => {
      if (chrome.runtime.lastError) return console.warn("[VERBA] FILL_FIELD failed:", chrome.runtime.lastError.message);
      console.log("[VERBA] FILL_FIELD response:", response);
    }
  );
}

// expose for manual testing in the service-worker DevTools console
self.requestScan = requestScan;
self.requestFill = requestFill;