/**
 * Test Suite 1: CEE → PLoT Request Contract
 *
 * Verifies the exact shape CEE sends to PLoT /v2/run via handleRunAnalysis.
 * Uses the real handler with a mocked PLoTClient to capture the payload.
 *
 * Phase 1B trace assertions:
 * - graph has nodes[] and edges[]
 * - options[] each have { id, option_id, label, interventions: { factor_id: number } }
 * - goal_node_id is a non-empty string
 * - goal_constraints present ↔ analysis_inputs.constraints provided
 * - goal_constraints[].value is a number (the threshold), NOT a string field name
 * - goal_constraints[].constraint_id, .node_id, .operator present
 * - seed present when provided
 * - request_id present
 * - no from_ prefix on edge fields (CEE sends `from`, not `from_node_id`)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRunAnalysis } from "../../../src/orchestrator/tools/run-analysis.js";
import type { ConversationContext, V2RunResponseEnvelope } from "../../../src/orchestrator/types.js";
import type { PLoTClient } from "../../../src/orchestrator/plot-client.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Minimal valid PLoT response envelope.
 * Must satisfy normalizeAnalysisEnvelope: response_hash + option_comparison/results
 * with valid option_label + win_probability.
 */
function makePLoTResponse(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
    analysis_status: "completed",
    meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-abc123" },
    response_hash: "hash-abc123",
    results: [
      { option_id: "opt_a", option_label: "Option A", win_probability: 0.65 },
      { option_id: "opt_b", option_label: "Option B", win_probability: 0.35 },
    ],
    ...overrides,
  };
}

/**
 * Capture the raw payload sent to plotClient.run().
 * Returns a spy that records the first argument of each call.
 */
function makePLoTClientCapture(): { client: PLoTClient; capturedPayload: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const client: PLoTClient = {
    run: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      captured = payload;
      return makePLoTResponse();
    }),
    validatePatch: vi.fn().mockResolvedValue({ kind: "success", data: { verdict: "accepted" } }),
  };
  return { client, capturedPayload: () => captured };
}

/** Minimal valid graph with a goal node and a factor node connected by an edge. */
const MINIMAL_GRAPH: ConversationContext["graph"] = {
  nodes: [
    { id: "goal_1", kind: "goal", label: "Maximise Revenue" },
    { id: "fac_price", kind: "factor", label: "Price" },
  ],
  edges: [
    {
      from: "fac_price",
      to: "goal_1",
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    },
  ],
} as unknown as ConversationContext["graph"];

/** Two options with flat-numeric interventions (the normalised form). */
const MINIMAL_ANALYSIS_INPUTS: ConversationContext["analysis_inputs"] = {
  options: [
    {
      option_id: "opt_a",
      label: "Option A",
      interventions: { fac_price: 100 },
    },
    {
      option_id: "opt_b",
      label: "Option B",
      interventions: { fac_price: 150 },
    },
  ],
  goal_node_id: "goal_1",
};

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: MINIMAL_GRAPH,
    analysis_response: null,
    framing: { stage: "evaluate" },
    messages: [],
    scenario_id: "test-scenario",
    analysis_inputs: MINIMAL_ANALYSIS_INPUTS,
    ...overrides,
  };
}

// ============================================================================
// Suite 1a: Core payload shape
// ============================================================================

