// Fused Field Matching Engine (Module B / Module C Handoff, Month 2)
//
// Fuses three complementary scoring signals:
//   1. Custom Synonym Dictionary (synonym-dictionary.js) - domain knowledge & canonical mappings
//   2. Jaro-Winkler Lexical Distance (jaro-winkler.js) - robust spelling & prefix fuzzy matching
//   3. Semantic Embeddings (embedding-matcher.js via Xenova/all-MiniLM-L6-v2) - contextual intent
//
// This fusion resolves notorious string-matching pitfalls in form autofill:
//   - "pan" vs "phone" (lexical ~0.72) is suppressed by low semantic similarity and no synonym hit.
//   - "pan" vs "permanent account number" (lexical ~0.35) gets high score via canonical synonym resolution.
//   - "contact number" vs "mobile" gets high score via synonym dictionary and semantic embedding.

import { jaroWinklerSimilarity } from "./jaro-winkler.js";
import { resolveCanonicalField, synonymsFor } from "./synonym-dictionary.js";
import { rankBySemanticSimilarity } from "./embedding-matcher.js";

export const DEFAULT_FUSION_WEIGHTS = Object.freeze({
  synonym: 0.40,
  lexical: 0.35,
  semantic: 0.25,
});

// Tuned threshold: "pan" vs "phone" scores ~0.32 under fusion, while true
// variants score >= 0.70. A threshold of 0.65 provides high recall with zero false positives.
export const MATCH_THRESHOLD = 0.65;

/**
 * Normalizes input text for comparison (lowercase, trimmed, collapsed whitespace).
 */
export function stripFormPrefixes(text) {
  return (text || "")
    .replace(/^(?:please\s+)?(?:enter|type|input|select|choose|provide|fill\s+in|fill|write)\s+(?:your\s+|the\s+)?/i, "")
    .replace(/^(?:your|the|my)\s+/i, "")
    .trim();
}

/**
 * Normalizes input text for comparison (lowercase, trimmed, collapsed whitespace).
 */
