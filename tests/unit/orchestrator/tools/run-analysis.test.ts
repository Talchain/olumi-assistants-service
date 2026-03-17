import { describe, it, expect, vi } from "vitest";
import { handleRunAnalysis } from "../../../../src/orchestrator/tools/run-analysis.js";
import type { ConversationContext, V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { PLoTClient } from "../../../../src/orchestrator/plot-client.js";

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: { nodes: [], edges: [], version: "3.0" } as unknown as ConversationContext["graph"],
    analysis_response: null,
    framing: { stage: "evaluate" },
    messages: [],
    scenario_id: "test-scenario",
    analysis_inputs: {
      options: [
        { option_id: "opt_a", label: "Option A", interventions: { fac_price: { value: 1.2 } } },
        { option_id: "opt_b", label: "Option B", interventions: { fac_price: { value: 0.9 } } },
      ],
    },
    ...overrides,
  };
}

function makePLoTResponse(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
    meta: { seed_used: "42", n_samples: 1000, response_hash: "meta-hash" },
    results: [
      { option_label: "Option A", win_probability: 0.6 },
      { option_label: "Option B", win_probability: 0.4 },
    ],
    response_hash: "top-level-hash",
    ...overrides,
  } as V2RunResponseEnvelope;
}

function makeMockClient(response: V2RunResponseEnvelope): PLoTClient {
  return {
    run: vi.fn().mockResolvedValue(response),
    validatePatch: vi.fn().mockResolvedValue({}),
  };
}

