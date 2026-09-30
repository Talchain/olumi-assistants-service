/**
 * Shared Data closure row 1 (#72 5881225605, claim 5881253593): WHOSE a value is enters the analysis revision.
 *
 * `computeAnalysisAffectingGraphHash` MUST capture any field whose mutation would change analysis results
 * (`graph-hash.ts` header). Since R1 (schemas 0.61.0) the science reads `observed_state.source`: ISL derives whose
 * base/level it is from that literal, and CEE's per-limit verdict reads `level_olumi_estimate` from it. Live on served
 * f79119b (scenario 0938f068): churn 3.2% moved cee_inference → user_override with the value unchanged; the hash did not
 * move, the Run stayed `complete_current` with verdict `estimate_only`, and a rerun on the same hash gave `scored`.
 *
 * `unit`, `raw_value` and node `scale_frame` are analytical too (AIQ #72 5881494849): `level-limit-baseline.ts` reads
 * them into the PLoT wire (the relabelled-`%` wire unit; `percentLimitFrameProvable`, framed vs withheld).
 *
 * Contrast in the same file: a label, `extractionType` or `reviewed_by_user` change (never read by an analysis path)
 * still leaves the hash unchanged — this row must not pass by hashing everything.
 */
import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { CANONICAL_GRAPH_HASH_NESTED_PROJECTION, CANONICAL_GRAPH_HASH_PROJECTION_VERSION } from '@talchain/schemas/boundary';

function churnGraph(observed: Record<string, unknown>, label = 'Monthly churn'): GraphV3T {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'monthly_churn', kind: 'factor', label, observed_state: observed },
    ],
    edges: [
      { from: 'monthly_churn', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
    ],
  } as unknown as GraphV3T;
}

const olumis = { value: 0.032, raw_value: 3.2, unit: '%', source: 'cee_inference' };
const users = { value: 0.032, raw_value: 3.2, unit: '%', source: 'user_override' };

describe('analysis revision: whose value it is', () => {
  it('RED at f79119b: the same value becoming the user\'s moves the analysis hash', () => {
    expect(computeAnalysisAffectingGraphHash(churnGraph(users))).not.toBe(computeAnalysisAffectingGraphHash(churnGraph(olumis)));
  });

  it('a source that is absent differs from one that is present (absence is never read as a class)', () => {
    const { source: _s, ...unstamped } = olumis;
    expect(computeAnalysisAffectingGraphHash(churnGraph(unstamped))).not.toBe(computeAnalysisAffectingGraphHash(churnGraph(olumis)));
  });

  it('unit, raw_value and node scale_frame move the analysis hash (each decides the PLoT wire)', () => {
    const base = computeAnalysisAffectingGraphHash(churnGraph(olumis));
    expect(computeAnalysisAffectingGraphHash(churnGraph({ ...olumis, unit: '% per year' }))).not.toBe(base);
    expect(computeAnalysisAffectingGraphHash(churnGraph({ ...olumis, raw_value: 32 }))).not.toBe(base);
    const framed = churnGraph(olumis) as unknown as { nodes: Array<Record<string, unknown>> };
    framed.nodes[1]!.scale_frame = 100;
    expect(computeAnalysisAffectingGraphHash(framed as unknown as GraphV3T)).not.toBe(base);
  });

  it('CONTRAST: label, extractionType and the review record stay out (hash unchanged)', () => {
    const base = computeAnalysisAffectingGraphHash(churnGraph(olumis));
    expect(computeAnalysisAffectingGraphHash(churnGraph(olumis, 'Churn per month'))).toBe(base);
    expect(computeAnalysisAffectingGraphHash(churnGraph({ ...olumis, extractionType: 'explicit' }))).toBe(base);
    expect(computeAnalysisAffectingGraphHash(churnGraph({ ...olumis, reviewed_by_user: { intent: 'confirm', at: '2026-09-29T00:40:00.000Z' } }))).toBe(base);
  });
});

// ── The rest of the version-3 inputs (schemas 0.62.0; AIQ 5881600412 / 5881815357; R3 5881451910) ──────────────────

function goalGraph(goal: Record<string, unknown>, edgeProvenance?: Record<string, unknown>): GraphV3T {
  return {
    goal_node_id: 'goal',
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Monthly recurring revenue', ...goal },
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.5, source: 'user_specified' } },
    ],
    edges: [
      { from: 'price', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
        ...(edgeProvenance !== undefined ? { provenance: edgeProvenance } : {}) },
    ],
  } as unknown as GraphV3T;
}

const h = (g: GraphV3T) => computeAnalysisAffectingGraphHash(g);

