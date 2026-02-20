/**
 * CEE Outcome/Risk Validation Integration Test
 *
 * Verifies that graphs without any outcome OR risk nodes fail validation
 * with a clear error message and actionable guidance.
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

// Mock fixtures adapter to return a graph with NO outcomes or risks
// This simulates the LLM generating only factors without outcome/risk bridges
vi.mock("../../src/utils/fixtures.js", () => ({
  fixtureGraph: {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_hiring", kind: "decision", label: "Hiring Decision" },
      { id: "opt_lead", kind: "option", label: "Hire Tech Lead", data: { interventions: { fac_seniority: 1 } } },
      { id: "opt_devs", kind: "option", label: "Hire Two Developers", data: { interventions: { fac_seniority: 0 } } },
      { id: "fac_seniority", kind: "factor", label: "Team Seniority", data: { value: 0.5, extractionType: "inferred" } },
      { id: "fac_cost", kind: "factor", label: "Hiring Cost", data: { value: 100000, extractionType: "inferred" } },
      // NO outcome nodes
      // NO risk nodes
      { id: "goal_reliability", kind: "goal", label: "Reliable Software Delivery" },
    ],
    edges: [
      // Decision → Options
      { from: "dec_hiring", to: "opt_lead", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      { from: "dec_hiring", to: "opt_devs", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      // Options → Factors
      { from: "opt_lead", to: "fac_seniority", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      { from: "opt_devs", to: "fac_seniority", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      { from: "opt_lead", to: "fac_cost", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      { from: "opt_devs", to: "fac_cost", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      // NO edges to goal because there are no outcomes/risks to bridge
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

describe("POST /assist/v1/draft-graph (CEE v1) - outcome/risk validation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-key-outcome-risk-1,cee-key-outcome-risk-2");
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
    "X-Olumi-Assist-Key": "cee-key-outcome-risk-1",
  } as const;

  it("fails with clear error when graph has no outcomes or risks", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers,
      payload: {
        brief: "Should I hire a Tech Lead or two Developers? Goal: reliable software delivery. Budget: £100k. Timeline: 3 months.",
        clarification_rounds_completed: 2,
      },
    });

    // Should fail validation
    expect(res.statusCode).toBe(400);
    const body = res.json();

    // Verify error code and reason
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    expect(body.reason).toBe("missing_outcome_or_risk");

    // Verify user-friendly message
    expect(body.message).toContain("outcome or risk");
    expect(body.message).toContain("factors");
    expect(body.message).toContain("goal");

    // Verify recovery guidance exists
    expect(body.recovery).toBeDefined();
    expect(body.recovery.suggestion).toBeDefined();
    expect(body.recovery.hints).toBeDefined();
    expect(Array.isArray(body.recovery.hints)).toBe(true);
    expect(body.recovery.hints.length).toBeGreaterThan(0);

    // Verify hints are actionable
    const hintsText = body.recovery.hints.join(" ");
    expect(hintsText.toLowerCase()).toMatch(/success|outcome|risk/);
  });

  it("includes edge_repair trace with noop_reason when no candidates", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-key-outcome-risk-2" },
      payload: {
        brief: "Should I hire a Tech Lead or two Developers for my startup? Goal: reliable software delivery. Budget: £100k.",
        clarification_rounds_completed: 2,
      },
    });

    // Should fail validation (no outcomes/risks)
    expect(res.statusCode).toBe(400);
    const body = res.json();

    // Verify pipeline trace includes edge_repair info
    if (body.trace?.pipeline) {
      const edgeRepairStage = body.trace.pipeline.stages?.find(
        (s: any) => s.name === "edge_repair"
      );

      // If edge_repair was called but had no candidates
      if (edgeRepairStage?.details?.called) {
        expect(edgeRepairStage.details.candidates_found).toBe(0);
        expect(edgeRepairStage.details.edges_added).toBe(0);
        expect(edgeRepairStage.details.noop_reason).toBe("no_outcome_or_risk_nodes");
      }
    }

    // Verify error details include goal_wiring diagnostics
    if (body.details?.goal_wiring) {
      expect(body.details.goal_wiring.outcome_nodes_found).toBe(0);
      expect(body.details.goal_wiring.risk_nodes_found).toBe(0);
    }
  });

  it("provides example in recovery guidance", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers,
      payload: {
        brief: "Should I hire a Tech Lead or two Developers? Goal: reliable software delivery. Budget: £100k. Timeline: 3 months.",
        clarification_rounds_completed: 2,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    // Verify recovery includes an example
    expect(body.recovery.example).toBeDefined();
    expect(typeof body.recovery.example).toBe("string");
    expect(body.recovery.example.length).toBeGreaterThan(0);
  });
});
