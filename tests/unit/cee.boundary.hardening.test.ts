/**
 * Stage 6 Boundary Hardening Tests (Stream F)
 *
 * Tests V3 validation failure handling with blocked status.
 * Tests CEE_BOUNDARY_ALLOW_INVALID dev escape hatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { _resetConfigCache } from "../../src/config/index.js";
import * as telemetry from "../../src/utils/telemetry.js";

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
   * Path 1: Default behavior - V3 validation failure returns blocked status
   */
  describe("Default behavior: V3 validation failure returns blocked status", () => {
    it("returns blocked status with no invalid graph when V3 validation fails", async () => {
      // Arrange: Create invalid V3 response (node with invalid ID format)
      const ctx: StageContext = {
        requestId: "test-req-1",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "123-invalid", kind: "goal", label: "Test Goal" }, // Invalid: ID starts with number
            ],
            edges: [],
          },
          goal_node_id: "123-invalid",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      // Act
      await runStageBoundary(ctx);

      // Assert: Should return blocked response
      expect(ctx.finalResponse).toBeDefined();
      expect((ctx.finalResponse as any).analysis_ready?.status).toBe("blocked");
      expect((ctx.finalResponse as any).graph).toBeNull();
      expect((ctx.finalResponse as any).analysis_ready?.blockers).toBeDefined();
      expect((ctx.finalResponse as any).analysis_ready?.blockers?.length).toBeGreaterThan(0);

      const blocker = (ctx.finalResponse as any).analysis_ready?.blockers?.[0];
      expect(blocker?.code).toBe("validation_failure");
      expect(blocker?.severity).toBe("error");
      expect(blocker?.message).toContain("V3 schema validation failed");

      // Assert: Telemetry event emitted
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-1",
          error_code: "CEE_V3_VALIDATION_FAILED",
          error_message: expect.stringContaining("V3 schema validation failed"),
        })
      );
    });

    it("populates blockers with validation error details", async () => {
      const ctx: StageContext = {
        requestId: "test-req-2",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "1-bad", kind: "goal", label: "Test" }, // Invalid ID
            ],
            edges: [],
          },
          goal_node_id: "1-bad",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const blocker = (ctx.finalResponse as any).analysis_ready?.blockers?.[0];
      expect(blocker?.details).toBeDefined();
      expect(Array.isArray(blocker?.details)).toBe(true);

      // Telemetry should be emitted
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-2",
          error_code: "CEE_V3_VALIDATION_FAILED",
        })
      );
    });

    it("preserves existing response envelope shape", async () => {
      const ctx: StageContext = {
        requestId: "test-req-3",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "9-bad", kind: "goal", label: "Test" }, // Invalid: ID starts with number
            ],
            edges: [],
          },
          goal_node_id: "9-bad",
          options: [],
          causal_claims: [],
          meta: { graph_hash: "test-hash" },
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      // Should preserve meta and other top-level fields
      expect((ctx.finalResponse as any).meta).toBeDefined();
      expect((ctx.finalResponse as any).meta?.graph_hash).toBe("test-hash");

      // Telemetry should be emitted
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-3",
          error_code: "CEE_V3_VALIDATION_FAILED",
        })
      );
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

    it("does not allow invalid graph when flag is false in local environment", async () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "false";
      _resetConfigCache();

      const ctx: StageContext = {
        requestId: "test-req-6",
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
      } as StageContext;

      await runStageBoundary(ctx);

      expect((ctx.finalResponse as any).analysis_ready?.status).toBe("blocked");

      // Telemetry should be emitted (no bypass)
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-6",
          error_code: "CEE_V3_VALIDATION_FAILED",
        })
      );
    });
  });

  /**
   * Path 3: Prod/staging rejection - flag is ignored and warning is logged
   */
  describe("Prod/staging rejection: CEE_BOUNDARY_ALLOW_INVALID is ignored", () => {
    it("ignores flag in production and returns blocked status", async () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      const ctx: StageContext = {
        requestId: "test-req-7",
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
      } as StageContext;

      await runStageBoundary(ctx);

      // Should return blocked status even though flag is set
      expect((ctx.finalResponse as any).analysis_ready?.status).toBe("blocked");
      expect((ctx.finalResponse as any).graph).toBeNull();

      // Telemetry should be emitted (config blocks override in prod)
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-7",
          error_code: "CEE_V3_VALIDATION_FAILED",
        })
      );
    });

    it("ignores flag in staging and returns blocked status", async () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      const ctx: StageContext = {
        requestId: "test-req-8",
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
      } as StageContext;

      await runStageBoundary(ctx);

      expect((ctx.finalResponse as any).analysis_ready?.status).toBe("blocked");
      expect((ctx.finalResponse as any).graph).toBeNull();

      // Telemetry should be emitted (config blocks override in staging)
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeBoundaryBlocked,
        expect.objectContaining({
          request_id: "test-req-8",
          error_code: "CEE_V3_VALIDATION_FAILED",
        })
      );
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
});
