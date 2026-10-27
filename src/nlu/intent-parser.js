// Command Understanding entry point (Module B, P2).
//
// Regex first (fast, deterministic) -> zero-shot fallback (handles
// paraphrased / unanticipated phrasing) -> UNKNOWN.

import { matchRegexIntent, matchCompoundRegexIntents } from "./regex-intents.js";
import { extractSlots, extractSlotsLoosely } from "./slot-extractor.js";
import { classifyIntent } from "./zero-shot-classifier.js";

function finalizeRegexMatch(regexResult) {
  const slots = regexResult.intent === "FILL_FIELD" ? extractSlots(regexResult.slots) : regexResult.slots;
  return { ...regexResult, slots };
}

/**
 * @param {string} transcript raw text from the Web Speech API or the
 *        manual-input fallback in the side panel
 * @returns {Promise<Array<{intent: string, confidence: number, source: string, slots: object}>>}
 *          Always an array. Length 1 for an ordinary single command.
 *          Length >1 only for a compound command ("fill name as Alex and
 *          click submit") where EVERY clause independently matched a
 *          regex pattern on its own - see matchCompoundRegexIntents in
 *          regex-intents.js for why that's conservative on purpose.
 *
 *          NOTE for whoever wires this into the background broker: the
 *          existing single-result parseIntent() below only acts on the
 *          first element. Looping over this array to execute every clause
 *          of a compound command is still an open integration task.
 */
export async function parseIntents(transcript) {
  const text = (transcript || "").trim();
  if (!text) {
    return [{ intent: "UNKNOWN", confidence: 0, source: "empty", slots: {} }];
  }

  const compound = matchCompoundRegexIntents(text);
  if (compound) {
    return compound.map(finalizeRegexMatch);
  }

  const regexResult = matchRegexIntent(text);
  if (regexResult) {
    return [finalizeRegexMatch(regexResult)];
  }

  const zeroShotResult = await classifyIntent(text);
  if (zeroShotResult?.intent === "FILL_FIELD") {
    // Regex couldn't parse the sentence's *structure* (that's why we're
    // here), but we know the intent now - worth a looser, best-effort
    // slot extraction instead of handing back empty slots unconditionally.
    return [{ ...zeroShotResult, slots: extractSlotsLoosely(text) }];
  }

  return [zeroShotResult ?? { intent: "UNKNOWN", confidence: 0, source: "error", slots: {} }];
}

/**
 * Backward-compatible single-result entry point - this is what the
 * background broker currently calls on every TRANSCRIPT_STREAM message.
 * A compound utterance still only acts on its first clause until the
 * broker is updated to consume parseIntents() directly.
 *
 * @param {string} transcript
 * @returns {Promise<{intent: string, confidence: number, source: string, slots: object}>}
 */
export async function parseIntent(transcript) {
  const [first] = await parseIntents(transcript);
  return first;
}