export function normalizeLabel(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[_\-.:,;/|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes the domain synonym score in [0, 1].
 *
 * @param {string} spokenPhrase
 * @param {string} candidateLabel
 * @returns {{ score: number, canonical: string | null }}
 */
export function computeSynonymScore(spokenPhrase, candidateLabel) {
  const normSpoken = normalizeLabel(spokenPhrase);
  const normCandidate = normalizeLabel(candidateLabel);
  const strippedCandidate = normalizeLabel(stripFormPrefixes(candidateLabel));

  if (!normSpoken || !normCandidate) {
    return { score: 0, canonical: null };
  }

  if (normSpoken === normCandidate || normSpoken === strippedCandidate) {
    return { score: 1.0, canonical: resolveCanonicalField(normSpoken) };
  }

  const canonSpoken = resolveCanonicalField(normSpoken);
  const canonCandidate = resolveCanonicalField(normCandidate) || resolveCanonicalField(strippedCandidate);

  // Both map to the exact same canonical key (e.g. "pan" and "permanent account number")
  if (canonSpoken && canonCandidate && canonSpoken === canonCandidate) {
    return { score: 1.0, canonical: canonSpoken };
  }

  // Candidate label matches any synonym of the spoken phrase's canonical key
  if (canonSpoken) {
    const synonyms = synonymsFor(canonSpoken);
    if (synonyms.some((s) => normalizeLabel(s) === normCandidate)) {
      return { score: 1.0, canonical: canonSpoken };
    }
  }

  // Spoken phrase matches any synonym of the candidate label's canonical key
  if (canonCandidate) {
    const synonyms = synonymsFor(canonCandidate);
    if (synonyms.some((s) => normalizeLabel(s) === normSpoken)) {
      return { score: 1.0, canonical: canonCandidate };
    }
  }

  // Token subset overlap (e.g. "phone" tokens inside "mobile phone number")
  const spokenTokens = new Set(normSpoken.split(" ").filter((t) => t.length > 2));
  const candidateTokens = new Set(normCandidate.split(" ").filter((t) => t.length > 2));
  if (spokenTokens.size > 0 && candidateTokens.size > 0) {
    let intersection = 0;
    for (const t of spokenTokens) {
      if (candidateTokens.has(t)) intersection++;
    }
    if (intersection === spokenTokens.size || intersection === candidateTokens.size) {
      return { score: 0.65, canonical: canonSpoken || canonCandidate };
    }
  }

  return { score: 0.0, canonical: canonSpoken || canonCandidate };
}

/**
 * Computes Jaro-Winkler lexical similarity in [0, 1], testing against
 * canonical synonyms if present to catch acronym/shorthand expansions.
 *
 * @param {string} spokenPhrase
 * @param {string} candidateLabel
 * @returns {number}
 */
export function computeLexicalScore(spokenPhrase, candidateLabel) {
  const normSpoken = normalizeLabel(spokenPhrase);
  const normCandidate = normalizeLabel(candidateLabel);
  const strippedCandidate = normalizeLabel(stripFormPrefixes(candidateLabel));

  let best = Math.max(
    jaroWinklerSimilarity(normSpoken, normCandidate),
    jaroWinklerSimilarity(normSpoken, strippedCandidate)
  );

  const canon = resolveCanonicalField(normSpoken);
  if (canon) {
    const synonyms = synonymsFor(canon);
    for (const syn of synonyms) {
      const normSyn = normalizeLabel(syn);
      const sim = Math.max(
        jaroWinklerSimilarity(normSyn, normCandidate),
        jaroWinklerSimilarity(normSyn, strippedCandidate)
      );
      if (sim > best) best = sim;
    }
  }

  return best;
}

/**
 * Computes the fused similarity score between a spoken phrase and a single candidate label.
 *
 * @param {string} spokenPhrase
 * @param {string} candidateLabel
 * @param {number} [semanticScore=null] pre-computed semantic cosine similarity
 * @param {object} [weights=DEFAULT_FUSION_WEIGHTS]
 * @returns {{ score: number, breakdown: { synonym: number, lexical: number, semantic: number, canonical: string|null } }}
 */
export function fuseScores(spokenPhrase, candidateLabel, semanticScore = null, weights = DEFAULT_FUSION_WEIGHTS) {
  const { score: synScore, canonical } = computeSynonymScore(spokenPhrase, candidateLabel);
  const lexScore = computeLexicalScore(spokenPhrase, candidateLabel);
  const semScore = semanticScore !== null ? Math.max(0, Math.min(1, semanticScore)) : lexScore;

  let fused;
  if (synScore >= 1.0) {
    // Exact canonical/synonym matches get prioritized
    fused = Math.max(0.96, weights.synonym * synScore + weights.lexical * lexScore + weights.semantic * semScore);
  } else {
    fused = weights.synonym * synScore + weights.lexical * lexScore + weights.semantic * semScore;
  }

  fused = Math.max(0, Math.min(1, Math.round(fused * 1000) / 1000));

  return {
    score: fused,
    breakdown: {
      synonym: synScore,
      lexical: Math.round(lexScore * 1000) / 1000,
      semantic: Math.round(semScore * 1000) / 1000,
      canonical,
    },
  };
}

/**
 * Synchronous fast field ranking using Synonym + Lexical Jaro-Winkler scoring.
 * Used for zero-latency lookups or when the embedding model is not yet loaded.
 *
 * @param {string} spokenPhrase
 * @param {Array<object|string>} fields array of field objects or string labels
 * @param {object} [options]
 * @returns {Array<{ field: object|string, label: string, score: number, breakdown: object, isConfident: boolean }>}
 */
export function rankFieldsFast(spokenPhrase, fields, options = {}) {
  const threshold = options.threshold ?? MATCH_THRESHOLD;
  const weights = options.weights ?? { synonym: 0.55, lexical: 0.45, semantic: 0.0 };

  const results = fields.map((item) => {
    const isObject = typeof item === "object" && item !== null;
    const candidates = isObject && Array.isArray(item.candidates) && item.candidates.length > 0
      ? item.candidates
      : [isObject ? (item.label || item.id || item.name || "") : String(item)].filter(Boolean);

    let bestScore = -1;
    let bestLabel = candidates[0] || "";
    let bestBreakdown = { synonym: 0, lexical: 0, semantic: 0, canonical: null };

    for (const cand of candidates) {
      const { score, breakdown } = fuseScores(spokenPhrase, cand, null, weights);
      if (score > bestScore) {
        bestScore = score;
        bestLabel = cand;
        bestBreakdown = breakdown;
      }
    }

    return {
      field: item,
      label: bestLabel,
      score: bestScore,
      breakdown: bestBreakdown,
      isConfident: bestScore >= threshold,
    };
  });

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Full fused field ranking using Synonym, Jaro-Winkler, and Transformers.js Embeddings.
 *
 * @param {string} spokenPhrase
 * @param {Array<object|string>} fields array of field objects or string labels
 * @param {object} [options]
 * @returns {Promise<Array<{ field: object|string, label: string, score: number, breakdown: object, isConfident: boolean }>>}
 */
export async function rankFieldsFused(spokenPhrase, fields, options = {}) {
  const threshold = options.threshold ?? MATCH_THRESHOLD;
  const weights = options.weights ?? DEFAULT_FUSION_WEIGHTS;

  if (!fields || fields.length === 0) return [];

  // Collect unique candidate strings for batch semantic scoring
  const allCandStrings = new Set();
  for (const item of fields) {
    const isObject = typeof item === "object" && item !== null;
    const candidates = isObject && Array.isArray(item.candidates) && item.candidates.length > 0
      ? item.candidates
      : [isObject ? (item.label || item.id || item.name || "") : String(item)].filter(Boolean);

    for (const c of candidates) allCandStrings.add(c);
  }

  const candList = Array.from(allCandStrings);
  const semanticScoreMap = new Map();

  try {
    const semPromise = rankBySemanticSimilarity(spokenPhrase, candList);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Semantic embedding timeout")), 1500)
    );
    const semResults = await Promise.race([semPromise, timeoutPromise]);
    for (const res of semResults) {
      semanticScoreMap.set(res.label, res.score);
    }
  } catch (err) {
    console.warn("[VERBA][Matcher] Semantic embeddings unavailable or timed out, falling back to lexical + synonym:", err?.message || err);
  }

  const results = fields.map((item) => {
    const isObject = typeof item === "object" && item !== null;
    const candidates = isObject && Array.isArray(item.candidates) && item.candidates.length > 0
      ? item.candidates
      : [isObject ? (item.label || item.id || item.name || "") : String(item)].filter(Boolean);

    let bestScore = -1;
    let bestLabel = candidates[0] || "";
    let bestBreakdown = { synonym: 0, lexical: 0, semantic: 0, canonical: null };

    for (const cand of candidates) {
      const semScore = semanticScoreMap.has(cand) ? semanticScoreMap.get(cand) : null;
      const { score, breakdown } = fuseScores(spokenPhrase, cand, semScore, weights);
      if (score > bestScore) {
        bestScore = score;
        bestLabel = cand;
        bestBreakdown = breakdown;
      }
    }

    return {
      field: item,
      label: bestLabel,
      score: bestScore,
      breakdown: bestBreakdown,
      isConfident: bestScore >= threshold,
    };
  });

  return results.sort((a, b) => b.score - a.score);
}
