import { describe, expect, it } from 'vitest';
import * as target from '../target-testability.js';
import { guidedSizingActions, guidedSizingForRun, guidedSizingProgressLine } from '../../agent-lane/guided-sizing.js';
import { goalChanceWithheldForAgent } from '../../agent-lane/goal-chance-withheld.js';
import { naturalEffectOf } from '../../../cee/magnitude/link-effect.js';

type Json = Record<string, any>;
const estimate = (): Json => ({ id: 'estimate', from: 'price', to: 'goal', strength: { mean: 0.2, std: 0.1 },
  provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: {
    amount: 2, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£/month', strength_mean: 0.2,
  } } });
const graph = (): Json => ({ nodes: [
  { id: 'option', kind: 'option', label: 'Raise price', interventions: { price: 0.6 } },
  { id: 'price', kind: 'factor', label: 'Price', scale_frame: 10, observed_state: { value: 0.5, raw_value: 5, unit: '£/month' } },
  { id: 'goal', kind: 'goal', label: 'Revenue', scale_frame: 100, goal_threshold: 0.8, goal_threshold_raw: 80,
    goal_threshold_unit: '£/month', goal_threshold_cap: 100, goal_direction: 'maximise', goal_operator: '>=',
    observed_state: { baseline: 0.4, value: 0.4, raw_value: 40, unit: '£/month' } },
], edges: [{ from: 'option', to: 'price' }, estimate()] });
const blocked = (g: Json): boolean => {
  const v = target.targetTestabilityOf(g);
  return v.kind === 'not_testable' && v.failures.some(f => f.case === 'c');
};
const run = (acceptable: unknown[] = []): Json => ({ enrichment: { inference_warnings: [
  ...(acceptable.length ? [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', acceptable_links: acceptable }] : []),
  { code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', withheld_claims: ['goal_probability'], say: 'The size cannot be converted.' },
] } });
const carve = "How much does ‘Price’ change ‘Revenue’, in £/month? Olumi has it as a band, which can't be turned into your goal's units.";

describe('Science §(i) amendment: estimates convert; placeholders and refused conversions do not', () => {
  it('a current natural estimate converting into the goal unit clears (c)', () => expect(blocked(graph())).toBe(false));
  it('a unit-bearing zero-effect estimate is a converting size', () => {
    const g = graph(); const e = g.edges[1];
    e.strength.mean = e.provenance.natural_effect.strength_mean = e.provenance.natural_effect.amount = 0;
    expect(blocked(g)).toBe(false);
  });
  it('the natural-effect writer’s six-significant-figure persistence still converts', () => {
    const g = graph(); const e = g.edges[1];
    e.strength.mean = 0.123456789;
    e.provenance.natural_effect = naturalEffectOf(e.strength.mean,
      { kind: 'factor', label: 'Price', scale_frame: 10, observed_state: { unit: '£/month' }, option_levels: [] },
      { kind: 'goal', label: 'Revenue', scale_frame: 100, observed_state: { unit: '£/month' }, option_levels: [] }, 1);
    expect(e.provenance.natural_effect.amount).toBe(1.23457);
    expect(blocked(g)).toBe(false);
    e.provenance.natural_effect.amount = 1.2346; // Beyond the writer’s rounding bound: a different coefficient.
    expect(blocked(g)).toBe(true);
  });
  it.each(['placeholder', 'band', 'wrong target unit', 'wrong source unit', 'stale mean', 'zero divisor', 'missing frame'])('%s stays blocked', reason => {
    const g = graph(); const e = g.edges[1]; const n = e.provenance.natural_effect;
    if (reason === 'placeholder') e.provenance.magnitude = 'olumi_placeholder';
    if (reason === 'band') delete e.provenance.natural_effect;
    if (reason === 'wrong target unit') n.amount_unit = 'subscribers';
    if (reason === 'wrong source unit') n.per_source_change_unit = 'subscribers';
    if (reason === 'stale mean') n.strength_mean = 0.3;
    if (reason === 'zero divisor') n.per_source_change = 0;
    if (reason === 'missing frame') { delete g.nodes[1].scale_frame; delete g.nodes[1].observed_state; }
    expect(blocked(g)).toBe(true);
  });
  it('N=0: the refused estimate gets the exact press and no placeholder header', () => {
    const g = graph(); delete g.edges[1].provenance.natural_effect;
    const draft = guidedSizingForRun(run(), g);
    expect(draft?.total).toBe(0);
    expect(guidedSizingActions(draft, g).map(a => a.label)).toEqual([carve]);
    expect(goalChanceWithheldForAgent(run(), g)?.say).not.toContain("The chance isn't shown yet:");
    const old = { enrichment: { inference_warnings: [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', acceptable_links: [],
      message: "Not shown. Not shown yet: 2 links on the way to your goal have no size, so any figure would come from Olumi's stand-ins, not your model. Size them to see the chance." }] } };
    expect(goalChanceWithheldForAgent(old, g)?.say).not.toContain('Not shown yet:');
    expect(guidedSizingProgressLine(g)).toBeNull();
  });
  it('one list: placeholders first; refused estimates cannot inflate N or M', () => {
    const g = graph(); delete g.edges[1].provenance.natural_effect;
    for (const id of ['far', 'near']) {
      g.nodes.push({ id, kind: 'factor', label: id, scale_frame: 10, observed_state: { value: 0.5, raw_value: 5, unit: '£/month' } });
      g.edges.push({ id, from: 'price', to: id, strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_placeholder' } },
        { from: id, to: 'goal', strength: { mean: 0.2 }, provenance: { source: 'user_specified', natural_effect: { amount: 2, amount_unit: '£/month' } } });
    }
    const r = run([{ from: 'price', to: 'far' }, { from: 'price', to: 'near' }]);
    const draft = guidedSizingForRun(r, g);
    expect(draft?.total).toBe(2);
    expect(draft?.links.map(l => l.id)).toEqual(['far', 'near', 'estimate']);
    expect(guidedSizingActions(draft, g).map(a => a.label).at(-1)).toBe(carve);
    // Class (ii): the refused band remains, and this graph has no G0 driver evidence.
    expect(guidedSizingProgressLine(g)).toBe('2 more to go.');
    expect(goalChanceWithheldForAgent(r, g)?.say).not.toContain('Give a rough strength');
  });
  it('the selected Run’s evaluated identity operands cannot acquire extra conversion presses', () => {
    const g = graph();
    g.nodes.push({ id: 'carrier', kind: 'outcome', label: 'Carrier', scale_frame: 100,
      observed_state: { value: 0.4, raw_value: 40, unit: '£/month' },
      nonlinear_identity: { operation: 'product', factor_ids: ['price', 'volume'], stated_in_brief: false } },
    { id: 'volume', kind: 'factor', label: 'Volume', observed_state: { value: 4, unit: 'subscribers' } });
    g.edges[1].to = 'carrier'; delete g.edges[1].provenance.natural_effect;
    g.edges.push({ from: 'volume', to: 'carrier', strength: { mean: 0.5 }, provenance: { magnitude: 'olumi_estimate' } },
      { from: 'carrier', to: 'goal', strength: { mean: 1 }, provenance: { source: 'user_specified', natural_effect: { amount: 1, amount_unit: '£/month' } } });
    expect(blocked(g)).toBe(true);
    const r = { ...run(), identity_evaluations: [{ node_id: 'carrier', evaluated: true }] };
    expect(target.targetTestabilityOf(g, r.identity_evaluations).kind).toBe('testable');
    expect(guidedSizingForRun(r, g)).toBeUndefined();
  });
});
