/**
 * Agent-reply baseline scorer — CLI. Deterministic; calls no model and no service.
 *
 *   pnpm exec tsx tools/agent-reply-eval/cli.ts --captures-dir "$CAPTURES_DIR" \
 *     --current-build 8428207 --report Docs/evals/agent-reply/BASELINE-8428207.md [--json out.json]
 *
 * CAPTURES_DIR is a construction-witness `raw/` directory (`<label>-turns.jsonl`
 * + `<label>-summary.json`). It is local evidence, not part of this repository.
 *
 * --include takes capture labels (comma-separated). Default: the current build's
 * captures and the comparison set named in the baseline brief — c19, c19w, c16,
 * c17, c18 and every held-out `g*` capture present in the directory.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readCapture, scoreCapture } from './src/load.js';
import { renderReport, type CaptureMeta } from './src/report.js';
import type { TurnScore } from './src/score.js';

const DEFAULT_LABELS = ['c19-8428207', 'c19w-8428207', 'c16-fd312b5', 'c17-84a765e', 'c18-389051f'];
const CONTROL_VOCABULARY =
  /\b(?:click|press|tap|button|chip)\b|Use as starting|Change something first|Run analysis|Add this option|Suggest what it still needs|Build it again|\bRun\b/gi;

interface Args {
  capturesDir: string;
  include: string[] | null;
  currentBuild: string;
  report: string | null;
  json: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = { capturesDir: '', include: null, currentBuild: '8428207', report: null, json: null };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`missing value for ${k}`);
    if (k === '--captures-dir') a.capturesDir = v;
    else if (k === '--include') a.include = v.split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--current-build') a.currentBuild = v;
    else if (k === '--report') a.report = v;
    else if (k === '--json') a.json = v;
    else throw new Error(`unknown argument: ${k}`);
  }
  if (a.capturesDir === '') throw new Error('--captures-dir is required');
  return a;
}

function labelsFor(a: Args): string[] {
  if (a.include !== null) return a.include;
  const held = readdirSync(a.capturesDir)
    .filter((f) => /^g.*-turns\.jsonl$/.test(f))
    .map((f) => f.replace(/-turns\.jsonl$/, ''))
    .sort();
  return [...DEFAULT_LABELS, ...held];
}

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  const labels = labelsFor(a);
  const scores: TurnScore[] = [];
  const metas: CaptureMeta[] = [];
  let vocabHits = 0;
  let vocabTurns = 0;
  let replies = 0;
  for (const label of labels) {
    const path = join(a.capturesDir, `${label}-turns.jsonl`);
    if (!existsSync(path)) throw new Error(`capture not found: ${label}-turns.jsonl`);
    const capture = readCapture(path);
    const s = scoreCapture(capture);
    scores.push(...s);
    metas.push({
      label,
      build: capture.build,
      sameBuild: capture.sameBuild,
      turns: s.length,
      scenarios: [...new Set(capture.lines.map((l) => l.sc))],
    });
    for (const line of capture.lines) {
      const text = (line.json as { assistant_text?: unknown } | null)?.assistant_text;
      if (typeof text !== 'string' || text.trim() === '') continue;
      replies += 1;
      const n = (text.match(CONTROL_VOCABULARY) ?? []).length;
      vocabHits += n;
      if (n > 0) vocabTurns += 1;
    }
  }
  const command = [
    'pnpm exec tsx tools/agent-reply-eval/cli.ts',
    '--captures-dir "$CAPTURES_DIR"',
    ...(a.include !== null ? [`--include ${a.include.join(',')}`] : []),
    `--current-build ${a.currentBuild}`,
    ...(a.report !== null ? [`--report ${a.report}`] : []),
  ].join(' \\\n  ');
  const md = renderReport({
    scores,
    captures: metas,
    currentBuild: a.currentBuild,
    command,
    capturesLocation:
      '`CAPTURES_DIR` = the construction-witness `raw/` directory of the 23–24 Sep acceptance-witness runs (estate path `output/paul-test-20260923/construction-witness/raw`; local evidence, not in this repository). Default selection (no `--include`): c19, c19w, c16, c17, c18 and every held-out `g*` capture; the directory’s earlier `c*` captures are not scored',
    controlVocabulary: { hits: vocabHits, turnsWithHits: vocabTurns, turns: replies },
  });
  if (a.report !== null) {
    mkdirSync(dirname(a.report), { recursive: true });
    writeFileSync(a.report, md);
  }
  if (a.json !== null) {
    mkdirSync(dirname(a.json), { recursive: true });
    writeFileSync(a.json, `${JSON.stringify(scores, null, 2)}\n`);
  }
  const current = scores.filter((t) => t.key.build === a.currentBuild);
  const fails = (xs: TurnScore[], c: keyof TurnScore['checks']) => xs.filter((t) => t.checks[c].verdict === 'FAIL').length;
  console.log(
    JSON.stringify(
      {
        captures: labels.length,
        turns: scores.length,
        current_build_turns: current.length,
        current_build_fail: {
          leader_honesty: fails(current, 'LEADER_HONESTY'),
          action_truth: fails(current, 'ACTION_TRUTH'),
          caveat: fails(current, 'CAVEAT'),
          control_reference: fails(current, 'CONTROL_REFERENCE'),
          option_name_fidelity: fails(current, 'OPTION_NAME_FIDELITY'),
          units: fails(current, 'UNITS'),
          provenance_wording: fails(current, 'PROVENANCE_WORDING'),
        },
        report: a.report,
        json: a.json,
      },
      null,
      2,
    ),
  );
}

main();
