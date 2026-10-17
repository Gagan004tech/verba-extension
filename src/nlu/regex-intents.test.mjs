// Standalone smoke test for the regex intent layer (Oct robustness pass #2).
//
// No test framework dependency - just run it directly:
//
//   node src/nlu/regex-intents.test.mjs
//
// Only imports regex-intents.js, slot-extractor.js, and
// synonym-dictionary.js - none of which touch @xenova/transformers, so
// this runs instantly with no model download and no browser/extension
// context required. It covers everything EXCEPT the live zero-shot
// classifier itself (that still needs a real browser - see the bottom of
// this file for how to test that part).

import { matchRegexIntent, matchCompoundRegexIntents, normalizeTranscript } from "./regex-intents.js";
import { extractSlots, extractSlotsLoosely } from "./slot-extractor.js";

/** Mirrors intent-parser.js's single-command regex branch. */
function parseRegexOnly(transcript) {
  const regexResult = matchRegexIntent(transcript);
  if (!regexResult) return null;
  const slots = regexResult.intent === "FILL_FIELD" ? extractSlots(regexResult.slots) : regexResult.slots;
  return { ...regexResult, slots };
}

function checkSlots(got, want) {
  return (
    (want.field === undefined || got.slots.field === want.field) &&
    (want.value === undefined || got.slots.value === want.value) &&
    (want.profileKey === undefined || got.slots.profileKey === want.profileKey) &&
    (want.target === undefined || got.slots.target === want.target) &&
    (want.destination === undefined || got.slots.destination === want.destination) &&
    (want.query === undefined || got.slots.query === want.query)
  );
}

