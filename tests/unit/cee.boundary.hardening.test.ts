/**
 * Stage 6 Boundary Hardening Tests (Stream F)
 *
 * Tests V3 validation failure handling with Track 1 soft-gate degradation:
 * graph is preserved, warnings recorded in pipelineOutcome, telemetry emitted.
 * Tests CEE_BOUNDARY_ALLOW_INVALID dev escape hatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { _resetConfigCache } from "../../src/config/index.js";
import * as telemetry from "../../src/utils/telemetry.js";
import * as ceeV3Schema from "../../src/schemas/cee-v3.js";
import * as schemaV3Transform from "../../src/cee/transforms/schema-v3.js";
import { log } from "../../src/utils/telemetry.js";
import { ZodError, ZodIssue } from "zod";

/**
 * Helper: mock CEEGraphResponseV3.safeParse to return a validation failure.
 *
 * After commit be2f0945 the canonical ID regex was relaxed to /^[a-z0-9_:-]+$/
 * (digits-first allowed), so IDs like "999-invalid" no longer fail V3 validation.
 * To test the blocked-response path we mock safeParse directly.
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

describe("Stage 6: Boundary Hardening (Stream F)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetConfigCache();
    // Spy on telemetry emit function
    emitSpy = vi.spyOn(telemetry, "emit");
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
    emitSpy.mockRestore();
  });

  /**
   * Path 1: Default behavior - V3 validation failure triggers soft-gate degradation (Track 1)
   */
  describe("Default behavior: V3 validation failure triggers soft-gate degradation", () => {
    it("preserves graph and records degradation warning when V3 validation fails", async () => {
      // Mock V3 schema validation to fail (IDs like "123-invalid" are now valid
      // after canonical regex relaxation in be2f0945)
      const parseSpy = mockV3ValidationFailure();

      const ctx: StageContext = {
        requestId: "test-req-1",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Test Goal" },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        } as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      // Act
      await runStageBoundary(ctx);

      // Assert: Soft gate — graph passes through with degradation warning (Track 1)
      expect(ctx.finalResponse).toBeDefined();
      const response = ctx.finalResponse as any;
      // Graph is preserved (soft gate does not null the graph)
      expect(response.graph ?? response.nodes).toBeDefined();
      // analysis_ready is populated and NOT blocked
      expect(response.analysis_ready).toBeDefined();
      expect(response.analysis_ready.status).not.toBe("blocked");
      expect(response.analysis_ready.goal_node_id).toBeDefined();
      // Degradation warning recorded in pipelineOutcome
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].stage).toBe("boundary_v3_validation");
      expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(true);
      expect(ctx.pipelineOutcome.warnings[0].error).toContain("V3 schema validation failed");

      // Assert: Telemetry event emitted
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-1",
          error_code: "CEE_V3_VALIDATION_DEGRADED",
          error_message: expect.stringContaining("V3 schema validation failed"),
        })
      );

      parseSpy.mockRestore();
    });

    it("records validation error details in pipelineOutcome warnings", async () => {
      const parseSpy = mockV3ValidationFailure();

      const ctx: StageContext = {
        requestId: "test-req-2",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Test" },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        } as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      // Soft gate — degradation warning recorded with error detail
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].error).toContain("V3 schema validation failed");

      // Telemetry should be emitted
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-2",
          error_code: "CEE_V3_VALIDATION_DEGRADED",
        })
      );

      parseSpy.mockRestore();
    });

    it("preserves response envelope through soft-gate degradation", async () => {
      const parseSpy = mockV3ValidationFailure();

      const ctx: StageContext = {
        requestId: "test-req-3",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Test" },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
          meta: { graph_hash: "test-hash" },
        } as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      // Response is defined (soft gate preserves the V3 output)
      expect(ctx.finalResponse).toBeDefined();

      // Telemetry should be emitted
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-3",
          error_code: "CEE_V3_VALIDATION_DEGRADED",
        })
      );

      parseSpy.mockRestore();
    });
  });

  /**
   * Path 2: Dev override - allow invalid graphs in local/test when flag is set
   */
  describe("Dev override: CEE_BOUNDARY_ALLOW_INVALID in local/test", () => {
    it("allows invalid graph through when flag is true in local environment", async () => {
      // Arrange: Set environment to local and enable flag
      process.env.OLUMI_ENV = "local";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      const invalidResponse = {
        graph: {
          nodes: [
            { id: "2-bad", kind: "goal", label: "Test" }, // Invalid: ID starts with number
          ],
          edges: [],
        },
        goal_node_id: "2-bad",
        options: [],
        causal_claims: [],
      };

      const ctx: StageContext = {
        requestId: "test-req-4",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: invalidResponse as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      // Act
      await runStageBoundary(ctx);

      // Assert: Should pass through the invalid response (not blocked)
      expect(ctx.finalResponse).toBeDefined();
      expect((ctx.finalResponse as any).analysis_ready?.status).not.toBe("blocked");

      // Telemetry should NOT emit blocked event (bypass active)
      expect(emitSpy).not.toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.anything()
      );
    });

    it("allows invalid graph through when flag is true in test environment", async () => {
      process.env.OLUMI_ENV = "test";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      const ctx: StageContext = {
        requestId: "test-req-5",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "1-invalid", kind: "goal", label: "Test" }, // Invalid: ID starts with number
            ],
            edges: [],
          },
          goal_node_id: "1-invalid",
          options: [],
          causal_claims: [],
        } as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      expect(ctx.finalResponse).toBeDefined();
      expect((ctx.finalResponse as any).analysis_ready?.status).not.toBe("blocked");

      // Telemetry should NOT emit blocked event (bypass active)
      expect(emitSpy).not.toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.anything()
      );
    });

    it("records degradation warning when flag is false in local environment", async () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "false";
      _resetConfigCache();

      const parseSpy = mockV3ValidationFailure();

      const ctx: StageContext = {
        requestId: "test-req-6",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Test" },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        } as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      // Soft gate: graph passes through with degradation warning (flag=false does not bypass)
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(true);

      // Telemetry should be emitted (no bypass)
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-6",
          error_code: "CEE_V3_VALIDATION_DEGRADED",
        })
      );

      parseSpy.mockRestore();
    });
  });

  /**
   * Path 3: Prod/staging rejection - flag is ignored and warning is logged
   */
  describe("Prod/staging rejection: CEE_BOUNDARY_ALLOW_INVALID is ignored", () => {
    it("records degradation warning in production (flag ignored)", async () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      const parseSpy = mockV3ValidationFailure();

      const ctx: StageContext = {
        requestId: "test-req-7",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Test" },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        } as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      // Soft gate: graph passes through with degradation warning (flag ignored in prod)
      expect(ctx.finalResponse).toBeDefined();
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(true);

      // Telemetry should be emitted (config blocks override in prod)
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-7",
          error_code: "CEE_V3_VALIDATION_DEGRADED",
        })
      );

      parseSpy.mockRestore();
    });

    it("records degradation warning in staging (flag ignored)", async () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      const parseSpy = mockV3ValidationFailure();

      const ctx: StageContext = {
        requestId: "test-req-8",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Test" },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        } as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      // Soft gate: graph passes through with degradation warning (flag ignored in staging)
      expect(ctx.finalResponse).toBeDefined();
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(true);

      // Telemetry should be emitted (config blocks override in staging)
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-8",
          error_code: "CEE_V3_VALIDATION_DEGRADED",
        })
      );

      parseSpy.mockRestore();
    });
  });

  /**
   * Valid V3 response should pass through unchanged
   */
  describe("Valid V3 response passes through", () => {
    it("does not block valid V3 responses", async () => {
      const ctx: StageContext = {
        requestId: "test-req-9",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              {
                id: "goal_1",
                kind: "goal",
                label: "Test Goal",
              },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        } as any,
      pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      // Should pass through successfully (not blocked)
      expect(ctx.finalResponse).toBeDefined();
      expect((ctx.finalResponse as any).analysis_ready?.status).not.toBe("blocked");

      // Telemetry should NOT emit blocked event (valid response)
      expect(emitSpy).not.toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.anything()
      );
    });
  });

  /**
   * Path 4: CIL Phase 1 — warnOnUnknownV3Fields fires when undeclared fields
   * reach the boundary. Aggregates response root, nodes, and edges into one
   * structured log entry per parse call.
   */
  describe("CIL Phase 1: warnOnUnknownV3Fields observability", () => {
    let logWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logWarnSpy = vi.spyOn(log, "warn");
    });

    afterEach(() => {
      logWarnSpy.mockRestore();
    });

    it("logs aggregated unknown fields across response, nodes, and edges", async () => {
      // Mock transformResponseToV3 to return a v3Body with undeclared fields
      // at every level (response root, one node, one edge).
      const v3WithDrift = {
        schema_version: "3.0",
        nodes: [
          {
            id: "goal_1",
            kind: "goal",
            label: "Test Goal",
            llm_invented_node_field: "should be logged",
          },
        ],
        edges: [
          {
            from: "fac_a",
            to: "goal_1",
            strength: { mean: 0.5, std: 0.1 },
            exists_probability: 0.9,
            effect_direction: "positive",
            llm_invented_edge_field: 42,
          },
        ],
        options: [],
        goal_node_id: "goal_1",
        causal_claims: [],
        llm_invented_top_level: "should be logged",
        analysis_ready: { status: "ready", goal_node_id: "goal_1" },
      };

      const transformSpy = vi
        .spyOn(schemaV3Transform, "transformResponseToV3")
        .mockReturnValue(v3WithDrift as any);

      const ctx: StageContext = {
        requestId: "test-warn-aggregation",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: { nodes: [{ id: "goal_1", kind: "goal", label: "Test" }], edges: [] },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        } as any,
        pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      // Find the drift warning among any other log.warn calls
      const driftCall = logWarnSpy.mock.calls.find((call) => {
        const payload = call[0] as Record<string, unknown> | undefined;
        return payload?.event === "cee.v3_schema.unknown_fields_stripped";
      });

      expect(driftCall).toBeDefined();
      const payload = driftCall![0] as Record<string, unknown>;
      expect(payload.request_id).toBe("test-warn-aggregation");
      expect(payload.response_unknown_keys).toEqual(
        expect.arrayContaining(["llm_invented_top_level"])
      );
      expect(payload.node_unknowns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: "goal_1",
            keys: expect.arrayContaining(["llm_invented_node_field"]),
          }),
        ])
      );
      expect(payload.edge_unknowns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: "fac_a",
            to: "goal_1",
            keys: expect.arrayContaining(["llm_invented_edge_field"]),
          }),
        ])
      );
      expect(payload.total_unknown_levels).toBeGreaterThanOrEqual(3);

      transformSpy.mockRestore();
    });

    it("does NOT log when all fields are declared", async () => {
      const v3Clean = {
        schema_version: "3.0",
        nodes: [{ id: "goal_1", kind: "goal", label: "Test Goal" }],
        edges: [],
        options: [],
        goal_node_id: "goal_1",
        causal_claims: [],
        analysis_ready: { status: "ready", goal_node_id: "goal_1" },
      };

      const transformSpy = vi
        .spyOn(schemaV3Transform, "transformResponseToV3")
        .mockReturnValue(v3Clean as any);

      const ctx: StageContext = {
        requestId: "test-no-drift",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: { nodes: [{ id: "goal_1", kind: "goal", label: "Test" }], edges: [] },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
        } as any,
        pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      const driftCall = logWarnSpy.mock.calls.find((call) => {
        const payload = call[0] as Record<string, unknown> | undefined;
        return payload?.event === "cee.v3_schema.unknown_fields_stripped";
      });

      expect(driftCall).toBeUndefined();

      transformSpy.mockRestore();
    });

    it("emits a single aggregated log line per parse call (not one per element)", async () => {
      // Many nodes + many edges, each with one unknown field
      const v3ManyDrifts = {
        schema_version: "3.0",
        nodes: Array.from({ length: 5 }, (_, i) => ({
          id: `fac_${i}`,
          kind: "factor",
          label: `Factor ${i}`,
          unknown_per_node: i,
        })),
        edges: Array.from({ length: 4 }, (_, i) => ({
          from: `fac_${i}`,
          to: `fac_${i + 1}`,
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: "positive" as const,
          unknown_per_edge: i,
        })),
        options: [],
        goal_node_id: "fac_0",
        causal_claims: [],
        analysis_ready: { status: "ready", goal_node_id: "fac_0" },
      };

      const transformSpy = vi
        .spyOn(schemaV3Transform, "transformResponseToV3")
        .mockReturnValue(v3ManyDrifts as any);

      const ctx: StageContext = {
        requestId: "test-aggregation-throttling",
        input: { brief: "Test" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: { nodes: [{ id: "fac_0", kind: "goal", label: "Test" }], edges: [] },
          goal_node_id: "fac_0",
          options: [],
          causal_claims: [],
        } as any,
        pipelineOutcome: makePipelineOutcome(),
      } as StageContext;

      await runStageBoundary(ctx);

      // Exactly one drift-event log line, not one per node/edge
      const driftCalls = logWarnSpy.mock.calls.filter((call) => {
        const payload = call[0] as Record<string, unknown> | undefined;
        return payload?.event === "cee.v3_schema.unknown_fields_stripped";
      });
      expect(driftCalls).toHaveLength(1);

      // The single line aggregates all 5 node drifts and all 4 edge drifts
      const payload = driftCalls[0][0] as Record<string, unknown>;
      expect((payload.node_unknowns as unknown[]).length).toBe(5);
      expect((payload.edge_unknowns as unknown[]).length).toBe(4);

      transformSpy.mockRestore();
    });
  });
});
