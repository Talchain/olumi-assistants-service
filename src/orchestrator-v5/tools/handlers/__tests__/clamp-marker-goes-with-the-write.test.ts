/**
 * ⭐ A CLAMP MARKER SPEAKS ONLY FOR THE STORED SIZE IT WAS WRITTEN WITH (CODEX #75 5925312387 on #2428).
 *
 * `clampForPersist` stores a link no refit can fit at ±1 with `provenance.clamped_from` = the user's full β, and
 * `withStatedStrengths` sends that β to PLoT. CODEX measured two defects:
 *  1. through the REAL `adjust_edge_strength` writer, 1 → 0.3 → 1 (two user edits, no Run between) kept the marker,
 *     so the wire sent 3 instead of the author's 1;
 *  2. ±1.0000000005 was left above the strict [-1, 1] ingress bound, so the model refused every later write.
 * A real strength or size write takes the marker with the old size; a review (confirm) keeps it.
 */
import { describe, expect, it } from 'vitest';

import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import { assertIngressGraphNumericBounds } from '../../../../validators/numeric-bounds.js';
import { clampForPersist, withStatedStrengths } from '../../../agent-lane/refit-frames.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';

type Rec = Record<string, any>;
const SCENARIO_ID = '33333333-3333-4333-8333-333333333334';
const FROM = 'fac_price';
const TO = 'goal_1';
const FULL = 3;

/** The stored shape `clampForPersist` writes for the user's stated β = 3 (served c96fc4bb class). */
function clampedGraph(): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Pricing decision' },
      { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 10, source: 'cee_inference' } },
      { id: 'opt_a', kind: 'option', label: 'Raise price', interventions: { fac_price: { value: 12, source: 'brief_extraction' } } },
      { id: 'opt_b', kind: 'option', label: 'Hold price', interventions: { fac_price: { value: 9, source: 'brief_extraction' } } },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
      { from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
      {
        from: FROM, to: TO, strength: { mean: 1, std: 0.05 }, exists_probability: 0.9, effect_direction: 'positive',
        provenance: { source: 'user_specified', magnitude: 'user_stated', clamped_from: FULL, natural_effect: { amount: 300, amount_unit: '£', per_source_change: 1, per_source_change_unit: '£', strength_mean: FULL, strength_mean_frame: 'edge_strength' } },
        provenance_display: 'user_set',
      },
      { from: 'opt_a', to: 'fac_price', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'brief_extraction' } },
      { from: 'opt_b', to: 'fac_price', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'brief_extraction' } },
    ],
  });
}

function proposal(strength: number): ProposalAction {
  return {
    handler_id: 'adjust_edge_strength',
    entity: { id: `${FROM}→${TO}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'strength', value: strength, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  };
}

/** The Agent's REAL writer, as `confirm-is-review-not-authorship.test.ts` drives it. */
function invocationFor(graph: unknown, strength: number, replaces: boolean): HandlerInvocation {
  return {
    context: { session_id: SCENARIO_ID, stage: 'frame', request_id: 'req-clamp', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: { kind: 'message', scenario_id: SCENARIO_ID, turn_id: '11111111-1111-4111-8111-111111111399', stage: 'frame', message: 'set the link' },
    requestId: 'req-clamp',
    signal: new AbortController().signal,
    orientationText: '',
    proposal: proposal(strength),
    graphForTurn: graph,
    // ⭐ F1 (#87 6006627551): moving a link that holds the user's own figure needs their explicit replace.
    ...(replaces ? { edgeStrengthReplacesUserFigureAuthority: true } : {}),
  } as unknown as HandlerInvocation;
}

async function handlerSet(graph: unknown, strength: number, replaces = false): Promise<GraphV3T> {
  const outcome = await createAdjustEdgeStrengthHandler()(invocationFor(graph, strength, replaces));
  expect(outcome.mutated_graph, JSON.stringify(outcome).slice(0, 300)).toBeDefined();
  return outcome.mutated_graph as GraphV3T;
}

const edgeOf = (g: unknown): Rec => (g as Rec).edges.find((e: Rec) => e.from === FROM && e.to === TO);
const sent = (g: unknown): number => edgeOf(withStatedStrengths(g)).strength.mean;

describe('a clamp marker goes with the stored size it was written for', () => {
  it('control: the untouched clamp (natural size kept through the strict parse) still sends the user\'s full β', () => {
    expect(edgeOf(clampedGraph()).provenance.natural_effect?.strength_mean).toBe(FULL);
    expect(sent(clampedGraph())).toBe(FULL);
  });

  // ⭐ F1: the stored link holds the user's own (clamped) figure, so the first move is their explicit replace.
  it('RED (CODEX 1): 1 → 0.3 → 1 through the REAL writer sends the author\'s 1, never the old 3', async () => {
    const once = await handlerSet(clampedGraph(), 0.3, true);
    expect(edgeOf(once).provenance).not.toHaveProperty('clamped_from');
    const twice = await handlerSet(once, 1);
    expect(edgeOf(twice).strength.mean).toBe(1);
    expect(sent(twice)).toBe(1);
  });

  it('⭐ F1: without the user\'s replace, the clamped figure is theirs and a move is refused — nothing written', async () => {
    const graph = clampedGraph();
    const before = structuredClone(graph);
    await expect(createAdjustEdgeStrengthHandler()(invocationFor(graph, 0.3, false))).rejects.toMatchObject({
      details: { reason: 'user_figure_held' },
    });
    expect(graph).toStrictEqual(before);
  });

  it('a REVIEW (a set to the value already stored) changes nothing the user authored: the marker stays and still speaks', async () => {
    const reviewed = await handlerSet(clampedGraph(), 1);
    expect(edgeOf(reviewed).provenance.reviewed_by_user?.intent).toBe('confirm');
    expect(edgeOf(reviewed).provenance.clamped_from).toBe(FULL);
    expect(sent(reviewed)).toBe(FULL);
  });

  it('backstop: a marker whose natural size is gone (any writer that dropped it) is stale — the stored ±1 is sent', () => {
    const g = clampedGraph() as Rec;
    delete edgeOf(g).provenance.natural_effect;
    expect(sent(g)).toBe(1);
  });
});

describe('clamp at persist meets the EXACT ingress bound (CODEX 2)', () => {
  for (const mean of [1.0000000005, -1.0000000005]) {
    it(`RED: ${mean} is stored inside [-1, 1] and the model stays writable`, () => {
      const g = clampedGraph() as Rec;
      edgeOf(g).strength = { mean, std: 0.05 };
      delete edgeOf(g).provenance.clamped_from;
      const stored = clampForPersist(g);
      expect(Math.abs(edgeOf(stored).strength.mean)).toBe(1);
      expect(edgeOf(stored).provenance, 'rounding noise is not a cut').not.toHaveProperty('clamped_from');
      expect(assertIngressGraphNumericBounds(stored).ok).toBe(true);
    });
  }
});
