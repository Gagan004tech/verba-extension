import assert from "node:assert/strict";
import { ProfileVault } from "./vault.js";
import { PROFILE_KEYS } from "../shared/message-types.js";

// Mock chrome.storage if not present in Node
if (typeof globalThis.chrome === "undefined") {
  const localStore = new Map();
  const sessionStore = new Map();

  globalThis.chrome = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          for (const k of keys) {
            if (localStore.has(k)) res[k] = localStore.get(k);
          }
          cb(res);
        },
        set: (obj, cb) => {
          for (const [k, v] of Object.entries(obj)) {
            localStore.set(k, v);
          }
          if (cb) cb();
        },
        remove: (keys, cb) => {
          for (const k of keys) {
            localStore.delete(k);
          }
          if (cb) cb();
        },
        _clear: () => localStore.clear(),
        _store: localStore
      },
      session: {
        get: (keys, cb) => {
          const res = {};
          for (const k of keys) {
            if (sessionStore.has(k)) res[k] = sessionStore.get(k);
          }
          cb(res);
        },
        set: (obj, cb) => {
          for (const [k, v] of Object.entries(obj)) {
            sessionStore.set(k, v);
          }
          if (cb) cb();
        },
        remove: (keys, cb) => {
          for (const k of keys) {
            sessionStore.delete(k);
          }
          if (cb) cb();
        },
        _clear: () => sessionStore.clear(),
        _store: sessionStore
      }
    }
  };
}

async function runTests() {
  console.log("=== PROFILE VAULT UNIT TESTS ===");

  // Reset before testing
  await ProfileVault.clearProfile();

  // Test 1: Empty vault
  const hasInitial = await ProfileVault.hasProfile();
  assert.equal(hasInitial, false, "Initial vault should have no profile");

  const initialFetch = await ProfileVault.fetchValue("name");
  assert.deepEqual(initialFetch, { status: "locked" }, "Initial fetch should be locked");

  console.log("PASS Test 1: Empty vault is locked and reports no profile");

  // Test 2: Save and Round Trip
  const sampleProfile = {
    name: "Alex Doe",
    pan: "ABCDE1234F",
    dob: "1990-05-15",
    phone: "9876543210",
    address: "221B Baker St"
  };
  const passphrase = "correct-horse-battery-staple";

  const saveRes = await ProfileVault.saveProfile(sampleProfile, passphrase);
  assert.equal(saveRes.ok, true, "saveProfile should return ok: true");

  const hasAfterSave = await ProfileVault.hasProfile();
  assert.equal(hasAfterSave, true, "hasProfile should be true after save");

  const loaded = await ProfileVault.getProfile(passphrase);
  assert.deepEqual(loaded, sampleProfile, "getProfile should return matching profile");

  console.log("PASS Test 2: Profile save and getProfile round trip matches exactly");

  // Test 3: Wrong Passphrase Fails Cleanly
  let wrongPassFailed = false;
  try {
    await ProfileVault.getProfile("wrong-passphrase-attempt");
  } catch (err) {
    wrongPassFailed = true;
    assert.equal(err.message, "Invalid passphrase", "Error message must be 'Invalid passphrase'");
  }
  assert.equal(wrongPassFailed, true, "Decryption with wrong passphrase must throw cleanly");

  console.log("PASS Test 3: Wrong passphrase fails cleanly with expected error");

  // Test 4: Lock and Unlock
  const lockRes = await ProfileVault.lock();
  assert.equal(lockRes.status, "locked");
  assert.equal(await ProfileVault.isLocked(), true, "Vault should be locked after lock()");

  const lockedFetch = await ProfileVault.fetchValue("pan");
  assert.deepEqual(lockedFetch, { status: "locked" });

  const unlockRes = await ProfileVault.unlock(passphrase);
  assert.equal(unlockRes.status, "ok");
  assert.equal(await ProfileVault.isLocked(), false, "Vault should be unlocked after unlock()");

  const unlockedFetch = await ProfileVault.fetchValue("pan");
  assert.deepEqual(unlockedFetch, { status: "ok", value: "ABCDE1234F" });

  console.log("PASS Test 4: Lock, unlock, and fetchValue flow works");

  // Test 5: Missing Key
  const missingFetch = await ProfileVault.fetchValue("nonExistentKey");
  assert.deepEqual(missingFetch, { status: "missing" }, "Missing key returns status: missing");

  // Save profile with empty address
  await ProfileVault.saveProfile({ name: "Alex", pan: "ABCDE1234F", dob: "", address: "", phone: "" }, passphrase);
  const emptyKeyFetch = await ProfileVault.fetchValue("address");
  assert.deepEqual(emptyKeyFetch, { status: "missing" }, "Empty string key returns status: missing");

  console.log("PASS Test 5: Missing or empty keys return { status: 'missing' }");

  // Test 6: Auto-lock after idle timeout
  const originalTimeout = ProfileVault.idleTimeoutMs;
  ProfileVault.idleTimeoutMs = 50; // 50ms for testing

  await ProfileVault.unlock(passphrase);
  assert.equal(await ProfileVault.isLocked(), false);

  // Wait 70ms for timeout to expire
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(await ProfileVault.isLocked(), true, "Vault should auto-lock after idle timeout");

  const timedOutFetch = await ProfileVault.fetchValue("name");
  assert.deepEqual(timedOutFetch, { status: "locked" });

  ProfileVault.idleTimeoutMs = originalTimeout;
  console.log("PASS Test 6: Auto-lock on idle timeout works");

  // Test 7: chrome.storage.local Migration
  // Clear any existing stored profile
  await ProfileVault.clearProfile();

  // Manually plant legacy encrypted profile in chrome.storage.local
  const legacyEncrypted = await ProfileVault.encrypt(JSON.stringify(sampleProfile), passphrase);
  await new Promise((resolve) => {
    globalThis.chrome.storage.local.set({ verba_encrypted_profile: legacyEncrypted }, resolve);
  });

  const migratedProfile = await ProfileVault.getProfile(passphrase);
  assert.deepEqual(migratedProfile, sampleProfile, "Migrated profile matches legacy data");

  console.log("PASS Test 7: chrome.storage.local migration to storage backend succeeds");

  // Test 8: Clear Profile / Forget All
  await ProfileVault.clearProfile();
  assert.equal(await ProfileVault.hasProfile(), false, "Profile should be cleared");
  assert.equal(await ProfileVault.isLocked(), true, "Vault should be locked after clear");

  console.log("PASS Test 8: clearProfile / forget-all cleans up completely");

  console.log("\nALL VAULT TESTS PASSED (8/8)!\n");
}

runTests().catch((err) => {
  console.error("Vault test failed:", err);
  process.exit(1);
});
