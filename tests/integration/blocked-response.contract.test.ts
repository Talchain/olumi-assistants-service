/**
 * Blocked Response Contract Tests (Stream F)
 *
 * Tests that blocked responses (analysis_ready.status: "blocked") are well-formed
 * and safe to consume by all downstream clients.
 *
 * Contract requirements:
 * - analysis_ready.status === "blocked"
 * - graph === null (CANONICAL: production always returns explicit null, never omitted)
 *   Schema allows omission for backward compatibility, but boundary.ts enforces explicit null.
 * - nodes === [] (V3 format)
 * - edges === [] (V3 format)
 * - blockers[] is non-empty array
 * - blockers[].code exists
 * - blockers[].message exists
 * - Response envelope shape is preserved (meta, trace if applicable)
 * - JSON.parse succeeds
 * - No undefined access errors when checking status
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { z } from "zod";
import { AnalysisReadyStatus } from "../../src/schemas/analysis-ready.js";

/**
 * Validation blocker schema (used when analysis_ready.status === "blocked")
 * These are different from AnalysisBlocker (which identifies missing factor values)
 */
const ValidationBlocker = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  details: z.unknown().optional(),
});

/**
 * Blocked response schema - a subset of CEEGraphResponseV3
 * with specific constraints for validation failure responses
 *
 * Note: Schema allows graph to be optional for backward compatibility,
 * but production code (boundary.ts) enforces canonical shape: graph is
 * ALWAYS explicitly null (never omitted) in blocked responses.
 */
const BlockedResponseV3 = z.object({
  schema_version: z.literal("3.0").optional(),
  // Production returns explicit null; schema allows optional for backward compat
  graph: z.null().optional(),
  // Blocked responses return empty nodes/edges
  nodes: z.array(z.never()).length(0),
  edges: z.array(z.never()).length(0),
  // Options array must be empty for blocked responses
  options: z.array(z.never()).length(0).optional(),
  // Causal claims may be present
  causal_claims: z.array(z.unknown()).optional(),
  // Goal node ID must be present (even if empty string)
  goal_node_id: z.string().optional(),
  // Meta must be preserved from original response
  meta: z.object({
    graph_hash: z.string().optional(),
    source: z.enum(["assistant", "user", "imported"]).optional(),
  }).passthrough().optional(),
  // Analysis ready must have blocked status
  analysis_ready: z.object({
    status: z.literal("blocked"),
    goal_node_id: z.string(),
    options: z.array(z.never()).length(0),
    blockers: z.array(ValidationBlocker).min(1),
    model_adjustments: z.array(z.unknown()).optional(),
  }).passthrough(),
  // Validation warnings may be present
  validation_warnings: z.array(z.unknown()).optional(),
  // Trace may be preserved
  trace: z.unknown().optional(),
  // Coaching may be present
  coaching: z.unknown().optional(),
  // Observability may be present
  _observability: z.unknown().optional(),
}).passthrough();

