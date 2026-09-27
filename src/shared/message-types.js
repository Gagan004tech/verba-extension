// Shared message-type contract for chrome.runtime messaging between the
// side panel (P1), the background broker (P1), the NLU pipeline (P2),
// and the future field-matching / execution layer (P3).
//
// Hand-off: P2 -> all, End Oct Week 1 ("Build pipeline and shared message
// types") per VEBRA_PROJECT_WORKLOAD. Every module should import
// MESSAGE_TYPES instead of hardcoding string literals, so a typo in one
// file can't silently desync the broker's routing from the senders.

export const MESSAGE_TYPES = Object.freeze({
  // Side panel (P1) -> background broker: live transcript from the Web
  // Speech API, or the manual-input fallback.
  TRANSCRIPT_STREAM: "TRANSCRIPT_STREAM",

  // Background broker -> side panel (P1): request a value from the vault.
  VAULT_FETCH: "VAULT_FETCH",

  // Background broker / P3 -> side panel (P1): speak a TTS readback
  // (used for the confirmation-gate safety flow).
  SPEAK_CONFIRMATION: "SPEAK_CONFIRMATION",

  // NLU pipeline (P2) -> background broker / P3: the parsed result of a
  // transcript - intent name, confidence, source (regex | zero-shot),
  // and extracted slots.
  INTENT_PARSED: "INTENT_PARSED",

  // NLU pipeline (P2) -> side panel (P1): lets the UI show a spinner while
  // the zero-shot model is loading/running, instead of appearing frozen.
  NLU_STATUS: "NLU_STATUS",

  // Content script (P3) -> background broker: announces that a tab's
  // content script has loaded, so the broker knows where to route
  // SCAN_FIELDS / FILL_FIELD. Added here so the string literal content.js
  // already sends has a single canonical source instead of drifting from
  // the broker's own copy.
  CONTENT_SCRIPT_READY: "CONTENT_SCRIPT_READY",

  // Background broker -> content script (P3): request the current page's
  // form fields (Module C, scanner is still a stub - see content.js).
  SCAN_FIELDS: "SCAN_FIELDS",

  // Background broker -> content script (P3): set one field's value
  // (Module D execution, native-value injector not built yet - plain
  // .value + input event only for now, see content.js).
  FILL_FIELD: "FILL_FIELD",

  // Background broker -> content script (P3): connectivity check, used by
  // requestScan/requestFill's tab-tracking fallback.
  PING: "PING",
});

/**
 * Small helper so every module builds messages in the same shape,
 * { type, payload }, matching what service-worker.js destructures.
 *
 * @param {string} type one of MESSAGE_TYPES
 * @param {object} [payload]
 */
export function createMessage(type, payload = {}) {
  return { type, payload };
}
