/**
 * ⛔ A LIMIT "MET" ONLY BECAUSE THE LEADER SETS IT AT OLUMI'S OWN ESTIMATE IS NOT A CHECK (AI Quality, #70 5844226031).
 *
 * Once ISL compares an option that SETS a limit's target at the level it sets (ISL #179), that option's result is a flat
 * 1 or 0. For a level the USER stated, that is a real check of what they told us. For Olumi's estimate (a starting-point
 * fill, an approved `cee_hypothesis`), it is the guess restated — and PLoT's `decision_grade` marker cannot tell them
 * apart: it certifies the RANGE, not whose level produced the score.
 *
 * Envelope: the VERBATIM C50 U2 PLoT body (`gc_u2` on root `fac_churn`, `unit_percent`, `decision_grade: true`, leader
 * `opt_raise` at 0.9985) — a certified score, so any withholding below is this rule's, not the scale rule's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  collectLeaderEstimatedTargetIds,
  deriveConstraintVerdict,
  type RatifiedConstraint,
} from '../constraint-feasibility.js';

type Json = Record<string, any>;
const U2 = (): Json =>
  JSON.parse(readFileSync('tests/fixtures/cross-service/c50-level-demo/U2.plot-response.json', 'utf8')) as Json;
const LEADER = 'opt_raise';
const LIMIT: RatifiedConstraint = { constraint_id: 'gc_u2', label: 'Monthly churn', node_id: 'fac_churn' };

/** The analysed graph: `opt_raise` (the leader) sets churn with the given entry; `opt_hold` sets price only. */
const graph = (leaderChurn: unknown, holdChurn?: unknown) => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'MRR' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
    { id: 'fac_churn', kind: 'factor', label: 'Monthly churn' },
    {
      id: 'opt_hold',
      kind: 'option',
      label: 'Hold',
      interventions: { fac_price: { value: 0.49, source: 'user_specified' }, ...(holdChurn === undefined ? {} : { fac_churn: holdChurn }) },
    },
    {
      id: 'opt_raise',
      kind: 'option',
      label: 'Raise with win-back',
      interventions: { fac_price: { value: 0.59, source: 'user_specified' }, ...(leaderChurn === undefined ? {} : { fac_churn: leaderChurn }) },
    },
  ],
  edges: [],
});

describe('preconditions (bound to the capture)', () => {
  it('U2 certifies gc_u2 and opt_raise leads with its own score', () => {
    const env = U2();
    expect(env.constraints_status).toBe('computed');
    expect(env.constraint_results.map((r: Json) => [r.constraint_id, r.node_id, r.scale_provenance.decision_grade])).toEqual([
      ['gc_u2', 'fac_churn', true],
    ]);
    const top = [...env.option_comparison].sort((a: Json, b: Json) => b.win_probability - a.win_probability)[0];
    expect(top.option_id).toBe(LEADER);
    expect(typeof top.constraint_probabilities.gc_u2).toBe('number');
  });
});

describe('collectLeaderEstimatedTargetIds — whose level the leader sets on the limit', () => {
  it.each([
    ["Olumi's estimate (cee_hypothesis)", { value: 0.03, source: 'cee_hypothesis' }],
    ['an entry with no stated source', { value: 0.03 }],
    ['a bare number (no source can be read)', 0.03],
  ])('RED: the leader sets the target with %s → the limit is listed', (_n, entry) => {
    expect([...collectLeaderEstimatedTargetIds(graph(entry), [LIMIT], LEADER)]).toEqual(['gc_u2']);
  });

  it.each([
    ["the user's own figure (user_specified)", { value: 0.03, source: 'user_specified' }],
    ['a figure from the brief (brief_extraction)', { value: 0.03, source: 'brief_extraction' }],
  ])('CONTROL: %s → not listed', (_n, entry) => {
    expect([...collectLeaderEstimatedTargetIds(graph(entry), [LIMIT], LEADER)]).toEqual([]);
  });

  it('CONTROL: only the LEADER counts — a non-leader setting it at an estimate lists nothing', () => {
    expect([...collectLeaderEstimatedTargetIds(graph(undefined, { value: 0.03, source: 'cee_hypothesis' }), [LIMIT], LEADER)]).toEqual([]);
  });

  it('CONTROL: a leader that does not set the target, no leader, or a limit with no node_id lists nothing', () => {
    expect([...collectLeaderEstimatedTargetIds(graph(undefined), [LIMIT], LEADER)]).toEqual([]);
    expect([...collectLeaderEstimatedTargetIds(graph({ value: 0.03, source: 'cee_hypothesis' }), [LIMIT], null)]).toEqual([]);
    expect([
      ...collectLeaderEstimatedTargetIds(graph({ value: 0.03, source: 'cee_hypothesis' }), [{ constraint_id: 'gc_u2', label: null }], LEADER),
    ]).toEqual([]);
  });
});

