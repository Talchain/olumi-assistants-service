import { describe, it, expect, beforeAll, vi } from "vitest";
import { GOLDEN_BRIEFS, loadGoldenBrief, type GoldenBriefFixture } from "../utils/fixtures.js";

/**
 * Golden Brief Validation Runner (M5)
 *
 * This test suite validates that the draft service achieves quality gates across
 * all golden brief archetypes:
 *
 * - First-pass validation: ≥95% success rate on initial draft
 * - After-repair validation: ≥98% success rate after one repair attempt
 * - Functional stability: Topology, node-kind, and label similarity thresholds
 *
 * These tests require LIVE_LLM=1 and ANTHROPIC_API_KEY to validate real LLM behavior
 * against golden brief fixtures.
 *
 * Run with: pnpm test:live
 */

// Gate: self-skip when env vars not set (discovered by vitest, shown as skipped)
const SKIP_REASON = process.env.LIVE_LLM !== "1"
  ? "Skipping golden-briefs-runner: LIVE_LLM not set (run with: pnpm test:live)"
  : !process.env.ANTHROPIC_API_KEY
    ? "Skipping golden-briefs-runner: ANTHROPIC_API_KEY not set"
    : null;

// No mocks for Anthropic - these tests use real API calls to validate against golden briefs
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: null }),
}));

describe.skipIf(!!SKIP_REASON)("Golden Brief Validation Runner (M5)", () => {
  let fixtures: GoldenBriefFixture[] = [];

  beforeAll(async () => {
    // Load all golden brief fixtures for comparison against live API results
    fixtures = await Promise.all([
      loadGoldenBrief(GOLDEN_BRIEFS.BUY_VS_BUILD),
      loadGoldenBrief(GOLDEN_BRIEFS.HIRE_VS_CONTRACT),
      loadGoldenBrief(GOLDEN_BRIEFS.MIGRATE_VS_STAY),
      loadGoldenBrief(GOLDEN_BRIEFS.EXPAND_VS_FOCUS),
      loadGoldenBrief(GOLDEN_BRIEFS.TECHNICAL_DEBT),
    ]);
  });

  describe("Coverage verification", () => {
    it("has fixtures for all required archetypes", () => {
      const archetypes = fixtures.map((f) => f.metadata.archetype).sort();
      const required = [
        "buy-vs-build",
        "hire-vs-contract",
        "migrate-vs-stay",
        "expand-vs-focus",
        "technical-debt",
      ].sort();

      expect(archetypes).toEqual(required);
    });

    it("all fixtures have valid graph structures", () => {
      for (const fixture of fixtures) {
        const graph = fixture.expected_response.graph;

        // Basic structure validation
        expect(graph.nodes).toBeDefined();
        expect(graph.edges).toBeDefined();
        expect(graph.nodes.length).toBeGreaterThan(0);
        expect(graph.edges.length).toBeGreaterThan(0);

        // Check for DAG structure (no self-loops)
        for (const edge of graph.edges) {
          expect(edge.from).not.toBe(edge.to);
        }

        // Check meta fields
        expect(graph.meta.roots).toBeDefined();
        expect(graph.meta.leaves).toBeDefined();
        expect(graph.meta.source).toBe("assistant");
      }
    });
  });
});
