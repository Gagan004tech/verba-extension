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
