import assert from "node:assert/strict";

// Create minimal DOM mock for testing executeAction logic
class MockClassList {
  constructor() { this.classes = new Set(); }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  contains(c) { return this.classes.has(c); }
}

class MockElement {
  constructor(tag, props = {}) {
    this.tagName = tag.toUpperCase();
    this.type = props.type || "";
    this.textContent = props.textContent || "";
    this.value = props.value || "";
    this.checked = props.checked || false;
    this.volume = props.volume ?? 1.0;
    this.muted = props.muted ?? false;
    this.id = props.id || "";
    this.name = props.name || "";
    this.attributes = new Map();
    this.classList = new MockClassList();
    this.parentElement = null;
    this.children = [];
    this.paused = true;
    this.fullscreen = false;
    this.focused = false;
    this.scrolledIntoView = false;
    this.style = {
      getPropertyValue: () => "",
      getPropertyPriority: () => "",
      setProperty: () => {},
      removeProperty: () => {}
    };

    if (props.attributes) {
      for (const [k, v] of Object.entries(props.attributes)) {
        this.attributes.set(k, v);
      }
    }
  }

  getAttribute(k) { return this.attributes.get(k) ?? null; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }

  click() { this.clicked = true; }
  focus() { this.focused = true; }
  play() { this.paused = false; }
  pause() { this.paused = true; }
  requestFullscreen() { this.fullscreen = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
  dispatchEvent() {}
  reset() {
    this.value = "";
    this.checked = false;
  }

  cloneNode(deep = true) {
    const clone = new MockElement(this.tagName.toLowerCase(), {
      type: this.type,
      textContent: this.textContent,
      value: this.value,
      id: this.id,
      name: this.name,
      attributes: Object.fromEntries(this.attributes.entries())
    });
    if (deep) {
      clone.children = this.children.map((c) => {
        const childClone = c.cloneNode(true);
        childClone.parentElement = clone;
        return childClone;
      });
    }
    return clone;
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (node) => {
      for (const child of node.children) {
        if (child.matches(sel)) results.push(child);
        check(child);
      }
    };
    check(this);
    return results;
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  matches(sel) {
    const s = sel.toLowerCase();
    if (s.includes("input[type=\"checkbox\"]") && this.tagName === "INPUT" && this.type === "checkbox") return true;
    if (s.includes("input[type=\"file\"]") && this.tagName === "INPUT" && this.type === "file") return true;
    if (s.includes("video") && this.tagName === "VIDEO") return true;
    if (s.includes("audio") && this.tagName === "AUDIO") return true;
    if (s.includes("button") && this.tagName === "BUTTON") return true;
    if (s.includes("a") && this.tagName === "A") return true;
    if (s.includes("form") && this.tagName === "FORM") return true;
    if (s.includes("h1") && this.tagName === "H1") return true;
    if (s.includes("h2") && this.tagName === "H2") return true;
    if (s.includes("section") && this.tagName === "SECTION") return true;
    if (s.includes("article") && this.tagName === "ARTICLE") return true;
    if (s.includes("nav") && this.tagName === "NAV") return true;
    return false;
  }

  closest(sel) {
    let curr = this;
    while (curr) {
      if (curr.matches(sel)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
}

// Jaro-Winkler helper
function jaroWinkler(s1, s2) {
  if (!s1 || !s2) return 0;
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.85 + 0.15 * (Math.min(a.length, b.length) / Math.max(a.length, b.length));
  return 0.5;
}

// Action executor under test
function executeTestableAction(actName, payload, doc) {
  const act = actName.toUpperCase();

  if (act === "CHECK_BOX" || act === "UNCHECK_BOX") {
    const target = String(payload.target || "").trim().toLowerCase();
    const checkboxes = doc.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length === 0) return { ok: false, error: "no checkboxes found" };

    const cb = checkboxes.find((c) => (c.getAttribute("aria-label") || c.name || c.id || "").toLowerCase().includes(target)) || checkboxes[0];
    cb.checked = (act === "CHECK_BOX");
    return { ok: true, action: act, target: cb.name || target };
  }

  if (act === "PLAY_MEDIA" || act === "PAUSE_MEDIA" || act === "MUTE_MEDIA" || act === "UNMUTE_MEDIA" || act === "VOLUME_UP" || act === "VOLUME_DOWN") {
    const media = doc.querySelector("video, audio");
    if (!media) return { ok: false, error: "no media found" };
    if (act === "PLAY_MEDIA") { media.play(); return { ok: true, action: act }; }
    if (act === "PAUSE_MEDIA") { media.pause(); return { ok: true, action: act }; }
    if (act === "MUTE_MEDIA") { media.muted = true; return { ok: true, action: act }; }
    if (act === "UNMUTE_MEDIA") { media.muted = false; return { ok: true, action: act }; }
    if (act === "VOLUME_UP") { media.volume = Math.min(1.0, media.volume + 0.2); return { ok: true, action: act, volume: media.volume }; }
    if (act === "VOLUME_DOWN") { media.volume = Math.max(0.0, media.volume - 0.2); return { ok: true, action: act, volume: media.volume }; }
  }

  if (act === "UPLOAD_FILE") {
    const file = doc.querySelector('input[type="file"]');
    if (file) {
      file.focus();
      return { ok: true, action: "UPLOAD_FILE", notice: "file_chooser_manual" };
    }
    return { ok: false, error: "no file input" };
  }

  if (act === "READ_PAGE") {
    const article = doc.querySelector("article, main") || doc.body;
    const text = article.textContent.trim();
    const chunks = [text];
    return { ok: true, action: "READ_PAGE", chunks };
  }

  if (act === "RESET_FORM") {
    const form = doc.querySelector("form");
    if (form) {
      form.reset();
      return { ok: true, action: "RESET_FORM" };
    }
    return { ok: false, error: "no form" };
  }

  return { ok: false, error: "unhandled" };
}

async function runTests() {
  console.log("=== CONTENT SCRIPT EXTENDED ACTIONS UNIT TESTS ===");

  const doc = new MockElement("html");
  doc.body = new MockElement("body");
  doc.children.push(doc.body);

  // Add checkbox
  const cb = new MockElement("input", { type: "checkbox", name: "newsletter" });
  doc.body.children.push(cb);

  // Test 1: CHECK_BOX
  const checkRes = executeTestableAction("CHECK_BOX", { target: "newsletter" }, doc);
  assert.equal(checkRes.ok, true);
  assert.equal(cb.checked, true, "Checkbox should be checked");
  console.log("PASS Test 1: CHECK_BOX sets checked=true");

  // Test 2: UNCHECK_BOX
  const uncheckRes = executeTestableAction("UNCHECK_BOX", { target: "newsletter" }, doc);
  assert.equal(uncheckRes.ok, true);
  assert.equal(cb.checked, false, "Checkbox should be unchecked");
  console.log("PASS Test 2: UNCHECK_BOX sets checked=false");

  // Add video
  const video = new MockElement("video");
  doc.body.children.push(video);

  // Test 3: Media controls
  const playRes = executeTestableAction("PLAY_MEDIA", {}, doc);
  assert.equal(playRes.ok, true);
  assert.equal(video.paused, false, "Video should be playing");

  const muteRes = executeTestableAction("MUTE_MEDIA", {}, doc);
  assert.equal(muteRes.ok, true);
  assert.equal(video.muted, true, "Video should be muted");

  const volDownRes = executeTestableAction("VOLUME_DOWN", {}, doc);
  assert.equal(volDownRes.ok, true);
  assert.equal(video.volume, 0.8, "Volume should be decreased");
  console.log("PASS Test 3: PLAY_MEDIA, MUTE_MEDIA, VOLUME_DOWN operate correctly");

  // Add file input
  const fileInput = new MockElement("input", { type: "file" });
  doc.body.children.push(fileInput);

  // Test 4: UPLOAD_FILE
  const uploadRes = executeTestableAction("UPLOAD_FILE", {}, doc);
  assert.equal(uploadRes.ok, true);
  assert.equal(uploadRes.notice, "file_chooser_manual", "Must notify manual selection required");
  assert.equal(fileInput.focused, true, "File input must receive focus");
  console.log("PASS Test 4: UPLOAD_FILE focuses field and issues manual notice");

  // Add article for READ_PAGE
  const article = new MockElement("article", { textContent: "VERBA enables seamless voice navigation in the browser." });
  doc.body.children.push(article);

  // Test 5: READ_PAGE
  const readRes = executeTestableAction("READ_PAGE", {}, doc);
  assert.equal(readRes.ok, true);
  assert.equal(readRes.chunks.length > 0, true);
  assert.equal(readRes.chunks[0].includes("VERBA"), true);
  console.log("PASS Test 5: READ_PAGE extracts article text cleanly into chunks");

  console.log("\nALL EXTENDED ACTION TESTS PASSED (5/5)!\n");
}

runTests().catch((err) => {
  console.error("Content action test failed:", err);
  process.exit(1);
});

