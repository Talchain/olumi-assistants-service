/**
 * CEE Edge Repair Integration Test
 *
 * Verifies that when the LLM generates a graph with outcomes/risks but forgets
 * to connect them to the goal, connectivity is repaired.
 *
 * NOTE: As of the pre-orchestrator simpleRepair change, connectivity repairs may happen
 * in one of two places:
 * 1. simpleRepair (runs unconditionally before CEE pipeline) - wires orphaned outcome/risk to goal
 * 2. CEE edge_repair stage (runs during CEE pipeline) - also wires orphaned nodes to goal
 *
 * If simpleRepair fixes the graph first, CEE's edge_repair stage will have nothing to do.
 * This test accepts either path since both achieve the same outcome: a connected graph.
 *
 * For isolated testing of simpleRepair logic, see: tests/unit/simple-repair-connectivity.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

// Avoid structural warnings interfering with envelope shape
vi.mock("../../src/cee/structure/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cee/structure/index.js")>();
  return {
    ...actual,
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
    detectZeroExternalFactors: () => ({ detected: false, factorCount: 0, externalCount: 0 }),
  };
});

// Mock fixtures adapter to return a graph with goal but no edges to goal
// This simulates the LLM forgetting to connect outcomes/risks to goal
vi.mock("../../src/utils/fixtures.js", () => ({
  fixtureGraph: {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_hiring", kind: "decision", label: "Hiring Decision" },
      { id: "opt_lead", kind: "option", label: "Hire Tech Lead", data: { interventions: { fac_seniority: 1 } } },
      { id: "opt_devs", kind: "option", label: "Hire Two Developers", data: { interventions: { fac_seniority: 0 } } },
      { id: "fac_seniority", kind: "factor", label: "Team Seniority", data: { value: 0.5, extractionType: "inferred" } },
      { id: "out_delivery", kind: "outcome", label: "Software Delivery Speed" },
      { id: "risk_burnout", kind: "risk", label: "Team Burnout Risk" },
      { id: "goal_reliability", kind: "goal", label: "Reliable Software Delivery" },
    ],
    edges: [
      // Decision → Options
      { from: "dec_hiring", to: "opt_lead", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      { from: "dec_hiring", to: "opt_devs", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      // Options → Factor
      { from: "opt_lead", to: "fac_seniority", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      { from: "opt_devs", to: "fac_seniority", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      // Factor → Outcomes/Risks
      { from: "fac_seniority", to: "out_delivery", strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.9 },
      { from: "fac_seniority", to: "risk_burnout", strength: { mean: 0.4, std: 0.2 }, exists_probability: 0.8 },
      // MISSING: outcome/risk → goal edges (LLM forgot to connect them)
    ],
    meta: {
      roots: ["dec_hiring"],
      leaves: ["goal_reliability"],
      suggested_positions: {},
      source: "fixtures",
    },
  },
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/draft-graph (CEE v1) - edge repair", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-key-edge-repair-1,cee-key-edge-repair-2");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "10");
    vi.stubEnv("CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED", "false");
    vi.stubEnv("CEE_REFINEMENT_ENABLED", "false");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headers = {
    "X-Olumi-Assist-Key": "cee-key-edge-repair-1",
  } as const;

  it("repairs disconnected goal by wiring outcomes/risks to goal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers,
      payload: {
        brief: "Should I hire a Tech Lead or two Developers? Goal: reliable software delivery.",
      },
    });

    // Should succeed after repair (either via simpleRepair or CEE edge_repair)
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Verify graph has required nodes (V3: nodes at root level)
    expect(body.nodes.some((n: any) => n.kind === "goal")).toBe(true);
    expect(body.nodes.some((n: any) => n.kind === "outcome")).toBe(true);
    expect(body.nodes.some((n: any) => n.kind === "risk")).toBe(true);

    // Verify edges to goal were added (V3: edges at root level)
    // Repairs now happen in pre-orchestrator simpleRepair stage, so edges are wired
    // before the CEE pipeline's edge_repair stage runs.
    const goalNode = body.nodes.find((n: any) => n.kind === "goal");
    const edgesToGoal = body.edges.filter((e: any) => e.to === goalNode.id);

    // Should have at least 2 edges to goal (outcome + risk)
    expect(edgesToGoal.length).toBeGreaterThanOrEqual(2);

    // Verify pipeline trace exists
    expect(body.trace.pipeline).toBeDefined();
    // Pipeline status is "success" when simpleRepair fixes the graph early,
    // or "success_with_repairs" when CEE's edge_repair fixes it.
    expect(["success", "success_with_repairs"]).toContain(body.trace.pipeline.status);

    // The edge_repair stage should exist but may show no work done
    // (if simpleRepair already fixed the graph)
    const edgeRepairStage = body.trace.pipeline.stages.find(
      (s: any) => s.name === "edge_repair"
    );

    // If edge_repair was called and made repairs, verify the details
    if (edgeRepairStage && edgeRepairStage.details?.called && edgeRepairStage.details?.edges_added > 0) {
      expect(edgeRepairStage.status).toBe("success_with_repairs");
      expect(edgeRepairStage.details.candidates_found).toBeGreaterThanOrEqual(2);
      expect(edgeRepairStage.details.edges_added).toBeGreaterThanOrEqual(2);
      expect(edgeRepairStage.details.repair_reason).toBe("goal_unreachable");
      expect(edgeRepairStage.details.connectivity_restored).toBe(true);
      expect(edgeRepairStage.details.noop_reason).toBeUndefined();
    }
    // Otherwise, simpleRepair fixed the graph first - that's also valid
  });

  it("includes edge repair details in pipeline trace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-key-edge-repair-2" },
      payload: {
        brief: "Should I hire a Tech Lead or two Developers for reliable software delivery?",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Verify pipeline trace shows repair
    expect(body.trace.pipeline).toBeDefined();
    expect(Array.isArray(body.trace.pipeline.stages)).toBe(true);

    // Find edge_repair stage
    const edgeRepairStage = body.trace.pipeline.stages.find(
      (s: any) => s.name === "edge_repair"
    );

    if (edgeRepairStage) {
      // If edge repair ran, verify its details with new semantics
      expect(edgeRepairStage.status).toBe("success_with_repairs");
      expect(typeof edgeRepairStage.duration_ms).toBe("number");
      expect(edgeRepairStage.details).toBeDefined();
      expect(edgeRepairStage.details.called).toBe(true);
      expect(typeof edgeRepairStage.details.candidates_found).toBe("number");
      expect(typeof edgeRepairStage.details.edges_added).toBe("number");
    }

    // Verify connectivity_check stage exists
    const connectivityStage = body.trace.pipeline.stages.find(
      (s: any) => s.name === "connectivity_check"
    );
    expect(connectivityStage).toBeDefined();
  });
});
