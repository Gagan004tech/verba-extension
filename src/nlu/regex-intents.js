// Regex Intent Engine (Module B, Month 1 Week 2 -> robustness pass, Oct W1 cleanup)
//
// Fast, deterministic first pass over a transcript, per the "Components
// Available vs Required to Build" table: "A regular expression engine
// with pattern rules (FILL_FIELD, CLICK, NAVIGATE, SUBMIT) for fast,
// deterministic command parsing." If nothing here matches, the caller
// (intent-parser.js) falls back to the zero-shot classifier - so the
// more real phrasing this layer catches, the less the unreliable
// zero-shot model has to guess. That's the point of everything below.
//
// --- Verb mishearing (ticket item 1) ------------------------------------
// Chrome's Web Speech API regularly mishears "fill" as "full" or "feel",
// or clips it to "fil". Transcript "full name as Alex" is, in practice,
// almost always a mangled "fill name as Alex", so FILL_VERB below accepts
// all four spellings as equivalent triggers.
//
// Known tradeoff (explicitly flagged by the ticket - not "solved", just
// decided): this means a transcript like "full name as Alex" is always
// parsed as verb "full" + field "name", never as field "full name" with
// no verb. A form that has a literal field called "full name" can't be
// targeted by that exact phrasing; the workaround is to say something
// that doesn't start with one of the FILL_VERB words, e.g. "set the full
// name field to Alex" (matches the SET_TO pattern below, verb "set" isn't
// swallowed into the field). We chose verb-recovery over literal-field
// support because mis-hearing "fill" is the far more common case, and
// it's what the ticket's own example needs fixed.
const FILL_VERB = "(?:fill|full|feel|fil|enter|type)";

export const REGEX_INTENTS = [
  {
    intent: "FILL_FIELD",
    // "fill name as Alex" | "full phone number with 9876543210" (mis-heard "fill")
    pattern: new RegExp(`^${FILL_VERB}\\s+(?:in\\s+)?(.+?)\\s+(?:as|with)\\s+(.+)$`, "i"),
    slots: (match) => ({ field: match[1].trim(), rawValue: match[2].trim() }),
  },
  {
    intent: "FILL_FIELD",
    // "fill pan from my profile" | "full pan from the vault" - profile-vault reference
    pattern: new RegExp(`^${FILL_VERB}\\s+(?:in\\s+)?(.+?)\\s+from\\s+(?:my\\s+profile|the\\s+vault)$`, "i"),
    slots: (match) => ({ field: match[1].trim(), rawValue: null, profileRef: true }),
  },
  {
    intent: "FILL_FIELD",
    // "set phone number to 9876543210" - verb isn't a FILL_VERB spelling,
    // so it never collides with a literal field containing "full"/"fill"
    pattern: /^set\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/i,
    slots: (match) => ({ field: match[1].trim(), rawValue: match[2].trim() }),
  },
  {
    intent: "FILL_FIELD",
    // "put Alex in the name field" | "put 9876543210 into phone number" - value first, reversed order
    pattern: /^put\s+(.+?)\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+field)?$/i,
    slots: (match) => ({ field: match[2].trim(), rawValue: match[1].trim() }),
  },
  {
    intent: "CLICK",
    // "click submit" | "press the continue button" | "tap on sign in" | "hit submit" | "select yes"
    pattern: /^(?:click|press|tap|hit|select|choose|push)\s+(?:on\s+)?(.+)$/i,
    slots: (match) => ({ target: match[1].trim() }),
  },
  {
    intent: "NAVIGATE",
    // "go to the contact page" | "open google.com" | "scroll to the footer" | "show me the pricing page" | "take me to checkout"
    pattern: /^(?:go\s+to|open|navigate\s+to|scroll\s+to|show\s+me|take\s+me\s+to|visit)\s+(.+)$/i,
    slots: (match) => ({ destination: match[1].trim() }),
  },
  {
    intent: "SUBMIT",
    // "submit" | "submit the form" | "send it" | "confirm" | "finish" | "complete the form"
    pattern: /^(?:submit|send|confirm|finish|complete)(?:\s+(?:the\s+)?(?:form|it))?$/i,
    slots: () => ({}),
  },
  {
    intent: "FILL_FIELD",
    // "pan from my profile" | "my pan from the vault" - profile reference with NO verb at all,
    // e.g. after a mis-hearing swallows the verb entirely. Lower precedence than the
    // FILL_VERB variant above: only reached if that one didn't match.
    pattern: /^(?:my\s+)?(.+?)\s+from\s+(?:my\s+profile|the\s+vault)$/i,
    slots: (match) => ({ field: match[1].trim(), rawValue: null, profileRef: true }),
  },
  {
    intent: "FILL_FIELD",
    // LAST RESORT - "my name is Alex" | "name is Alex" | "phone number is 9876543210".
    // No fill-ish verb at all: natural profile-style phrasing a real person says
    // without thinking of it as a "command". Deliberately the broadest, lowest-precision
    // pattern here (hence placed last - every more specific intent above gets first
    // refusal), which is the direct fix for "must be able to reroute most speech to
    // regex, not just ones with the keyword fill". The tradeoff: a transcript like
    // "this is broken" would also be parsed as FILL_FIELD(field="this", value="broken").
    // Acceptable in a voice-command-only interface where every utterance is assumed to
    // be a command; revisit if VERBA ever listens to open-ended speech.
    pattern: /^(?:my\s+)?(.+?)\s+is\s+(.+)$/i,
    slots: (match) => ({ field: match[1].trim(), rawValue: match[2].trim() }),
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
