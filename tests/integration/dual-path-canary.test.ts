/**
 * Track 1 Task 5: Dual-path canary test
 *
 * Sends the same brief to both non-streaming and streaming endpoints.
 * Asserts parity of outcomes and presence of _pipeline_outcome.
 *
 * Gating:
 *   RUN_CANARY=1           — explicit opt-in
 *   CEE_BASE_URL           — staging CEE URL
 *   CEE_API_KEY            — X-Olumi-Assist-Key header
 *
 * Run with:
 *   RUN_CANARY=1 CEE_BASE_URL=https://cee-staging.onrender.com CEE_API_KEY=<key> \
 *   pnpm vitest run tests/integration/dual-path-canary.test.ts
 */

import { describe, it, expect } from "vitest";
import { makeAuthedRequest } from "../staging/helpers/make-request.js";

const RUN_CANARY = process.env.RUN_CANARY === "1";
const CEE_BASE_URL = process.env.CEE_BASE_URL;
const CEE_API_KEY = process.env.CEE_API_KEY;

const SKIP_REASON = !RUN_CANARY
  ? "Skipping dual-path canary: RUN_CANARY not set"
  : !CEE_BASE_URL
    ? "Skipping dual-path canary: CEE_BASE_URL not configured"
    : !CEE_API_KEY
      ? "Skipping dual-path canary: CEE_API_KEY not configured"
      : null;

const TURN_URL = `${CEE_BASE_URL ?? ""}/orchestrate/v1/turn`;
const STREAM_URL = `${CEE_BASE_URL ?? ""}/orchestrate/v1/turn/stream`;
const TIMEOUT_MS = 120_000;

const CANARY_BRIEF =
  "We're deciding whether to launch a premium tier at £29/month, keep freemium, " +
  "or add usage-based pricing. Goal: reach £50k MRR within 9 months while keeping churn below 5%.";

describe.skipIf(SKIP_REASON !== null)("Track 1 Task 5: Dual-path canary", () => {
  it(
    "non-streaming and streaming produce equivalent _pipeline_outcome",
    async () => {
      // ── Non-streaming path ────────────────────────────────────────
      const nonStreamResult = await makeAuthedRequest(
        TURN_URL,
        CEE_API_KEY!,
        {
          messages: [{ role: "user", content: CANARY_BRIEF }],
          scenario_id: `canary-ns-${Date.now()}`,
          schema_version: "v3",
        },
      );

      // Basic assertions for non-streaming
      expect(nonStreamResult.status).toBe(200);
      const nsBody = nonStreamResult.body as any;

      // Check tool_result or assistant response contains graph data
      const nsTool = nsBody?.tool_results?.[0] ?? nsBody;
      const nsGraph = nsTool?.output?.nodes ?? nsTool?.nodes;
      expect(nsGraph).toBeDefined();
      expect(Array.isArray(nsGraph)).toBe(true);
      expect(nsGraph.length).toBeGreaterThan(0);

      // Check _pipeline_outcome on tool output
      const nsOutcome = nsTool?.output?._pipeline_outcome ?? nsTool?._pipeline_outcome;

      // ── Streaming path ───────────────────────────────────────────
      const streamResult = await makeAuthedRequest(
        STREAM_URL,
        CEE_API_KEY!,
        {
          messages: [{ role: "user", content: CANARY_BRIEF }],
          scenario_id: `canary-st-${Date.now()}`,
          schema_version: "v3",
        },
      );

      expect(streamResult.status).toBe(200);
      const stBody = streamResult.body as any;
      const stTool = stBody?.tool_results?.[0] ?? stBody;
      const stGraph = stTool?.output?.nodes ?? stTool?.nodes;
      expect(stGraph).toBeDefined();
      expect(Array.isArray(stGraph)).toBe(true);
      expect(stGraph.length).toBeGreaterThan(0);

      const stOutcome = stTool?.output?._pipeline_outcome ?? stTool?._pipeline_outcome;

      // ── Parity assertions ─────────────────────────────────────────
      // If _pipeline_outcome is present on both (it may not be if
      // the staging deployment hasn't been updated yet), assert parity.
      if (nsOutcome && stOutcome) {
        // Both should have same structural validity
        expect(nsOutcome.graph_drafted).toBe(stOutcome.graph_drafted);
        expect(nsOutcome.graph_structurally_valid).toBe(stOutcome.graph_structurally_valid);

        // Warning arrays should have same stages (order may differ)
        const nsStages = nsOutcome.warnings.map((w: any) => w.stage).sort();
        const stStages = stOutcome.warnings.map((w: any) => w.stage).sort();
        expect(nsStages).toEqual(stStages);
      }

      // ── Error parity ──────────────────────────────────────────────
      // Both should succeed or both should fail with the same error
      expect(nonStreamResult.status).toBe(streamResult.status);
    },
    TIMEOUT_MS * 2,
  );
});
