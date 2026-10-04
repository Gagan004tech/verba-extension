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

  // --- Browser / page / media control --------------------------------
  // Not in the Month 1-3 roadmap's FILL/CLICK/NAVIGATE/SUBMIT list, but
  // explicitly in the project abstract's stated scope (tab management,
  // scrolling, back/forward, bookmarks/history, reading aloud, media
  // playback). All deterministic regex matches in practice - the
  // zeroShotLabel here is just a safety net for paraphrases the regex
  // patterns in regex-intents.js don't happen to cover.
  NEW_TAB: { description: "Open a new browser tab.", examples: ["open a new tab"], zeroShotLabel: "opening a new browser tab" },
  CLOSE_TAB: { description: "Close the current tab or window.", examples: ["close this tab", "close the window"], zeroShotLabel: "closing the current browser tab or window" },
  NEXT_TAB: { description: "Switch to the next browser tab.", examples: ["next tab"], zeroShotLabel: "switching to the next browser tab" },
  PREVIOUS_TAB: { description: "Switch to the previous browser tab.", examples: ["previous tab"], zeroShotLabel: "switching to the previous browser tab" },
  GO_BACK: { description: "Go back to the previous page in history.", examples: ["go back"], zeroShotLabel: "going back to the previous page in browser history" },
  GO_FORWARD: { description: "Go forward to the next page in history.", examples: ["go forward"], zeroShotLabel: "going forward to the next page in browser history" },
  REFRESH_PAGE: { description: "Reload the current page.", examples: ["refresh the page"], zeroShotLabel: "refreshing or reloading the current page" },
  MINIMIZE_WINDOW: { description: "Minimize the browser window.", examples: ["minimize the window"], zeroShotLabel: "minimizing the browser window" },
  MAXIMIZE_WINDOW: { description: "Maximize the browser window.", examples: ["maximize the window"], zeroShotLabel: "maximizing the browser window" },
  SCROLL_UP: { description: "Scroll up on the current page.", examples: ["scroll up"], zeroShotLabel: "scrolling up on the current page" },
  SCROLL_DOWN: { description: "Scroll down on the current page.", examples: ["scroll down"], zeroShotLabel: "scrolling down on the current page" },
  SCROLL_TOP: { description: "Scroll to the top of the page.", examples: ["scroll to the top"], zeroShotLabel: "scrolling to the very top of the page" },
  SCROLL_BOTTOM: { description: "Scroll to the bottom of the page.", examples: ["scroll to the bottom"], zeroShotLabel: "scrolling to the very bottom of the page" },
  ZOOM_IN: { description: "Zoom in on the page.", examples: ["zoom in"], zeroShotLabel: "zooming in on the page" },
  ZOOM_OUT: { description: "Zoom out on the page.", examples: ["zoom out"], zeroShotLabel: "zooming out on the page" },
  RESET_ZOOM: { description: "Reset the page zoom level.", examples: ["reset zoom"], zeroShotLabel: "resetting the page zoom level back to normal" },
  FIND_ON_PAGE: { description: "Search for text within the current page.", examples: ["find discount on the page"], zeroShotLabel: "finding or searching for specific text on the current page" },
  BOOKMARK_PAGE: { description: "Bookmark the current page.", examples: ["bookmark this page"], zeroShotLabel: "bookmarking or saving the current page" },
  READ_PAGE: { description: "Read the page content aloud via text-to-speech.", examples: ["read this page to me"], zeroShotLabel: "reading the page content aloud" },
  PLAY_MEDIA: { description: "Play in-page video or audio.", examples: ["play the video"], zeroShotLabel: "playing a video or audio on the page" },
  PAUSE_MEDIA: { description: "Pause in-page video or audio.", examples: ["pause the video"], zeroShotLabel: "pausing a video or audio on the page" },
  MUTE_MEDIA: { description: "Mute in-page video or audio.", examples: ["mute the video"], zeroShotLabel: "muting a video or audio on the page" },
  UNMUTE_MEDIA: { description: "Unmute in-page video or audio.", examples: ["unmute the video"], zeroShotLabel: "unmuting a video or audio on the page" },
  VOLUME_UP: { description: "Increase media volume.", examples: ["turn the volume up"], zeroShotLabel: "increasing the media volume" },
  VOLUME_DOWN: { description: "Decrease media volume.", examples: ["turn the volume down"], zeroShotLabel: "decreasing the media volume" },
  FULLSCREEN_MEDIA: { description: "Make in-page media fullscreen.", examples: ["make it fullscreen"], zeroShotLabel: "making a video fullscreen" },
  PRINT_PAGE: { description: "Print the current page.", examples: ["print this page"], zeroShotLabel: "printing the current page" },

  // --- Form interaction beyond plain FILL_FIELD -------------------------
  CHECK_BOX: { description: "Check/tick a checkbox.", examples: ["check the terms checkbox"], zeroShotLabel: "checking or ticking a checkbox" },
  UNCHECK_BOX: { description: "Uncheck/untick a checkbox.", examples: ["uncheck the terms checkbox"], zeroShotLabel: "unchecking or unticking a checkbox" },
  UPLOAD_FILE: { description: "Upload or attach a file to a field.", examples: ["upload my resume"], zeroShotLabel: "uploading or attaching a file" },
  CLEAR_FIELD: { description: "Clear the contents of one form field.", examples: ["clear the name field"], zeroShotLabel: "clearing or emptying a single form field" },
  RESET_FORM: { description: "Clear every field on the form.", examples: ["reset the form"], zeroShotLabel: "resetting or clearing the entire form" },
  FOCUS_FIELD: { description: "Move keyboard focus to a field without filling it.", examples: ["go to the email field"], zeroShotLabel: "moving focus to a specific form field" },
  READ_SECTION: { description: "Read a named page section aloud.", examples: ["read out loud the introduction"], zeroShotLabel: "reading a specific named section of the page aloud" },

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
