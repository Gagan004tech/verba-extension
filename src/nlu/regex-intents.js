// Regex Intent Engine (Module B, Month 1 Week 2 -> Oct robustness pass)
//
// Fast, deterministic first pass over a transcript, per the "Components
// Available vs Required to Build" table: "A regular expression engine
// ... for fast, deterministic command parsing." If nothing here matches,
// the caller (intent-parser.js) falls back to the zero-shot classifier -
// so the more real phrasing this layer catches, the less the much less
// reliable zero-shot model has to guess, and the less we depend on it at
// all. Everything in this file runs fully offline - no network, no LLM.
//
// Scope note: the browser/page/media intents below (CLOSE_TAB, SCROLL_*,
// PLAY_MEDIA, etc.) aren't in the Month 1-3 roadmap's FILL/CLICK/NAVIGATE/
// SUBMIT list, but they ARE explicitly in the project abstract's stated
// scope ("controlling standard browser functions such as scrolling, tab
// management, going back and forward... managing bookmarks and history,
// reading page content aloud, and controlling in-page media playback").
// Classification only - who executes each one (background broker vs
// content script) is a separate, already-flagged open question.

import { SYNONYM_DICTIONARY } from "../matching/synonym-dictionary.js";

// --- Preprocessing: strip conversational wrapping before matching --------
// Real speech is rarely a bare command - "could you please click submit",
// "hey verba, go back", "fill name as Alex please" are all extremely
// common. Stripping this once, up front, means every pattern below only
// has to handle the bare command, instead of every pattern needing its
// own "(?:please\s+)?" noise tolerance.
const LEADING_FILLERS = [
  /^hey\s+verba[,]?\s+/i,
  /^verba[,]?\s+/i,
  /^(?:please|could\s+you|can\s+you|would\s+you|will\s+you)\s+/i,
  /^i\s+(?:want|need|would\s+like)\s+to\s+/i,
];
const TRAILING_FILLERS = [/\s+please[.?!]?$/i, /\s+(?:thanks|thank\s+you)[.?!]?$/i, /[.?!]+$/];

/**
 * Strips conversational wrapping (politeness, wake-word, "I want to...")
 * so the patterns below only ever see a bare imperative command. Runs the
 * leading-filler pass repeatedly since these stack ("hey verba, could you
 * please click submit").
 */
export function normalizeTranscript(transcript) {
  let text = (transcript || "").trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of LEADING_FILLERS) {
      const stripped = text.replace(pattern, "");
      if (stripped !== text) {
        text = stripped.trim();
        changed = true;
      }
    }
  }

  for (const pattern of TRAILING_FILLERS) {
    text = text.replace(pattern, "").trim();
  }

  return text;
}

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
// support because mis-hearing "fill" is the far more common case.
const FILL_VERB = "(?:fill|full|feel|fil|enter|type)";

// Longest-first so alternation (which is first-match, not longest-match)
// tries "phone number" before the shorter "phone" - otherwise "phone" would
// win and leave "number 9876543210" as the value.
const KNOWN_FIELD_PHRASES = Object.values(SYNONYM_DICTIONARY)
  .flat()
  .sort((a, b) => b.length - a.length)
  .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// Optional comma tolerates a dictation pause: "name, Alex".
const KNOWN_FIELD_PATTERN = new RegExp(`^(${KNOWN_FIELD_PHRASES.join("|")})[,]?\\s+(.+)$`, "i");

