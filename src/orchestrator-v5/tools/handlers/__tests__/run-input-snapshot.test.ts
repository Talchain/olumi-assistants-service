/**
 * SC-24 — the input a Run was SENT, captured from the request (schemas 0.68.0 `input_snapshot`).
 * P0 SHARED DATA 5914750268: the goal unit is the SAME authored unit as the goal's `goal_threshold_unit`; a missing
 * unit stays absent (never GBP). AIQ 5914731075: fields copy what the Run was sent — nothing inferred.
 */
import { describe, expect, it } from 'vitest';

import { buildRunInputSnapshot, runIdFor, sentDigest } from '../run-input-snapshot.js';
import { linkAuthorshipDigest } from '../run-input-residual.js';
import { normalizeRunGoalUnit } from '../../../context/run-goal-unit.js';

const graph = {
  nodes: [
    { id: 'goal_mrr', kind: 'goal', label: 'Pro MRR', goal_threshold: 0.55, goal_threshold_raw: 55000,
      goal_threshold_unit: 'GBP per month', goal_direction: '>=', goal_threshold_frame: 'level' },
    { id: 'fac_price', kind: 'factor', label: 'Pro price', observed_state: { value: 49, raw_value: 49, unit: 'GBP', source: 'user_override' } },
    { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.037, raw_value: 3.7, unit: '%', source: 'cee_inference' } },
    { id: 'opt_raise', kind: 'option', label: 'Raise to £60' },
  ],
  edges: [{ from: 'fac_price', to: 'fac_churn', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9 }],
};

const payload = (over: Record<string, unknown> = {}) => ({
  graph,
  options: [],
  goal_node_id: 'goal_mrr',
  request_id: 'req-1',
  goal_constraints: [{ constraint_id: 'c1', node_id: 'fac_churn', operator: '<=', value: 5, unit: '%', label: 'Churn cap' }],
  ...over,
});

const input = (over: Partial<Parameters<typeof buildRunInputSnapshot>[0]> = {}) => ({
  submittedOptions: [
    { option_id: 'opt_raise', label: 'Raise to £60' },
    { option_id: 'opt_hold', label: 'Hold', is_baseline: true },
  ],
  rawObjectsPerOption: [
    { fac_price: { value: 60, raw_value: 60, unit: 'GBP', source: 'user_override' } },
    { fac_price: { value: 49, raw_value: 49, unit: 'GBP', source: 'cee_default' } },
  ],
  wirePerOption: [{ fac_price: 60 }, { fac_price: 49 }],
  heldFactorIdsByOptionId: new Map([['opt_hold', new Set(['fac_price'])]]),
  optionsNotSent: [{ option_id: 'opt_olumi', label: 'Moderate rise', reason: 'olumi_proposed' as const }],
  wireGraph: graph,
  plotPayload: payload(),
  ...over,
});

