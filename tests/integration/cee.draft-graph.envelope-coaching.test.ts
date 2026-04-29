/**
 * Tier 1 — envelope-level draft_coaching wiring.
 *
 * Drives a draft_graph turn through `handleParallelGenerate` (V1
 * generate_model path) with a populated `DraftGraphResult` and asserts the
 * UI-facing `OrchestratorResponseEnvelope.draft_coaching` field is present,
 * typed end-to-end, and survives narrow projection. This sits one layer
 * below the Fastify route — `route.ts:338` calls `reply.send(envelope)`
 * with no Fastify response schema attached, so the envelope this test
 * inspects is byte-for-byte the final API response body. The
 * `validateV1EnvelopeContract` step (envelope.ts:134) only mutates blocks
 * and suggested_actions, never strips top-level keys, so `draft_coaching`
 * is invariant across that boundary.
 *
 * Two paths exercised:
 *  1. coaching LLM succeeds (assembleBothSucceeded) — full envelope.draft_coaching
 *  2. coaching LLM fails (assembleCoachingFailed) — fallback text + draft_coaching
 *     still present (because draftResult survived).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";

const mockChat = vi.fn();
vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: "test",
    model: "test-model",
    chat: (...args: unknown[]) => mockChat(...args),
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(4096),
}));

const mockHandleDraftGraph = vi.fn();
vi.mock("../../src/orchestrator/tools/draft-graph.js", () => ({
  handleDraftGraph: (...args: unknown[]) => mockHandleDraftGraph(...args),
}));

vi.mock("../../src/cee/unified-pipeline/index.js", () => ({
  runUnifiedPipeline: vi.fn(),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/orchestrator/context/hash.js", () => ({
  hashContext: vi.fn().mockReturnValue("test-hash-000"),
}));

const mockGetIdempotentResponse = vi.fn().mockReturnValue(null);
const mockGetInflightRequest = vi.fn().mockReturnValue(null);
vi.mock("../../src/orchestrator/idempotency.js", () => ({
  getIdempotentResponse: (...args: unknown[]) => mockGetIdempotentResponse(...args),
  setIdempotentResponse: vi.fn(),
  getInflightRequest: (...args: unknown[]) => mockGetInflightRequest(...args),
  registerInflightRequest: vi.fn(),
}));

const mockConfig = { features: { bilEnabled: false, moeSpikeEnabled: false, zone2Registry: false } };
vi.mock("../../src/config/index.js", () => ({
  config: new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'features') return mockConfig.features;
      return undefined;
    },
  }),
}));

vi.mock("../../src/orchestrator-v5/coaching/draft-coaching-log.js", () => ({
  appendDraftCoaching: vi.fn().mockResolvedValue(undefined),
}));

import { handleParallelGenerate } from "../../src/orchestrator/parallel-generate.js";
import type { OrchestratorTurnRequest, ConversationContext, DraftCoaching } from "../../src/orchestrator/types.js";
import type { DraftGraphResult } from "../../src/orchestrator/tools/draft-graph.js";

function makeTurnRequest(): OrchestratorTurnRequest {
  return {
    message: "Should we hire a senior engineer or scale with offshore partners over Q3?",
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: "frame" as const },
      messages: [],
      scenario_id: "test-scenario",
      analysis_inputs: null,
    } as unknown as ConversationContext,
    scenario_id: "test-scenario",
    client_turn_id: "envelope-coaching-001",
  };
}

function makeDraftResult(coaching: {
  coachingSummary: string | null;
  strengthenItems: DraftGraphResult['strengthenItems'];
  coachingWideningLog: readonly unknown[] | null;
  coachingBiasSignals: readonly unknown[] | null;
}): DraftGraphResult {
  return {
    blocks: [{
      block_id: "block-1",
      block_type: "graph_patch" as const,
      data: {
        patch_type: "full_draft" as const,
        operations: [],
        status: "proposed" as const,
        auto_apply: true,
      },
      provenance: { turn_id: "test-turn", trigger: "draft_graph", timestamp: new Date().toISOString() },
    }] as unknown as DraftGraphResult['blocks'],
    assistantText: null,
    latencyMs: 8000,
    strengthenItems: coaching.strengthenItems,
    coachingSummary: coaching.coachingSummary,
    coachingWideningLog: coaching.coachingWideningLog,
    coachingBiasSignals: coaching.coachingBiasSignals,
    draftWarnings: [],
    graphOutput: null,
  };
}

const fakeRequest = {} as FastifyRequest;

describe("Tier 1 — envelope.draft_coaching wiring (parallel_generate path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIdempotentResponse.mockReturnValue(null);
    mockGetInflightRequest.mockReturnValue(null);
  });

  it("populates envelope.draft_coaching when both calls succeed", async () => {
    const draftResult = makeDraftResult({
      coachingSummary: "Watch ramp-up time and seniority signal cost.",
      strengthenItems: [
        { id: "s1", label: "Ramp-up time", detail: "elaborate on onboarding curve", action_type: "evidence_needed" },
        { id: "s2", label: "Seniority signal", detail: "compare market rates", action_type: "structural_improvement", bias_category: "anchoring" },
      ],
      coachingWideningLog: [
        { node_id: "fac_ramp", label: "Ramp-up time", reason: "implicit in brief — broaden window" },
        { unrecognised: "shape" }, // expected to be dropped by narrow guard
      ],
      coachingBiasSignals: [
        { type: "anchoring", detail: "Anchored on £150k senior salary" },
        { type: "narrow_framing", detail: "Two options only — consider hybrid", target: "options" },
      ],
    });
    mockHandleDraftGraph.mockResolvedValue(draftResult);
    mockChat.mockResolvedValue({ content: "I see two distinct routes here..." });

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-envelope-1");

    expect(result.httpStatus).toBe(200);
    const draftCoaching = result.envelope.draft_coaching as DraftCoaching;
    expect(draftCoaching).toBeDefined();
    expect(draftCoaching.summary).toBe("Watch ramp-up time and seniority signal cost.");
    expect(draftCoaching.strengthen_items).toHaveLength(2);
    expect(draftCoaching.strengthen_items[0]).toMatchObject({ id: "s1", label: "Ramp-up time", action_type: "evidence_needed" });
    // widening_log: narrowed entry-by-entry — only entries matching the display
    // shape survive; the malformed second entry is dropped silently.
    expect(draftCoaching.widening_log).toEqual([
      { node_id: "fac_ramp", label: "Ramp-up time", reason: "implicit in brief — broaden window" },
    ]);
    // bias_signals: optional `target` round-trips when present, omitted when absent.
    expect(draftCoaching.bias_signals).toEqual([
      { type: "anchoring", detail: "Anchored on £150k senior salary" },
      { type: "narrow_framing", detail: "Two options only — consider hybrid", target: "options" },
    ]);
  });

  it("populates envelope.draft_coaching when coaching LLM fails (draft survived)", async () => {
    const draftResult = makeDraftResult({
      coachingSummary: "Coaching survives even when narration LLM fails.",
      strengthenItems: [{ id: "s1", label: "x", detail: "y", action_type: "z" }],
      coachingWideningLog: null,
      coachingBiasSignals: null,
    });
    mockHandleDraftGraph.mockResolvedValue(draftResult);
    mockChat.mockRejectedValue(new Error("upstream LLM 503"));

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-envelope-2");

    expect(result.httpStatus).toBe(200);
    const draftCoaching = result.envelope.draft_coaching as DraftCoaching;
    expect(draftCoaching).toBeDefined();
    expect(draftCoaching.summary).toBe("Coaching survives even when narration LLM fails.");
    expect(draftCoaching.strengthen_items).toHaveLength(1);
    expect(draftCoaching.widening_log).toBeNull();
    expect(draftCoaching.bias_signals).toBeNull();
  });

  it("omits envelope.draft_coaching when draft_graph itself fails", async () => {
    mockHandleDraftGraph.mockRejectedValue(new Error("Pipeline timeout"));
    mockChat.mockResolvedValue({ content: "still helpful coaching text here." });

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-envelope-3");

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.draft_coaching).toBeUndefined();
  });

  it("omits envelope.draft_coaching when both calls fail", async () => {
    mockHandleDraftGraph.mockRejectedValue(new Error("Pipeline timeout"));
    mockChat.mockRejectedValue(new Error("LLM down"));

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-envelope-4");

    expect(result.httpStatus).toBe(500);
    expect(result.envelope.draft_coaching).toBeUndefined();
  });

  it("draft_coaching is JSON-serialisable (proxy for final wire body)", async () => {
    const draftResult = makeDraftResult({
      coachingSummary: "wire-shape sanity check",
      strengthenItems: [{ id: "s", label: "l", detail: "d", action_type: "a" }],
      coachingWideningLog: [{ node_id: "n", label: "l", reason: "r" }],
      coachingBiasSignals: [{ type: "t", detail: "d" }],
    });
    mockHandleDraftGraph.mockResolvedValue(draftResult);
    mockChat.mockResolvedValue({ content: "ok" });

    const result = await handleParallelGenerate(makeTurnRequest(), fakeRequest, "req-envelope-5");

    // Round-trip through JSON to mimic Fastify's reply.send serialisation —
    // catches any non-serialisable values (Symbols, functions, Maps) that
    // would silently drop on the wire even though the typed object passes.
    const wire = JSON.parse(JSON.stringify(result.envelope));
    expect(wire.draft_coaching).toBeDefined();
    expect(wire.draft_coaching.summary).toBe("wire-shape sanity check");
    expect(wire.draft_coaching.widening_log[0]).toEqual({ node_id: "n", label: "l", reason: "r" });
    expect(wire.draft_coaching.bias_signals[0]).toEqual({ type: "t", detail: "d" });
  });
});
