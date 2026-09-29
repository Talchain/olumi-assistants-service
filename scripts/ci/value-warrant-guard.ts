#!/usr/bin/env tsx
/**
 * CI entry point for the value warrant guard. What it detects — and, more
 * importantly, the five things it deliberately cannot see — is in
 * `src/schemas/value-warrant-guard.ts`. Read that header before believing a
 * green run means anything wider than the node/graph wire contract.
 *
 *   npx tsx scripts/ci/value-warrant-guard.ts            # check; exit 1 on drift
 *   npx tsx scripts/ci/value-warrant-guard.ts --report   # print the table, exit 0
 *
 * Exit 1 when a finding has no recorded decision, when a recorded decision no
 * longer reproduces, or when the warrant vocabulary has gone dead. All three
 * directions, so nothing here can silently go short or silently rot.
 */
import {
  deriveWarrantRoots,
  deriveValueSites,
  runWarrantDetectors,
  deadVocabulary,
  adjudicate,
  WARRANT_DECISIONS,
  WARRANT_TOKENS,
  type Finding,
  type ValueSite,
} from "../../src/schemas/value-warrant-guard.js";

function row(s: ValueSite): string {
  const warrants = [
    ...s.fieldWarrants.map((w) => `${w} (field)`),
    ...s.levelWarrants.map((w) => `${w} (level)`),
  ];
  return (
    `  ${s.verdict.padEnd(12)} ${s.id.padEnd(66)} ` +
    `${s.required ? "REQ" : "opt"} ${(s.bounds || "-").padEnd(14)} ` +
    (warrants.length > 0 ? warrants.join(", ") : "—")
  );
}

function line(f: Finding): string {
  return `  [${f.detector}] ${f.id}\n      ${f.detail}`;
}

function main(): void {
  const reportOnly = process.argv.includes("--report");

  const roots = deriveWarrantRoots();
  const sites = deriveValueSites(roots);

  // Controls, before any result is believed. An empty or single-verdict
  // enumeration is an instrument failure, never a clean bill of health:
  // when a per-item probe returns the same answer for every item, suspect
  // the probe (CLAUDE.md trap 20).
  if (sites.length === 0) {
    console.error("::error::value-warrant-guard derived 0 value sites — the walk is blind, not the contract clean");
    process.exit(1);
  }
  const verdicts = new Set(sites.map((s) => s.verdict));
  if (verdicts.size < 2) {
    console.error(
      `::error::value-warrant-guard returned '${[...verdicts][0]}' for all ${sites.length} sites — ` +
        "a probe that cannot discriminate is reporting on itself, not on the contract",
    );
    process.exit(1);
  }
  const dead = deadVocabulary(sites);
  if (dead.length > 0) {
    console.error(`::error::${dead.length} warrant token(s) no longer match any field — the vocabulary has rotted.`);
    for (const t of dead) console.error(`  · ${t.token} — witness \`${t.witness}\` is gone from the schemas`);
    process.exit(1);
  }

  const findings = runWarrantDetectors(sites);
  const report = adjudicate(findings, WARRANT_DECISIONS);

  const count = (v: string): number => sites.filter((s) => s.verdict === v).length;

  console.log("VALUE WARRANT GUARD — does each boundary number carry the metadata that makes it refusable?");
  console.log(`  roots:      ${roots.length} — ${roots.map((r) => r.name).join(", ")}`);
  console.log(`  vocabulary: ${WARRANT_TOKENS.length} tokens — ${WARRANT_TOKENS.map((t) => t.token).join(", ")}`);
  console.log(`  sites:      ${sites.length} value-bearing fields`);
  console.log(
    `  verdicts:   FIELD ${count("FIELD")} · LEVEL_SOLE ${count("LEVEL_SOLE")} · ` +
      `LEVEL_SHARED ${count("LEVEL_SHARED")} · NONE ${count("NONE")}`,
  );
  console.log(`  findings:   ${findings.length} — accepted ${report.accepted.length}, OPEN ${report.open.length}`);
  console.log("");
  console.log("  VERDICT      FIELD                                                              REQ BOUNDS         WARRANTS");
  for (const s of sites) console.log(row(s));
  console.log("");

  if (report.open.length > 0) {
    console.log(`⚠ OPEN QUESTIONS (${report.open.length}) — recorded, NOT settled. Nobody has answered these:`);
    for (const d of report.open) console.log(`  · ${d.id}\n      ${d.decision}\n`);
  }

  if (reportOnly) {
    console.log("ALL FINDINGS:");
    for (const f of findings) console.log(line(f));
    process.exit(0);
  }

  let failed = false;

  if (report.unadjudicated.length > 0) {
    failed = true;
    console.error(`::error::${report.unadjudicated.length} value-warrant finding(s) with no recorded decision.`);
    console.error("A number crossing a service boundary has no metadata making it interpretable or refusable.");
    console.error("RECORD THE DECISION it demands in WARRANT_DECISIONS (src/schemas/value-warrant-guard.ts).");
    console.error("⛔ Do NOT declare a field purely to turn this green — a defaulted provenance is a");
    console.error("manufactured attestation, which is worse than none. An OPEN entry is a legitimate answer.");
    for (const f of report.unadjudicated) console.error(line(f));
  }

  if (report.stale.length > 0) {
    failed = true;
    console.error(`::error::${report.stale.length} recorded decision(s) no longer reproduce — delete them.`);
    console.error("A decision kept after its finding is gone is the false label this estate keeps paying for.");
    for (const d of report.stale) console.error(`  · ${d.id}\n      ${d.decision}`);
  }

  if (failed) process.exit(1);
  console.log("✅ every finding has a recorded decision, and every decision still reproduces.");
}

main();