describe("Blocked Response Contract (Stream F)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
  });

  /**
   * Test 1: Blocked response shape is well-formed
   */
  describe("Blocked response shape", () => {
    it("returns well-formed blocked response on V3 validation failure", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-1",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "999-invalid", kind: "goal", label: "Test" }, // Invalid: ID starts with number
            ],
            edges: [],
          },
          goal_node_id: "999-invalid",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      // Contract: response exists
      expect(ctx.finalResponse).toBeDefined();

      const response = ctx.finalResponse as any;

      // Contract: status is "blocked"
      expect(response.analysis_ready).toBeDefined();
      expect(response.analysis_ready.status).toBe("blocked");

      // Contract: graph is null (no invalid data returned)
      expect(response.graph).toBeNull();

      // Contract: nodes and edges are empty arrays (V3 format)
      expect(Array.isArray(response.nodes)).toBe(true);
      expect(response.nodes).toEqual([]);
      expect(Array.isArray(response.edges)).toBe(true);
      expect(response.edges).toEqual([]);

      // Contract: blockers array exists and is non-empty
      expect(response.analysis_ready.blockers).toBeDefined();
      expect(Array.isArray(response.analysis_ready.blockers)).toBe(true);
      expect(response.analysis_ready.blockers.length).toBeGreaterThan(0);

      // Contract: each blocker has required fields
      const blocker = response.analysis_ready.blockers[0];
      expect(blocker.code).toBeDefined();
      expect(typeof blocker.code).toBe("string");
      expect(blocker.message).toBeDefined();
      expect(typeof blocker.message).toBe("string");
      expect(blocker.severity).toBeDefined();
      expect(blocker.severity).toBe("error");

      // Contract: response matches BlockedResponseV3 schema
      const parseResult = BlockedResponseV3.safeParse(response);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) {
        console.error("Schema validation errors:", parseResult.error.issues);
      }
    });

    it("preserves response envelope shape (meta, trace)", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-2",
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
          meta: {
            graph_hash: "test-hash-12345",
            source: "assistant",
          },
          trace: {
            request_id: "contract-test-2",
            correlation_id: "corr-123",
          },
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Contract: meta is preserved
      expect(response.meta).toBeDefined();
      expect(response.meta.graph_hash).toBe("test-hash-12345");
      expect(response.meta.source).toBe("assistant");

      // Contract: trace is preserved when present
      expect(response.trace).toBeDefined();
      expect(response.trace.request_id).toBe("contract-test-2");

      // Contract: response matches BlockedResponseV3 schema
      const parseResult = BlockedResponseV3.safeParse(response);
      expect(parseResult.success).toBe(true);
    });

    it("validates against BlockedResponseV3 schema", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-schema",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "999-invalid", kind: "goal", label: "Test" },
            ],
            edges: [],
          },
          goal_node_id: "999-invalid",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Primary contract: response must parse successfully against BlockedResponseV3
      const parseResult = BlockedResponseV3.safeParse(response);
      expect(parseResult.success).toBe(true);

      if (!parseResult.success) {
        // If validation fails, log detailed errors for debugging
        console.error("Blocked response schema validation failed:");
        console.error(JSON.stringify(parseResult.error.issues, null, 2));
        throw new Error(`Schema validation failed: ${parseResult.error.issues.length} issues`);
      }
    });

    it("returns well-formed blocked response with multiple validation errors", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-3",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "2-bad", kind: "goal", label: "Test Goal" }, // Invalid: starts with number
              { id: "9-also-bad", kind: "factor", label: "Test Factor" }, // Invalid: starts with number
            ],
            edges: [],
          },
          goal_node_id: "2-bad",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Contract: blocked response shape
      expect(response.analysis_ready?.status).toBe("blocked");
      expect(response.graph).toBeNull();
      expect(response.nodes).toEqual([]);
      expect(response.edges).toEqual([]);

      // Contract: blocker exists with validation code
      const blocker = response.analysis_ready?.blockers?.[0];
      expect(blocker?.code).toBe("validation_failure");
      expect(blocker?.severity).toBe("error");
      expect(blocker?.message).toBeDefined();
      expect(blocker?.message).toContain("V3 schema validation failed");
    });
  });

  /**
   * Test 2: Blocked response is safe to consume
   */
  describe("Blocked response consumption safety", () => {
    it("can be serialized to JSON without errors", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-4",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "5-bad", kind: "goal", label: "Test" }, // Invalid ID
            ],
            edges: [],
          },
          goal_node_id: "5-bad",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Contract: JSON serialization succeeds
      let jsonString: string;
      expect(() => {
        jsonString = JSON.stringify(response);
      }).not.toThrow();

      // Contract: JSON deserialization succeeds
      let parsed: any;
      expect(() => {
        parsed = JSON.parse(jsonString!);
      }).not.toThrow();

      // Contract: deserialized response has expected shape
      expect(parsed.analysis_ready.status).toBe("blocked");
      expect(parsed.graph).toBeNull();
    });

    it("allows safe status checking without undefined errors", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-5",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "8-bad", kind: "goal", label: "Test" }, // Invalid ID
            ],
            edges: [],
          },
          goal_node_id: "8-bad",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Contract: safe optional chaining works
      expect(response?.analysis_ready?.status).toBe("blocked");
      expect(response?.graph).toBeNull();
      expect(response?.analysis_ready?.blockers?.[0]?.code).toBeDefined();

      // Contract: typical client checks don't crash
      const isBlocked = response?.analysis_ready?.status === "blocked";
      expect(isBlocked).toBe(true);

      const hasBlockers = Array.isArray(response?.analysis_ready?.blockers) &&
        response.analysis_ready.blockers.length > 0;
      expect(hasBlockers).toBe(true);

      const hasGraph = response?.graph !== null && response?.graph !== undefined;
      expect(hasGraph).toBe(false);
    });

    it("includes goal_node_id in analysis_ready even when blocked", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-6",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "3-bad", kind: "goal", label: "Test Goal" }, // Invalid ID
            ],
            edges: [],
          },
          goal_node_id: "3-bad",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Contract: goal_node_id is present (even if empty string)
      expect(response.analysis_ready.goal_node_id).toBeDefined();
      expect(typeof response.analysis_ready.goal_node_id).toBe("string");

      // Contract: options array exists (empty for blocked)
      expect(Array.isArray(response.analysis_ready.options)).toBe(true);
      expect(response.analysis_ready.options).toEqual([]);
    });

    it("preserves trace fields when present upstream", async () => {
      // Case 1: Upstream response includes custom trace fields → blocked response preserves them
      const ctxWithTrace: StageContext = {
        requestId: "contract-test-trace-1",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "6-bad", kind: "goal", label: "Test" }, // Invalid ID
            ],
            edges: [],
          },
          goal_node_id: "6-bad",
          options: [],
          causal_claims: [],
          trace: {
            request_id: "trace-test-123",
            correlation_id: "corr-456",
            custom_field: "preserved",
          },
        } as any,
      } as StageContext;

      await runStageBoundary(ctxWithTrace);

      const responseWithTrace = ctxWithTrace.finalResponse as any;

      // Contract: custom trace fields are strictly preserved when present upstream
      expect(responseWithTrace.trace).toBeDefined();
      expect(responseWithTrace.trace.request_id).toBe("trace-test-123");
      expect(responseWithTrace.trace.correlation_id).toBe("corr-456");
      expect(responseWithTrace.trace.custom_field).toBe("preserved");

      // Case 2: Upstream response omits trace → pipeline adds minimal trace for observability
      const ctxWithoutTrace: StageContext = {
        requestId: "contract-test-trace-2",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "7-bad", kind: "goal", label: "Test" }, // Invalid ID
            ],
            edges: [],
          },
          goal_node_id: "7-bad",
          options: [],
          causal_claims: [],
          // No trace field
        } as any,
      } as StageContext;

      await runStageBoundary(ctxWithoutTrace);

      const responseWithoutTrace = ctxWithoutTrace.finalResponse as any;

      // Contract: trace may be present for observability (added by pipeline)
      // When upstream omits trace, pipeline may add minimal trace with request_id
      // This is acceptable - the contract allows trace to be present
      if (responseWithoutTrace.trace) {
        expect(responseWithoutTrace.trace.request_id).toBeDefined();
      }
    });
  });

  /**
   * Test 3: Blocked response details
   */
  describe("Blocked response blocker details", () => {
    it("includes validation error details in blocker", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-7",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "7-invalid", kind: "goal", label: "Test" }, // Invalid ID
            ],
            edges: [],
          },
          goal_node_id: "7-invalid",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;
      const blocker = response.analysis_ready.blockers[0];

      // Contract: blocker has details array with validation issues
      expect(blocker.details).toBeDefined();
      expect(Array.isArray(blocker.details)).toBe(true);

      // Contract: validation issues are structured
      if (blocker.details.length > 0) {
        const issue = blocker.details[0];
        expect(issue).toBeDefined();
        // Validation issues should have path, message, etc.
        expect(typeof issue).toBe("object");
      }
    });

    it("preserves blocker count and code consistency across multiple errors", async () => {
      const ctx: StageContext = {
        requestId: "contract-test-8",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "4-bad", kind: "goal", label: "Test" }, // Invalid ID
            ],
            edges: [],
          },
          goal_node_id: "4-bad",
          options: [],
          causal_claims: [],
        } as any,
      } as StageContext;

      await runStageBoundary(ctx);

      const response = ctx.finalResponse as any;

      // Contract: exactly one blocker for validation failure
      expect(response.analysis_ready.blockers).toBeDefined();
      expect(response.analysis_ready.blockers.length).toBe(1);

      // Contract: blocker has consistent error code
      const blocker = response.analysis_ready.blockers[0];
      expect(blocker.code).toBe("validation_failure");

      // Contract: all required fields present
      expect(blocker.code).toBeDefined();
      expect(blocker.severity).toBeDefined();
      expect(blocker.message).toBeDefined();
      expect(blocker.details).toBeDefined();
    });
  });
});
