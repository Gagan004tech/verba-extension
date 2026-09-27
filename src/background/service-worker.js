// Enable the side panel to open on action icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[VERBA] Error setting panel behavior:", error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("[VERBA] Extension installed & service worker active.");
});

// Message routing broker
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

    default:
      console.warn("[VERBA] Unknown message type:", type);
  }
  return true;
});