describe("run_analysis Tool Handler", () => {
  it("calls PLoT and returns blocks + analysisResponse", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(
      makeContext(),
      client,
      "req-1",
      "turn-1",
    );

    expect(client.run).toHaveBeenCalledOnce();
    expect(result.analysisResponse).toBe(response);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reads response_hash from top-level first", async () => {
    const response = makePLoTResponse({ response_hash: "top-hash" });
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    expect(result.responseHash).toBe("top-hash");
  });

  it("falls back to meta.response_hash if top-level absent", async () => {
    const response = makePLoTResponse();
    delete (response as Record<string, unknown>).response_hash;
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    expect(result.responseHash).toBe("meta-hash");
  });

  it("parses seed_used as Number (arrives as string)", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    expect(result.seedUsed).toBe(42);
    expect(typeof result.seedUsed).toBe("number");
  });

  it("builds FactBlocks grouped by fact_type from fact_objects", async () => {
    const response = makePLoTResponse({
      fact_objects: [
        { fact_type: "option_comparison", fact_id: "f1", data: {} },
        { fact_type: "option_comparison", fact_id: "f2", data: {} },
        { fact_type: "sensitivity", fact_id: "f3", data: {} },
      ],
    });
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");

    const factBlocks = result.blocks.filter((b) => b.block_type === "fact");
    expect(factBlocks).toHaveLength(2); // option_comparison + sensitivity

    const optBlock = factBlocks.find((b) => (b.data as { fact_type: string }).fact_type === "option_comparison");
    expect((optBlock!.data as { facts: unknown[] }).facts).toHaveLength(2);

    const sensBlock = factBlocks.find((b) => (b.data as { fact_type: string }).fact_type === "sensitivity");
    expect((sensBlock!.data as { facts: unknown[] }).facts).toHaveLength(1);
  });

  it("skips FactBlocks when fact_objects is absent", async () => {
    const response = makePLoTResponse();
    // No fact_objects on response
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");

    const factBlocks = result.blocks.filter((b) => b.block_type === "fact");
    expect(factBlocks).toHaveLength(0);
  });

  it("skips FactBlocks when fact_objects is empty array", async () => {
    const response = makePLoTResponse({ fact_objects: [] });
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    expect(result.blocks.filter((b) => b.block_type === "fact")).toHaveLength(0);
  });

  it("builds ReviewCardBlocks from review_cards", async () => {
    const response = makePLoTResponse({
      review_cards: [{ title: "Card 1" }, { title: "Card 2" }],
    });
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");

    const reviewBlocks = result.blocks.filter((b) => b.block_type === "review_card");
    expect(reviewBlocks).toHaveLength(2);
  });

  it("skips ReviewCardBlocks when review_cards is absent", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);

    const result = await handleRunAnalysis(makeContext(), client, "req-1", "turn-1");
    expect(result.blocks.filter((b) => b.block_type === "review_card")).toHaveLength(0);
  });

  it("throws when no graph in context", async () => {
    const client = makeMockClient(makePLoTResponse());

    await expect(
      handleRunAnalysis(makeContext({ graph: null }), client, "req-1", "turn-1"),
    ).rejects.toThrow("no graph");
  });

  it("returns blocked analysis result when no analysis_inputs in context", async () => {
    const client = makeMockClient(makePLoTResponse());

    const result = await handleRunAnalysis(
      makeContext({ analysis_inputs: null }),
      client,
      "req-1",
      "turn-1",
    );

    expect(result.analysisResponse.analysis_status).toBe("blocked");
    expect(result.analysisResponse.retryable).toBe(false);
    expect(result.analysisResponse.results).toEqual([]);
    expect(result.analysisResponse.status_reason).toContain("intervention values");
    expect(result.analysisResponse.critiques).toEqual([
      expect.objectContaining({ code: "missing_analysis_inputs" }),
    ]);
  });

  it("returns blocked analysis result when options have empty interventions (Task 6)", async () => {
    const client = makeMockClient(makePLoTResponse());
    const ctx = makeContext({
      analysis_inputs: {
        options: [
          { option_id: "opt_a", label: "Option A", interventions: {} },
          { option_id: "opt_b", label: "Option B", interventions: { fac_price: { value: 1 } } },
        ],
      },
    });

    const result = await handleRunAnalysis(ctx, client, "req-1", "turn-1");

    expect(result.analysisResponse.analysis_status).toBe("blocked");
    expect(result.analysisResponse.retryable).toBe(false);
    expect(result.analysisResponse.status_reason).toContain('option "Option A" has no intervention values configured');
    expect(result.analysisResponse.critiques).toEqual([
      expect.objectContaining({
        code: "missing_interventions",
        labels: ["Option A"],
      }),
    ]);
  });

  it("sends only PLoT-allowlisted fields (no extra fields leak)", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "fac_1", kind: "factor", label: "Price", category: "controllable" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "opt_b", kind: "option", label: "Option B" },
        ],
        edges: [{ id: "e1", from: "fac_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 } }],
      } as unknown as ConversationContext["graph"],
      analysis_inputs: {
        options: [
          { option_id: "opt_a", label: "Option A", interventions: { fac_1: 0.5 } },
          { option_id: "opt_b", label: "Option B", interventions: { fac_1: 0.8 } },
        ],
        goal_node_id: "goal_1",
        constraints: [{ type: "min", target: "revenue", value: 100 }],
        seed: 42,
        n_samples: 500,
        // Extra field that should NOT be forwarded to PLoT
        session_id: "should-be-stripped",
        scenario_id: "should-be-stripped",
        context: { should: "be-stripped" },
      } as never,
    });

    await handleRunAnalysis(ctx, client, "req-1", "turn-1");

    const payload = (client.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    // Allowlisted fields present
    expect(payload.graph).toBeDefined();
    expect(payload.options).toHaveLength(2);
    expect(payload.goal_node_id).toBe("goal_1");
    expect(payload.request_id).toBe("req-1");
    expect(payload.seed).toBe(42);
    expect(payload.n_samples).toBe(500);
    // constraints → goal_constraints (PLoT field name)
    expect(payload.goal_constraints).toEqual([{ type: "min", target: "revenue", value: 100 }]);
    expect(payload).not.toHaveProperty("constraints");
    // options[].id derived from option_id (PLoT requires id)
    const opts = payload.options as Array<Record<string, unknown>>;
    expect(opts[0].id).toBe("opt_a");
    expect(opts[1].id).toBe("opt_b");
    // Extra fields stripped
    expect(payload).not.toHaveProperty("session_id");
    expect(payload).not.toHaveProperty("scenario_id");
    expect(payload).not.toHaveProperty("context");
  });

  it("strips unknown option-level keys (only id, option_id, label, interventions)", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Rev" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "opt_b", kind: "option", label: "B" },
          { id: "fac_1", kind: "factor", label: "P", category: "controllable" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
      analysis_inputs: {
        options: [
          {
            option_id: "opt_a", label: "A", interventions: { fac_1: 0.5 },
            status: "ready", provenance: { source: "brief" }, unresolved_targets: ["x"],
          } as never,
          { option_id: "opt_b", label: "B", interventions: { fac_1: 0.8 } },
        ],
        goal_node_id: "g1",
      } as never,
    });

    await handleRunAnalysis(ctx, client, "req-1", "turn-1");

    const payload = (client.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    const opts = payload.options as Array<Record<string, unknown>>;
    // Only allowlisted keys present
    expect(Object.keys(opts[0]).sort()).toEqual(["id", "interventions", "label", "option_id"]);
    expect(opts[0]).not.toHaveProperty("status");
    expect(opts[0]).not.toHaveProperty("provenance");
    expect(opts[0]).not.toHaveProperty("unresolved_targets");
  });

  it("normalizes V3 intervention objects to flat { factor_id: number }", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Rev" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "opt_b", kind: "option", label: "B" },
          { id: "fac_1", kind: "factor", label: "P", category: "controllable" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
      analysis_inputs: {
        options: [
          {
            option_id: "opt_a", label: "A",
            interventions: { fac_1: { value: 0.7, source: "brief_extraction", target_match: "direct" } },
          } as never,
          { option_id: "opt_b", label: "B", interventions: { fac_1: 0.3 } },
        ],
        goal_node_id: "g1",
      } as never,
    });

    await handleRunAnalysis(ctx, client, "req-1", "turn-1");

    const payload = (client.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    const opts = payload.options as Array<Record<string, unknown>>;
    // V3 object normalized to plain number
    expect(opts[0].interventions).toEqual({ fac_1: 0.7 });
    // Already-numeric stays numeric
    expect(opts[1].interventions).toEqual({ fac_1: 0.3 });
  });

  it("throws on non-normalizable intervention value", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Rev" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "opt_b", kind: "option", label: "B" },
          { id: "fac_1", kind: "factor", label: "P", category: "controllable" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
      analysis_inputs: {
        options: [
          { option_id: "opt_a", label: "A", interventions: { fac_1: "not-a-number" } },
          { option_id: "opt_b", label: "B", interventions: { fac_1: 0.8 } },
        ],
        goal_node_id: "g1",
      } as never,
    });

    await expect(
      handleRunAnalysis(ctx, client, "req-1", "turn-1"),
    ).rejects.toThrow(/Cannot normalize intervention/);
  });

  it("produces exact PLoT-compatible payload shape", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "opt_b", kind: "option", label: "B" },
          { id: "fac_1", kind: "factor", label: "Price", category: "controllable" },
        ],
        edges: [{ id: "e1", from: "fac_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 } }],
      } as unknown as ConversationContext["graph"],
      analysis_inputs: {
        options: [
          { option_id: "opt_a", label: "A", interventions: { fac_1: 0.5 } },
          { option_id: "opt_b", label: "B", interventions: { fac_1: 0.8 } },
        ],
        goal_node_id: "goal_1",
        seed: 42,
      } as never,
    });

    await handleRunAnalysis(ctx, client, "req-1", "turn-1");

    const payload = (client.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    // Only PLoT-allowlisted top-level keys
    const topKeys = Object.keys(payload).sort();
    expect(topKeys).toEqual(["goal_node_id", "graph", "options", "request_id", "seed"]);
    // Each option has exactly 4 keys
    const opts = payload.options as Array<Record<string, unknown>>;
    for (const opt of opts) {
      expect(Object.keys(opt).sort()).toEqual(["id", "interventions", "label", "option_id"]);
      // Interventions are flat numeric
      for (const val of Object.values(opt.interventions as Record<string, unknown>)) {
        expect(typeof val).toBe("number");
      }
    }
  });

  it("derives goal_node_id from graph when not in analysis_inputs", async () => {
    const response = makePLoTResponse();
    const client = makeMockClient(response);
    const ctx = makeContext({
      graph: {
        nodes: [
          { id: "g1", kind: "goal", label: "Revenue" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "opt_b", kind: "option", label: "B" },
          { id: "fac_1", kind: "factor", label: "Price", category: "controllable" },
        ],
        edges: [],
      } as unknown as ConversationContext["graph"],
      analysis_inputs: {
        options: [
          { option_id: "opt_a", label: "A", interventions: { fac_1: 1 } },
          { option_id: "opt_b", label: "B", interventions: { fac_1: 2 } },
        ],
        // No goal_node_id — should be derived from graph
      },
    });

    await handleRunAnalysis(ctx, client, "req-1", "turn-1");

    const payload = (client.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.goal_node_id).toBe("g1");
  });
});
