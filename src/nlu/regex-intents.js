// Regex Intent Engine (Module B, Month 1 Week 2)
//
// Fast, deterministic first pass over a transcript, per the "Components
// Available vs Required to Build" table: "A regular expression engine
// with pattern rules (FILL_FIELD, CLICK, NAVIGATE, SUBMIT) for fast,
// deterministic command parsing." If nothing here matches, the caller
// (intent-parser.js) falls back to the zero-shot classifier.

export const REGEX_INTENTS = [
  {
    intent: "FILL_FIELD",
    // "fill name as Alex" | "enter phone number with 9876543210"
    pattern: /^(?:fill|enter|type)\s+(?:in\s+)?(.+?)\s+(?:as|with)\s+(.+)$/i,
    slots: (match) => ({ field: match[1].trim(), rawValue: match[2].trim() }),
  },
  {
    intent: "FILL_FIELD",
    // "fill pan from my profile" - profile-vault reference, no literal value
    pattern: /^(?:fill|enter|type)\s+(?:in\s+)?(.+?)\s+from\s+(?:my\s+profile|the\s+vault)$/i,
    slots: (match) => ({ field: match[1].trim(), rawValue: null, profileRef: true }),
  },
  {
    intent: "CLICK",
    // "click submit" | "press the continue button" | "tap on sign in"
    pattern: /^(?:click|press|tap)\s+(?:on\s+)?(.+)$/i,
    slots: (match) => ({ target: match[1].trim() }),
  },
  {
    intent: "NAVIGATE",
    // "go to the contact page" | "open google.com" | "scroll to the footer"
    pattern: /^(?:go\s+to|open|navigate\s+to|scroll\s+to)\s+(.+)$/i,
    slots: (match) => ({ destination: match[1].trim() }),
  },
  {
    intent: "SUBMIT",
    // "submit" | "submit the form" | "send it"
    pattern: /^(?:submit|send)(?:\s+(?:the\s+)?(?:form|it))?$/i,
    slots: () => ({}),
  },
];

/**
 * Tries every pattern in order and returns the first match.
 *
 * @param {string} transcript
 * @returns {{intent: string, confidence: number, source: "regex", slots: object} | null}
 *          null means "no deterministic match" - caller should fall back
 *          to the zero-shot classifier.
 */
export function matchRegexIntent(transcript) {
  const text = (transcript || "").trim();
  if (!text) return null;

  for (const { intent, pattern, slots } of REGEX_INTENTS) {
    const match = text.match(pattern);
    if (match) {
      return {
        intent,
        confidence: 1.0,
        source: "regex",
        slots: slots(match),
      };
    }
  }
  return null;
}
