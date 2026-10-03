/**
 * SC-24 — "previous Run vs this Run" carries what differed in the inputs between the two Runs, in the authored units
 * (schemas 0.68.0). A row has NO author — an input can differ because the user edited it or because an Olumi proposal
 * was approved — so no reader may render it as "you changed" (AIQ binding rule, schemas #76 5916401270).
 *
 * Design SC-24 v2 (programme-docs #84 5914416431); lease DL #75 5914474485; one Run-unit carrier AIQ 5912905493 /
 * P0 SHARED DATA 5914750268.
 *
 * Rows:
 *   A  £59 → £60 on an option, with builds unverifiable (PLoT's build echo off): the pair used to emit NOTHING; it
 *      now emits C5_unattributed with the exact input row — outcome movement still direction-only.
 *   B  a C2 pair (different samples) still carries its true input change — attribution never hides an input.
 *   C  one Run re-delivered (same run_id on both ends) is never compared with itself.
 *   D  a legacy end (no snapshot) says not_recorded and carries NO list; no C5 is minted for it.
 *   E  a unit-only goal edit (£ → USD) is its own row — AIQ 5912905493's case.
 *   F  status-quo values CEE held on both Runs are not option edits; the factor row says what moved.
 *   G  a label-only rename is not an input change.
 *   H  (AIQ F1 on #2378) a Run whose leader claim is withheld ships NO win shares on the pair — they would name the
 *      withheld leader by arithmetic; a pair entitled on both ends keeps them (control).
 *   I  (P0 PARTNER 5917596263 open 2) vary-and-diff: with the current Run's leader withheld, varying every stored share
 *      and the goal chance leaves `run_delta` byte-identical; on an entitled pair the same variation moves it (control).
 *   J  (open 3) a C5_unattributed pair carries rows and ids only — no causal wording anywhere in the block.
 *   K  (P0 SHARED DATA 5917660267 · AIQ 5917724983) an ENCODED-only change never becomes an authored `raw`: no row, and
 *      the pair is `partial`; the authored £59 → £60 row stays (control).
 *   L  a link's spread / existence probability that changed with no row kind → `partial`, never "complete, nothing
 *      changed"; an identical pair stays `complete` with [] (control).
 *   M  (AIQ 5918134795) a link's β is the engine's number, never a row figure: a β-only change → no row, `partial`;
 *      a link added / removed → a presence row with no figure; the £59 → £60 option row stays `complete` (controls). *   N  (UNDO 5918366712 · AIQ 5918201688) a stated range that moved (5–20 → 5–30) has no row kind → `partial`, []; an
 *      author-only difference and identical ranges stay `complete` (controls).
 */
import { describe, expect, it } from 'vitest';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';

import { buildRunDelta } from '../build-run-delta.js';
import { diffRunInputs, diffRunInputSnapshots } from '../run-input-changes.js';
import { olumiSpreadForMean } from '../../../cee/magnitude/olumi-spread.js';
import { PRESENT_PAIR, runAnalysisFact } from '../../context/__tests__/run-delta-fixtures.js';
import { withholdOptionGoalFigures } from '../../../orchestrator/context/constraint-feasibility.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_WITHHELD_CODES } from '../../../orchestrator/context/option-result-source.js';

// 0.71.0: every hand-built snapshot carries the SAME residual by default — "everything this snapshot does not record was
// unchanged" — so these rows test the recorded fields. The residual's own rows (absent / different → partial) are below.
const RESIDUAL = 'c'.repeat(64);
const snap = (over: Partial<RunInputSnapshot> = {}, price = 59): RunInputSnapshot => ({
  snapshot_version: 1,
  sent_digest: 'a'.repeat(64),
  residual_digest: RESIDUAL,
  goal: { node_id: 'goal_mrr', label: 'Pro MRR', target_raw: 55000, unit: 'GBP per month', operator: '>=' },
  options: [
    { option_id: 'opt-a', label: 'Raise price', settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: price, unit: 'GBP', encoded: price }] },
    { option_id: 'opt-b', label: 'Hold', is_baseline: true,
      settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, held: true }] },
  ],
  options_not_sent: [],
  factors: [{ factor_id: 'fac_churn', label: 'Monthly churn', raw: 3.7, unit: '%', encoded: 0.037, source: 'user_override' }],
  constraints: [],
  links: [{ from: 'fac_price', to: 'fac_churn', mean: 0.4 }],
  ...over,
});

function fact(opts: {
  seed: string; hash: string; at: string; builds?: Record<string, string> | null;
  runId?: string; snapshot?: RunInputSnapshot; wins?: [number, number]; mayName?: boolean; pGoal?: number;
}): HandlerFact {
  const [a, b] = opts.wins ?? [0.45, 0.55];
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: [
          { option_id: 'opt-a', option_label: 'Raise price', win_probability: a },
          { option_id: 'opt-b', option_label: 'Hold', win_probability: b },
        ],
        meta: { seed_used: opts.seed, n_samples: 10_000 },
        ...(opts.pGoal !== undefined ? { probability_of_goal: opts.pGoal } : {}),
        ...(opts.builds === null ? {} : { _meta: { builds: opts.builds ?? { plot: 'p1', isl: 'i1' } } }),
      },
      computed_at: opts.at,
      graph_hash_at_run: opts.hash,
      constraint_verdict: { may_name_leading_option: opts.mayName ?? true, constraint_verdict_state: 'evaluated_feasible' },
      ...(opts.runId !== undefined ? { run_id: opts.runId } : {}),
      ...(opts.snapshot !== undefined ? { input_snapshot: opts.snapshot } : {}),
    },
  } as unknown as HandlerFact;
}

const T1 = '2026-09-30T14:02:00.000Z';
const T2 = '2026-09-30T14:09:00.000Z';

