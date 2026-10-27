/**
 * Robust SpeechSynthesis TTS Queue.
 *
 * Replaces cancel()+speak() with an ordered FIFO queue that prevents
 * utterance cutoff, supports interruption for urgent confirmation prompts,
 * and allows pause/resume/stop controls for page reading.
 */
export class TTSQueue {
  constructor(synth = (typeof window !== "undefined" ? window.speechSynthesis : null)) {
    this.synth = synth;
    this.queue = [];
    this.isSpeaking = false;
    this.isPaused = false;
    this.currentUtterance = null;
    this.onStateChange = null; // (state: 'idle' | 'speaking' | 'paused') => void
  }

  /**
   * Enqueues an utterance to be spoken sequentially without cutting off earlier ones.
   * @param {string} text
   * @param {object} [options] { urgent?: boolean, rate?: number, pitch?: number, onEnd?: () => void }
   */
  enqueue(text, options = {}) {
    if (!text || typeof text !== "string") return;
    const trimmed = text.trim();
    if (!trimmed) return;

    if (options.urgent) {
      this.interrupt(trimmed, options);
      return;
    }

    this.queue.push({ text: trimmed, options });
    if (!this.isSpeaking && !this.isPaused) {
      this._processNext();
    }
  }

  /**
   * Immediately clears pending utterances, stops active speech, and speaks the prompt.
   * Used for safety confirmation prompts and urgent alerts.
   * @param {string} text
   * @param {object} [options]
   */
  interrupt(text, options = {}) {
    this.queue = [];
    if (this.synth?.cancel) {
      try {
        this.synth.cancel();
      } catch (_) {}
    }
    this.isSpeaking = false;
    this.isPaused = false;
    this.currentUtterance = null;

    if (text && typeof text === "string" && text.trim()) {
      this.queue.push({ text: text.trim(), options });
      this._processNext();
    } else {
      this._notifyState("idle");
    }
  }

  /**
   * Stops playback and discards all pending items in the queue.
   */
  stop() {
    this.clear();
  }

  /**
   * Clears all queue items and cancels active speech synthesis.
   */
  clear() {
    this.queue = [];
    this.isSpeaking = false;
    this.isPaused = false;
    this.currentUtterance = null;
    if (this.synth?.cancel) {
      try {
        this.synth.cancel();
      } catch (_) {}
    }
    this._notifyState("idle");
  }

  /**
   * Pauses active speech synthesis.
   */
  pause() {
    if (this.synth?.pause && this.isSpeaking) {
      try {
        this.synth.pause();
      } catch (_) {}
      this.isPaused = true;
      this._notifyState("paused");
    }
  }

  /**
   * Resumes paused speech synthesis or starts next queued item.
   */
  resume() {
    if (this.synth?.resume && this.isPaused) {
      try {
        this.synth.resume();
      } catch (_) {}
      this.isPaused = false;
      this._notifyState("speaking");
    } else if (!this.isSpeaking && this.queue.length > 0) {
      this.isPaused = false;
      this._processNext();
    }
  }

  _notifyState(state) {
    if (typeof this.onStateChange === "function") {
      this.onStateChange(state);
    }
  }

  _processNext() {
    if (this.queue.length === 0) {
      this.isSpeaking = false;
      this.currentUtterance = null;
      this._notifyState("idle");
      return;
    }

    const item = this.queue.shift();
    this.isSpeaking = true;
    this._notifyState("speaking");

    if (!this.synth) {
      if (typeof item.options?.onEnd === "function") {
        item.options.onEnd();
      }
      this._processNext();
      return;
    }

    const UtteranceConstructor =
      typeof SpeechSynthesisUtterance !== "undefined"
        ? SpeechSynthesisUtterance
        : globalThis.SpeechSynthesisUtterance;

    let utterance;
    if (UtteranceConstructor) {
      utterance = new UtteranceConstructor(item.text);
    } else {
      utterance = { text: item.text };
    }

    utterance.rate = item.options.rate ?? 1.0;
    utterance.pitch = item.options.pitch ?? 1.0;
    utterance.volume = item.options.volume ?? 1.0;
    if (item.options.lang) utterance.lang = item.options.lang;

    this.currentUtterance = utterance;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (typeof item.options?.onEnd === "function") {
        item.options.onEnd();
      }
      this.currentUtterance = null;
      this._processNext();
    };

    utterance.onend = () => finish();
    utterance.onerror = () => finish();

    try {
      this.synth.speak(utterance);
    } catch (_) {
      finish();
    }
  }
}
