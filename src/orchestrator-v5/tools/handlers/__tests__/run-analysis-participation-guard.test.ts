import { describe, it, expect } from 'vitest';
import { guardAnalysisParticipation } from '../run-analysis-participation-guard.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

/**
 * COLLAB Track A — the participation guard at the analysis boundary.
 *
 * The user outcome under test, in one sentence: a person keeps a contribution
 * in their model, deliberately excluded from the calculation, and it is STILL
 * THERE — and still excluded — when they come back.
 *
 * ⚠ EVERY ASSERTION BINDS BY NODE ID, never by a value predicate another node
 * could satisfy. The fixtures below deliberately give two nodes the SAME value
 * and overlapping labels, so a test that found its node by value would pass on
 * the wrong object.
 */

const strength = { mean: 0.4, std: 0.1 };

/** A graph with one excluded factor, one ordinary factor, and a goal. */
function fixture(): Record<string, unknown> {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'factor_kept',
        kind: 'factor',
        label: 'Team morale',
        // Same value as the excluded node below — so an assertion that looked
        // for "the node whose value is 42" could bind to either.
        observed_state: { value: 42, unit: 'count' },
      },
      {
        id: 'factor_excluded',
        kind: 'factor',
        label: 'Team morale (my estimate)',
        observed_state: { value: 42, unit: 'count' },
        analysis_participation: 'retained_excluded',
      },
    ],
    edges: [
      { from: 'factor_kept', to: 'goal_revenue', strength, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'factor_excluded', to: 'goal_revenue', strength, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'factor_kept', to: 'factor_excluded', strength, exists_probability: 0.8, effect_direction: 'positive' },
    ],
  };
}

const nodeIds = (g: unknown): string[] =>
  ((g as { nodes: Array<{ id: string }> }).nodes ?? []).map((n) => n.id);
const edgePairs = (g: unknown): string[] =>
  ((g as { edges: Array<{ from: string; to: string }> }).edges ?? []).map((e) => `${e.from}->${e.to}`);
const byId = (g: unknown, id: string): Record<string, unknown> | undefined =>
  ((g as { nodes: Array<Record<string, unknown>> }).nodes ?? []).find((n) => n.id === id);

describe('run_analysis participation guard — the calculation input', () => {
  it('withholds a retained_excluded node from the calculation input', () => {
    const input = fixture();
    const result = guardAnalysisParticipation(input, { goalNodeId: 'goal_revenue' });

    expect(result.excludedNodeIds).toEqual(['factor_excluded']);
    // Bound by id: the excluded node is gone, the kept one is NOT.
    expect(nodeIds(result.graph)).toEqual(['goal_revenue', 'factor_kept']);
    expect(byId(result.graph, 'factor_excluded')).toBeUndefined();
    expect(byId(result.graph, 'factor_kept')).toBeDefined();
  });

  /**
   * MEASURED, not assumed: PLoT's `/v2/run` preflight raises
   * `INVALID_EDGE_ENDPOINT` through `createBlocker` (preflight-v2.ts
   * `validateEdgeEndpoints`) for an edge naming a node that is not in
   * `graph.nodes`. A blocker refuses the whole run, so an unpruned edge would
   * not degrade the analysis — it would destroy it.
   */
  it('prunes every edge incident to the withheld node, in both directions', () => {
    const result = guardAnalysisParticipation(fixture(), { goalNodeId: 'goal_revenue' });

    expect(edgePairs(result.graph)).toEqual(['factor_kept->goal_revenue']);
    expect(result.prunedEdgeCount).toBe(2);

    // The claim that matters to PLoT, stated as PLoT states it: no edge may
    // name an endpoint that is not in nodes.
    const ids = new Set(nodeIds(result.graph));
    for (const e of (result.graph as { edges: Array<{ from: string; to: string }> }).edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('leaves the input graph untouched — the node is still there when they come back', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = guardAnalysisParticipation(input, { goalNodeId: 'goal_revenue' });

    expect(JSON.stringify(input)).toBe(before);
    // And it is a genuinely different object, not the same one handed back.
    expect(result.graph).not.toBe(input);

    const retained = byId(input, 'factor_excluded');
    expect(retained?.label).toBe('Team morale (my estimate)');
    expect(retained?.observed_state).toEqual({ value: 42, unit: 'count' });
    expect(retained?.analysis_participation).toBe('retained_excluded');
  });

  it('survives a GraphV3.safeParse round-trip with the value, label and exclusion intact', () => {
    const input = fixture();
    const parsed = GraphV3.safeParse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const roundTripped = parsed.data as unknown as Record<string, unknown>;
    const node = byId(roundTripped, 'factor_excluded');
    expect(node?.analysis_participation).toBe('retained_excluded');
    expect(node?.label).toBe('Team morale (my estimate)');
    expect(node?.observed_state).toEqual({ value: 42, unit: 'count' });

    // And the guard reaches the same verdict on the PARSED graph as on the raw
    // one — the seam is end-to-end, not a property of the literal fixture.
    const result = guardAnalysisParticipation(roundTripped, { goalNodeId: 'goal_revenue' });
    expect(result.excludedNodeIds).toEqual(['factor_excluded']);
  });
});

describe('run_analysis participation guard — absence is not a claim', () => {
  /**
   * The load-bearing negative. 182,015 persisted nodes carry no field; a guard
   * that excluded on "not 'included'" would drop every one of them from its
   * owner's analysis, and the suite would still be green on the case above.
   */
  it('keeps an unstamped node in the calculation', () => {
    const graph = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'factor_unstamped', kind: 'factor', label: 'No field at all' },
      ],
      edges: [],
    };
    const result = guardAnalysisParticipation(graph, { goalNodeId: 'goal_revenue' });

    expect(result.excludedNodeIds).toEqual([]);
    expect(nodeIds(result.graph)).toContain('factor_unstamped');
    // Nothing to do ⇒ the very same object, no clone cost on the common graph.
    expect(result.graph).toBe(graph);
  });

  it("keeps an explicitly 'included' node in the calculation", () => {
    const graph = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'factor_in', kind: 'factor', label: 'In', analysis_participation: 'included' },
      ],
      edges: [],
    };
    const result = guardAnalysisParticipation(graph, { goalNodeId: 'goal_revenue' });
    expect(result.excludedNodeIds).toEqual([]);
    expect(nodeIds(result.graph)).toContain('factor_in');
  });

  /**
   * An unrecognised value is not an exclusion claim. `NodeV3` refuses one at
   * the parse, but this guard reads raw persisted shapes too, so the predicate
   * is pinned here at the producer rather than assumed from the schema.
   */
  it('keeps a node carrying an unrecognised participation value', () => {
    const graph = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'factor_weird', kind: 'factor', label: 'Weird', analysis_participation: 'excluded' },
        { id: 'factor_null', kind: 'factor', label: 'Null', analysis_participation: null },
      ],
      edges: [],
    };
    const result = guardAnalysisParticipation(graph, { goalNodeId: 'goal_revenue' });

    expect(result.excludedNodeIds).toEqual([]);
    expect(nodeIds(result.graph)).toEqual(['goal_revenue', 'factor_weird', 'factor_null']);
  });
});

