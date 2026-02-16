/**
 * Stage 1: Parse — Unit Tests
 *
 * Verifies attachment grounding, confidence/clarifier, LLM call with retry,
 * graph shape assertion (before stash), edge field stash freeze, budget guard,
 * and cost calculation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must be before imports) ──────────────────────────────────────────

vi.mock("../../src/routes/assist.draft-graph.js", () => ({
  groundAttachments: vi.fn(),
  buildRefinementBrief: vi.fn(),
}));

vi.mock("../../src/utils/confidence.js", () => ({
  calcConfidence: vi.fn(),
  shouldClarify: vi.fn(),
}));

vi.mock("../../src/utils/costGuard.js", () => ({
  estimateTokens: vi.fn().mockReturnValue(100),
  allowedCostUSD: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPromptMeta: vi.fn().mockReturnValue({ modelConfig: null }),
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      refinementEnabled: false,
    },
  },
  shouldUseStagingPrompts: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/cee/unified-pipeline/edge-identity.js", () => ({
  createEdgeFieldStash: vi.fn(),
}));

vi.mock("../../src/cee/transforms/graph-normalisation.js", () => ({
  normaliseCeeGraphVersionAndProvenance: vi.fn(),
}));

vi.mock("../../src/config/timeouts.js", () => ({
  DRAFT_REQUEST_BUDGET_MS: 90_000,
  DRAFT_LLM_TIMEOUT_MS: 80_000,
  LLM_POST_PROCESSING_HEADROOM_MS: 10_000,
  REPAIR_TIMEOUT_MS: 10_000,
  getJitteredRetryDelayMs: vi.fn().mockReturnValue(0),
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string, meta?: any) => ({
    error: { code, message: msg, ...meta },
  }),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0.01),
  TelemetryEvents: { Stage: "Stage", DraftUpstreamError: "DraftUpstreamError" },
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { groundAttachments, buildRefinementBrief } from "../../src/routes/assist.draft-graph.js";
import { calcConfidence, shouldClarify } from "../../src/utils/confidence.js";
import { allowedCostUSD } from "../../src/utils/costGuard.js";
import { getAdapter } from "../../src/adapters/llm/router.js";
import { UpstreamTimeoutError, ClientDisconnectError } from "../../src/adapters/llm/errors.js";
import { createEdgeFieldStash } from "../../src/cee/unified-pipeline/edge-identity.js";
import { normaliseCeeGraphVersionAndProvenance } from "../../src/cee/transforms/graph-normalisation.js";
import { config } from "../../src/config/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const validGraph = {
  nodes: [
    { id: "g1", kind: "goal", label: "Goal" },
    { id: "o1", kind: "option", label: "Option" },
  ],
  edges: [
    { id: "e1", from: "o1", to: "g1", strength_mean: 0.7 },
  ],
  version: "1.2",
};

function makeCtx(overrides?: Partial<Record<string, any>>): any {
  return {
    requestId: "test-req",
    input: { brief: "A sufficiently long brief for testing", flags: null, include_debug: false },
    rawBody: {},
    request: { id: "req-1", headers: {}, query: {}, raw: { destroyed: false } },
    opts: { schemaVersion: "v3" as const, requestStartMs: Date.now() },
    start: Date.now(),
    graph: undefined,
    rationales: [],
    draftCost: 0,
    draftAdapter: undefined,
    llmMeta: undefined,
    confidence: undefined,
    clarifierStatus: undefined,
    effectiveBrief: "A sufficiently long brief for testing",
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 0,
    draftDurationMs: 0,
    collector: { add: vi.fn(), addByStage: vi.fn() },
    ...overrides,
  };
}

const mockAdapter = {
  name: "openai",
  model: "gpt-4o",
  draftGraph: vi.fn(),
};

function setupMocks(overrides?: {
  graph?: any;
  attachmentError?: Error;
  costGuardFail?: boolean;
  confidence?: number;
  shouldClarifyResult?: boolean;
}) {
  // Reset
  vi.clearAllMocks();

  // groundAttachments
  if (overrides?.attachmentError) {
    (groundAttachments as any).mockRejectedValue(overrides.attachmentError);
  } else {
    (groundAttachments as any).mockResolvedValue({ docs: [] });
  }

  // confidence
  (calcConfidence as any).mockReturnValue(overrides?.confidence ?? 0.85);
  (shouldClarify as any).mockReturnValue(overrides?.shouldClarifyResult ?? false);

  // cost guard
  (allowedCostUSD as any).mockReturnValue(!(overrides?.costGuardFail ?? false));

  // adapter
  const graph = overrides?.graph ?? { ...validGraph, nodes: [...validGraph.nodes], edges: [...validGraph.edges] };
  mockAdapter.draftGraph.mockResolvedValue({
    graph,
    rationales: [{ target: "g1", why: "test" }],
    usage: { input_tokens: 500, output_tokens: 200 },
    meta: { model: "gpt-4o" },
  });
  (getAdapter as any).mockReturnValue(mockAdapter);

  // edge stash
  const stash = {
    byEdgeId: { e1: { strength_mean: 0.7 } },
    byFromTo: { "o1::g1": { strength_mean: 0.7 } },
  };
  (createEdgeFieldStash as any).mockReturnValue(stash);

  // normalisation — return graph as-is
  (normaliseCeeGraphVersionAndProvenance as any).mockImplementation((g: any) => g);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runStageParse", () => {
  beforeEach(() => {
    setupMocks();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it("sets ctx.graph, edgeFieldStash, confidence, and rationales on happy path", async () => {
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.graph).toBeDefined();
    expect(ctx.graph.nodes).toHaveLength(2);
    expect(ctx.edgeFieldStash).toBeDefined();
    expect(ctx.confidence).toBe(0.85);
    expect(ctx.rationales).toHaveLength(1);
    expect(ctx.draftAdapter).toBe(mockAdapter);
    expect(ctx.draftCost).toBe(0.01);
    expect(ctx.draftDurationMs).toBeGreaterThanOrEqual(0);
  });

  // ── Attachment failure ──────────────────────────────────────────────────

  it("returns earlyReturn 400 when groundAttachments throws", async () => {
    setupMocks({ attachmentError: new Error("bad file") });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn!.statusCode).toBe(400);
    expect((ctx.earlyReturn!.body as any).error.code).toBe("CEE_VALIDATION_FAILED");
    expect(ctx.graph).toBeUndefined();
  });

  // ── Cost guard ──────────────────────────────────────────────────────────

  it("returns earlyReturn 429 when cost guard fails", async () => {
    setupMocks({ costGuardFail: true });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn!.statusCode).toBe(429);
    expect((ctx.earlyReturn!.body as any).error.code).toBe("CEE_RATE_LIMIT");
    expect(mockAdapter.draftGraph).not.toHaveBeenCalled();
  });

  // ── Malformed graph → earlyReturn before stash (change 2) ─────────────

  it("returns earlyReturn 400 for malformed graph (nodes not array) before stash creation", async () => {
    setupMocks({ graph: { nodes: "not-an-array", edges: [] } });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn!.statusCode).toBe(400);
    expect((ctx.earlyReturn!.body as any).error.code).toBe("CEE_GRAPH_INVALID");
    // Stash must NOT have been created (change 2: shape assertion before stash)
    expect(createEdgeFieldStash).not.toHaveBeenCalled();
    expect(ctx.edgeFieldStash).toBeUndefined();
  });

  it("returns earlyReturn 400 for malformed graph (edges not array)", async () => {
    setupMocks({ graph: { nodes: [], edges: null } });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn!.statusCode).toBe(400);
    expect((ctx.earlyReturn!.body as any).error.code).toBe("CEE_GRAPH_INVALID");
    expect(createEdgeFieldStash).not.toHaveBeenCalled();
  });

  // ── Stash freeze (change 1) ───────────────────────────────────────────

  it("freezes edge field stash Records after creation", async () => {
    const stash = {
      byEdgeId: { e1: { strength_mean: 0.7 } },
      byFromTo: { "o1::g1": { strength_mean: 0.7 } },
    };
    (createEdgeFieldStash as any).mockReturnValue(stash);

    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.edgeFieldStash).toBeDefined();
    expect(Object.isFrozen(ctx.edgeFieldStash!.byEdgeId)).toBe(true);
    expect(Object.isFrozen(ctx.edgeFieldStash!.byFromTo)).toBe(true);
  });

  // ── LLM timeout retry ────────────────────────────────────────────────

  it("retries once on timeout then succeeds", async () => {
    setupMocks();
    const timeoutErr = new Error("timeout");
    timeoutErr.name = "UpstreamTimeoutError";

    // First call times out, second succeeds
    mockAdapter.draftGraph
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce({
        graph: { ...validGraph, nodes: [...validGraph.nodes], edges: [...validGraph.edges] },
        rationales: [],
        usage: { input_tokens: 500, output_tokens: 200 },
        meta: { model: "gpt-4o" },
      });

    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.graph).toBeDefined();
    expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(2);
  });

  it("throws LLMTimeoutError after 2 timeout failures", async () => {
    setupMocks();
    const timeoutErr = new Error("timeout");
    timeoutErr.name = "UpstreamTimeoutError";

    mockAdapter.draftGraph
      .mockRejectedValueOnce(timeoutErr)
      .mockRejectedValueOnce(timeoutErr);

    const ctx = makeCtx();
    await expect(runStageParse(ctx)).rejects.toThrow("did not respond");
  });

  // ── Budget exceeded ───────────────────────────────────────────────────

  it("throws RequestBudgetExceededError when elapsed exceeds budget", async () => {
    setupMocks();
    // Set requestStartMs far in the past to exceed 90s budget
    const ctx = makeCtx({ opts: { schemaVersion: "v3", requestStartMs: Date.now() - 100_000 } });

    await expect(runStageParse(ctx)).rejects.toThrow("budget");
  });

  // ── Repair budget computation ─────────────────────────────────────────

  it("sets skipRepairDueToBudget when remaining time is insufficient", async () => {
    setupMocks();
    // Budget-aware: skip when effectiveRepairTimeout <= 0
    // Formula: remaining = 90s - elapsed - 10s headroom; effective = min(20s, remaining - 2s safety)
    // Need remaining <= 2s → elapsed >= 78s
    const ctx = makeCtx({ opts: { schemaVersion: "v3", requestStartMs: Date.now() - 79_000 } });
    await runStageParse(ctx);

    expect(ctx.skipRepairDueToBudget).toBe(true);
  });

  it("uses budget-aware effective repair timeout when time is limited", async () => {
    setupMocks();
    // Elapsed 75s → remaining = 90 - 75 - 10 = 5s → effective = min(20, 5 - 2) = 3s
    const ctx = makeCtx({ opts: { schemaVersion: "v3", requestStartMs: Date.now() - 75_000 } });
    await runStageParse(ctx);

    expect(ctx.skipRepairDueToBudget).toBe(false);
    expect(ctx.repairTimeoutMs).toBeLessThanOrEqual(3000);
    expect(ctx.repairTimeoutMs).toBeGreaterThan(0);
  });

  // ── Confidence / clarifier ────────────────────────────────────────────

  it("sets clarifierStatus to 'confident' when confidence >= 0.9", async () => {
    setupMocks({ confidence: 0.95 });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.confidence).toBe(0.95);
    expect(ctx.clarifierStatus).toBe("confident");
  });

  it("sets clarifierStatus to 'max_rounds' when shouldClarify returns true", async () => {
    setupMocks({ confidence: 0.5, shouldClarifyResult: true });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.confidence).toBe(0.5);
    expect(ctx.clarifierStatus).toBe("max_rounds");
  });

  it("sets clarifierStatus to 'complete' when low confidence but shouldClarify is false", async () => {
    setupMocks({ confidence: 0.5, shouldClarifyResult: false });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.clarifierStatus).toBe("complete");
  });

  // ── Refinement brief ──────────────────────────────────────────────────

  it("calls buildRefinementBrief when refinementEnabled and previous_graph present", async () => {
    setupMocks();
    (config as any).cee.refinementEnabled = true;
    (buildRefinementBrief as any).mockReturnValue("refined brief text");

    const ctx = makeCtx({
      input: {
        brief: "Test brief",
        previous_graph: { nodes: [], edges: [], version: "1.2" },
        flags: null,
        include_debug: false,
      },
    });
    await runStageParse(ctx);

    expect(buildRefinementBrief).toHaveBeenCalledOnce();
    expect(ctx.effectiveBrief).toBe("refined brief text");

    // Restore
    (config as any).cee.refinementEnabled = false;
  });

  // ── Pre-aborted signal → ClientDisconnectError (regression) ────────────

  it("throws ClientDisconnectError (not LLMTimeoutError) for pre_aborted UpstreamTimeoutError", async () => {
    setupMocks();
    const preAbortedErr = new UpstreamTimeoutError(
      "OpenAI draft_graph aborted before LLM call started (possible client disconnect)",
      "openai",
      "draft_graph",
      "pre_aborted",
      1,
      { name: "AbortError", message: "The operation was aborted." },
    );

    mockAdapter.draftGraph.mockRejectedValueOnce(preAbortedErr);

    const ctx = makeCtx();
    await expect(runStageParse(ctx)).rejects.toThrow(ClientDisconnectError);
    // Must NOT retry — only 1 adapter call
    expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(1);
  });

  it("pre_aborted UpstreamTimeoutError does not surface as LLMTimeoutError", async () => {
    setupMocks();
    const preAbortedErr = new UpstreamTimeoutError(
      "OpenAI draft_graph aborted before LLM call started (possible client disconnect)",
      "openai",
      "draft_graph",
      "pre_aborted",
      2,
      { name: "AbortError", message: "The operation was aborted." },
    );

    mockAdapter.draftGraph.mockRejectedValueOnce(preAbortedErr);

    const ctx = makeCtx();
    try {
      await runStageParse(ctx);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ClientDisconnectError);
      expect(err).not.toBeInstanceOf(UpstreamTimeoutError);
      expect((err as any).message).toContain("Client disconnected");
    }
  });

  it("body UpstreamTimeoutError still retries and throws LLMTimeoutError (not ClientDisconnectError)", async () => {
    setupMocks();
    const bodyTimeoutErr = new UpstreamTimeoutError(
      "OpenAI draft_graph timed out",
      "openai",
      "draft_graph",
      "body",
      80000,
      { name: "AbortError", message: "The operation was aborted." },
    );

    mockAdapter.draftGraph
      .mockRejectedValueOnce(bodyTimeoutErr)
      .mockRejectedValueOnce(bodyTimeoutErr);

    const ctx = makeCtx();
    try {
      await runStageParse(ctx);
      expect.unreachable("Should have thrown");
    } catch (err) {
      // Must be LLMTimeoutError, NOT ClientDisconnectError
      expect((err as any).name).toBe("LLMTimeoutError");
      expect(err).not.toBeInstanceOf(ClientDisconnectError);
      // Must have retried (2 attempts)
      expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(2);
    }
  });
});
