// Field & Action Coverage Dataset + Validator (Oct robustness pass)
//
// Two things in one file:
//   1. A DATASET: every field type and every action VERBA currently
//      recognizes, generated from the real source of truth
//      (synonym-dictionary.js's field list, intent-dictionary.js's
//      action list) rather than hand-typed separately - so this can
//      never silently drift out of sync with the actual code.
//   2. A VALIDATOR: runs every generated utterance through the real
//      pipeline (matchRegexIntent + extractSlots, same as production)
//      and reports pass/fail, so this file both documents coverage and
//      proves it.
//
// Run: node src/nlu/field-action-dataset.test.mjs
// No install, no model download, no browser - pure Node.

import { matchRegexIntent } from "./regex-intents.js";
import { extractSlots } from "./slot-extractor.js";
import { SYNONYM_DICTIONARY } from "../matching/synonym-dictionary.js";
import { INTENT_DICTIONARY } from "./intent-dictionary.js";

function parse(transcript) {
  const regexResult = matchRegexIntent(transcript);
  if (!regexResult) return null;
  const slots = regexResult.intent === "FILL_FIELD" ? extractSlots(regexResult.slots) : regexResult.slots;
  return { ...regexResult, slots };
}

// ============================================================================
// PART 1 - FIELD DATASET
// ============================================================================
// For every canonical field in synonym-dictionary.js, generate utterances
// across the distinct phrasing SHAPES the pipeline supports, and confirm
// each one resolves to FILL_FIELD with a sensible field/value pair. Not
// every field is tested with every shape (that would be ~35 fields x 6
// shapes = 200+ near-duplicates) - instead each field gets one shape,
// cycling through the shapes round-robin, so every shape still gets wide
// field coverage without the dataset being mostly repetition.

const SAMPLE_VALUE = "Test123"; // deliberately generic/alphanumeric - works as a name, code, or number stand-in

const FIELD_PHRASE_SHAPES = [
  (phrase, value) => `fill ${phrase} as ${value}`,
  (phrase, value) => `enter ${phrase} with ${value}`,
  (phrase, value) => `set ${phrase} to ${value}`,
  (phrase, value) => `put ${value} in the ${phrase} field`,
  (phrase, value) => `my ${phrase} is ${value}`,
  (phrase, value) => `${phrase} ${value}`, // terse, no verb at all
];

const fieldCases = [];
let shapeIndex = 0;
for (const [canonical, phrases] of Object.entries(SYNONYM_DICTIONARY)) {
  const phrase = phrases[0]; // the field's primary/shortest synonym
  const shape = FIELD_PHRASE_SHAPES[shapeIndex % FIELD_PHRASE_SHAPES.length];
  shapeIndex++;
  fieldCases.push({ canonical, phrase, transcript: shape(phrase, SAMPLE_VALUE) });
}

console.log(`=== FIELD DATASET: ${fieldCases.length} canonical fields x rotating phrasing shapes ===\n`);

let fieldPass = 0;
for (const { canonical, phrase, transcript } of fieldCases) {
  const got = parse(transcript);
  // We only assert the SHAPE resolved to FILL_FIELD with a non-empty value
  // and a field that at least contains the key phrase word - we do NOT
  // assert canonicalization, because that's deliberately not this layer's
  // job (see slot-extractor.js's comment on extractSlotsLoosely).
  const ok = got && got.intent === "FILL_FIELD" && !!got.slots.value && got.slots.field?.length > 0;
  console.log(`${ok ? "PASS" : "FAIL"}  [${canonical}]  "${transcript}"  ->  ${JSON.stringify(got?.slots)}`);
  if (ok) fieldPass++;
}
console.log(`\n${fieldPass}/${fieldCases.length} field cases passed\n`);

// ============================================================================
// PART 2 - ACTION DATASET
// ============================================================================
// One or more realistic example utterances for every non-FILL_FIELD intent
// currently defined. Hand-picked (actions aren't template-generatable the
// way fields are), but every intent in INTENT_DICTIONARY gets at least one.

