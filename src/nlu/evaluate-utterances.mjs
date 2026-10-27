// Benchmark Evaluator for Module B (Command Understanding)
// Evaluates intent classification & slot extraction against the Labelled Utterance Dataset.
//
// Run: node src/nlu/evaluate-utterances.mjs

import { matchRegexIntent } from "./regex-intents.js";
import { extractSlots } from "./slot-extractor.js";
import { LABELLED_UTTERANCES } from "./labelled-utterance-dataset.js";

console.log("=== MODULE B NLU BENCHMARK EVALUATOR ===\n");
console.log(`Evaluating ${LABELLED_UTTERANCES.length} labelled voice utterances...\n`);

let correctIntents = 0;
let correctSlots = 0;
let totalSlotsChecked = 0;
let totalTimeMs = 0;

const categoryStats = new Map();

function checkSlotsMatch(gotSlots, wantSlots) {
  for (const [key, expectedVal] of Object.entries(wantSlots)) {
    totalSlotsChecked++;
    const actualVal = gotSlots[key];
    if (actualVal === expectedVal) {
      correctSlots++;
    } else {
      return false;
    }
  }
  return true;
}

const failures = [];

for (const testCase of LABELLED_UTTERANCES) {
  const { id, utterance, expectedIntent, expectedSlots, category } = testCase;

  if (!categoryStats.has(category)) {
    categoryStats.set(category, { total: 0, intentPassed: 0, slotPassed: 0 });
  }
  const cat = categoryStats.get(category);
  cat.total++;

  const t0 = performance.now();
  const regexResult = matchRegexIntent(utterance);
  const t1 = performance.now();
  totalTimeMs += (t1 - t0);

  const intent = regexResult ? regexResult.intent : "UNKNOWN";
  const rawSlots = regexResult ? regexResult.slots : {};
  const slots = intent === "FILL_FIELD" ? extractSlots(rawSlots) : rawSlots;

  const intentOk = intent === expectedIntent;
  const slotOk = checkSlotsMatch(slots, expectedSlots);

  if (intentOk) {
    correctIntents++;
    cat.intentPassed++;
  }
  if (slotOk) {
    cat.slotPassed++;
  }

  if (!intentOk || !slotOk) {
    failures.push({
      id,
      utterance,
      category,
      expected: { intent: expectedIntent, slots: expectedSlots },
      got: { intent, slots },
    });
  }
}

// Category breakdown table
console.log("----------------------------------------------------------------------");
console.log(
  "Category".padEnd(25) +
  "Total".padEnd(10) +
  "Intent Acc".padEnd(15) +
  "Slot Acc".padEnd(15)
);
console.log("----------------------------------------------------------------------");

for (const [catName, stats] of categoryStats.entries()) {
  const intentAcc = ((stats.intentPassed / stats.total) * 100).toFixed(1) + "%";
  const slotAcc = ((stats.slotPassed / stats.total) * 100).toFixed(1) + "%";
  console.log(
    catName.padEnd(25) +
    String(stats.total).padEnd(10) +
    intentAcc.padEnd(15) +
    slotAcc.padEnd(15)
  );
}
console.log("----------------------------------------------------------------------\n");

const overallIntentAcc = ((correctIntents / LABELLED_UTTERANCES.length) * 100).toFixed(2);
const overallSlotAcc = totalSlotsChecked > 0 ? ((correctSlots / totalSlotsChecked) * 100).toFixed(2) : "100.00";
const avgLatencyUs = ((totalTimeMs / LABELLED_UTTERANCES.length) * 1000).toFixed(1);

console.log(`Total Samples:       ${LABELLED_UTTERANCES.length}`);
console.log(`Intent Accuracy:     ${overallIntentAcc}% (${correctIntents}/${LABELLED_UTTERANCES.length})`);
console.log(`Slot Accuracy:       ${overallSlotAcc}% (${correctSlots}/${totalSlotsChecked} slots)`);
console.log(`Avg Regex Latency:   ${avgLatencyUs} µs per command`);

if (failures.length > 0) {
  console.log(`\nFailures (${failures.length}):`);
  for (const f of failures) {
    console.log(`  [${f.id}] "${f.utterance}" (${f.category})`);
    console.log(`      Expected: ${JSON.stringify(f.expected)}`);
    console.log(`      Got:      ${JSON.stringify(f.got)}`);
  }
}

console.log("\n======================================================================");
if (Number(overallIntentAcc) >= 95.0 && failures.length === 0) {
  console.log("BENCHMARK PASSED: All requirements met (>95% accuracy target reached)");
} else {
  console.log("BENCHMARK FAILED: Did not meet target criteria");
  process.exitCode = 1;
}
console.log("======================================================================\n");
