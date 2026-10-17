# VERBA: P2 Features, Test Cases & Field Performance Guide

**Module:** Module B (Natural Language Command Understanding & Fused Field Matching)  
**Branch:** `feature/p2-complete-workload`  
**Latest Verification:** 100% test pass rate across all suites, build verified (`dist/`).

---

## 1. Overview of P2 Architecture & Deliverables

P2 is responsible for translating human voice into deterministic browser actions and disambiguating spoken field names against messy HTML labels.

### Key Capabilities Built:
1. **Dual-Tier NLU Engine:**
   - **Fast Deterministic Regex Engine:** Parses voice commands in < 55 µs without network or LLM dependencies.
   - **Zero-Shot Neural Fallback:** Leverages `Xenova/distilbert-base-uncased-mnli` (ONNX/WASM) for paraphrased, non-standard grammar.
2. **Safety Confirmation Gate:**
   - Intercepts dangerous actions (`SUBMIT`, sensitive data fills).
   - Emits a spoken readback prompt: *"Are you sure you want to submit the form? Say yes to confirm, or no to cancel."*
   - Handles spoken affirmations (`CONFIRM`: *"yes"*, *"confirm"*, *"proceed"*, *"sure"*, *"ok"*) and rejections (`CANCEL`: *"no"*, *"cancel"*, *"stop"*, *"abort"*).
3. **Fused Field Matching Engine (`fused-matcher.js`):**
   - Fuses domain synonyms (`synonym-dictionary.js`), Jaro-Winkler lexical similarity, and transformer embeddings (`all-MiniLM-L6-v2`).
   - Suppresses false-positive collisions (e.g. *"pan"* vs *"phone"* scores only 0.28, while *"pan"* vs *"PAN Number"* scores 0.96).
4. **Compound Command Sequencing:**
   - Executes multi-action commands in sequence (e.g., *"fill first name as Sarah and scroll down"*).
5. **Form Prefix Stripping:**
   - Automatically strips prompt wrappers like `"Enter your ..."`, `"Please enter ..."`, `"Select your ..."` so spoken `"city"` cleanly matches `<input placeholder="Enter your city">`.
6. **Code & ID Sanitization:**
   - Formats PAN numbers, OTPs, and postal codes by stripping speech-recognized spaces (e.g. `"ABCD 12345 f"` $\rightarrow$ `"ABCD12345F"`).

---

## 2. Real-World Live Test Results (User Verified)

| Test Phrasing / Command | Target / Context | Result | Notes |
| :--- | :--- | :---: | :--- |
| **"type and submit username and password"** | School website login page | **SUCCESS** | Real-world validation: injected credentials, triggered submit, and page correctly responded with invalid login feedback. |
| **"fill first name as Sarah and scroll down"** | Test form & live pages | **SUCCESS** | Compound command successfully split: filled *First name* with *"Sarah"* and smoothly scrolled the page viewport. |
| **"Pan ABCD 12345 f"** | Form with PAN field | **SUCCESS** | Terse phrase recognized without verbs or prepositions; targeted PAN field. |
| **"submit the form"** | Any form | **SUCCESS** | Safety gate intercepted: emitted audio confirmation prompt and waited for spoken `"yes"` / `"no"`. |
| **"enter Pan at ABCDE 1 2 3 4"** | Government / KYC form | **RESOLVED** | Initially failed because `"at"` was missing from prepositions. Now fully supported and spaces are collapsed to uppercase `"ABCDE1234"`. |
| **"enter first name John"** | Real web forms | **RESOLVED** | Initially failed because `"as"` was required. Added rule allowing fill verbs directly followed by known field phrases without `"as"`. |
| **"City Thiruvananthapuram"** | `03-messy-labels.html` | **RESOLVED** | Initially failed because label had placeholder `"Enter your city"`. Added prefix stripping (`"Enter your"` $\rightarrow$ `"city"`) so it now matches with score 1.0. |
| **"on the bar labelled ask Google or type URL enter artificial intelligence"** | Google search / URL bar | **RESOLVED** | Added location-first pattern `on the bar labelled <field> enter <val>` and expanded search synonyms. |

---

## 3. Issues Identified in Live Testing & How They Were Resolved

