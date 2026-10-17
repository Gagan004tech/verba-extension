import { pipeline } from "@xenova/transformers";
import "../shared/transformers-runtime.js";
import { ZERO_SHOT_LABELS, ZERO_SHOT_LABEL_TO_INTENT } from "./intent-dictionary.js";

const MODEL_ID = "Xenova/distilbert-base-uncased-mnli";

// DistilBERT-MNLI distributes softmax probabilities across 30+ candidate hypothesis
// labels (uniform baseline ~0.03). A top score >= 0.25 represents an overwhelming
// probability relative to the candidate pool (often 8x-15x above random distribution).
const CONFIDENCE_THRESHOLD = 0.25;

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
