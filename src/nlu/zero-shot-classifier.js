import { pipeline } from "@xenova/transformers";
import "../shared/transformers-runtime.js";
import { ZERO_SHOT_LABELS, ZERO_SHOT_LABEL_TO_INTENT } from "./intent-dictionary.js";

const MODEL_ID = "Xenova/distilbert-base-uncased-mnli";

// Below this score we'd rather say "I didn't understand that" than act on
// a low-confidence guess - the confirmation gate (Month 2) only comes
// *after* we already picked FILL_FIELD/CLICK/etc., so guessing wrong here
// is worse than admitting UNKNOWN.
const CONFIDENCE_THRESHOLD = 0.55;

let classifierPromise = null;

/** Lazily create (and cache) a single pipeline instance. */
function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = pipeline("zero-shot-classification", MODEL_ID);
  }
  return classifierPromise;
}

/**
 * @param {string} transcript
 * @returns {Promise<{intent: string, confidence: number, source: "zero-shot", slots: object} | null>}
 *          null only on a hard failure (e.g. model failed to load);
 *          low-confidence results resolve to intent "UNKNOWN" instead.
 */
export async function classifyIntent(transcript) {
  try {
    const classifier = await getClassifier();
    const result = await classifier(transcript, ZERO_SHOT_LABELS);

    const topLabel = result.labels[0];
    const topScore = result.scores[0];
    const intent = ZERO_SHOT_LABEL_TO_INTENT[topLabel] ?? "UNKNOWN";

    if (topScore < CONFIDENCE_THRESHOLD) {
      return { intent: "UNKNOWN", confidence: topScore, source: "zero-shot", slots: {} };
    }

    return { intent, confidence: topScore, source: "zero-shot", slots: {} };
  } catch (err) {
    console.error("[VERBA][NLU] Zero-shot classification failed:", err);
    return null;
  }
}
