const SENSITIVE_FIELD_REGEX = /(?:pan|aadhaar|ssn|phone|mobile|dob|date\s+of\s+birth|pin|otp|passport|cvv|account)/i;
const GATE_STORAGE_KEY = "verba_pending_gate";
const FILLS_STORAGE_KEY = "verba_session_fills";

let memoryGate = null;
let memoryFills = [];

async function getSessionStorage(key) {
  if (typeof chrome !== "undefined" && chrome.storage?.session?.get) {
    try {
      const data = await new Promise((resolve) => {
        chrome.storage.session.get([key], (res) => resolve(res?.[key] ?? null));
      });
      if (data !== null) return data;
    } catch (_) {}
  }
  return key === GATE_STORAGE_KEY ? memoryGate : memoryFills;
}

async function setSessionStorage(key, val) {
  if (key === GATE_STORAGE_KEY) memoryGate = val;
  else if (key === FILLS_STORAGE_KEY) memoryFills = val;

  if (typeof chrome !== "undefined" && chrome.storage?.session?.set) {
    try {
      await new Promise((resolve) => {
        chrome.storage.session.set({ [key]: val }, () => resolve(true));
      });
    } catch (_) {}
  }
}

async function removeSessionStorage(key) {
  if (key === GATE_STORAGE_KEY) memoryGate = null;
  else if (key === FILLS_STORAGE_KEY) memoryFills = [];

  if (typeof chrome !== "undefined" && chrome.storage?.session?.remove) {
    try {
      await new Promise((resolve) => {
        chrome.storage.session.remove([key], () => resolve(true));
      });
    } catch (_) {}
  }
}

export class FormSafety {
  static GATE_TIMEOUT_MS = 30000; // 30 seconds

  static isSensitiveField(fieldName) {
    if (!fieldName) return false;
    return SENSITIVE_FIELD_REGEX.test(fieldName);
  }

  /**
   * Formats a value for spoken TTS readback. Sensitive values (PAN, Aadhaar, Phone, DOB)
   * are spaced out character-by-character so speech synthesis spells them clearly.
   *
   * @param {string} field
   * @param {string} value
   * @returns {string}
   */
  static formatReadbackValue(field, value) {
    if (!value) return "";
    const clean = String(value).trim();
    if (this.isSensitiveField(field)) {
      // Space out alphanumeric chars for distinct pronunciation
      return clean.split("").join(" ");
    }
    return clean;
  }

  /**
   * Masks sensitive values for secure on-screen rendering.
   *
   * @param {string} field
   * @param {string} value
   * @returns {string}
   */
  static maskSensitiveValue(field, value) {
    if (!value) return "";
    const clean = String(value).trim();
    if (!this.isSensitiveField(field)) return clean;
    if (clean.length <= 4) return "••••";
    const visibleTail = clean.slice(-4);
    return "•".repeat(clean.length - 4) + visibleTail;
  }

  /**
   * Records a field fill in the current browser session.
   */
  static async recordFill(fill) {
    const fills = (await getSessionStorage(FILLS_STORAGE_KEY)) || [];
    const entry = {
      field: fill.field,
      selector: fill.selector,
      value: fill.value,
      previousValue: fill.previousValue || "",
      isSensitive: this.isSensitiveField(fill.field),
      timestamp: Date.now()
    };
    fills.push(entry);
    await setSessionStorage(FILLS_STORAGE_KEY, fills);
    return entry;
  }

  static async getSessionFills() {
    return (await getSessionStorage(FILLS_STORAGE_KEY)) || [];
  }

  static async undoLastFill() {
    const fills = (await getSessionStorage(FILLS_STORAGE_KEY)) || [];
    if (fills.length === 0) return null;
    const last = fills.pop();
    await setSessionStorage(FILLS_STORAGE_KEY, fills);
    return last;
  }

  static async clearSessionFills() {
    await removeSessionStorage(FILLS_STORAGE_KEY);
  }

  /**
   * Generates a spoken summary of all fields filled in this session.
   */
  static generateSubmissionSummary(fills) {
    if (!fills || fills.length === 0) {
      return "Are you sure you want to submit the form? Say confirm to submit, or cancel.";
    }
    const lines = fills.map((f) => {
      const formatted = this.formatReadbackValue(f.field, f.value);
      return `${f.field}: ${formatted}.`;
    });
    return `Form submission verification. Here are the values filled in this session: ${lines.join(" ")} Say confirm to submit, change <field> to modify, read it again, or cancel.`;
  }

  /**
   * Creates a confirmation gate that survives service worker restarts.
   */
  static async createGate(tabId, summaryText, timeoutMs = this.GATE_TIMEOUT_MS) {
    const gate = {
      action: "SUBMIT",
      tabId,
      summaryText,
      timestamp: Date.now(),
      expiresAt: Date.now() + timeoutMs
    };
    await setSessionStorage(GATE_STORAGE_KEY, gate);
    return gate;
  }

  /**
   * Checks the pending gate state. If expired, clears and returns { expired: true }.
   */
  static async getPendingGate() {
    const gate = await getSessionStorage(GATE_STORAGE_KEY);
    if (!gate) return null;
    if (Date.now() > gate.expiresAt) {
      await removeSessionStorage(GATE_STORAGE_KEY);
      return { expired: true, action: gate.action };
    }
    return gate;
  }

  static async clearGate() {
    await removeSessionStorage(GATE_STORAGE_KEY);
  }
}
