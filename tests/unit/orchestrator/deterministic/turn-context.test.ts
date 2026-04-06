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
// Task 1: computeSignals guards against non-array results
// ============================================================================

describe('computeSignals — non-array results resilience', () => {
  it('does not throw when results is { __circular: true }', () => {
    const analysis = makeAnalysis({ results: { __circular: true } as unknown as unknown[] });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    // Should not crash — close_call requires iterable results, which are now empty
    expect(ctx.signals.close_call).toBe(false);
    // dominant_factor is derived from factor_sensitivity (independent of results)
    expect(typeof ctx.signals.dominant_factor === 'string' || ctx.signals.dominant_factor === null).toBe(true);
  });

  it('does not throw when results is boolean true', () => {
    const analysis = makeAnalysis({ results: true as unknown as unknown[] });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.signals.close_call).toBe(false);
  });

  it('handles empty results array', () => {
    const analysis = makeAnalysis({ results: [] });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.signals.close_call).toBe(false);
    // dominant_factor from factor_sensitivity still computes (independent of results)
    expect(typeof ctx.signals.dominant_factor === 'string' || ctx.signals.dominant_factor === null).toBe(true);
  });

  it('computes correct signals with valid results (regression)', () => {
    const analysis = makeAnalysis({
      results: [
        { option_label: 'Option A', win_probability: 0.52 },
        { option_label: 'Option B', win_probability: 0.48 },
      ],
      factor_sensitivity: [
        { label: 'Revenue', factor_id: 'factor_revenue', elasticity: 2.0, direction: 'positive' },
        { label: 'Cost', factor_id: 'factor_cost', elasticity: 0.3, direction: 'negative' },
      ],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.signals.close_call).toBe(true);
    expect(ctx.signals.dominant_factor).toBe('factor_revenue');
  });
});

// ============================================================================
// Task 3: Phase A/B split resilience
// ============================================================================

