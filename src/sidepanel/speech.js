import { MESSAGE_TYPES, createMessage } from "../shared/message-types.js";

export class VoiceController {
  constructor() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = "en-US";

    this.recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript.trim();
      // Hand-off 3: Send transcript to Module B
      chrome.runtime.sendMessage(createMessage(MESSAGE_TYPES.TRANSCRIPT_STREAM, { text: transcript }));
    };

    this.recognition.onerror = (err) => {
      console.error("[VERBA] Speech recognition error:", err.error);
    };
  }

  startListening() {
    this.recognition.start();
  }

  stopListening() {
    this.recognition.stop();
  }

  // TTS Readback for the confirmation gate
  speak(text) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}
