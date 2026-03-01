import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleTurnV2, _clearNonceMap } from "../../../../src/orchestrator/pipeline/route-v2.js";
import type { OrchestratorTurnRequest } from "../../../../src/orchestrator/types.js";
import type { FastifyRequest } from "fastify";

// Mock executePipeline
vi.mock("../../../../src/orchestrator/pipeline/pipeline.js", () => ({
  executePipeline: vi.fn().mockResolvedValue({
    turn_id: "mock-turn",
    assistant_text: "Mock response",
    blocks: [],
    suggested_actions: [],
    lineage: { context_hash: "abc", dsk_version_hash: null },
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    science_ledger: { claims_used: [], techniques_used: [], scope_violations: [], phrasing_violations: [], rewrite_applied: false },
    progress_marker: { kind: "none" },
    observability: { triggers_fired: [], triggers_suppressed: [], intent_classification: "conversational", specialist_contributions: [], specialist_disagreement: null },
    turn_plan: { selected_tool: null, routing: "llm", long_running: false },
  }),
}));

// Mock production deps factories
vi.mock("../../../../src/orchestrator/pipeline/llm-client.js", () => ({
  createProductionLLMClient: vi.fn().mockReturnValue({
    chatWithTools: vi.fn(),
    chat: vi.fn(),
  }),
}));

vi.mock("../../../../src/orchestrator/pipeline/phase4-tools/index.js", () => ({
  createProductionToolDispatcher: vi.fn().mockReturnValue({
    dispatch: vi.fn(),
  }),
}));

// Mock idempotency
vi.mock("../../../../src/orchestrator/idempotency.js", () => ({
  getIdempotentResponse: vi.fn().mockReturnValue(null),
  setIdempotentResponse: vi.fn(),
  getInflightRequest: vi.fn().mockReturnValue(null),
  registerInflightRequest: vi.fn(),
}));

// Mock timeouts
vi.mock("../../../../src/config/timeouts.js", () => ({
  ORCHESTRATOR_TURN_BUDGET_MS: 30000,
  ORCHESTRATOR_TIMEOUT_MS: 25000,
}));

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    scenario_id: "test-scenario",
    client_turn_id: "client-1",
    message: "Hello",
    context: {
      graph: null,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: "test-scenario",
    },
    ...overrides,
  } as OrchestratorTurnRequest;
}

const mockFastifyRequest = {} as FastifyRequest;