describe('buildRunInputSnapshot — what the Run was sent', () => {
  it('the goal unit is the goal node\'s own goal_threshold_unit, as authored (P0 SHARED DATA 5914750268)', () => {
    const s = buildRunInputSnapshot(input());
    expect(s?.goal).toEqual({ node_id: 'goal_mrr', label: 'Pro MRR', target_raw: 55000, unit: 'GBP per month', operator: '>=', frame: 'level' });
  });

  it('a goal field the Run was not sent stays ABSENT — a missing unit never becomes GBP (AIQ 5914731075)', () => {
    const bare = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'goal_mrr' ? { id: 'goal_mrr', kind: 'goal', label: 'Pro MRR' } : n)) };
    const s = buildRunInputSnapshot(input({ wireGraph: bare, plotPayload: payload({ graph: bare }) }));
    expect(s?.goal).toEqual({ node_id: 'goal_mrr', label: 'Pro MRR' });
  });

  it('a Run sent no goal records goal: null', () => {
    const { goal_node_id: _g, ...noGoal } = payload();
    expect(buildRunInputSnapshot(input({ plotPayload: noGoal }))?.goal).toBeNull();
  });

  it('option settings carry the authored figure AND the number PLoT got; a held status-quo value is marked', () => {
    const s = buildRunInputSnapshot(input());
    expect(s?.options).toEqual([
      { option_id: 'opt_raise', label: 'Raise to £60', settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 60, unit: 'GBP', encoded: 60 }] },
      { option_id: 'opt_hold', label: 'Hold', is_baseline: true,
        settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, held: true }] },
    ]);
    expect(s?.options_not_sent).toEqual([{ option_id: 'opt_olumi', label: 'Moderate rise', reason: 'olumi_proposed' }]);
  });

  it('factor values, limits and links are recorded as sent', () => {
    const s = buildRunInputSnapshot(input());
    expect(s?.factors).toEqual([
      { factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, source: 'user_override' },
      { factor_id: 'fac_churn', label: 'Monthly churn', raw: 3.7, unit: '%', encoded: 0.037, source: 'cee_inference' },
    ]);
    expect(s?.constraints).toEqual([{ constraint_id: 'c1', node_id: 'fac_churn', label: 'Churn cap', operator: '<=', raw: 5, unit: '%' }]);
    // 0.70.0: the band the sent strength sits in travels with it (0.4 is "strong" by CEE's cuts); no persisted edges
    // given, so who sized it is NOT recorded (absent, never inferred).
    expect(s?.links).toEqual([{
      from: 'fac_price', to: 'fac_churn', mean: 0.4, std: 0.1, exists_probability: 0.9, band: 'strong',
      // 0.72.0: the link's authorship as sent, by the ONE digest (`run-input-residual.ts`).
      authorship_digest: linkAuthorshipDigest((graph as unknown as { edges: Record<string, unknown>[] }).edges[0]!),
    }]);
  });

  describe('0.70.0 (R3 DEFECT 3): each link in the user\'s terms — its band and who sized it', () => {
    const linkTo = (mean: number) => input({ wireGraph: { ...(input().wireGraph as Record<string, unknown>),
      edges: [{ from: 'fac_price', to: 'fac_churn', strength: { mean, std: 0.1 }, exists_probability: 0.9 }] } });
    it.each([[0.1, 'slight'], [-0.3, 'moderate'], [0.55, 'strong'], [0.85, 'very_strong']] as const)(
      '|β| %s sits in the contract band %s', (mean, band) => {
        expect(buildRunInputSnapshot(linkTo(mean))?.links[0]?.band).toBe(band);
      });

    const persisted = (provenance: Record<string, unknown>) => [{ from: 'fac_price', to: 'fac_churn', provenance }];
    it.each([
      [{ source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, 'placeholder'],
      [{ source: 'cee_hypothesis', magnitude: 'olumi_estimate' }, 'olumi_estimate'],
      [{ source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm', at: '2026-10-01T18:00:00Z' } }, 'olumi_accepted'],
      [{ source: 'user_specified' }, 'user'],
      [{ source: 'cee_hypothesis' }, 'unmarked'],
    ] as const)('RED: who sized it is read from the graph the Run was built from (%j → %s)', (provenance, sizing) => {
      expect(buildRunInputSnapshot({ ...input(), persistedEdges: persisted(provenance) })?.links[0]?.sizing).toBe(sizing);
    });

    it('CONTROL: a pair the persisted graph holds twice, or not at all, records NO sizing (never a guess)', () => {
      const twice = [...persisted({ magnitude: 'olumi_estimate' }), ...persisted({ source: 'user_specified' })];
      expect(buildRunInputSnapshot({ ...input(), persistedEdges: twice })?.links[0]).not.toHaveProperty('sizing');
      expect(buildRunInputSnapshot({ ...input(), persistedEdges: [] })?.links[0]).not.toHaveProperty('sizing');
    });
  });

  it('the digest ignores request_id and key order, and moves with any input', () => {
    expect(sentDigest(payload({ request_id: 'req-2' }))).toBe(sentDigest(payload()));
    const reordered = Object.fromEntries(Object.entries(payload()).reverse());
    expect(sentDigest(reordered)).toBe(sentDigest(payload()));
    expect(sentDigest(payload({ goal_direction: 'minimise' }))).not.toBe(sentDigest(payload()));
  });

  it('over a contract bound, NO snapshot is recorded (never a truncated one that reads as complete)', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ option_id: `o${i}`, label: `O${i}` }));
    expect(buildRunInputSnapshot(input({
      submittedOptions: many,
      rawObjectsPerOption: many.map(() => ({})),
      wirePerOption: many.map(() => ({})),
    }))).toBeNull();
  });
});

