/**
 * Staging smoke test: CEE PLoT client → /v1/validate-patch
 *
 * Proves that CEE's PLoT client can reach staging PLoT's /v1/validate-patch
 * and correctly parse the typed response — success (applied) and rejection (cycle).
 *
 * Gating:
 *   - RUN_STAGING_SMOKE=1        (explicit opt-in)
 *   - PLOT_BASE_URL configured   (staging PLoT URL)
 *
 * Run with: pnpm test:staging
 * (or: RUN_STAGING_SMOKE=1 PLOT_BASE_URL=<url> PLOT_AUTH_TOKEN=<token> vitest run tests/staging/)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPLoTClient, type ValidatePatchResult } from "../../src/orchestrator/plot-client.js";
import { _resetConfigCache } from "../../src/config/index.js";

// ============================================================================
// Gating — skip entire suite if conditions not met
// ============================================================================

const RUN_STAGING_SMOKE = process.env.RUN_STAGING_SMOKE === "1";
const PLOT_BASE_URL = process.env.PLOT_BASE_URL;

const SKIP_REASON = !RUN_STAGING_SMOKE
  ? "Skipping staging smoke: RUN_STAGING_SMOKE not set"
  : !PLOT_BASE_URL
    ? "Skipping staging smoke: PLOT_BASE_URL not configured"
    : null;

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Minimal valid graph: 1 goal, 1 decision, 2 options, 2 factors, 1 outcome.
 * All edge strengths are canonical nested format (V3). No option nodes in edges
 * (options are separate from graph in V3, but we include option connectivity
 * nodes for the decision → option → factor path).
 *
 * H.5 requirement: graph present, operations non-empty array.
 * Fixture is simple enough to avoid triggering repairs or warnings.
 */
const BASE_GRAPH = {
  nodes: [
    { id: "goal_revenue", kind: "goal", label: "Increase Revenue" },
    { id: "dec_pricing", kind: "decision", label: "Pricing Strategy" },
    { id: "opt_premium", kind: "option", label: "Premium Pricing" },
    { id: "opt_value", kind: "option", label: "Value Pricing" },
    { id: "factor_price", kind: "factor", label: "Average Price" },
    { id: "factor_volume", kind: "factor", label: "Sales Volume" },
    { id: "outcome_margin", kind: "outcome", label: "Gross Margin" },
  ],
  edges: [
    {
      from: "dec_pricing",
      to: "opt_premium",
      strength: { mean: 1.0, std: 0.05 },
      exists_probability: 1.0,
      effect_direction: "positive",
    },
    {
      from: "dec_pricing",
      to: "opt_value",
      strength: { mean: 1.0, std: 0.05 },
      exists_probability: 1.0,
      effect_direction: "positive",
    },
    {
      from: "opt_premium",
      to: "factor_price",
      strength: { mean: 0.8, std: 0.1 },
      exists_probability: 0.95,
      effect_direction: "positive",
    },
    {
      from: "opt_value",
      to: "factor_volume",
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    },
    {
      from: "factor_price",
      to: "goal_revenue",
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    },
    {
      from: "factor_volume",
      to: "goal_revenue",
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.85,
      effect_direction: "positive",
    },
    {
      from: "factor_price",
      to: "outcome_margin",
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    },
  ],
};

/** New factor to add in Test 1. ID is distinct from all existing nodes. */
const NEW_FACTOR_ID = "factor_brand_perception";

/** Test 1 operations: add a new factor node + connect it to goal. */
const SUCCESS_OPERATIONS = [
  {
    op: "add_node",
    path: `nodes/${NEW_FACTOR_ID}`,
    value: {
      id: NEW_FACTOR_ID,
      kind: "factor",
      label: "Brand Perception",
    },
  },
  {
    op: "add_edge",
    path: `edges/${NEW_FACTOR_ID}_to_goal`,
    value: {
      from: NEW_FACTOR_ID,
      to: "goal_revenue",
      strength: { mean: 0.4, std: 0.15 },
      exists_probability: 0.75,
      effect_direction: "positive",
    },
  },
];

