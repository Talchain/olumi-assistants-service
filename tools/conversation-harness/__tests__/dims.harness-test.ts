/**
 * Self-test for the conversation-harness scorer dims: fixture envelopes ->
 * expected dim results. Deliberately NOT collected by the root required gate
 * (file suffix .harness-test.ts does not match the root include glob
 * `**.{test,spec}.*`). Run with:
 *   pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 *
 * Pure dims only — no src/ imports here, so the self-test runs without the
 * service's module graph. D11's src-guard integration is exercised by
 * score-run.ts at runtime (its imports fail loudly if the guard surface moves).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateFlakyDims,
  classifyQuestion,
  dimD1ChipNoRepeat,
  dimD2ChipPresence,
  dimD3QuestionBudget,
  dimD4Brevity,
  dimD8Latency,
  dimD9ConsentFriction,
  dimD10ReclickSafety,
  dimD11ProductionGuards,
  rowFromWire,
  runAllDims,
  type DimResult,
  type L0Snap,
  type TurnRow,
} from '../scorer/dims.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'));

function row(partial: Partial<TurnRow> & { turn: string }): TurnRow {
  return {
    turnClassHint: null,
    editIntent: false,
    onlyIf: null,
    skipped: false,
    duplicateOf: null,
    httpStatus: 200,
    startedAt: null,
    wallClockMs: null,
    assistantText: '',
    chips: [],
    substageTimings: null,
    ...partial,
  };
}

const CHIPS_A = [
  { id: 'c1', label: 'Run the analysis' },
  { id: 'c2', label: 'Add a factor' },
];
const CHIPS_B = [
  { id: 'c3', label: 'Compare options' },
  { id: 'c4', label: 'Set a target' },
];

describe('rowFromWire (fixture envelopes)', () => {
  it('extracts text, chips, and substage timings from a wire envelope', () => {
    const r = rowFromWire('S3O1', fixture('wire-eitheror-with-chips.json'), {
      turn_class_hint: 'coach',
      wall_clock_ms: 9000,
      http_status: 200,
    });
    expect(r.chips).toHaveLength(2);
    expect(r.assistantText).toContain('Would you prefer');
    expect(r.substageTimings).toMatchObject({ llm_call: 8200 });
  });

  it('yields an empty row for a skipped turn (no wire)', () => {
    const r = rowFromWire('S1C1', null, { skipped: true, only_if: 'consent_requested' });
    expect(r.skipped).toBe(true);
    expect(r.assistantText).toBe('');
  });
});

describe('D1 chip-no-repeat', () => {
  it('fails when 2+ turns repeat an identical non-empty chip set within K', () => {
    const rows = [
      row({ turn: 'T1', chips: CHIPS_A }),
      row({ turn: 'T2', chips: CHIPS_A }),
      row({ turn: 'T3', chips: CHIPS_A }),
    ];
    const d = dimD1ChipNoRepeat(rows);
    expect(d.verdict).toBe('fail');
    expect((d.details as any).identicalRepeats).toEqual(['T2', 'T3']);
  });

  it('passes when chip sets rotate', () => {
    const rows = [row({ turn: 'T1', chips: CHIPS_A }), row({ turn: 'T2', chips: CHIPS_B })];
    expect(dimD1ChipNoRepeat(rows).verdict).toBe('pass');
  });

  it('ignores duplicate-capture rows (S5 -dup is not a conversational repeat)', () => {
    const rows = [
      row({ turn: 'T1', chips: CHIPS_A }),
      row({ turn: 'T1-dup', chips: CHIPS_A, duplicateOf: 'T1' }),
      row({ turn: 'T2', chips: CHIPS_A }),
    ];
    // only one true repeat (T2) -> below the 2-repeat fail threshold
    expect(dimD1ChipNoRepeat(rows).verdict).toBe('pass');
  });
});

describe('D2 chip-presence-per-question-class', () => {
  it('classifies either/or and enumerated-choice questions', () => {
    const q = classifyQuestion('Would you rather ship fast, or hire the lead?');
    expect(q.eitherOr).toBe(true);
    expect(classifyQuestion('Which of the two options fits your budget?').enumerated).toBe(true);
    expect(classifyQuestion('The analysis is complete.').eitherOr).toBe(false);
  });

  it('fails an either/or envelope with no chips; passes one with chips', () => {
    const failing = rowFromWire('Q1', fixture('wire-eitheror-no-chips.json'), { turn_class_hint: 'coach' });
    const passing = rowFromWire('Q2', fixture('wire-eitheror-with-chips.json'), { turn_class_hint: 'coach' });
    expect(dimD2ChipPresence([failing]).verdict).toBe('fail');
    expect(dimD2ChipPresence([passing]).verdict).toBe('pass');
  });

  it('logs (not passes) when no qualifying question turns exist', () => {
    const d = dimD2ChipPresence([row({ turn: 'T1', assistantText: 'Analysis complete.' })]);
    expect(d.verdict).toBe('log');
  });
});

describe('D3 question budget (BASELINE-LOG)', () => {
  it('always logs, with per-class counts', () => {
    const d = dimD3QuestionBudget([
      row({ turn: 'T1', turnClassHint: 'coach', assistantText: 'Why? And also — what next?' }),
      row({ turn: 'T2', turnClassHint: 'edit', assistantText: 'Done.' }),
    ]);
    expect(d.verdict).toBe('log');
    expect((d.details as any).byClass.coach).toMatchObject({ turns: 1, questions: 2 });
    expect((d.details as any).byClass.edit).toMatchObject({ turns: 1, questions: 0 });
  });
});

describe('D4 brevity (advisory)', () => {
  it('advisory-fails an over-budget coach turn', () => {
    const long = row({ turn: 'T1', turnClassHint: 'coach', assistantText: 'word '.repeat(140).trim() });
    expect(dimD4Brevity([long]).verdict).toBe('advisory-fail');
    const short = row({ turn: 'T2', turnClassHint: 'coach', assistantText: 'Keep it short.' });
    expect(dimD4Brevity([short]).verdict).toBe('pass');
  });
});

describe('D8 latency budgets (advisory)', () => {
  it('advisory-fails an over-budget run_analysis turn and names slowest substages', () => {
    const d = dimD8Latency([
      row({
        turn: 'T1',
        turnClassHint: 'run_analysis',
        wallClockMs: 31_000,
        substageTimings: { plot_call: 22_000, compose: 400 },
      }),
    ]);
    expect(d.verdict).toBe('advisory-fail');
    const per = (d.details as any).perTurn[0];
    expect(per.over).toBe(true);
    expect(per.slowestSubstages[0][0]).toBe('plot_call');
  });

  it('passes within budget and is unmeasurable with no measurable turns', () => {
    expect(dimD8Latency([row({ turn: 'T1', turnClassHint: 'coach', wallClockMs: 5000 })]).verdict).toBe('pass');
    expect(dimD8Latency([row({ turn: 'T1' })]).verdict).toBe('unmeasurable');
  });
});

const SNAP = (label: string, at: string, sha: string, facts: any[] = []): L0Snap => ({
  label,
  captured_at: at,
  graph: { sha256: sha },
  handler_facts: facts,
});

describe('D9 consent friction (log mode — measures, never assumes)', () => {
  it('is unmeasurable without L0 snapshots when an edit intent exists', () => {
    const d = dimD9ConsentFriction([row({ turn: 'E1', editIntent: true })], []);
    expect(d.verdict).toBe('unmeasurable');
  });

  it('measures applied-in-DB friction from the graph sha series', () => {
    const rows = [
      row({ turn: 'E1', editIntent: true, startedAt: '2026-07-12T10:00:00.000Z' }),
      row({ turn: 'C1', onlyIf: 'consent_requested', startedAt: '2026-07-12T10:00:30.000Z' }),
    ];
    const snaps = [
      SNAP('00-baseline', '2026-07-12T09:59:00.000Z', 'sha-before'),
      SNAP('02-C1', '2026-07-12T10:01:00.000Z', 'sha-after'),
    ];
    const d = dimD9ConsentFriction(rows, snaps);
    expect(d.verdict).toBe('log');
    const perEdit = (d.details as any).perEdit[0];
    expect(perEdit.applied).toBe('02-C1');
    expect(perEdit.frictionSeconds).toBe(60);
    expect((d.details as any).consentTurnsRun).toEqual(['C1']);
  });

  it('reports applied=null when the edit never landed in DB', () => {
    const rows = [row({ turn: 'E1', editIntent: true, startedAt: '2026-07-12T10:00:00.000Z' })];
    const snaps = [
      SNAP('00-baseline', '2026-07-12T09:59:00.000Z', 'sha-same'),
      SNAP('01-E1', '2026-07-12T10:01:00.000Z', 'sha-same'),
    ];
    expect((dimD9ConsentFriction(rows, snaps).details as any).perEdit[0].applied).toBeNull();
  });
});

describe('D10 re-click safety', () => {
  const dupRows = [
    row({ turn: 'R1', turnClassHint: 'run_analysis', startedAt: '2026-07-12T10:00:00.000Z' }),
    row({ turn: 'R1-dup', duplicateOf: 'R1', httpStatus: 409 }),
  ];
  const fact = (sha: string, at: string) => ({
    v5_conversation_turn_id: 'row-1',
    handler_id: 'run_analysis',
    action_type: 'analysis',
    noop: false,
    created_at: at,
    fact_type: 'analysis_result',
    payload_sha256: sha,
  });

  it('fails on a double-committed identical fact (frozen graph -> identical payload sha)', () => {
    const snaps = [
      SNAP('00-baseline', '2026-07-12T09:59:00.000Z', 'g', []),
      SNAP('01-R1', '2026-07-12T10:02:00.000Z', 'g', [
        fact('sha-x', '2026-07-12T10:00:10.000Z'),
        { ...fact('sha-x', '2026-07-12T10:00:11.000Z'), v5_conversation_turn_id: 'row-2' },
      ]),
    ];
    const d = dimD10ReclickSafety(dupRows, snaps);
    expect(d.verdict).toBe('fail');
    expect((d.details as any).doubleCommits).toHaveLength(1);
  });

  it('passes on a single commit set', () => {
    const snaps = [
      SNAP('00-baseline', '2026-07-12T09:59:00.000Z', 'g', []),
      SNAP('01-R1', '2026-07-12T10:02:00.000Z', 'g', [fact('sha-x', '2026-07-12T10:00:10.000Z')]),
    ];
    expect(dimD10ReclickSafety(dupRows, snaps).verdict).toBe('pass');
  });

  it('is unmeasurable without a duplicate turn or without L0', () => {
    expect(dimD10ReclickSafety([row({ turn: 'T1' })], []).verdict).toBe('unmeasurable');
    expect(dimD10ReclickSafety(dupRows, []).verdict).toBe('unmeasurable');
  });
});

describe('D11 production-guard aggregation', () => {
  const clean = { forbidden: null, successClaim: null, heldScience: false, mutationLanguage: false, structuralSuccessClaim: false };
  it('fails on any guard hit and is unmeasurable without guardHits', () => {
    expect(dimD11ProductionGuards([row({ turn: 'T1', guardHits: clean })]).verdict).toBe('pass');
    expect(
      dimD11ProductionGuards([row({ turn: 'T1', guardHits: { ...clean, mutationLanguage: true } })]).verdict,
    ).toBe('fail');
    expect(dimD11ProductionGuards([row({ turn: 'T1' })]).verdict).toBe('unmeasurable');
  });
});

describe('aggregateFlakyDims (N=3 rerun majority)', () => {
  it('takes the majority verdict for flaky dims and keeps run-1 verdict for stable dims', () => {
    const mk = (dim: string, verdict: DimResult['verdict'], flaky: boolean): DimResult => ({
      dim,
      verdict,
      flaky,
      details: {},
      notes: [],
    });
    const agg = aggregateFlakyDims([
      [mk('D1', 'fail', true), mk('D8', 'pass', false)],
      [mk('D1', 'pass', true), mk('D8', 'advisory-fail', false)],
      [mk('D1', 'fail', true), mk('D8', 'pass', false)],
    ]);
    expect(agg.find((d) => d.dim === 'D1')?.verdict).toBe('fail');
    expect(agg.find((d) => d.dim === 'D8')?.verdict).toBe('pass');
    expect(agg.find((d) => d.dim === 'D8')?.notes.join(' ')).toContain('rerun spread');
  });
});

describe('runAllDims', () => {
  it('returns all eight dims exactly once', () => {
    const dims = runAllDims([row({ turn: 'T1' })], []);
    expect(dims.map((d) => d.dim.split('-')[0]).sort()).toEqual([
      'D1', 'D10', 'D11', 'D2', 'D3', 'D4', 'D8', 'D9',
    ]);
  });
});
