#!/usr/bin/env tsx
/**
 * CI entry point for the contract field guard. What it detects — and, more
 * importantly, what it deliberately does not — is in
 * `src/schemas/contract-field-guard.ts`.
 *
 *   npx tsx scripts/ci/contract-field-guard.ts            # check; exit 1 on drift
 *   npx tsx scripts/ci/contract-field-guard.ts --report   # print everything, exit 0
 *
 * Exit 1 when a finding has no recorded decision, OR when a recorded decision no
 * longer reproduces. Both directions, so the ledger can neither go silently
 * short nor silently rot.
 */
import {
  deriveSurfaces,
  runDetectors,
  adjudicate,
  DECISIONS,
  type Finding,
} from "../../src/schemas/contract-field-guard.js";
import { walkSource, scanSourceTokens, assertScanIsSound, REPO_ROOT } from "./contract-field-scan.js";

function line(f: Finding): string {
  return `  [${f.detector}] ${f.id}\n      ${f.detail}`;
}

function main(): void {
  const reportOnly = process.argv.includes("--report");

  const files = walkSource();
  const scan = scanSourceTokens(files);
  const unsound = assertScanIsSound(files, scan);
  if (unsound !== null) {
    // An unreadable result is a hard error, never a pass.
    console.error(`::error::contract-field-guard ${unsound}`);
    process.exit(1);
  }

  const surfaces = deriveSurfaces();
  const findings = runDetectors(surfaces, scan.occurrences);
  const report = adjudicate(findings, DECISIONS);

  console.log("CONTRACT FIELD GUARD — node/graph wire contract");
  console.log(`  surfaces:   ${surfaces.length}`);
  for (const s of surfaces) {
    console.log(`                ${s.name} — ${s.fields.length} fields, unknown keys: ${s.unknownKeys}`);
  }
  console.log(`  source:     ${scan.filesCounted} files counted of ${scan.filesWalked} walked (comments stripped)`);
  console.log(`  excluded:   ${scan.excluded.map((p) => p.replace(`${REPO_ROOT}/`, "")).join(", ")}`);
  console.log(`  control:    token 'kind' in ${scan.occurrences.get("kind") ?? 0} files`);
  console.log(`  findings:   ${findings.length} — accepted ${report.accepted.length}, OPEN ${report.open.length}`);
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
    console.error(`::error::${report.unadjudicated.length} contract-field finding(s) with no recorded decision.`);
    console.error("A twin or a dead field has appeared on the node/graph contract. RECORD THE DECISION it");
    console.error("demands in DECISIONS (src/schemas/contract-field-guard.ts). Do not delete the detector,");
    console.error("and do not declare a field purely to make this go green — that is how a twin is born.");
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
