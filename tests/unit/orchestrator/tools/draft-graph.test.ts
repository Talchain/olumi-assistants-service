/**
 * draft_graph Tool Handler Tests
 *
 * Tests for handleDraftGraph():
 * - Success: pipeline → graph_patch block with add_node/add_edge ops
 * - Warnings: validation_warnings surfaced in assistant_text
 * - Pipeline throw: OrchestratorError with TOOL_EXECUTION_FAILED
 * - Pipeline non-200: OrchestratorError with message + recoverable flag
 * - Empty graph: zero operations, no error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — vi.hoisted() ensures these are available to hoisted vi.mock factories
// ============================================================================

const { mockRunUnifiedPipeline } = vi.hoisted(() => ({
  mockRunUnifiedPipeline: vi.fn(),
}));

vi.mock("../../../../src/cee/unified-pipeline/index.js", () => ({
  runUnifiedPipeline: mockRunUnifiedPipeline,
}));

import { handleDraftGraph } from "../../../../src/orchestrator/tools/draft-graph.js";
import type { GraphPatchBlockData, OrchestratorError } from "../../../../src/orchestrator/types.js";
import type { FastifyRequest } from "fastify";

// ============================================================================
// Helpers
// ============================================================================

const mockRequest = {} as FastifyRequest;

function makePipelineSuccess(graph: Record<string, unknown>, extras?: Record<string, unknown>) {
  return {
    statusCode: 200,
    body: {
      graph,
      ...extras,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("handleDraftGraph", () => {
  beforeEach(() => {
    mockRunUnifiedPipeline.mockReset();
  });

  it("returns graph_patch block with add_node + add_edge ops on success", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "opt_1", kind: "option", label: "Raise Prices" },
          { id: "fac_1", kind: "factor", label: "Price Sensitivity" },
        ],
        edges: [
          { from: "goal_1", to: "opt_1", strength_mean: 1, strength_std: 0.01 },
          { from: "opt_1", to: "fac_1", strength_mean: 0.6, strength_std: 0.15 },
        ],
      }),
    );

    const result = await handleDraftGraph(
      "Should I raise prices to increase revenue?",
      mockRequest,
      "turn-1",
    );

    // Pipeline called with correct brief
    expect(mockRunUnifiedPipeline).toHaveBeenCalledOnce();
    const [pipeInput, pipeBody, , pipeOpts] = mockRunUnifiedPipeline.mock.calls[0];
    expect(pipeInput.brief).toBe("Should I raise prices to increase revenue?");
    expect(pipeBody.brief).toBe("Should I raise prices to increase revenue?");
    expect(pipeOpts).toEqual({ schemaVersion: "v3" });

    expect(result.blocks).toHaveLength(1);
    const block = result.blocks[0];
    expect(block.block_type).toBe("graph_patch");

    const data = block.data as GraphPatchBlockData;
    expect(data.patch_type).toBe("full_draft");
    expect(data.status).toBe("proposed");
    expect(data.applied_graph).toEqual({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "opt_1", kind: "option", label: "Raise Prices" },
        { id: "fac_1", kind: "factor", label: "Price Sensitivity" },
      ],
      edges: [
        { from: "goal_1", to: "opt_1", strength_mean: 1, strength_std: 0.01 },
        { from: "opt_1", to: "fac_1", strength_mean: 0.6, strength_std: 0.15 },
      ],
    });

    // 3 add_node + 2 add_edge = 5 operations
    expect(data.operations).toHaveLength(5);

    const addNodeOps = data.operations.filter(o => o.op === "add_node");
    const addEdgeOps = data.operations.filter(o => o.op === "add_edge");
    expect(addNodeOps).toHaveLength(3);
    expect(addEdgeOps).toHaveLength(2);

    // Node paths use /nodes/{id}
    expect(addNodeOps[0].path).toBe("/nodes/goal_1");
    // Edge paths use /edges/{from}->{to}
    expect(addEdgeOps[0].path).toBe("/edges/goal_1->opt_1");

    // Fix 3: assistantText stays null when there are no warnings. The summary
    // lives on patchData.summary (on the block), the composer / LLM produce
    // user-facing text downstream.
    expect(result.assistantText).toBeNull();
    expect(data.summary).toBeTruthy();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("surfaces validation_warnings in assistant_text", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess(
        { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        { validation_warnings: ["Missing factors", "Low edge coverage"] },
      ),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-2");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toEqual(["Missing factors", "Low edge coverage"]);
    expect(result.assistantText).toContain("2 validation warnings");
    expect(result.assistantText).toContain("Missing factors");
    expect(result.assistantText).toContain("Low edge coverage");
  });

  it("handles empty graph (no nodes, no edges)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({ nodes: [], edges: [] }),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-3");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.operations).toHaveLength(0);
    expect(data.status).toBe("proposed");
  });

  it("throws OrchestratorError when pipeline throws", async () => {
    mockRunUnifiedPipeline.mockRejectedValueOnce(new Error("LLM timeout"));

    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-4");
      expect.unreachable("should have thrown");
    } catch (err) {
      const orchestratorError = (err as { orchestratorError: OrchestratorError }).orchestratorError;
      expect(orchestratorError).toBeDefined();
      expect(orchestratorError.code).toBe("TOOL_EXECUTION_FAILED");
      expect(orchestratorError.tool).toBe("draft_graph");
      expect(orchestratorError.recoverable).toBe(true);
      expect(orchestratorError.message).toContain("LLM timeout");
    }
  });

  it("throws OrchestratorError on pipeline non-200 (4xx → not recoverable)", async () => {
    // Updated to production CEE body shape: `code` is the category field.
    // Legacy tolerance for `body.error` is covered by Test 1b separately.
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 422,
      body: {
        schema: "cee.error.v1",
        code: "CEE_LLM_VALIDATION_FAILED",
        message: "Brief too short",
        retryable: false,
        source: "cee",
      },
    });

    try {
      await handleDraftGraph("x", mockRequest, "turn-5");
      expect.unreachable("should have thrown");
    } catch (err) {
      const orchestratorError = (err as { orchestratorError: OrchestratorError }).orchestratorError;
      expect(orchestratorError).toBeDefined();
      expect(orchestratorError.code).toBe("TOOL_EXECUTION_FAILED");
      expect(orchestratorError.recoverable).toBe(false);
      // Message now derived from CEE body.code (primary) with body.message
      // tolerance. Asserting on the category code keeps the test stable
      // across cosmetic message changes.
      expect(orchestratorError.message).toContain("CEE_LLM_VALIDATION_FAILED");
    }
  });

  it("throws OrchestratorError on pipeline non-200 (5xx → recoverable)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 500,
      body: {
        schema: "cee.error.v1",
        code: "CEE_INTERNAL_ERROR",
        message: "Internal pipeline error",
        retryable: false,
        source: "cee",
      },
    });

    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-6");
      expect.unreachable("should have thrown");
    } catch (err) {
      const orchestratorError = (err as { orchestratorError: OrchestratorError }).orchestratorError;
      expect(orchestratorError).toBeDefined();
      expect(orchestratorError.recoverable).toBe(true);
      expect(orchestratorError.suggested_retry).toBeDefined();
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // Edit 1: route-v2-typed-envelope workstream — handleDraftGraph attaches
  // structured pipeline metadata to the thrown Error so route-v2.ts can map
  // it to a typed wire envelope instead of opaque draft_graph_pipeline_threw.
  //
  // Wire-shape contract: real CEE error bodies (from buildCeeErrorResponse
  // in src/cee/validation/pipeline.ts) carry the category in `body.code`,
  // NOT `body.error`. Earlier review (Codex) caught a bug where this code
  // read `body.error` and matched only test-shape mocks. The tests below
  // use the production shape (`code`) and a dedicated legacy-tolerance
  // test pins the fallback to `body.error` for any vestigial paths.
  //
  // The metadata is purely additive — callers that ignore it (V4 surfaces)
  // are unaffected.
  // ──────────────────────────────────────────────────────────────────

  it("attaches pipelineStatusCode / pipelineErrorCode / pipelineRecovery on 400 schema failure — production body.code shape (Test 1)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        // Production shape — buildCeeErrorResponse emits `code`, not `error`.
        schema: "cee.error.v1",
        code: "CEE_LLM_VALIDATION_FAILED",
        message: "LLM produced a response that does not match the expected graph schema",
        retryable: false,
        source: "cee",
        request_id: "test-md1",
        recovery: {
          suggestion: "Provide a clearer, more specific decision brief.",
          hints: [
            "State the specific decision you are trying to make",
            "List 2-3 concrete options you are considering",
            "Describe what success looks like",
          ],
        },
      },
    });

    try {
      await handleDraftGraph("ambiguous brief", mockRequest, "turn-md1");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as {
        pipelineStatusCode?: number;
        pipelineErrorCode?: string | null;
        pipelineRecovery?: Record<string, unknown> | null;
      };
      expect(meta.pipelineStatusCode).toBe(400);
      expect(meta.pipelineErrorCode).toBe("CEE_LLM_VALIDATION_FAILED");
      expect(meta.pipelineRecovery).toBeDefined();
      expect(meta.pipelineRecovery).not.toBeNull();
      expect((meta.pipelineRecovery as { suggestion?: unknown }).suggestion).toBe(
        "Provide a clearer, more specific decision brief.",
      );
    }
  });

  it("attaches pipelineStatusCode / pipelineErrorCode on 504 timeout — production body.code shape (Test 2)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 504,
      body: {
        schema: "cee.error.v1",
        code: "CEE_TIMEOUT",
        message: "LLM provider did not respond within timeout",
        retryable: true,
        source: "cee",
        request_id: "test-md2",
      },
    });

    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md2");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as {
        pipelineStatusCode?: number;
        pipelineErrorCode?: string | null;
        pipelineRecovery?: Record<string, unknown> | null;
      };
      expect(meta.pipelineStatusCode).toBe(504);
      expect(meta.pipelineErrorCode).toBe("CEE_TIMEOUT");
      expect(meta.pipelineRecovery).toBeNull();
    }
  });

  it("attaches pipelineStatusCode / pipelineErrorCode on 500 catch-all — production body.code shape (Test 3)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 500,
      body: {
        schema: "cee.error.v1",
        code: "CEE_INTERNAL_ERROR",
        message: "Internal pipeline error",
        retryable: false,
        source: "cee",
        request_id: "test-md3",
      },
    });

    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md3");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as {
        pipelineStatusCode?: number;
        pipelineErrorCode?: string | null;
        pipelineRecovery?: Record<string, unknown> | null;
      };
      expect(meta.pipelineStatusCode).toBe(500);
      expect(meta.pipelineErrorCode).toBe("CEE_INTERNAL_ERROR");
      expect(meta.pipelineRecovery).toBeNull();
    }
  });

  // Wire-shape contract regression — pins the field name to `code`.
  // If buildCeeErrorResponse ever renames the field, this test fails LOUDLY
  // rather than the metadata silently going null and route-v2 falling back
  // to opaque draft_graph_pipeline_threw.
  it("reads pipelineErrorCode from body.code (production shape) (Test 1a — wire-shape contract)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 400,
      body: { code: "CEE_GRAPH_INVALID" }, // Minimal production shape — only `code`.
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1a");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineErrorCode?: string | null };
      expect(meta.pipelineErrorCode).toBe("CEE_GRAPH_INVALID");
    }
  });

  // Legacy-tolerance regression — if any older or sibling pipeline path
  // emits `body.error` instead of `body.code` (e.g. the `error: code` shape
  // in src/orchestrator/moe-spike/call-specialist.ts), the read should
  // still pick up the category for diagnostics.
  it("falls back to body.error when body.code is absent (Test 1b — legacy tolerance)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 400,
      body: { error: "CEE_LEGACY_SHAPE_CODE" },
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1b");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineErrorCode?: string | null };
      expect(meta.pipelineErrorCode).toBe("CEE_LEGACY_SHAPE_CODE");
    }
  });

  it("prefers body.code over body.error when both are present (Test 1c — precedence)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 400,
      body: { code: "CEE_LLM_VALIDATION_FAILED", error: "WRONG_LEGACY_VALUE" },
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1c");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineErrorCode?: string | null };
      expect(meta.pipelineErrorCode).toBe("CEE_LLM_VALIDATION_FAILED");
    }
  });

  // PR #202 review-fix R1: handleDraftGraph propagates body.details via
  // PIPELINE_DETAILS_ALLOWLIST. Tests 1g-1k cover the allowlist + null/
  // missing handling. The previous OPTIONS_IDENTICAL diagnostics
  // (identical_option_ids, violation_code, etc.) were dropped because
  // handleDraftGraph didn't read body.details at all.

  it("extracts allowlisted body.details fields into pipelineDetails (Test 1g — propagation)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        code: "CEE_GRAPH_INVALID",
        details: {
          violation_code: "OPTIONS_IDENTICAL",
          identical_option_ids: ["opt_a", "opt_b", "opt_c"],
          intervention_signature: "fac_price:0.5000",
          repair_skip_reason: "options_identical_unrepairable_by_llm",
        },
      },
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1g");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineDetails?: Record<string, unknown> | null };
      expect(meta.pipelineDetails).toBeDefined();
      expect(meta.pipelineDetails).not.toBeNull();
      expect(meta.pipelineDetails!.violation_code).toBe("OPTIONS_IDENTICAL");
      expect(meta.pipelineDetails!.identical_option_ids).toEqual(["opt_a", "opt_b", "opt_c"]);
      expect(meta.pipelineDetails!.intervention_signature).toBe("fac_price:0.5000");
      expect(meta.pipelineDetails!.repair_skip_reason).toBe("options_identical_unrepairable_by_llm");
    }
  });

  it("filters non-allowlisted fields from body.details (Test 1h — sanitization)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        code: "CEE_GRAPH_INVALID",
        details: {
          violation_code: "OPTIONS_IDENTICAL",        // allowlisted
          identical_option_ids: ["opt_a"],            // allowlisted
          stack_trace: "Error at ...",                // NOT allowlisted
          internal_path: "/etc/passwd",               // NOT allowlisted
          user_input_echo: "raw user input",          // NOT allowlisted
        },
      },
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1h");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineDetails?: Record<string, unknown> | null };
      expect(meta.pipelineDetails).not.toBeNull();
      const details = meta.pipelineDetails!;
      // Allowlisted survive
      expect(details.violation_code).toBe("OPTIONS_IDENTICAL");
      expect(details.identical_option_ids).toEqual(["opt_a"]);
      // Non-allowlisted dropped
      expect(details.stack_trace).toBeUndefined();
      expect(details.internal_path).toBeUndefined();
      expect(details.user_input_echo).toBeUndefined();
    }
  });

  it("pipelineDetails is null when body.details is absent (Test 1i — no-noise)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 400,
      body: { code: "CEE_LLM_VALIDATION_FAILED" }, // no `details`
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1i");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineDetails?: Record<string, unknown> | null };
      expect(meta.pipelineDetails).toBeNull();
    }
  });

  it("pipelineDetails is null when body.details has only non-allowlisted fields (Test 1j — empty-after-filter)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 400,
      body: {
        code: "CEE_GRAPH_INVALID",
        details: {
          stack_trace: "Error at ...",
          internal_path: "/etc/passwd",
        },
      },
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1j");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineDetails?: Record<string, unknown> | null };
      // Empty filtered result collapses to null — keeps the wire body
      // free of empty objects.
      expect(meta.pipelineDetails).toBeNull();
    }
  });

  it("pipelineDetails is null when body.details is not an object (Test 1k — defensive)", async () => {
    const malformed: unknown[] = [
      "string-instead-of-object",
      42,
      null,
      ["array-instead-of-object"],
      undefined,
    ];
    for (const bad of malformed) {
      mockRunUnifiedPipeline.mockResolvedValueOnce({
        statusCode: 400,
        body: { code: "CEE_GRAPH_INVALID", details: bad },
      });
      try {
        await handleDraftGraph("Test brief", mockRequest, "turn-md1k");
        expect.unreachable("should have thrown");
      } catch (err) {
        const meta = err as { pipelineDetails?: Record<string, unknown> | null };
        expect(meta.pipelineDetails).toBeNull();
      }
    }
  });

  // Audit-fix A5: defensive null/non-object body handling. The body is typed
  // `unknown`; if a future pipeline path returns a malformed response,
  // extraction must NOT crash. It should fall through to the legacy plain-
  // Error envelope (pipelineErrorCode=null forces route-v2's legacy fallback).

  it("null body → no crash; pipelineErrorCode=null (Test 1d — defensive)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 500,
      body: null as unknown as Record<string, unknown>,
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1d");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineStatusCode?: number; pipelineErrorCode?: string | null };
      expect(meta.pipelineStatusCode).toBe(500);
      expect(meta.pipelineErrorCode).toBeNull();
    }
  });

  it("undefined body → no crash; pipelineErrorCode=null (Test 1e — defensive)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 500,
      body: undefined as unknown as Record<string, unknown>,
    });
    try {
      await handleDraftGraph("Test brief", mockRequest, "turn-md1e");
      expect.unreachable("should have thrown");
    } catch (err) {
      const meta = err as { pipelineStatusCode?: number; pipelineErrorCode?: string | null };
      expect(meta.pipelineStatusCode).toBe(500);
      expect(meta.pipelineErrorCode).toBeNull();
    }
  });

  it("non-conformant body.code (lowercase, control chars, non-string) → pipelineErrorCode=null (Test 1f — regex guard, audit-fix A1/6)", async () => {
    // The CEE code pattern requires uppercase-leading PascalCase-style:
    // ^[A-Z][A-Z0-9_]{1,63}$. Anything outside that — lowercase, control
    // characters, numeric, etc. — is discarded so it never lands in logs or
    // on the wire.
    const malformedCodes: unknown[] = [
      "cee_lowercase",                   // lowercase first char
      "CEE_FOO\nINJECTED",               // newline injection
      "CEE FOO",                          // whitespace
      "CEE_FOO!",                         // punctuation
      42,                                 // non-string
      null,                               // null
      "",                                 // empty
      "A".repeat(100),                    // over 64 chars
    ];
    for (const badCode of malformedCodes) {
      mockRunUnifiedPipeline.mockResolvedValueOnce({
        statusCode: 400,
        body: { code: badCode },
      });
      try {
        await handleDraftGraph("Test brief", mockRequest, "turn-md1f");
        expect.unreachable("should have thrown");
      } catch (err) {
        const meta = err as { pipelineErrorCode?: string | null };
        expect(meta.pipelineErrorCode).toBeNull();
      }
    }
  });

  it("block provenance references the turn ID", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        nodes: [{ id: "g", kind: "goal", label: "G" }],
        edges: [],
      }),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-7");

    const block = result.blocks[0];
    expect(block.provenance.turn_id).toBe("turn-7");
    expect(block.provenance.trigger).toBe("tool:draft_graph");
  });

  it("extracts warnings from debug.warnings path", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        debug: { warnings: ["Unusual brief pattern"] },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-8");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.validation_warnings).toContain("Unusual brief pattern");
  });

  it("sets auto_apply: true on full_draft GraphPatchBlock", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({ nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] }),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-auto");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.auto_apply).toBe(true);
  });

  it("carries the canonical drafted graph on the full_draft block for downstream receipts", async () => {
    const draftedGraph = {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "opt_1", kind: "option", label: "Raise Prices" },
      ],
      edges: [
        { from: "opt_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
      ],
    };
    mockRunUnifiedPipeline.mockResolvedValueOnce(makePipelineSuccess(draftedGraph));

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-applied-graph");

    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.applied_graph).toEqual(draftedGraph);
  });

  it("leaves assistantText null when there are no warnings (Fix 3)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: {
          nodes: [{ id: "g", kind: "goal", label: "Revenue" }],
          edges: [],
        },
        coaching: {
          summary: "A strong model capturing the core trade-off between price and volume.",
          strengthen_items: [],
        },
      },
    });

    const result = await handleDraftGraph("Should I raise prices?", mockRequest, "turn-summary");

    // Fix 3: the handler no longer copies the first sentence of patchData.summary
    // into assistantText — the composer / LLM produces user-facing text downstream.
    // The coaching text still lives on the block's summary and narrationHint.
    expect(result.assistantText).toBeNull();
    expect(result.draftWarnings).toHaveLength(0);
  });

  it("prefers warnings over summary in assistantText", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: {
          nodes: [{ id: "g", kind: "goal", label: "G" }],
          edges: [],
        },
        coaching: {
          summary: "Good structure.",
          strengthen_items: [],
        },
        validation_warnings: ["Missing edge coverage"],
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-warn-priority");

    // Warnings take priority over coaching summary
    expect(result.assistantText).toContain("1 validation warning");
    expect(result.assistantText).toContain("Missing edge coverage");
    expect(result.assistantText).not.toContain("Good structure");
  });

  it("leaves assistantText null when no coaching and no warnings (Fix 3)", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "opt_1", kind: "option", label: "Raise Prices" },
        ],
        edges: [
          { from: "opt_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
        ],
      }),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-op-summary");

    // Fix 3: the handler no longer turns patchData.summary into assistantText.
    // The graph_patch block still carries patchData.summary on block.data.summary;
    // what the user reads comes from the composer / LLM layer instead.
    expect(result.assistantText).toBeNull();
    const patchData = result.blocks[0]?.data as { summary?: string } | undefined;
    expect(patchData?.summary).toBeTruthy();
  });

  it("extracts coaching.summary into narrationHint", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        coaching: {
          summary: "Strong model structure, add constraints for robustness.",
          strengthen_items: ["Add a constraint node", "Define option interventions"],
        },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-coaching");

    // v5-maintenance: narrationHint now holds just coaching.summary;
    // strengthen_items are carried separately on result.strengthenItems.
    expect(result.narrationHint).toBeDefined();
    expect(result.narrationHint).toContain("Strong model structure");
    // strengthen_items surface on result.strengthenItems rather than
    // being concatenated into narrationHint.
    expect(result.strengthenItems).toBeDefined();
  });

  it("narrationHint is undefined when no coaching data in response", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({ nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] }),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-no-coaching");

    expect(result.narrationHint).toBeUndefined();
  });

  // ===========================================================================
  // repairs_applied extraction from pipeline trace
  // ===========================================================================

  it("extracts deterministic_repairs from trace.pipeline.repair_summary", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        trace: {
          pipeline: {
            repair_summary: {
              deterministic_repairs: [
                { code: "NAN_VALUE", reason: "NaN replaced", path: "edges[e1].strength_mean", before: NaN, after: 0.5, action: "defaulted", severity: "warn" },
                { code: "SIGN_MISMATCH", reason: "Sign flipped", path: "edges[e2].strength_mean", before: -0.3, after: 0.3, action: "flipped", severity: "info" },
              ],
            },
          },
        },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-repairs-det");
    const data = result.blocks[0].data as GraphPatchBlockData;

    expect(data.repairs_applied).toHaveLength(2);
    expect(data.repairs_applied![0]).toMatchObject({
      code: "NAN_VALUE",
      layer: "cee",
      field_path: "edges[e1].strength_mean",
      reason: "NaN replaced",
      severity: "warn",
      action: "defaulted",
    });
    expect(data.repairs_applied![1]).toMatchObject({
      code: "SIGN_MISMATCH",
      layer: "cee",
      severity: "info",
    });
  });

  it("extracts structural_edge_normalisation repairs from trace", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        trace: {
          pipeline: {
            repair_summary: {
              structural_edge_normalisation: {
                repairs: [
                  { field: "strength.mean", from_value: 0.5, to_value: 1.0, action: "normalised", reason: "Structural edge" },
                ],
              },
            },
          },
        },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-repairs-strp");
    const data = result.blocks[0].data as GraphPatchBlockData;

    expect(data.repairs_applied).toHaveLength(1);
    expect(data.repairs_applied![0]).toMatchObject({
      code: "STRUCTURAL_EDGE_NORMALISED",
      layer: "cee",
      field_path: "strength.mean",
      action: "normalised",
    });
  });

  it("extracts graph_data_integrity repairs from trace", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        trace: {
          pipeline: {
            repair_summary: {
              graph_data_integrity: {
                scale_consistency_repairs: [
                  { code: "SCALE_MISMATCH", field_path: "nodes[fac_1].observed_state.value", before: 0.49, after: 0.831, reason: "Cap-adjusted", action: "corrected" },
                ],
                edge_field_repairs: [
                  { code: "MISSING_EXISTS_PROB", field_path: "edges[e1].exists_probability", before: null, after: 0.8, reason: "Defaulted for causal edge", action: "defaulted" },
                ],
              },
            },
          },
        },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-repairs-gdi");
    const data = result.blocks[0].data as GraphPatchBlockData;

    expect(data.repairs_applied).toHaveLength(2);
    expect(data.repairs_applied![0]).toMatchObject({
      code: "SCALE_MISMATCH",
      layer: "cee",
      field_path: "nodes[fac_1].observed_state.value",
    });
    expect(data.repairs_applied![1]).toMatchObject({
      code: "MISSING_EXISTS_PROB",
      layer: "cee",
    });
  });

  it("repairs_applied absent when trace has no repair_summary", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        trace: { pipeline: {} },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-no-repairs");
    const data = result.blocks[0].data as GraphPatchBlockData;

    expect(data.repairs_applied).toBeUndefined();
  });

  it("repairs_applied absent when deterministic_repairs is empty array", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        trace: {
          pipeline: {
            repair_summary: {
              deterministic_repairs: [],
            },
          },
        },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-empty-repairs");
    const data = result.blocks[0].data as GraphPatchBlockData;

    // Empty array → no repairs_applied set on patchData
    expect(data.repairs_applied).toBeUndefined();
  });

  it("repairs_applied absent when trace is missing entirely", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({ nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] }),
    );

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-no-trace");
    const data = result.blocks[0].data as GraphPatchBlockData;

    expect(data.repairs_applied).toBeUndefined();
  });

  it("skips malformed repair entries without crashing", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        trace: {
          pipeline: {
            repair_summary: {
              deterministic_repairs: [
                null,
                42,
                { code: "VALID", reason: "OK", path: "x", action: "fix" },
                { notCode: true },
                { code: "NO_REASON" },
              ],
            },
          },
        },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-malformed");
    const data = result.blocks[0].data as GraphPatchBlockData;

    // Only the entry with both code and reason should survive
    expect(data.repairs_applied).toHaveLength(1);
    expect(data.repairs_applied![0].code).toBe("VALID");
  });

  it("falls back to trace.repair_summary when pipeline.repair_summary is absent", async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce({
      statusCode: 200,
      body: {
        graph: { nodes: [{ id: "g", kind: "goal", label: "G" }], edges: [] },
        trace: {
          repair_summary: {
            deterministic_repairs: [
              { code: "FALLBACK_REPAIR", reason: "Found via fallback path", path: "edges[e1]", action: "fixed" },
            ],
          },
        },
      },
    });

    const result = await handleDraftGraph("Test brief", mockRequest, "turn-fallback");
    const data = result.blocks[0].data as GraphPatchBlockData;

    expect(data.repairs_applied).toHaveLength(1);
    expect(data.repairs_applied![0].code).toBe("FALLBACK_REPAIR");
  });
});
