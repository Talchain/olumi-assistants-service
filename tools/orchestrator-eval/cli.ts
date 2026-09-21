/**
 * orchestrator-eval — CLI entry point.
 *
 * Runs every checked-in fixture through the chassis and prints a report. Exits
 * non-zero when any candidate's ACTUAL verdict disagrees with the fixture's
 * `expected` verdict — i.e. when the gate no longer catches the drift the
 * fixture was built to catch. That is the self-check that keeps this foundation
 * honest before the follow-up wires it as a real prompt-deploy gate.
 *
 * Run:  pnpm eval:orchestrator
 *
 * DEFAULT PATH IS OFFLINE — no paid LLM call. See src/judge-seam.ts for where a
 * live model / paid judge plugs in.
 */

import { loadFixtures, runFixture } from './src/run.js';
import type { FixtureReport } from './src/types.js';

function printReport(report: FixtureReport): void {
  const a = report.assembly;
  console.log(`\n━━ fixture: ${report.fixtureId} ━━`);
  console.log('  real assembly (production formatAnalysisForContext):');
  console.log(`    leading win_probability : ${a.leadingWinProbability ?? '(none)'}`);
  console.log(`    leading target_fit      : ${a.leadingTargetFit ?? '(none)'}`);
  console.log(
    `    win% vs target-fit kept distinct: ${a.distinguishesWinFromTargetFit ? 'YES' : 'NO'}`,
  );
  if (a.goalFitProse) console.log(`    goal_fit disclosure     : ${a.goalFitProse}`);

  console.log('  candidates:');
  for (const s of report.scores) {
    const agree = report.agreement[s.candidate];
    const verdict = s.pass ? 'PASS' : 'FAIL';
    const mark = agree ? 'ok' : 'UNEXPECTED';
    console.log(`    - ${s.candidate}: ${verdict}  [${mark}]`);
    for (const d of s.dimensions) {
      if (!d.pass) console.log(`        ✗ ${d.name} (${d.source}): ${d.detail}`);
    }
  }
}

function main(): number {
  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.error('No fixtures found in tools/orchestrator-eval/fixtures.');
    return 1;
  }
  let allOk = true;
  for (const fixture of fixtures) {
    const report = runFixture(fixture);
    printReport(report);
    if (!report.ok) allOk = false;
  }
  console.log(
    `\n${allOk ? 'PASS' : 'FAIL'} — ${fixtures.length} fixture(s); gate verdicts ${allOk ? 'matched' : 'DID NOT match'} expectations.`,
  );
  return allOk ? 0 : 1;
}

process.exit(main());
