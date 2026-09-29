/**
 * Frames (AIQ 5895140735; R3 5893508312 / 5894964169; R3-B 5895208669; DL lease 5895185190). The production re-framer
 * (`refit-frames.ts`) held to R3's oracle (`tests/helpers/frame-invariance.ts`, #2308): `frameInvariance(before, after)`
 * must be empty — nothing the user sees moves in natural units except the cut. On the SERVED saved graph of Run
 * `c96fc4bb` (£49 per subscriber: β 4.61, cut to 1 by PLoT) and small constructed graphs for each refusal. 0 LLM.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { frameInvariance } from '../../../../tests/helpers/frame-invariance.js';
import { niceFrameAtLeast, refitFramesForStatedEffects } from '../refit-frames.js';

type Rec = Record<string, any>;
const C96 = JSON.parse(readFileSync(new URL('./fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const c96 = (): Rec => structuredClone(C96.graph);
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const edge = (g: Rec, from: string, to: string): Rec => g.edges.find((e: Rec) => e.from === from && e.to === to);

describe('R9 — the served c96 graph: widen MRR\'s frame; nothing else moves', () => {
  it('PRECONDITION: the user\'s £49 per subscriber is β 4.61 on MRR\'s 106,250 (the cut PLoT makes)', () => {
    const e = edge(c96(), 'paying_subscribers', 'mrr');
    expect(e.provenance.magnitude).toBe('user_stated');
    expect(e.strength.mean).toBeCloseTo(4.6117647, 6);
    expect(frameInvariance(c96(), c96())).toEqual(['beta_out_of_contract paying_subscribers→mrr 4.612']);
  });
  it('RED: MRR is re-framed 106,250 → 500,000; the oracle is EMPTY (no cut, every natural size held); £49 per subscriber exact', () => {
    const before = c96();
    const r = refitFramesForStatedEffects(before);
    expect(r.refits).toEqual([{ node: 'mrr', from: 106250, to: 500000, for_link: 'paying_subscribers→mrr' }]);
    expect(r.refused).toEqual([]);
    expect(frameInvariance(before, r.graph)).toEqual([]);
    expect(edge(r.graph, 'paying_subscribers', 'mrr').strength.mean).toBeCloseTo(0.98, 6);
    expect(edge(r.graph, 'paying_subscribers', 'mrr').provenance.natural_effect.amount).toBe(49);
    expect(edge(r.graph, 'pro_plan_price', 'mrr').strength.mean).toBeCloseTo(0.10625, 9);
    const g = node(r.graph, 'mrr');
    expect([g.goal_threshold_raw, g.goal_threshold_cap, g.goal_threshold_cap_provenance]).toEqual([85000, 500000, 'stated_effect_fit']);
    expect(g.goal_threshold).toBeCloseTo(0.17, 12);
    expect(g.observed_state).toMatchObject({ raw_value: 75000, cap: 500000 });
    expect(g.observed_state.value).toBeCloseTo(0.15, 12);
  });
  it('only MRR moves: churn → subscribers and gross additions → subscribers are byte-identical (AIQ\'s R9)', () => {
    const before = c96();
    const after = refitFramesForStatedEffects(before).graph;
    for (const [f, t] of [['monthly_churn', 'paying_subscribers'], ['monthly_gross_additions', 'paying_subscribers']] as const) {
      expect(edge(after, f, t)).toEqual(edge(before, f, t));
    }
    expect(after.nodes.filter((n: Rec, i: number) => JSON.stringify(n) !== JSON.stringify(before.nodes[i])).map((n: Rec) => n.id)).toEqual(['mrr']);
  });
  it('PURE: the input graph is never mutated', () => {
    const before = c96();
    const snapshot = JSON.stringify(before);
    refitFramesForStatedEffects(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

// A small graph: a user-stated link X → Y with β 3 on Y's frame 100, Y a factor.
function small(over: { y?: Rec; extraEdges?: Rec[]; extraNodes?: Rec[]; constraints?: Rec[] } = {}): Rec {
  return {
    nodes: [
      { id: 'x', kind: 'factor', label: 'X', observed_state: { value: 0.5, raw_value: 50, cap: 100, source: 'brief_extraction' } },
      { id: 'y', kind: 'factor', label: 'Y', observed_state: { value: 0.4, raw_value: 40, cap: 100, source: 'brief_extraction' }, ...(over.y ?? {}) },
      ...(over.extraNodes ?? []),
    ],
    edges: [
      { from: 'x', to: 'y', strength: { mean: 3, std: 0.5 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { amount: 3, per_source_change: 1, strength_mean: 3 } } },
      ...(over.extraEdges ?? []),
    ],
    ...(over.constraints !== undefined ? { goal_constraints: over.constraints } : {}),
  };
}

describe('refusals: the clamp and #422\'s withhold stay, and the graph is returned untouched', () => {
  it.each<[string, Rec, string]>([
    ['an option SETS the target (its levels are not rescaled in v1)', small({ extraNodes: [{ id: 'o', kind: 'option', label: 'O', interventions: { y: 0.8 } }] }), 'levels_set_on_node'],
    ['a limit NAMES the target', small({ constraints: [{ node_id: 'y', operator: '<=', value: 60 }] }), 'levels_set_on_node'],
    ['widening the target would cut its OUT-link (Y → Z 0.3 × 5 = 1.5)', small({ extraNodes: [{ id: 'z', kind: 'factor', label: 'Z', observed_state: { value: 0.5, raw_value: 5, cap: 10, source: 'brief_extraction' } }],
      extraEdges: [{ from: 'y', to: 'z', strength: { mean: 0.3, std: 0.1 }, provenance: { source: 'cee_hypothesis' } }] }), 'new_cut'],
    ['an Olumi-estimated target whose sampled spread is floor-bound (0.15 × 0.4 < 0.1) would move', small({ y: { observed_state: { value: 0.4, raw_value: 40, cap: 100, source: 'cee_inference' } } }), 'spread_would_move'],
    ['a real std that the move would carry below PLoT\'s 1e-4 floor', small({ y: { observed_state: { value: 0.4, raw_value: 40, cap: 100, source: 'cee_inference', std: 3e-4 } } }), 'spread_would_move'],
  ])('%s', (_why, g, reason) => {
    const r = refitFramesForStatedEffects(g);
    expect(r.refits).toEqual([]);
    expect(r.refused.map((x) => x.reason)).toEqual([reason]);
    expect(r.graph).toEqual(g);
  });
  it('the new cut is named', () => {
    const g = small({ extraNodes: [{ id: 'z', kind: 'factor', label: 'Z', observed_state: { value: 0.5, raw_value: 5, cap: 10, source: 'brief_extraction' } }],
      extraEdges: [{ from: 'y', to: 'z', strength: { mean: 0.3, std: 0.1 }, provenance: { source: 'cee_hypothesis' } }] });
    expect(refitFramesForStatedEffects(g).refused).toEqual([{ link: 'x→y', reason: 'new_cut', detail: 'y→z' }]);
  });
});

describe('accepted on a factor target, and the no-op', () => {
  it('a user-stated target (sent exact on any frame) widens 100 → 500; the oracle is empty; a real std is carried', () => {
    const before = small({ y: { observed_state: { value: 0.4, raw_value: 40, cap: 100, source: 'brief_extraction', std: 0.2 } } });
    const r = refitFramesForStatedEffects(before);
    expect(r.refits).toEqual([{ node: 'y', from: 100, to: 500, for_link: 'x→y' }]);
    expect(frameInvariance(before, r.graph)).toEqual([]);
    expect(node(r.graph, 'y').observed_state.std).toBeCloseTo(0.04, 12);
  });
  it('NO-OP: a graph with no user-stated cut is returned as it is; a DEFAULT link over 1 is not this rule\'s (not the user\'s size)', () => {
    const g = small();
    g.edges[0] = { ...g.edges[0], strength: { mean: 0.6, std: 0.2 }, provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { amount: 0.6, per_source_change: 1, strength_mean: 0.6 } } };
    expect(refitFramesForStatedEffects(g)).toEqual({ graph: g, refits: [], refused: [] });
    const d = small();
    d.edges[0] = { ...d.edges[0], provenance: { source: 'cee_hypothesis' } };
    expect(refitFramesForStatedEffects(d).refits).toEqual([]);
  });
  it('niceFrameAtLeast: {1, 2, 5}·10^k at or above', () => {
    expect([490000, 500000, 150, 1, 10.5, 2e6].map(niceFrameAtLeast)).toEqual([500000, 500000, 200, 1, 20, 2e6]);
  });
});

// ⭐ DL 5897504696 / AIQ 5897383982: served MRR run 4 (`5f6b85e5`, CEE 57997d1), a FRESH draft. "£49 per subscriber" stated on a
// 106,250 MRR frame is β 2.31, so the Run clamped the user's effect and withheld the chance.
const RUN4 = JSON.parse(readFileSync(new URL('./fixtures/served-mrr-run4-5f6b85e5-registered-graph-57997d1.json', import.meta.url), 'utf8')) as Rec;
const beta = (g: Rec, from: string, to: string): number => (g.edges as Rec[]).find((e) => e.from === from && e.to === to)!.strength.mean;
describe('served MRR run 4 (fresh draft): the stated £49 per subscriber fits by widening MRR, every natural size held', () => {
  it('PRECONDITION: the served graph carries the out-of-contract stated link', () => {
    expect(beta(RUN4, 'paying_subscribers', 'mrr')).toBeCloseTo(2.3059, 3);
  });
  it('⭐ RED: MRR widened 106,250 → 500,000; the stated link is in contract; R3\'s oracle finds no violation', () => {
    const { graph, refits, refused } = refitFramesForStatedEffects(RUN4);
    expect(refused).toEqual([]);
    expect(refits).toEqual([{ node: 'mrr', from: 106250, to: 500000, for_link: 'paying_subscribers→mrr' }]);
    expect(Math.abs(beta(graph, 'paying_subscribers', 'mrr'))).toBeLessThanOrEqual(1);
    expect(frameInvariance(RUN4, graph)).toEqual([]);
  });
});

describe('bounded_scale (AIQ 5895590866 (1)): a bounded scale\'s top is never widened', () => {
  const g = (unit: string): Rec => ({
    nodes: [
      { id: 'sla', kind: 'factor', label: 'Support SLA', observed_state: { value: 0.5, raw_value: 12, unit: 'hours', cap: 24, source: 'brief_extraction' } },
      { id: 'csat', kind: 'goal', label: 'CSAT', goal_threshold_cap: 5, observed_state: { value: 0.8, baseline: 0.8, raw_value: 4, unit, cap: 5, source: 'brief_extraction' } },
    ],
    edges: [{ from: 'sla', to: 'csat', strength: { mean: 2, std: 0.2 }, provenance: { magnitude: 'user_stated' } }],
  });
  it('⭐ CSAT "out of 5" (β 2) → refused bounded_scale, the graph unchanged', () => {
    const r = refitFramesForStatedEffects(g('out of 5'));
    expect(r.refused).toEqual([{ link: 'sla→csat', reason: 'bounded_scale' }]);
    expect(r.refits).toEqual([]);
  });
  it('CONTROL: the same link on a money goal ("£/month") → widened', () => {
    expect(refitFramesForStatedEffects(g('£/month')).refits.map((x) => x.node)).toEqual(['csat']);
  });
});
