/**
 * TurnContext Builder Tests
 */

import { describe, it, expect } from "vitest";
import { computeTurnContext, buildEntityRegistry, computeDisambiguationHints, mapRobustnessBand } from "../../../../src/orchestrator/deterministic/turn-context.js";
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
    // Structural checks: no constraints and no external factors are detected
    expect(ctx.graph_summary.missing_structural).toBeInstanceOf(Array);
    expect(ctx.graph_summary.missing_structural).not.toContain('no goal node');
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
    expect(ctx.graph_summary.missing_structural).toContain('no goal node');
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

describe('computeDisambiguationHints', () => {
  function makeEntityRegistry() {
    const nodes = new Map<string, import("../../../../src/orchestrator/deterministic/types.js").EntityEntry>();
    nodes.set('fac_churn_rate', { id: 'fac_churn_rate', label: 'Churn Rate', kind: 'factor', aliases: ['churn', 'rate'], is_action_target: true });
    nodes.set('fac_churn_risk', { id: 'fac_churn_risk', label: 'Churn Risk', kind: 'factor', aliases: ['churn', 'risk'], is_action_target: true });
    nodes.set('fac_revenue', { id: 'fac_revenue', label: 'Revenue', kind: 'factor', aliases: ['rev'], is_action_target: true });
    nodes.set('goal_mrr', { id: 'goal_mrr', label: 'MRR Goal', kind: 'goal', aliases: [], is_action_target: false });
    return { nodes, edges: [], option_ids: [], goal_id: 'goal_mrr' } as import("../../../../src/orchestrator/deterministic/types.js").EntityRegistry;
  }

  it('detects ambiguous token matching 2+ actionable entities', () => {
    const registry = makeEntityRegistry();
    const hints = computeDisambiguationHints('set churn to 5%', registry);

    expect(hints).toHaveLength(1);
    expect(hints[0].term).toBe('churn');
    expect(hints[0].candidates).toHaveLength(2);
    expect(hints[0].candidates.map((c) => c.id)).toContain('fac_churn_rate');
    expect(hints[0].candidates.map((c) => c.id)).toContain('fac_churn_risk');
  });

  it('ignores non-actionable entities (is_action_target: false)', () => {
    const registry = makeEntityRegistry();
    // "goal" only matches goal_mrr which is not an action target
    const hints = computeDisambiguationHints('tell me about the goal', registry);
    expect(hints).toHaveLength(0);
  });

  it('ignores tokens that exactly match a single entity label', () => {
    const registry = makeEntityRegistry();
    const hints = computeDisambiguationHints('set revenue to 100', registry);
    // "revenue" exactly matches "Revenue" (case-insensitive) — unambiguous
    expect(hints).toHaveLength(0);
  });

  it('returns empty for short/stop-word messages', () => {
    const registry = makeEntityRegistry();
    const hints = computeDisambiguationHints('do it now', registry);
    expect(hints).toHaveLength(0);
  });

  it('caps at 2 hints sorted by candidate count desc', () => {
    const nodes = new Map<string, import("../../../../src/orchestrator/deterministic/types.js").EntityEntry>();
    // 3 entities matching "rate"
    nodes.set('f1', { id: 'f1', label: 'Rate A', kind: 'factor', aliases: [], is_action_target: true });
    nodes.set('f2', { id: 'f2', label: 'Rate B', kind: 'factor', aliases: [], is_action_target: true });
    nodes.set('f3', { id: 'f3', label: 'Rate C', kind: 'factor', aliases: [], is_action_target: true });
    // 2 entities matching "cost"
    nodes.set('f4', { id: 'f4', label: 'Cost X', kind: 'factor', aliases: [], is_action_target: true });
    nodes.set('f5', { id: 'f5', label: 'Cost Y', kind: 'factor', aliases: [], is_action_target: true });
    // 2 entities matching "score"
    nodes.set('f6', { id: 'f6', label: 'Score High', kind: 'factor', aliases: [], is_action_target: true });
    nodes.set('f7', { id: 'f7', label: 'Score Low', kind: 'factor', aliases: [], is_action_target: true });
    const registry = { nodes, edges: [], option_ids: [], goal_id: null } as import("../../../../src/orchestrator/deterministic/types.js").EntityRegistry;

    const hints = computeDisambiguationHints('adjust rate and cost and score', registry);
    expect(hints).toHaveLength(2);
    // First hint should be "rate" (3 candidates), second should be "cost" or "score" (2 each)
    expect(hints[0].candidates.length).toBeGreaterThanOrEqual(hints[1].candidates.length);
  });

  it('returns empty for empty entity registry', () => {
    const registry = { nodes: new Map(), edges: [], option_ids: [], goal_id: null } as import("../../../../src/orchestrator/deterministic/types.js").EntityRegistry;
    const hints = computeDisambiguationHints('anything here', registry);
    expect(hints).toHaveLength(0);
  });
});

// ============================================================================
// mapRobustnessBand
// ============================================================================

describe('mapRobustnessBand', () => {
  it('maps ISL "low" to "fragile"', () => {
    expect(mapRobustnessBand('low')).toBe('fragile');
  });

  it('maps ISL "medium" to "moderate"', () => {
    expect(mapRobustnessBand('medium')).toBe('moderate');
  });

  it('maps ISL "high" to "stable"', () => {
    expect(mapRobustnessBand('high')).toBe('stable');
  });

  it('maps ISL "very_high" to "highly_stable"', () => {
    expect(mapRobustnessBand('very_high')).toBe('highly_stable');
  });

  it('passes through canonical values unchanged', () => {
    expect(mapRobustnessBand('fragile')).toBe('fragile');
    expect(mapRobustnessBand('moderate')).toBe('moderate');
    expect(mapRobustnessBand('stable')).toBe('stable');
    expect(mapRobustnessBand('highly_stable')).toBe('highly_stable');
  });

  it('handles case-insensitive input', () => {
    expect(mapRobustnessBand('LOW')).toBe('fragile');
    expect(mapRobustnessBand('Medium')).toBe('moderate');
  });

  it('defaults unknown values to "moderate"', () => {
    expect(mapRobustnessBand('banana')).toBe('moderate');
  });

  it('returns null for null input', () => {
    expect(mapRobustnessBand(null)).toBeNull();
  });
});
