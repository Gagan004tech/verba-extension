// Standalone smoke test for the regex intent layer (Oct robustness pass).
//
// Deliberately NOT a real test framework (no vitest/jest dependency to
// install) - just run it directly:
//
//   node src/nlu/regex-intents.test.mjs
//
// It only imports regex-intents.js and slot-extractor.js, neither of
// which touch @xenova/transformers, so this runs instantly with no
// model download and no browser/extension context required. It is the
// synchronous half of intent-parser.js's pipeline (regex -> slots);
// the zero-shot half still needs a real browser - see the bottom of
// this file for how to test that part.

import { matchRegexIntent } from "./regex-intents.js";
import { extractSlots } from "./slot-extractor.js";

/** Mirrors intent-parser.js's regex branch, minus the zero-shot fallback. */
function parseRegexOnly(transcript) {
  const regexResult = matchRegexIntent(transcript);
  if (!regexResult) return null;
  const slots = regexResult.intent === "FILL_FIELD" ? extractSlots(regexResult.slots) : regexResult.slots;
  return { ...regexResult, slots };
}

const cases = [
  // --- Ticket item 1: verb mishearing ------------------------------------
  { in: "fill name as Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "full name as Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } }, // STT mis-hearing
  { in: "feel name as Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "fil name as Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },

  // --- Existing baseline, must not regress --------------------------------
  { in: "enter phone number with 9876543210", want: { intent: "FILL_FIELD", field: "phone number", value: "9876543210" } },
  { in: "fill pan from my profile", want: { intent: "FILL_FIELD", field: "pan", profileKey: "pan" } },
  { in: "full pan from the vault", want: { intent: "FILL_FIELD", field: "pan", profileKey: "pan" } },

  // --- New phrasings this pass adds ---------------------------------------
  { in: "set phone number to 9876543210", want: { intent: "FILL_FIELD", field: "phone number", value: "9876543210" } },
  { in: "put Alex in the name field", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "put 9876543210 into phone number", want: { intent: "FILL_FIELD", field: "phone number", value: "9876543210" } },
  { in: "my name is Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "name is Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "pan from my profile", want: { intent: "FILL_FIELD", field: "pan", profileKey: "pan" } },

  // --- CLICK / NAVIGATE / SUBMIT broadened verbs --------------------------
  { in: "click submit", want: { intent: "CLICK", target: "submit" } },
  { in: "hit submit", want: { intent: "CLICK", target: "submit" } },
  { in: "select yes", want: { intent: "CLICK", target: "yes" } },
  { in: "go to the contact page", want: { intent: "NAVIGATE", destination: "the contact page" } },
  { in: "show me the pricing page", want: { intent: "NAVIGATE", destination: "the pricing page" } },
  { in: "take me to checkout", want: { intent: "NAVIGATE", destination: "checkout" } },
  { in: "submit the form", want: { intent: "SUBMIT" } },
  { in: "finish", want: { intent: "SUBMIT" } },

  // --- Should NOT match anything here -> correctly falls to zero-shot ----
  { in: "what's the weather like", want: null },
  { in: "can you read this page to me", want: null },
];

let pass = 0;
for (const { in: input, want } of cases) {
  const got = parseRegexOnly(input);
  const ok = want === null ? got === null : got && got.intent === want.intent
    && (want.field === undefined || got.slots.field === want.field)
    && (want.value === undefined || got.slots.value === want.value)
    && (want.profileKey === undefined || got.slots.profileKey === want.profileKey)
    && (want.target === undefined || got.slots.target === want.target)
    && (want.destination === undefined || got.slots.destination === want.destination);

  console.log(`${ok ? "PASS" : "FAIL"}  "${input}"`);
  if (!ok) {
    console.log(`      want: ${JSON.stringify(want)}`);
    console.log(`      got:  ${JSON.stringify(got)}`);
  }
  if (ok) pass++;
}

console.log(`\n${pass}/${cases.length} passed`);

// --- Known, intentional non-matches (documented tradeoffs, not bugs) -----
// "fill name" (bare, no value) - deliberately unsupported: there's no
// session/dialog state yet to hold "waiting for a value for field=name",
// so matching this would either silently fill with an empty value or
// require inventing multi-turn state. Flag to the team if you want this
// to prompt a follow-up instead of being ignored.
console.log(`\n(not matched, by design) "fill name" ->`, parseRegexOnly("fill name"));

// --- Testing the zero-shot half (needs a real browser) --------------------
// classifyIntent() in zero-shot-classifier.js imports @xenova/transformers,
// which needs a DOM/service-worker environment and downloads model weights
// over the network - it won't run under plain `node`. To test it:
//   1. npm run build (or npm run dev)
//   2. load the unpacked extension, open the side panel
//   3. type/speak something this regex layer does NOT match (see the two
//      "what's the weather like" style cases above) and watch the service
//      worker console for "[VERBA][NLU] Parsed intent" with source: "zero-shot"