export const REGEX_INTENTS = [
  // ---------------------------------------------------------------- FILL
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

  // ----------------------------------------------------- TAB / WINDOW
  // Placed ahead of CLICK/NAVIGATE so their broader verbs ("open", "go to")
  // never swallow these more specific commands.
  {
    intent: "NEW_TAB",
    pattern: /^(?:open|start)\s+(?:a\s+)?new\s+tab$/i,
    slots: () => ({}),
  },
  {
    intent: "CLOSE_TAB",
    pattern: /^close\s+(?:this\s+|the\s+)?(?:tab|window)$/i,
    slots: () => ({}),
  },
  {
    intent: "NEXT_TAB",
    pattern: /^(?:go\s+to\s+|switch\s+to\s+)?(?:the\s+)?next\s+tab$/i,
    slots: () => ({}),
  },
  {
    intent: "PREVIOUS_TAB",
    pattern: /^(?:go\s+to\s+|switch\s+to\s+)?(?:the\s+)?(?:previous|last)\s+tab$/i,
    slots: () => ({}),
  },
  {
    intent: "GO_BACK",
    // "go back" | "go back a page" | "the previous page"
    pattern: /^(?:go\s+back(?:\s+a\s+page)?|(?:go\s+to\s+)?(?:the\s+)?previous\s+page)$/i,
    slots: () => ({}),
  },
  {
    intent: "GO_FORWARD",
    // "go forward" | "go forward a page" | "the next page"
    pattern: /^(?:go\s+forward(?:\s+a\s+page)?|(?:go\s+to\s+)?(?:the\s+)?next\s+page)$/i,
    slots: () => ({}),
  },
  {
    intent: "REFRESH_PAGE",
    pattern: /^(?:refresh|reload)(?:\s+(?:this\s+|the\s+)?page)?$/i,
    slots: () => ({}),
  },
  {
    intent: "MINIMIZE_WINDOW",
    pattern: /^minimi[sz]e\s+(?:this\s+|the\s+)?window$/i,
    slots: () => ({}),
  },
  {
    intent: "MAXIMIZE_WINDOW",
    pattern: /^maximi[sz]e\s+(?:this\s+|the\s+)?window$/i,
    slots: () => ({}),
  },

  // ------------------------------------------------------------- SCROLL
  // Directionless scrolling. Placed ahead of NAVIGATE so "scroll to the
  // top"/"scroll to the bottom" resolve to SCROLL_TOP/SCROLL_BOTTOM
  // instead of NAVIGATE treating "the top" as a destination to search for.
  { intent: "SCROLL_UP", pattern: /^scroll\s+up$/i, slots: () => ({}) },
  { intent: "SCROLL_DOWN", pattern: /^scroll\s+down$/i, slots: () => ({}) },
  { intent: "SCROLL_TOP", pattern: /^scroll\s+(?:to\s+)?(?:the\s+)?top$/i, slots: () => ({}) },
  { intent: "SCROLL_BOTTOM", pattern: /^scroll\s+(?:to\s+)?(?:the\s+)?bottom$/i, slots: () => ({}) },

  // --------------------------------------------------------------- ZOOM
  { intent: "ZOOM_IN", pattern: /^zoom\s+in$/i, slots: () => ({}) },
  { intent: "ZOOM_OUT", pattern: /^zoom\s+out$/i, slots: () => ({}) },
  { intent: "RESET_ZOOM", pattern: /^reset\s+zoom$/i, slots: () => ({}) },

  // ------------------------------------------------------- FIND / BOOKMARK
  {
    intent: "FIND_ON_PAGE",
    // "find discount on the page" | "search for contact us on this page"
    pattern: /^(?:find|search\s+for)\s+(.+?)\s+on\s+(?:this\s+|the\s+)?page$/i,
    slots: (match) => ({ query: match[1].trim() }),
  },
  {
    intent: "BOOKMARK_PAGE",
    pattern: /^(?:bookmark\s+this\s+page|save\s+this\s+page|add\s+this\s+page\s+to\s+(?:my\s+)?bookmarks)$/i,
    slots: () => ({}),
  },

  // -------------------------------------------------------- READ ALOUD
  {
    intent: "READ_PAGE",
    pattern: /^read\s+(?:this\s+|the\s+)?page(?:\s+(?:to\s+me|aloud))?$/i,
    slots: () => ({}),
  },
  {
    intent: "READ_SECTION",
    // "read out loud introduction" | "read the pricing section aloud" | "read reviews to me"
    // Lower precedence than READ_PAGE above (only reached if the literal
    // word "page" wasn't there), so it's safe as a broad "read <anything>" net.
    pattern: /^read\s+(?:out\s+loud\s+)?(?:the\s+)?(.+?)(?:\s+section)?(?:\s+(?:to\s+me|aloud))?$/i,
    slots: (match) => ({ section: match[1].trim() }),
  },

  // ------------------------------------------------------- MEDIA CONTROL
  { intent: "PLAY_MEDIA", pattern: /^play(?:\s+(?:the\s+)?(?:video|audio|media))?$/i, slots: () => ({}) },
  { intent: "PAUSE_MEDIA", pattern: /^pause(?:\s+(?:the\s+)?(?:video|audio|media))?$/i, slots: () => ({}) },
  { intent: "MUTE_MEDIA", pattern: /^mute(?:\s+(?:the\s+)?(?:video|audio|media))?$/i, slots: () => ({}) },
  { intent: "UNMUTE_MEDIA", pattern: /^unmute(?:\s+(?:the\s+)?(?:video|audio|media))?$/i, slots: () => ({}) },
  {
    intent: "VOLUME_UP",
    pattern: /^(?:turn\s+(?:the\s+)?volume\s+up|increase\s+(?:the\s+)?volume)$/i,
    slots: () => ({}),
  },
  {
    intent: "VOLUME_DOWN",
    pattern: /^(?:turn\s+(?:the\s+)?volume\s+down|decrease\s+(?:the\s+)?volume|lower\s+(?:the\s+)?volume)$/i,
    slots: () => ({}),
  },
  {
    intent: "FULLSCREEN_MEDIA",
    pattern: /^(?:go\s+fullscreen|make\s+(?:it|this)\s+fullscreen)$/i,
    slots: () => ({}),
  },

  // -------------------------------------------------------------- PRINT
  { intent: "PRINT_PAGE", pattern: /^print(?:\s+(?:this\s+|the\s+)?page)?$/i, slots: () => ({}) },

  // ------------------------------------------------------- DROPDOWN / RADIO
  // "select India as country" | "choose male for gender" - a dropdown/radio
  // VALUE selection, which is functionally a FILL_FIELD, not a click on a
  // page element. MUST be ahead of CLICK below: CLICK also claims the verbs
  // "select"/"choose", and its catch-all "(.+)$" target would otherwise
  // swallow the whole phrase (target="India as country") before this ever
  // gets a chance. Plain "select the checkbox" (no as/for) has nothing for
  // this pattern to match and correctly falls through to CLICK unaffected.
  {
    intent: "FILL_FIELD",
    pattern: /^(?:select|choose)\s+(.+?)\s+(?:as|for)\s+(.+)$/i,
    slots: (match) => ({ field: match[2].trim(), rawValue: match[1].trim() }), // value, then field - note the reversed capture order
  },
  {
    intent: "CHECK_BOX",
    // "check the terms checkbox" | "tick agree to terms"
    pattern: /^(?:check|tick)\s+(?:the\s+)?(.+?)(?:\s+(?:checkbox|box))?$/i,
    slots: (match) => ({ target: match[1].trim() }),
  },
  {
    intent: "UNCHECK_BOX",
    // "uncheck the terms checkbox" | "untick agree to terms" | "deselect the newsletter box"
    pattern: /^(?:uncheck|untick|deselect)\s+(?:the\s+)?(.+?)(?:\s+(?:checkbox|box))?$/i,
    slots: (match) => ({ target: match[1].trim() }),
  },

  // -------------------------------------------------------------- UPLOAD
  {
    intent: "UPLOAD_FILE",
    // "upload resume" | "attach my resume" | "upload a file for resume"
    pattern: /^(?:upload|attach)\s+(?:a\s+file\s+(?:for|to)\s+|my\s+)?(?:the\s+)?(.+)$/i,
    slots: (match) => ({ field: match[1].trim() }),
  },

  // ---------------------------------------------------- CLEAR / RESET FORM
  // RESET_FORM (requires the literal word "form") is checked first so it
  // claims "clear/reset the form" before CLEAR_FIELD's broader catch-all
  // below gets a chance to treat "form" itself as a field name.
  {
    intent: "RESET_FORM",
    pattern: /^(?:reset|clear)\s+(?:the\s+)?form$/i,
    slots: () => ({}),
  },
  {
    intent: "CLEAR_FIELD",
    // "clear the name field" | "clear my email" | "empty the phone number field"
    pattern: /^(?:clear|empty)\s+(?:the\s+|my\s+)?(.+?)(?:\s+field)?$/i,
    slots: (match) => ({ field: match[1].trim() }),
  },

  // ------------------------------------------------------------ FOCUS FIELD
  // Keyboard-Tab equivalent. Must be ahead of NAVIGATE below: NAVIGATE also
  // claims "go to ...", and its catch-all destination capture would
  // otherwise treat "the email field" as a page/section to navigate to.
  {
    intent: "FOCUS_FIELD",
    pattern: /^(?:focus\s+on|focus|go\s+to)\s+(?:the\s+)?(.+?)\s+field$/i,
    slots: (match) => ({ field: match[1].trim() }),
  },

  // ---------------------------------------------------------------- CLICK
  {
    intent: "CLICK",
    // "click submit" | "press the continue button" | "hit submit" | "select yes"
    pattern: /^(?:click|press|tap|hit|select|choose|push)\s+(?:on\s+)?(.+)$/i,
    slots: (match) => ({ target: match[1].trim() }),
  },

  // ------------------------------------------------------------- NAVIGATE
  {
    intent: "NAVIGATE",
    // "go to the contact page" | "open google.com" | "scroll to the footer" | "show me the pricing page" | "take me to checkout"
    pattern: /^(?:go\s+to|open|navigate\s+to|scroll\s+to|show\s+me|take\s+me\s+to|visit)\s+(.+)$/i,
    slots: (match) => ({ destination: match[1].trim() }),
  },

  // --------------------------------------------------------------- SUBMIT
  {
    intent: "SUBMIT",
    // "submit" | "submit the form" | "send it" | "confirm" | "finish" | "complete the form"
    pattern: /^(?:submit|send|confirm|finish|complete)(?:\s+(?:the\s+)?(?:form|it))?$/i,
    slots: () => ({}),
  },

  // ----------------------------------------------------- FILL (fallbacks)
  {
    intent: "FILL_FIELD",
    // "born on April 22 2017" | "I was born on April 22, 2017" | "born in 1990"
    // Implies the DOB field without ever naming it, so no field-word pattern
    // (TERSE or otherwise) could catch this - "field" is hardcoded here as
    // the one deliberate exception to "field is always the raw spoken
    // phrase", since there IS no spoken field phrase to extract.
    pattern: /^(?:i\s+was\s+)?born\s+(?:on\s+|in\s+)?(.+)$/i,
    slots: (match) => ({ field: "dob", rawValue: match[1].trim() }),
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
    // pattern in this file (hence placed last - every more specific intent above gets
    // first refusal). The tradeoff: a transcript like "this is broken" would also be
    // parsed as FILL_FIELD(field="this", value="broken"). Acceptable in a voice-command-
    // only interface where every utterance is assumed to be a command; revisit if VERBA
    // ever listens to open-ended speech.
    pattern: /^(?:my\s+)?(.+?)\s+is\s+(.+)$/i,
    slots: (match) => ({ field: match[1].trim(), rawValue: match[2].trim() }),
  },
  // ABSOLUTE LAST RESORT - "gender female" | "name Alex" | "phone 9876543210".
  // No verb, no "is", no "as"/"with" - just a field word immediately
  // followed by a value, the way someone rattling through a form quickly
  // often actually talks. Safe to be this permissive (bare "<words>
  // <words>" with zero structural marker) only because it's anchored to
  // KNOWN_FIELD_PATTERN below - a fixed, curated vocabulary from
  // synonym-dictionary.js - not to arbitrary nouns. None of those phrases
  // (pan, name, dob, address, phone, email, gender...) overlap with any
  // verb used elsewhere in this file (click, scroll, submit, etc.), so
  // this can't accidentally steal a CLICK/NAVIGATE/browser-command input.
  // A similar blind fallback for CLICK/NAVIGATE targets would NOT be safe
  // the same way, since those targets are open-ended, not a fixed list.
  {
    intent: "FILL_FIELD",
    pattern: KNOWN_FIELD_PATTERN,
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
  const text = normalizeTranscript(transcript);
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

/**
 * Conservative compound-command splitter: "fill name as Alex and click
 * submit" -> two independent regex matches. Only returns a split when
 * EVERY resulting clause independently matches a known pattern on its
 * own; otherwise returns null and the caller should fall back to parsing
 * the whole transcript as a single command.
 *
 * This guards against mangling a literal "and" inside a value - e.g.
 * "fill company name as Johnson and Johnson" splits into ["fill company
 * name as Johnson", "Johnson"], the second piece matches nothing on its
 * own, so the split is rejected and the single-command parse (which
 * correctly keeps "Johnson and Johnson" as one value) is used instead.
 *
 * @param {string} transcript
 * @returns {Array<{intent: string, confidence: number, source: "regex", slots: object}> | null}
 */
export function matchCompoundRegexIntents(transcript) {
  const text = normalizeTranscript(transcript);
  const pieces = text
    .split(/\s*,?\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (pieces.length < 2) return null;

  const matches = pieces.map((piece) => matchRegexIntent(piece));
  if (matches.some((m) => !m)) return null;

  return matches;
}
