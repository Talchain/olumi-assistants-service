/**
 * Freeze M1 graphs from a completed run into a frozen-M1 dir, so arm C can
 * critique the IDENTICAL graph across every M2 variant (removing the
 * M1-variation confounder). Extracts each candidate's raw draft graph; arm C
 * re-runs the same boundary normalisation on it, so a raw arm-A candidate is
 * the right source.
 *
 * Usage: node scripts/freeze-m1.mjs <results/run-dir> <out-dir> [prefix=A]
 * Writes <out-dir>/{brief_id}.json = { brief_id, source, candidate: <graph> }.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [runDir, outDir, prefix = "A"] = process.argv.slice(2);
if (!runDir || !outDir) {
  console.error("usage: node scripts/freeze-m1.mjs <results/run-dir> <out-dir> [prefix=A]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const candDir = join(runDir, "candidates");
const files = readdirSync(candDir).filter((f) => f.startsWith(`${prefix}_`) || f.startsWith(`${prefix}`) && f.includes("_"));
let wrote = 0, skipped = 0;
for (const f of readdirSync(candDir)) {
  if (!f.startsWith(`${prefix}_`)) continue;
  const rec = JSON.parse(readFileSync(join(candDir, f), "utf-8"));
  if (!rec.validation?.valid) { console.warn(`skip ${rec.brief_id}: source candidate was INVALID — not freezing`); skipped++; continue; }
  const graph = rec.candidate;
  if (!graph || typeof graph !== "object") { console.warn(`skip ${rec.brief_id}: no candidate graph`); skipped++; continue; }
  writeFileSync(
    join(outDir, `${rec.brief_id}.json`),
    JSON.stringify({ brief_id: rec.brief_id, source: `${runDir} / ${f}`, candidate: graph }, null, 2) + "\n",
  );
  wrote++;
  console.log(`froze ${rec.brief_id}`);
}
console.log(`froze ${wrote} M1 graphs to ${outDir} (${skipped} skipped as invalid/missing)`);
