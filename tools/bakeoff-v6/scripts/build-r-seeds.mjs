/**
 * Build PROVISIONAL R-set seeds (memory aids, NOT R) from pooled M2 proposal
 * loci across one or more arm-C runs. De-authored + arm-blind (evidence_pointer
 * and rationale-first-sentence only; no arm/model/provenance). Near-duplicate
 * collapse by normalized evidence_pointer. Output: fixtures/r-sets/seeds/{id}.seed.json,
 * ratified:false — the loader ignores this subdir, so the R-pending gate stays intact.
 *
 * Usage: node scripts/build-r-seeds.mjs <results/dir1> [results/dir2 ...]
 * NOT R. Requires human ratification per seeds/_RATIFICATION-PROTOCOL.md.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = join(HERE, "../fixtures/r-sets/seeds");

const DEFER_TYPES = new Set(["added_evidence_gap", "uncertainty_flag", "clarification_proposal"]);
const norm = (s) => (s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();

const runDirs = process.argv.slice(2);
if (runDirs.length === 0) {
  console.error("usage: node scripts/build-r-seeds.mjs <results/dir> [more dirs]");
  process.exit(1);
}

const perBrief = new Map(); // brief_id -> Map(normKey -> {desc, kind, count})
for (const dir of runDirs) {
  const candDir = join(dir, "candidates");
  let files;
  try { files = readdirSync(candDir).filter((f) => f.startsWith("C_")); } catch { continue; }
  for (const f of files) {
    const rec = JSON.parse(readFileSync(join(candDir, f), "utf-8"));
    const brief = rec.brief_id;
    if (!rec.arm_c) continue;
    const bucket = perBrief.get(brief) ?? new Map();
    for (const p of rec.arm_c.proposals_raw) {
      if (!p || typeof p !== "object") continue;
      const ep = p.evidence_pointer;
      if (typeof ep !== "string" || !ep.trim()) continue;
      const key = norm(ep).slice(0, 80);
      if (!key) continue;
      const kind = DEFER_TYPES.has(p.type) ? "affirmative_defer" : "positive";
      const cur = bucket.get(key) ?? { desc: ep.trim().slice(0, 200), kind, count: 0 };
      cur.count += 1;
      bucket.set(key, cur);
    }
    perBrief.set(brief, bucket);
  }
}

mkdirSync(SEEDS_DIR, { recursive: true });
let wrote = 0;
for (const [brief, bucket] of perBrief) {
  const items = [...bucket.values()]
    .sort((a, b) => b.count - a.count)
    .map((v) => ({ suggested_kind: v.kind, description: v.desc, seen_count: v.count }));
  const seed = {
    ratified: false,
    brief_id: brief,
    note: "memory aid only — pooled, de-authored M2 proposal loci; NOT R. Ratify per seeds/_RATIFICATION-PROTOCOL.md.",
    candidate_items: items,
  };
  writeFileSync(join(SEEDS_DIR, `${brief}.seed.json`), JSON.stringify(seed, null, 2) + "\n");
  wrote++;
  console.log(`seed ${brief}: ${items.length} candidate loci`);
}
console.log(`wrote ${wrote} PROVISIONAL seeds to fixtures/r-sets/seeds/ (NOT R; human ratification required)`);
