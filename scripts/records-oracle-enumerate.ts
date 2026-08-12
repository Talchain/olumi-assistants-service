/**
 * STEP-4 STOP-GATE — enumerate every distinct violation class the real validator
 * raises over the banked record-set corpus, in ONE run.
 *
 * Four live rounds each bought one rule of the grammar. This buys all of them.
 * A POSITIVE CONTROL guards the whole thing: an enumeration over zero decoded
 * inputs reports zero classes and is indistinguishable from a clean sweep.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { projectAndValidate, checkStatedContentSurvives } from "./records-validator-oracle.js";
import type { DraftRecordSet } from "../src/cee/draft/records/grammar.js";

function decode(file: string): DraftRecordSet | null {
  let raw: string;
  try {
    raw = String(JSON.parse(readFileSync(file, "utf8"))?.response?.body_text ?? "");
  } catch { return null; }
  let buf = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const frame = JSON.parse(line.slice(6));
      buf += frame?.delta?.partial_json ?? frame?.delta?.text ?? "";
    } catch { /* non-JSON frame */ }
  }
  try {
    const j = JSON.parse(buf) as DraftRecordSet;
    return Array.isArray(j?.stated_items) && j.stated_items.length > 0 ? j : null;
  } catch { return null; }
}

const classes = new Map<string, number>();
const blockingClasses = new Map<string, number>();
let fidelityFailures = 0;
const lostSamples: string[] = [];
const disclosedReasons = new Map<string, number>();
let decoded = 0, accepted = 0;
for (const dir of process.argv.slice(2)) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const records = decode(join(dir, f));
    if (!records) continue;
    decoded++;
    const r = projectAndValidate(records);
    if (r.ok) accepted++;
    for (const v of r.violations) {
      const key = v.shape ? `${v.code}  ${v.shape}` : v.code;
      classes.set(key, (classes.get(key) ?? 0) + 1);
    }
    for (const v of r.blocking) {
      const key = v.shape ? `${v.code}  ${v.shape}` : v.code;
      blockingClasses.set(key, (blockingClasses.get(key) ?? 0) + 1);
    }
    const fid = checkStatedContentSurvives(records, r);
    if (!fid.ok) { fidelityFailures++; lostSamples.push(...fid.silentlyLost.slice(0, 2)); }
    for (const d of r.disclosed) {
      const reason = d.split(":")[0]!;
      disclosedReasons.set(reason, (disclosedReasons.get(reason) ?? 0) + 1);
    }
  }
}

if (decoded < 10) {
  console.error(`FATAL: decoded only ${decoded} record sets — the instrument is blind, not the corpus clean`);
  process.exit(2);
}
console.log(`\n=== ORACLE ENUMERATION — ${decoded} banked record sets ===`);
console.log(`ACCEPTED by the gate (no bucket-C violation): ${accepted}/${decoded}`);
console.log(`\nBLOCKING CLASSES — the GATE (bucket C, derived from the sweep's own routing) (${blockingClasses.size}):`);
for (const [k, v] of [...blockingClasses.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}×  ${k}`);
}
console.log(`\nFIDELITY POSTCONDITION: ${decoded - fidelityFailures}/${decoded} record sets keep every stated atom preserved-or-disclosed`);
if (lostSamples.length > 0) {
  console.log(`  silently lost, sample:`);
  for (const q of lostSamples.slice(0, 6)) console.log(`    · ${q.slice(0, 90)}`);
}
console.log(`\nDIAGNOSTIC — ALL VIOLATION CLASSES (STRICT LOWER BOUND, NOT THE GATE) (${classes.size}):`);
for (const [k, v] of [...classes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}×  ${k}`);
}
console.log(`\nDISCLOSURE REASONS (${disclosedReasons.size}):`);
for (const [k, v] of [...disclosedReasons.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}×  ${k}`);
}