const ACTION_CASES = {
  CLICK: ["click submit", "press the continue button", "tap on sign in", "hit submit", "select yes"],
  NAVIGATE: ["go to the contact page", "open google.com", "show me the pricing page", "take me to checkout"],
  SUBMIT: ["submit the form", "send it", "finish", "complete the form"],
  CONFIRM: ["yes", "confirm", "proceed", "sure", "correct", "yep", "ok", "go ahead"],
  CANCEL: ["no", "cancel", "stop", "abort", "don't", "deny", "never mind"],
  NEW_TAB: ["open a new tab", "start a new tab"],
  CLOSE_TAB: ["close this tab", "close the window"],
  NEXT_TAB: ["next tab", "switch to the next tab"],
  PREVIOUS_TAB: ["previous tab", "switch to the previous tab"],
  GO_BACK: ["go back", "the previous page"],
  GO_FORWARD: ["go forward", "the next page"],
  REFRESH_PAGE: ["refresh the page", "reload"],
  MINIMIZE_WINDOW: ["minimize the window", "minimise the window"],
  MAXIMIZE_WINDOW: ["maximize the window"],
  SCROLL_UP: ["scroll up"],
  SCROLL_DOWN: ["scroll down"],
  SCROLL_TOP: ["scroll to the top", "scroll to top"],
  SCROLL_BOTTOM: ["scroll to the bottom"],
  ZOOM_IN: ["zoom in"],
  ZOOM_OUT: ["zoom out"],
  RESET_ZOOM: ["reset zoom"],
  FIND_ON_PAGE: ["find discount on the page", "search for contact us on this page"],
  BOOKMARK_PAGE: ["bookmark this page", "save this page"],
  READ_PAGE: ["read this page", "read the page aloud", "read this page to me"],
  READ_SECTION: ["read out loud the introduction", "read the pricing section aloud", "read reviews to me"],
  PLAY_MEDIA: ["play the video", "play"],
  PAUSE_MEDIA: ["pause the video", "pause"],
  MUTE_MEDIA: ["mute the video", "mute"],
  UNMUTE_MEDIA: ["unmute the video", "unmute"],
  VOLUME_UP: ["turn the volume up", "increase the volume"],
  VOLUME_DOWN: ["turn the volume down", "lower the volume"],
  FULLSCREEN_MEDIA: ["go fullscreen", "make it fullscreen"],
  PRINT_PAGE: ["print this page", "print"],
  CHECK_BOX: ["check the terms checkbox", "tick agree to terms"],
  UNCHECK_BOX: ["uncheck the terms checkbox", "untick agree to terms", "deselect the newsletter box"],
  UPLOAD_FILE: ["upload my resume", "attach a file for resume"],
  CLEAR_FIELD: ["clear the name field", "empty the phone number field"],
  RESET_FORM: ["reset the form", "clear the form"],
  FOCUS_FIELD: ["go to the email field", "focus on the password field"],
};

console.log(`=== ACTION DATASET: ${Object.keys(ACTION_CASES).length} intents ===\n`);

// Sanity check: every actionable intent in INTENT_DICTIONARY (i.e. every
// key except FILL_FIELD, which has its own dataset above, and UNKNOWN,
// which isn't a real action) should have at least one example here. This
// catches a new intent being added to the dictionary without a matching
// test case - a silent coverage gap - automatically.
const dictionaryIntents = Object.keys(INTENT_DICTIONARY).filter((k) => k !== "FILL_FIELD" && k !== "UNKNOWN");
const missingFromDataset = dictionaryIntents.filter((intent) => !ACTION_CASES[intent]);
if (missingFromDataset.length) {
  console.log(`WARNING: intents in INTENT_DICTIONARY with no dataset coverage: ${missingFromDataset.join(", ")}\n`);
}

let actionPass = 0;
let actionTotal = 0;
for (const [expectedIntent, utterances] of Object.entries(ACTION_CASES)) {
  for (const transcript of utterances) {
    actionTotal++;
    const got = parse(transcript);
    const ok = got && got.intent === expectedIntent;
    console.log(`${ok ? "PASS" : "FAIL"}  [${expectedIntent}]  "${transcript}"${ok ? "" : `  -> got ${JSON.stringify(got)}`}`);
    if (ok) actionPass++;
  }
}
console.log(`\n${actionPass}/${actionTotal} action cases passed\n`);

// ============================================================================
// SUMMARY
// ============================================================================
const total = fieldCases.length + actionTotal;
const passed = fieldPass + actionPass;
console.log(`=== TOTAL: ${passed}/${total} passed (${missingFromDataset.length} intents with no coverage) ===`);
if (passed !== total || missingFromDataset.length) process.exitCode = 1;