describe('SC-24 · buildRunDelta carries the exact input changes', () => {
  it('A: £59 → £60 with builds unverifiable → C5_unattributed + the input row (used to emit nothing)', () => {
    // An option edit moves the hash, not the seed; PLoT's build echo is off → the §b table names no case.
    const facts = [
      fact({ seed: '7', hash: 'h-b', at: T2, builds: null, runId: 'run-b', snapshot: snap({}, 60) }),
      fact({ seed: '7', hash: 'h-a', at: T1, builds: null, runId: 'run-a', snapshot: snap({}, 59) }),
    ];
    const out = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.delta.attribution_case).toBe('C5_unattributed');
    expect(out.delta.endpoints).toEqual({ prior: { run_id: 'run-a', computed_at: T1 }, current: { run_id: 'run-b', computed_at: T2 } });
    expect(out.delta.input_coverage).toBe('complete');
    expect(out.delta.input_changes).toEqual([{
      entity_kind: 'option_setting', entity_id: 'fac_price', option_id: 'opt-a', field: 'value',
      label_before: 'Pro price', label_after: 'Pro price',
      before: { raw: 59, unit: 'GBP' }, after: { raw: 60, unit: 'GBP' }, change: 'changed',
    }]);
    expect(RunDeltaSchema.safeParse(out.delta).success).toBe(true);
  });

  it('A-control: the same pair WITHOUT recorded inputs still emits nothing (no C5 without rows to show)', () => {
    const facts = [
      fact({ seed: '7', hash: 'h-b', at: T2, builds: null }),
      fact({ seed: '7', hash: 'h-a', at: T1, builds: null }),
    ];
    expect(buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true })).toEqual({ kind: 'none', reason: 'no_honest_attribution_case' });
  });

  it('B: a C2 pair (different samples) still carries its true input change', () => {
    const facts = [
      fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: snap({}, 60) }),
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: snap({}, 59) }),
    ];
    const out = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true });
    expect(out.kind === 'ok' && out.delta.attribution_case).toBe('C2_unpaired');
    expect(out.kind === 'ok' && out.delta.input_changes?.map((r) => [r.entity_id, r.before, r.after])).toEqual([
      ['fac_price', { raw: 59, unit: 'GBP' }, { raw: 60, unit: 'GBP' }],
    ]);
  });

  it('C: one Run re-delivered (same run_id on both ends) is never compared with itself', () => {
    const facts = [
      fact({ seed: '8', hash: 'h-a', at: T2, runId: 'run-a', snapshot: snap() }),
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: snap() }),
    ];
    expect(buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true })).toEqual({ kind: 'none', reason: 'same_run_replayed' });
  });

  it('D: a legacy prior (no snapshot, no run_id) says not_recorded and carries no list', () => {
    const facts = [
      fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: snap({}, 60) }),
      fact({ seed: '7', hash: 'h-a', at: T1 }),
    ];
    const out = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.delta.input_coverage).toBe('not_recorded');
    expect(out.delta.input_changes).toBeUndefined();
    expect(out.delta.endpoints).toBeUndefined();
  });

  it('two intentional Runs with the SAME inputs are distinct and report no input change ([])', () => {
    const facts = [
      fact({ seed: '8', hash: 'h-a', at: T2, runId: 'run-b', snapshot: snap() }),
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: snap() }),
    ];
    const out = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true });
    expect(out.kind === 'ok' && out.delta.input_changes).toEqual([]);
  });
});