const cases = [
  // --- Ticket item 1: verb mishearing ------------------------------------
  { in: "fill name as Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "full name as Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "feel name as Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "fil name as Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },

  // --- Existing baseline, must not regress --------------------------------
  { in: "enter phone number with 9876543210", want: { intent: "FILL_FIELD", field: "phone number", value: "9876543210" } },
  { in: "fill pan from my profile", want: { intent: "FILL_FIELD", field: "pan", profileKey: "pan" } },
  { in: "full pan from the vault", want: { intent: "FILL_FIELD", field: "pan", profileKey: "pan" } },
  { in: "set phone number to 9876543210", want: { intent: "FILL_FIELD", field: "phone number", value: "9876543210" } },
  { in: "put Alex in the name field", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "put 9876543210 into phone number", want: { intent: "FILL_FIELD", field: "phone number", value: "9876543210" } },
  { in: "my name is Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "name is Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "pan from my profile", want: { intent: "FILL_FIELD", field: "pan", profileKey: "pan" } },
  { in: "click submit", want: { intent: "CLICK", target: "submit" } },
  { in: "hit submit", want: { intent: "CLICK", target: "submit" } },
  { in: "select yes", want: { intent: "CLICK", target: "yes" } },
  { in: "go to the contact page", want: { intent: "NAVIGATE", destination: "the contact page" } },
  { in: "show me the pricing page", want: { intent: "NAVIGATE", destination: "the pricing page" } },
  { in: "take me to checkout", want: { intent: "NAVIGATE", destination: "checkout" } },
  { in: "submit the form", want: { intent: "SUBMIT" } },
  { in: "finish", want: { intent: "SUBMIT" } },

  // --- NEW: filler-stripping ("could you please...", "hey verba...") -----
  { in: "could you please click submit", want: { intent: "CLICK", target: "submit" } },
  { in: "can you fill name as Alex please", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "hey verba, go back", want: { intent: "GO_BACK" } },
  { in: "I want to go to the contact page", want: { intent: "NAVIGATE", destination: "the contact page" } },
  { in: "fill name as Alex.", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } }, // trailing punctuation

  // --- NEW: tab / window management ---------------------------------------
  { in: "open a new tab", want: { intent: "NEW_TAB" } },
  { in: "close this tab", want: { intent: "CLOSE_TAB" } },
  { in: "close the window", want: { intent: "CLOSE_TAB" } },
  { in: "next tab", want: { intent: "NEXT_TAB" } },
  { in: "switch to the previous tab", want: { intent: "PREVIOUS_TAB" } },
  { in: "go back", want: { intent: "GO_BACK" } },
  { in: "the previous page", want: { intent: "GO_BACK" } },
  { in: "go forward", want: { intent: "GO_FORWARD" } },
  { in: "the next page", want: { intent: "GO_FORWARD" } },
  { in: "refresh the page", want: { intent: "REFRESH_PAGE" } },
  { in: "minimise the window", want: { intent: "MINIMIZE_WINDOW" } }, // British spelling
  { in: "maximize the window", want: { intent: "MAXIMIZE_WINDOW" } },

  // --- NEW: scroll / zoom --------------------------------------------------
  { in: "scroll up", want: { intent: "SCROLL_UP" } },
  { in: "scroll down", want: { intent: "SCROLL_DOWN" } },
  { in: "scroll to the top", want: { intent: "SCROLL_TOP" } }, // must NOT become NAVIGATE(destination="the top")
  { in: "scroll to the bottom", want: { intent: "SCROLL_BOTTOM" } },
  { in: "zoom in", want: { intent: "ZOOM_IN" } },
  { in: "zoom out", want: { intent: "ZOOM_OUT" } },
  { in: "reset zoom", want: { intent: "RESET_ZOOM" } },

  // --- NEW: find / bookmark / read-aloud -----------------------------------
  { in: "find discount on the page", want: { intent: "FIND_ON_PAGE", query: "discount" } },
  { in: "search for contact us on this page", want: { intent: "FIND_ON_PAGE", query: "contact us" } },
  { in: "bookmark this page", want: { intent: "BOOKMARK_PAGE" } },
  { in: "read this page to me", want: { intent: "READ_PAGE" } },

  // --- NEW: media control ---------------------------------------------------
  { in: "play the video", want: { intent: "PLAY_MEDIA" } },
  { in: "pause", want: { intent: "PAUSE_MEDIA" } },
  { in: "mute the video", want: { intent: "MUTE_MEDIA" } },
  { in: "unmute", want: { intent: "UNMUTE_MEDIA" } },
  { in: "turn the volume up", want: { intent: "VOLUME_UP" } },
  { in: "lower the volume", want: { intent: "VOLUME_DOWN" } },
  { in: "make it fullscreen", want: { intent: "FULLSCREEN_MEDIA" } },
  { in: "print this page", want: { intent: "PRINT_PAGE" } },

  // --- NEW: terse "field value" with no verb/is/as at all -----------------
  { in: "gender female", want: { intent: "FILL_FIELD", field: "gender", value: "female" } },
  { in: "name Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } },
  { in: "phone 9876543210", want: { intent: "FILL_FIELD", field: "phone", value: "9876543210" } },
  { in: "phone number 9876543210", want: { intent: "FILL_FIELD", field: "phone number", value: "9876543210" } }, // longest-phrase-wins
  { in: "name, Alex", want: { intent: "FILL_FIELD", field: "name", value: "Alex" } }, // dictation-pause comma
  { in: "email alex@example.com", want: { intent: "FILL_FIELD", field: "email", value: "alex@example.com" } },

  // --- NEW: "born on <date>" implies DOB with no field word at all -------
  { in: "born on April 22 2017", want: { intent: "FILL_FIELD", field: "dob", value: "April 22 2017" } },
  { in: "I was born on April 22, 2017", want: { intent: "FILL_FIELD", field: "dob", value: "April 22, 2017" } },
  { in: "born in 1990", want: { intent: "FILL_FIELD", field: "dob", value: "1990" } },

  // --- NEW: dropdown/radio select, and its collision with plain CLICK ----
  { in: "select India as country", want: { intent: "FILL_FIELD", field: "country", value: "India" } },
  { in: "choose male for gender", want: { intent: "FILL_FIELD", field: "gender", value: "male" } },
  { in: "select the checkbox", want: { intent: "CLICK", target: "the checkbox" } }, // no as/for -> stays CLICK, must not regress
  { in: "select submit", want: { intent: "CLICK", target: "submit" } },

  // --- NEW: focus vs navigate collision (both start with "go to") --------
  { in: "go to the email field", want: { intent: "FOCUS_FIELD", field: "email" } },
  { in: "go to the contact page", want: { intent: "NAVIGATE", destination: "the contact page" } }, // must not regress

  // --- Month 2 Week 2: CONFIRM / CANCEL for confirmation gate -------------
  { in: "yes", want: { intent: "CONFIRM" } },
  { in: "confirm", want: { intent: "CONFIRM" } },
  { in: "proceed", want: { intent: "CONFIRM" } },
  { in: "sure", want: { intent: "CONFIRM" } },
  { in: "yep", want: { intent: "CONFIRM" } },
  { in: "ok", want: { intent: "CONFIRM" } },
  { in: "go ahead", want: { intent: "CONFIRM" } },
  { in: "no", want: { intent: "CANCEL" } },
  { in: "cancel", want: { intent: "CANCEL" } },
  { in: "stop", want: { intent: "CANCEL" } },
  { in: "abort", want: { intent: "CANCEL" } },
  { in: "never mind", want: { intent: "CANCEL" } },
  { in: "don't", want: { intent: "CANCEL" } },

  // --- Should NOT match anything here -> correctly falls to zero-shot ----
  { in: "what's the weather like", want: null },
  { in: "can you read this page to me", want: { intent: "READ_PAGE" } }, // filler-stripped -> now DOES match
  { in: "is there a gender field to be filled as female", want: null }, // too irregular for regex - zero-shot's job
];

