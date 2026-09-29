/**
 * V3 Validation Soft-Gate Contract Tests (Stream F)
 *
 * Tests that V3 validation failures produce soft-gate degradation (Track 1):
 * - Graph is PRESERVED (not nulled) — valid graphs must never be discarded
 * - pipelineOutcome.warnings records degradation entries
 * - Telemetry event emitted with CEE_V3_VALIDATION_DEGRADED
 * - Response envelope shape (meta, trace) is preserved
 * - JSON serialization safety is maintained
 *
 * HISTORY: These tests originally verified hard-blocked responses (analysis_ready.status:
 * "blocked", graph: null). Boundary.ts was refactored to Track 1 soft-gate degradation —
 * graph passes through on V3 validation failure with warnings recorded. Tests updated
 * 2026-03-28 to match current source behavior. See review pack for contract change flag.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { ZodError, ZodIssue } from "zod";
import * as ceeV3Schema from "../../src/schemas/cee-v3.js";

/**
 * Helper: mock CEEGraphResponseV3.safeParse to return a validation failure.
 */
function mockV3ValidationFailure() {
  const fakeIssues: ZodIssue[] = [
    { code: "custom", path: ["nodes", 0, "id"], message: "Simulated V3 validation failure" },
  ];
  return vi.spyOn(ceeV3Schema.CEEGraphResponseV3, "safeParse").mockReturnValue({
    success: false,
    error: new ZodError(fakeIssues),
  } as any);
}

function makePipelineOutcome() {
  return {
    graph_drafted: false,
    graph_structurally_valid: false,
    deterministic_sweep_violations: 0,
    verification_status: 'skipped' as const,
    validation_status: 'skipped' as const,
    enrichment_status: 'skipped' as const,
    coaching_status: 'partial' as const,
    warnings: [] as Array<{ stage: string; error: string; degraded: boolean }>,
    rescue_score: 0,
    factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
    edge_strength_unique_count: 0,
    llm_repair: { triggered: false, outcome: 'skipped' as const, fallback_reason: null, attempts: 0 },
    repair_provenance: [] as Array<{ rule: string; code: string; node_or_edge_id: string; field: string; before: unknown; after: unknown; source: string }>,
  };
}

function makeCtx(overrides: Partial<{ requestId: string; ceeResponse: any }>): StageContext {
  return {
    requestId: overrides.requestId ?? "contract-test",
    input: { brief: "Test brief" },
    opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
    ceeResponse: overrides.ceeResponse ?? {
      graph: {
        nodes: [{ id: "goal_1", kind: "goal", label: "Test" }],
        edges: [],
      },
      goal_node_id: "goal_1",
      options: [],
      causal_claims: [],
    },
    pipelineOutcome: makePipelineOutcome(),
  } as StageContext;
}

