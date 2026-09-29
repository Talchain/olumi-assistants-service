/**
 * Live LLM Smoke Test (Task 6)
 *
 * Single real-run connectivity check against a live LLM provider.
 * Validates the benchmark harness works with actual LLM output:
 *   - Response is valid and graph is parseable
 *   - Matching layer can process the result
 *   - Stability metrics compute without errors
 *
 * Uses exactly ONE LLM call (not two) to minimize cost and flakiness.
 * Skipped in CI if no LLM credentials are available (env-gated).
 *
 * Run with:
 *   LIVE_LLM=1 ANTHROPIC_API_KEY=... npx vitest run --config tests/benchmarks/vitest.benchmark.config.ts tests/benchmarks/smoke.live.test.ts
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { getGoldBrief } from "./gold-briefs/gold-briefs.js";
import { matchRuns } from "./matching.js";
import { computeBriefStabilityMetrics } from "./stability-metrics.js";
import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";

// ── Environment gate ──────────────────────────────────────────────────────
const hasLiveCredentials =
  process.env.LIVE_LLM === "1" &&
  (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

// Skip entire suite if no credentials
const describeFn = hasLiveCredentials ? describe : describe.skip;

// Mock engine validation (not under test here)
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

describeFn("Live LLM Smoke Test", () => {
  let app: FastifyInstance;
  const brief = getGoldBrief("gold_001");

  // Cache the single LLM response across assertions
  let nodes: any[];
  let edges: any[];
  let rawBody: any;

  beforeAll(async () => {
    // No LLM_PROVIDER stub — use whatever the env specifies
    const draftRoute = (await import("../../src/routes/assist.draft-graph.js")).default;
    app = Fastify({ logger: false });
    await draftRoute(app);

    // Single LLM call for the entire smoke test
    const res = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      payload: { brief: brief.brief_text, seed: "smoke_test_1" },
    });

    expect(res.statusCode).toBe(200);
    rawBody = JSON.parse(res.body);
    nodes = rawBody.nodes ?? rawBody.graph?.nodes ?? [];
    edges = rawBody.edges ?? rawBody.graph?.edges ?? [];
  }, 120_000); // 2 min for LLM roundtrip

  it("response has nodes and edges", () => {
    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
  });

  it("V3 response passes schema validation", () => {
    if (rawBody.schema_version === "3.0") {
      const parsed = CEEGraphResponseV3.safeParse(rawBody);
      if (!parsed.success) {
        console.warn("V3 parse issues:", parsed.error.format());
      }
      expect(parsed.success).toBe(true);
    }
  });

  it("matching layer processes the response without error", () => {
    // Match the single run with itself — validates the layer doesn't crash
    const run = { nodes, edges };
    const matchResult = matchRuns([run, run]);

    expect(matchResult.matched_nodes.length).toBeGreaterThan(0);
    expect(matchResult.matched_edges.length).toBeGreaterThan(0);
    expect(matchResult.intermittent_edges.length).toBe(0); // Same run × 2

    // Stability metrics should compute without errors
    const metrics = computeBriefStabilityMetrics("gold_001", matchResult);
    expect(metrics.structural_stability).toBe(1); // Same run = 100% stable
    expect(metrics.node_set_stable).toBe(true);
  });
});
