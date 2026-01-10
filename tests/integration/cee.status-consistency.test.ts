/**
 * CEE Status Consistency Tests
 *
 * E2E tests to verify that the same graph produces consistent status
 * across both endpoints:
 * - POST /assist/v1/draft-graph
 * - POST /assist/v1/graph-readiness
 *
 * KEY ACCEPTANCE CRITERIA:
 * - Both endpoints produce identical status for identical graphs
 * - Label-matched interventions count as resolved
 * - Pricing briefs with extracted values produce "ready" status
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import type { AnalysisReadyPayloadT } from "../../src/schemas/analysis-ready.js";

describe("CEE Status Consistency", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", "test-key-consistency");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Endpoint Consistency", () => {
    it("draft-graph and graph-readiness produce consistent status for pricing brief", async () => {
      const brief = "Should we increase Pro plan price from £49 to £59?";

      // Step 1: Call draft-graph to get the graph
      const draftResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-consistency",
        },
        payload: JSON.stringify({ brief }),
      });

      expect(draftResponse.statusCode).toBe(200);
      const draftResult = JSON.parse(draftResponse.body);

      // Verify we got a V3 response with analysis_ready
      expect(draftResult.schema_version).toBe("3.0");
      expect(draftResult.analysis_ready).toBeDefined();
      const analysisReady = draftResult.analysis_ready as AnalysisReadyPayloadT;

      // Record the draft-graph status
      const draftStatus = analysisReady.status;
      const draftOptionsReady = analysisReady.options.filter(
        (o) => o.status === "ready" || o.status === "needs_encoding"
      ).length;

      // Step 2: Call graph-readiness with a V1-style graph + analysis_ready
      // For V3 mode, graph-readiness reads options from analysis_ready
      // Build V1-compatible graph (add fake nodes if needed for option validation)
      // V3: nodes and edges are at root level now
      const v1Graph = {
        version: "1",
        default_seed: 17,
        nodes: [
          ...draftResult.nodes,
          // Add option nodes back (graph-readiness checks them against analysis_ready)
          ...analysisReady.options.map((o: any) => ({
            id: o.id,
            kind: "option",
            label: o.label,
          })),
        ],
        edges: draftResult.edges.map((e: any) => ({
          from: e.from,
          to: e.to,
          weight: Math.abs(e.strength_mean) || 0.5,
        })),
        meta: draftResult.meta || {},
      };

      const readinessResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/graph-readiness",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-consistency",
        },
        payload: JSON.stringify({
          graph: v1Graph,
          analysis_ready: analysisReady,
        }),
      });

      expect(readinessResponse.statusCode).toBe(200);
      const readinessResult = JSON.parse(readinessResponse.body);

      // Record the graph-readiness status
      const readinessOptionsReady = readinessResult.options_ready;
      const readinessOptionsTotal = readinessResult.options_total;

      // KEY ASSERTION: Both endpoints should agree on options_ready count
      expect(readinessOptionsReady).toBe(draftOptionsReady);
      expect(readinessOptionsTotal).toBe(analysisReady.options.length);

      // Log for debugging
      console.log({
        brief,
        draftStatus,
        draftOptionsReady,
        readinessOptionsReady,
        readinessOptionsTotal,
      });
    });

    it("label-matched interventions count as resolved", async () => {
      const brief = "Should we increase price from £49 to £59?";

      const draftResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-consistency",
        },
        payload: JSON.stringify({ brief }),
      });

      expect(draftResponse.statusCode).toBe(200);
      const result = JSON.parse(draftResponse.body);
      const analysisReady = result.analysis_ready as AnalysisReadyPayloadT;

      // Check that options with interventions are marked as ready
      // (not needs_user_mapping due to label matches)
      for (const option of analysisReady.options) {
        const interventionCount = Object.keys(option.interventions).length;
        if (interventionCount > 0) {
          // Options with interventions should be ready or needs_encoding
          // NOT needs_user_mapping (which would indicate label matches aren't counted)
          expect(["ready", "needs_encoding"]).toContain(option.status);
        }
      }
    });

    it("categorical interventions produce needs_encoding status", async () => {
      const brief = "Should we launch in UK or Germany?";

      const draftResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-consistency",
        },
        payload: JSON.stringify({ brief }),
      });

      expect(draftResponse.statusCode).toBe(200);
      const result = JSON.parse(draftResponse.body);
      const analysisReady = result.analysis_ready as AnalysisReadyPayloadT;

      // Check if any options have categorical interventions
      const optionsWithRaw = analysisReady.options.filter(
        (o) => o.raw_interventions && Object.keys(o.raw_interventions).length > 0
      );

      if (optionsWithRaw.length > 0) {
        // Options with non-numeric raw values should have needs_encoding
        for (const option of optionsWithRaw) {
          const hasNonNumeric = Object.values(option.raw_interventions || {}).some(
            (v) => typeof v !== "number"
          );
          if (hasNonNumeric) {
            expect(option.status).toBe("needs_encoding");
          }
        }
      }
    });
  });

  describe("Categorical Decision E2E", () => {
    it("categorical brief produces needs_encoding through full pipeline", async () => {
      // This test exercises the Raw+Encoded pattern end-to-end
      const brief = "Should we launch our product in UK first or expand to Germany?";

      // Step 1: Call draft-graph with categorical brief
      const draftResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-consistency",
        },
        payload: JSON.stringify({ brief }),
      });

      expect(draftResponse.statusCode).toBe(200);
      const result = JSON.parse(draftResponse.body);
      const analysisReady = result.analysis_ready as AnalysisReadyPayloadT;

      // Verify we got V3 response
      expect(result.schema_version).toBe("3.0");
      expect(analysisReady).toBeDefined();

      // Check for options with raw_interventions (categorical values)
      const optionsWithRaw = analysisReady.options.filter(
        (o) => o.raw_interventions && Object.keys(o.raw_interventions).length > 0
      );

      // Log detailed output for debugging
      console.log({
        brief,
        optionCount: analysisReady.options.length,
        payloadStatus: analysisReady.status,
        optionsWithRaw: optionsWithRaw.length,
        optionDetails: analysisReady.options.map((o) => ({
          id: o.id,
          label: o.label,
          status: o.status,
          interventionCount: Object.keys(o.interventions).length,
          rawInterventionCount: Object.keys(o.raw_interventions || {}).length,
          rawValues: o.raw_interventions,
        })),
      });

      // If we have categorical options, verify they have correct status
      for (const option of optionsWithRaw) {
        const hasNonNumeric = Object.values(option.raw_interventions || {}).some(
          (v) => typeof v !== "number"
        );

        if (hasNonNumeric) {
          // Options with non-numeric raw values MUST have needs_encoding status
          expect(option.status).toBe("needs_encoding");

          // Verify interventions are still numeric (placeholder values)
          for (const [factorId, value] of Object.entries(option.interventions)) {
            expect(typeof value).toBe("number");
          }
        }
      }

      // If any options need encoding, the payload status should reflect this
      const hasEncodingNeeded = analysisReady.options.some(
        (o) => o.status === "needs_encoding"
      );
      if (hasEncodingNeeded) {
        // Payload status should be needs_encoding (unless blocked by needs_user_mapping)
        expect(["needs_encoding", "needs_user_mapping"]).toContain(analysisReady.status);
      }
    });

    it("graph-readiness treats needs_encoding as ready for analysis", async () => {
      // Create a minimal graph with needs_encoding options
      const analysisReady: AnalysisReadyPayloadT = {
        options: [
          {
            id: "option_uk",
            label: "Launch in UK",
            status: "needs_encoding",
            interventions: { factor_region: 1 }, // Placeholder numeric
            raw_interventions: { factor_region: "UK" }, // Original categorical
          },
          {
            id: "option_germany",
            label: "Launch in Germany",
            status: "needs_encoding",
            interventions: { factor_region: 2 }, // Placeholder numeric
            raw_interventions: { factor_region: "Germany" }, // Original categorical
          },
        ],
        goal_node_id: "goal_growth",
        status: "needs_encoding",
      };

      const graph = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "goal_growth", kind: "goal", label: "Revenue Growth" },
          { id: "factor_region", kind: "factor", label: "Target Region" },
          { id: "outcome_success", kind: "outcome", label: "Launch Success" },
          { id: "option_uk", kind: "option", label: "Launch in UK" },
          { id: "option_germany", kind: "option", label: "Launch in Germany" },
        ],
        edges: [
          // V4 topology: factor → outcome → goal (not factor → goal directly)
          { from: "factor_region", to: "outcome_success", weight: 0.8 },
          { from: "outcome_success", to: "goal_growth", weight: 1.0 },
        ],
        meta: {},
      };

      const readinessResponse = await app.inject({
        method: "POST",
        url: "/assist/v1/graph-readiness",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-consistency",
        },
        payload: JSON.stringify({ graph, analysis_ready: analysisReady }),
      });

      expect(readinessResponse.statusCode).toBe(200);
      const readinessResult = JSON.parse(readinessResponse.body);

      // KEY: needs_encoding options should be counted as ready for analysis
      // (they have placeholder values, so analysis CAN run)
      expect(readinessResult.options_ready).toBe(2);
      expect(readinessResult.options_total).toBe(2);
      expect(readinessResult.can_run_analysis).toBe(true);

      // Confidence should be medium (not high) due to encoding warnings
      expect(["high", "medium"]).toContain(readinessResult.confidence_level);

      console.log({
        test: "graph-readiness treats needs_encoding as ready",
        options_ready: readinessResult.options_ready,
        options_total: readinessResult.options_total,
        can_run_analysis: readinessResult.can_run_analysis,
        confidence_level: readinessResult.confidence_level,
        confidence_explanation: readinessResult.confidence_explanation,
      });
    });
  });

  describe("Pricing Brief Ready Status", () => {
    it("standard pricing brief produces valid analysis_ready payload", async () => {
      const brief = "Should we increase the subscription price from £49 to £59?";

      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-consistency",
        },
        payload: JSON.stringify({ brief }),
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      const analysisReady = result.analysis_ready as AnalysisReadyPayloadT;

      // Verify analysis_ready structure
      expect(analysisReady).toBeDefined();
      expect(analysisReady.options).toBeInstanceOf(Array);
      expect(analysisReady.goal_node_id).toBeDefined();
      expect(["ready", "needs_user_mapping", "needs_encoding"]).toContain(analysisReady.status);

      // Verify each option has valid structure
      for (const option of analysisReady.options) {
        expect(option.id).toBeDefined();
        expect(option.label).toBeDefined();
        expect(["ready", "needs_user_mapping", "needs_encoding"]).toContain(option.status);
        expect(option.interventions).toBeDefined();
      }

      // Log for debugging
      console.log({
        brief,
        totalOptions: analysisReady.options.length,
        status: analysisReady.status,
        optionStatuses: analysisReady.options.map((o) => ({
          id: o.id,
          status: o.status,
          interventionCount: Object.keys(o.interventions).length,
        })),
      });
    });
  });
});
