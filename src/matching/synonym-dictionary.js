// Synonym Dictionary (Month 1 Week 4)
//
// Maps a spoken field description onto a canonical field key, so "PAN",
// "PAN Number", and "Permanent Account Number" all resolve to the same
// target - the exact example given in Main_Project_Abstract's discussion
// of inconsistent form labels. Keys line up with slot-extractor.js's
// PROFILE_KEYS plus "email", which isn't in the vault schema but shows up
// constantly on real forms.
//
// Handoff: P2 -> P3, End Oct Week 4, alongside jaro-winkler.js, for
// fusing into the field-matching engine (Module C).

export const SYNONYM_DICTIONARY = {
  pan: ["pan", "pan number", "permanent account number", "pan card", "pan card number"],
  name: ["name", "full name", "your name", "first name", "applicant name"],
  dob: ["dob", "date of birth", "birth date", "birthday"],
  address: ["address", "residential address", "home address", "postal address", "street address"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number", "cell number"],
  email: ["email", "email address", "e-mail", "mail id"],
};

/** Canonical key -> lowercase phrase, built once for O(1) lookups. */
const REVERSE_INDEX = new Map();
for (const [canonical, phrases] of Object.entries(SYNONYM_DICTIONARY)) {
  for (const phrase of phrases) {
    REVERSE_INDEX.set(phrase.toLowerCase(), canonical);
  }
}

/**
 * Exact/normalized lookup - returns the canonical key or null.
 * @param {string} spokenPhrase
 */
export function resolveCanonicalField(spokenPhrase) {
  const normalized = (spokenPhrase || "").trim().toLowerCase();
  return REVERSE_INDEX.get(normalized) || null;
}

/**
 * All known phrasings for a canonical key - useful for expanding a page's
 * raw label before running it through jaro-winkler.js, so "Permanent
 * Account Number" gets compared against "pan" as well as its full form.
 * @param {string} canonicalKey
 */
export function synonymsFor(canonicalKey) {
  return SYNONYM_DICTIONARY[canonicalKey] || [];
}
