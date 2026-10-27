import assert from "node:assert/strict";
import { TTSQueue } from "./tts-queue.js";

class MockSpeechSynthesis {
  constructor() {
    this.speaking = false;
    this.paused = false;
    this.spokenUtterances = [];
    this.activeUtterance = null;
  }

  speak(utterance) {
    this.speaking = true;
    this.spokenUtterances.push(utterance.text);
    this.activeUtterance = utterance;
    // Simulate async speech completion
    setTimeout(() => {
      if (this.activeUtterance === utterance) {
        this.speaking = false;
        this.activeUtterance = null;
        if (utterance.onend) utterance.onend();
      }
    }, 15);
  }

  cancel() {
    this.speaking = false;
    this.activeUtterance = null;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }
}

class MockSpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
    this.onend = null;
    this.onerror = null;
  }
}

globalThis.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

async function runTests() {
  console.log("=== TTS QUEUE UNIT TESTS ===");

  const synth = new MockSpeechSynthesis();
  const queue = new TTSQueue(synth);

  // Test 1: Sequential FIFO Queue (does not cut off earlier utterances)
  queue.enqueue("First sentence.");
  queue.enqueue("Second sentence.");
  queue.enqueue("Third sentence.");

  assert.equal(queue.queue.length, 2, "Two items should be waiting in queue while first plays");
  assert.equal(queue.isSpeaking, true, "Queue should be speaking");

  // Wait for all 3 to finish
  await new Promise((r) => setTimeout(r, 70));

  assert.deepEqual(
    synth.spokenUtterances,
    ["First sentence.", "Second sentence.", "Third sentence."],
    "All 3 sentences must be spoken in order without truncation"
  );
  assert.equal(queue.isSpeaking, false, "Queue should be idle after finishing");
  console.log("PASS Test 1: FIFO queue orders speech without cutting off");

  // Test 2: Interrupt clears pending speech and plays urgent utterance immediately
  synth.spokenUtterances = [];
  queue.enqueue("Long reading paragraph that takes time...");
  queue.enqueue("Next queued paragraph...");
  assert.equal(queue.queue.length, 1);

  // Urgent confirmation prompt interrupts
  queue.interrupt("Are you sure you want to submit?");
  assert.equal(synth.spokenUtterances.includes("Are you sure you want to submit?"), true);
  assert.equal(queue.queue.length, 0, "Previous queue must be cleared on interrupt");

  await new Promise((r) => setTimeout(r, 30));
  console.log("PASS Test 2: Interrupt cancels earlier items and speaks immediately");

  // Test 3: Pause and Resume
  synth.spokenUtterances = [];
  queue.enqueue("Sentence before pause");
  queue.pause();
  assert.equal(queue.isPaused, true);
  assert.equal(synth.paused, true);

  queue.resume();
  assert.equal(queue.isPaused, false);
  assert.equal(synth.paused, false);

  await new Promise((r) => setTimeout(r, 30));
  console.log("PASS Test 3: Pause and resume states operate correctly");

  // Test 4: Stop / Clear
  synth.spokenUtterances = [];
  queue.enqueue("Item 1");
  queue.enqueue("Item 2");
  queue.enqueue("Item 3");
  queue.stop();

  assert.equal(queue.queue.length, 0);
  assert.equal(queue.isSpeaking, false);
  assert.equal(synth.speaking, false);
  console.log("PASS Test 4: Stop/clear empties queue and stops speech");

  console.log("\nALL TTS QUEUE TESTS PASSED (4/4)!\n");
}

runTests().catch((err) => {
  console.error("TTS Queue test failed:", err);
  process.exit(1);
});

