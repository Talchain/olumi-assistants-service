/**
 * orchestrator-eval — decision_review FIXTURE-REGRESSION CLI.
 *
 * Run:  pnpm eval:decision-review
 *
 * The decision_review twin of `pnpm eval:orchestrator`: for every checked-in
 * fixture, assemble the user message through the PRODUCTION builder, score every
 * recorded candidate on the nineteen deterministic dimensions, and compare each
 * verdict — and each candidate's NAMED expected-failure dimensions — against the
 * fixture. Non-zero exit on any disagreement.
 *
 * Offline, deterministic, ZERO LLM, ZERO network. Ranking a live candidate
 * prompt is the other entrypoint (`pnpm eval:orchestrator:candidates --task
 * decision_review`), which is where the double opt-in and the turn cap live.
 *
 * Flags:
 *   --fixtures-dir <path>   override the fixture directory
 *   --out <path>            also write the full JSON report to a file
 *   --verbose               print every dimension, not just failures
 */

import { writeFileSync } from 'node:fs';
import {
  loadDecisionReviewFixtures,
  runDecisionReviewFixture,
  type DecisionReviewFixtureReport,
} from './src/decision-review/run.js';
import { promptHash16, readServedPromptText, V14_SERVED_HASH_16 } from './src/decision-review/served-contract.js';

interface CliArgs {
  readonly fixturesDir?: string;
  readonly outPath?: string;
  readonly verbose: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let fixturesDir: string | undefined;
  let outPath: string | undefined;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--fixtures-dir':
        fixturesDir = next();
        break;
      case '--out':
        outPath = next();
        break;
      case '--verbose':
        verbose = true;
        break;
      default:
        if (arg !== '--' && arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`);
    }
  }
  return { fixturesDir, outPath, verbose };
}

function printReport(reports: readonly DecisionReviewFixtureReport[], verbose: boolean): void {
  for (const r of reports) {
    console.log(
      `\n━━ ${r.fixtureId} — sections: ${r.assembly.sections.join(', ')} | ${r.assembly.userMessageChars} chars | margin ${r.assembly.margin ?? 'null'} ━━`,
    );
    for (const s of r.scores) {
      const agree = r.agreement[s.candidate] && r.dimensionAgreement[s.candidate];
      const failed = s.dimensions.filter((d) => !d.pass);
      console.log(
        `  ${agree ? ' ' : '!'} ${s.candidate}: ${s.pass ? 'PASS' : `FAIL (${failed.length}/${s.dimensions.length})`}${agree ? '' : '   <-- DISAGREES WITH FIXTURE'}`,
      );
      for (const d of verbose ? s.dimensions : failed) {
        const mark = d.pass ? '·' : '✗';
        const scanned = d.scanned === undefined ? '' : ` [scanned ${d.scanned}]`;
        console.log(`      ${mark} ${d.name} (${d.source})${scanned}: ${d.detail}`);
      }
    }
  }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const servedHash = promptHash16(readServedPromptText());

  console.log(
    `served decision_review prompt: sha256 ${servedHash}` +
      (servedHash === V14_SERVED_HASH_16
        ? ' (= PMS v14, the version this pack was baselined on)'
        : ` (DIFFERENT from the baselined v14 hash ${V14_SERVED_HASH_16} — the served contract has moved; re-read the drift test)`),
  );

  const fixtures = loadDecisionReviewFixtures(args.fixturesDir);
  const reports = fixtures.map(runDecisionReviewFixture);
  printReport(reports, args.verbose);

  const failing = reports.filter((r) => !r.ok);
  console.log(
    `\n${reports.length - failing.length}/${reports.length} fixtures agree with their recorded expectations.`,
  );
  if (failing.length > 0) {
    console.log(`DISAGREEMENT in: ${failing.map((r) => r.fixtureId).join(', ')}`);
  }

  if (args.outPath) {
    writeFileSync(args.outPath, JSON.stringify({ servedHash, reports }, null, 2));
    console.log(`full JSON report written to ${args.outPath}`);
  }
  return failing.length === 0 ? 0 : 1;
}

process.exit(main());
