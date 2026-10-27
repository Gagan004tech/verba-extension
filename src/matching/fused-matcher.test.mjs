// Unit tests for Fused Field Matcher (Module B / Matching Engine)
// Tests synonym resolution, Jaro-Winkler integration, score fusion,
// and suppression of false-positive collisions ("pan" vs "phone").
//
// Run: node src/matching/fused-matcher.test.mjs

import {
  computeSynonymScore,
  computeLexicalScore,
  fuseScores,
  rankFieldsFast,
  MATCH_THRESHOLD,
} from "./fused-matcher.js";

console.log("=== FUSED FIELD MATCHER UNIT TESTS ===\n");

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`PASS  ${message}`);
  } else {
    console.error(`FAIL  ${message}`);
  }
}

// 1. Synonym Score Resolution
console.log("--- 1. Synonym Score Resolution ---");
assert(
  computeSynonymScore("pan", "permanent account number").score === 1.0,
  '"pan" and "permanent account number" share canonical key (score 1.0)'
);
assert(
  computeSynonymScore("mobile", "phone number").score === 1.0,
  '"mobile" and "phone number" share phone canonical key (score 1.0)'
);
assert(
  computeSynonymScore("dob", "date of birth").score === 1.0,
  '"dob" and "date of birth" resolve to dob (score 1.0)'
);
assert(
  computeSynonymScore("given name", "first name").score === 1.0,
  '"given name" and "first name" resolve to firstName (score 1.0)'
);
assert(
  computeSynonymScore("pincode", "zip code").score === 1.0,
  '"pincode" and "zip code" resolve to zipCode (score 1.0)'
);
assert(
  computeSynonymScore("pan", "phone").score === 0.0,
  '"pan" and "phone" have no synonym relationship (score 0.0)'
);

// 2. Lexical Score & Canonical Synonym Expansion
console.log("\n--- 2. Lexical & Synonym-Expanded Scoring ---");
assert(
  computeLexicalScore("name", "name") === 1.0,
  'Exact string "name" vs "name" has lexical score 1.0'
);
assert(
  computeLexicalScore("pan", "permanent account number") > 0.85,
  '"pan" expanded against canonical synonyms scores high on "permanent account number"'
);

// 3. Fused Score Collision Resolution (The "pan" vs "phone" Problem)
console.log("\n--- 3. Collision Resolution (pan vs phone) ---");
const panVsPhoneFused = fuseScores("pan", "phone", 0.15); // simulate low semantic similarity
const panVsPanNumberFused = fuseScores("pan", "pan number", 0.95);

assert(
  panVsPhoneFused.score < MATCH_THRESHOLD,
  `"pan" vs "phone" fused score (${panVsPhoneFused.score}) is BELOW threshold (${MATCH_THRESHOLD})`
);
assert(
  panVsPanNumberFused.score >= MATCH_THRESHOLD,
  `"pan" vs "pan number" fused score (${panVsPanNumberFused.score}) is ABOVE threshold (${MATCH_THRESHOLD})`
);
assert(
  panVsPanNumberFused.score > panVsPhoneFused.score + 0.35,
  `"pan" vs "pan number" significantly outscores false-positive "phone"`
);

// 4. Ranking against Real Form Candidates (from test-forms/03-messy-labels.html)
console.log("\n--- 4. Real Form Field Ranking ---");
const messyFormFields = [
  { id: "fn", label: "First name", candidates: ["first name", "fn"] },
  { id: "pan_no", label: "PAN Number", candidates: ["pan number", "pan no"] },
  { id: "x_mob", label: "Mobile", candidates: ["mobile", "mobile number"] },
  { id: "aad", label: "Aadhaar number", candidates: ["aadhaar number", "aadhaar"] },
  { id: "srch", label: "Search", candidates: ["search"] },
  { id: "cty", label: "Enter your city", candidates: ["enter your city"] },
  { id: "zip", label: "Pincode", candidates: ["pincode", "zip code", "zip"] },
  { id: "gn", label: "given name", candidates: ["given name"] },
  { id: "g", label: "Gender", candidates: ["gender"] },
  { id: "terms", label: "I agree to the terms", candidates: ["i agree to the terms", "terms"] },
  { id: "dob", label: "Date of birth", candidates: ["date of birth", "dob"] },
  { id: "state", label: "State", candidates: ["state"] },
];

// Spoken "pan" -> should pick PAN Number
const panRank = rankFieldsFast("pan", messyFormFields);
assert(
  panRank[0].field.id === "pan_no" && panRank[0].isConfident,
  `Spoken "pan" ranks "PAN Number" #1 with confidence (score ${panRank[0].score})`
);

// Spoken "phone" -> should pick Mobile, NOT PAN Number!
const phoneRank = rankFieldsFast("phone", messyFormFields);
assert(
  phoneRank[0].field.id === "x_mob" && phoneRank[0].isConfident,
  `Spoken "phone" ranks "Mobile" #1 with confidence (score ${phoneRank[0].score})`
);
assert(
  phoneRank.find((r) => r.field.id === "pan_no").score < MATCH_THRESHOLD,
  `"pan_no" is not falsely matched for "phone"`
);

// Spoken "zip code" -> should pick Pincode
const zipRank = rankFieldsFast("zip code", messyFormFields);
assert(
  zipRank[0].field.id === "zip" && zipRank[0].isConfident,
  `Spoken "zip code" ranks "Pincode" #1 with confidence (score ${zipRank[0].score})`
);

// Spoken "birth date" -> should pick Date of birth
const dobRank = rankFieldsFast("birth date", messyFormFields);
assert(
  dobRank[0].field.id === "dob" && dobRank[0].isConfident,
  `Spoken "birth date" ranks "Date of birth" #1 with confidence (score ${dobRank[0].score})`
);

// Spoken "city" -> should pick Enter your city
const cityRank = rankFieldsFast("city", messyFormFields);
assert(
  cityRank[0].field.id === "cty" && cityRank[0].isConfident,
  `Spoken "city" ranks "Enter your city" #1 with confidence (score ${cityRank[0].score})`
);

console.log(`\n=== RESULTS: ${passed}/${total} passed ===`);
if (passed !== total) process.exitCode = 1;
