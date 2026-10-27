import assert from "node:assert/strict";
import { FormSafety } from "./form-safety.js";

async function runTests() {
  console.log("=== FORM SAFETY & CONFIRMATION GATE UNIT TESTS ===");

  await FormSafety.clearSessionFills();
  await FormSafety.clearGate();

  // Test 1: Sensitive field detection & character-by-character readback formatting
  assert.equal(FormSafety.isSensitiveField("PAN"), true);
  assert.equal(FormSafety.isSensitiveField("phone number"), true);
  assert.equal(FormSafety.isSensitiveField("dob"), true);
  assert.equal(FormSafety.isSensitiveField("first name"), false);

  const panReadback = FormSafety.formatReadbackValue("pan", "ABCDE1234F");
  assert.equal(panReadback, "A B C D E 1 2 3 4 F", "PAN must be spaced character-by-character");

  const nameReadback = FormSafety.formatReadbackValue("name", "Alex");
  assert.equal(nameReadback, "Alex", "Name should not be spaced out");
  console.log("PASS Test 1: Sensitive field character-by-character readback formatting works");

  // Test 2: On-screen masking
  const maskedPan = FormSafety.maskSensitiveValue("pan", "ABCDE1234F");
  assert.equal(maskedPan, "••••••234F", "PAN should be masked except for last 4 characters");

  const maskedName = FormSafety.maskSensitiveValue("name", "Alex");
  assert.equal(maskedName, "Alex", "Non-sensitive name should not be masked");
  console.log("PASS Test 2: On-screen masking functions properly");

  // Test 3: Session fill recording & undo
  await FormSafety.recordFill({ field: "name", selector: "#name", value: "Alex" });
  await FormSafety.recordFill({ field: "phone", selector: "#phone", value: "9876543210" });

  const fills = await FormSafety.getSessionFills();
  assert.equal(fills.length, 2, "Session should have 2 recorded fills");

  const undone = await FormSafety.undoLastFill();
  assert.equal(undone.field, "phone", "Undo should return last filled field");

  const remaining = await FormSafety.getSessionFills();
  assert.equal(remaining.length, 1, "Session should now have 1 remaining fill");
  assert.equal(remaining[0].field, "name");
  console.log("PASS Test 3: Session fill recording and undo works");

  // Test 4: Submission summary generation
  await FormSafety.recordFill({ field: "pan", selector: "#pan", value: "ABCDE1234F" });
  const allFills = await FormSafety.getSessionFills();
  const summary = FormSafety.generateSubmissionSummary(allFills);
  assert.equal(summary.includes("name: Alex"), true);
  assert.equal(summary.includes("pan: A B C D E 1 2 3 4 F"), true);
  assert.equal(summary.includes("Say confirm to submit"), true);
  console.log("PASS Test 4: Submission summary contains all filled values and verification prompt");

  // Test 5: Confirmation gate & expiration
  const gate = await FormSafety.createGate(1, summary, 50); // 50ms expiration for test
  assert.equal(gate.action, "SUBMIT");

  const pending = await FormSafety.getPendingGate();
  assert.equal(pending.action, "SUBMIT");

  // Wait 70ms for gate to expire
  await new Promise((r) => setTimeout(r, 70));
  const expiredCheck = await FormSafety.getPendingGate();
  assert.equal(expiredCheck.expired, true, "Gate should report expired after timeout");
  console.log("PASS Test 5: Gate state creation and timeout expiration verified");

  console.log("\nALL FORM SAFETY TESTS PASSED (5/5)!\n");
}

runTests().catch((err) => {
  console.error("Form safety test failed:", err);
  process.exit(1);
});
