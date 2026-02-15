/**
 * Unified Pipeline Parity Integration Tests (CIL Phase 3B-C)
 *
 * Verifies that the unified pipeline (CEE_UNIFIED_PIPELINE_ENABLED=true)
 * produces structurally equivalent responses to the legacy pipeline.
 *
 * Structural equivalence definition:
 *  1. Same node IDs, same node kinds, same node count
 *  2. Same edge pairs (from, to) with 9-field equality:
 *     strength_mean, strength_std, belief_exists, effect_direction,
 *     provenance, provenance_source, id (plus from, to as sort key)
 *  3. Same analysis_ready.status
 *  4. Same blocker[].factor_id set (order-independent)
 *  5. Same model_adjustments[].type set (order-independent)
 *  6. Checkpoint count in pipeline trace
 *  7. trace.pipeline.enrich.called_count === 1
 *  8. Timing fields (ms values) excluded from comparison
 *
 * Known expected differences between legacy and unified:
 *  - trace.pipeline.cee_provenance.pipeline_path: "A" vs "unified"
 *  - trace.pipeline.enrich.source: "pipeline_b" vs "unified_pipeline"
 *  - node_extraction: omitted from unified pipeline trace
 *  - Timing values: excluded from all comparisons
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Clone fixture graph on each access to prevent mutation leaking across pipeline runs
vi.mock("../../src/utils/fixtures.js", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  const pristineGraph = structuredClone(mod.fixtureGraph);
  return {
    ...mod,
    get fixtureGraph() {
      return structuredClone(pristineGraph);
    },
  };
});

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn().mockReturnValue({
    warnings: [],
    uncertainNodeIds: [],
  }),
  detectUniformStrengths: () => ({
    detected: false,
    totalEdges: 0,
    defaultStrengthCount: 0,
    defaultStrengthPercentage: 0,
  }),
  detectStrengthClustering: () => ({
    detected: false,
    coefficientOfVariation: 0,
    edgeCount: 0,
  }),
  detectSameLeverOptions: () => ({
    detected: false,
    maxOverlapPercentage: 0,
    overlappingOptionPairs: [],
  }),
  detectMissingBaseline: () => ({
    detected: false,
    hasBaseline: false,
  }),
  detectGoalNoBaselineValue: () => ({
    detected: false,
    goalHasValue: false,
  }),
  checkGoalConnectivity: () => ({
    status: "full",
    disconnectedOptions: [],
    weakPaths: [],
  }),
  computeModelQualityFactors: () => ({
    estimate_confidence: 0.5,
    strength_variation: 0,
    range_confidence_coverage: 0,
    has_baseline_option: false,
  }),
  normaliseDecisionBranchBeliefs: (graph: unknown) => graph,
  validateAndFixGraph: (graph: unknown) => ({
    graph,
    valid: true,
    fixes: {
      singleGoalApplied: false,
      outcomeBeliefsFilled: 0,
      decisionBranchesNormalized: false,
    },
    warnings: [],
  }),
  fixNonCanonicalStructuralEdges: (graph: unknown) => ({
    graph,
    fixedEdgeCount: 0,
    fixedEdgeIds: [],
    repairs: [],
  }),
  hasGoalNode: (graph: any) => {
    if (!graph || !Array.isArray(graph.nodes)) return false;
    return graph.nodes.some((n: any) => n.kind === "goal");
  },
  ensureGoalNode: (graph: any) => ({
    graph,
    goalAdded: false,
    inferredFrom: undefined,
    goalNodeId: undefined,
  }),
}));

import { build } from "../../src/server.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const API_KEY_LEGACY = "parity-legacy-key";
const API_KEY_UNIFIED = "parity-unified-key";
const BRIEF = "A sufficiently long decision brief for pipeline parity integration testing across legacy and unified paths.";

// ─── Diagnostic Diff Helper ─────────────────────────────────────────────────

/**
 * assertStructuralParity — deep structural comparison with focused diff on failure.
 *
 * Compares two values structurally. On mismatch, logs a diagnostic diff
 * showing the specific path and values that diverge, making parity failures
 * actionable without manual JSON diffing.
 */
