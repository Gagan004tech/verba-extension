# Label samples (P3 -> P2, handoff #5)

Each `.json` file is the output of `requestLabelDump()` on one page:

```json
{ "url": "...", "fields": [ { "name", "id", "tag", "type", "label", "candidates": ["full name", "name"] } ] }
```

- `label` is the single best label the scanner found.
- `candidates` is every label variant, strongest first. The matcher should score a
  spoken field name against all of them (this is what the service worker does today).
- Files starting with `local-` come from our own `test-forms/` corpus.
- Files starting with `real-` come from live websites (one file per page or form step).

## Capture a new sample

1. `npm run build`, reload the extension, open the page, refresh it.
2. Open the service worker console (chrome://extensions -> VERBA -> "service worker").
3. Run `requestLabelDump()`, wait for "dump ready", then `copy(JSON.stringify(lastDump, null, 2))`.
4. Paste into `samples/real-<site>-<page>.json`.
5. For multi-step forms, capture each step separately (`-step1`, `-step2`).

## Check a sample before sending

```
node tools/check-sample.mjs samples/real-*.json
```

It flags fields with no label and fields that share a label.