describe("route-v2", () => {
  beforeEach(() => {
    _clearNonceMap();
    vi.clearAllMocks();
  });

  it("returns 200 with V2 envelope for valid request", async () => {
    const result = await handleTurnV2(makeRequest(), mockFastifyRequest, "req-1");
    expect(result.httpStatus).toBe(200);
    expect(result.envelope.turn_id).toBe("mock-turn");
    expect(result.envelope.assistant_text).toBe("Mock response");
  });

  it("accepts request when turn_nonce is absent (skip check)", async () => {
    const result = await handleTurnV2(makeRequest(), mockFastifyRequest, "req-1");
    expect(result.httpStatus).toBe(200);
  });

  it("accepts monotonically increasing nonce", async () => {
    const r1 = await handleTurnV2(makeRequest(), mockFastifyRequest, "req-1", 1);
    expect(r1.httpStatus).toBe(200);

    const r2 = await handleTurnV2(
      makeRequest({ client_turn_id: "client-2" }),
      mockFastifyRequest,
      "req-2",
      2,
    );
    expect(r2.httpStatus).toBe(200);
  });

  it("rejects stale turn nonce", async () => {
    // First request with nonce 5
    await handleTurnV2(makeRequest(), mockFastifyRequest, "req-1", 5);

    // Second request with nonce 3 (stale)
    const result = await handleTurnV2(
      makeRequest({ client_turn_id: "client-2" }),
      mockFastifyRequest,
      "req-2",
      3,
    );
    expect(result.httpStatus).toBe(409);
    expect(result.envelope.error).toBeDefined();
    expect(result.envelope.error!.code).toBe("STALE_TURN");
  });

  it("rejects equal nonce (replay)", async () => {
    await handleTurnV2(makeRequest(), mockFastifyRequest, "req-1", 5);

    const result = await handleTurnV2(
      makeRequest({ client_turn_id: "client-2" }),
      mockFastifyRequest,
      "req-2",
      5,
    );
    expect(result.httpStatus).toBe(409);
    expect(result.envelope.error!.code).toBe("STALE_TURN");
  });

  it("returns idempotent response when cached", async () => {
    const cachedEnvelope = {
      turn_id: "cached-turn",
      assistant_text: "Cached response",
      blocks: [],
      suggested_actions: [],
      lineage: { context_hash: "cached-hash", dsk_version_hash: null },
      stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
      science_ledger: { claims_used: [], techniques_used: [], scope_violations: [], phrasing_violations: [], rewrite_applied: false },
      progress_marker: { kind: "none" },
      observability: { triggers_fired: [], triggers_suppressed: [], intent_classification: "conversational", specialist_contributions: [], specialist_disagreement: null },
      turn_plan: { selected_tool: null, routing: "llm", long_running: false },
    };

    const { getIdempotentResponse } = await import("../../../../src/orchestrator/idempotency.js");
    (getIdempotentResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(cachedEnvelope);

    const result = await handleTurnV2(makeRequest(), mockFastifyRequest, "req-1");
    expect(result.httpStatus).toBe(200);
    // Deep-equal: the full envelope should be structurally identical
    expect(result.envelope).toEqual(cachedEnvelope);
  });

  it("idempotency check comes before nonce validation — retry with stale nonce returns cached envelope", async () => {
    // First request sets nonce to 5
    await handleTurnV2(makeRequest(), mockFastifyRequest, "req-1", 5);

    // A cached response exists for the same (scenario_id, client_turn_id)
    const cachedEnvelope = {
      turn_id: "original-turn",
      assistant_text: "Original response",
    };
    const { getIdempotentResponse } = await import("../../../../src/orchestrator/idempotency.js");
    (getIdempotentResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(cachedEnvelope);

    // Retry the SAME (scenario_id, client_turn_id) with a stale nonce
    // Should return cached envelope, NOT reject as STALE_TURN
    const result = await handleTurnV2(makeRequest(), mockFastifyRequest, "req-retry", 3);
    expect(result.httpStatus).toBe(200);
    expect(result.envelope.turn_id).toBe("original-turn");
    expect(result.envelope.error).toBeUndefined();
  });

  it("evicts oldest nonce entry when cache reaches 1000 entries", async () => {
    // Fill the nonce map with 1000 distinct scenario_ids
    for (let i = 0; i < 1000; i++) {
      await handleTurnV2(
        makeRequest({ scenario_id: `scenario-${i}`, client_turn_id: `ct-${i}` }),
        mockFastifyRequest,
        `req-${i}`,
        i + 1,
      );
    }

    // Insert the 1001st — should evict scenario-0
    await handleTurnV2(
      makeRequest({ scenario_id: "scenario-1000", client_turn_id: "ct-1000" }),
      mockFastifyRequest,
      "req-1000",
      1001,
    );

    // scenario-0 was evicted, so nonce 1 should be accepted again (no stale check)
    const r1 = await handleTurnV2(
      makeRequest({ scenario_id: "scenario-0", client_turn_id: "ct-fresh" }),
      mockFastifyRequest,
      "req-fresh",
      1,
    );
    expect(r1.httpStatus).toBe(200);

    // scenario-1000 should still be present — nonce 1001 is stale for it
    const r2 = await handleTurnV2(
      makeRequest({ scenario_id: "scenario-1000", client_turn_id: "ct-stale" }),
      mockFastifyRequest,
      "req-stale",
      1001,
    );
    expect(r2.httpStatus).toBe(409);
    expect(r2.envelope.error!.code).toBe("STALE_TURN");
  });

  it("returns 500 with error envelope when pipeline throws", async () => {
    const { executePipeline } = await import("../../../../src/orchestrator/pipeline/pipeline.js");
    (executePipeline as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unhandled crash"),
    );

    const result = await handleTurnV2(makeRequest(), mockFastifyRequest, "req-1");
    expect(result.httpStatus).toBe(500);
    expect(result.envelope.error).toBeDefined();
    expect(result.envelope.error!.code).toBe("PIPELINE_ERROR");
  });
});