describe('computeTurnContext — Phase A/B resilience', () => {
  it('preserves graph state when analysis is malformed (Phase A survives Phase B failure)', () => {
    // Use a getter that throws on iteration to simulate a deep analysis failure
    const toxicAnalysis = {
      meta: { seed_used: 42, n_samples: 100, response_hash: 'test' },
      results: [
        { option_label: 'Option A', win_probability: 0.6 },
        { option_label: 'Option B', win_probability: 0.4 },
      ],
      robustness: { level: 'stable' },
      factor_sensitivity: [
        { label: 'Revenue', factor_id: 'factor_revenue', elasticity: 0.8, direction: 'positive' },
      ],
      // Poison pill: constraint_analysis.per_constraint getter throws
      constraint_analysis: {
        get per_constraint(): never { throw new Error('simulated analysis parse failure'); },
        joint_probability: 0.7,
      },
    } as unknown as V2RunResponseEnvelope;

    const graph = makeGraph();
    const req = makeTurnRequest({ graph, analysis: toxicAnalysis });

    // Should not throw — Phase B fails gracefully
    const ctx = computeTurnContext(req);

    // Phase A preserved: stage, graph entities, graph_summary, conversation
    // Stage remains 'evaluate' — inferStage sees analysis_response as non-null
    // (malformed content doesn't affect stage inference)
    expect(ctx.stage).toBe('evaluate');
    expect(ctx.entities.nodes.size).toBe(5);
    expect(ctx.graph_summary.node_count).toBe(5);
    expect(ctx.graph_summary.option_count).toBe(2);
    expect(ctx.graph_summary.goal_label).toBe('Maximise ROI');

    // Phase B fallback: analysis-dependent capabilities disabled
    expect(ctx.analysis_summary).toBeNull();
    expect(ctx.capabilities.can_explain_results).toBe(false);
    expect(ctx.capabilities.can_compare_options).toBe(false);
    expect(ctx.capabilities.can_challenge).toBe(false);

    // Graph-dependent capabilities preserved
    expect(ctx.capabilities.can_edit_graph).toBe(true);
    expect(ctx.capabilities.can_run_analysis).toBe(true);

    // Graph-derived signals preserved via computeSignals(graph, null, entities)
    expect(ctx.signals.default_value_count).toBe(1); // factor_cost is inferred
    expect(ctx.signals.high_uncertainty_factors).toContain('factor_cost');
    // Analysis-derived signals nulled
    expect(ctx.signals.close_call).toBe(false);
    expect(ctx.signals.dominant_factor).toBeNull();
  });

  it('preserves conversation turn_count when analysis fails', () => {
    const toxicAnalysis = {
      meta: { seed_used: 42, n_samples: 100, response_hash: 'test' },
      get results(): never { throw new Error('results exploded'); },
      robustness: { level: 'stable' },
    } as unknown as V2RunResponseEnvelope;

    const req = {
      message: 'test message',
      context: {
        graph: makeGraph() as GraphV3T,
        analysis_response: toxicAnalysis,
        framing: { stage: 'evaluate' as const },
        messages: [
          { role: 'user', content: 'msg 1' },
          { role: 'assistant', content: 'msg 2' },
          { role: 'user', content: 'msg 3' },
        ],
        scenario_id: 'test-scenario',
      },
      scenario_id: 'test-scenario',
      client_turn_id: 'test-turn-2',
    } as unknown as OrchestratorTurnRequest;

    const ctx = computeTurnContext(req);

    // Conversation state preserved from Phase A
    expect(ctx.conversation.turn_count).toBe(3);
  });

  it('both phases complete normally with valid analysis (regression)', () => {
    const req = makeTurnRequest({ graph: makeGraph(), analysis: makeAnalysis() });
    const ctx = computeTurnContext(req);

    // Phase A
    expect(ctx.entities.nodes.size).toBe(5);
    expect(ctx.graph_summary.node_count).toBe(5);

    // Phase B
    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.winner).toBe('Option A');
    expect(ctx.capabilities.can_explain_results).toBe(true);
    expect(ctx.capabilities.can_challenge).toBe(true);
  });

  it('no analysis, no graph → stage from framing (regression)', () => {
    const req = {
      message: 'hello',
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'frame' as const },
        messages: [],
        scenario_id: 'test-scenario',
      },
      scenario_id: 'test-scenario',
      client_turn_id: 'test-turn-3',
    } as unknown as OrchestratorTurnRequest;

    const ctx = computeTurnContext(req);

    expect(ctx.entities.nodes.size).toBe(0);
    expect(ctx.graph_summary.node_count).toBe(0);
    expect(ctx.analysis_summary).toBeNull();
    expect(ctx.capabilities.can_run_analysis).toBe(false);
    expect(ctx.capabilities.can_explain_results).toBe(false);
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

  it('maps ISL "very_low" to "fragile"', () => {
    expect(mapRobustnessBand('very_low')).toBe('fragile');
  });

  it('maps ISL "robust" to "highly_stable"', () => {
    expect(mapRobustnessBand('robust')).toBe('highly_stable');
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
    expect(mapRobustnessBand('Very_Low')).toBe('fragile');
  });

  it('defaults unknown values to "moderate"', () => {
    expect(mapRobustnessBand('banana')).toBe('moderate');
  });

  it('returns null for null input', () => {
    expect(mapRobustnessBand(null)).toBeNull();
  });
});

// ============================================================================
// Task 1: computeAnalysisSummary — top-level field resolution
// ============================================================================

