/**
 * `structural_add_edge` — the writer, pinned at the adapter seam.
 *
 * ⭐ THE TWO DIRECTIONS THIS FILE IS WRITTEN IN, mirroring its `structural_add`
 * sibling because the failure classes are the same shape:
 *
 *   A. THE ADD DOES NOT LAND      → the user's connection vanishes on reload,
 *                                   which is the exact silent loss the writer
 *                                   exists to close.
 *   B. THE ADD INVENTS SOMETHING  → a strength, a direction or a confidence the
 *                                   user never gave, presented as their model.
 *
 * ⚠ B IS THE SUBTLE ONE HERE. The wire carries `magnitude` and
 * `effect_direction` and NOTHING else; `EdgeV3Schema` requires `strength.std`
 * and `exists_probability`, so the server MUST supply two numbers the user did
 * not state. The rule is not "supply nothing" — that would fail validation. It
 * is that the two server-owned fields must be the CANONICAL CONSTANTS, so they
 * remain recognisable as defaults, and must not be dressed up as user facts.
 *
 * ⚠ AND THE ASSERTIONS ARE WRITTEN AGAINST THE CONSTANTS BY REFERENCE, never
 * against `0.8` and `0.1` as literals (CLAUDE.md trap 13d). A test that hard-codes
 * the numbers passes just as happily when someone hand-rolls the same values in
 * the writer — which is the drift the constants exist to prevent.
 */
import { describe, it, expect } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { DEFAULT_EXISTS_PROBABILITY, DEFAULT_STD } from '@talchain/schemas';

import {
  applyStructuralAddEdge,
  signedMeanFor,
  InvalidPersistedAddEdgeGraphError,
  type StructuralAddEdgeResult,
} from '../structural-add-edge.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../../graph-management/reason-codes.js';

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';

