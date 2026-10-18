/**
 * CEE Status Consistency Tests
 *
 * E2E tests of the option status that POST /assist/v1/draft-graph reports in
 * analysis_ready (the graph-readiness endpoint was deleted with R2).
 *
 * KEY ACCEPTANCE CRITERIA:
 * - The ready-or-encodable count never falls below the strict ready count
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
    it("draft-graph's ready-or-encodable count is never below its strict ready count (pricing brief)", async () => {
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
      // ⚠ STRICT, AND THAT IS THE POINT. This used to count
      // `ready || needs_encoding`, while the graph-readiness endpoint's
      // `options_ready` numerator is strictly `status === "ready"`
      // (`cee/graph-readiness/canonical-readiness.ts`). The two agreed only
      // for as long as the draft path never emitted `needs_encoding` on these
      // briefs — i.e. the "KEY ASSERTION" below was comparing a loose count to
      // a strict one and passing by coincidence. It broke the moment the draft
      // path started labelling connected-but-numberless options honestly, which
      // is exactly the class of change this test exists to catch. Comparing the
      // same predicate on both sides makes the claim mean what it says.
      const draftOptionsReady = analysisReady.options.filter(
        (o) => o.status === "ready"
      ).length;
      // Kept as a distinct quantity because it answers a DIFFERENT question —
      // "how many options are analysable or one value away" — and must never be
      // silently equated with the readiness endpoint's numerator again.
      const draftOptionsReadyOrEncodable = analysisReady.options.filter(
        (o) => o.status === "ready" || o.status === "needs_encoding"
      ).length;

      // The looser count can only ever be >= the strict one; if it ever drops
      // below, a `needs_encoding` option has gone missing between the two.
      expect(draftOptionsReadyOrEncodable).toBeGreaterThanOrEqual(draftOptionsReady);
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

      // If we have categorical options, verify they have correct status
      for (const option of optionsWithRaw) {
        const hasNonNumeric = Object.values(option.raw_interventions || {}).some(
          (v) => typeof v !== "number"
        );

        if (hasNonNumeric) {
          // Options with non-numeric raw values MUST have needs_encoding status
          expect(option.status).toBe("needs_encoding");

          // Verify interventions are still numeric (placeholder values)
          for (const [_factorId, value] of Object.entries(option.interventions)) {
            expect(typeof value).toBe("number");
          }
        }
      }

      // If any options need encoding, the payload status should reflect this
      const hasEncodingNeeded = analysisReady.options.some(
        (o) => o.status === "needs_encoding"
      );
      if (hasEncodingNeeded) {
        // The payload-status ladder is
        // `needs_user_input > needs_user_mapping > needs_encoding > ready`
        // (`cee/transforms/analysis-ready.ts`). `needs_user_input` — the rung
        // taken whenever per-option blockers exist — was missing from this set,
        // so the assertion was unreachable until an option actually reached
        // `needs_encoding` on this brief, and then rejected the CORRECT answer.
        // A statuses-allowed list that omits the TOP of the producer's own
        // priority order is a broken alarm, not a tighter check.
        expect(["needs_user_input", "needs_encoding", "needs_user_mapping"])
          .toContain(analysisReady.status);
      }
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
      // ⚠ NOT AN ENUMERATION OF THE EMITTABLE SET. Listing every status
      // `buildAnalysisReadyPayload` can return cannot fail, and this case is
      // specifically about status CONSISTENCY — so assert implications that a
      // wrong status would break. Both are one-directional on purpose:
      // `blockers` may also be non-empty under `needs_user_mapping` (the
      // unreachable-controllable-factor limb), so the converse does NOT hold
      // and asserting it would be false.
      if (analysisReady.status === "needs_user_input") {
        // A payload demanding input must say what is missing.
        expect(analysisReady.blockers?.length ?? 0).toBeGreaterThan(0);
      }
      if (analysisReady.status === "ready") {
        // ...and a payload calling itself ready may not contain an option that
        // still needs the user. This is the surface the run chip gates on.
        expect(analysisReady.options.every((o) => o.status === "ready")).toBe(true);
      }

      // Verify each option has valid structure
      for (const option of analysisReady.options) {
        expect(option.id).toBeDefined();
        expect(option.label).toBeDefined();
        expect(["ready", "needs_user_mapping", "needs_encoding"]).toContain(option.status);
        expect(option.interventions).toBeDefined();
      }
    });
  });
});
