// Full Intent Dictionary (Module B, Month 1 Week 3)
//
// Canonical reference for every intent VERBA currently understands. Used
// two ways:
//   1. Documentation for the regex patterns in regex-intents.js.
//   2. Candidate labels handed to the zero-shot classifier
//      (zero-shot-classifier.js) whenever regex finds no match.
//
// NOTE on scope: the roadmap's original intent list has no yes/no intent,
// but the confirmation-gate safety flow needs one. Per the "Conflicts to
// settle" section of VEBRA_PROJECT_WORKLOAD, CONFIRM/CANCEL is scheduled
// for Month 2 Week 2 ("New CONFIRM/CANCEL ('yes/no') intents for the
// gate") and is intentionally left out of this Month 1 dictionary.

export const INTENT_DICTIONARY = {
  FILL_FIELD: {
    description: "Fill a form field with a literal value or a saved profile value.",
    examples: ["fill name as Alex", "enter phone number with 9876543210", "fill pan from my profile"],
    // Fed to the zero-shot classifier as a hypothesis - see ZERO_SHOT_LABELS
    // below for why this needs to be a real sentence fragment, not "FILL_FIELD".
    zeroShotLabel: "filling in a form field with a value",
  },
  CLICK: {
    description: "Click or activate a visible page element (button, link, checkbox).",
    examples: ["click submit", "press the continue button", "tap on sign in"],
    zeroShotLabel: "clicking or activating a button, link, or other element",
  },
  NAVIGATE: {
    description: "Move to a different page, URL, or section of the current page.",
    examples: ["go to the contact page", "open google.com", "scroll to the footer"],
    zeroShotLabel: "navigating to a different page, URL, or section",
  },
  SUBMIT: {
    description: "Submit the current form.",
    examples: ["submit", "submit the form", "send it"],
    zeroShotLabel: "submitting the current form",
  },
  UNKNOWN: {
    description: "The utterance did not match any supported action.",
    examples: [],
  },
};

/**
 * Candidate labels for the zero-shot classifier - the model's own
 * ("Xenova/distilbert-base-uncased-mnli") classification works by turning
 * each candidate label into a hypothesis sentence like "This example is
 * {label}." and checking whether the transcript entails it. Passing the
 * intent's enum key directly ("FILL_FIELD", "NAVIGATE") makes that
 * hypothesis nonsense ("This example is FILL_FIELD.") and gives the model
 * almost no real signal to work with - a very likely cause of the
 * misclassifications seen in testing (e.g. "full name as Alex" -> NAVIGATE).
 * Using the natural-language zeroShotLabel instead ("This example is about
 * filling in a form field with a value.") gives the NLI model an actual
 * sentence to reason about. UNKNOWN is still excluded: it's a fallback
 * bucket for low-confidence scores, not something to classify against.
 */
export const ZERO_SHOT_LABELS = Object.values(INTENT_DICTIONARY)
  .map((def) => def.zeroShotLabel)
  .filter(Boolean);

/** Maps a zero-shot label phrase back to its canonical intent key. */
export const ZERO_SHOT_LABEL_TO_INTENT = Object.fromEntries(
  Object.entries(INTENT_DICTIONARY)
    .filter(([, def]) => def.zeroShotLabel)
    .map(([key, def]) => [def.zeroShotLabel, key])
);
