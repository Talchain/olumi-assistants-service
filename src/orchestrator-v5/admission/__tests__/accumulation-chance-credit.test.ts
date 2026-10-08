import { describe, expect, it } from 'vitest';
import { evaluatedIdentityCarriers, exactIdentityOperandLinks, identityCanCarryExactLinks } from '../identity-evaluations.js';
import { reachedGoalPaths, targetTestabilityOf } from '../target-testability.js';
import { goalCertaintyDecisions, placeholderGoalPaths } from '../../agent-lane/goal-certainty.js';
import { chancesWithheldByAGuess } from '../../agent-lane/runtime/build-model.js';

type Rec = Record<string, any>;

// The live-head/B1-d1 registered path after its retained-excluded risk is removed by the chance reader.
// Keep its figures, provenance, natural estimate and identity declarations; irrelevant decision/option rows are omitted.
function b1Graph(sources = ['cee_inference', 'cee_inference', 'cee_inference']): { nodes: Rec[]; edges: Rec[]; goal_constraints: Rec[] } {
  const identity = { operation: 'accumulation', factor_ids: ['stock', 'churn', 'inflow'],
    horizon_months: 12, rate_scale: 0.01, stated_in_brief: false };
  const node = (id: string, label: string, raw_value: number, value: number, unit: string, source: string, scale_frame: number): Rec =>
    ({ id, kind: 'factor', label, scale_frame, observed_state: { raw_value, value, unit, source } });
  const placeholder = (from: string, to: string, sign = 1): Rec => ({ from, to,
    strength: { mean: 0.5 * sign, std: 0.125 }, exists_probability: 0.8,
    effect_direction: sign > 0 ? 'positive' : 'negative', defaulted: true,
    provenance: { source: 'cee_hypothesis', mean_projected: true, magnitude: 'olumi_placeholder' } });
  return {
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_unit: '£/month', goal_threshold_frame: 'level',
        goal_threshold_raw: 20000, goal_threshold_cap: 25000, goal_threshold: 0.8, threshold_source: 'brief_extraction',
        goal_direction: '>=', goal_horizon_months: 12,
        nonlinear_identity: { operation: 'product', factor_ids: ['price', 'month12'], stated_in_brief: false } },
      { id: 'raise', kind: 'option', label: 'Raise Pro to £59',
        interventions: { price: { value: 0.295, raw_value: 59, unit: '£/month', source: 'brief_extraction' } } },
      node('price', 'Pro plan price', 49, 0.245, '£/month', 'brief_extraction', 200),
      node('stock', 'Pro subscribers today', 150, 0.075, 'subscribers', sources[0]!, 2000),
      node('churn', 'Monthly churn', 5, 0.05, '%', sources[1]!, 100),
      node('inflow', 'New Pro subscribers per month', 25, 0.05, 'subscribers/month', sources[2]!, 500),
      { id: 'month12', kind: 'outcome', label: 'Pro subscribers at month 12', scale_frame: 2000, nonlinear_identity: identity },
    ],
    edges: [
      { from: 'raise', to: 'price', strength: { mean: 1, std: 0.01 }, provenance: { source: 'cee_hypothesis' } },
      { from: 'price', to: 'churn', strength: { mean: 0.3, std: 0.15 }, exists_probability: 0.8,
        effect_direction: 'positive', defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
          natural_effect: { amount: 1.5, amount_unit: 'percentage points', per_source_change: 10,
            per_source_change_unit: '£/month', strength_mean: 0.3, strength_mean_frame: 'edge_strength' },
          basis: 'A £10 monthly price increase is provisionally assumed to add 1.5 churn percentage points.' } },
      placeholder('stock', 'month12'), placeholder('churn', 'month12', -1), placeholder('inflow', 'month12'),
      placeholder('month12', 'mrr'), placeholder('price', 'mrr'),
    ],
    goal_constraints: [{ constraint_id: 'churn-limit', node_id: 'churn', operator: '<=', operator_as_stated: '<',
      value: 8, label: 'Monthly churn', unit: '%', provenance: 'explicit', value_frame: 'level' }],
  };
}

const evaluations = (graph: { nodes: Rec[] }): Rec[] => graph.nodes.filter((n) => n.nonlinear_identity).map((n) =>
  ({ node_id: n.id, evaluated: true, ...n.nonlinear_identity }));
const accumulation = (graph: { nodes: Rec[] }): Rec => graph.nodes.find((n) => n.id === 'month12')!.nonlinear_identity;
const users = ['brief_extraction', 'user_confirmed', 'user_assumption'];