// v5-maintenance (2026-04-21): runStageBoundary's behaviour on V3 validation
// failure is now FAIL-CLOSED per boundary contract v1.1 §4.2 (Track 1 soft
// gate was superseded). Validation failure sets ctx.earlyReturn to a 502
// `CEE_EGRESS_CONTRACT_VIOLATION` envelope instead of ctx.finalResponse
// with a degraded flag. All of this contract's "soft gate" assertions are
// now against defunct behaviour. Kept as a change record only — unskip
// only after a follow-up brief restores a typed soft-gate path.
// TODO: ISSUE-9001 — v5-maintenance: superseded by fail-closed migration
describe.skip("Blocked Response Contract (Stream F) [v5-maintenance: superseded by fail-closed]", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
  });

  describe("Blocked response shape", () => {
    it("returns well-formed blocked response on V3 validation failure", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({ requestId: "contract-test-1" });

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Soft-gate contract: response exists with graph preserved (not nulled)
      expect(response).toBeDefined();
      expect(response.analysis_ready).toBeDefined();
      expect(response.analysis_ready.status).not.toBe("blocked");
      expect(response.analysis_ready.goal_node_id).toBeDefined();
      expect(typeof response.analysis_ready.goal_node_id).toBe("string");

      // Degradation recorded in pipelineOutcome (not in response body)
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].stage).toBe("boundary_v3_validation");
      expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(true);
      expect(ctx.pipelineOutcome.warnings[0].error).toContain("V3 schema validation failed");

      parseSpy.mockRestore();
    });

    it("preserves response envelope shape (meta, trace)", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({
        requestId: "contract-test-2",
        ceeResponse: {
          graph: {
            nodes: [{ id: "goal_1", kind: "goal", label: "Test" }],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
          meta: { graph_hash: "test-hash-12345", source: "assistant" },
        },
      });

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Soft gate preserves V3 output with analysis_ready
      expect(response).toBeDefined();
      expect(response.analysis_ready).toBeDefined();
      expect(response.analysis_ready.status).not.toBe("blocked");

      parseSpy.mockRestore();
    });

    it("validates against soft-gate degradation contract", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({ requestId: "contract-test-schema" });

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Soft gate contract: response is defined, pipelineOutcome has warnings
      expect(response).toBeDefined();
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].error).toContain("V3 schema validation failed");

      parseSpy.mockRestore();
    });

    it("returns well-formed blocked response with multiple validation errors", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({
        requestId: "contract-test-3",
        ceeResponse: {
          graph: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Test Goal" },
              { id: "fac_1", kind: "factor", label: "Test Factor" },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        },
      });

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Soft gate: response exists, degradation recorded
      expect(response).toBeDefined();
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(true);

      parseSpy.mockRestore();
    });
  });

  describe("Blocked response consumption safety", () => {
    it("can be serialized to JSON without errors", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({ requestId: "contract-test-4" });

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // JSON serialization succeeds
      let jsonString: string;
      expect(() => {
        jsonString = JSON.stringify(response);
      }).not.toThrow();

      // JSON deserialization succeeds
      let parsed: any;
      expect(() => {
        parsed = JSON.parse(jsonString!);
      }).not.toThrow();

      // Deserialized response is well-formed with soft-gate fields
      expect(parsed).toBeDefined();
      expect(parsed.analysis_ready).toBeDefined();
      expect(parsed.analysis_ready.status).toBeDefined();
      expect(parsed.analysis_ready.status).not.toBe("blocked");

      parseSpy.mockRestore();
    });

    it("allows safe status checking without undefined errors", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({ requestId: "contract-test-5" });

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Safe optional chaining works
      expect(response?.analysis_ready).toBeDefined();
      expect(response?.analysis_ready?.status).toBeDefined();

      // Typical client checks don't crash
      expect(() => {
        const _status = response?.analysis_ready?.status;
        const _hasBlockers = Array.isArray(response?.analysis_ready?.blockers);
      }).not.toThrow();

      parseSpy.mockRestore();
    });

    it("includes goal_node_id in analysis_ready even when blocked", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({ requestId: "contract-test-6" });

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // goal_node_id is present
      expect(response.analysis_ready).toBeDefined();
      expect(response.analysis_ready.goal_node_id).toBeDefined();
      expect(typeof response.analysis_ready.goal_node_id).toBe("string");

      parseSpy.mockRestore();
    });

    it("preserves trace fields when present upstream", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({
        requestId: "contract-test-trace-1",
        ceeResponse: {
          graph: {
            nodes: [{ id: "goal_1", kind: "goal", label: "Test" }],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
          trace: {
            request_id: "trace-test-123",
            correlation_id: "corr-456",
            custom_field: "preserved",
          },
        },
      });

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Trace object is present (soft gate preserves the response)
      expect(response.trace).toBeDefined();
      // Pipeline may add/modify trace.request_id during V3 transform
      expect(response.trace.request_id).toBeDefined();

      parseSpy.mockRestore();
    });
  });

  describe("Blocked response blocker details", () => {
    it("includes validation error details in blocker", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({ requestId: "contract-test-7" });

      await runStageBoundary(ctx);

      // Soft gate: validation details are in pipelineOutcome.warnings, not blockers
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      const warning = ctx.pipelineOutcome.warnings[0];
      expect(warning.error).toContain("V3 schema validation failed");
      expect(warning.stage).toBe("boundary_v3_validation");

      parseSpy.mockRestore();
    });

    it("preserves blocker count and code consistency across multiple errors", async () => {
      const parseSpy = mockV3ValidationFailure();
      const ctx = makeCtx({ requestId: "contract-test-8" });

      await runStageBoundary(ctx);

      // Soft gate: degradation warnings are consistent
      expect(ctx.pipelineOutcome.warnings.length).toBe(1);
      const warning = ctx.pipelineOutcome.warnings[0];
      expect(warning.stage).toBe("boundary_v3_validation");
      expect(warning.error).toContain("V3 schema validation failed");
      expect(warning.degraded).toBe(true);

      parseSpy.mockRestore();
    });
  });
});