describe('SC-24 · diffRunInputSnapshots', () => {
  it('E: a unit-only goal edit (£ → USD) is its own row even with the target unchanged', () => {
    const rows = diffRunInputSnapshots(snap(), snap({ goal: { node_id: 'goal_mrr', label: 'Pro MRR', target_raw: 55000, unit: 'USD per month', operator: '>=' } }));
    expect(rows.filter((r) => r.entity_kind === 'goal').map((r) => [r.field, r.before, r.after])).toEqual([
      ['target', { raw: 55000, unit: 'GBP per month' }, { raw: 55000, unit: 'USD per month' }],
      ['unit', { raw: 'GBP per month' }, { raw: 'USD per month' }],
    ]);
  });

  it('F: a factor value moving under a held status quo is ONE factor row, not an option edit', () => {
    const held = (price: number): RunInputSnapshot['options'][number] =>
      ({ option_id: 'opt-b', label: 'Hold', settings: [{ factor_id: 'fac_price', raw: price, unit: 'GBP', encoded: price, held: true }] });
    const rows = diffRunInputSnapshots(
      snap({ options: [held(49)], factors: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49 }] }),
      snap({ options: [held(50)], factors: [{ factor_id: 'fac_price', label: 'Pro price', raw: 50, unit: 'GBP', encoded: 50 }] }),
    );
    expect(rows.map((r) => [r.entity_kind, r.entity_id])).toEqual([['factor_value', 'fac_price']]);
  });

  it('G: a label-only rename is not an input change; a removed link and an added option are', () => {
    const renamed = snap({ factors: [{ factor_id: 'fac_churn', label: 'Churn (monthly)', raw: 3.7, unit: '%', encoded: 0.037, source: 'user_override' }] });
    expect(diffRunInputSnapshots(snap(), renamed)).toEqual([]);
    const next = snap({ links: [], options: [...snap().options, { option_id: 'opt-c', label: 'Annual plan', settings: [] }] });
    expect(diffRunInputSnapshots(snap(), next).map((r) => [r.entity_kind, r.field, r.change])).toEqual([
      ['option', 'presence', 'added'],
      // A link carries no user figure (AIQ 5918134795): its leaving is a presence row, never its β as a "value".
      ['link', 'presence', 'removed'],
    ]);
  });

  it('producer order: option settings first, then factors, goal, limits, links', () => {
    const next = snap({
      goal: { node_id: 'goal_mrr', label: 'Pro MRR', target_raw: 60000, unit: 'GBP per month', operator: '>=' },
      factors: [{ factor_id: 'fac_churn', label: 'Monthly churn', raw: 4.1, unit: '%', encoded: 0.041, source: 'user_override' }],
      // The existing link keeps its β; a NEW link enters (a presence row — a β change alone would be no row, see M).
      links: [{ from: 'fac_price', to: 'fac_churn', mean: 0.4 }, { from: 'fac_churn', to: 'goal_mrr', mean: 0.3 }],
    }, 60);
    expect(diffRunInputSnapshots(snap(), next).map((r) => r.entity_kind)).toEqual(['option_setting', 'factor_value', 'goal', 'link']);
  });

  it('H: a withheld leader on either Run ships no win shares on the pair; both entitled keeps them (AIQ F1)', () => {
    const withheldCurrent = [
      runAnalysisFact([{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '222', 'hash-b', '2026-06-07T00:00:00.000Z', false),
      runAnalysisFact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', 'hash-a', '2026-06-06T00:00:00.000Z', true),
    ];
    const withheldPrior = [
      runAnalysisFact([{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '222', 'hash-b', '2026-06-07T00:00:00.000Z', true),
      runAnalysisFact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', 'hash-a', '2026-06-06T00:00:00.000Z', false),
    ];
    for (const facts of [withheldCurrent, withheldPrior]) {
      const built = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true });
      expect(built.kind).toBe('ok');
      if (built.kind !== 'ok') return;
      expect(built.delta.win_probabilities).toEqual([]);
      expect(built.delta.leader.changed).toBe(false);
    }
    // The turn itself unentitled: same authority, no shares.
    const turnWithheld = buildRunDelta({ priorFacts: PRESENT_PAIR, mayNameLeadingOption: false });
    expect(turnWithheld.kind === 'ok' ? turnWithheld.delta.win_probabilities : null).toEqual([]);
    // Control: both Runs and the turn entitled keep the shares.
    const control = buildRunDelta({ priorFacts: PRESENT_PAIR, mayNameLeadingOption: true });
    expect(control.kind === 'ok' ? control.delta.win_probabilities.map((w) => [w.option_id, w.prior, w.current]) : null)
      .toEqual([['opt-a', 0.62, 0.45], ['opt-b', 0.38, 0.55]]);
  });

  it('I: vary-and-diff — a withheld current leader: shares and goal chance move, run_delta does not; entitled control moves', () => {
    const pair = (wins: [number, number], pGoal: number, mayName: boolean) => [
      fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: snap({}, 60), wins, pGoal, mayName }),
      // The prior Run is entitled and held FIXED: only what the current Run withheld varies.
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: snap({}, 59), wins: [0.62, 0.38], pGoal: 0.5 }),
    ];
    const deltaOf = (wins: [number, number], pGoal: number, mayName: boolean) => {
      const out = buildRunDelta({ priorFacts: pair(wins, pGoal, mayName), mayNameLeadingOption: true });
      expect(out.kind).toBe('ok');
      return out.kind === 'ok' ? JSON.stringify(out.delta) : '';
    };
    // Withheld: nothing the Run withheld can move the block.
    expect(deltaOf([0.45, 0.55], 0.2, false)).toBe(deltaOf([0.9, 0.1], 0.97, false));
    expect(deltaOf([0.45, 0.55], 0.2, false)).not.toMatch(/0\.45|0\.55|0\.9|0\.97/);
    // Control: entitled on both ends, the same variation is visible.
    expect(deltaOf([0.45, 0.55], 0.2, true)).not.toBe(deltaOf([0.9, 0.1], 0.97, true));
  });

  it('J: a C5_unattributed pair carries rows and ids only — no causal wording', () => {
    const facts = [
      fact({ seed: '7', hash: 'h-b', at: T2, builds: null, runId: 'run-b', snapshot: snap({}, 60) }),
      fact({ seed: '7', hash: 'h-a', at: T1, builds: null, runId: 'run-a', snapshot: snap({}, 59) }),
    ];
    const out = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true });
    expect(out.kind === 'ok' && out.delta.attribution_case).toBe('C5_unattributed');
    const body = JSON.stringify(out.kind === 'ok' ? out.delta : null);
    expect(body).not.toMatch(/because|caus|due to|drove|driv|led to|explain|so that|therefore|result(s|ed)? (of|in|from)/i);
    // Positive control: the lexicon catches a causal phrase when one is present.
    expect(body.replace('Pro price', 'Pro price drove churn')).toMatch(/drove/);
  });

  it('K: an encoded-only change is never shown as the user\'s figure — no row, coverage partial; authored control stays', () => {
    const encodedOnly = (encoded: number) => snap({
      options: [
        { option_id: 'opt-a', label: 'Raise price', settings: [{ factor_id: 'fac_price', label: 'Pro price', encoded }] },
        { option_id: 'opt-b', label: 'Hold', is_baseline: true, settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, held: true }] },
      ],
    });
    const out = buildRunDelta({ priorFacts: [
      fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: encodedOnly(0.5) }),
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: encodedOnly(0.4) }),
    ], mayNameLeadingOption: true });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.delta.input_coverage).toBe('partial');
    expect(out.delta.input_changes).toEqual([]);
    expect(JSON.stringify(out.delta)).not.toMatch(/"raw":0\.[45]\b/);
    expect(RunDeltaSchema.safeParse(out.delta).success).toBe(true);
    // Control: authored on both ends → the £59 → £60 row, complete.
    const authored = buildRunDelta({ priorFacts: [
      fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: snap({}, 60) }),
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: snap({}, 59) }),
    ], mayNameLeadingOption: true });
    expect(authored.kind === 'ok' && [authored.delta.input_coverage, authored.delta.input_changes?.[0]?.before, authored.delta.input_changes?.[0]?.after])
      .toEqual(['complete', { raw: 59, unit: 'GBP' }, { raw: 60, unit: 'GBP' }]);

    // P0 SHARED DATA 5918159419: the SAME authored figure on both ends but a different number SENT (option £59 both
    // ends, 0.4 → 0.5 dispatched; factor 3.7% both ends, 0.037 → 0.041) is no row and partial — never "complete".
    const sentOnly = (optEncoded: number, facEncoded: number) => snap({
      options: [
        { option_id: 'opt-a', label: 'Raise price', settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 59, unit: 'GBP', encoded: optEncoded }] },
        { option_id: 'opt-b', label: 'Hold', is_baseline: true, settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, held: true }] },
      ],
      factors: [{ factor_id: 'fac_churn', label: 'Monthly churn', raw: 3.7, unit: '%', encoded: facEncoded, source: 'user_override' }],
    });
    for (const [a, b] of [[sentOnly(0.4, 0.037), sentOnly(0.5, 0.037)], [sentOnly(0.4, 0.037), sentOnly(0.4, 0.041)]] as const) {
      const out = buildRunDelta({ priorFacts: [
        fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: b }),
        fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: a }),
      ], mayNameLeadingOption: true });
      expect(out.kind === 'ok' ? [out.delta.input_coverage, out.delta.input_changes] : out).toEqual(['partial', []]);
    }
    // Control: identical inputs stay complete with [].
    const same = buildRunDelta({ priorFacts: [
      fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: sentOnly(0.4, 0.037) }),
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: sentOnly(0.4, 0.037) }),
    ], mayNameLeadingOption: true });
    expect(same.kind === 'ok' ? [same.delta.input_coverage, same.delta.input_changes] : same).toEqual(['complete', []]);
  });

  it('L: a link\'s spread or existence probability changed → partial, not "complete, nothing changed"; identical stays complete', () => {
    const withLink = (std: number, p: number) => snap({ links: [{ from: 'fac_price', to: 'fac_churn', mean: 0.4, std, exists_probability: p }] });
    const coverage = (a: RunInputSnapshot, b: RunInputSnapshot) => {
      const out = buildRunDelta({ priorFacts: [
        fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: b }),
        fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: a }),
      ], mayNameLeadingOption: true });
      return out.kind === 'ok' ? [out.delta.input_coverage, out.delta.input_changes] : out;
    };
    expect(coverage(withLink(0.1, 0.8), withLink(0.9, 0.8))).toEqual(['partial', []]);
    expect(coverage(withLink(0.1, 0.8), withLink(0.1, 0.2))).toEqual(['partial', []]);
    expect(coverage(withLink(0.1, 0.8), withLink(0.1, 0.8))).toEqual(['complete', []]);
  });

  it('M: a link\'s β is never a row figure — β-only change → no row + partial; presence rows carry no figure', () => {
    const run = (a: RunInputSnapshot, b: RunInputSnapshot) => {
      const out = buildRunDelta({ priorFacts: [
        fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: b }),
        fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: a }),
      ], mayNameLeadingOption: true });
      expect(out.kind).toBe('ok');
      return out.kind === 'ok' ? out.delta : null;
    };
    const beta = run(snap(), snap({ links: [{ from: 'fac_price', to: 'fac_churn', mean: 0.5 }] }));
    expect([beta?.input_coverage, beta?.input_changes]).toEqual(['partial', []]);
    expect(JSON.stringify(beta)).not.toMatch(/"raw":0\.[45]\b/);
    // Controls: a link added / removed is a presence row with no figure; the authored option row stays complete.
    const added = run(snap({ links: [] }), snap());
    expect(added?.input_changes).toEqual([{ entity_kind: 'link', entity_id: 'fac_price->fac_churn', link: { from: 'fac_price', to: 'fac_churn' },
      field: 'presence', before: null, after: { raw: true }, change: 'added' }]);
    expect(added?.input_coverage).toBe('complete');
    const removed = run(snap(), snap({ links: [] }));
    expect(removed?.input_changes?.map((r) => [r.field, r.change, r.before, r.after])).toEqual([['presence', 'removed', { raw: true }, null]]);
    const option = run(snap({}, 59), snap({}, 60));
    expect([option?.input_coverage, option?.input_changes?.map((r) => [r.entity_kind, r.before, r.after])])
      .toEqual(['complete', [['option_setting', { raw: 59, unit: 'GBP' }, { raw: 60, unit: 'GBP' }]]]);
    expect(RunDeltaSchema.safeParse(added).success && RunDeltaSchema.safeParse(beta).success).toBe(true);
  });

  it('N: a stated range that moved → partial, no row; author-only and identical ranges stay complete', () => {
    const withRange = (high: number, source = 'user_stated') => snap({
      options: [
        { option_id: 'opt-a', label: 'Raise price', settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 10, unit: 'days', encoded: 10,
          range: { low: 5, high, meaning: 'likely_range', source } }] },
        { option_id: 'opt-b', label: 'Hold', is_baseline: true, settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, held: true }] },
      ],
    });
    const pair = (a: RunInputSnapshot, b: RunInputSnapshot) => {
      const out = buildRunDelta({ priorFacts: [
        fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: b }),
        fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: a }),
      ], mayNameLeadingOption: true });
      return out.kind === 'ok' ? [out.delta.input_coverage, out.delta.input_changes] : out;
    };
    expect(pair(withRange(20), withRange(30))).toEqual(['partial', []]);
    expect(pair(withRange(20), withRange(20, 'brief_extraction'))).toEqual(['complete', []]);
    expect(pair(withRange(20), withRange(20))).toEqual(['complete', []]);
  });
});