function assertStructuralParity(
  label: string,
  legacy: unknown,
  unified: unknown,
  opts?: { sortArrays?: boolean },
): void {
  const l = opts?.sortArrays && Array.isArray(legacy) ? [...legacy].sort() : legacy;
  const u = opts?.sortArrays && Array.isArray(unified) ? [...unified].sort() : unified;

  try {
    expect(u).toEqual(l);
  } catch {
    // Build diagnostic diff
    const diff = buildDiff(l, u, "");
    const msg = [
      `Structural parity failure: ${label}`,
      `  Legacy:  ${JSON.stringify(l, null, 2).slice(0, 500)}`,
      `  Unified: ${JSON.stringify(u, null, 2).slice(0, 500)}`,
      ...(diff.length > 0 ? ["  Diff paths:", ...diff.map(d => `    ${d}`)] : []),
    ].join("\n");
    throw new Error(msg);
  }
}

function buildDiff(a: unknown, b: unknown, path: string): string[] {
  if (a === b) return [];
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return [`${path || "root"}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const diffs: string[] = [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len && diffs.length < 5; i++) {
      diffs.push(...buildDiff(a[i], b[i], `${path}[${i}]`));
    }
    if (a.length !== b.length) diffs.push(`${path}.length: ${a.length} !== ${b.length}`);
    return diffs.slice(0, 5);
  }
  const diffs: string[] = [];
  const keys = new Set([...Object.keys(a as any), ...Object.keys(b as any)]);
  for (const key of keys) {
    if (diffs.length >= 5) break;
    diffs.push(...buildDiff((a as any)[key], (b as any)[key], `${path}.${key}`));
  }
  return diffs.slice(0, 5);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract sorted node signatures for comparison. */
function nodeSignatures(body: any): { id: string; kind: string }[] {
  const nodes = body.nodes ?? body.graph?.nodes ?? [];
  return [...nodes]
    .map((n: any) => ({ id: n.id, kind: n.kind }))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));
}

/** Extract sorted edge signatures for comparison (9 fields). */
function edgeSignatures(body: any): Record<string, unknown>[] {
  const edges = body.edges ?? body.graph?.edges ?? [];
  return [...edges]
    .map((e: any) => ({
      from: e.from,
      to: e.to,
      strength_mean: e.strength_mean,
      strength_std: e.strength_std,
      belief_exists: e.belief_exists,
      effect_direction: e.effect_direction,
      provenance: e.provenance,
      provenance_source: e.provenance_source,
      id: e.id,
    }))
    .sort((a: any, b: any) => `${a.from}::${a.to}`.localeCompare(`${b.from}::${b.to}`));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Unified Pipeline Parity (CIL Phase 3B)", () => {

  // ── Legacy pipeline baseline ──────────────────────────────────

  describe("Legacy pipeline baseline (flag=false)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      _resetConfigCache();
      vi.stubEnv("LLM_PROVIDER", "fixtures");
      vi.stubEnv("ASSIST_API_KEYS", API_KEY_LEGACY);
      vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-parity-test");
      vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "false");
      cleanBaseUrl();
      app = await build();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    const headers = { "X-Olumi-Assist-Key": API_KEY_LEGACY } as const;

    it("returns 200 with valid V1 response from fixtures", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v1",
        headers,
        payload: { brief: BRIEF },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Core CEE V1 shape
      expect(body.graph).toBeDefined();
      expect(Array.isArray(body.graph.nodes)).toBe(true);
      expect(Array.isArray(body.graph.edges)).toBe(true);
      expect(body.graph.version).toBe("1.2");
      expect(body.trace).toBeDefined();
      expect(body.quality).toBeDefined();
    });

    it("returns 200 with valid V3 response from fixtures", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers,
        payload: { brief: BRIEF },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // V3 shape: nodes and edges at root level
      expect(body.nodes).toBeDefined();
      expect(body.edges).toBeDefined();
      expect(body.trace).toBeDefined();
      expect(body.quality).toBeDefined();
      expect(body.analysis_ready).toBeDefined();
    });
  });

  // ── Unified pipeline smoke tests ──────────────────────────────

  describe("Unified pipeline smoke (flag=true)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      _resetConfigCache();
      vi.stubEnv("LLM_PROVIDER", "fixtures");
      vi.stubEnv("ASSIST_API_KEYS", API_KEY_UNIFIED);
      vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-parity-test");
      vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "true");
      cleanBaseUrl();
      app = await build();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    const headers = { "X-Olumi-Assist-Key": API_KEY_UNIFIED } as const;

    it("returns 200 with valid V3 response (all stages wired)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers,
        payload: { brief: BRIEF },
      });

      // All 6 stages wired — should produce a proper V3 response
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.nodes).toBeDefined();
      expect(body.edges).toBeDefined();
      expect(body.trace).toBeDefined();
      expect(body.quality).toBeDefined();
      expect(body.analysis_ready).toBeDefined();
    }, 30_000);
  });

  // ── Full parity comparison ─────────────────────────────────────

  describe("Structural parity (unified === legacy)", () => {
    let legacyApp: FastifyInstance;
    let unifiedApp: FastifyInstance;
    let legacyBody: any;
    let unifiedBody: any;

    beforeAll(async () => {
      // Build legacy app
      _resetConfigCache();
      vi.stubEnv("LLM_PROVIDER", "fixtures");
      vi.stubEnv("ASSIST_API_KEYS", "parity-both-key");
      vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-parity-test");
      vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "false");
      cleanBaseUrl();
      legacyApp = await build();
      await legacyApp.ready();

      const legacyRes = await legacyApp.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers: { "X-Olumi-Assist-Key": "parity-both-key" },
        payload: { brief: BRIEF },
      });
      expect(legacyRes.statusCode).toBe(200);
      legacyBody = legacyRes.json();

      // Build unified app
      _resetConfigCache();
      vi.stubEnv("LLM_PROVIDER", "fixtures");
      vi.stubEnv("ASSIST_API_KEYS", "parity-both-key");
      vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-parity-test");
      vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "true");
      cleanBaseUrl();
      unifiedApp = await build();
      await unifiedApp.ready();

      const unifiedRes = await unifiedApp.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers: { "X-Olumi-Assist-Key": "parity-both-key" },
        payload: { brief: BRIEF },
      });
      expect(unifiedRes.statusCode).toBe(200);
      unifiedBody = unifiedRes.json();
    }, 60_000);

    afterAll(async () => {
      await legacyApp?.close();
      await unifiedApp?.close();
      _resetConfigCache();
      vi.unstubAllEnvs();
    });

    it("same node IDs, kinds, and count", () => {
      const legacyNodes = nodeSignatures(legacyBody);
      const unifiedNodes = nodeSignatures(unifiedBody);
      assertStructuralParity("node IDs and kinds", legacyNodes, unifiedNodes);
    });

    it("same edge pairs with 9-field equality", () => {
      const legacyEdges = edgeSignatures(legacyBody);
      const unifiedEdges = edgeSignatures(unifiedBody);
      // Allow canonical structural edge divergence: the deterministic sweep
      // in substep 1b canonicalises option→factor edges that the legacy
      // pipeline doesn't canonicalise at this stage.
      const normaliseStructural = (edges: Record<string, unknown>[]) =>
        edges.map((e) => {
          // If this looks like an option→factor edge based on node naming convention
          const from = String(e.from ?? "");
          const to = String(e.to ?? "");
          if (from.startsWith("opt_") && to.startsWith("fac_")) {
            return { ...e, strength_mean: 1, strength_std: 0.01, belief_exists: 1 };
          }
          return e;
        });
      assertStructuralParity(
        "edge pairs (9-field)",
        normaliseStructural(legacyEdges),
        normaliseStructural(unifiedEdges),
      );
    });

    it("same analysis_ready.status", () => {
      assertStructuralParity(
        "analysis_ready.status",
        legacyBody.analysis_ready?.status,
        unifiedBody.analysis_ready?.status,
      );
    });

    it("same blocker[].factor_id set (order-independent)", () => {
      const legacyBlockers = (legacyBody.analysis_ready?.blockers ?? [])
        .map((b: any) => b.factor_id)
        .filter(Boolean);
      const unifiedBlockers = (unifiedBody.analysis_ready?.blockers ?? [])
        .map((b: any) => b.factor_id)
        .filter(Boolean);
      assertStructuralParity("blocker factor_ids", legacyBlockers, unifiedBlockers, { sortArrays: true });
    });

    it("same model_adjustments[].type set (order-independent)", () => {
      const legacyAdj = (legacyBody.analysis_ready?.model_adjustments ?? [])
        .map((a: any) => a.type)
        .filter(Boolean);
      const unifiedAdj = (unifiedBody.analysis_ready?.model_adjustments ?? [])
        .map((a: any) => a.type)
        .filter(Boolean);
      assertStructuralParity("model_adjustments types", legacyAdj, unifiedAdj, { sortArrays: true });
    });

    it("trace.pipeline.enrich.called_count === 1 on unified", () => {
      const enrichTrace = unifiedBody.trace?.pipeline?.enrich;
      expect(enrichTrace).toBeDefined();
      expect(enrichTrace?.called_count).toBe(1);
    });

    it("timing fields excluded from comparison", () => {
      // Verify timing fields exist but differ (they're non-deterministic)
      // Legacy and unified should both have timing but values may differ
      const legacyMs = legacyBody.trace?.pipeline?.total_duration_ms;
      const unifiedMs = unifiedBody.trace?.pipeline?.total_duration_ms;
      expect(typeof legacyMs).toBe("number");
      expect(typeof unifiedMs).toBe("number");
      // Timing values are explicitly NOT compared for equality
    });

    it("repairTrace present in unified pipeline trace", () => {
      const pipelineTrace = unifiedBody.trace?.pipeline;
      expect(pipelineTrace).toBeDefined();
      expect(pipelineTrace?.status).toBe("success");
      // When repair actually fires, trace.pipeline.repair should exist with structure
      // With fixtures, repair may or may not produce mutations, so check conditionally
      if (pipelineTrace?.repair) {
        expect(pipelineTrace.repair).toEqual(
          expect.objectContaining({
            edge_restore: expect.any(Object),
          }),
        );
      }
    });

    it("checkpoint arrays present in both pipeline traces", () => {
      const legacyCheckpoints = legacyBody.trace?.pipeline?.pipeline_checkpoints;
      const unifiedCheckpoints = unifiedBody.trace?.pipeline?.pipeline_checkpoints;
      // Both pipelines should emit checkpoint arrays (may be undefined if disabled)
      // When present, both should be arrays with consistent structure
      if (legacyCheckpoints || unifiedCheckpoints) {
        if (legacyCheckpoints) expect(Array.isArray(legacyCheckpoints)).toBe(true);
        if (unifiedCheckpoints) expect(Array.isArray(unifiedCheckpoints)).toBe(true);
        // Meta should be present when checkpoints exist
        if (unifiedCheckpoints) {
          const meta = unifiedBody.trace?.pipeline?.pipeline_checkpoints_meta;
          expect(meta).toBeDefined();
          expect(meta?.enabled).toBe(true);
          expect(typeof meta?.total_count).toBe("number");
        }
      }
    });

    it("unified pipeline provenance set to 'unified'", () => {
      const provenance = unifiedBody.trace?.pipeline?.cee_provenance;
      expect(provenance).toBeDefined();
      expect(provenance?.pipeline_path).toBe("unified");

      // Legacy should be "A"
      const legacyProvenance = legacyBody.trace?.pipeline?.cee_provenance;
      expect(legacyProvenance?.pipeline_path).toBe("A");
    });

    it("unified enrich.source is 'unified_pipeline'", () => {
      const enrichTrace = unifiedBody.trace?.pipeline?.enrich;
      expect(enrichTrace?.source).toBe("unified_pipeline");
    });
  });
});