describe('run_analysis participation guard — exclusions it must refuse', () => {
  it('refuses to withhold the goal node, and withholds nothing', () => {
    const graph = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue', analysis_participation: 'retained_excluded' },
        { id: 'factor_kept', kind: 'factor', label: 'Kept' },
      ],
      edges: [],
    };
    const result = guardAnalysisParticipation(graph, { goalNodeId: 'goal_revenue' });

    expect(result.refusals).toEqual([{ node_id: 'goal_revenue', reason: 'goal_node' }]);
    expect(result.excludedNodeIds).toEqual([]);
    expect(nodeIds(result.graph)).toContain('goal_revenue');
  });

  it("refuses to withhold a factor one of the run's options intervenes on", () => {
    const graph = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'factor_target', kind: 'factor', label: 'Hiring rate', analysis_participation: 'retained_excluded' },
      ],
      edges: [],
    };
    const result = guardAnalysisParticipation(graph, {
      goalNodeId: 'goal_revenue',
      optionInterventionTargetIds: ['factor_target'],
    });

    expect(result.refusals).toEqual([
      { node_id: 'factor_target', reason: 'option_intervention_target' },
    ]);
    expect(result.excludedNodeIds).toEqual([]);

    // DISCRIMINATING TWIN: the identical graph with the option pointed at a
    // DIFFERENT factor is honoured. Without this, the case above would pass on
    // a guard that simply refused every exclusion.
    const elsewhere = guardAnalysisParticipation(graph, {
      goalNodeId: 'goal_revenue',
      optionInterventionTargetIds: ['factor_something_else'],
    });
    expect(elsewhere.refusals).toEqual([]);
    expect(elsewhere.excludedNodeIds).toEqual(['factor_target']);
  });

  it('refuses to withhold a node that is one of the options being compared', () => {
    const graph = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'option_a', kind: 'option', label: 'Option A', analysis_participation: 'retained_excluded' },
      ],
      edges: [],
    };
    const result = guardAnalysisParticipation(graph, {
      goalNodeId: 'goal_revenue',
      submittedOptionIds: ['option_a'],
    });

    expect(result.refusals).toEqual([{ node_id: 'option_a', reason: 'submitted_option' }]);
    expect(result.excludedNodeIds).toEqual([]);

    // DISCRIMINATING TWIN: the same option node, not submitted on this run.
    const notSubmitted = guardAnalysisParticipation(graph, {
      goalNodeId: 'goal_revenue',
      submittedOptionIds: ['option_b'],
    });
    expect(notSubmitted.refusals).toEqual([]);
    expect(notSubmitted.excludedNodeIds).toEqual(['option_a']);
  });
});