/** Test 2 operations: create a cycle by adding edge from goal back to a factor. */
const CYCLE_OPERATIONS = [
  {
    op: "add_edge",
    path: "edges/cycle_goal_to_factor",
    value: {
      from: "goal_revenue",
      to: "factor_price",
      strength: { mean: 0.3, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: "positive",
    },
  },
];

// ============================================================================
// Suite
// ============================================================================

describe("PLoT /v1/validate-patch staging smoke", { timeout: 60_000 }, () => {
  let originalPlotBaseUrl: string | undefined;
  let originalPlotAuthToken: string | undefined;

  beforeAll(() => {
    if (SKIP_REASON) return;

    // Capture originals so afterAll can restore
    originalPlotBaseUrl = process.env.PLOT_BASE_URL;
    originalPlotAuthToken = process.env.PLOT_AUTH_TOKEN;

    // Ensure env vars are set (they should already be from process.env,
    // but we explicitly set them to be sure and reset the config cache)
    process.env.PLOT_BASE_URL = PLOT_BASE_URL!;
    // PLOT_AUTH_TOKEN stays as-is from environment (may be undefined)

    // Reset config cache so the Proxy picks up the current env
    _resetConfigCache();
  });

  afterAll(() => {
    if (SKIP_REASON) return;

    // Restore originals
    if (originalPlotBaseUrl !== undefined) {
      process.env.PLOT_BASE_URL = originalPlotBaseUrl;
    } else {
      delete process.env.PLOT_BASE_URL;
    }

    if (originalPlotAuthToken !== undefined) {
      process.env.PLOT_AUTH_TOKEN = originalPlotAuthToken;
    } else {
      delete process.env.PLOT_AUTH_TOKEN;
    }

    _resetConfigCache();
  });

  // --------------------------------------------------------------------------
  // Test 1: successful validation (patch applied)
  // --------------------------------------------------------------------------

  it(
    "returns kind=success (applied) for a valid add_node + add_edge patch",
    { timeout: 15_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      const client = createPLoTClient();
      if (!client) {
        throw new Error(
          `PLoT client not created — PLOT_BASE_URL=${PLOT_BASE_URL}. ` +
          "Check that createPLoTClient() reads from the env var.",
        );
      }

      const requestId = `staging-smoke-success-${Date.now()}`;
      const payload = {
        graph: BASE_GRAPH,
        operations: SUCCESS_OPERATIONS,
      };

      let result: ValidatePatchResult;
      try {
        result = await client.validatePatch(payload, requestId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `validate-patch call failed:\n` +
          `  base_url: ${PLOT_BASE_URL}\n` +
          `  request_id: ${requestId}\n` +
          `  error: ${errMsg}`,
        );
      }

      // Diagnostics on failure
      const diagnosticsCtx = {
        base_url: PLOT_BASE_URL,
        request_id: requestId,
        result_kind: result.kind,
        result_snippet: JSON.stringify(result).slice(0, 500),
      };

      expect(result.kind, `Expected kind=success but got ${result.kind}. Diagnostics: ${JSON.stringify(diagnosticsCtx)}`).toBe("success");

      if (result.kind === "success") {
        // graph_hash: PLoT should return a non-empty string hash
        const graphHash = result.data.graph_hash;
        expect(
          typeof graphHash === "string" && graphHash.length > 0,
          `Expected graph_hash to be a non-empty string. Got: ${JSON.stringify(graphHash)}. Diagnostics: ${JSON.stringify(diagnosticsCtx)}`,
        ).toBe(true);

        // warnings: array (may be empty or contain objects/strings depending on PLoT version)
        const warnings = result.data.warnings;
        if (warnings !== undefined) {
          expect(
            Array.isArray(warnings),
            `Expected warnings to be an array. Got: ${JSON.stringify(warnings)}. Diagnostics: ${JSON.stringify(diagnosticsCtx)}`,
          ).toBe(true);
        }

        // graph/applied_graph: the returned graph should be present
        const returnedGraph = result.data.applied_graph ?? result.data.graph;
        expect(
          returnedGraph != null && typeof returnedGraph === "object",
          `Expected applied_graph or graph to be present in response. Diagnostics: ${JSON.stringify(diagnosticsCtx)}`,
        ).toBe(true);
      }
    },
  );

  // --------------------------------------------------------------------------
  // Test 2: rejection — cycle detection
  // --------------------------------------------------------------------------

  it(
    "returns kind=rejection (cycle) for an edge that creates a cycle",
    { timeout: 15_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      const client = createPLoTClient();
      if (!client) {
        throw new Error(
          `PLoT client not created — PLOT_BASE_URL=${PLOT_BASE_URL}. ` +
          "Check that createPLoTClient() reads from the env var.",
        );
      }

      const requestId = `staging-smoke-cycle-${Date.now()}`;
      const payload = {
        graph: BASE_GRAPH,
        operations: CYCLE_OPERATIONS,
      };

      let result: ValidatePatchResult;
      try {
        result = await client.validatePatch(payload, requestId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `validate-patch call failed:\n` +
          `  base_url: ${PLOT_BASE_URL}\n` +
          `  request_id: ${requestId}\n` +
          `  error: ${errMsg}`,
        );
      }

      const diagnosticsCtx = {
        base_url: PLOT_BASE_URL,
        request_id: requestId,
        result_kind: result.kind,
        result_snippet: JSON.stringify(result).slice(0, 500),
      };

      // PLoT should reject with a 422 — mapped to kind=rejection
      expect(
        result.kind,
        `Expected kind=rejection but got ${result.kind}. ` +
        `Diagnostics: ${JSON.stringify(diagnosticsCtx)}`,
      ).toBe("rejection");

      if (result.kind === "rejection") {
        // code: PLoT should surface CYCLE_DETECTED (or similar)
        expect(
          typeof result.code === "string" && result.code.length > 0,
          `Expected rejection.code to be a non-empty string. Got: ${JSON.stringify(result.code)}. ` +
          `Diagnostics: ${JSON.stringify(diagnosticsCtx)}`,
        ).toBe(true);

        // message: human-readable rejection reason
        expect(
          typeof result.message === "string" && result.message.length > 0,
          `Expected rejection.message to be a non-empty string. Got: ${JSON.stringify(result.message)}. ` +
          `Diagnostics: ${JSON.stringify(diagnosticsCtx)}`,
        ).toBe(true);
      }
    },
  );
});
