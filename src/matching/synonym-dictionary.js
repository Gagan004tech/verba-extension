// Synonym Dictionary (Month 1 Week 4 -> Oct coverage expansion)
//
// Maps a spoken field description onto a canonical field key, so "PAN",
// "PAN Number", and "Permanent Account Number" all resolve to the same
// target - the exact example given in Main_Project_Abstract's discussion
// of inconsistent form labels.
//
// Originally just the five vault-schema keys (pan, name, dob, address,
// phone). Expanded here to cover the common field types found across
// real-world sign-up, checkout, and application forms - this list is what
// both the terse "field value" matcher in regex-intents.js and the loose
// zero-shot slot extractor in slot-extractor.js search against, so a
// field missing here is a field those two paths can't recognize by name.
//
// Handoff: P2 -> P3, End Oct Week 4, alongside jaro-winkler.js, for
// fusing into the field-matching engine (Module C).

export const SYNONYM_DICTIONARY = {
  // --- Personal -----------------------------------------------------
  name: ["name", "full name", "your name", "applicant name", "legal name"],
  firstName: ["first name", "given name", "forename"],
  lastName: ["last name", "surname", "family name"],
  middleName: ["middle name"],
  email: ["email", "email address", "e-mail", "mail id"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number", "cell number"],
  dob: ["dob", "date of birth", "birth date", "birthday"],
  age: ["age", "your age"],
  gender: ["gender", "sex"],
  maritalStatus: ["marital status", "relationship status"],
  nationality: ["nationality", "citizenship"],

  // --- Address --------------------------------------------------------
  address: ["address", "residential address", "home address", "postal address", "street address"],
  addressLine2: ["address line 2", "apartment number", "unit number", "flat number"],
  city: ["city", "town"],
  state: ["state", "province"],
  zipCode: ["zip code", "postal code", "pin code", "pincode", "zipcode"],
  country: ["country", "nation"],

  // --- Account / security ----------------------------------------------
  username: ["username", "user name", "login id", "user id"],
  password: ["password", "pass code", "passcode"],
  confirmPassword: ["confirm password", "retype password", "repeat password"],
  securityAnswer: ["security answer", "security question answer"],
  otp: ["otp", "one time password", "verification code", "confirmation code"],

  // --- Identity / government ---------------------------------------------
  pan: ["pan", "pan number", "permanent account number", "pan card", "pan card number"],
  ssn: ["ssn", "social security number"],
  passportNumber: ["passport number", "passport id"],
  drivingLicense: ["driving license number", "driver's license number", "dl number", "license number"],
  aadhaar: ["aadhaar number", "aadhar number", "aadhaar card number"],

  // --- Payment ----------------------------------------------------------
  cardNumber: ["card number", "credit card number", "debit card number"],
  cvv: ["cvv", "cvv number", "security code", "card verification value"],
  expiryDate: ["expiry date", "expiration date", "card expiry"],
  cardholderName: ["cardholder name", "name on card"],
  billingAddress: ["billing address"],

  // --- Professional -------------------------------------------------------
  company: ["company", "company name", "organization", "employer"],
  jobTitle: ["job title", "designation", "occupation", "profession"],
  website: ["website", "website url", "web address"],

  // --- Misc ---------------------------------------------------------------
  comments: ["comments", "message", "remarks", "additional notes"],
  search: [
    "search",
    "search query",
    "search term",
    "search bar",
    "search box",
    "search input",
    "google search",
    "search google",
    "search the web",
    "search web",
    "ask google",
    "ask google or type url",
    "search google or type a url",
    "query",
    "q",
  ],
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
