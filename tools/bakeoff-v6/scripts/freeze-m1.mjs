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
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const [runDir, outDir, prefix = "A"] = process.argv.slice(2);
if (!runDir || !outDir) {
  console.error("usage: node scripts/freeze-m1.mjs <results/run-dir> <out-dir> [prefix=A]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
// A re-freeze must produce a COMPLETE, self-consistent frozen set. Clear any {brief}.json left by a
// prior freeze first: if the draft set changed (a brief dropped, or its graph was re-drafted), a
// stale leftover would be silently reused by a later `--frozen-m1-dir` run and critiqued as if fresh.
let clearedStale = 0;
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".json")) { rmSync(join(outDir, f)); clearedStale++; }
}
if (clearedStale > 0) console.warn(`cleared ${clearedStale} stale frozen graph(s) from ${outDir} before re-freezing`);
const candDir = join(runDir, "candidates");
// Deterministic order: sort candidate files so freezing is reproducible regardless of the
// filesystem's readdir order (the frozen graph is the "identical M1" every M2 variant critiques).
const files = readdirSync(candDir).filter((f) => f.startsWith(`${prefix}_`)).sort();
let wrote = 0, skipped = 0, dupSeeds = 0;
const frozen = new Set(); // brief_id -> already frozen (first / lowest-seed wins deterministically)
for (const f of files) {
  const rec = JSON.parse(readFileSync(join(candDir, f), "utf-8"));
  // Freeze exactly ONE graph per brief. On a multi-seed run, keep the first (lowest seed by sort)
  // and skip the rest, so we never silently overwrite with the readdir-order-last seed.
  if (frozen.has(rec.brief_id)) { dupSeeds++; continue; }
  if (!rec.validation?.valid) { console.warn(`skip ${f}: source candidate INVALID — not freezing`); skipped++; continue; }
  const graph = rec.candidate;
  if (!graph || typeof graph !== "object") { console.warn(`skip ${f}: no candidate graph`); skipped++; continue; }
  writeFileSync(
    join(outDir, `${rec.brief_id}.json`),
    JSON.stringify({ brief_id: rec.brief_id, source: `${runDir} / ${f}`, candidate: graph }, null, 2) + "\n",
  );
  frozen.add(rec.brief_id);
  wrote++;
  console.log(`froze ${rec.brief_id} (from ${f})`);
}
console.log(`froze ${wrote} M1 graph(s) [one per brief] to ${outDir}; ${skipped} skipped (invalid/missing)${dupSeeds ? `; ${dupSeeds} extra seed-draw(s) ignored — first seed per brief wins` : ""}`);
