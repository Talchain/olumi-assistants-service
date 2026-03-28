/**
 * TurnContext Builder Tests
 */

import { describe, it, expect } from "vitest";
import { computeTurnContext, buildEntityRegistry } from "../../../../src/orchestrator/deterministic/turn-context.js";
import type { OrchestratorTurnRequest, V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeGraph(overrides: Partial<{ nodes: unknown[]; edges: unknown[] }> = {}): unknown {
  return {
    nodes: overrides.nodes ?? [
      { id: 'goal_1', kind: 'goal', label: 'Maximise ROI' },
      { id: 'factor_revenue', kind: 'factor', label: 'Revenue', observed_state: { value: 100000, unit: 'GBP', extractionType: 'explicit' } },
      { id: 'factor_cost', kind: 'factor', label: 'Cost', observed_state: { value: 50000, unit: 'GBP', extractionType: 'inferred' } },
      { id: 'option_a', kind: 'option', label: 'Option A' },
      { id: 'option_b', kind: 'option', label: 'Option B' },
    ],
    edges: overrides.edges ?? [
      { from: 'factor_revenue', to: 'goal_1', strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'factor_cost', to: 'goal_1', strength: { mean: -0.5, std: 0.15 }, exists_probability: 0.8, effect_direction: 'negative' },
      { from: 'option_a', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'option_b', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
    ],
    options: [],
    goal_node_id: 'goal_1',
  };
}

function makeAnalysis(overrides: Partial<V2RunResponseEnvelope> = {}): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 10000, response_hash: 'abc123' },
    results: overrides.results ?? [
      { option_label: 'Option A', win_probability: 0.62 },
      { option_label: 'Option B', win_probability: 0.38 },
    ],
    robustness: overrides.robustness ?? { level: 'moderate' },
    factor_sensitivity: overrides.factor_sensitivity ?? [
      { label: 'Revenue', factor_id: 'factor_revenue', elasticity: 0.8, direction: 'positive' },
      { label: 'Cost', factor_id: 'factor_cost', elasticity: 0.3, direction: 'negative' },
    ],
    ...(overrides as Record<string, unknown>),
  } as V2RunResponseEnvelope;
}

function makeTurnRequest(overrides: Partial<{
  graph: unknown;
  analysis: unknown;
  message: string;
}> = {}): OrchestratorTurnRequest {
  return {
    message: overrides.message ?? 'What should I do?',
    context: {
      graph: (overrides.graph as GraphV3T | null) ?? null,
      analysis_response: (overrides.analysis as V2RunResponseEnvelope | null) ?? null,
      framing: { stage: 'evaluate' as const },
      messages: [],
      scenario_id: 'test-scenario',
    },
    scenario_id: 'test-scenario',
    client_turn_id: 'test-turn-1',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('computeTurnContext', () => {
  it('populates all fields with graph + analysis', () => {
    const req = makeTurnRequest({ graph: makeGraph(), analysis: makeAnalysis() });
    const ctx = computeTurnContext(req);

    expect(ctx.stage).toBeDefined();
    expect(ctx.entities.nodes.size).toBe(5);
    expect(ctx.entities.edges.length).toBe(4);
    expect(ctx.entities.option_ids).toEqual(['option_a', 'option_b']);
    expect(ctx.entities.goal_id).toBe('goal_1');
    expect(ctx.graph_summary.node_count).toBe(5);
    expect(ctx.graph_summary.edge_count).toBe(4);
    expect(ctx.graph_summary.option_count).toBe(2);
    expect(ctx.graph_summary.goal_label).toBe('Maximise ROI');
    expect(ctx.graph_summary.missing_structural).toBe(false);
    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.winner).toBe('Option A');
    expect(ctx.analysis_summary!.winner_probability).toBeCloseTo(0.62);
    expect(ctx.analysis_summary!.top_drivers.length).toBeGreaterThan(0);
    expect(ctx.capabilities.can_run_analysis).toBe(true);
    expect(ctx.capabilities.can_explain_results).toBe(true);
    expect(ctx.eligible_actions.length).toBeGreaterThan(0);
  });

  it('handles empty graph', () => {
    const req = makeTurnRequest();
    const ctx = computeTurnContext(req);

    expect(ctx.entities.nodes.size).toBe(0);
    expect(ctx.graph_summary.node_count).toBe(0);
    expect(ctx.graph_summary.missing_structural).toBe(true);
    expect(ctx.analysis_summary).toBeNull();
    expect(ctx.capabilities.can_run_analysis).toBe(false);
    expect(ctx.capabilities.can_explain_results).toBe(false);
    expect(ctx.blockers.length).toBeGreaterThan(0);
  });

  it('handles graph without analysis', () => {
    const req = makeTurnRequest({ graph: makeGraph() });
    const ctx = computeTurnContext(req);

    expect(ctx.entities.nodes.size).toBe(5);
    expect(ctx.analysis_summary).toBeNull();
    expect(ctx.capabilities.can_run_analysis).toBe(true);
    expect(ctx.capabilities.can_explain_results).toBe(false);
  });

  it('detects close call signal', () => {
    const analysis = makeAnalysis({
      results: [
        { option_label: 'Option A', win_probability: 0.52 },
        { option_label: 'Option B', win_probability: 0.48 },
      ],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.signals.close_call).toBe(true);
  });

  it('detects dominant factor signal', () => {
    const analysis = makeAnalysis({
      factor_sensitivity: [
        { label: 'Revenue', factor_id: 'factor_revenue', elasticity: 2.0, direction: 'positive' },
        { label: 'Cost', factor_id: 'factor_cost', elasticity: 0.3, direction: 'negative' },
      ],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.signals.dominant_factor).toBe('factor_revenue');
  });

  it('counts default/inferred values', () => {
    const req = makeTurnRequest({ graph: makeGraph() });
    const ctx = computeTurnContext(req);

    // factor_cost has extractionType: 'inferred'
    expect(ctx.signals.default_value_count).toBe(1);
    expect(ctx.signals.high_uncertainty_factors).toContain('factor_cost');
  });

  it('detects weak edges', () => {
    const graph = makeGraph({
      edges: [
        { from: 'factor_revenue', to: 'goal_1', strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.9 },
      ],
    });
    const req = makeTurnRequest({ graph });
    const ctx = computeTurnContext(req);

    expect(ctx.signals.weak_edges.length).toBeGreaterThan(0);
  });
});

describe('buildEntityRegistry', () => {
  it('builds node entries with aliases', () => {
    const graph = makeGraph() as GraphV3T;
    const registry = buildEntityRegistry(graph);

    const revenue = registry.nodes.get('factor_revenue')!;
    expect(revenue.label).toBe('Revenue');
    expect(revenue.kind).toBe('factor');
    expect(revenue.value).toBe(100000);
    expect(revenue.unit).toBe('GBP');
  });

  it('returns empty registry for null graph', () => {
    const registry = buildEntityRegistry(null);
    expect(registry.nodes.size).toBe(0);
    expect(registry.edges.length).toBe(0);
    expect(registry.option_ids.length).toBe(0);
    expect(registry.goal_id).toBeNull();
  });
});
