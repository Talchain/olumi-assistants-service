/**
 * ⭐ D3 (DL 0df0e1, 6 Oct; Integrator 37): the placeholder withhold types what its words ask FIRST (`first_ask`), so the
 * Analysis panel's next step and the chat name the SAME step. Rows: (A) a frameless goal → its level; (B) the gauge (37's
 * exact graph: Pro plan price → Support capacity strain → MRR) → the one end-to-end question, never strain → MRR; (C) a
 * mediator in its sized parent's unit → that link; plain → the first asked link nearest the goal (= an acceptable link);
 * a product block → nothing (the words invite nothing).
 */
import { describe, expect, it } from 'vitest';
import { placeholderGoalWarning, unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { convertLinkEffect } from '../../../cee/magnitude/link-effect.js';
import { readFileSync } from 'node:fs';
import { placeholderAskWords } from '../goal-certainty.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';

type Rec = Record<string, any>;
const GOAL = { id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { value: 0.5, raw_value: 100000, cap: 200000, unit: '£/month', source: 'user_override' } };
const placeholder = (from: string, to: string, mean: number): Rec => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 0.9,
  effect_direction: mean < 0 ? 'negative' : 'positive', defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
const PRICE = { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } };
const RAISE = { id: 'o-raise', kind: 'option', label: 'Raise price', interventions: { price: { value: 0.59, raw_value: 59 } } };

const gaugeGraph = (): Rec => ({ goal_node_id: 'mrr', nodes: [structuredClone(GOAL), structuredClone(PRICE),
  { id: 'strain', kind: 'factor', label: 'Support capacity strain' }, structuredClone(RAISE)],
  edges: [placeholder('price', 'strain', 0.4), placeholder('strain', 'mrr', -0.3)] });
const plainGraph = (): Rec => ({ goal_node_id: 'mrr', nodes: [structuredClone(GOAL), structuredClone(PRICE), structuredClone(RAISE)],
  edges: [placeholder('price', 'mrr', 0.4)] });
function sizedParentGraph(): Rec {
  const beta = convertLinkEffect(250, 1000, 5000, 10000)!;
  return { goal_node_id: 'mrr', nodes: [structuredClone(GOAL),
    { id: 'budget', kind: 'factor', label: 'Support budget', observed_state: { value: 0.5, raw_value: 5000, cap: 10000, unit: '£/month', source: 'user_override' } },
    { id: 'cost', kind: 'factor', label: 'Support cost', scale_frame: 5000 },
    { id: 'o-spend', kind: 'option', label: 'Spend more', interventions: { budget: { value: 0.6, raw_value: 6000 } } }],
  edges: [{ from: 'budget', to: 'cost', strength: { mean: beta, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 250, amount_unit: '£/month',
      per_source_change: 1000, per_source_change_unit: '£/month', strength_mean: beta, strength_mean_frame: 'edge_strength' } } },
  placeholder('cost', 'mrr', -0.3)] };
}
const warn = (g: Rec, option: string, productBlocks = false, opts: { gaugeAsk?: true } = {}): Rec =>
  placeholderGoalWarning(g, unsizedLeaderGoalPaths(g, [option]), 'GOAL_FIGURES_PLACEHOLDER_PATH', productBlocks, opts) as Rec;

