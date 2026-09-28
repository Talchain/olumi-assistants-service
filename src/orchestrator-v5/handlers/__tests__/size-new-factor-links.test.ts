/**
 * R2 (DL #72 5862693164): `sizeNewFactorLinks` re-sizes ONLY a new factor's own Olumi-sized links, by the first model's
 * D6 rule, inside the confirmed ops. The end-to-end rows (Paul's grandfathering switch through the real one-click commit)
 * are `agent-lane/__tests__/agent-add-option-held-seam.test.ts` [R2]; these pin what it must never touch.
 */
import { describe, expect, it } from 'vitest';

import { hypothesisEdgeValue } from '../../routing/add-option-transaction.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { sizeNewFactorLinks } from '../size-new-factor-links.js';

const e = (from: string, to: string, mean: number) =>
  ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: mean >= 0 ? 'positive' : 'negative' });

/** Churn at 3% (domain [0, 1] by its "% per month" unit), an option that will switch the new factor on. */
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'MRR' },
    { id: 'dec', kind: 'decision', label: 'Pricing' },
    { id: 'opt', kind: 'option', label: 'Grandfather', interventions: { sw: { value: 1 } } },
    { id: 'churn', kind: 'factor', label: 'Monthly churn', scale_frame: 100,
      observed_state: { value: 0.03, raw_value: 3, unit: '% per month', source: 'cee_inference' } },
  ],
  edges: [e('dec', 'opt', 1), e('churn', 'goal', -0.4)],
};
const addSwitch = (edge: Record<string, unknown>): PatchOperation[] => [
  { op: 'add_node', path: 'sw', value: { id: 'sw', kind: 'factor', label: 'Grandfathered', category: 'controllable',
    observed_state: { value: 0, raw_value: 0, source: 'cee_inference' } } },
  { op: 'add_edge', path: 'sw::churn', value: edge },
] as PatchOperation[];

describe('sizeNewFactorLinks', () => {
  it('RED: a new factor\'s default link is re-sized in its op by D6 (−min(0.5, 0.03/4) = −0.0075, std |m|/2)', () => {
    const r = sizeNewFactorLinks(addSwitch(hypothesisEdgeValue('sw', 'churn', 'negative')), GRAPH, ['sw']);
    expect(r.sized).toEqual(['sw::churn']);
    const v = (r.operations[1] as { value: Record<string, any> }).value;
    expect(v.strength.mean).toBeCloseTo(-0.0075, 12);
    expect(v.strength.std).toBeCloseTo(0.00375, 12);
    expect(v.provenance).toEqual(expect.objectContaining({ source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }));
    expect(r.operations[0], 'only the link op changes').toEqual(addSwitch(hypothesisEdgeValue('sw', 'churn', 'negative'))[0]);
  });

  const withChurnUnit = (unit: string, limits?: unknown[]) => ({
    ...GRAPH,
    nodes: GRAPH.nodes.map((n) => (n.id === 'churn' ? { ...n, observed_state: { ...n.observed_state!, unit } } : n)),
    ...(limits !== undefined ? { goal_constraints: limits } : {}),
  });
  const PCT_LIMIT = { constraint_id: 'agent-lane:churn:<=', node_id: 'churn', operator: '<=', value: 4, unit: '%', value_frame: 'level' };

  it('RED (served unit): churn in a bare "%" (journey A, pj-20260928T025327Z) → sized −0.0075', () => {
    const r = sizeNewFactorLinks(addSwitch(hypothesisEdgeValue('sw', 'churn', 'negative')), withChurnUnit('%', [PCT_LIMIT]), ['sw']);
    expect(r.sized).toEqual(['sw::churn']);
    expect((r.operations[1] as { value: Record<string, any> }).value.strength.mean).toBeCloseTo(-0.0075, 12);
  });

  // A population-worded % reads as a level only because a % LEVEL limit names it (`percentLevelIds`), so the scratch
  // keeps the graph's goal_constraints (the applier returns nodes + edges only).
  it('a population-worded % ("% of Pro customers per month") is sized when its % level limit is on the graph …', () => {
    const r = sizeNewFactorLinks(addSwitch(hypothesisEdgeValue('sw', 'churn', 'negative')), withChurnUnit('% of Pro customers per month', [PCT_LIMIT]), ['sw']);
    expect(r.sized).toEqual(['sw::churn']);
  });

  it('… and CONTRAST: with no limit it has no domain to size against → the default is kept (admission alike)', () => {
    const r = sizeNewFactorLinks(addSwitch(hypothesisEdgeValue('sw', 'churn', 'negative')), withChurnUnit('% of Pro customers per month'), ['sw']);
    expect(r.sized).toEqual([]);
  });

  it('a new GRADED factor (not a switch the hold names) keeps its own path: its links are untouched', () => {
    const ops = addSwitch(hypothesisEdgeValue('sw', 'churn', 'negative'));
    const r = sizeNewFactorLinks(ops, GRAPH, []);
    expect(r.sized).toEqual([]);
    expect(r.operations).toEqual(ops);
  });

  it('a batch that adds no factor is returned unchanged (same ops, nothing sized)', () => {
    const ops = [{ op: 'add_edge', path: 'churn::goal', value: hypothesisEdgeValue('churn', 'goal', 'negative') }] as PatchOperation[];
    const r = sizeNewFactorLinks(ops, GRAPH, ['sw']);
    expect(r.sized).toEqual([]);
    expect(r.operations).toEqual(ops);
  });

  it('a USER\'s size on a new factor\'s link is never touched', () => {
    const userSized = { ...hypothesisEdgeValue('sw', 'churn', 'negative'), strength: { mean: -0.5, std: 0.125 }, provenance: { source: 'user_specified' } };
    const r = sizeNewFactorLinks(addSwitch(userSized), GRAPH, ['sw']);
    expect(r.sized).toEqual([]);
    expect((r.operations[1] as { value: unknown }).value).toEqual(userSized);
  });

  it('a batch the scratch apply cannot take is returned unchanged (the real apply declines it)', () => {
    const ops = [...addSwitch(hypothesisEdgeValue('sw', 'churn', 'negative')),
      { op: 'remove_edge', path: 'nope::nowhere' }] as PatchOperation[];
    const r = sizeNewFactorLinks(ops, GRAPH, ['sw']);
    expect(r.sized).toEqual([]);
    expect(r.operations).toEqual(ops);
  });
});
