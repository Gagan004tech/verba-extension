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
  },
  CLICK: {
    description: "Click or activate a visible page element (button, link, checkbox).",
    examples: ["click submit", "press the continue button", "tap on sign in"],
  },
  NAVIGATE: {
    description: "Move to a different page, URL, or section of the current page.",
    examples: ["go to the contact page", "open google.com", "scroll to the footer"],
  },
  SUBMIT: {
    description: "Submit the current form.",
    examples: ["submit", "submit the form", "send it"],
  },
  UNKNOWN: {
    description: "The utterance did not match any supported action.",
    examples: [],
  },
};

/**
 * Candidate labels for the zero-shot classifier. UNKNOWN is deliberately
 * excluded: it's a fallback bucket for low-confidence scores, not
 * something the classifier should try to match against directly.
 */
export const ZERO_SHOT_LABELS = Object.keys(INTENT_DICTIONARY).filter((key) => key !== "UNKNOWN");