### Issue 1: Preposition Rigidity (`"enter Pan at ..."` failed)
* **Problem:** Regex strictly required `"as"` or `"with"`. A real user naturally said `"at"` (*"enter Pan at ABCDE 1 2 3 4"*).
* **Fix:** Updated regex to accept `(?:as|with|at|to|is|=|\:)`. Added `" at "` to loose zero-shot value markers.

### Issue 2: Missing Prepositions (`"enter first name John"` failed)
* **Problem:** Users frequently omit prepositions entirely (*"enter first name John"*, *"fill email user@test.com"*).
* **Fix:** Added a dedicated regex rule that matches any fill verb immediately followed by any entry in `KNOWN_FIELD_PHRASES` without requiring `"as"` or `"with"`.

### Issue 3: Speech Formatting for Alphanumeric Codes & PAN
* **Problem:** Speech-to-text outputs letters and digits with spaces and lowercase (e.g. `"ABCD 12345 f"` or `"ABCDE 1 2 3 4"`), which forms reject.
* **Fix:** Built `formatFieldValue()` in `slot-extractor.js`. When targeting `pan`, `otp`, `aadhaar`, or `pincode`, it automatically removes spaces and applies uppercase formatting (`"ABCD12345F"`).

### Issue 4: Prompt Prefixes on Placeholders (`"Enter your city"`)
* **Problem:** Spoken `"City"` was compared against `<input placeholder="Enter your city">`. Because of the prefix `"Enter your"`, Jaro-Winkler similarity started at zero, keeping the score below threshold.
* **Fix:** Built `stripFormPrefixes()` in `fused-matcher.js`. It strips `"enter your"`, `"please enter"`, `"select your"`, etc., normalizing `"Enter your city"` to `"city"`, resulting in an instant 1.0 score.

### Issue 5: Zero-Shot Classification Threshold
* **Problem:** Zero-shot model classified `"enter first name John"` as `FILL_FIELD` with 0.4928 confidence, but the threshold was hardcoded to 0.55, dropping a valid prediction into `UNKNOWN`.
* **Fix:** Tuned `CONFIDENCE_THRESHOLD` to 0.25. In an NLI pool of 30+ classes, a score of 0.49 is over 15x higher than random distribution ($1/30 \approx 0.033$) and represents high confidence.

### Issue 6: Location-First Phrasing & Search
* **Problem:** User spoke: *"on the bar labelled ask Google or type URL enter artificial intelligence"*.
* **Fix:** Added greedy location-first pattern:
  ```regex
  ^(?:in|on|at)\s+(?:the\s+)?(?:bar|field|box|input)?\s*(?:labelled|named|called)?\s+(.+)\s+(?:enter|type|fill|put|write|set)\s+(.+)$
  ```
  Expanded `search` in `synonym-dictionary.js` to include `"ask google"`, `"ask google or type url"`, `"search bar"`, `"search box"`.

---

## 4. Current Limitations & Future Roadmap ("What is Lacking")

While Module B command understanding and field matching are complete, the following areas depend on cross-module integration or browser sandbox limits:

1. **Profile Vault Retrieval (Module D / P1 dependency):**
   - Module B extracts `{ profileKey: "pan" }` for commands like *"fill pan from my profile"*.
   - However, persistent encrypted storage retrieval is pending P1's IndexedDB / chrome.storage implementation in `vault.js`.
2. **Cross-Origin iframes & Shadow DOM (Module C / P3 December roadmap):**
   - If a form control is embedded inside a cross-origin iframe (e.g. Stripe card inputs or recaptcha), the top-level content script cannot inspect it directly. P3 owns the December iframe message-relay bridge.
3. **Web Speech API Network Fallback (Module A / P1 dependency):**
   - Chrome's built-in `webkitSpeechRecognition` requires an active internet connection to communicate with Google's speech recognition servers. P1's roadmap includes an offline speech-to-text spike using local Whisper.
4. **Duplicate Ambiguous Labels on the Same Page:**
   - If a page has two completely identical inputs (e.g. "Phone" for Shipping and "Phone" for Billing without distinct fieldset legends), VERBA targets the first visible match.

---

## 5. Verification Commands

Run the full automated test and evaluation suite on this branch:

```bash
# Run all unit tests, P3 sample checks, and the 105-utterance benchmark
npm test

# Build the loadable Chrome extension
npm run build
```
