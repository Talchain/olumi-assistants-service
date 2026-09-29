/**
 * Re-scores SAVED Layer 2 replies with the current `cases.ts` expectations — no new model calls. Used only to apply a
 * reported scorer fix; both the raw and the rescored files are kept. Usage: tsx rescore.ts out/results-<tag>.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CASES } from './cases.js';

const file = process.argv[2]!;
const d = JSON.parse(readFileSync(file, 'utf8'));
let changed = 0;
for (const c of CASES) {
  for (const arm of Object.values(d.cases[c.id].arms) as { layer2?: Record<string, unknown>[] }[]) {
    for (const r of arm.layer2 ?? []) {
      if (typeof r.text !== 'string') continue;
      const before = JSON.stringify([r.must_not_hits, r.should_hits]);
      r.must_not_hits = (c.expect.replyMustNot ?? []).filter((x) => x.re.test(r.text as string)).map((x) => x.id);
      r.should_hits = (c.expect.replyShould ?? []).filter((x) => x.re.test(r.text as string)).map((x) => x.id);
      if (JSON.stringify([r.must_not_hits, r.should_hits]) !== before) { changed += 1; console.log(`rescored ${c.id}: ${before} → ${JSON.stringify([r.must_not_hits, r.should_hits])}`); }
    }
  }
}
const out = file.replace(/\.json$/, '.rescored.json');
d.rescored_from = file;
writeFileSync(out, JSON.stringify(d, null, 2));
console.log(`changed ${changed} run(s); wrote ${out}`);
