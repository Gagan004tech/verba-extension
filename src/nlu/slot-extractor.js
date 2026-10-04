// Slot Extraction (Module B, Month 1 Week 2)
//
// Per "Components Available vs Required to Build": "Parameter extraction
// logic (slot-extractor.js) to separate target field descriptions from
// literal values or profile references."
//
// The profile key list mirrors the schema P1 hands off at End Oct Week 3
// ("Profile key schema (PAN, name, DOB, address, phone) for 'from my
// profile' commands") - kept here as the single list P2 reads against so
// it can't drift from what the vault actually stores.

import { SYNONYM_DICTIONARY } from "../matching/synonym-dictionary.js";

export const PROFILE_KEYS = ["pan", "name", "dob", "address", "phone"];

const PROFILE_PHRASES = [
  /from\s+my\s+profile$/i,
  /from\s+(?:the\s+)?vault$/i,
  /saved\s+(?:one|value)$/i,
];

/**
 * @param {{field: string, rawValue: string|null, profileRef?: boolean}} slots
 *        raw slots as produced by regex-intents.js (or a zero-shot result
 *        that has already been coerced into this shape)
 * @returns {{field: string, value: string|null, profileKey: string|null}}
 */
export function extractSlots(slots) {
  const field = normalizeField(slots.field);
  const looksLikeProfileRef =
    slots.profileRef || (typeof slots.rawValue === "string" && PROFILE_PHRASES.some((p) => p.test(slots.rawValue)));

  if (looksLikeProfileRef) {
    return { field, value: null, profileKey: resolveProfileKey(field) };
  }

  return {
    field,
    value: slots.rawValue ? slots.rawValue.trim() : null,
    profileKey: null,
  };
}

function normalizeField(field) {
  return (field || "").replace(/^(?:the|my)\s+/i, "").trim().toLowerCase();
}

/**
 * Coarse guess at which vault key a spoken field description refers to.
 * This is NOT the real field-matching engine - that's P3's Module C,
 * fusing matching/jaro-winkler.js and the (future) semantic scores
 * against the *page's* actual labels. This just resolves "from my
 * profile" commands to a vault key so Module B's output is well-formed.
 *
 * @param {string} field already-normalized, lowercase
 * @returns {string|null}
 */
function resolveProfileKey(field) {
  return PROFILE_KEYS.find((key) => field.includes(key)) || null;
}

// --- Fallback for zero-shot-identified fills ------------------------------
// Gap found during Oct reliability testing: when regex can't parse a
// transcript's *structure* but zero-shot still confidently calls it
// FILL_FIELD (e.g. "is there a gender field to be filled as female"),
// intent-parser.js had nothing that extracted field/value for it at all -
// the intent was right but the slots were always empty, so nothing ever
// got filled. This is a narrow safety net for exactly that gap, not a
// general-purpose parser: two independent, deliberately loose heuristics.

// Checked by *rightmost* occurrence, not left-to-right first match - a
// sentence like "...gender field to be filled as female" contains "to"
// before "as", and a naive first-match regex grabs "to be filled as
// female" as the value instead of just "female". Taking whichever marker
// occurs latest in the string consistently lands on the real value clause.
const VALUE_MARKERS = [" as ", " with ", " should be ", " needs to be ", " need to be ", " has to be ", " have to be ", " to "];

/**
 * Best-effort FILL_FIELD slot extraction for transcripts the deterministic
 * regex layer couldn't parse the shape of. Looks for (1) a trailing
 * "as/with/to <value>" or "should/has to be <value>" clause, and (2) any
 * known synonym-dictionary phrase (longest match wins) to resolve the
 * target field. Either half can come back null - a partial result (field
 * found, value not, or vice versa) is still returned rather than
 * discarded, since even one resolved half is more than nothing.
 *
 * This is NOT general NLU - don't expect it to handle arbitrary phrasing.
 * It's a step up from "always empty", not a parser. A transcript like "I
 * am a female" (no field word anywhere, no trailing value clause) will
 * still correctly come back empty - inferring "gender" from the word
 * "female" alone needs a value->field lookup this doesn't attempt.
 *
 * @param {string} transcript
 * @returns {{field: string|null, value: string|null, profileKey: null}}
 */
export function extractSlotsLoosely(transcript) {
  const text = (transcript || "").trim();
  const lowerText = ` ${text.toLowerCase()} `; // pad so markers can match at either edge

  let value = null;
  let bestIndex = -1;
  let bestMarkerLength = 0;
  for (const marker of VALUE_MARKERS) {
    const idx = lowerText.lastIndexOf(marker);
    if (idx > bestIndex) {
      bestIndex = idx;
      bestMarkerLength = marker.length;
    }
  }
  if (bestIndex !== -1) {
    // Map the index back from the padded/lowercased copy onto the original text.
    const cutAt = bestIndex + bestMarkerLength - 1; // -1 undoes the leading pad space
    value = text.slice(cutAt).replace(/[.?!]+$/, "").trim() || null;
  }

  // NOTE: deliberately returns the matched PHRASE itself ("phone number"),
  // not the canonical dictionary key ("phone") - every regex path in
  // regex-intents.js returns the raw spoken field text, never a
  // canonicalized key (that resolution against real page labels is P3's
  // job). Returning a canonical key here only on this one path would be
  // an inconsistent output shape for whatever consumes parseIntent().
  let field = null;
  for (const phrases of Object.values(SYNONYM_DICTIONARY)) {
    for (const phrase of phrases) {
      if (lowerText.includes(phrase) && (!field || phrase.length > field.length)) {
        field = phrase;
      }
    }
  }

  return { field, value, profileKey: null };
}