describe("PLoT request contract — core payload shape", () => {
  it("graph has nodes[] and edges[] arrays", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    const payload = capturedPayload();

    const graph = payload.graph as Record<string, unknown>;
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect((graph.nodes as unknown[]).length).toBeGreaterThan(0);
    expect((graph.edges as unknown[]).length).toBeGreaterThan(0);
  });

  it("graph edges use `from` field, NOT `from_node_id` or any `from_` prefix", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    const payload = capturedPayload();

    const graph = payload.graph as Record<string, unknown>;
    const edges = graph.edges as Array<Record<string, unknown>>;
    for (const edge of edges) {
      expect("from" in edge).toBe(true);
      // No from_node_id, from_id, or any from_ prefixed field
      const fromPrefixFields = Object.keys(edge).filter((k) => k.startsWith("from_"));
      expect(fromPrefixFields).toEqual([]);
    }
  });

  it("options is a non-empty array", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    const payload = capturedPayload();

    expect(Array.isArray(payload.options)).toBe(true);
    expect((payload.options as unknown[]).length).toBeGreaterThan(0);
  });

  it("each option has id, option_id, label, and interventions", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    const payload = capturedPayload();

    const options = payload.options as Array<Record<string, unknown>>;
    for (const opt of options) {
      expect(typeof opt.id).toBe("string");
      expect(typeof opt.option_id).toBe("string");
      expect(typeof opt.label).toBe("string");
      expect(opt.interventions !== null && typeof opt.interventions === "object").toBe(true);
    }
  });

  it("interventions are a flat { factor_id: number } map — not nested objects", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    const payload = capturedPayload();

    const options = payload.options as Array<Record<string, unknown>>;
    for (const opt of options) {
      const interventions = opt.interventions as Record<string, unknown>;
      for (const [, val] of Object.entries(interventions)) {
        // PLoT expects raw numbers, not { value: number, source: ... } objects
        expect(typeof val).toBe("number");
      }
    }
  });

  it("goal_node_id is a non-empty string", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    const payload = capturedPayload();

    expect(typeof payload.goal_node_id).toBe("string");
    expect((payload.goal_node_id as string).length).toBeGreaterThan(0);
  });

  it("request_id is present and non-empty", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    const payload = capturedPayload();

    expect(typeof payload.request_id).toBe("string");
    expect((payload.request_id as string).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Suite 1b: goal_constraints field
// ============================================================================

describe("PLoT request contract — goal_constraints", () => {
  it("goal_constraints is present when analysis_inputs.constraints is provided", async () => {
    const constraints = [
      { constraint_id: "c1", node_id: "fac_price", operator: "<=", value: 200, label: "Max price" },
    ];
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(
      makeContext({ analysis_inputs: { ...MINIMAL_ANALYSIS_INPUTS!, constraints } }),
      client,
      "req-2",
      "turn-2",
    );
    const payload = capturedPayload();

    expect("goal_constraints" in payload).toBe(true);
    expect(Array.isArray(payload.goal_constraints)).toBe(true);
    expect((payload.goal_constraints as unknown[]).length).toBe(1);
  });

  it("goal_constraints is absent when analysis_inputs.constraints is null/undefined", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(
      makeContext({
        analysis_inputs: {
          ...MINIMAL_ANALYSIS_INPUTS!,
          constraints: undefined,
        },
      }),
      client,
      "req-3",
      "turn-3",
    );
    const payload = capturedPayload();

    // Must not be present (not even as empty array) — strict allowlist
    expect("goal_constraints" in payload).toBe(false);
  });

  it("goal_constraints[].value is a number (threshold), not a string field name", async () => {
    const constraints = [
      { constraint_id: "c1", node_id: "fac_price", operator: "<=", value: 200 },
      { constraint_id: "c2", node_id: "fac_price", operator: ">=", value: 50 },
    ];
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(
      makeContext({ analysis_inputs: { ...MINIMAL_ANALYSIS_INPUTS!, constraints } }),
      client,
      "req-4",
      "turn-4",
    );
    const payload = capturedPayload();
    const gc = payload.goal_constraints as Array<Record<string, unknown>>;

    for (const constraint of gc) {
      // value must be numeric — not the field name "value"
      expect(typeof constraint.value).toBe("number");
    }
  });

  it("goal_constraints[].constraint_id, node_id, operator are present", async () => {
    const constraints = [
      { constraint_id: "c1", node_id: "fac_price", operator: "<=", value: 200 },
    ];
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(
      makeContext({ analysis_inputs: { ...MINIMAL_ANALYSIS_INPUTS!, constraints } }),
      client,
      "req-5",
      "turn-5",
    );
    const payload = capturedPayload();
    const gc = payload.goal_constraints as Array<Record<string, unknown>>;
    const c = gc[0];

    expect(typeof c.constraint_id).toBe("string");
    expect(typeof c.node_id).toBe("string");
    expect(typeof c.operator).toBe("string");
    expect([">=", "<="].includes(c.operator as string)).toBe(true);
  });
});

// ============================================================================
// Suite 1c: Optional fields
// ============================================================================

describe("PLoT request contract — optional fields", () => {
  it("seed is present when provided in analysis_inputs", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(
      makeContext({ analysis_inputs: { ...MINIMAL_ANALYSIS_INPUTS!, seed: 99 } }),
      client,
      "req-6",
      "turn-6",
    );
    const payload = capturedPayload();

    expect("seed" in payload).toBe(true);
    expect(payload.seed).toBe(99);
  });

  it("seed is absent when not provided", async () => {
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext(), client, "req-7", "turn-7");
    const payload = capturedPayload();

    expect("seed" in payload).toBe(false);
  });

  it("goal_node_id falls back to graph goal node when absent from analysis_inputs", async () => {
    const inputsWithoutGoalNodeId = {
      options: MINIMAL_ANALYSIS_INPUTS!.options,
      // goal_node_id intentionally omitted
    };
    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(
      makeContext({ analysis_inputs: inputsWithoutGoalNodeId }),
      client,
      "req-8",
      "turn-8",
    );
    const payload = capturedPayload();

    // Falls back to the goal node in the graph (goal_1)
    expect(payload.goal_node_id).toBe("goal_1");
  });
});

