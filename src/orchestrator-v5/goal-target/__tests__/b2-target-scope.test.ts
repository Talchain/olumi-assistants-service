// Load the producer first (the existing S6 import-order guard).
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { describe, expect, it } from 'vitest';
import { withholdOptionGoalFigures } from '../../../orchestrator/context/constraint-feasibility.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE as TARGET } from '../../../orchestrator/context/option-result-source.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { optionPathsOf, perOptionTargetReasonsForRun, scopedFailuresFor } from '../target-testability-per-option.js';
import { withGoalChanceRange, GOAL_CHANCE_RANGE } from '../goal-chance-range.js';
import { withGoalChanceLicence, goalChanceDisplayForAgent } from '../goal-chance-licence.js';
import { scopeTargetNotTestableWithRanges } from '../scope-target-not-testable.js';
import { goalChanceWithheldForAgent } from '../../agent-lane/goal-chance-withheld.js';

type Rec = Record<string, any>;
const ids = ['raise', 'starter', 'keep'];
const link = { from: 'u', to: 'a' };
const level = (raw_value = 50, unit = '£', cap = 100): Rec => ({ value: raw_value / cap, baseline: raw_value / cap, raw_value, unit, cap, source: 'user_stated' });
const edge = (from: string, to: string, unsized = false): Rec => ({ from, to, strength: { mean: 0.1, std: 0.01 },
  provenance: unsized ? { source: 'cee', magnitude: 'olumi_placeholder' } : {
    source: 'user_specified', natural_effect: { amount: 1, amount_unit: '£', per_source_change: 1, per_source_change_unit: '£', strength_mean: 0.1 },
  } });
const graph = (product = false): Rec => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal', goal_direction: '>=', goal_threshold: 0.8, goal_threshold_raw: 800,
      goal_threshold_cap: 1000, goal_threshold_unit: '£', goal_threshold_frame: 'level', threshold_source: 'user',
      observed_state: level(500, '£', 1000),
      ...(product ? { nonlinear_identity: { operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: true } } : {}) },
    { id: 'raise', kind: 'option', label: 'Raise', interventions: { b: { value: 0.7 } } },
    { id: 'starter', kind: 'option', label: 'Starter', interventions: { u: { value: 0.6 } } },
    { id: 'keep', kind: 'option', label: 'Keep', is_baseline: true, interventions: {} },
    ...['u', 'a', 'b', 'middle'].map(id => ({ id, kind: 'factor', label: id, observed_state: level() })),
  ],
  edges: [edge('raise', 'b'), edge('starter', 'u'), edge('u', 'a', true),
    ...(product ? [edge('a', 'goal'), edge('b', 'goal')] : [edge('a', 'middle', true), edge('middle', 'goal', true), edge('b', 'goal')])],
});
const envelope = (): Rec => ({ option_comparison: ids.map(option_id => ({ option_id,
  probability_of_goal: option_id === 'raise' ? 0.7 : option_id === 'keep' ? 0.6 : 0.45, win_probability: 1 / 3 })),
  inference_warnings: [] });
const warning = (out: Rec): Rec | undefined => out.inference_warnings.find((w: Rec) => w.code === TARGET);
const chances = (out: Rec): string[] => out.option_comparison.filter((r: Rec) => typeof r.probability_of_goal === 'number').map((r: Rec) => r.option_id);
const failures = (g: Rec, e: Rec = envelope()) => {
  const v = targetTestabilityOf(g, e.identity_evaluations, 'goal');
  if (v.kind !== 'not_testable') throw new Error(`fixture must fail P5: ${v.kind}`);
  return v;
};

