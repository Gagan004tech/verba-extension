// Command Understanding entry point (Module B, P2).
//
// Regex first (fast, deterministic) -> zero-shot fallback (handles
// paraphrased / unanticipated phrasing) -> UNKNOWN. This is the function
// the background broker calls on every TRANSCRIPT_STREAM message.

import { matchRegexIntent } from "./regex-intents.js";
import { extractSlots } from "./slot-extractor.js";
import { classifyIntent } from "./zero-shot-classifier.js";

/**
 * @param {string} transcript raw text from the Web Speech API or the
 *        manual-input fallback in the side panel
 * @returns {Promise<{intent: string, confidence: number, source: string, slots: object}>}
 */
export async function parseIntent(transcript) {
  if (!transcript || !transcript.trim()) {
    return { intent: "UNKNOWN", confidence: 0, source: "empty", slots: {} };
  }

  const regexResult = matchRegexIntent(transcript);
  if (regexResult) {
    const slots = regexResult.intent === "FILL_FIELD" ? extractSlots(regexResult.slots) : regexResult.slots;
    return { ...regexResult, slots };
  }

  const zeroShotResult = await classifyIntent(transcript);
  return zeroShotResult ?? { intent: "UNKNOWN", confidence: 0, source: "error", slots: {} };
}
