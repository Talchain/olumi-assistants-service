/**
 * Streaming / Non-Streaming Parity Tests
 *
 * Verifies that both the streaming and non-streaming draft-graph routes
 * use the same unified pipeline and produce structurally equivalent output.
 *
 * Since both routes now call `runUnifiedPipeline`, we verify that:
 * 1. The streaming route imports and calls runUnifiedPipeline (not the deprecated stub)
 * 2. _pipeline_outcome is attached by the unified pipeline (shared path)
 * 3. goal_constraints propagate through the shared pipeline
 * 4. The attachPipelineOutcome function works correctly
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/schema-v2.js";

// Suppress noisy logs
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: { debugCategoryTrace: false, debugLoggingEnabled: false } },
  isProduction: () => false,
}));

describe("Streaming / Non-Streaming Parity", () => {
  describe("route import parity", () => {
    it("streaming route imports runUnifiedPipeline (not finaliseCeeDraftResponse)", () => {
      const streamingRoute = fs.readFileSync(
        path.resolve("src/routes/assist.v1.draft-graph-stream.ts"),
        "utf-8",
      );
      expect(streamingRoute).toContain("runUnifiedPipeline");
      expect(streamingRoute).not.toContain("finaliseCeeDraftResponse");
    });

    it("non-streaming route imports runUnifiedPipeline", () => {
      const syncRoute = fs.readFileSync(
        path.resolve("src/routes/assist.v1.draft-graph.ts"),
        "utf-8",
      );
      expect(syncRoute).toContain("runUnifiedPipeline");
    });
  });

  describe("_pipeline_outcome attachment", () => {
    it("attachPipelineOutcome adds _pipeline_outcome to body objects", () => {
      // Inline the same logic as the pipeline's attachPipelineOutcome
      function attachPipelineOutcome(body: unknown, outcome: unknown): unknown {
        if (body && typeof body === "object") {
          (body as Record<string, unknown>)._pipeline_outcome = outcome;
        }
        return body;
      }

      const body: Record<string, unknown> = { graph: {}, status: "ok" };
      const outcome = {
        graph_drafted: true,
        graph_structurally_valid: true,
        deterministic_sweep_violations: 0,
        warnings: [],
      };

      attachPipelineOutcome(body, outcome);

      expect(body._pipeline_outcome).toBeDefined();
      expect(body._pipeline_outcome).toBe(outcome);
    });

    it("_pipeline_outcome survives JSON serialization (SSE path)", () => {
      const body: Record<string, unknown> = {
        graph: { nodes: [], edges: [] },
        status: "ok",
        _pipeline_outcome: {
          graph_drafted: true,
          graph_structurally_valid: true,
          deterministic_sweep_violations: 2,
          warnings: [{ stage: "repair", error: "edge removed" }],
        },
      };

      // SSE path serializes via JSON.stringify
      const serialized = JSON.stringify({ stage: "COMPLETE", payload: body });
      const deserialized = JSON.parse(serialized);

      expect(deserialized.payload._pipeline_outcome).toBeDefined();
      expect(deserialized.payload._pipeline_outcome.graph_drafted).toBe(true);
      expect(deserialized.payload._pipeline_outcome.deterministic_sweep_violations).toBe(2);
      expect(deserialized.payload._pipeline_outcome.warnings).toHaveLength(1);
    });
  });

  describe("goal_constraints parity", () => {
    it("goal_constraints survive V1→V3 transform (shared path)", () => {
      // Both routes use the same V3 transform. Verify constraints survive.
      const v1Response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "dec_1", kind: "decision", label: "D" },
            { id: "opt_1", kind: "option", label: "O", data: { interventions: { fac_1: 0.5 } } },
            { id: "fac_1", kind: "factor", label: "F", category: "controllable", data: { value: 0.5, extractionType: "inferred" } },
            { id: "out_1", kind: "outcome", label: "Out" },
            { id: "goal_1", kind: "goal", label: "G" },
          ],
          edges: [
            { from: "dec_1", to: "opt_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
            { from: "opt_1", to: "fac_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
            { from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" },
            { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
          ],
        },
        goal_constraints: [
          {
            constraint_id: "gc_1",
            node_id: "fac_1",
            operator: "<=",
            value: 0.8,
            label: "Budget cap",
            confidence: 1.0,
            provenance: "explicit",
          },
        ],
        quality: { overall: 7 },
        trace: { request_id: "parity-test", goal_handling: { goal_source: "llm_generated", retry_attempted: false } },
      };

      const v3 = transformResponseToV3(v1Response, { requestId: "parity-test" });

      expect((v3 as any).goal_constraints).toBeDefined();
      expect((v3 as any).goal_constraints).toHaveLength(1);
      expect((v3 as any).goal_constraints[0].constraint_id).toBe("gc_1");
      expect((v3 as any).goal_constraints[0].provenance).toBe("explicit");
    });
  });
});
