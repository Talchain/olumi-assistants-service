/**
 * orchestrator-eval — SEAM-1 candidate A/B CLI.
 *
 * Ranks prompt CANDIDATES (not recorded fixture responses) against the
 * checked-in scenario pack, scored by the same deterministic dimensions as
 * `pnpm eval:orchestrator` (including substance — an empty answer fails) plus
 * the extraction contract (a raw_unparsed turn is a failed turn).
 *
 * Run:  pnpm eval:orchestrator:candidates -- --prompt A=mock:good --prompt B=mock:regression
 *
 * DEFAULT PATH IS OFFLINE — zero network, zero paid calls. Live production
 * needs the double opt-in (ORCHESTRATOR_EVAL_LIVE_CANDIDATES=1 AND --live)
 * plus an explicit --model, and is hard-capped in turns per run. See the
 * README "Candidate A/B (SEAM-1)" section for the coach-arm walkthrough,
 * cost expectations, and the upload/pin gate (orchestrator + Paul — this tool
 * ranks, it never ships).
 *
 * Flags:
 *   --prompt <label>=<ref>   candidate; ref = file path | pms:<version> | mock:<label>
 *   --live                   CLI half of the live double opt-in
 *   --model <id>             model for live production (required in live mode)
 *   --max-turns <n>          lower (never raise) the hard per-run turn cap
 *   --fixtures-dir <path>    override the fixture directory
 *   --out <path>             also write the full JSON report to a file
 */

import { writeFileSync } from 'node:fs';
import { runCandidateEval, type CandidateEvalReport } from './src/candidate-run.js';
import { parsePromptSpec, type CandidatePromptSpec } from './src/prompt-source.js';
import { loadFixtures } from './src/run.js';

interface CliArgs {
  readonly specs: CandidatePromptSpec[];
  readonly modelId?: string;
  readonly maxTurns?: number;
  readonly fixturesDir?: string;
  readonly outPath?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const specs: CandidatePromptSpec[] = [];
  let modelId: string | undefined;
  let maxTurns: number | undefined;
  let fixturesDir: string | undefined;
  let outPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--prompt':
        specs.push(parsePromptSpec(next()));
        break;
      case '--model':
        modelId = next();
        break;
      case '--max-turns':
        maxTurns = Number(next());
        break;
      case '--fixtures-dir':
        fixturesDir = next();
        break;
      case '--out':
        outPath = next();
        break;
      default:
        // --live is consumed by the gate (which reads the full argv); a bare
        // `--` is pnpm/npm's pass-through separator. Anything else unknown is
        // a loud error, not a silent ignore.
        if (arg !== '--live' && arg !== '--' && arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`);
    }
  }
  return { specs, modelId, maxTurns, fixturesDir, outPath };
}

function printReport(report: CandidateEvalReport): void {
  console.log(`\nmode: ${report.live ? 'LIVE' : 'offline'} (${report.gateReason})`);
  if (report.model) console.log(`model: ${report.model}`);
  console.log(`turns used: ${report.turnsUsed}`);

  for (const c of report.candidates) {
    const flagged = c.flaggedTurnCount > 0 ? `, ${c.flaggedTurnCount} turn(s) FLAGGED raw_unparsed` : '';
    console.log(`\n━━ candidate ${c.label} (${c.kind}: ${c.ref}) — ${c.passCount}/${c.results.length} fixtures pass${flagged} ━━`);
    for (const r of c.results) {
      const verdict = r.pass ? 'PASS' : 'FAIL';
      console.log(`  - ${r.fixtureId}: ${verdict}  [extraction: ${r.extraction}]`);
      if (r.error) console.log(`      ! ${r.error}`);
      if (r.score) {
        for (const d of r.score.dimensions) {
          if (!d.pass) console.log(`      ✗ ${d.name} (${d.source}): ${d.detail}`);
        }
      }
    }
  }

  console.log(`\nRANKING (best first): ${report.ranking.join('  >  ')}`);
  const [best, second] = report.ranking;
  if (second) {
    const a = report.candidates.find((c) => c.label === best);
    const b = report.candidates.find((c) => c.label === second);
    if (
      a &&
      b &&
      a.passCount === b.passCount &&
      a.flaggedTurnCount === b.flaggedTurnCount &&
      a.failedDimensionCount === b.failedDimensionCount
    ) {
      console.log('NOTE: top candidates are TIED on this scenario pack — the ranking above is alphabetical, not a verdict.');
    }
  }
  console.log('Reminder: this ranks candidates; uploading/pinning a prompt stays orchestrator+Paul-gated.');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.specs.length === 0) {
    console.error(
      'usage: pnpm eval:orchestrator:candidates -- --prompt <label>=<ref> [--prompt <label>=<ref> ...]\n' +
        '  ref = file path | pms:<version> | mock:<recorded-label>\n' +
        '  live production additionally needs ORCHESTRATOR_EVAL_LIVE_CANDIDATES=1, --live, and --model <id>.',
    );
    return 1;
  }

  const report = await runCandidateEval({
    specs: args.specs,
    fixtures: loadFixtures(args.fixturesDir),
    gateInput: { env: process.env, argv: process.argv },
    maxTurns: args.maxTurns,
    modelId: args.modelId,
  });

  printReport(report);
  if (args.outPath) {
    writeFileSync(args.outPath, JSON.stringify(report, null, 2));
    console.log(`\nfull JSON report written to ${args.outPath}`);
  }

  // Exit code: 0 when every produced turn was scorable (extraction never
  // 'model_error'); the RANKING itself is advisory output, not a gate.
  const anyProductionFailure = report.candidates.some((c) => c.results.some((r) => r.extraction === 'model_error'));
  return anyProductionFailure ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  },
);