// ============================================================================
// Suite 1d: Intervention normalisation — V3 nested shape → flat number
// ============================================================================

describe("PLoT request contract — intervention normalisation", () => {
  it("V3 nested { value: number } interventions are flattened to { factor_id: number }", async () => {
    const v3Inputs: ConversationContext["analysis_inputs"] = {
      options: [
        {
          option_id: "opt_a",
          label: "Option A",
          // V3 InterventionV3T shape: { value: number, source: ..., target_match: ... }
          interventions: {
            fac_price: { value: 100, source: "user_specified", target_match: {} },
          },
        },
      ],
      goal_node_id: "goal_1",
    };

    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext({ analysis_inputs: v3Inputs }), client, "req-9", "turn-9");
    const payload = capturedPayload();

    const options = payload.options as Array<Record<string, unknown>>;
    const interventions = options[0].interventions as Record<string, unknown>;
    // Must be normalised to flat number
    expect(interventions.fac_price).toBe(100);
    expect(typeof interventions.fac_price).toBe("number");
  });

  it("mixed flat and nested interventions across options both normalise correctly", async () => {
    const mixedInputs: ConversationContext["analysis_inputs"] = {
      options: [
        {
          option_id: "opt_a",
          label: "Flat",
          interventions: { fac_price: 100 },  // already flat
        },
        {
          option_id: "opt_b",
          label: "Nested",
          interventions: {
            fac_price: { value: 150, source: "user_specified", target_match: {} },
          },
        },
      ],
      goal_node_id: "goal_1",
    };

    const { client, capturedPayload } = makePLoTClientCapture();
    await handleRunAnalysis(makeContext({ analysis_inputs: mixedInputs }), client, "req-10", "turn-10");
    const payload = capturedPayload();

    const options = payload.options as Array<Record<string, unknown>>;
    const intA = options[0].interventions as Record<string, unknown>;
    const intB = options[1].interventions as Record<string, unknown>;

    expect(typeof intA.fac_price).toBe("number");
    expect(intA.fac_price).toBe(100);
    expect(typeof intB.fac_price).toBe("number");
    expect(intB.fac_price).toBe(150);
  });
});
