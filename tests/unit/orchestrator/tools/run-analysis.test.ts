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
        { option_id: "opt_a", label: "Option A", interventions: {} },
        { option_id: "opt_b", label: "Option B", interventions: {} },
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

  it("throws when no analysis_inputs in context", async () => {
    const client = makeMockClient(makePLoTResponse());

    await expect(
      handleRunAnalysis(
        makeContext({ analysis_inputs: null }),
        client,
        "req-1",
        "turn-1",
      ),
    ).rejects.toThrow("no analysis_inputs");
  });
});
