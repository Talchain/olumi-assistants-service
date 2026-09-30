/**
 * SC-24 — "previous Run vs this Run" carries WHAT THE USER CHANGED, in their units (schemas 0.67.0).
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
 */
import { describe, expect, it } from 'vitest';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';

import { buildRunDelta } from '../build-run-delta.js';
import { diffRunInputSnapshots } from '../run-input-changes.js';

const snap = (over: Partial<RunInputSnapshot> = {}, price = 59): RunInputSnapshot => ({
  snapshot_version: 1,
  sent_digest: 'a'.repeat(64),
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
  runId?: string; snapshot?: RunInputSnapshot; wins?: [number, number];
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
        ...(opts.builds === null ? {} : { _meta: { builds: opts.builds ?? { plot: 'p1', isl: 'i1' } } }),
      },
      computed_at: opts.at,
      graph_hash_at_run: opts.hash,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
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
      ['link', 'strength', 'removed'],
    ]);
  });

  it('producer order: option settings first, then factors, goal, limits, links', () => {
    const next = snap({
      goal: { node_id: 'goal_mrr', label: 'Pro MRR', target_raw: 60000, unit: 'GBP per month', operator: '>=' },
      factors: [{ factor_id: 'fac_churn', label: 'Monthly churn', raw: 4.1, unit: '%', encoded: 0.041, source: 'user_override' }],
      links: [{ from: 'fac_price', to: 'fac_churn', mean: 0.6 }],
    }, 60);
    expect(diffRunInputSnapshots(snap(), next).map((r) => r.entity_kind)).toEqual(['option_setting', 'factor_value', 'goal', 'link']);
  });
});
