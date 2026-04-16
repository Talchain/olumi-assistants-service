import { describe, it, expect, vi } from 'vitest';

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { computeStructuralReadiness, mergeInterventionSources } from '../../../../src/orchestrator/tools/analysis-ready-helper.js';
import type { GraphV3T } from '../../../../src/schemas/cee-v3.js';

function makeReadyGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Choose pricing' },
      {
        id: 'opt_a', kind: 'option', label: 'Option A',
        interventions: { fac_x: 0.8 },
      },
      {
        id: 'opt_b', kind: 'option', label: 'Option B',
        interventions: { fac_x: 0.3 },
      },
      { id: 'fac_x', kind: 'factor', label: 'Market size' },
      { id: 'goal_1', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_x', strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_x', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
      { from: 'fac_x', to: 'goal_1', strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.95, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

describe('computeStructuralReadiness', () => {
  it('returns undefined when no goal node exists', () => {
    const graph = makeReadyGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'goal');
    expect(computeStructuralReadiness(graph)).toBeUndefined();
  });

  it('returns "ready" when all options have numeric interventions', () => {
    const result = computeStructuralReadiness(makeReadyGraph());

    expect(result).toBeDefined();
    expect(result!.status).toBe('ready');
    expect(result!.goal_node_id).toBe('goal_1');
    expect(result!.goal_threshold).toBe(0.8);
    expect(result!.options).toHaveLength(2);
    expect(result!.options[0].status).toBe('ready');
    expect(result!.options[1].status).toBe('ready');
  });

  it('returns "needs_user_mapping" when an option lacks interventions', () => {
    const graph = makeReadyGraph();
    // Remove interventions from opt_b
    const optB = graph.nodes.find((n) => n.id === 'opt_b') as Record<string, unknown>;
    delete optB.interventions;
    // Also remove edge so it is truly disconnected from factors
    graph.edges = graph.edges.filter((e) => !(e.from === 'opt_b' && e.to === 'fac_x'));

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    expect(result!.status).toBe('needs_user_mapping');
    expect(result!.options.find((o) => o.option_id === 'opt_b')!.status).toBe('needs_user_mapping');
  });

  it('returns "needs_encoding" when option has edges but no numeric interventions', () => {
    const graph = makeReadyGraph();
    // Remove interventions but keep edge to factor
    const optB = graph.nodes.find((n) => n.id === 'opt_b') as Record<string, unknown>;
    delete optB.interventions;

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    // opt_b has edge to fac_x but no encoded interventions → needs_encoding
    expect(result!.options.find((o) => o.option_id === 'opt_b')!.status).toBe('needs_encoding');
  });

  it('returns "needs_user_input" when fewer than 2 options', () => {
    const graph = makeReadyGraph();
    graph.nodes = graph.nodes.filter((n) => n.id !== 'opt_b');
    graph.edges = graph.edges.filter((e) => e.from !== 'opt_b' && e.to !== 'opt_b');

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    expect(result!.status).toBe('needs_user_input');
  });

  // ===========================================================================
  // is_baseline detection (CEE-2)
  // ===========================================================================

  it('detects baseline from option label keyword ("Status Quo")', () => {
    const graph = makeReadyGraph();
    // Rename opt_b to a baseline-like label
    const optB = graph.nodes.find((n) => n.id === 'opt_b')!;
    optB.label = 'No New Hire (Status Quo)';

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    const baselineOpt = result!.options.find((o) => o.option_id === 'opt_b');
    const nonBaselineOpt = result!.options.find((o) => o.option_id === 'opt_a');
    expect(baselineOpt!.is_baseline).toBe(true);
    expect(nonBaselineOpt!.is_baseline).toBe(false);
  });

  it('detects baseline from node-level is_baseline flag (priority over label)', () => {
    const graph = makeReadyGraph();
    // opt_a has no baseline label but has is_baseline = true on the node
    const optA = graph.nodes.find((n) => n.id === 'opt_a') as Record<string, unknown>;
    optA.is_baseline = true;
    // opt_b has baseline-like label but no flag
    const optB = graph.nodes.find((n) => n.id === 'opt_b')!;
    optB.label = 'Keep Current (Status Quo)';

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    // Node-level flag wins over label keyword
    expect(result!.options.find((o) => o.option_id === 'opt_a')!.is_baseline).toBe(true);
    expect(result!.options.find((o) => o.option_id === 'opt_b')!.is_baseline).toBe(false);
  });

  it('sets is_baseline: false on all options when no baseline detected', () => {
    const result = computeStructuralReadiness(makeReadyGraph());
    expect(result).toBeDefined();
    for (const opt of result!.options) {
      expect(opt.is_baseline).toBe(false);
    }
  });

  it('detects all four staging labels that surfaced the original bug', () => {
    const labels = [
      'Make No New Hire (Status Quo)',
      'No New Hire (Status Quo)',
      'No Dedicated Marketing (Status Quo)',
      'No Dedicated Campaign (Status Quo)',
    ];

    for (const baselineLabel of labels) {
      const graph = makeReadyGraph();
      const optB = graph.nodes.find((n) => n.id === 'opt_b')!;
      optB.label = baselineLabel;

      const result = computeStructuralReadiness(graph);
      expect(result).toBeDefined();
      const baselineOpt = result!.options.find((o) => o.option_id === 'opt_b');
      expect(baselineOpt!.is_baseline, `Expected is_baseline=true for label: "${baselineLabel}"`).toBe(true);
    }
  });
});

// ============================================================================
// Fix 1A — unconditional read across all three intervention sources
// ============================================================================

describe('mergeInterventionSources (Fix 1A)', () => {
  it('reads Source 1 (data.interventions) even when flag-era callers pass only Source 1', () => {
    const node = {
      id: 'opt_a',
      data: { interventions: { fac_x: 0.75 } },
    } as unknown as Record<string, unknown>;
    expect(mergeInterventionSources(node)).toEqual({ fac_x: 0.75 });
  });

  it('reads Source 3 (top-level interventions) as fallback', () => {
    const node = {
      id: 'opt_a',
      interventions: { fac_x: 0.5 },
    } as unknown as Record<string, unknown>;
    expect(mergeInterventionSources(node)).toEqual({ fac_x: 0.5 });
  });

  it('Source 1 (data.interventions) wins when both Source 1 and Source 3 are populated with different values', () => {
    const node = {
      id: 'opt_a',
      data: { interventions: { fac_x: 0.9 } },
      interventions: { fac_x: 0.1 },
    } as unknown as Record<string, unknown>;
    // Precedence: data.interventions > top-level interventions.
    expect(mergeInterventionSources(node)).toEqual({ fac_x: 0.9 });
  });

  it('Source 2 (slash-keyed) fills factors missing from Source 1', () => {
    const node = {
      id: 'opt_a',
      data: { interventions: { fac_x: 0.5 } },
      'data/interventions/fac_y': 0.3,
    } as unknown as Record<string, unknown>;
    expect(mergeInterventionSources(node)).toEqual({ fac_x: 0.5, fac_y: 0.3 });
  });

  it('returns undefined when no sources have interventions', () => {
    expect(mergeInterventionSources({ id: 'opt_a' })).toBeUndefined();
  });

  it('regression: Fix 1A — Source 1 read does not depend on flag state', () => {
    // Prior to Fix 1A, reads from data.interventions were gated behind
    // CEE_EDIT_INTERVENTION_ROUTING_ENABLED. After the fix, reads are
    // unconditional. Pre-existing options that stored interventions only
    // at data.interventions (e.g. written by edit_graph) must survive the
    // intervention merge even with the write-side flag disabled.
    const node = {
      id: 'opt_raise',
      data: { interventions: { fac_market_size: 0.75, fac_cost: 0.3 } },
    } as unknown as Record<string, unknown>;
    expect(mergeInterventionSources(node)).toEqual({
      fac_market_size: 0.75,
      fac_cost: 0.3,
    });
  });
});
