import { MESSAGE_TYPES, createMessage } from "../shared/message-types.js";

const toggleBtn = document.getElementById("toggle-mic");
const statusDiv = document.getElementById("status");
const transcriptDiv = document.getElementById("transcript");
const intentJsonDiv = document.getElementById("intent-json");

let shouldBeListening = false;
let recognition = null;

// Manual text input is always available - it's not just a mic-failure
// fallback, since Web Speech may simply be unsupported/blocked and the
// side panel shouldn't be unusable while that's sorted out.
enableManualInputFallback();
console.log("[VERBA] Side panel loaded. Manual input ready.");

// Initialize Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// TTS Readback Helper (Hand-off 8 / Confirmation Gate)
function speakReadback(text) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

// Open permission tab helper
function promptMicAuthorization() {
  shouldBeListening = false;
  statusDiv.innerHTML = `
    <span style="color: red;">Mic permission required.</span><br/>
    <button id="request-perm-btn" style="margin-top: 8px; padding: 6px 12px; font-size: 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">Authorize Mic</button>
  `;
  document.getElementById("request-perm-btn")?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/sidepanel/permission.html") }).catch((err) => {
      console.error("[VERBA] Failed to open permission tab:", err);
    });
  });
  enableManualInputFallback();
}

// Listen for broker events (e.g., spoken readback, parsed intent)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MESSAGE_TYPES.SPEAK_CONFIRMATION && message.payload?.text) {
    speakReadback(message.payload.text);
  }

  // P2's parsed intent, broadcast from the background broker after every
  // transcript - shown here as formatted JSON so it's visible without
  // needing to open the service worker's own devtools.
  if (message.type === MESSAGE_TYPES.INTENT_PARSED) {
    intentJsonDiv.textContent = JSON.stringify(message.payload, null, 2);
    console.log("[VERBA] INTENT_PARSED:", message.payload);
  }
});

if (!SpeechRecognition) {
  statusDiv.textContent = "Web Speech API is not supported in this browser.";
} else {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    toggleBtn.textContent = "Stop Listening";
    statusDiv.textContent = "Listening...";
  };

  recognition.onresult = (event) => {
    const current = event.resultIndex;
    const text = event.results[current][0].transcript.trim();
    transcriptDiv.textContent = `Heard: "${text}"`;

    // Show immediate placeholder so the first command always has visible feedback
    // while the NLU model processes (the INTENT_PARSED message will overwrite this)
    intentJsonDiv.textContent = "Processing...";

    // Hand-off 3: Send live transcript stream to the message broker
    chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.TRANSCRIPT_STREAM, { text }));
  };

  recognition.onerror = (event) => {
    console.error("[VERBA] Speech error:", event.error);

    switch (event.error) {
      case "not-allowed":
      case "service-not-allowed":
        promptMicAuthorization();
        break;

      case "network":
        statusDiv.innerHTML = `
          <span style="color: orange;">Network connection lost.</span><br/>
          <small>Web Speech requires an active internet connection. Retrying...</small>
        `;
        setTimeout(() => {
          if (shouldBeListening) {
            try {
              recognition.start();
            } catch (e) {
              console.warn("[VERBA] Reconnect failed:", e);
            }
          }
        }, 3000);
        break;

      case "no-speech":
        statusDiv.textContent = "No speech detected. Still listening...";
        break;

      case "aborted":
        statusDiv.textContent = "Listening paused.";
        break;

      default:
        statusDiv.textContent = `Speech error: ${event.error}`;
        break;
    }
  };

  recognition.onend = () => {
    // Keep listening active if user didn't explicitly click stop
    if (shouldBeListening) {
      try {
        recognition.start();
      } catch (err) {
        console.warn("[VERBA] Auto-restart suppressed:", err);
      }
    } else {
      toggleBtn.textContent = "Start Listening";
      statusDiv.textContent = "Stopped.";
    }
  };
}

toggleBtn.addEventListener("click", async () => {
  if (!recognition) return;

  if (shouldBeListening) {
    shouldBeListening = false;
    recognition.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());

    shouldBeListening = true;
    recognition.start();
  } catch (err) {
    console.warn("[VERBA] Direct mic access restricted. Prompting tab auth:", err);
    promptMicAuthorization();
  }
});

function enableManualInputFallback() {
  let fallbackInput = document.getElementById("manual-input");
  if (!fallbackInput) {
    fallbackInput = document.createElement("input");
    fallbackInput.id = "manual-input";
    fallbackInput.type = "text";
    fallbackInput.placeholder = "Type command & press Enter...";
    fallbackInput.style.cssText = "width: 100%; margin-top: 10px; padding: 8px; box-sizing: border-box;";

    fallbackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && fallbackInput.value.trim() !== "") {
        const text = fallbackInput.value.trim();
        transcriptDiv.textContent = `Typed: "${text}"`;
        // Show immediate placeholder while NLU processes
        intentJsonDiv.textContent = "Processing...";
        chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.TRANSCRIPT_STREAM, { text }));
        fallbackInput.value = "";
      }
    });

    statusDiv.after(fallbackInput);
  }
}