/**
 * ⭐ 0.70.0 (R3 DEFECT 3, #85 5936673643; DL 5937207590): a link's edit in the user's terms. Before 0.70.0 every link
 * edit was `partial` with NO row — the engine numbers are never a row figure (AIQ 5918134795) — and accepting Olumi's
 * estimate moved no number at all, so R3's Accept → Run pair showed nothing for it.
 */
describe('0.70.0 · link rows in the user\'s terms (band, who sized it)', () => {
  const pairOf = (a: RunInputSnapshot, b: RunInputSnapshot) => {
    const out = buildRunDelta({ priorFacts: [
      fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: b }),
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: a }),
    ], mayNameLeadingOption: true });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') throw new Error(out.reason);
    expect(RunDeltaSchema.safeParse(out.delta).success, 'the contract accepts the delta').toBe(true);
    return out.delta;
  };
  type L = RunInputSnapshot['links'][number];
  const withLink = (l: Partial<L>) => snap({ links: [{ from: 'fac_price', to: 'fac_churn', mean: 0.5, ...l }] });
  const LINK = { entity_kind: 'link', entity_id: 'fac_price->fac_churn', link: { from: 'fac_price', to: 'fac_churn' } };

  it('RED (the Accept step): placeholder → accepted, same β → ONE `sizing` row, coverage complete', () => {
    const d = pairOf(withLink({ band: 'strong', sizing: 'placeholder' }), withLink({ band: 'strong', sizing: 'olumi_accepted' }));
    expect(d.input_coverage).toBe('complete');
    expect(d.input_changes).toEqual([{ ...LINK, field: 'sizing', before: { raw: 'placeholder' }, after: { raw: 'olumi_accepted' }, change: 'changed' }]);
  });

  it('RED: a band move (moderate → strong) is a `strength` row with the contract\'s band literals — never the β', () => {
    // The spread that moves WITH the band is the writer's own (`olumiSpreadForMean`): 0.1 × 0.55 / 0.3.
    const followed = olumiSpreadForMean({ oldMean: 0.3, oldStd: 0.1, newMean: 0.55 });
    const d = pairOf(withLink({ mean: 0.3, std: 0.1, band: 'moderate', sizing: 'user' }), withLink({ mean: 0.55, std: followed, band: 'strong', sizing: 'user' }));
    expect(d.input_coverage).toBe('complete');
    expect(d.input_changes).toEqual([{ ...LINK, field: 'strength', before: { raw: 'moderate' }, after: { raw: 'strong' }, change: 'changed' }]);
    expect(JSON.stringify(d.input_changes)).not.toMatch(/0\.(3|55)\b/);
  });

  // ⭐ DL ruling #2482 (5939864517) P1 #1 — a band row states the move of the MEAN only; it never absorbs a sign flip or
  // a spread the move does not explain. CODEX's two reproductions, then the fixture's own arbitrary spread.
  it('RED (CODEX repro 1): a sign flip +0.30 → −0.55 across bands → the band row, but partial — never complete', () => {
    const d = pairOf(withLink({ mean: 0.3, std: 0.1, band: 'moderate', sizing: 'user' }),
      withLink({ mean: -0.55, std: olumiSpreadForMean({ oldMean: 0.3, oldStd: 0.1, newMean: -0.55 }), band: 'strong', sizing: 'user' }));
    expect(d.input_coverage).toBe('partial');
    expect(d.input_changes?.map((r) => r.field)).toEqual(['strength']);
  });

  it('RED (CODEX repro 2): an independent spread 0.10 → 0.50 beside a band move → partial', () => {
    const d = pairOf(withLink({ mean: 0.3, std: 0.1, band: 'moderate', sizing: 'user' }), withLink({ mean: 0.55, std: 0.5, band: 'strong', sizing: 'user' }));
    expect(d.input_coverage).toBe('partial');
  });

  it('CONTROL: a spread that is not the writer\'s own for the move (0.1 → 0.0866) → partial; the writer\'s own → complete', () => {
    const before = withLink({ mean: 0.3, std: 0.1, band: 'moderate', sizing: 'user' });
    expect(pairOf(before, withLink({ mean: 0.55, std: 0.0866, band: 'strong', sizing: 'user' })).input_coverage).toBe('partial');
    expect(pairOf(before, withLink({ mean: 0.55, std: olumiSpreadForMean({ oldMean: 0.3, oldStd: 0.1, newMean: 0.55 }), band: 'strong', sizing: 'user' })).input_coverage).toBe('complete');
  });

  it('a user strength edit from a placeholder writes BOTH rows for the one link (band + who sized it; RC 5937295784)', () => {
    const d = pairOf(withLink({ mean: 0.3, band: 'moderate', sizing: 'placeholder' }), withLink({ mean: 0.85, band: 'very_strong', sizing: 'user' }));
    expect(d.input_changes?.map((r) => [r.field, r.before, r.after])).toEqual([
      ['strength', { raw: 'moderate' }, { raw: 'very_strong' }],
      ['sizing', { raw: 'placeholder' }, { raw: 'user' }],
    ]);
  });

  it('CONTROL: β moving INSIDE one band (R3 DEFECT 1\'s 0.6 → 0.55) stays partial with no row — no engine number shown', () => {
    const d = pairOf(withLink({ mean: 0.6, std: 0.3, band: 'strong', sizing: 'olumi_estimate' }), withLink({ mean: 0.55, std: 0.275, band: 'strong', sizing: 'olumi_estimate' }));
    expect([d.input_coverage, d.input_changes]).toEqual(['partial', []]);
  });

  it('CONTROL: sizing on ONE Run only (an older Run) → partial, no sizing row; band unrecorded on one end + β move → partial', () => {
    const oneSided = pairOf(withLink({ band: 'strong' }), withLink({ band: 'strong', sizing: 'olumi_accepted' }));
    expect([oneSided.input_coverage, oneSided.input_changes]).toEqual(['partial', []]);
    const oldBand = pairOf(withLink({ mean: 0.3 }), withLink({ mean: 0.55, band: 'strong' }));
    expect([oldBand.input_coverage, oldBand.input_changes]).toEqual(['partial', []]);
  });

  it('CONTROL: an identical link with band and sizing recorded on both Runs is complete with no row', () => {
    const d = pairOf(withLink({ band: 'strong', sizing: 'olumi_accepted' }), withLink({ band: 'strong', sizing: 'olumi_accepted' }));
    expect([d.input_coverage, d.input_changes]).toEqual(['complete', []]);
  });
});