// v5-maintenance regression: replace-in-kind coverage for the current
// fail-closed contract. The superseded soft-gate tests above are kept as
// archive; these tests guard the live behaviour (502 + typed
// CEE_EGRESS_CONTRACT_VIOLATION envelope set on ctx.earlyReturn).
describe("Blocked Response Contract — fail-closed (boundary contract v1.1 §4.2)", () => {
  beforeEach(() => {
    _resetConfigCache();
  });
  afterEach(() => {
    _resetConfigCache();
  });

  it("V3 validation failure sets ctx.earlyReturn to a 502 BoundaryError envelope", async () => {
    const parseSpy = mockV3ValidationFailure();
    const ctx = makeCtx({ requestId: "fail-closed-1" });

    await runStageBoundary(ctx);

    // ctx.finalResponse MUST remain unset — the soft-gate path is gone.
    expect(ctx.finalResponse).toBeUndefined();
    // ctx.earlyReturn is the fail-closed signal the pipeline drains into
    // an HTTP 502 at the route layer.
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(502);

    const body = ctx.earlyReturn!.body as Record<string, unknown>;
    // CEEErrorResponseV1 shape: typed `code`, human `message`, `source`,
    // `retryable`, plus typed `reason`. These are the stable client-
    // consumable fields — see buildCeeErrorResponse in
    // src/cee/validation/pipeline.ts.
    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_EGRESS_CONTRACT_VIOLATION");
    expect(body.source).toBe("cee");
    expect(body.retryable).toBe(false);
    // Typed failure reason — not a stringly-typed narrative.
    expect(body.reason).toBe("egress_contract_violation");

    // Details carry the validator + boundary metadata clients use for triage.
    const details = body.details as Record<string, unknown>;
    expect(details.validator).toBe("zod_v3");
    expect(details.boundary).toBe("B1");
    expect(details.direction).toBe("response");
    expect(typeof details.issue_count).toBe("number");

    // pipelineOutcome records a blocked (not degraded) warning so the
    // observability trail names the fail-closed action.
    expect(ctx.pipelineOutcome.warnings.length).toBe(1);
    const warning = ctx.pipelineOutcome.warnings[0] as {
      stage: string;
      error: string;
      degraded: boolean;
      blocked?: boolean;
    };
    expect(warning.stage).toBe("boundary_v3_validation");
    expect(warning.degraded).toBe(false);
    expect(warning.blocked).toBe(true);

    parseSpy.mockRestore();
  });

  it("dev escape hatch (CEE_BOUNDARY_ALLOW_INVALID) bypasses fail-closed and populates finalResponse", async () => {
    // The dev escape hatch is config-gated to local/test environments only.
    // When enabled, V3 validation failure falls back to passing the raw body
    // through via ctx.finalResponse — kept as a regression guard so the
    // escape hatch does not atrophy.
    vi.stubEnv("CEE_BOUNDARY_ALLOW_INVALID", "true");
    _resetConfigCache();

    const parseSpy = mockV3ValidationFailure();
    const ctx = makeCtx({ requestId: "fail-closed-escape-1" });

    await runStageBoundary(ctx);

    // Escape hatch active: finalResponse IS set, earlyReturn is NOT.
    expect(ctx.finalResponse).toBeDefined();
    expect(ctx.earlyReturn).toBeUndefined();

    parseSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});