let pass = 0;
for (const { in: input, want } of cases) {
  const got = parseRegexOnly(input);
  const ok = want === null ? got === null : got && got.intent === want.intent && checkSlots(got, want);

  console.log(`${ok ? "PASS" : "FAIL"}  "${input}"`);
  if (!ok) {
    console.log(`      want: ${JSON.stringify(want)}`);
    console.log(`      got:  ${JSON.stringify(got)}`);
  }
  if (ok) pass++;
}
console.log(`\n${pass}/${cases.length} single-command cases passed`);

// --- Compound-command splitting ("X and Y") --------------------------------
console.log("\n--- compound commands ---");

const compoundCases = [
  {
    in: "fill name as Alex and click submit",
    wantLength: 2,
    want: [{ intent: "FILL_FIELD" }, { intent: "CLICK" }],
  },
  {
    in: "my first name is Alex and last name is Graham Bell",
    wantLength: 2,
    want: [
      { intent: "FILL_FIELD", field: "first name", value: "Alex" },
      { intent: "FILL_FIELD", field: "last name", value: "Graham Bell" },
    ],
  },
  // Must NOT split - "Johnson and Johnson" is a literal value, not two commands
  { in: "fill company name as Johnson and Johnson", wantLength: null },
];

let compoundPass = 0;
for (const { in: input, wantLength, want } of compoundCases) {
  const raw = matchCompoundRegexIntents(input);
  const got = raw ? raw.map((r) => (r.intent === "FILL_FIELD" ? { ...r, slots: extractSlots(r.slots) } : r)) : null;
  const gotLength = got ? got.length : null;
  let ok = gotLength === wantLength;
  if (ok && want) {
    ok = want.every((w, i) => got[i].intent === w.intent && checkSlots(got[i], w));
  }
  console.log(`${ok ? "PASS" : "FAIL"}  "${input}"`);
  if (!ok) console.log(`      got:  ${JSON.stringify(got)}`);
  if (ok) compoundPass++;
}
console.log(`${compoundPass}/${compoundCases.length} compound cases passed`);

// --- Loose slot extraction for zero-shot FILL_FIELD results ---------------
console.log("\n--- loose slot extraction (for zero-shot FILL_FIELD results) ---");

const looseCases = [
  { in: "is there a gender field to be filled as female", want: { field: "gender", value: "female" } },
  { in: "the phone number should be 9876543210", want: { field: "phone number", value: "9876543210" } },
  { in: "I am a female", want: { field: null, value: null } }, // honest non-match, documented limitation
];

let loosePass = 0;
for (const { in: input, want } of looseCases) {
  const got = extractSlotsLoosely(input);
  const ok = got.field === want.field && got.value === want.value;
  console.log(`${ok ? "PASS" : "FAIL"}  "${input}"`);
  if (!ok) console.log(`      want: ${JSON.stringify(want)}  got: ${JSON.stringify(got)}`);
  if (ok) loosePass++;
}
console.log(`${loosePass}/${looseCases.length} loose-extraction cases passed`);

console.log(
  `\nTOTAL: ${pass + compoundPass + loosePass}/${cases.length + compoundCases.length + looseCases.length} passed`
);

// --- Known, intentional non-matches (documented tradeoffs, not bugs) -----
console.log(`\n(not matched, by design) "fill name" ->`, parseRegexOnly("fill name"));
console.log(`(normalizeTranscript demo) "hey verba, could you please click submit!" ->`, normalizeTranscript("hey verba, could you please click submit!"));

// --- Testing the zero-shot half (needs a real browser) --------------------
// classifyIntent() in zero-shot-classifier.js imports @xenova/transformers,
// which needs a DOM/service-worker environment and downloads model weights
// over the network - it won't run under plain `node`. To test it:
//   1. npm run build (or npm run dev)
//   2. load the unpacked extension, open the side panel
//   3. type/speak something this regex layer does NOT match (e.g.
//      "is there a gender field to be filled as female") and watch the
//      service worker console for "[VERBA][NLU] Parsed intent" with
//      source: "zero-shot" - slots should now be populated instead of {}.