describe('analysis revision: the DERIVED direction the run sends (AIQ 5881600412; R3 rows b/c)', () => {
  it('R3 (b): a held ">" goal renamed from growth to reduce moves the hash (the sent direction flips)', () => {
    expect(h(goalGraph({ goal_direction: '>', label: 'Reduce monthly costs' })))
      .not.toBe(h(goalGraph({ goal_direction: '>', label: 'Monthly recurring revenue' })));
  });

  it('R3 (c): a cosmetic rename that leaves the sent direction alone leaves the hash IDENTICAL', () => {
    expect(h(goalGraph({ goal_direction: '>', label: 'MRR (monthly)' })))
      .toBe(h(goalGraph({ goal_direction: '>', label: 'Monthly recurring revenue' })));
  });
});

describe('analysis revision: the other stored run inputs', () => {
  const base = h(goalGraph({}));

  it.each([
    ['goal_threshold_frame', { goal_threshold_frame: 'level' }],
    ['goal_direction (held comparator)', { goal_direction: '>=' }],
    ['quantity_frame', { quantity_frame: 'level' }],
    ['analysis_participation', { analysis_participation: 'retained_excluded' }],
  ])('%s moves the hash', (_name, extra) => {
    expect(h(goalGraph(extra))).not.toBe(base);
  });

  it('observed_state.std (a stated spread) moves the hash', () => {
    const g = goalGraph({}) as unknown as { nodes: Array<Record<string, unknown>> };
    (g.nodes[1]!.observed_state as Record<string, unknown>).std = 0.05;
    expect(h(g as unknown as GraphV3T)).not.toBe(base);
  });

  it('edge provenance source / magnitude / natural_effect.amount_unit move the hash; reasoning and amount do not', () => {
    const effect = { amount: 500, amount_unit: 'GBP', per_source_change: 1, per_source_change_unit: 'GBP', strength_mean: 0.4, strength_mean_frame: 'edge_strength' };
    const placeholder = h(goalGraph({}, { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', natural_effect: effect }));
    expect(h(goalGraph({}, { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: effect }))).not.toBe(placeholder);
    expect(h(goalGraph({}, { source: 'user_specified', magnitude: 'olumi_placeholder', natural_effect: effect }))).not.toBe(placeholder);
    expect(h(goalGraph({}, { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', natural_effect: { ...effect, amount_unit: '%' } }))).not.toBe(placeholder);
    // CONTRAST: display members stay out.
    expect(h(goalGraph({}, { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', natural_effect: { ...effect, amount: 600 }, reasoning: 'why' }))).toBe(placeholder);
  });
});

// ── DERIVED FROM THE PUBLISHED VOCABULARY (schemas 0.62.0), not a hand list: every field it names moves the hash ────
describe('every field the published hash vocabulary names moves the analysis hash', () => {
  const V = CANONICAL_GRAPH_HASH_NESTED_PROJECTION;
  const baseGraph = (): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } => ({
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 0.5 } },
    ],
    edges: [{ from: 'f', to: 'goal', strength: { mean: 0.4, std: 0.1 }, provenance: { source: 'cee_hypothesis', natural_effect: {} } }],
  });
  const hashOf = (g: unknown) => computeAnalysisAffectingGraphHash(g as GraphV3T);
  const base = hashOf(baseGraph());

  it('POSITIVE CONTROL: the vendored vocabulary is v5 (v4 + intervention `range`, 0.66.0) — node/edge lists read from it; `projectIntervention` hand-lists its fields, so `range` is hashed only once TEMPORAL #2382 lands', () => {
    expect(CANONICAL_GRAPH_HASH_PROJECTION_VERSION).toBe(5);
    expect(V.node.fields.length).toBeGreaterThan(10);
  });
  it.each(V.node.fields.filter((f) => f !== 'id' && f !== 'kind'))('node.%s', (field) => {
    const g = baseGraph();
    g.nodes[1]![field] = 'probe';
    expect(hashOf(g)).not.toBe(base);
  });
  it.each(V.node.observed_state_fields.filter((f) => f !== 'value'))('node.observed_state.%s', (field) => {
    const g = baseGraph();
    (g.nodes[1]!.observed_state as Record<string, unknown>)[field] = 'probe';
    expect(hashOf(g)).not.toBe(base);
  });
  it.each(V.edge.fields.filter((f) => f !== 'from' && f !== 'to'))('edge.%s', (field) => {
    const g = baseGraph();
    g.edges[0]![field] = 'probe';
    expect(hashOf(g)).not.toBe(base);
  });
  it.each(V.edge.provenance_fields)('edge.provenance.%s', (field) => {
    const g = baseGraph();
    (g.edges[0]!.provenance as Record<string, unknown>)[field] = 'probe';
    expect(hashOf(g)).not.toBe(base);
  });
  it.each(V.edge.provenance_natural_effect_fields)('edge.provenance.natural_effect.%s', (field) => {
    const g = baseGraph();
    ((g.edges[0]!.provenance as Record<string, unknown>).natural_effect as Record<string, unknown>)[field] = 'probe';
    expect(hashOf(g)).not.toBe(base);
  });
});
