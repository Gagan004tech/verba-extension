const toggleBtn = document.getElementById("toggle-mic");
const statusDiv = document.getElementById("status");
const transcriptDiv = document.getElementById("transcript");

let shouldBeListening = false;
let recognition = null;

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
    chrome.tabs.create({ url: chrome.runtime.getURL("src/sidepanel/permission.html") });
  });
  enableManualInputFallback();
}

// Listen for broker events (e.g., spoken readback requested by P3)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SPEAK_CONFIRMATION" && message.payload?.text) {
    speakReadback(message.payload.text);
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

    // Hand-off 3: Send live transcript stream to the message broker
    chrome.runtime.sendMessage({
      type: "TRANSCRIPT_STREAM",
      payload: { text }
    });
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
        chrome.runtime.sendMessage({
          type: "TRANSCRIPT_STREAM",
          payload: { text }
        });
        fallbackInput.value = "";
      }
    });

    statusDiv.after(fallbackInput);
  }
}