/** ⭐ 0.70.0 (CANVAS 5936762171, RC 5936776917): WHY a pair has no win shares, typed — only when the cause is known. */
// ⭐ 0.71.0 — `complete` means VERIFIED (DL ruling #2482 5939864517, P1 #2): the rows speak only for the recorded
// fields, so the pair is complete only when both Runs carry an EQUAL residual digest (every unrecorded analysis input).
describe('0.71.0 · input_coverage complete needs equal residuals', () => {
  const coverageOf = (a: RunInputSnapshot, b: RunInputSnapshot) => {
    const out = buildRunDelta({ priorFacts: [
      fact({ seed: '8', hash: 'h-b', at: T2, runId: 'run-b', snapshot: b }),
      fact({ seed: '7', hash: 'h-a', at: T1, runId: 'run-a', snapshot: a }),
    ], mayNameLeadingOption: true });
    if (out.kind !== 'ok') throw new Error(out.reason);
    expect(RunDeltaSchema.safeParse(out.delta).success).toBe(true);
    return [out.delta.input_coverage, out.delta.input_changes];
  };
  const noResidual = (s: RunInputSnapshot): RunInputSnapshot => {
    const { residual_digest: _r, ...rest } = s;
    return rest as RunInputSnapshot;
  };

  it('RED (CODEX repro: factor σ / encoded goal threshold): no recorded field moved but the residuals differ → partial, []', () => {
    expect(coverageOf(snap(), snap({ residual_digest: 'd'.repeat(64) }))).toEqual(['partial', []]);
  });

  it('RED: a recorded edit with different residuals keeps its row but is partial', () => {
    expect(coverageOf(snap({}, 59), snap({ residual_digest: 'd'.repeat(64) }, 60))[0]).toBe('partial');
  });

  it('RED (legacy): a residual on ONE end only, or on neither, is never complete', () => {
    expect(coverageOf(noResidual(snap()), snap())).toEqual(['partial', []]);
    expect(coverageOf(snap(), noResidual(snap()))).toEqual(['partial', []]);
    expect(coverageOf(noResidual(snap()), noResidual(snap()))).toEqual(['partial', []]);
  });

  it('CONTROL: equal residuals → complete; the £59 → £60 row with equal residuals → complete with its row', () => {
    expect(coverageOf(snap(), snap())).toEqual(['complete', []]);
    const [cov, rows] = coverageOf(snap({}, 59), snap({}, 60));
    expect(cov).toBe('complete');
    expect((rows as Array<{ field: string }>).map((r) => r.field)).toEqual(['value']);
  });
});

