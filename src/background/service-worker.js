import { MESSAGE_TYPES, createMessage } from "../shared/message-types.js";
import { parseIntents, parseIntent } from "../nlu/intent-parser.js";
import { rankFieldsFused, rankFieldsFast, MATCH_THRESHOLD } from "../matching/fused-matcher.js";
import { ProfileVault } from "../vault/vault.js";
import { FormSafety } from "../safety/form-safety.js";

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

// --- Spoken Feedback Helper -------------------------------------------
function speakFeedback(text, options = {}) {
  chrome.runtime
    .sendMessage(
      createMessage(MESSAGE_TYPES.TTS_SPEAK, { text, options })
    )
    .catch(() => {});
}

/**
 * Dispatches an individual parsed intent through the pipeline.
 *
 * @param {{ intent: string, confidence: number, source: string, slots: object }} result
 * @param {string} rawTranscript
 */
async function dispatchIntent(result, rawTranscript) {
  const { intent, slots } = result;

  // Spoken pause/resume/stop controls for TTS & media
  const normText = (rawTranscript || "").trim().toLowerCase();
  if (normText === "stop" || normText === "stop reading") {
    chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.TTS_STOP)).catch(() => {});
  } else if (normText === "pause" || normText === "pause reading") {
    chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.TTS_PAUSE)).catch(() => {});
  } else if (normText === "resume" || normText === "continue reading") {
    chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.TTS_RESUME)).catch(() => {});
  }

  // Undo last fill / "clear that"
  if (normText === "undo" || normText === "undo last fill" || normText === "clear that" || normText === "erase that") {
    const undone = await FormSafety.undoLastFill();
    if (undone) {
      const tabId = await getTargetTabId();
      if (tabId && undone.selector) {
        requestFill(undone.selector, undone.previousValue || "", tabId);
        speakFeedback(`Undid fill for ${undone.field}.`);
      }
    } else {
      speakFeedback("Nothing to undo.");
    }
    return;
  }

  // 1. Check Confirmation Gate State (persisted in session storage across restarts)
  const pendingGate = await FormSafety.getPendingGate();
  if (pendingGate) {
    if (pendingGate.expired) {
      if (intent === "CONFIRM") {
        speakFeedback("Confirmation request timed out after 30 seconds. Please say submit again.", { urgent: true });
        return;
      }
    } else {
      // Gate is active
      if (intent === "CONFIRM") {
        console.log("[VERBA][Gate] User confirmed form submission");
        await FormSafety.clearGate();
        await FormSafety.clearSessionFills();

        chrome.runtime
          .sendMessage(createMessage(MESSAGE_TYPES.CONFIRMATION_RESOLVED, { status: "confirmed", action: "SUBMIT" }))
          .catch(() => {});

        speakFeedback("Action confirmed. Submitting form.", { urgent: true });
        requestAction({ action: "SUBMIT" }, pendingGate.tabId);
        return;
      }

      if (intent === "CANCEL") {
        console.log("[VERBA][Gate] User cancelled form submission");
        await FormSafety.clearGate();

        chrome.runtime
          .sendMessage(createMessage(MESSAGE_TYPES.CONFIRMATION_RESOLVED, { status: "cancelled" }))
          .catch(() => {});

        speakFeedback("Submission cancelled. You can continue editing the form.", { urgent: true });
        return;
      }

      if (normText === "read it again" || normText === "read again" || normText === "repeat" || normText === "repeat that" || normText === "say it again") {
        speakFeedback(pendingGate.summaryText, { urgent: true });
        return;
      }

      const changeMatch = normText.match(/^(?:change|modify|correct)\s+(?:the\s+)?(.+?)(?:\s+field)?$/i);
      if (changeMatch) {
        const fieldToChange = changeMatch[1].trim();
        speakFeedback(`What would you like to set ${fieldToChange} to?`, { urgent: true });
        return;
      }
    }
  }

  // 2. Intercept SUBMIT action via Confirmation Gate
  if (intent === "SUBMIT") {
    const tabId = await getTargetTabId();
    const sessionFills = await FormSafety.getSessionFills();
    const summary = FormSafety.generateSubmissionSummary(sessionFills);
    const gate = await FormSafety.createGate(tabId, summary);

    speakFeedback(summary, { urgent: true });

    chrome.runtime
      .sendMessage(createMessage(MESSAGE_TYPES.CONFIRMATION_REQUIRED, { action: "SUBMIT" }))
      .catch(() => {});

    // Announce expiration after 30s
    setTimeout(async () => {
      const current = await FormSafety.getPendingGate();
      if (current && !current.expired && current.timestamp === gate.timestamp) {
        await FormSafety.clearGate();
        speakFeedback("Pending submission confirmation expired after 30 seconds.", { urgent: true });
        chrome.runtime
          .sendMessage(createMessage(MESSAGE_TYPES.CONFIRMATION_RESOLVED, { status: "cancelled", reason: "timeout" }))
          .catch(() => {});
      }
    }, FormSafety.GATE_TIMEOUT_MS);

    return;
  }

  // 3. Form field fill
  if (intent === "FILL_FIELD") {
    await handleFillFieldIntent(result);
    return;
  }

  // 4. Tab & Window Management (Background Worker APIs)
  if (intent === "NEW_TAB") {
    chrome.tabs.create({}, () => {
      speakFeedback("Opened new tab.");
    });
    return;
  }

  if (intent === "CLOSE_TAB") {
    const tabId = await getTargetTabId();
    if (tabId) {
      chrome.tabs.remove(tabId, () => {
        speakFeedback("Closed tab.");
      });
    }
    return;
  }

  if (intent === "NEXT_TAB") {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 1) {
        const activeIdx = tabs.findIndex((t) => t.active);
        const nextIdx = (activeIdx + 1) % tabs.length;
        chrome.tabs.update(tabs[nextIdx].id, { active: true }, () => {
          speakFeedback("Switched to next tab.");
        });
      } else {
        speakFeedback("No other tab to switch to.");
      }
    });
    return;
  }

  if (intent === "PREVIOUS_TAB") {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 1) {
        const activeIdx = tabs.findIndex((t) => t.active);
        const prevIdx = (activeIdx - 1 + tabs.length) % tabs.length;
        chrome.tabs.update(tabs[prevIdx].id, { active: true }, () => {
          speakFeedback("Switched to previous tab.");
        });
      } else {
        speakFeedback("No previous tab to switch to.");
      }
    });
    return;
  }

  if (intent === "GO_BACK") {
    const tabId = await getTargetTabId();
    if (tabId) {
      chrome.tabs.goBack(tabId, () => {
        if (chrome.runtime.lastError) speakFeedback("Can't go back any further.");
        else speakFeedback("Going back.");
      });
    }
    return;
  }

  if (intent === "GO_FORWARD") {
    const tabId = await getTargetTabId();
    if (tabId) {
      chrome.tabs.goForward(tabId, () => {
        if (chrome.runtime.lastError) speakFeedback("Can't go forward any further.");
        else speakFeedback("Going forward.");
      });
    }
    return;
  }

  if (intent === "REFRESH_PAGE") {
    const tabId = await getTargetTabId();
    if (tabId) {
      chrome.tabs.reload(tabId, {}, () => {
        speakFeedback("Page reloaded.");
      });
    }
    return;
  }

  if (intent === "MINIMIZE_WINDOW") {
    chrome.windows.getCurrent((win) => {
      if (win?.id) {
        chrome.windows.update(win.id, { state: "minimized" }, () => {
          speakFeedback("Window minimized.");
        });
      }
    });
    return;
  }

  if (intent === "MAXIMIZE_WINDOW") {
    chrome.windows.getCurrent((win) => {
      if (win?.id) {
        chrome.windows.update(win.id, { state: "maximized" }, () => {
          speakFeedback("Window maximized.");
        });
      }
    });
    return;
  }

  // 5. Zoom Commands
  if (intent === "ZOOM_IN") {
    const tabId = await getTargetTabId();
    if (tabId) {
      chrome.tabs.getZoom(tabId, (current) => {
        const nextZoom = Math.min(3.0, (current || 1.0) + 0.2);
        chrome.tabs.setZoom(tabId, nextZoom, () => {
          speakFeedback("Zoomed in.");
        });
      });
    }
    return;
  }

  if (intent === "ZOOM_OUT") {
    const tabId = await getTargetTabId();
    if (tabId) {
      chrome.tabs.getZoom(tabId, (current) => {
        const nextZoom = Math.max(0.3, (current || 1.0) - 0.2);
        chrome.tabs.setZoom(tabId, nextZoom, () => {
          speakFeedback("Zoomed out.");
        });
      });
    }
    return;
  }

  if (intent === "RESET_ZOOM") {
    const tabId = await getTargetTabId();
    if (tabId) {
      chrome.tabs.setZoom(tabId, 1.0, () => {
        speakFeedback("Zoom reset.");
      });
    }
    return;
  }

  // 6. Bookmarks & History Lookup
  if (intent === "BOOKMARK_PAGE") {
    const tabId = await getTargetTabId();
    if (tabId) {
      chrome.tabs.get(tabId, (tab) => {
        if (tab?.url && chrome.bookmarks?.create) {
          chrome.bookmarks.create({ title: tab.title || "New Bookmark", url: tab.url }, () => {
            speakFeedback(`Bookmarked ${tab.title || "page"}.`);
          });
        } else {
          speakFeedback("Could not bookmark page.");
        }
      });
    }
    return;
  }

  // 7. Navigation (URL / History / Section / Link)
  if (intent === "NAVIGATE") {
    const dest = (slots?.destination || "").trim();
    const tabId = await getTargetTabId();

    // Check if it asks for history (e.g. "yesterday's page about X")
    const histMatch = dest.match(/^(?:yesterday(?:'s)?(?:\s+page)?\s+about\s+|history\s+about\s+)(.+)$/i);
    if (histMatch && chrome.history?.search) {
      const query = histMatch[1].trim();
      chrome.history.search({ text: query, maxResults: 1 }, (results) => {
        if (results && results.length > 0) {
          chrome.tabs.create({ url: results[0].url }, () => {
            speakFeedback(`Opened ${results[0].title || "page"} from history.`);
          });
        } else {
          speakFeedback(`No history page found about ${query}.`);
        }
      });
      return;
    }

    // Check if destination is a URL or external website domain
    const isUrl = /^(?:https?:\/\/|[a-z0-9-]+\.(?:com|org|net|gov|edu|io|co|in|ai|app|dev))(?:\/.*)?$/i.test(dest);
    if (isUrl) {
      const url = dest.startsWith("http") ? dest : `https://${dest}`;
      if (tabId) {
        chrome.tabs.update(tabId, { url }, () => {
          speakFeedback(`Opening ${dest}.`);
        });
      }
      return;
    }

    // Otherwise, attempt in-page section navigation or link following
    if (tabId) {
      const res = await requestAction({ action: "NAVIGATE_SECTION", destination: dest }, tabId);
      if (res.ok) {
        speakFeedback(`Scrolled to ${dest}.`);
        return;
      }

      // Try clickable link matching
      const clickRes = await requestAction({ action: "CLICK", target: dest }, tabId);
      if (clickRes.ok) {
        speakFeedback(`Navigated to ${clickRes.target || dest}.`);
      } else if (clickRes.ambiguous) {
        speakFeedback(clickRes.prompt || `Did you mean ${clickRes.options?.[0]} or ${clickRes.options?.[1]}?`, { urgent: true });
      } else {
        speakFeedback(`Couldn't find section or link for ${dest}.`);
      }
    }
    return;
  }

  // 8. In-page click
  if (intent === "CLICK") {
    const tabId = await getTargetTabId();
    const res = await requestAction({ action: "CLICK", target: slots.target }, tabId);
    if (res.ok) {
      speakFeedback(`Clicked ${res.target || slots.target}.`);
    } else if (res.ambiguous) {
      speakFeedback(res.prompt || `Did you mean ${res.options?.[0]} or ${res.options?.[1]}?`, { urgent: true });
    } else {
      speakFeedback(`Couldn't find a button or link called ${slots.target}.`);
    }
    return;
  }

  // 9. Scroll commands
  if (intent.startsWith("SCROLL_")) {
    const tabId = await getTargetTabId();
    await requestAction({ action: intent }, tabId);
    const scrollMap = {
      SCROLL_UP: "Scrolled up.",
      SCROLL_DOWN: "Scrolled down.",
      SCROLL_TOP: "Scrolled to top.",
      SCROLL_BOTTOM: "Scrolled to bottom.",
    };
    speakFeedback(scrollMap[intent] || "Scrolled.");
    return;
  }

  // 10. Checkbox controls
  if (intent === "CHECK_BOX" || intent === "UNCHECK_BOX") {
    const tabId = await getTargetTabId();
    const res = await requestAction({ action: intent, target: slots.target }, tabId);
    if (res.ok) {
      speakFeedback(`${intent === "CHECK_BOX" ? "Checked" : "Unchecked"} ${res.target || slots.target}.`);
    } else {
      speakFeedback(`Couldn't find checkbox for ${slots.target}.`);
    }
    return;
  }

  // 11. Focus field
  if (intent === "FOCUS_FIELD") {
    const tabId = await getTargetTabId();
    const res = await requestAction({ action: "FOCUS_FIELD", field: slots.field }, tabId);
    if (res.ok) {
      speakFeedback(`Focused ${res.target || slots.field} field.`);
    } else {
      speakFeedback(`Couldn't find ${slots.field} field to focus.`);
    }
    return;
  }

  // 12. Find on page
  if (intent === "FIND_ON_PAGE") {
    const tabId = await getTargetTabId();
    const res = await requestAction({ action: "FIND_ON_PAGE", query: slots.query }, tabId);
    if (res.ok && res.found) {
      speakFeedback(`Found ${slots.query} on page.`);
    } else {
      speakFeedback(`Couldn't find ${slots.query} on this page.`);
    }
    return;
  }

  // 13. Print page
  if (intent === "PRINT_PAGE") {
    const tabId = await getTargetTabId();
    await requestAction({ action: "PRINT_PAGE" }, tabId);
    speakFeedback("Printing page.");
    return;
  }

  // 14. Media Controls
  if (
    intent === "PLAY_MEDIA" || intent === "PAUSE_MEDIA" || intent === "MUTE_MEDIA" ||
    intent === "UNMUTE_MEDIA" || intent === "VOLUME_UP" || intent === "VOLUME_DOWN" ||
    intent === "FULLSCREEN_MEDIA"
  ) {
    const tabId = await getTargetTabId();
    const res = await requestAction({ action: intent }, tabId);
    if (res.ok) {
      const mediaMap = {
        PLAY_MEDIA: "Playing media.",
        PAUSE_MEDIA: "Media paused.",
        MUTE_MEDIA: "Media muted.",
        UNMUTE_MEDIA: "Media unmuted.",
        VOLUME_UP: "Volume increased.",
        VOLUME_DOWN: "Volume decreased.",
        FULLSCREEN_MEDIA: "Entered fullscreen.",
      };
      speakFeedback(mediaMap[intent] || "Media updated.");
    } else {
      speakFeedback("No video or audio found on page.");
    }
    return;
  }

  // 15. Upload file (file chooser manual action notice)
  if (intent === "UPLOAD_FILE") {
    const tabId = await getTargetTabId();
    const res = await requestAction({ action: "UPLOAD_FILE", field: slots.field }, tabId);
    if (res.ok) {
      speakFeedback("A file chooser requires manual selection in the browser.");
    } else {
      speakFeedback("No file upload field found on this page.");
    }
    return;
  }

  // 16. Read Page / Read Section
  if (intent === "READ_PAGE" || intent === "READ_SECTION") {
    const tabId = await getTargetTabId();
    const res = await requestAction({ action: intent, section: slots.section }, tabId);
    if (res.ok && res.chunks && res.chunks.length > 0) {
      speakFeedback(`Reading ${slots.section ? slots.section : "page"} aloud.`);
      for (const chunk of res.chunks) {
        chrome.runtime
          .sendMessage(createMessage(MESSAGE_TYPES.TTS_SPEAK, { text: chunk, options: { urgent: false } }))
          .catch(() => {});
      }
    } else {
      speakFeedback("No readable content found on this page.");
    }
    return;
  }

  // 17. Form reset / clear

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

    // Form Safety: record fill and speak character-by-character readback for sensitive fields
    await FormSafety.recordFill({
      field: best.label || field,
      selector: matchedField.selector,
      value: fillValue,
    });

    const spokenVal = FormSafety.formatReadbackValue(best.label || field, fillValue);
    speakFeedback(`${best.label || field}: ${spokenVal}.`);
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
  if (!targetId) {
    console.warn("[VERBA] No content script or active tab available to execute action.");
    return { ok: false, error: "no target tab" };
  }
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      targetId,
      { type: MESSAGE_TYPES.EXECUTE_ACTION, payload },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[VERBA] EXECUTE_ACTION failed:", chrome.runtime.lastError.message);
          return resolve({ ok: false, error: chrome.runtime.lastError.message });
        }
        console.log("[VERBA] EXECUTE_ACTION response:", response);
        resolve(response || { ok: true });
      }
    );
  });
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