describe('only the user’s accumulation levels earn goal chance credit', () => {
  it('F1-B1: the recorded estimated-input path is withheld; the same path on all user inputs is creditable', () => {
    expect(chancesWithheldByAGuess(b1Graph())).toBe(true);
    expect(chancesWithheldByAGuess(b1Graph(users))).toBe(false);
  });

  it('a used accumulation on guessed inputs still withholds when options only move its price partner', () => {
    const graph = b1Graph();
    graph.edges = graph.edges.filter((e) => !(e.from === 'price' && e.to === 'churn'));
    expect(chancesWithheldByAGuess(graph)).toBe(true);
    const control = b1Graph(users);
    control.edges = control.edges.filter((e) => !(e.from === 'price' && e.to === 'churn'));
    expect(chancesWithheldByAGuess(control)).toBe(false);
  });

  it('an unrelated guessed accumulation does not block the ordinary goal product', () => {
    const graph = b1Graph();
    graph.nodes[0]!.nonlinear_identity.factor_ids = ['price', 'stock'];
    graph.edges = graph.edges.filter((e) => !(e.from === 'price' && e.to === 'churn') && !(e.from === 'month12' && e.to === 'mrr'));
    graph.edges.push({ from: 'stock', to: 'mrr', strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true }, defaulted: true });
    expect(chancesWithheldByAGuess(graph)).toBe(false);
  });

  it('an evaluated accumulation still needs all three inputs to be user-stated or ratified; plain products are unchanged', () => {
    for (let i = 0; i < 3; i++) {
      const sources = [...users]; sources[i] = 'cee_inference';
      const graph = b1Graph(sources);
      expect(identityCanCarryExactLinks(graph.nodes, accumulation(graph))).toBe(false);
      expect([...evaluatedIdentityCarriers(graph.nodes, evaluations(graph))]).toEqual(['mrr']);
    }
    const graph = b1Graph(users);
    expect([...evaluatedIdentityCarriers(graph.nodes, evaluations(graph))]).toEqual(['mrr', 'month12']);
    expect(identityCanCarryExactLinks(graph.nodes, { operation: 'product', factor_ids: ['stock', 'churn'] })).toBe(true);
  });

  it('an explicit declaration cannot bypass the user-input rule in the shared exact-link reader', () => {
    const graph = b1Graph(); accumulation(graph).stated_in_brief = true;
    expect([...exactIdentityOperandLinks(graph.nodes, graph.edges)].filter((e) => e.to === 'month12')).toEqual([]);
    const control = b1Graph(users); accumulation(control).stated_in_brief = true;
    expect([...exactIdentityOperandLinks(control.nodes, control.edges)].filter((e) => e.to === 'month12')).toHaveLength(3);
  });

  it('definitional edge stamps cannot bypass the accumulation user-input rule in the goal walk', () => {
    const graph = b1Graph();
    for (const e of graph.edges) if (e.to === 'month12') e.provenance.definitional = true;
    const walk = reachedGoalPaths(graph, ['raise'], new Map([['raise', ['price']]]), evaluations(graph));
    expect([...walk.exactLinks].filter((e) => e.to === 'month12')).toEqual([]);
    const control = b1Graph(users);
    for (const e of control.edges) if (e.to === 'month12') e.provenance.definitional = true;
    const userWalk = reachedGoalPaths(control, ['raise'], new Map([['raise', ['price']]]), evaluations(control));
    expect([...userWalk.exactLinks].filter((e) => e.to === 'month12')).toHaveLength(3);
    // A separately definitional ordinary link retains its existing exact credit.
    graph.edges[1]!.provenance.definitional = true;
    expect(reachedGoalPaths(graph, ['raise'], new Map([['raise', ['price']]]), evaluations(graph)).exactLinks.has(graph.edges[1]!)).toBe(true);
  });

  it('P5 refuses guessed accumulation inputs even on a confirmed declaration', () => {
    const graph = b1Graph(); accumulation(graph).stated_in_brief = true;
    graph.nodes[0]!.nonlinear_identity.stated_in_brief = true;
    const verdict = targetTestabilityOf(graph, evaluations(graph));
    expect(verdict.kind).toBe('not_testable');
    if (verdict.kind !== 'not_testable') throw new Error('expected P5 failure');
    expect(verdict.failures.some((f) => f.code === 'goal_path_placeholder' && f.links?.some((l) => l.from === 'churn' && l.to === 'month12'))).toBe(true);
  });

  it('the Run placeholder reader cannot credit an evaluated accumulation on Olumi levels', () => {
    const graph = b1Graph();
    graph.nodes[1]!.interventions = { churn: { value: 0.06, raw_value: 6 } };
    expect(placeholderGoalPaths(graph, ['raise'], evaluations(graph))).toEqual([
      { option_id: 'raise', links: [{ from: 'churn', to: 'month12' }] },
    ]);
    const control = b1Graph(users); control.nodes[1]!.interventions = graph.nodes[1]!.interventions;
    expect(placeholderGoalPaths(control, ['raise'], evaluations(control))).toEqual([]);
  });

  it('the certainty reader cannot earn 100% through an evaluated accumulation on Olumi levels', () => {
    const graph = b1Graph();
    graph.nodes[1]!.interventions = { churn: { value: 0.06, raw_value: 6 } };
    expect(goalCertaintyDecisions(graph, [{ option_id: 'raise', probability_of_goal: 1 }], evaluations(graph))[0]?.earned).toBe(false);
    const control = b1Graph(users); control.nodes[1]!.interventions = graph.nodes[1]!.interventions;
    expect(goalCertaintyDecisions(control, [{ option_id: 'raise', probability_of_goal: 1 }], evaluations(control))[0]?.earned).toBe(true);
  });
});
