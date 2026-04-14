/**
 * Fix 4: run_analysis chip gate must never see null on a turn where a graph
 * exists. When the current turn's action result has no graph_patch block
 * (conversational turns), the fallback reads analysis_ready from the
 * caller's graph_state and then from computeStructuralReadiness on the
 * current graph.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: {},
    cee: { editInterventionRoutingEnabled: false },
  },
}));

import { __test_only } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

const { deriveAnalysisReadyStatusFallback } = __test_only;

function makeTurnContext(graph: GraphV3T | null): DeterministicTurnContext {
  return { graph } as unknown as DeterministicTurnContext;
}

function attachAnalysisReady(graph: GraphV3T, status: string): GraphV3T {
  (graph as unknown as Record<string, unknown>).analysis_ready = { status };
  return graph;
}

function makeGraphWithOptions(optionReady: boolean): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Ship on time' },
      { id: 'fac_ramp', kind: 'factor', label: 'Ramp time' },
      {
        id: 'option_a',
        kind: 'option',
        label: 'A',
        is_baseline: true,
        ...(optionReady ? { data: { interventions: { fac_ramp: 0.5 } }, interventions: { fac_ramp: 0.5 } } : {}),
      },
      {
        id: 'option_b',
        kind: 'option',
        label: 'B',
        is_baseline: false,
        ...(optionReady ? { data: { interventions: { fac_ramp: 0.3 } }, interventions: { fac_ramp: 0.3 } } : {}),
      },
    ],
    edges: [
      { from: 'fac_ramp', to: 'goal_1', strength: { mean: 0.8, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'option_a', to: 'fac_ramp', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'option_b', to: 'fac_ramp', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

describe('deriveAnalysisReadyStatusFallback', () => {
  it('returns null when no graph exists', () => {
    const status = deriveAnalysisReadyStatusFallback(makeTurnContext(null));
    expect(status).toBeNull();
  });

  it("uses analysis_ready.status carried on the graph when present", () => {
    const graph = attachAnalysisReady(makeGraphWithOptions(false), 'needs_encoding');
    const status = deriveAnalysisReadyStatusFallback(makeTurnContext(graph));
    expect(status).toBe('needs_encoding');
  });

  it("falls back to computeStructuralReadiness on current graph when payload absent", () => {
    const status = deriveAnalysisReadyStatusFallback(makeTurnContext(makeGraphWithOptions(false)));
    expect(status).toBe('needs_encoding');
  });

  it("recomputes 'ready' when options carry interventions", () => {
    const status = deriveAnalysisReadyStatusFallback(makeTurnContext(makeGraphWithOptions(true)));
    expect(status).toBe('ready');
  });
});