describe('computeAnalysisSummary — driver and robustness resolution', () => {
  it('reads drivers from top-level drivers.top_drivers when factor_sensitivity is absent', () => {
    const analysis = makeAnalysis({
      factor_sensitivity: undefined,
    });
    // Add top-level drivers field via index signature
    (analysis as Record<string, unknown>).drivers = {
      top_drivers: [
        { label: 'Market Size', sensitivity: 0.9, direction: 'positive', factor_id: 'fac_market' },
        { label: 'Price', sensitivity: 0.5, direction: 'negative', factor_id: 'fac_price' },
      ],
    };
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.top_drivers.length).toBe(2);
    expect(ctx.analysis_summary!.top_drivers[0].label).toBe('Market Size');
    expect(ctx.analysis_summary!.top_drivers[0].sensitivity).toBe(0.9);
  });

  it('reads drivers from compact_summary.top_drivers as last resort', () => {
    const analysis = makeAnalysis({
      factor_sensitivity: undefined,
    });
    (analysis as Record<string, unknown>).compact_summary = {
      top_drivers: [
        { label: 'Revenue', sensitivity: 0.7, direction: 'positive' },
      ],
    };
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.top_drivers.length).toBe(1);
    expect(ctx.analysis_summary!.top_drivers[0].label).toBe('Revenue');
  });

  it('produces empty drivers when no driver source exists (no crash)', () => {
    const analysis = makeAnalysis({
      factor_sensitivity: undefined,
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.top_drivers).toEqual([]);
  });

  it('prefers factor_sensitivity over drivers.top_drivers (regression)', () => {
    const analysis = makeAnalysis({
      factor_sensitivity: [
        { label: 'Revenue', factor_id: 'factor_revenue', elasticity: 0.8, direction: 'positive' },
      ],
    });
    (analysis as Record<string, unknown>).drivers = {
      top_drivers: [
        { label: 'Overridden', sensitivity: 0.1, direction: 'negative' },
      ],
    };
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary!.top_drivers[0].label).toBe('Revenue');
  });

  it('derives top_drivers magnitude from influence_percent when elasticity/sensitivity are absent', () => {
    // Regression: the UI forwards factor_sensitivity with `influence_percent`
    // only (no elasticity, no sensitivity). Before this fix the extraction
    // loop's `mag = elasticity ?? sensitivity` yielded undefined, every entry
    // was silently dropped, and top_drivers was empty — forcing every
    // post-analysis handler (explain_result / compare_options / what_would_flip)
    // into its zero-drivers fallback branch with generic copy.
    const analysis = makeAnalysis({
      factor_sensitivity: [
        { label: 'Ramp time', factor_id: 'factor_ramp', influence_percent: 45, direction: 'negative' },
        { label: 'Contractor cost', factor_id: 'factor_cost', influence_percent: 30, direction: 'positive' },
        { label: 'Team capacity', factor_id: 'factor_cap', influence_percent: 15, direction: 'positive' },
      ] as unknown as never,
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.top_drivers.length).toBe(3);
    // Sorted by magnitude descending
    expect(ctx.analysis_summary!.top_drivers[0].label).toBe('Ramp time');
    expect(ctx.analysis_summary!.top_drivers[0].sensitivity).toBe(45);
    expect(ctx.analysis_summary!.top_drivers[1].label).toBe('Contractor cost');
    expect(ctx.analysis_summary!.top_drivers[2].label).toBe('Team capacity');
  });

  it('prefers elasticity over influence_percent on mixed entries', () => {
    // If an entry carries both elasticity and influence_percent, elasticity wins.
    // Preserves canonical PLoT behaviour when the data is available.
    const analysis = makeAnalysis({
      factor_sensitivity: [
        { label: 'Mixed', factor_id: 'factor_mixed', elasticity: 2.5, influence_percent: 10, direction: 'positive' },
        { label: 'InfluenceOnly', factor_id: 'factor_inf', influence_percent: 20, direction: 'positive' },
      ] as unknown as never,
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary!.top_drivers.length).toBe(2);
    // Mixed should sort first with magnitude 2.5 (from elasticity), NOT 10 (from influence_percent)
    expect(ctx.analysis_summary!.top_drivers[0].label).toBe('InfluenceOnly'); // 20 > 2.5
    expect(ctx.analysis_summary!.top_drivers[0].sensitivity).toBe(20);
    expect(ctx.analysis_summary!.top_drivers[1].label).toBe('Mixed');
    expect(ctx.analysis_summary!.top_drivers[1].sensitivity).toBe(2.5);
  });

  it('reads robustness from compact_summary.robustness.level when robustness.level is absent', () => {
    const analysis = makeAnalysis({
      robustness: undefined,
    });
    (analysis as Record<string, unknown>).compact_summary = {
      robustness: { level: 'very_low' },
    };
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.robustness_band).toBe('fragile');
  });

  it('reads drivers from top-level analysis.drivers when it is a plain array', () => {
    const analysis = makeAnalysis({ factor_sensitivity: undefined });
    (analysis as Record<string, unknown>).drivers = [
      { label: 'Ad Spend', sensitivity: 0.8, direction: 'positive', factor_id: 'fac_ad' },
    ];
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary!.top_drivers.length).toBe(1);
    expect(ctx.analysis_summary!.top_drivers[0].label).toBe('Ad Spend');
  });

  it('reads drivers from top-level analysis.top_drivers array', () => {
    const analysis = makeAnalysis({ factor_sensitivity: undefined });
    (analysis as Record<string, unknown>).top_drivers = [
      { label: 'Conversion Rate', sensitivity: 0.6, direction: 'positive' },
    ];
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary!.top_drivers.length).toBe(1);
    expect(ctx.analysis_summary!.top_drivers[0].label).toBe('Conversion Rate');
  });

  it('existing analysis with factor_sensitivity still works (regression)', () => {
    const req = makeTurnRequest({ graph: makeGraph(), analysis: makeAnalysis() });
    const ctx = computeTurnContext(req);

    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.top_drivers.length).toBeGreaterThan(0);
    expect(ctx.analysis_summary!.robustness_band).toBe('moderate');
  });
});