describe('B2 Gate A: target withholding follows each option and typed dependencies', () => {
  it('B2: three Starter links keep its 40–51% range; Raise and Keep keep their own point chances', () => {
    const g = graph(), body = envelope(), v = failures(g);
    expect(v.failures.every(f => f.case === 'c')).toBe(true);
    const links = v.failures.flatMap(f => f.links ?? []);
    expect(links).toHaveLength(3);
    const afterS = withholdOptionGoalFigures(body, new Set(['starter']), {
      code: GOAL_FIGURES_PLACEHOLDER_PATH, message: 'Not shown. Starter links need sizes.', option_ids: ['starter'], severity: 'warning',
    });
    const afterTarget = withholdGoalFiguresForUntestableTarget(afterS, g, 'goal');
    expect(afterTarget).toBe(afterS);
    expect(chances(afterTarget)).toEqual(['raise', 'keep']);
    expect(warning(afterTarget)).toBeUndefined();
    const ranged = withGoalChanceRange(afterTarget, g, { goalId: 'goal', plotWithheld: false,
      goalPaths: [{ option_id: 'starter', links }], driversByOption: new Map([['starter', { drivers: [{
        kind: 'link_strength', quantity_id: 'middle->goal', from: 'middle', to: 'goal', status: 'resolved', spread: 0.11,
        p_goal_if_low: 0.4, p_goal_if_high: 0.51, n_low: 4000, n_high: 4000,
      }] }]]) });
    expect(ranged.inference_warnings.find((w: Rec) => w.code === GOAL_CHANCE_RANGE)?.range_by_option.starter)
      .toMatchObject({ low_pct: 40, high_pct: 51 });
    const final = scopeTargetNotTestableWithRanges(withGoalChanceLicence(ranged, g, 'goal'), g, 'goal');
    expect(Object.keys(goalChanceDisplayForAgent(final) ?? {})).toEqual(['raise', 'keep']);
    expect(JSON.stringify(final)).not.toContain('needs nothing more of its own');
    expect(final.option_comparison.map((r: Rec) => r.win_probability)).toEqual(afterS.option_comparison.map((r: Rec) => r.win_probability));
  });

  it('without an earlier withhold, only Starter is withheld and explained; no reason is invented for Keep', () => {
    const g = graph(), body = envelope(), v = failures(g);
    const out = withholdGoalFiguresForUntestableTarget(body, g, 'goal');
    expect(chances(out)).toEqual(['raise', 'keep']);
    expect(warning(out)?.option_ids).toEqual(['starter']);
    expect(Object.keys(warning(out)?.per_option ?? {})).toEqual(['starter']);
    expect(Object.keys(perOptionTargetReasonsForRun(g, v, ids))).toEqual(['starter']);
  });

  it('a missing goal baseline still withholds every option, including Keep', () => {
    const g = graph(); delete g.nodes[0].observed_state;
    const out = withholdGoalFiguresForUntestableTarget(envelope(), g, 'goal');
    expect(chances(out)).toEqual([]);
    expect(warning(out)?.option_ids).toEqual(ids);
    for (const id of ids) expect(warning(out)?.per_option[id].message).toContain("today's level");
  });

  it('class 1: an upstream unsized link feeding operand A also affects an option moving operand B', () => {
    const g = graph(true), body = envelope(), v = failures(g);
    expect(v.failures.flatMap(f => f.links ?? [])).toEqual([link]);
    const paths = optionPathsOf(g, ids, undefined, 'goal');
    expect(scopedFailuresFor(v.failures, paths.get('raise') ?? [], id => id)).toHaveLength(1);
    expect(scopedFailuresFor(v.failures, paths.get('keep') ?? [], id => id)).toHaveLength(0);
    const out = withholdGoalFiguresForUntestableTarget(body, g, 'goal');
    expect(chances(out)).toEqual(['keep']);
    expect(warning(out)?.option_ids).toEqual(['raise', 'starter']);
    expect(warning(out)?.per_option.raise.message).toContain('from u to a');
  });

  it.each(['evaluation', 'warning'] as const)('class 2: a %s marking the goal baseline derived from inputs withholds everyone fed by its unsized input', marker => {
    const g = graph(true), body = envelope(), v = failures(g);
    if (marker === 'evaluation') body.identity_evaluations = [{ node_id: 'goal', evaluated: true,
      operation: 'product', factor_ids: ['a', 'b'], level_source: 'identity_inputs' }];
    else body.inference_warnings.push({ code: 'GOAL_LEVEL_FROM_IDENTITY_INPUTS', field: 'nodes[goal].nonlinear_identity', severity: 'info' });
    const out = withholdGoalFiguresForUntestableTarget(body, g, 'goal');
    expect(chances(out)).toEqual([]);
    expect(warning(out)?.option_ids).toEqual(ids);
    expect(warning(out)?.per_option.keep.message).toContain('from u to a');
    expect(v.failures.every(f => f.case === 'c')).toBe(true);
  });

  it('class 1 is transitive and reaches only products on this goal path, regardless of labels', () => {
    const g = graph(true);
    g.edges = g.edges.filter((e: Rec) => e.from !== 'u' || e.to !== 'a');
    g.edges.push(edge('u', 'middle', true), edge('middle', 'a'));
    for (const n of g.nodes) n.label = `unrelated ${n.id}`;
    const out = withholdGoalFiguresForUntestableTarget(envelope(), g, 'goal');
    expect(chances(out)).toEqual(['keep']);
    expect(warning(out)?.per_option.raise.message).toContain('from unrelated u to unrelated middle');
    // Retain the product but disconnect it from the selected goal; Raise now has an independent sized goal path.
    const offGoal = graph();
    offGoal.nodes.push({ id: 'product', kind: 'factor', nonlinear_identity: {
      operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: true,
    } });
    offGoal.edges.push(edge('a', 'product'), edge('b', 'product'));
    expect(chances(withholdGoalFiguresForUntestableTarget(envelope(), offGoal, 'goal'))).toEqual(['raise', 'keep']);
  });

  it.each(['false', 'mismatched'] as const)('a %s derived evaluation cannot borrow a stated-level evaluation attestation', invalid => {
    const g = graph(true), body = envelope();
    body.identity_evaluations = [
      { node_id: 'goal', evaluated: true, operation: 'product', factor_ids: ['a', 'b'], level_source: 'stated_level' },
      { node_id: 'goal', evaluated: invalid !== 'false', operation: 'product',
        factor_ids: invalid === 'mismatched' ? ['a', 'u'] : ['a', 'b'], level_source: 'identity_inputs' },
    ];
    expect(chances(withholdGoalFiguresForUntestableTarget(body, g, 'goal'))).toEqual(['keep']);
  });

  it('another goal\'s derived warning and non-input failure cannot hold this baseline', () => {
    const g = graph(true), body = envelope();
    body.inference_warnings.push({ code: 'GOAL_LEVEL_FROM_IDENTITY_INPUTS', field: 'nodes[other_goal].nonlinear_identity' });
    expect(chances(withholdGoalFiguresForUntestableTarget(body, g, 'goal'))).toEqual(['keep']);
    // The same derived marker only applies to feeds into the identity inputs, not an additive side branch.
    const side = graph();
    side.nodes[0].nonlinear_identity = { operation: 'product', factor_ids: ['b', 'middle'], stated_in_brief: true };
    side.edges = [edge('raise', 'b'), edge('starter', 'u'), edge('u', 'a', true), edge('a', 'goal'), edge('b', 'goal'), edge('middle', 'goal')];
    const sideBody = envelope();
    sideBody.inference_warnings.push({ code: 'GOAL_LEVEL_FROM_IDENTITY_INPUTS', node_id: 'goal' });
    expect(chances(withholdGoalFiguresForUntestableTarget(sideBody, side, 'goal'))).toEqual(['raise', 'keep']);
  });

  it('a linkless P5 failure preserves the existing no-goal-path withhold for everyone', () => {
    const g = graph(); g.edges = [];
    expect(failures(g).failures).toMatchObject([{ case: 'c', links: [] }]);
    const out = withholdGoalFiguresForUntestableTarget(envelope(), g, 'goal');
    expect(chances(out)).toEqual([]);
    expect(warning(out)?.option_ids).toEqual(ids);
  });

  it('the Agent target-only note keeps the partial option scope and permits clean options\' licences', () => {
    const g = graph();
    const out = withholdGoalFiguresForUntestableTarget(envelope(), g, 'goal');
    for (const agent of [goalChanceWithheldForAgent({ enrichment: out }, g), goalChanceWithheldForAgent({ enrichment: out }, g, undefined)]) {
      expect(agent?.option_ids).toEqual(['starter']);
      expect(agent?.note).not.toContain('EVERY option');
      expect(agent?.note).toContain('Other options');
      expect(agent?.say).not.toContain('any option');
    }
  });

  it.each([undefined, 'malformed'])('a legacy partial warning with claims %s grants no share or outcome permission', withheld_claims => {
    const body = envelope();
    body.inference_warnings.push({ code: TARGET, message: 'Not shown. Needs a size.', option_ids: ['starter'], withheld_claims });
    const agent = goalChanceWithheldForAgent({ enrichment: body }, undefined, undefined)!;
    expect(agent.option_ids).toEqual(['starter']);
    expect(agent.note).not.toContain('Shares may be said');
    expect(agent.note).not.toContain('outcomes appear on the panel');
    expect(agent.note).toContain('any leader are withheld');
  });

  it('guided sizing cannot widen the remaining partial target sentence to any option', () => {
    const g = graph();
    const band = g.edges.find((e: Rec) => e.from === 'b' && e.to === 'goal');
    band.provenance = { source: 'user_specified' };
    band.provenance_display = 'user_set';
    const out = withholdGoalFiguresForUntestableTarget(envelope(), g, 'goal');
    expect(chances(out)).toEqual(['keep']);
    const agent = goalChanceWithheldForAgent({ enrichment: out }, g)!;
    expect(agent.option_ids).toEqual(['raise', 'starter']);
    expect(agent.say).not.toContain('any option');
    expect(agent.say).not.toContain('each option');
  });
});