describe('deriveConstraintVerdict — rule 3 (d)', () => {
  it('CONTROL: the certified U2 score names the leader when no estimate is involved', () => {
    const v = deriveConstraintVerdict(U2(), [LIMIT], LEADER);
    expect(v.state).toBe('evaluated_feasible');
    expect(v.mayNameLeadingOption).toBe(true);
  });

  it('CONTROL: an EMPTY set is byte-identical to omitting the argument', () => {
    expect(deriveConstraintVerdict(U2(), [LIMIT], LEADER, undefined, new Set())).toEqual(deriveConstraintVerdict(U2(), [LIMIT], LEADER));
  });

  it("RED: the same certified score, when the leader sets churn at Olumi's estimate, is NOT a check — unevaluated, leader withheld", () => {
    const ids = collectLeaderEstimatedTargetIds(graph({ value: 0.03, source: 'cee_hypothesis' }), [LIMIT], LEADER);
    const v = deriveConstraintVerdict(U2(), [LIMIT], LEADER, undefined, ids);
    expect(v.state).toBe('unevaluated');
    expect(v.mayNameLeadingOption).toBe(false);
    expect(v.constraints.map((c) => c.constraint_id)).toEqual(['gc_u2']);
    expect(v.codes).toEqual([]);
  });

  it("CONTROL: the user's own figure on the same row stays a check", () => {
    const ids = collectLeaderEstimatedTargetIds(graph({ value: 0.03, source: 'user_specified' }), [LIMIT], LEADER);
    expect(deriveConstraintVerdict(U2(), [LIMIT], LEADER, undefined, ids).state).toBe('evaluated_feasible');
  });
});

describe('the WIRE path — what PLoT received decides (review of 3f2f6714, 5844327116)', () => {
  /** A status quo the gate HELD: no persisted interventions; the wire carries the factors' own observed levels. */
  const heldGraph = (churnSource: string | undefined) => ({
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, raw_value: 49, source: 'brief_extraction' } },
      {
        id: 'fac_churn', kind: 'factor', label: 'Monthly churn',
        observed_state: { value: 0.04, raw_value: 4, cap: 100, ...(churnSource === undefined ? {} : { source: churnSource }) },
      },
      { id: 'opt_raise', kind: 'option', label: 'Keep things as they are', is_baseline: true },
    ],
    edges: [],
  });
  const wire = (heldFactors: string[]) => ({
    options: [
      {
        id: LEADER,
        option_id: LEADER,
        interventions: Object.fromEntries(heldFactors.map((f) => [f, f === 'fac_churn' ? { value: 0.04, raw_value: 4 } : { value: 0.49, raw_value: 49 }])),
      },
    ],
    held: [{ option_id: LEADER, factor_ids: heldFactors }],
  });

  it.each([
    ["Olumi's inferred level (cee_inference)", 'cee_inference'],
    ['an estimate the user only CONFIRMED (user_confirmed: ratified, not authored)', 'user_confirmed'],
    ['a level with no readable owner', undefined],
  ])('RED: a held status quo sets the target at %s → listed', (_n, src) => {
    expect([...collectLeaderEstimatedTargetIds(heldGraph(src), [LIMIT], LEADER, wire(['fac_price', 'fac_churn']))]).toEqual(['gc_u2']);
  });

  it.each([
    ["the user's brief (brief_extraction)", 'brief_extraction'],
    ["the user's own chat edit (user_override)", 'user_override'],
  ])('CONTROL: a held status quo whose held level is %s → not listed', (_n, src) => {
    expect([...collectLeaderEstimatedTargetIds(heldGraph(src), [LIMIT], LEADER, wire(['fac_price', 'fac_churn']))]).toEqual([]);
  });

  it('CONTROL: a held status quo whose held factors do NOT include the target → not listed', () => {
    expect([...collectLeaderEstimatedTargetIds(heldGraph('cee_inference'), [LIMIT], LEADER, wire(['fac_price']))]).toEqual([]);
  });

  it('CONTROL: the graph alone cannot see the held level — without `wire` the same case lists nothing (the reviewed gap)', () => {
    expect([...collectLeaderEstimatedTargetIds(heldGraph('cee_inference'), [LIMIT], LEADER)]).toEqual([]);
  });
});

describe('the WIRE path — a persisted (not held) level carries its own source', () => {
  const g = graph(undefined); // the graph node sets no churn; only the wire does
  const wireWith = (entry: unknown) => ({ options: [{ id: LEADER, interventions: { fac_price: { value: 0.59, source: 'user_specified' }, fac_churn: entry } }], held: [] });

  it("RED: the wire entry is Olumi's estimate (cee_hypothesis) → listed", () => {
    expect([...collectLeaderEstimatedTargetIds(g, [LIMIT], LEADER, wireWith({ value: 0.03, source: 'cee_hypothesis' }))]).toEqual(['gc_u2']);
  });
  it("CONTROL: the wire entry is the user's (user_specified) → not listed", () => {
    expect([...collectLeaderEstimatedTargetIds(g, [LIMIT], LEADER, wireWith({ value: 0.03, source: 'user_specified' }))]).toEqual([]);
  });
  it('RED: a bare-number wire entry with no graph entry to name its owner → listed (unattributed)', () => {
    expect([...collectLeaderEstimatedTargetIds(g, [LIMIT], LEADER, wireWith(0.03))]).toEqual(['gc_u2']);
  });
});