// --- Vault UI Management ----------------------------------------------------
const vaultBadge = document.getElementById("vault-badge");
const vaultPassphrase = document.getElementById("vault-passphrase");
const btnVaultUnlock = document.getElementById("btn-vault-unlock");
const btnVaultLock = document.getElementById("btn-vault-lock");
const btnVaultSave = document.getElementById("btn-vault-save");
const btnVaultForget = document.getElementById("btn-vault-forget");
const vaultFeedback = document.getElementById("vault-feedback");

const inputName = document.getElementById("prof-name");
const inputDob = document.getElementById("prof-dob");
const inputPan = document.getElementById("prof-pan");
const inputAddress = document.getElementById("prof-address");
const inputPhone = document.getElementById("prof-phone");

function showVaultMessage(msg, isError = false) {
  if (!vaultFeedback) return;
  vaultFeedback.textContent = msg;
  vaultFeedback.style.color = isError ? "#dc2626" : "#16a34a";
  setTimeout(() => {
    if (vaultFeedback.textContent === msg) {
      vaultFeedback.textContent = "";
    }
  }, 4000);
}

function updateVaultStatusUI() {
  chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.VAULT_STATUS), (response) => {
    if (chrome.runtime.lastError || !response) return;
    const { hasProfile, isLocked } = response;
    if (!hasProfile) {
      vaultBadge.textContent = "No Profile";
      vaultBadge.className = "badge badge-empty";
    } else if (isLocked) {
      vaultBadge.textContent = "Locked";
      vaultBadge.className = "badge badge-locked";
    } else {
      vaultBadge.textContent = "Unlocked";
      vaultBadge.className = "badge badge-unlocked";
    }
  });
}

btnVaultUnlock?.addEventListener("click", () => {
  const passphrase = vaultPassphrase.value;
  if (!passphrase) {
    showVaultMessage("Please enter your passphrase.", true);
    return;
  }
  chrome.runtime.sendMessage(
    createMessage(MESSAGE_TYPES.VAULT_UNLOCK, { passphrase }),
    (response) => {
      if (response?.status === "ok") {
        showVaultMessage("Vault unlocked successfully!");
        vaultPassphrase.value = "";
        updateVaultStatusUI();
        // Load field values
        loadProfileFields();
      } else {
        showVaultMessage(response?.error || "Incorrect passphrase.", true);
      }
    }
  );
});

btnVaultLock?.addEventListener("click", () => {
  chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.VAULT_LOCK), () => {
    showVaultMessage("Vault locked.");
    vaultPassphrase.value = "";
    clearProfileFormInputs();
    updateVaultStatusUI();
  });
});

btnVaultSave?.addEventListener("click", () => {
  const passphrase = vaultPassphrase.value;
  if (!passphrase) {
    showVaultMessage("Enter a passphrase to protect your profile.", true);
    return;
  }
  const profile = {
    name: inputName.value.trim(),
    dob: inputDob.value.trim(),
    pan: inputPan.value.trim(),
    address: inputAddress.value.trim(),
    phone: inputPhone.value.trim(),
  };

  chrome.runtime.sendMessage(
    createMessage(MESSAGE_TYPES.VAULT_SAVE, { profile, passphrase }),
    (response) => {
      if (response?.status === "ok") {
        showVaultMessage("Profile encrypted and saved!");
        vaultPassphrase.value = "";
        updateVaultStatusUI();
      } else {
        showVaultMessage(response?.error || "Failed to save profile.", true);
      }
    }
  );
});

btnVaultForget?.addEventListener("click", () => {
  if (!confirm("Are you sure you want to delete all saved profile data permanently?")) {
    return;
  }
  chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.VAULT_CLEAR), () => {
    showVaultMessage("All profile data permanently erased.");
    clearProfileFormInputs();
    vaultPassphrase.value = "";
    updateVaultStatusUI();
  });
});

function clearProfileFormInputs() {
  if (inputName) inputName.value = "";
  if (inputDob) inputDob.value = "";
  if (inputPan) inputPan.value = "";
  if (inputAddress) inputAddress.value = "";
  if (inputPhone) inputPhone.value = "";
}

function loadProfileFields() {
  const keys = ["name", "dob", "pan", "address", "phone"];
  for (const k of keys) {
    chrome.runtime.sendMessage(
      createMessage(MESSAGE_TYPES.VAULT_FETCH, { key: k }),
      (res) => {
        if (res?.status === "ok" && res.value) {
          if (k === "name" && inputName) inputName.value = res.value;
          if (k === "dob" && inputDob) inputDob.value = res.value;
          if (k === "pan" && inputPan) inputPan.value = res.value;
          if (k === "address" && inputAddress) inputAddress.value = res.value;
          if (k === "phone" && inputPhone) inputPhone.value = res.value;
        }
      }
    );
  }
}

// Initialize Vault UI status on load
updateVaultStatusUI();
