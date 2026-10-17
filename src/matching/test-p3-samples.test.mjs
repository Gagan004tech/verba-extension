// Evaluates Fused Matcher directly on P3's label dump samples (handoff #5)
//
// Run: node src/matching/test-p3-samples.test.mjs

import { readFileSync } from "node:fs";
import { rankFieldsFast, MATCH_THRESHOLD } from "./fused-matcher.js";

console.log("=== EVALUATING FUSED MATCHER AGAINST P3 SAMPLE DUMPS ===\n");

function loadSample(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

let passed = 0;
let total = 0;

function assertMatch(sampleName, spoken, expectedLabel, fields) {
  total++;
  const ranked = rankFieldsFast(spoken, fields, { threshold: MATCH_THRESHOLD });
  const top = ranked[0];

  const ok = top && top.isConfident && top.field.label.toLowerCase() === expectedLabel.toLowerCase();
  if (ok) {
    passed++;
    console.log(`PASS [${sampleName}] "${spoken}" -> "${top.field.label}" (score: ${top.score.toFixed(3)})`);
  } else {
    console.error(`FAIL [${sampleName}] "${spoken}"`);
    console.error(`     Want: "${expectedLabel}"`);
    console.error(`     Got:  "${top?.field?.label}" (score: ${top?.score})`);
  }
}

// 1. Controlled Tracker Sample
const controlled = loadSample("samples/local-02-controlled-tracker.json");
assertMatch("Controlled Tracker", "full name", "Full name", controlled.fields);
assertMatch("Controlled Tracker", "email", "Email address", controlled.fields);
assertMatch("Controlled Tracker", "mobile number", "Mobile number", controlled.fields);
assertMatch("Controlled Tracker", "city", "City", controlled.fields);

// 2. Messy Labels Sample
const messy = loadSample("samples/local-03-messy-labels.json");
assertMatch("Messy Labels", "first name", "First name", messy.fields);
assertMatch("Messy Labels", "pan", "PAN Number", messy.fields);
assertMatch("Messy Labels", "phone", "Mobile", messy.fields);
assertMatch("Messy Labels", "aadhaar", "Aadhaar number", messy.fields);
assertMatch("Messy Labels", "enter city", "Enter your city", messy.fields);
assertMatch("Messy Labels", "zip code", "Pincode", messy.fields);
assertMatch("Messy Labels", "dob", "Date of birth", messy.fields);
assertMatch("Messy Labels", "state", "State", messy.fields);

// 3. Multi-Step Step 1
const step1 = loadSample("samples/local-04-multistep-step1.json");
assertMatch("Multi-Step Step 1", "phone", "Mobile number", step1.fields);
assertMatch("Multi-Step Step 1", "email", "Email", step1.fields);

// 4. Multi-Step Step 2 (OTP)
const step2 = loadSample("samples/local-04-multistep-step2.json");
assertMatch("Multi-Step Step 2", "otp", "Enter the 6-digit OTP", step2.fields);
assertMatch("Multi-Step Step 2", "verification code", "Enter the 6-digit OTP", step2.fields);

console.log(`\n=== RESULT: ${passed}/${total} passed ===\n`);
if (passed !== total) process.exitCode = 1;
