// Jaro-Winkler String Similarity (Month 1 Week 4)
//
// Lexical half of the field-matching engine. Per "Components Available
// vs Required to Build": "Pre-built string similarity packages
// (Jaro-Winkler)" is listed as available, but rather than pull in a
// dependency for one function this implements it directly so P3 can
// import it with zero extra install steps.
//
// Handoff: P2 -> P3, End Oct Week 4 ("Jaro-Winkler utility and synonym
// dictionary"). P3 fuses this with the semantic score in Month 2
// ("Semantic matcher finished and fused with fuzzy scores").

/**
 * Jaro similarity, in [0, 1]. Building block for jaroWinklerSimilarity -
 * exported on its own too, since it's occasionally useful without the
 * prefix boost.
 */
export function jaroSimilarity(a, b) {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatches = new Array(aLen).fill(false);
  const bMatches = new Array(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions = transpositions / 2;

  return (matches / aLen + matches / bLen + (matches - transpositions) / matches) / 3;
}

/**
 * Jaro-Winkler similarity, in [0, 1]. Boosts scores for strings that
 * share a common prefix (e.g. "phone" vs "phone number"), which matters
 * a lot for form-label matching.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} [prefixScale=0.1] standard Winkler scaling factor, capped at 0.25
 */
export function jaroWinklerSimilarity(a, b, prefixScale = 0.1) {
  const normA = (a || "").trim().toLowerCase();
  const normB = (b || "").trim().toLowerCase();
  const jaro = jaroSimilarity(normA, normB);

  let prefixLength = 0;
  const maxPrefix = Math.min(4, normA.length, normB.length);
  while (prefixLength < maxPrefix && normA[prefixLength] === normB[prefixLength]) {
    prefixLength++;
  }

  return jaro + prefixLength * Math.min(prefixScale, 0.25) * (1 - jaro);
}

/**
 * Convenience helper for P3: ranks a list of candidate page labels
 * against one spoken field description, highest similarity first.
 *
 * @param {string} spokenPhrase
 * @param {string[]} candidateLabels
 * @returns {Array<{label: string, score: number}>}
 */
export function rankByJaroWinkler(spokenPhrase, candidateLabels) {
  return candidateLabels
    .map((label) => ({ label, score: jaroWinklerSimilarity(spokenPhrase, label) }))
    .sort((a, b) => b.score - a.score);
}