describe('first_ask: the one step the placeholder withhold asks first, typed', () => {
  it('(B) gauge, where its ask is lifted (RT-18 opts.gaugeAsk; cut-6 lift path): the end-to-end question price → MRR through strain', () => {
    const w = warn(gaugeGraph(), 'o-raise', false, { gaugeAsk: true });
    expect(w.first_ask).toEqual({ kind: 'gauge', from: 'price', through: 'strain', to: 'mrr' });
    expect(w.links[0]).not.toEqual({ from: 'price', to: 'strain' }); // the nearest-goal link the panel used to name is strain → MRR
  });

  it('(A) a goal with no frame: its level first, before any link', () => {
    const g = gaugeGraph();
    delete g.nodes.find((n: Rec) => n.id === 'mrr').observed_state;
    expect(warn(g, 'o-raise').first_ask).toEqual({ kind: 'goal_level', node_id: 'mrr' });
  });

  it('(C) a mediator in its sized parent\'s unit: that link', () => {
    expect(warn(sizedParentGraph(), 'o-spend').first_ask).toEqual({ kind: 'link', from: 'cost', to: 'mrr' });
  });

  it('plain: the first asked link nearest the goal — the same one the one-click offer carries', () => {
    const w = warn(plainGraph(), 'o-raise');
    expect(w.first_ask).toEqual({ kind: 'link', from: 'price', to: 'mrr' });
    expect(w.acceptable_links).toContainEqual({ from: 'price', to: 'mrr' });
  });

  it('CONTRAST: while a product blocks every option the words invite nothing, so nothing is asked first', () => {
    expect(warn(plainGraph(), 'o-raise', true)).not.toHaveProperty('first_ask');
  });

  it('Codex r1 P1 (A, 180-character labels): the goal-level QUESTION survives in the words whenever first_ask names it', () => {
    const g = plainGraph();
    const goal = g.nodes.find((n: Rec) => n.id === 'mrr');
    delete goal.observed_state;
    goal.label = `Monthly recurring revenue ${'across every plan and region '.repeat(6)}`.slice(0, 180);
    g.nodes.find((n: Rec) => n.id === 'price').label = `Pro plan price ${'for every seat on annual and monthly billing '.repeat(4)}`.slice(0, 180);
    const w = warn(g, 'o-raise');
    expect(w.first_ask).toEqual({ kind: 'goal_level', node_id: 'mrr' });
    expect(w.message).toContain('I first need today\u2019s level of');
    expect(w.message.length).toBeLessThanOrEqual(400);
  });

  it('Codex r1 (guessed only): a link out of a limit-watched node into the goal is never OFFERED, so it is never the first ask', () => {
    // The words keep MC's ruled sentence (mc-p0-round6/round8 pin "Set them" with nothing offered); the panel takes the offer.
    const g = { ...plainGraph(), goal_constraints: [{ node_id: 'price', operator: '<=', value: 0.8 }] };
    const w = warn(g, 'o-raise');
    expect(w).not.toHaveProperty('first_ask');
    expect(w).not.toHaveProperty('acceptable_links');
    // CONTRAST: the same link with no limit watching its source is offered, and is the first ask.
    expect(warn(plainGraph(), 'o-raise').first_ask).toEqual({ kind: 'link', from: 'price', to: 'mrr' });
  });

  it('Codex r1 P1 (mixed): first_ask is the first link the words name that the user CAN size — never the guessed one', () => {
    const g = plainGraph();
    g.nodes.push({ id: 'downtime', kind: 'factor', label: 'Migration downtime', observed_state: { value: 0.2, raw_value: 20, cap: 100, unit: 'hours', source: 'user_override' } });
    g.nodes.find((n: Rec) => n.id === 'o-raise').interventions.downtime = { value: 0.3, raw_value: 30 };
    g.edges = [placeholder('downtime', 'mrr', -0.2), placeholder('price', 'mrr', 0.4)];
    g.goal_constraints = [{ node_id: 'downtime', operator: '<=', value: 0.5 }];
    const w = warn(g, 'o-raise');
    expect(w.first_ask).toEqual({ kind: 'link', from: 'price', to: 'mrr' });
    expect(w.acceptable_links).toEqual([{ from: 'price', to: 'mrr' }]);
    expect(w.message).toContain('\u2018Pro plan price\u2019');
  });

  // ⭐ DL 0df0e1 CR on #2635 (6008994949) + Review Desk 6b: rebased on RT-18 (#2641), the gauge question is gated OFF by
  // default, so the panel must never name a gauge step the chat does not ask. `first` is set only AFTER the gate.
  const DENTAL = (): Rec => assignEntityRefs(projectGraphForPersistence(JSON.parse(readFileSync(new URL('./fixtures/rt18-dental-74cc7aea-graph.json',
    import.meta.url), 'utf8'))), { nodes: [], edges: [] }).graph as Rec;
  const GAUGE_PATH = [{ from: 'missed_appointment_fee', to: 'fee_related_patient_dissatisfaction' }, { from: 'fee_related_patient_dissatisfaction', to: 'no_shows' }];

  it('DENTAL (RT-18 gate on): first_ask is never `gauge`; if anything is asked first it is a link the offer carries', () => {
    const w = placeholderGoalWarning(DENTAL(), [{ option_id: '20_no_show_fee', links: GAUGE_PATH }], 'GOAL_FIGURES_PLACEHOLDER_PATH') as Rec;
    expect(w.first_ask?.kind).not.toBe('gauge');
    if (w.first_ask !== undefined) {
      expect(w.first_ask.kind).toBe('link');
      expect(w.acceptable_links).toContainEqual({ from: w.first_ask.from, to: w.first_ask.to });
    }
  });
  it('the gated early return (`{ gaugeLinks }`) carries no `first`: the words ask nothing, so nothing is asked first', () => {
    const words = placeholderAskWords(DENTAL(), GAUGE_PATH);
    expect(words?.gaugeLinks.size).toBe(2);
    expect(words).not.toHaveProperty('first');
    expect(words?.message).toBeUndefined();
  });
  it('CONTRAST: the gauge graph with the ask NOT lifted → never `gauge` either', () => {
    expect(warn(gaugeGraph(), 'o-raise').first_ask?.kind).not.toBe('gauge');
  });
});