// ⭐ 0.72.0 (DL ruling #2482 r3, option A) — an AUTHORSHIP change (`authorship_digest`) is explained ONLY beside a sizing
// row to `user` (the user's own write) or `placeholder` → `olumi_accepted` (the Accept); anything else is partial.
describe('0.72.0 · a link\'s authorship change is explained pairwise, or the pair is partial', () => {
  const D1 = '1'.repeat(64);
  const D2 = '2'.repeat(64);
  const withLink = (sizing: string, digest?: string) => snap({ links: [{
    from: 'fac_price', to: 'fac_churn', mean: 0.4, band: 'strong', sizing, ...(digest !== undefined ? { authorship_digest: digest } : {}),
  } as RunInputSnapshot['links'][number]] });
  const coverageOf = (a: RunInputSnapshot, b: RunInputSnapshot) => diffRunInputs(a, b).complete;

  it.each([
    ['olumi_estimate', 'user', true],
    ['placeholder', 'user', true],
    ['placeholder', 'olumi_accepted', true],
    ['olumi_estimate', 'olumi_accepted', false],
    ['olumi_accepted', 'olumi_estimate', false],
    ['user', 'olumi_estimate', false],
    ['user', 'user', false],
    ['olumi_estimate', 'olumi_estimate', false],
  ])('authorship moved beside %s → %s → complete=%s', (from, to, complete) => {
    expect(coverageOf(withLink(from, D1), withLink(to, D2))).toBe(complete);
  });

  it('CONTROL: authorship unchanged → complete whatever the sizing row (the review never enters the digest)', () => {
    expect(coverageOf(withLink('olumi_estimate', D1), withLink('olumi_accepted', D1))).toBe(true);
  });

  it('a digest on ONE end only → partial (an older Run cannot say whether authorship moved)', () => {
    expect(coverageOf(withLink('olumi_estimate'), withLink('user', D2))).toBe(false);
  });
});