describe('runIdFor — one id per turn that ran, the same on a replay', () => {
  it('a replay of the same turn gets the same id; another turn gets another', () => {
    const a = runIdFor({ scenarioId: 's', turnId: 't1', graphHashAtRun: 'h' });
    expect(runIdFor({ scenarioId: 's', turnId: 't1', graphHashAtRun: 'h' })).toBe(a);
    expect(runIdFor({ scenarioId: 's', turnId: 't2', graphHashAtRun: 'h' })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  // Prompt Strike on the lease (#75 5915277428): two rows the offer did not pin, each RED on the offer head.
  it('a factor with no authored raw_value records NO raw — the normalised value is never presented as the user\'s figure', () => {
    const g = { ...graph, nodes: [...graph.nodes.filter((n) => n.id !== 'fac_churn'),
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.037, source: 'cee_inference' } }] };
    const snap = buildRunInputSnapshot(input({ wireGraph: g, plotPayload: payload({ graph: g }) }))!;
    const churn = snap.factors.find((f) => f.factor_id === 'fac_churn')!;
    expect(churn).not.toHaveProperty('raw');
    expect(churn.encoded).toBe(0.037);
  });

  it('an option the Run was sent with no id records NO snapshot — never an invented option id', () => {
    const snap = buildRunInputSnapshot(input({ submittedOptions: [{ label: 'Unnamed' }, { option_id: 'opt_hold', label: 'Hold', is_baseline: true }] }));
    expect(snap).toBeNull();
  });

  // P0 SHARED DATA 5917660267 / AIQ 5917724983: the goal unit goes through #2377's ONE normaliser, byte for byte, so the
  // currentness gate never reads a just-computed Run as stale; a malformed EXPLICIT goal id is refused, not goal-free.
  it('the goal unit is normalised by the shared Run-goal-unit rule: bytes kept, over 64 or empty → absent', () => {
    const withUnit = (unit: unknown) => {
      const g = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'goal_mrr' ? { ...n, goal_threshold_unit: unit } : n)) };
      return buildRunInputSnapshot(input({ wireGraph: g, plotPayload: payload({ graph: g }) }))?.goal;
    };
    for (const unit of ['GBP/month', ' GBP/month ', 'x'.repeat(64), 'x'.repeat(65), '', 42, null]) {
      const expected = normalizeRunGoalUnit(unit);
      const goal = withUnit(unit);
      if (expected === undefined) expect(goal, JSON.stringify(unit)).not.toHaveProperty('unit');
      else expect(goal?.unit, JSON.stringify(unit)).toBe(expected);
    }
    // Bytes, not a trimmed copy: the gate compares the graph's own string.
    expect(withUnit(' GBP/month ')?.unit).toBe(' GBP/month ');
    expect(withUnit('x'.repeat(65))).not.toHaveProperty('unit');
  });

  it('a malformed EXPLICIT goal id records NO snapshot; absent or null stays goal-free', () => {
    expect(buildRunInputSnapshot(input({ plotPayload: payload({ goal_node_id: 42 }) }))).toBeNull();
    expect(buildRunInputSnapshot(input({ plotPayload: payload({ goal_node_id: '' }) }))).toBeNull();
    expect(buildRunInputSnapshot(input({ plotPayload: payload({ goal_node_id: 'no_such_node' }) }))).toBeNull();
    expect(buildRunInputSnapshot(input({ plotPayload: payload({ goal_node_id: null }) }))?.goal).toBeNull();
    const { goal_node_id: _g, ...noGoal } = payload();
    expect(buildRunInputSnapshot(input({ plotPayload: noGoal }))?.goal).toBeNull();
    // Control: a real goal id still records its goal.
    expect(buildRunInputSnapshot(input())?.goal?.node_id).toBe('goal_mrr');
  });

  // UNDO 5918366712 / AIQ 5918201688: TEMPORAL's stated range is recorded AS SENT (the wire's {low, high, meaning}),
  // carrying the author from the option's own range object; a sent range with no provable author → no snapshot.
  it('R: a stated range is recorded as sent, with its author; none sent → none recorded; unauthored → no snapshot', () => {
    const ranged = (authored: Record<string, unknown> | undefined) => input({
      submittedOptions: [
        { option_id: 'opt_raise', label: 'Raise to £60', intervention_ranges: { fac_price: { low: 55, high: 65, meaning: 'likely_range' } } },
        { option_id: 'opt_hold', label: 'Hold', is_baseline: true },
      ],
      rawObjectsPerOption: [
        { fac_price: { value: 60, raw_value: 60, unit: 'GBP', source: 'user_override', ...(authored !== undefined ? { range: authored } : {}) } },
        { fac_price: { value: 49, raw_value: 49, unit: 'GBP', source: 'cee_default' } },
      ],
    });
    const snap = buildRunInputSnapshot(ranged({ low: 55, high: 65, meaning: 'likely_range', source: 'user_stated' }))!;
    expect(snap.options.find((o) => o.option_id === 'opt_raise')!.settings[0]!.range)
      .toEqual({ low: 55, high: 65, meaning: 'likely_range', source: 'user_stated' });
    expect(snap.options.find((o) => o.option_id === 'opt_hold')!.settings[0]).not.toHaveProperty('range');
    // Control: nothing sent → nothing recorded.
    expect(buildRunInputSnapshot(input())!.options[0]!.settings[0]).not.toHaveProperty('range');
    // A range PLoT received whose author the option does not carry: no snapshot (never a silently dropped range).
    expect(buildRunInputSnapshot(ranged(undefined))).toBeNull();
  });
});
