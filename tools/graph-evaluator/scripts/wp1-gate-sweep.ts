/**
 * WP1 EVIDENCE SWEEP (not a test, not part of the contract hash).
 *
 * Runs the FROZEN trust gates over every rich model banked under
 * `output/model-gen-20260921/arms/<arm>/<brief>/run_N/final_model.json` and prints
 * a per-arm, per-gate table.
 *
 * Its only job is ANTI-VACUITY: a gate set that returns the same answer for every
 * candidate is measuring itself. If a gate is PASS everywhere and NA nowhere, say
 * so rather than reporting it as a clean sheet.
 *
 * Usage: npx tsx scripts/wp1-gate-sweep.ts <armsDir>
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { readBriefs } from "../src/io.js";
import { runTrustGates, TRUST_GATE_IDS, type GateInput, type RichModelLike } from "../src/trust-gates.js";
import type { Brief } from "../src/types.js";

const armsDir = process.argv[2];
if (!armsDir || !existsSync(armsDir)) {
  console.error("usage: npx tsx scripts/wp1-gate-sweep.ts <armsDir>");
  process.exit(2);
}

const briefs = await readBriefs(join(import.meta.dirname ?? ".", "..", "briefs"));
const briefById = new Map<string, Brief>(briefs.map((b) => [b.id, b]));

const dirs = (p: string) => readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory());

type Tally = Record<string, Record<string, number>>;
const perArm: Record<string, Tally> = {};
const overall: Tally = {};
let models = 0;
const unknownBriefs = new Set<string>();

for (const arm of dirs(armsDir)) {
  perArm[arm] ??= {};
  for (const briefId of dirs(join(armsDir, arm))) {
    const brief = briefById.get(briefId);
    if (!brief) { unknownBriefs.add(briefId); continue; }
    for (const run of dirs(join(armsDir, arm, briefId))) {
      const file = join(armsDir, arm, briefId, run, "final_model.json");
      if (!existsSync(file)) continue;
      const rich = JSON.parse(readFileSync(file, "utf-8")) as RichModelLike;
      const input: GateInput = { rich, graph: null, brief };
      models++;
      for (const r of runTrustGates(input)) {
        perArm[arm]![r.gate] ??= { PASS: 0, FAIL: 0, NA: 0 };
        overall[r.gate] ??= { PASS: 0, FAIL: 0, NA: 0 };
        perArm[arm]![r.gate]![r.status]!++;
        overall[r.gate]![r.status]!++;
      }
    }
  }
}

const row = (t: Tally, g: string) => {
  const c = t[g] ?? { PASS: 0, FAIL: 0, NA: 0 };
  return `${c.PASS}/${c.FAIL}/${c.NA}`;
};
const gates = TRUST_GATE_IDS.filter((g) => g !== "G9");

console.log(`# WP1 gate sweep over ${models} banked rich models (PASS/FAIL/NA)\n`);
if (unknownBriefs.size > 0) console.log(`⚠ briefs with no oracle on disk, SKIPPED: ${[...unknownBriefs].join(", ")}\n`);
console.log(`| arm | ${gates.join(" | ")} |`);
console.log(`|---|${gates.map(() => "---").join("|")}|`);
for (const arm of Object.keys(perArm).sort()) {
  console.log(`| ${arm} | ${gates.map((g) => row(perArm[arm]!, g)).join(" | ")} |`);
}
console.log(`| **ALL** | ${gates.map((g) => row(overall, g)).join(" | ")} |`);

console.log("\n## Anti-vacuity check\n");
for (const g of gates) {
  const c = overall[g] ?? { PASS: 0, FAIL: 0, NA: 0 };
  const distinct = [c.PASS, c.FAIL, c.NA].filter((n) => n! > 0).length;
  console.log(`- ${g}: ${distinct === 1 ? "⚠ ONE ANSWER FOR EVERY CANDIDATE — suspect the probe" : "discriminates"} (${row(overall, g)})`);
}
