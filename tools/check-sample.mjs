// Quick quality check for label dumps made with requestLabelDump().
//
//   node tools/check-sample.mjs samples/*.json
//
// For each dump it prints one line per field and flags the ones P2's
// matcher will struggle with:
//   NO LABEL   - no usable label found at all
//   DUPLICATE  - two fields share a label, so a spoken field name is ambiguous
import { readFileSync } from 'node:fs';

let total = 0, problems = 0;
for (const file of process.argv.slice(2)) {
  const dump = JSON.parse(readFileSync(file, 'utf8'));
  const fields = dump.fields || [];
  const seen = new Map();
  fields.forEach((f) => { if (f.label) seen.set(f.label.toLowerCase(), (seen.get(f.label.toLowerCase()) || 0) + 1); });

  console.log(`\n${file}\n  ${dump.url}  (${fields.length} fields)`);
  fields.forEach((f, i) => {
    const flags = [];
    if (!f.label) flags.push('NO LABEL');
    else if (seen.get(f.label.toLowerCase()) > 1) flags.push('DUPLICATE');
    total++; if (flags.length) problems++;
    const cands = (f.candidates || []).join(' | ');
    console.log(`  ${String(i + 1).padStart(2)}. ${(f.type || f.tag).padEnd(9)} ${String(f.label ?? '-').slice(0, 34).padEnd(34)} [${cands.slice(0, 50)}] ${flags.join(' ')}`);
  });
}
console.log(`\n${total} fields checked, ${problems} flagged.`);
