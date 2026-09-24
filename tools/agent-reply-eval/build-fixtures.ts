/**
 * Build the shared acceptance fixture (prompt/harness half) from construction-witness captures.
 *
 *   pnpm exec tsx tools/agent-reply-eval/build-fixtures.ts --captures-dir "$CAPTURES_DIR" \
 *     --cases-out Docs/evals/agent-reply/fixtures/cases.json \
 *     --test-out tools/agent-reply-eval/__tests__/fixtures/real-turns.json
 *
 * Each case is one captured response cut to what the scorer reads, ids removed.
 * The builder REFUSES to write a case when:
 *   - the scorer's class differs from the class the case is selected for;
 *   - stripping changed any verdict or the class (the stripped payload must carry
 *     everything the scorer reads — the proof is that it scores identically);
 *   - the serialised case contains anything id-like.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHECK_NAMES, type CheckName, type Verdict } from './src/checks.js';
import type { CaseClass } from './src/classify.js';
import { assertNoIds, expectFor, scoreFixtureCase, stripPayload, type FixtureCase } from './src/fixture.js';
import { readCapture, scoreCapture } from './src/load.js';

interface Pick {
  readonly id: string;
  readonly capture: string;
  readonly turn: string;
  readonly cls: CaseClass;
}

/** One or two per class, current build first; an older build only where the current one has no such turn. */
const CASES: readonly Pick[] = [
  { id: 'build-hiring', capture: 'c19-8428207', turn: 'A1 brief', cls: 'build_hiring' },
  { id: 'build-pricing', capture: 'c19-8428207', turn: 'B1 brief', cls: 'build_pricing' },
  { id: 'build-heldout', capture: 'g11-0415b19', turn: 'G1 brief', cls: 'build_heldout' },
  { id: 'run-leader-permitted', capture: 'c16-fd312b5', turn: 'A2r run (typed Run)', cls: 'run_leader_permitted' },
  { id: 'run-leader-withheld-near-tie', capture: 'c19-8428207', turn: 'A2r run (typed Run)', cls: 'run_leader_withheld' },
  { id: 'run-leader-withheld-constraint', capture: 'c19-8428207', turn: 'B2r run (typed Run)', cls: 'run_leader_withheld' },
  { id: 'run-blocked', capture: 'c19-8428207', turn: 'O5 run after adding the option (typed Run)', cls: 'run_blocked' },
  { id: 'approval-chip', capture: 'c19-8428207', turn: 'A2 approve (typed chip)', cls: 'approval_chip' },
  { id: 'approval-typed', capture: 'c19w-8428207', turn: 'W2 approve in words', cls: 'approval_typed' },
  { id: 'edit-no-run', capture: 'c19-8428207', turn: 'A3 canvas edit', cls: 'edit_no_run' },
  { id: 'rerun-after-edit', capture: 'c19-8428207', turn: 'A5 re-run', cls: 'rerun_after_edit' },
  { id: 'rerun-no-change', capture: 'c19-8428207', turn: 'A7 re-run', cls: 'rerun_no_change' },
  { id: 'challenge', capture: 'c19-8428207', turn: 'A6 challenge', cls: 'challenge' },
  { id: 'uncertainty-followup', capture: 'c19-8428207', turn: 'B3 uncertainty', cls: 'uncertainty_followup' },
];

/** Three real turns for the scorer's own classification test. */
const TEST_TURNS: readonly Pick[] = [
  { id: 'real-run-near-tie', capture: 'c19-8428207', turn: 'A2r run (typed Run)', cls: 'run_leader_withheld' },
  { id: 'real-run-blocked', capture: 'c19-8428207', turn: 'O5 run after adding the option (typed Run)', cls: 'run_blocked' },
  { id: 'real-approval-chip', capture: 'c19-8428207', turn: 'A2 approve (typed chip)', cls: 'approval_chip' },
];

const verdictsOf = (checks: Record<CheckName, { verdict: Verdict }>): Record<CheckName, Verdict> =>
  Object.fromEntries(CHECK_NAMES.map((c) => [c, checks[c].verdict])) as Record<CheckName, Verdict>;

function build(capturesDir: string, picks: readonly Pick[]): FixtureCase[] {
  return picks.map((p) => {
    const capture = readCapture(join(capturesDir, `${p.capture}-turns.jsonl`));
    const scores = scoreCapture(capture);
    const idx = capture.lines.findIndex((l) => l.turn === p.turn);
    if (idx < 0) throw new Error(`${p.id}: turn "${p.turn}" not in ${p.capture}`);
    const full = scores.find((s) => s.key.index === idx)!;
    if (full.cls !== p.cls) throw new Error(`${p.id}: scorer classifies it ${full.cls}, selected as ${p.cls}`);
    const line = capture.lines[idx]!;
    const payload = stripPayload(line.json);
    const base = {
      id: p.id,
      source: { capture: p.capture, build: capture.build, scenario: line.sc, turn: p.turn },
      context: {
        user_action: full.userAction,
        domain: full.domain,
        rerun_kind: full.context.rerunKind,
        next_approval_ran: full.context.nextApprovalRan,
      },
      payload,
    };
    const stripped = scoreFixtureCase(base);
    const before = JSON.stringify(verdictsOf(full.checks));
    const after = JSON.stringify(verdictsOf(stripped.checks));
    if (stripped.cls !== full.cls || before !== after) {
      throw new Error(`${p.id}: stripping changed the result (${full.cls} ${before} → ${stripped.cls} ${after})`);
    }
    const fixture: FixtureCase = { ...base, class: p.cls, expect: expectFor(stripped, payload), served_reply_verdicts: verdictsOf(stripped.checks) };
    assertNoIds(JSON.stringify(fixture));
    return fixture;
  });
}

function write(path: string, cases: readonly FixtureCase[], note: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = {
    schema: 'olumi.agent-reply-acceptance-fixture.v1',
    half: 'prompt_harness',
    note,
    builds: [...new Set(cases.map((c) => c.source.build))],
    cases,
  };
  const text = `${JSON.stringify(body, null, 2)}\n`;
  assertNoIds(text);
  writeFileSync(path, text);
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (k: string): string | null => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : null;
  };
  const dir = arg('--captures-dir');
  if (dir === null) throw new Error('--captures-dir is required');
  const casesOut = arg('--cases-out');
  const testOut = arg('--test-out');
  if (casesOut !== null) {
    write(
      casesOut,
      build(dir, CASES),
      'Prompt/harness half of the shared Agent-reply acceptance fixture. payload = the captured response cut to what the scorer reads, ids removed. expect = what a good reply to the same state must and must not do. served_reply_verdicts = what the served reply actually did (a record, not an expectation). Rendering expectations (expect_render) are added by the AI Conversation lane.',
    );
    console.log(`wrote ${CASES.length} cases → ${casesOut}`);
  }
  if (testOut !== null) {
    write(testOut, build(dir, TEST_TURNS), 'Real captured turns (ids removed) for the scorer’s classification self-test.');
    console.log(`wrote ${TEST_TURNS.length} turns → ${testOut}`);
  }
}

main();