describe('computeAnalysisSummary — defensive parsing', () => {
  it('drops fragile_edges entries with NaN, Infinity, or non-numeric switch_probability', () => {
    const analysis = makeAnalysis({
      robustness: {
        level: 'fragile',
        fragile_edges: [
          { from_label: 'A', to_label: 'B', switch_probability: 0.42 },
          { from_label: 'C', to_label: 'D', switch_probability: NaN },
          { from_label: 'E', to_label: 'F', switch_probability: Infinity },
          { from_label: 'G', to_label: 'H', switch_probability: '0.5' as unknown as number },
          { from_label: 'I', to_label: 'J', switch_probability: 0.18 },
          // marginal_switch_probability fallback
          { from_label: 'K', to_label: 'L', marginal_switch_probability: 0.31 },
        ],
      } as unknown as V2RunResponseEnvelope['robustness'],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);
    const summary = ctx.analysis_summary!;

    // fragile_edge_count mirrors the raw upstream length (6 entries) — does
    // NOT collapse to the parsed count. This preserves the contract used by
    // explain-result.ts / compare-options.ts / run-premortem.ts.
    expect(summary.fragile_edge_count).toBe(6);

    // fragile_edges only contains the entries with finite probabilities,
    // sorted desc, capped at 5.
    const labels = summary.fragile_edges.map(e => e.label);
    expect(labels).not.toContain('C → D'); // NaN dropped
    expect(labels).not.toContain('E → F'); // Infinity dropped
    expect(labels).not.toContain('G → H'); // string dropped
    expect(labels).toContain('A → B');
    expect(labels).toContain('I → J');
    expect(labels).toContain('K → L'); // marginal fallback worked
    // Sort order: 0.42 > 0.31 > 0.18
    expect(summary.fragile_edges[0].label).toBe('A → B');
    expect(summary.fragile_edges[0].switch_probability).toBe(0.42);
  });

  it('drops factor_sensitivity entries with missing label or non-string label; NaN numerics are nulled but the entry survives', () => {
    const analysis = makeAnalysis({
      factor_sensitivity: [
        { factor_label: 'Demand', influence_percent: 38, confidence_band: 'high', influence_rank: 1 },
        { factor_label: 'Cost', influence_percent: NaN, influence_rank: 2 },           // NaN nulled, entry survives as bare label
        { factor_label: 'Margin', elasticity: NaN, influence_rank: 3 },                 // NaN elasticity nulled, entry survives
        { influence_percent: 22, influence_rank: 4 },                                    // no label → DROPPED
        { factor_label: 42 as unknown as string, influence_percent: 18, influence_rank: 5 }, // non-string label → DROPPED
        { factor_label: 'Brand', elasticity: 0.5, influence_rank: 6 },                  // valid: elasticity → 50%
      ],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);
    const summary = ctx.analysis_summary!;

    const labels = summary.factor_sensitivity.map(f => f.label);
    // Entries with a usable label survive — entries without don't.
    expect(labels).toContain('Demand');
    expect(labels).toContain('Cost');     // survives as bare label, influence_percent: null
    expect(labels).toContain('Margin');   // survives as bare label, influence_percent: null
    expect(labels).toContain('Brand');
    expect(labels).toHaveLength(4);       // numeric-less label "42" and the missing-label entry both dropped

    // NaN-input entries surface with null numerics — the prompt renderer
    // emits them as bare bullets, which is degraded but non-broken.
    const cost = summary.factor_sensitivity.find(f => f.label === 'Cost');
    expect(cost?.influence_percent).toBeNull();
    const margin = summary.factor_sensitivity.find(f => f.label === 'Margin');
    expect(margin?.influence_percent).toBeNull();

    // Brand: elasticity 0.5 → influence_percent 50
    const brand = summary.factor_sensitivity.find(f => f.label === 'Brand');
    expect(brand?.influence_percent).toBe(50);
  });

  it('drops edge_e_values entries with malformed e_value or unlabelled edges', () => {
    const analysis = makeAnalysis({
      robustness: {
        level: 'fragile',
        edge_e_values: [
          { from_label: 'A', to_label: 'B', e_value: 1.2 },
          { from_label: 'C', to_label: 'D', e_value: NaN },
          { e_value: 1.5 },                                          // missing edge label
          { from_label: 'E', to_label: 'F', e_value: 1.4 },
          { from_label: 'G', to_label: 'H', e_value: 4.5 },
        ],
      } as unknown as V2RunResponseEnvelope['robustness'],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);
    const summary = ctx.analysis_summary!;

    expect(summary.edge_e_values.length).toBe(3); // 2 fragile + 1 robust, NaN and unlabelled dropped
    // Sort by e_value asc, take top 2 fragile + 1 robust
    expect(summary.edge_e_values[0]).toEqual({ label: 'A → B', e_value: 1.2, fragile: true });
    expect(summary.edge_e_values[1]).toEqual({ label: 'E → F', e_value: 1.4, fragile: true });
    expect(summary.edge_e_values[2]).toEqual({ label: 'G → H', e_value: 4.5, fragile: false });
  });

  it('does not double-count when e_values has exactly 2 entries (no most-robust pick)', () => {
    const analysis = makeAnalysis({
      robustness: {
        level: 'moderate',
        edge_e_values: [
          { from_label: 'A', to_label: 'B', e_value: 1.2 },
          { from_label: 'C', to_label: 'D', e_value: 2.5 },
        ],
      } as unknown as V2RunResponseEnvelope['robustness'],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);
    const summary = ctx.analysis_summary!;

    // Both entries are tagged fragile; we don't add a 'robust' pick because
    // all entries are already in the fragile slice.
    expect(summary.edge_e_values.length).toBe(2);
    expect(summary.edge_e_values.every(e => e.fragile === true)).toBe(true);
  });

  it('drops conditional_winners entries missing scenario or winner_label', () => {
    const analysis = makeAnalysis({
      robustness: {
        level: 'fragile',
        conditional_winners: [
          { scenario: 'high churn', winner_label: 'Option B', probability: 0.7 },
          { winner_label: 'Option C' },                              // missing scenario
          { scenario: 'low margin' },                                 // missing winner
          { factor_label: 'Demand fallback', alternative_winner_label: 'Option D' }, // both fallbacks used
        ],
      } as unknown as V2RunResponseEnvelope['robustness'],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);
    const summary = ctx.analysis_summary!;

    expect(summary.conditional_winners.length).toBe(2);
    expect(summary.conditional_winners[0].scenario).toBe('high churn');
    expect(summary.conditional_winners[1].scenario).toBe('Demand fallback');
    expect(summary.conditional_winners[1].winner_label).toBe('Option D');
  });

  it('drops inference_warnings entries with empty message and code', () => {
    const analysis = makeAnalysis({
      robustness: {
        level: 'fragile',
        inference_warnings: [
          { code: 'EXTRAPOLATION', message: 'Outside training range' },
          { code: '', message: '' },                                  // both empty
          { code: 'CONVERGENCE' },                                    // code only
          { message: 'Sample size below threshold' },                 // message only
        ],
      } as unknown as V2RunResponseEnvelope['robustness'],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);
    const summary = ctx.analysis_summary!;

    expect(summary.inference_warnings).toContain('Outside training range');
    expect(summary.inference_warnings).toContain('CONVERGENCE');
    expect(summary.inference_warnings).toContain('Sample size below threshold');
    expect(summary.inference_warnings.length).toBe(3);
  });

  it('dominant_factor accepts influence_percent when elasticity is absent (regression)', () => {
    const analysis = makeAnalysis({
      factor_sensitivity: [
        { factor_label: 'Pricing Power', factor_id: 'fac_price', influence_percent: 60 },
        { factor_label: 'Market Size', factor_id: 'fac_market', influence_percent: 20 },
      ],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    // 60 > 20 * 2.0 → dominant
    expect(ctx.signals.dominant_factor).toBe('fac_price');
  });

  it('dominant_factor skips entries without a string factor_id (no empty-string fallthrough)', () => {
    const analysis = makeAnalysis({
      factor_sensitivity: [
        { factor_label: 'Cost', influence_percent: 80 },              // no factor_id, label fallback used
        { factor_id: 42 as unknown as string, influence_percent: 30 },// non-string factor_id dropped
      ],
    });
    const req = makeTurnRequest({ graph: makeGraph(), analysis });
    const ctx = computeTurnContext(req);

    // First entry survives via label fallback to factor_id, second is dropped.
    // Only one valid entry → no dominance signal (needs >= 2).
    expect(ctx.signals.dominant_factor).toBeNull();
  });
});