function persistedGraph(): Record<string, unknown> {
  return {
    schema_version: '3.0',
    goal_node_id: 'goal_revenue',
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Grow revenue' },
      {
        id: 'fac_price',
        kind: 'factor',
        label: 'Unit price',
        category: 'controllable',
        observed_state: { value: 0.4, raw_value: 40000, cap: 100000 },
      },
      { id: 'fac_churn', kind: 'factor', label: 'Customer churn', category: 'observable' },
      {
        id: 'opt_launch',
        kind: 'option',
        label: 'Launch now',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
    ],
    edges: [
      {
        from: 'opt_launch',
        to: 'fac_price',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
    options: [
      {
        id: 'opt_launch',
        label: 'Launch now',
        status: 'ready',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
    ],
    meta: { roots: ['opt_launch'], leaves: ['goal_revenue'] },
  };
}

function baseHashOf(graph: unknown): string {
  const hash = computeAnalysisAffectingGraphHash(
    graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (hash === null) throw new Error('fixture is unhashable — the fixture is wrong, not the code');
  return hash;
}

function run(
  overrides: Record<string, unknown> = {},
  graph: unknown = persistedGraph(),
): StructuralAddEdgeResult {
  const event = {
    kind: 'structural_add_edge' as const,
    from: 'fac_churn',
    to: 'goal_revenue',
    magnitude: 0.7,
    effect_direction: 'negative',
    base_graph_hash: baseHashOf(persistedGraph()),
    ...overrides,
  };
  const payload = {
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    event,
  } as unknown as SystemEventTurnPayload;
  return applyStructuralAddEdge({
    payload,
    event: event as never,
    requestId: 'req-add-edge',
    persistedGraph: graph,
  });
}

const landedEdge = (r: StructuralAddEdgeResult, from: string, to: string) => {
  if (r.kind !== 'mutated') throw new Error(`expected a mutation, got refused: ${r.reason}`);
  const e = r.graph.edges.find((x) => x.from === from && x.to === to);
  if (!e) throw new Error(`the edge ${from} → ${to} is absent from the persisted bytes`);
  return e;
};

describe('A — the connection lands, and lands unaltered', () => {
  it('writes the edge into the persisted bytes', () => {
    const edge = landedEdge(run(), 'fac_churn', 'goal_revenue');
    expect(edge.effect_direction).toBe('negative');
  })

  it('applies the sign from the SEPARATE direction field, not from the magnitude', () => {
    // The wire carries an unsigned magnitude precisely so a strength change
    // cannot reverse an edge by accident. This is the pair that proves the two
    // are combined in exactly one place and in the right order.
    expect(landedEdge(run({ effect_direction: 'negative' }), 'fac_churn', 'goal_revenue').strength.mean).toBe(-0.7)
    expect(landedEdge(run({ effect_direction: 'positive' }), 'fac_churn', 'goal_revenue').strength.mean).toBe(0.7)
  })

  it('signedMeanFor ignores an already-signed magnitude rather than double-negating', () => {
    // A defensive property, and a real hazard: the canvas holds an unsigned
    // weight but several producers hold a signed mean. A writer that multiplied
    // instead of taking the absolute value would silently flip those.
    expect(signedMeanFor(-0.7, 'negative')).toBe(-0.7)
    expect(signedMeanFor(-0.7, 'positive')).toBe(0.7)
  })

  it('changes exactly one edge and no nodes', () => {
    const before = persistedGraph()
    const r = run()
    if (r.kind !== 'mutated') throw new Error('expected a mutation')
    expect(r.graph.edges).toHaveLength((before.edges as unknown[]).length + 1)
    expect(r.graph.nodes).toHaveLength((before.nodes as unknown[]).length)
  })

  it('does not disturb the edges that were already there', () => {
    const r = run()
    if (r.kind !== 'mutated') throw new Error('expected a mutation')
    const untouched = r.graph.edges.find((e) => e.from === 'fac_price' && e.to === 'goal_revenue')
    expect(untouched?.strength.mean).toBe(0.5)
    expect(untouched?.exists_probability).toBe(0.9)
  })
})

describe('B — nothing is invented', () => {
  /**
   * ⭐⭐ THE HONESTY ARM. The user stated a magnitude and a direction. They
   * stated NOTHING about how likely the link is to exist or how uncertain its
   * strength is, and `EdgeV3Schema` requires both — so the server must supply
   * two numbers. They must be the canonical constants, asserted BY REFERENCE so
   * a hand-rolled duplicate of the same value still reds.
   */
  it('uses the canonical server-owned defaults, by reference', () => {
    const edge = landedEdge(run(), 'fac_churn', 'goal_revenue')
    expect(edge.exists_probability).toBe(DEFAULT_EXISTS_PROBABILITY)
    expect(edge.strength.std).toBe(DEFAULT_STD)
  })

  it('does NOT borrow the structural-edge certainty', () => {
    // STRUCTURAL_EDGE_DEFAULTS is 1.0 / mean 1.0 / std 0.01 and is for topology
    // edges, which "represent graph topology, not causal beliefs". An edge a
    // user draws is a causal belief, so certainty here would be invented.
    const edge = landedEdge(run(), 'fac_churn', 'goal_revenue')
    expect(edge.exists_probability).not.toBe(1.0)
    expect(edge.strength.std).not.toBe(0.01)
  })

  it('writes no provenance claiming a person supplied the server-owned fields', () => {
    const edge = landedEdge(run(), 'fac_churn', 'goal_revenue') as Record<string, unknown>
    for (const key of ['exists_probability_source', 'strength_std_source', 'beliefExistsSource']) {
      expect(edge[key], `${key} was stamped on a defaulted value`).toBeUndefined()
    }
  })
})

describe('the gates', () => {
  it('refuses a diverged base hash, and hands back the server one', () => {
    const r = run({ base_graph_hash: 'sha256:' + '0'.repeat(64) })
    expect(r.kind).toBe('refused')
    if (r.kind !== 'refused') return
    expect(r.reason).toBe(BASE_HASH_DIVERGED)
    expect(r.baseHashConflict?.expected_base_graph_hash).toBe(baseHashOf(persistedGraph()))
  })

  it('refuses an unresolvable SOURCE rather than creating a dangling edge', () => {
    const r = run({ from: 'fac_does_not_exist' })
    expect(r.kind).toBe('refused')
    if (r.kind === 'refused') expect(r.reason).toBe('endpoint_unresolved')
  })

  it('refuses an unresolvable TARGET too — the twin, so neither half is unguarded', () => {
    const r = run({ to: 'goal_does_not_exist' })
    expect(r.kind).toBe('refused')
    if (r.kind === 'refused') expect(r.reason).toBe('endpoint_unresolved')
  })

  it('refuses a duplicate, which the base hash provably cannot catch', () => {
    // The edge is already present in the very graph the user was looking at, so
    // the hash is perfectly fresh and the add would still be destructive.
    const r = run({ from: 'fac_price', to: 'goal_revenue' })
    expect(r.kind).toBe('refused')
    if (r.kind !== 'refused') return
    expect(r.reason).toBe('edge_already_exists')
    // The sentence must be followable, which is the whole reason this gate is
    // pre-checked rather than left to the applier's generic error.
    expect(r.response.assistant_text).toContain('Unit price')
    expect(r.response.assistant_text).toContain('Grow revenue')
  })

  it('refuses when there is no saved model at all', () => {
    const r = run({}, null)
    expect(r.kind).toBe('refused')
    if (r.kind === 'refused') expect(r.reason).toBe('no_persisted_graph')
  })

  it('THROWS on a malformed persisted graph — corruption is not absence', () => {
    expect(() => run({}, { nodes: 'not-an-array' })).toThrow(InvalidPersistedAddEdgeGraphError)
  })

  /**
   * ⚠ DERIVED FROM THE CONTRACT, NOT FROM TASTE. `EdgeV3Schema` permits
   * self-edges and no endpoint-addressed member forbids them, so refusing one
   * here "would encode a MODELLING opinion the graph contract does not hold".
   */
  it('does NOT refuse a self-edge', () => {
    const r = run({ from: 'fac_churn', to: 'fac_churn' })
    expect(r.kind).toBe('mutated')
  })
})

describe('the receipt', () => {
  it('validates against its own contract', () => {
    const r = run()
    if (r.kind !== 'mutated') throw new Error('expected a mutation')
    expect(r.handlerFacts).toHaveLength(1)
    expect(EditGraphHandlerFactSchema.safeParse(r.handlerFacts[0]).success).toBe(true)
  })

  it('records the hash moving, and asks for a re-run', () => {
    const r = run()
    if (r.kind !== 'mutated') throw new Error('expected a mutation')
    const result = (r.handlerFacts[0] as { result: Record<string, unknown> }).result
    expect(result.graph_hash_before).toBe(baseHashOf(persistedGraph()))
    expect(result.graph_hash_after).not.toBe(result.graph_hash_before)
    expect(result.rerun_recommended).toBe(true)
    // 'high', not the node sibling's 'moderate': an edge IS a causal path, so it
    // changes what the analysis follows rather than only what the model contains.
    expect(result.impact).toBe('high')
  })

  it('names both ends in a form a person recognises', () => {
    const r = run()
    if (r.kind !== 'mutated') throw new Error('expected a mutation')
    const result = (r.handlerFacts[0] as { result: Record<string, unknown> }).result
    expect(result.safe_summary).toContain('Customer churn')
    expect(result.safe_summary).toContain('Grow revenue')
  })
})
