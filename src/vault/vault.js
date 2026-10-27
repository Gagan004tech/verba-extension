import { PROFILE_KEYS } from "../shared/message-types.js";

const DB_NAME = "verba_vault_db";
const DB_VERSION = 1;
const STORE_NAME = "vault";
const PROFILE_KEY = "encrypted_profile";
const LOCAL_STORAGE_KEY = "verba_encrypted_profile";
const SESSION_STORAGE_KEY = "verba_unlocked_session";

function getIndexedDB() {
  if (typeof indexedDB !== "undefined") return indexedDB;
  if (typeof globalThis !== "undefined" && globalThis.indexedDB) return globalThis.indexedDB;
  return null;
}

function openDB() {
  const idb = getIndexedDB();
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    try {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
    } catch (e) {
      resolve(null);
    }
  });
}

async function idbGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    } catch (e) {
      resolve(null);
    }
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch (e) {
      resolve(false);
    }
  });
}

async function idbDelete(key) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    } catch (e) {
      resolve(false);
    }
  });
}

async function storageLocalGet(key) {
  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (res) => {
        resolve(res ? res[key] ?? null : null);
      });
    });
  }
  return null;
}

async function storageLocalSet(key, val) {
  if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: val }, () => resolve(true));
    });
  }
  return false;
}

async function storageLocalRemove(key) {
  if (typeof chrome !== "undefined" && chrome.storage?.local?.remove) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => resolve(true));
    });
  }
  return false;
}

let inMemorySession = null;

async function getSessionState() {
  if (typeof chrome !== "undefined" && chrome.storage?.session?.get) {
    try {
      const res = await new Promise((resolve) => {
        chrome.storage.session.get([SESSION_STORAGE_KEY], (data) => resolve(data?.[SESSION_STORAGE_KEY] ?? null));
      });
      if (res) return res;
    } catch (_) {}
  }
  return inMemorySession;
}

async function setSessionState(session) {
  inMemorySession = session;
  if (typeof chrome !== "undefined" && chrome.storage?.session?.set) {
    try {
      await new Promise((resolve) => {
        chrome.storage.session.set({ [SESSION_STORAGE_KEY]: session }, () => resolve(true));
      });
    } catch (_) {}
  }
}

async function clearSessionState() {
  inMemorySession = null;
  if (typeof chrome !== "undefined" && chrome.storage?.session?.remove) {
    try {
      await new Promise((resolve) => {
        chrome.storage.session.remove([SESSION_STORAGE_KEY], () => resolve(true));
      });
    } catch (_) {}
  }
}

export class ProfileVault {
  static idleTimeoutMs = 5 * 60 * 1000; // 5 minutes default

  static async deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  static async encrypt(plainText, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);
    
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      enc.encode(plainText)
    );

    return {
      ciphertext: Array.from(new Uint8Array(encrypted)),
      salt: Array.from(salt),
      iv: Array.from(iv)
    };
  }

  static async decrypt(encryptedData, password) {
    try {
      const salt = new Uint8Array(encryptedData.salt);
      const iv = new Uint8Array(encryptedData.iv);
      const key = await this.deriveKey(password, salt);

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        new Uint8Array(encryptedData.ciphertext)
      );

      return new TextDecoder().decode(decrypted);
    } catch (err) {
      throw new Error("Invalid passphrase");
    }
  }

  static async getStoredEncryptedProfile() {
    // 1. Try IndexedDB
    const fromIdb = await idbGet(PROFILE_KEY);
    if (fromIdb) return fromIdb;

    // 2. Fall back / migrate from chrome.storage.local
    const fromLocal = await storageLocalGet(LOCAL_STORAGE_KEY);
    if (fromLocal) {
      // Migrate to IndexedDB if available
      const migrated = await idbSet(PROFILE_KEY, fromLocal);
      if (migrated) {
        await storageLocalRemove(LOCAL_STORAGE_KEY);
      }
      return fromLocal;
    }

    return null;
  }

  static async setStoredEncryptedProfile(data) {
    const savedToIdb = await idbSet(PROFILE_KEY, data);
    if (savedToIdb) {
      // Clean up legacy chrome.storage.local if present
      await storageLocalRemove(LOCAL_STORAGE_KEY);
      return true;
    }
    // Fall back to chrome.storage.local if IndexedDB is not supported in environment
    return storageLocalSet(LOCAL_STORAGE_KEY, data);
  }

  static async removeStoredEncryptedProfile() {
    await idbDelete(PROFILE_KEY);
    await storageLocalRemove(LOCAL_STORAGE_KEY);
    return true;
  }

  static async saveProfile(profile, passphrase) {
    if (!passphrase || typeof passphrase !== "string") {
      throw new Error("Passphrase must be a non-empty string");
    }
    if (!profile || typeof profile !== "object") {
      throw new Error("Profile must be an object");
    }

    const cleanProfile = {};
    for (const key of PROFILE_KEYS) {
      cleanProfile[key] = typeof profile[key] === "string" ? profile[key].trim() : "";
    }

    const json = JSON.stringify(cleanProfile);
    const encrypted = await this.encrypt(json, passphrase);
    await this.setStoredEncryptedProfile(encrypted);

    // Keep session updated if already unlocked or unlock directly
    await setSessionState({
      unlockedProfile: cleanProfile,
      lastActive: Date.now()
    });

    return { ok: true };
  }

  static async getProfile(passphrase) {
    if (!passphrase || typeof passphrase !== "string") {
      throw new Error("Passphrase must be a non-empty string");
    }
    const encrypted = await this.getStoredEncryptedProfile();
    if (!encrypted) return null;

    const json = await this.decrypt(encrypted, passphrase);
    return JSON.parse(json);
  }

  static async hasProfile() {
    const stored = await this.getStoredEncryptedProfile();
    return stored !== null;
  }

  static async clearProfile() {
    await this.removeStoredEncryptedProfile();
    await this.lock();
    return { ok: true };
  }

  static async unlock(passphrase) {
    const profile = await this.getProfile(passphrase);
    if (!profile) {
      throw new Error("No profile saved to unlock");
    }
    await setSessionState({
      unlockedProfile: profile,
      lastActive: Date.now()
    });
    return { status: "ok" };
  }

  static async lock() {
    await clearSessionState();
    return { status: "locked" };
  }

  static async isLocked() {
    const session = await getSessionState();
    if (!session || !session.unlockedProfile) return true;
    if (Date.now() - session.lastActive > this.idleTimeoutMs) {
      await this.lock();
      return true;
    }
    return false;
  }

  static async fetchValue(key) {
    if (await this.isLocked()) {
      return { status: "locked" };
    }
    const session = await getSessionState();
    if (!session || !session.unlockedProfile) {
      return { status: "locked" };
    }

    session.lastActive = Date.now();
    await setSessionState(session);

    const val = session.unlockedProfile[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      return { status: "ok", value: String(val).trim() };
    }
    return { status: "missing" };
  }

  static async getStatus() {
    const has = await this.hasProfile();
    const locked = await this.isLocked();
    return { status: "ok", hasProfile: has, isLocked: locked };
  }
}
