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
  getAdapterWithResolution: vi.fn(),
  getMaxTokensFromConfig: () => undefined,
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

vi.mock("../../src/config/timeouts.js", async (importOriginal) => ({
  // Spread the real module so newly added exports (e.g. MIN_DRAFT_RETRY_BUDGET_MS,
  // getDraftLlmRetryBudgetMs) flow through automatically instead of silently
  // becoming undefined — a hand-listed mock factory is the mirror that drifts.
  ...(await importOriginal<typeof import("../../src/config/timeouts.js")>()),
  DRAFT_REQUEST_BUDGET_MS: 120_000,
  DRAFT_LLM_TIMEOUT_MS: 105_000,
  LLM_POST_PROCESSING_HEADROOM_MS: 15_000,
  REPAIR_TIMEOUT_MS: 10_000,
  getJitteredRetryDelayMs: vi.fn().mockReturnValue(0),
}));

vi.mock("../../src/cee/validation/integrity-sentinel.js", () => ({
  // Default: no default-strength signature detected — preserves the behaviour
  // every pre-existing test ran under (the flag is off in the config mock
  // anyway). Individual tests flip the return value to exercise the
  // strength-default retry path.
  detectStrengthDefaultsV1: vi.fn().mockReturnValue({
    detected: false,
    total_edges: 1,
    defaulted_count: 0,
    defaulted_edge_ids: [],
  }),
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
import { getAdapter, getAdapterWithResolution } from "../../src/adapters/llm/router.js";
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
  // Once-queues survive vi.clearAllMocks(); a test that legitimately leaves an
  // unconsumed mockResolvedValueOnce/mockRejectedValueOnce (e.g. the budget
  // gate suppressing attempt 2) must not leak it into the next test.
  mockAdapter.draftGraph.mockReset();

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
  (getAdapterWithResolution as any).mockReturnValue({
    adapter: mockAdapter,
    resolution: {
      task: 'draft_graph',
      resolved_model: 'gpt-4o',
      resolution_source: 'task_default',
    },
  });

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

  it("returns earlyReturn 429 with CEE_COST_CAP when cost guard fails", async () => {
    setupMocks({ costGuardFail: true });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn!.statusCode).toBe(429);
    // Per-request $ cap (allowedCostUSD) — a SPEND cap, not an RPM throttle
    // and not an elapsed-time deadline. See
    // tests/unit/cee.error-code-taxonomy.test.ts for the family contract.
    expect((ctx.earlyReturn!.body as any).error.code).toBe("CEE_COST_CAP");
    expect((ctx.earlyReturn!.body as any).error.code).not.toBe("CEE_RATE_LIMIT");
    expect((ctx.earlyReturn!.body as any).error.code).not.toBe("CEE_BUDGET_EXCEEDED");
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

  // ── Retry budget coherence (2026-07-20 staging outage RCA) ────────────
  //
  // A first attempt that burns its full 105s window leaves ZERO affordable
  // budget (120s − 105s − 15s headroom = 0): the old unconditional retry
  // produced a 211s worst case against a 125s browser-proxy deadline, and
  // CEE's own Step-11 budget guard discarded both retry successes observed
  // in the outage window. The retry must be gated on remaining budget.

  it("does NOT retry when the first timeout consumed the request budget (ladder coherence)", async () => {
    setupMocks();
    const timeoutErr = new Error("timeout");
    timeoutErr.name = "UpstreamTimeoutError";

    // First attempt times out having consumed its full 105s window; a second
    // attempt WOULD succeed — but must never be launched, because the
    // remaining budget (120 − 105 − 15 = 0) cannot fit a real draft and the
    // Step-11 budget guard would discard the result anyway.
    mockAdapter.draftGraph
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce({
        graph: { ...validGraph, nodes: [...validGraph.nodes], edges: [...validGraph.edges] },
        rationales: [],
        usage: { input_tokens: 500, output_tokens: 200 },
        meta: { model: "gpt-4o" },
      });

    const ctx = makeCtx({
      opts: { schemaVersion: "v3", requestStartMs: Date.now() - 105_000 },
    });

    await expect(runStageParse(ctx)).rejects.toThrow("did not respond");
    expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(1);
  });

  it("caps the retry attempt's timeoutMs to the remaining request budget", async () => {
    setupMocks();
    const timeoutErr = new Error("timeout");
    timeoutErr.name = "UpstreamTimeoutError";

    // First attempt fails fast (e.g. connect-phase failure) 40s into the
    // request: retry is affordable (120 − 40 − 10 = 70s ≥ 55s minimum) but
    // must be CAPPED to the remaining window, not handed a fresh 110s.
    mockAdapter.draftGraph
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce({
        graph: { ...validGraph, nodes: [...validGraph.nodes], edges: [...validGraph.edges] },
        rationales: [],
        usage: { input_tokens: 500, output_tokens: 200 },
        meta: { model: "gpt-4o" },
      });

    const ctx = makeCtx({
      opts: { schemaVersion: "v3", requestStartMs: Date.now() - 40_000 },
    });

    await runStageParse(ctx);

    expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(2);
    const retryOpts = mockAdapter.draftGraph.mock.calls[1][1];
    expect(retryOpts.timeoutMs).toBeLessThanOrEqual(70_000);
    expect(retryOpts.timeoutMs).toBeGreaterThanOrEqual(55_000);
  });

  it("does NOT retry into a window smaller than the slowest observed draft (floor re-anchor)", async () => {
    setupMocks();
    const timeoutErr = new Error("timeout");
    timeoutErr.name = "UpstreamTimeoutError";

    // First attempt fails 60s into the request: remaining window =
    // 120 − 60 − 10 = 50s. Successful drafts run 37.9–54.6s (p95 53.7s,
    // recurrence RCA 2026-07-20), so a 50s window fails p95+ drafts — the
    // retry would usually burn a second LLM call to return the same error.
    // The 55s floor (adversarial-review condition 1) refuses it; the old
    // 35s floor would have launched it.
    mockAdapter.draftGraph
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce({
        graph: { ...validGraph, nodes: [...validGraph.nodes], edges: [...validGraph.edges] },
        rationales: [],
        usage: { input_tokens: 500, output_tokens: 200 },
        meta: { model: "gpt-4o" },
      });

    const ctx = makeCtx({
      opts: { schemaVersion: "v3", requestStartMs: Date.now() - 60_000 },
    });

    await expect(runStageParse(ctx)).rejects.toThrow("did not respond");
    expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(1);
  });

  it("still retries a fast-failing timeout when budget is affordable (existing behaviour preserved)", async () => {
    setupMocks();
    const timeoutErr = new Error("timeout");
    timeoutErr.name = "UpstreamTimeoutError";

    mockAdapter.draftGraph
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce({
        graph: { ...validGraph, nodes: [...validGraph.nodes], edges: [...validGraph.edges] },
        rationales: [],
        usage: { input_tokens: 500, output_tokens: 200 },
        meta: { model: "gpt-4o" },
      });

    // Fresh request: near-zero elapsed → full retry window affordable.
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(2);
  });

  it("skips the strength-default retry when the remaining budget cannot fit another attempt", async () => {
    setupMocks();
    const { detectStrengthDefaultsV1 } = await import("../../src/cee/validation/integrity-sentinel.js");
    (detectStrengthDefaultsV1 as any).mockReturnValue({
      detected: true,
      total_edges: 1,
      defaulted_count: 1,
      defaulted_edge_ids: ["e1"],
    });
    (config as any).cee.retryOnDefaultStrengths = true;

    try {
      // 100s elapsed → remaining window = 120 − 100 − 15 = 5s < 35s minimum.
      // Without the gate, the nudge retry would launch into a window it cannot
      // complete, converting a usable (defaulted) SUCCESS into a timeout error.
      const ctx = makeCtx({
        opts: { schemaVersion: "v3", requestStartMs: Date.now() - 100_000 },
      });
      await runStageParse(ctx);

      expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(1);
      expect(ctx.graph).toBeDefined();
      expect(ctx.strengthDefaultDetection?.detected).toBe(true);
    } finally {
      delete (config as any).cee.retryOnDefaultStrengths;
    }
  });

  it("still performs the strength-default retry when budget is affordable", async () => {
    setupMocks();
    const { detectStrengthDefaultsV1 } = await import("../../src/cee/validation/integrity-sentinel.js");
    (detectStrengthDefaultsV1 as any).mockReturnValue({
      detected: true,
      total_edges: 1,
      defaulted_count: 1,
      defaulted_edge_ids: ["e1"],
    });
    (config as any).cee.retryOnDefaultStrengths = true;

    try {
      const ctx = makeCtx(); // near-zero elapsed → retry affordable
      await runStageParse(ctx);

      expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(2);
      expect(ctx.graph).toBeDefined();
    } finally {
      delete (config as any).cee.retryOnDefaultStrengths;
    }
  });

  // ── Budget exceeded ───────────────────────────────────────────────────

  it("throws RequestBudgetExceededError when elapsed exceeds budget", async () => {
    setupMocks();
    // Set requestStartMs far in the past to exceed 120s budget
    const ctx = makeCtx({ opts: { schemaVersion: "v3", requestStartMs: Date.now() - 130_000 } });

    await expect(runStageParse(ctx)).rejects.toThrow("budget");
  });

  // ── Repair budget computation ─────────────────────────────────────────

  it("sets skipRepairDueToBudget when remaining time is insufficient", async () => {
    setupMocks();
    // Budget-aware: skip when effectiveRepairTimeout <= 0
    // Formula: remaining = 120s - elapsed - 15s headroom; effective = min(10s, remaining - 2s safety)
    // Need remaining <= 2s → elapsed >= 103s
    const ctx = makeCtx({ opts: { schemaVersion: "v3", requestStartMs: Date.now() - 104_000 } });
    await runStageParse(ctx);

    expect(ctx.skipRepairDueToBudget).toBe(true);
  });

  it("uses budget-aware effective repair timeout when time is limited", async () => {
    setupMocks();
    // Elapsed 100s → remaining = 120 - 100 - 15 = 5s → effective = min(10, 5 - 2) = 3s
    const ctx = makeCtx({ opts: { schemaVersion: "v3", requestStartMs: Date.now() - 100_000 } });
    await runStageParse(ctx);

    expect(ctx.skipRepairDueToBudget).toBe(false);
    expect(ctx.repairTimeoutMs).toBeLessThanOrEqual(3000);
    expect(ctx.repairTimeoutMs).toBeGreaterThan(0);
  });

  // ── Confidence ────────────────────────────────────────────────────────
  // (ctx.clarifierStatus derivation removed 2026-07-16 with the Stage-4
  // clarifier retirement — the field was write-only, zero readers.)

  it("sets ctx.confidence from calcConfidence", async () => {
    setupMocks({ confidence: 0.95 });
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.confidence).toBe(0.95);
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
