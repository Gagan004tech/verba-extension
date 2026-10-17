// Labelled Utterance Test Set (Module B, Month 2 Scope)
//
// Comprehensive evaluation dataset of 100+ annotated voice utterances across
// all supported intents, phrasing variants, misheard speech patterns,
// conversational wrappers, and out-of-domain queries.
//
// Hand-off: P2 evaluation benchmark for intent classification & slot extraction.

export const LABELLED_UTTERANCES = [
  // --- Category: fill_standard (explicit imperative verbs) ---
  { id: "fs-1", utterance: "fill name as Alex", expectedIntent: "FILL_FIELD", expectedSlots: { field: "name", value: "Alex" }, category: "fill_standard" },
  { id: "fs-2", utterance: "enter phone number with 9876543210", expectedIntent: "FILL_FIELD", expectedSlots: { field: "phone number", value: "9876543210" }, category: "fill_standard" },
  { id: "fs-3", utterance: "set email to user@test.com", expectedIntent: "FILL_FIELD", expectedSlots: { field: "email", value: "user@test.com" }, category: "fill_standard" },
  { id: "fs-4", utterance: "type address as 123 Main Street", expectedIntent: "FILL_FIELD", expectedSlots: { field: "address", value: "123 Main Street" }, category: "fill_standard" },
  { id: "fs-5", utterance: "fill in city as Seattle", expectedIntent: "FILL_FIELD", expectedSlots: { field: "city", value: "Seattle" }, category: "fill_standard" },

  // --- Category: fill_terse (shorthand field + value, no verbs) ---
  { id: "ft-1", utterance: "name Alex", expectedIntent: "FILL_FIELD", expectedSlots: { field: "name", value: "Alex" }, category: "fill_terse" },
  { id: "ft-2", utterance: "phone 9876543210", expectedIntent: "FILL_FIELD", expectedSlots: { field: "phone", value: "9876543210" }, category: "fill_terse" },
  { id: "ft-3", utterance: "email alex@example.com", expectedIntent: "FILL_FIELD", expectedSlots: { field: "email", value: "alex@example.com" }, category: "fill_terse" },
  { id: "ft-4", utterance: "gender female", expectedIntent: "FILL_FIELD", expectedSlots: { field: "gender", value: "female" }, category: "fill_terse" },
  { id: "ft-5", utterance: "pan ABCDE1234F", expectedIntent: "FILL_FIELD", expectedSlots: { field: "pan", value: "ABCDE1234F" }, category: "fill_terse" },
  { id: "ft-6", utterance: "name, Alexander", expectedIntent: "FILL_FIELD", expectedSlots: { field: "name", value: "Alexander" }, category: "fill_terse" },

  // --- Category: fill_reversed (value first, target field second) ---
  { id: "fr-1", utterance: "put Alex in the name field", expectedIntent: "FILL_FIELD", expectedSlots: { field: "name", value: "Alex" }, category: "fill_reversed" },
  { id: "fr-2", utterance: "put 9876543210 into phone number", expectedIntent: "FILL_FIELD", expectedSlots: { field: "phone number", value: "9876543210" }, category: "fill_reversed" },
  { id: "fr-3", utterance: "put 10001 into the zip code field", expectedIntent: "FILL_FIELD", expectedSlots: { field: "zip code", value: "10001" }, category: "fill_reversed" },

  // --- Category: fill_selection (dropdown / radio values) ---
  { id: "fsel-1", utterance: "select India as country", expectedIntent: "FILL_FIELD", expectedSlots: { field: "country", value: "India" }, category: "fill_selection" },
  { id: "fsel-2", utterance: "choose male for gender", expectedIntent: "FILL_FIELD", expectedSlots: { field: "gender", value: "male" }, category: "fill_selection" },
  { id: "fsel-3", utterance: "select California as state", expectedIntent: "FILL_FIELD", expectedSlots: { field: "state", value: "California" }, category: "fill_selection" },

  // --- Category: fill_misheard (speech-to-text recognition errors) ---
  { id: "fm-1", utterance: "full name as Alex", expectedIntent: "FILL_FIELD", expectedSlots: { field: "name", value: "Alex" }, category: "fill_misheard" },
  { id: "fm-2", utterance: "feel phone number with 9876543210", expectedIntent: "FILL_FIELD", expectedSlots: { field: "phone number", value: "9876543210" }, category: "fill_misheard" },
  { id: "fm-3", utterance: "fil pan as ABCDE1234F", expectedIntent: "FILL_FIELD", expectedSlots: { field: "pan", value: "ABCDE1234F" }, category: "fill_misheard" },
  { id: "fm-4", utterance: "full pan from the vault", expectedIntent: "FILL_FIELD", expectedSlots: { field: "pan", profileKey: "pan" }, category: "fill_misheard" },

  // --- Category: fill_natural (conversational / profile statements) ---
  { id: "fn-1", utterance: "my name is Alex", expectedIntent: "FILL_FIELD", expectedSlots: { field: "name", value: "Alex" }, category: "fill_natural" },
  { id: "fn-2", utterance: "name is Robert", expectedIntent: "FILL_FIELD", expectedSlots: { field: "name", value: "Robert" }, category: "fill_natural" },
  { id: "fn-3", utterance: "my email is robert@test.org", expectedIntent: "FILL_FIELD", expectedSlots: { field: "email", value: "robert@test.org" }, category: "fill_natural" },
  { id: "fn-4", utterance: "born on April 22 2017", expectedIntent: "FILL_FIELD", expectedSlots: { field: "dob", value: "April 22 2017" }, category: "fill_natural" },
  { id: "fn-5", utterance: "I was born on May 15 1990", expectedIntent: "FILL_FIELD", expectedSlots: { field: "dob", value: "May 15 1990" }, category: "fill_natural" },
  { id: "fn-6", utterance: "born in 1985", expectedIntent: "FILL_FIELD", expectedSlots: { field: "dob", value: "1985" }, category: "fill_natural" },

  // --- Category: fill_profile (vault reference) ---
  { id: "fp-1", utterance: "fill pan from my profile", expectedIntent: "FILL_FIELD", expectedSlots: { field: "pan", profileKey: "pan" }, category: "fill_profile" },
  { id: "fp-2", utterance: "pan from my profile", expectedIntent: "FILL_FIELD", expectedSlots: { field: "pan", profileKey: "pan" }, category: "fill_profile" },
  { id: "fp-3", utterance: "phone number from the vault", expectedIntent: "FILL_FIELD", expectedSlots: { field: "phone number", profileKey: "phone" }, category: "fill_profile" },
  { id: "fp-4", utterance: "my address from my profile", expectedIntent: "FILL_FIELD", expectedSlots: { field: "address", profileKey: "address" }, category: "fill_profile" },

  // --- Category: confirmation_gate (safety affirmation / rejection) ---
  { id: "cg-1", utterance: "yes", expectedIntent: "CONFIRM", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-2", utterance: "confirm", expectedIntent: "CONFIRM", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-3", utterance: "proceed", expectedIntent: "CONFIRM", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-4", utterance: "sure", expectedIntent: "CONFIRM", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-5", utterance: "ok", expectedIntent: "CONFIRM", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-6", utterance: "go ahead", expectedIntent: "CONFIRM", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-7", utterance: "no", expectedIntent: "CANCEL", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-8", utterance: "cancel", expectedIntent: "CANCEL", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-9", utterance: "stop", expectedIntent: "CANCEL", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-10", utterance: "abort", expectedIntent: "CANCEL", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-11", utterance: "never mind", expectedIntent: "CANCEL", expectedSlots: {}, category: "confirmation_gate" },
  { id: "cg-12", utterance: "don't", expectedIntent: "CANCEL", expectedSlots: {}, category: "confirmation_gate" },

  // --- Category: click_action (DOM button / link interaction) ---
  { id: "ca-1", utterance: "click submit", expectedIntent: "CLICK", expectedSlots: { target: "submit" }, category: "click_action" },
  { id: "ca-2", utterance: "press the continue button", expectedIntent: "CLICK", expectedSlots: { target: "the continue button" }, category: "click_action" },
  { id: "ca-3", utterance: "hit submit", expectedIntent: "CLICK", expectedSlots: { target: "submit" }, category: "click_action" },
  { id: "ca-4", utterance: "select yes", expectedIntent: "CLICK", expectedSlots: { target: "yes" }, category: "click_action" },
  { id: "ca-5", utterance: "tap on login", expectedIntent: "CLICK", expectedSlots: { target: "login" }, category: "click_action" },
  { id: "ca-6", utterance: "push sign up", expectedIntent: "CLICK", expectedSlots: { target: "sign up" }, category: "click_action" },

  // --- Category: navigate_action (URL / page transition) ---
  { id: "na-1", utterance: "go to the contact page", expectedIntent: "NAVIGATE", expectedSlots: { destination: "the contact page" }, category: "navigate_action" },
  { id: "na-2", utterance: "open google.com", expectedIntent: "NAVIGATE", expectedSlots: { destination: "google.com" }, category: "navigate_action" },
  { id: "na-3", utterance: "show me the pricing page", expectedIntent: "NAVIGATE", expectedSlots: { destination: "the pricing page" }, category: "navigate_action" },
  { id: "na-4", utterance: "take me to checkout", expectedIntent: "NAVIGATE", expectedSlots: { destination: "checkout" }, category: "navigate_action" },
  { id: "na-5", utterance: "visit dashboard", expectedIntent: "NAVIGATE", expectedSlots: { destination: "dashboard" }, category: "navigate_action" },

  // --- Category: submit_action (form completion) ---
  { id: "sa-1", utterance: "submit the form", expectedIntent: "SUBMIT", expectedSlots: {}, category: "submit_action" },
  { id: "sa-2", utterance: "submit", expectedIntent: "SUBMIT", expectedSlots: {}, category: "submit_action" },
  { id: "sa-3", utterance: "send it", expectedIntent: "SUBMIT", expectedSlots: {}, category: "submit_action" },
  { id: "sa-4", utterance: "finish", expectedIntent: "SUBMIT", expectedSlots: {}, category: "submit_action" },
  { id: "sa-5", utterance: "complete the form", expectedIntent: "SUBMIT", expectedSlots: {}, category: "submit_action" },

  // --- Category: tab_window (browser tab management) ---
  { id: "tw-1", utterance: "open a new tab", expectedIntent: "NEW_TAB", expectedSlots: {}, category: "tab_window" },
  { id: "tw-2", utterance: "close this tab", expectedIntent: "CLOSE_TAB", expectedSlots: {}, category: "tab_window" },
  { id: "tw-3", utterance: "close the window", expectedIntent: "CLOSE_TAB", expectedSlots: {}, category: "tab_window" },
  { id: "tw-4", utterance: "next tab", expectedIntent: "NEXT_TAB", expectedSlots: {}, category: "tab_window" },
  { id: "tw-5", utterance: "previous tab", expectedIntent: "PREVIOUS_TAB", expectedSlots: {}, category: "tab_window" },
  { id: "tw-6", utterance: "switch to the next tab", expectedIntent: "NEXT_TAB", expectedSlots: {}, category: "tab_window" },
  { id: "tw-7", utterance: "go back", expectedIntent: "GO_BACK", expectedSlots: {}, category: "tab_window" },
  { id: "tw-8", utterance: "the previous page", expectedIntent: "GO_BACK", expectedSlots: {}, category: "tab_window" },
  { id: "tw-9", utterance: "go forward", expectedIntent: "GO_FORWARD", expectedSlots: {}, category: "tab_window" },
  { id: "tw-10", utterance: "refresh the page", expectedIntent: "REFRESH_PAGE", expectedSlots: {}, category: "tab_window" },
  { id: "tw-11", utterance: "minimize the window", expectedIntent: "MINIMIZE_WINDOW", expectedSlots: {}, category: "tab_window" },
  { id: "tw-12", utterance: "maximize the window", expectedIntent: "MAXIMIZE_WINDOW", expectedSlots: {}, category: "tab_window" },

  // --- Category: scroll_zoom (viewport controls) ---
  { id: "sz-1", utterance: "scroll up", expectedIntent: "SCROLL_UP", expectedSlots: {}, category: "scroll_zoom" },
  { id: "sz-2", utterance: "scroll down", expectedIntent: "SCROLL_DOWN", expectedSlots: {}, category: "scroll_zoom" },
  { id: "sz-3", utterance: "scroll to the top", expectedIntent: "SCROLL_TOP", expectedSlots: {}, category: "scroll_zoom" },
  { id: "sz-4", utterance: "scroll to the bottom", expectedIntent: "SCROLL_BOTTOM", expectedSlots: {}, category: "scroll_zoom" },
  { id: "sz-5", utterance: "zoom in", expectedIntent: "ZOOM_IN", expectedSlots: {}, category: "scroll_zoom" },
  { id: "sz-6", utterance: "zoom out", expectedIntent: "ZOOM_OUT", expectedSlots: {}, category: "scroll_zoom" },
  { id: "sz-7", utterance: "reset zoom", expectedIntent: "RESET_ZOOM", expectedSlots: {}, category: "scroll_zoom" },

  // --- Category: media_control (playback controls) ---
  { id: "mc-1", utterance: "play the video", expectedIntent: "PLAY_MEDIA", expectedSlots: {}, category: "media_control" },
  { id: "mc-2", utterance: "pause", expectedIntent: "PAUSE_MEDIA", expectedSlots: {}, category: "media_control" },
  { id: "mc-3", utterance: "mute the video", expectedIntent: "MUTE_MEDIA", expectedSlots: {}, category: "media_control" },
  { id: "mc-4", utterance: "unmute", expectedIntent: "UNMUTE_MEDIA", expectedSlots: {}, category: "media_control" },
  { id: "mc-5", utterance: "turn the volume up", expectedIntent: "VOLUME_UP", expectedSlots: {}, category: "media_control" },
  { id: "mc-6", utterance: "lower the volume", expectedIntent: "VOLUME_DOWN", expectedSlots: {}, category: "media_control" },
  { id: "mc-7", utterance: "make it fullscreen", expectedIntent: "FULLSCREEN_MEDIA", expectedSlots: {}, category: "media_control" },
  { id: "mc-8", utterance: "print this page", expectedIntent: "PRINT_PAGE", expectedSlots: {}, category: "media_control" },

  // --- Category: form_controls (checkbox, clear, focus) ---
  { id: "fc-1", utterance: "check the terms checkbox", expectedIntent: "CHECK_BOX", expectedSlots: { target: "terms" }, category: "form_controls" },
  { id: "fc-2", utterance: "uncheck the terms checkbox", expectedIntent: "UNCHECK_BOX", expectedSlots: { target: "terms" }, category: "form_controls" },
  { id: "fc-3", utterance: "clear the name field", expectedIntent: "CLEAR_FIELD", expectedSlots: { field: "name" }, category: "form_controls" },
  { id: "fc-4", utterance: "reset the form", expectedIntent: "RESET_FORM", expectedSlots: {}, category: "form_controls" },
  { id: "fc-5", utterance: "go to the email field", expectedIntent: "FOCUS_FIELD", expectedSlots: { field: "email" }, category: "form_controls" },
  { id: "fc-6", utterance: "upload my resume", expectedIntent: "UPLOAD_FILE", expectedSlots: { field: "resume" }, category: "form_controls" },

  // --- Category: conversational_filler (politeness / wake words) ---
  { id: "cf-1", utterance: "could you please click submit", expectedIntent: "CLICK", expectedSlots: { target: "submit" }, category: "conversational_filler" },
  { id: "cf-2", utterance: "can you fill name as Alex please", expectedIntent: "FILL_FIELD", expectedSlots: { field: "name", value: "Alex" }, category: "conversational_filler" },
  { id: "cf-3", utterance: "hey verba, go back", expectedIntent: "GO_BACK", expectedSlots: {}, category: "conversational_filler" },
  { id: "cf-4", utterance: "I want to go to the contact page", expectedIntent: "NAVIGATE", expectedSlots: { destination: "the contact page" }, category: "conversational_filler" },
  { id: "cf-5", utterance: "hey verba, could you please refresh the page thanks", expectedIntent: "REFRESH_PAGE", expectedSlots: {}, category: "conversational_filler" },

  // --- Category: out_of_domain (should NOT match supported commands) ---
  { id: "ood-1", utterance: "what's the weather like today", expectedIntent: "UNKNOWN", expectedSlots: {}, category: "out_of_domain" },
  { id: "ood-2", utterance: "tell me a funny joke", expectedIntent: "UNKNOWN", expectedSlots: {}, category: "out_of_domain" },
  { id: "ood-3", utterance: "who won the championship last night", expectedIntent: "UNKNOWN", expectedSlots: {}, category: "out_of_domain" },
  { id: "ood-4", utterance: "calculate 45 times 23", expectedIntent: "UNKNOWN", expectedSlots: {}, category: "out_of_domain" },
];