describe('0.70.0 · win_probabilities_unavailable', () => {
  const at = (d: string) => `2026-06-0${d}T00:00:00.000Z`;
  const reason = (facts: readonly HandlerFact[], mayName = true) => {
    const out = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: mayName });
    if (out.kind !== 'ok') throw new Error(out.reason);
    expect(RunDeltaSchema.safeParse(out.delta).success).toBe(true);
    return [out.delta.win_probabilities.length, out.delta.win_probabilities_unavailable];
  };

  it('RED (RC\'s unwithheld rerun): the earlier Run\'s shares withheld, this Run\'s shown → prior_withheld', () => {
    expect(reason([
      runAnalysisFact([{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '222', 'hash-b', at('7'), true),
      runAnalysisFact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', 'hash-a', at('6'), false),
    ])).toEqual([0, 'prior_withheld']);
  });

  it('RED (DL r3 P1-3): an earlier Run with NO recorded verdict (neither stamp) → no reason — never a cause claim from absence', () => {
    const unstamped = structuredClone(runAnalysisFact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', 'hash-a', at('6'), true)) as { result: Record<string, any> };
    delete unstamped.result.constraint_verdict;
    for (const k of Object.keys(unstamped.result.enrichment ?? {})) if (/may_name|constraint_verdict/.test(k)) delete unstamped.result.enrichment[k];
    expect(reason([
      runAnalysisFact([{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '222', 'hash-b', at('7'), true),
      unstamped as unknown as HandlerFact,
    ])).toEqual([0, undefined]);
  });

  it('RED: both Runs show shares but no option is on both sides → no_matched_option', () => {
    expect(reason([
      runAnalysisFact([{ id: 'opt-c', win: 0.45 }, { id: 'opt-d', win: 0.55 }], '222', 'hash-b', at('7'), true),
      runAnalysisFact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', 'hash-a', at('6'), true),
    ])).toEqual([0, 'no_matched_option']);
  });

  it('CONTROL: THIS Run\'s shares withheld (or the turn\'s) → no reason (cause-neutral words); shares present → no reason', () => {
    expect(reason([
      runAnalysisFact([{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '222', 'hash-b', at('7'), false),
      runAnalysisFact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '111', 'hash-a', at('6'), true),
    ])).toEqual([0, undefined]);
    expect(reason(PRESENT_PAIR, false)).toEqual([0, undefined]);
    expect(reason(PRESENT_PAIR)).toEqual([2, undefined]);
  });
});

/**
 * ⭐ R3 GAP (a) (journey-8, #85 5942780839; DL GO on the CODEX pre-review of 864e915c): the earlier Run's shares were
 * taken by its OWN goal-figure withhold (an unsized Olumi link on the way → `GOAL_FIGURES_PLACEHOLDER_PATH`) while it stayed
 * entitled, so the served pair carried `[]` and NO reason: "No option has figures from both runs" after the Accept that
 * made the options comparable. The cause is claimed only from the withholder's own RECORD that it removed shares
 * (`win_shares_withheld`), never from a code alone (PLoT may have sent no shares) and never from absence (P1-3).
 * Every withheld prior goes through the REAL withholder on the current carrier (`option_comparison`), and every fact is
 * a modern one (run_id + input_snapshot), so the pair is `compared`, not `not_recorded`.
 */
describe('R3 gap (a) · prior_withheld from the withholder\'s own record that it removed the earlier Run\'s shares', () => {
  const at = (d: string) => `2026-06-0${d}T00:00:00.000Z`;
  type Row = Record<string, unknown>;
  const reason = (facts: readonly HandlerFact[]) => {
    const out = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true });
    if (out.kind !== 'ok') throw new Error(out.reason);
    expect(RunDeltaSchema.safeParse(out.delta).success).toBe(true);
    expect(out.delta.input_coverage, 'precondition: a modern, snapshot-bearing pair').toBe('complete');
    return [out.delta.win_probabilities.length, out.delta.win_probabilities_unavailable];
  };
  const envelope = (rows: Row[], seed: string): Row => ({
    analysis_status: 'completed', option_comparison: rows,
    meta: { seed_used: seed, n_samples: 10_000 }, _meta: { builds: { plot: 'p1', isl: 'i1' } },
  });
  const fact = (enrichment: Row, runId: string, hash: string, when: string) => ({
    fact_type: 'run_analysis', noop: false,
    result: {
      enrichment, run_id: runId, input_snapshot: snap(), computed_at: when, graph_hash_at_run: hash,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    },
  }) as unknown as HandlerFact;
  const SHARES: Row[] = [{ option_id: 'opt-a', win_probability: 0.62, probability_of_goal: 0.7 }, { option_id: 'opt-b', win_probability: 0.38, probability_of_goal: 0.3 }];
  const withhold = (env: Row, code: string) => withholdOptionGoalFigures(env, new Set(['opt-a']),
    { code, message: 'withheld', severity: 'warning', node_ids: [], option_ids: ['opt-a'] });
  const warningsOf = (env: Row) => (env.inference_warnings as Row[]);
  const CURRENT = () => fact(envelope([{ option_id: 'opt-a', win_probability: 0.45 }, { option_id: 'opt-b', win_probability: 0.55 }], '222'), 'run-b', 'hash-b', at('7'));
  const prior = (env: Row) => fact(env, 'run-a', 'hash-a', at('6'));

  it.each([...GOAL_FIGURES_WITHHELD_CODES])('RED: the real withholder removes the prior\'s shares under %s → prior_withheld', (code) => {
    const env = withhold(envelope(SHARES, '111'), code);
    expect(warningsOf(env).at(-1), 'precondition: the withholder recorded that it removed shares').toMatchObject({ code, win_shares_withheld: true });
    expect(reason([CURRENT(), prior(env)])).toEqual([0, 'prior_withheld']);
  });

  it('NEGATIVE (CODEX P1): PLoT sent NO shares, a goal figure was withheld → the code is recorded WITHOUT the marker → no reason', () => {
    const env = withhold(envelope([{ option_id: 'opt-a', probability_of_goal: 0.7 }, { option_id: 'opt-b', probability_of_goal: 0.3 }], '111'), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(warningsOf(env).at(-1)).toMatchObject({ code: GOAL_FIGURES_PLACEHOLDER_PATH });
    expect(warningsOf(env).at(-1)).not.toHaveProperty('win_shares_withheld');
    expect(reason([CURRENT(), prior(env)])).toEqual([0, undefined]);
  });

  it('NEGATIVE (CODEX P1, identity): shares carried by `id` only were never identity-bound → no marker → no reason', () => {
    const env = withhold(envelope([{ id: 'opt-a', win_probability: 0.62 }, { id: 'opt-b', win_probability: 0.38 }], '111'), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(warningsOf(env).at(-1)).not.toHaveProperty('win_shares_withheld');
    expect(reason([CURRENT(), prior(env)])).toEqual([0, undefined]);
  });

  it('NEGATIVE (CODEX P2, identity): a DUPLICATED option id was never identity-bound (both entries dropped) → no marker → no reason', () => {
    const env = withhold(envelope([{ option_id: 'opt-a', win_probability: 0.62 }, { option_id: 'opt-a', win_probability: 0.38 }], '111'), GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(warningsOf(env).at(-1)).toMatchObject({ code: GOAL_FIGURES_PLACEHOLDER_PATH });
    expect(warningsOf(env).at(-1)).not.toHaveProperty('win_shares_withheld');
    expect(reason([CURRENT(), prior(env)])).toEqual([0, undefined]);
  });

  it('NEGATIVE (pre-deploy Run): the code with no marker — R3\'s served s4 bytes, recorded before the marker existed → no reason', async () => {
    const { readFileSync } = await import('node:fs');
    const fx = JSON.parse(readFileSync(new URL('./fixtures/served-a58f1537-withheld-prior.json', import.meta.url), 'utf8')) as
      { prior_enrichment: Row; current_enrichment: Row };
    // The turn block omits the stored-only echo members; the stored fact carries them (seed, sample count, builds).
    const stored = (env: Row, seed: string) => ({ ...env, meta: { seed_used: seed, n_samples: 10_000 }, _meta: { builds: { plot: 'p1', isl: 'i1' } } });
    expect(warningsOf(fx.prior_enrichment).map((w) => w.code), 'precondition: the served withhold code').toContain(GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(reason([fact(stored(fx.current_enrichment, '7'), 'run-b', 'hash-b', at('7')), prior(stored(fx.prior_enrichment, '7'))])).toEqual([0, undefined]);
  });

  it('SERVED BYTES through the real withholder: R3\'s crn s2 envelope (3 shares) withheld as the prior, the same bytes current → prior_withheld', async () => {
    const { readFileSync } = await import('node:fs');
    const fx = JSON.parse(readFileSync(new URL('./fixtures/served-a58f1537-withheld-prior.json', import.meta.url), 'utf8')) as
      { current_enrichment: Row };
    const stored = (env: Row, seed: string) => ({ ...env, meta: { seed_used: seed, n_samples: 10_000 }, _meta: { builds: { plot: 'p1', isl: 'i1' } } });
    const env = withholdOptionGoalFigures(stored(fx.current_enrichment, '7'), new Set(['integration_bug_fix_sprint']),
      { code: GOAL_FIGURES_PLACEHOLDER_PATH, message: 'withheld', severity: 'warning', node_ids: [], option_ids: ['integration_bug_fix_sprint'] });
    expect(warningsOf(env).at(-1)).toMatchObject({ code: GOAL_FIGURES_PLACEHOLDER_PATH, win_shares_withheld: true });
    const out = buildRunDelta({ priorFacts: [fact(stored(fx.current_enrichment, '7'), 'run-b', 'hash-b', at('7')), prior(env)], mayNameLeadingOption: true });
    if (out.kind !== 'ok') throw new Error(out.reason);
    expect([out.delta.win_probabilities.length, out.delta.win_probabilities_unavailable]).toEqual([0, 'prior_withheld']);
    expect(out.delta.leader.current_leading_option_id).toBe('ai_reporting_module_sprint');
  });

  it('CONTROL (P1-3): the same 0 shares with NO withhold recorded → no reason', () => {
    expect(reason([CURRENT(), prior(envelope([{ option_id: 'opt-a' }, { option_id: 'opt-b' }], '111'))])).toEqual([0, undefined]);
  });

  it('CONTROL: the marker on a warning that is NOT a goal-figure withhold → no reason', () => {
    const env = { ...envelope([{ option_id: 'opt-a' }, { option_id: 'opt-b' }], '111'),
      inference_warnings: [{ code: 'GOAL_DIRECTION_UNATTESTED', message: 'm', severity: 'warning', win_shares_withheld: true }] };
    expect(reason([CURRENT(), prior(env)])).toEqual([0, undefined]);
  });

  it('CONTROL: a marked withhold while the prior STILL HAS shares (no option on both sides) → no_matched_option, never prior_withheld', () => {
    const env = { ...envelope([{ option_id: 'opt-c', win_probability: 0.6 }, { option_id: 'opt-d', win_probability: 0.4 }], '111'),
      inference_warnings: [{ code: GOAL_FIGURES_PLACEHOLDER_PATH, message: 'm', severity: 'warning', win_shares_withheld: true }] };
    expect(reason([CURRENT(), prior(env)])).toEqual([0, 'no_matched_option']);
  });

  it('CONTROL: THIS Run withheld too → no reason (nothing can be compared yet)', () => {
    const current = fact(withhold(envelope(SHARES, '222'), GOAL_FIGURES_PLACEHOLDER_PATH), 'run-b', 'hash-b', at('7'));
    expect(reason([current, prior(withhold(envelope(SHARES, '111'), GOAL_FIGURES_PLACEHOLDER_PATH))])).toEqual([0, undefined]);
  });
});

/**
 * ⭐ SERVED BYTES (R3 F5 journey-1, #85 5938917543): two Accepts on guest 2f2b6624 each turned a 0.25 placeholder into
 * Olumi's accepted estimate, and NO figure moved. The served Changes pill read "Both runs used the same input values"
 * and never named the Accept (`input_changes []`, coverage complete). Through the real snapshot builder and diff, the
 * same before/after graphs now name both Accepts, by link, and nothing else.
 */
describe('0.70.0 · R3\'s served Accept pair (2f2b6624) names both Accepts', () => {
  it('RED: two `sizing` rows placeholder → olumi_accepted, coverage complete, no other row', async () => {
    const { readFileSync } = await import('node:fs');
    const { buildRunInputSnapshot } = await import('../../tools/handlers/run-input-snapshot.js');
    const { diffRunInputs } = await import('../run-input-changes.js');
    const fx = JSON.parse(readFileSync(new URL('./fixtures/served-2f2b6624-accept-pair.json', import.meta.url), 'utf8')) as
      { before: { nodes: unknown[]; edges: unknown[] }; after: { nodes: unknown[]; edges: unknown[] } };
    const snapOf = (g: { nodes: unknown[]; edges: unknown[] }) => buildRunInputSnapshot({
      submittedOptions: [], rawObjectsPerOption: [], wirePerOption: [], heldFactorIdsByOptionId: new Map(), optionsNotSent: [],
      wireGraph: g, plotPayload: { graph: g }, persistedEdges: g.edges,
    })!;
    const before = snapOf(fx.before);
    const after = snapOf(fx.after);
    expect(before, 'precondition: both snapshots recorded').not.toBeNull();
    const { rows, complete } = diffRunInputs(before, after);
    expect(complete).toBe(true);
    expect(rows.map((r) => [r.field, r.link, r.before, r.after])).toEqual([
      ['sizing', { from: 'sprint_capacity_for_ai_reporting', to: 'ai_reporting_module_availability' }, { raw: 'placeholder' }, { raw: 'olumi_accepted' }],
      ['sizing', { from: 'sprint_capacity_for_integration_fix', to: 'integration_step_bug_resolution' }, { raw: 'placeholder' }, { raw: 'olumi_accepted' }],
    ]);
  });
});
