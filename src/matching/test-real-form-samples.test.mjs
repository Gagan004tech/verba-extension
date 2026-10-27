import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { rankFieldsFast, MATCH_THRESHOLD, MATCH_MARGIN } from "./fused-matcher.js";

const SAMPLES_DIR = "./samples";

async function runTests() {
  console.log("=== EVALUATING FUSED MATCHER AGAINST 10+ REAL FORM SAMPLES ===\n");

  const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.startsWith("real-") && f.endsWith(".json"));
  assert.equal(files.length >= 10, true, "Must have at least 10 real form sample files");

  let totalQueries = 0;
  let correctQueries = 0;

  const testQueries = [
    // Income Tax / PAN
    { file: "real-01-incometax-pan-portal.json", spoken: "pan", expectedName: "panNumber" },
    { file: "real-01-incometax-pan-portal.json", spoken: "first name", expectedName: "firstName" },
    { file: "real-01-incometax-pan-portal.json", spoken: "date of birth", expectedName: "dob" },
    { file: "real-01-incometax-pan-portal.json", spoken: "mobile", expectedName: "mobile" },
    { file: "real-01-incometax-pan-portal.json", spoken: "email", expectedName: "email" },

    // Aadhaar Portal
    { file: "real-02-uidai-aadhaar-portal.json", spoken: "aadhaar", expectedName: "uidNumber" },
    { file: "real-02-uidai-aadhaar-portal.json", spoken: "otp", expectedName: "otp" },

    // Passport Seva
    { file: "real-03-passport-seva.json", spoken: "first name", expectedName: "givenName" },
    { file: "real-03-passport-seva.json", spoken: "surname", expectedName: "surname" },
    { file: "real-03-passport-seva.json", spoken: "email", expectedName: "email" },

    // Voter Portal
    { file: "real-04-nvsp-voter-portal.json", spoken: "voter id", expectedName: "epicNumber" },
    { file: "real-04-nvsp-voter-portal.json", spoken: "pincode", expectedName: "pincode" },
    { file: "real-04-nvsp-voter-portal.json", spoken: "state", expectedName: "state" },

    // SBI Online
    { file: "real-05-sbi-online-kyc.json", spoken: "account number", expectedName: "accountNumber" },
    { file: "real-05-sbi-online-kyc.json", spoken: "mobile", expectedName: "registeredMobile" },

    // HDFC Login
    { file: "real-06-hdfc-netbanking-login.json", spoken: "user id", expectedName: "customerId" },
    { file: "real-06-hdfc-netbanking-login.json", spoken: "password", expectedName: "ipassword" },

    // Amazon Checkout
    { file: "real-07-amazon-checkout-address.json", spoken: "full name", expectedName: "fullName" },
    { file: "real-07-amazon-checkout-address.json", spoken: "phone", expectedName: "mobileNumber" },
    { file: "real-07-amazon-checkout-address.json", spoken: "zip code", expectedName: "postalCode" },
    { file: "real-07-amazon-checkout-address.json", spoken: "city", expectedName: "city" },

    // Flipkart Duplicate Phone Disambiguation
    { file: "real-08-flipkart-checkout.json", spoken: "shipping phone", expectedName: "shippingPhone" },
    { file: "real-08-flipkart-checkout.json", spoken: "billing phone", expectedName: "billingPhone" },
    { file: "real-08-flipkart-checkout.json", spoken: "pincode", expectedName: "pincode" },

    // GitHub Login
    { file: "real-09-github-login.json", spoken: "username", expectedName: "login" },
    { file: "real-09-github-login.json", spoken: "password", expectedName: "password" },

    // Google Signup
    { file: "real-10-google-account-signup.json", spoken: "first name", expectedName: "firstName" },
    { file: "real-10-google-account-signup.json", spoken: "email", expectedName: "username" }
  ];

  for (const t of testQueries) {
    totalQueries++;
    const content = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, t.file), "utf-8"));
    const ranked = rankFieldsFast(t.spoken, content.fields, { threshold: MATCH_THRESHOLD, margin: MATCH_MARGIN });

    assert.equal(ranked.length > 0, true, `Matcher returned empty for "${t.spoken}" in ${t.file}`);
    const top = ranked[0];
    const topName = top.field.name;

    if (topName === t.expectedName) {
      correctQueries++;
      console.log(`PASS [${t.file}] "${t.spoken}" -> ${top.field.label} (score: ${top.score.toFixed(3)})`);
    } else {
      console.error(`FAIL [${t.file}] "${t.spoken}" expected ${t.expectedName}, got ${topName} (${top.field.label})`);
    }
  }

  // Duplicate Phone Ambiguity Test (plain "phone" without shipping/billing should flag ambiguity)
  const flipkart = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, "real-08-flipkart-checkout.json"), "utf-8"));
  const ambRanked = rankFieldsFast("phone", flipkart.fields, { threshold: MATCH_THRESHOLD, margin: MATCH_MARGIN });
  assert.equal(ambRanked[0].isAmbiguous, true, "Bare 'phone' on duplicate-label page must flag ambiguity");
  console.log(`PASS [real-08-flipkart-checkout.json] Bare "phone" correctly identified as ambiguous between Shipping & Billing`);

  console.log(`\nAccuracy: ${correctQueries}/${totalQueries} (${((correctQueries / totalQueries) * 100).toFixed(1)}%)`);
  assert.equal(correctQueries, totalQueries, "All real form benchmark queries must pass");
}

runTests().catch((err) => {
  console.error("Real form test failed:", err);
  process.exit(1);
});
