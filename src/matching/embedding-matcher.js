import { pipeline } from "@xenova/transformers";
import "../shared/transformers-runtime.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID);
  }
  return extractorPromise;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embed(extractor, text) {
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/**
 * SPIKE: ranks candidateLabels by semantic similarity to spokenPhrase.
 * Loads the embedding model lazily on first call.
 *
 * @param {string} spokenPhrase e.g. "permanent account number"
 * @param {string[]} candidateLabels page-derived field labels (from P3's
 *        weighted label generator, once that exists)
 * @returns {Promise<Array<{label: string, score: number}>>} sorted, highest first
 */
export async function rankBySemanticSimilarity(spokenPhrase, candidateLabels) {
  const extractor = await getExtractor();
  const spokenVector = await embed(extractor, spokenPhrase);

  const scored = await Promise.all(
    candidateLabels.map(async (label) => ({
      label,
      score: cosineSimilarity(spokenVector, await embed(extractor, label)),
    }))
  );

  return scored.sort((a, b) => b.score - a.score);
}
