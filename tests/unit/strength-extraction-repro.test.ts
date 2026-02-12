/**
 * Reproduction test: strength_mean extraction + interventions preservation
 *
 * Feeds a realistic LLM fixture (V4 nested strength format) through each
 * pipeline stage to identify exactly where fields are lost.
 *
 * Bug: BOUNDARY-CEE-OUT shows strength_mean: "MISSING" and interventions: {}
 * despite the LLM outputting correct nested strength and interventions.
 */
import { describe, it, expect } from "vitest";
import { normaliseDraftResponse, ensureControllableFactorBaselines } from "../../src/adapters/llm/normalisation.js";
import { LLMDraftResponse } from "../../src/adapters/llm/shared-schemas.js";
import { Graph } from "../../src/schemas/graph.js";

// =============================================================================
// Test Fixture: Realistic V4 LLM output (nested strength, interventions)
// Based on bundle be0d43f9 structure
// =============================================================================

const LLM_FIXTURE = {
  nodes: [
    { id: "goal_grow", kind: "goal", label: "Grow MRR to £20k" },
    { id: "dec_pricing", kind: "decision", label: "How should we price the product?" },
    { id: "opt_premium", kind: "option", label: "Premium pricing (£49/mo)", data: { interventions: { fac_pro_price: 0.59 } } },
    { id: "opt_freemium", kind: "option", label: "Freemium with upsell", data: { interventions: { fac_pro_price: 0.0 } } },
    { id: "opt_status_quo", kind: "option", label: "Keep current pricing" },
    { id: "fac_pro_price", kind: "factor", label: "Product Price", category: "controllable", data: { value: 29, unit: "£/mo" } },
    { id: "fac_market_size", kind: "factor", label: "Addressable Market", category: "external", data: { value: 5000, unit: "businesses" } },
    { id: "out_revenue", kind: "outcome", label: "Monthly Revenue" },
    { id: "out_churn", kind: "outcome", label: "Customer Churn Rate" },
    { id: "risk_price_sens", kind: "risk", label: "Price sensitivity may reduce adoption" },
  ],
  edges: [
    // Structural edges (decision→option) — no strength
    { from: "dec_pricing", to: "opt_premium", exists_probability: 1.0 },
    { from: "dec_pricing", to: "opt_freemium", exists_probability: 1.0 },
    { from: "dec_pricing", to: "opt_status_quo", exists_probability: 1.0 },
    // Option→factor edges (interventions)
    { from: "opt_premium", to: "fac_pro_price", strength: { mean: 0.59, std: 0.1 }, exists_probability: 0.95 },
    { from: "opt_freemium", to: "fac_pro_price", strength: { mean: -1.0, std: 0.05 }, exists_probability: 0.95 },
    // Causal edges (factor→outcome) — these are the key ones with varied strength
    { from: "fac_pro_price", to: "out_revenue", strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.9 },
    { from: "fac_pro_price", to: "out_churn", strength: { mean: -0.4, std: 0.2 }, exists_probability: 0.85 },
    { from: "fac_market_size", to: "out_revenue", strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.92 },
    // Outcome→goal
    { from: "out_revenue", to: "goal_grow", strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.95 },
    { from: "out_churn", to: "goal_grow", strength: { mean: -0.3, std: 0.15 }, exists_probability: 0.88 },
    // Risk edge
    { from: "risk_price_sens", to: "out_churn", strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.7 },
  ],
  rationales: [
    { target: "fac_pro_price", why: "Price directly determines revenue potential" },
  ],
};

// Deep clone to avoid mutation between tests
function cloneFixture() {
  return JSON.parse(JSON.stringify(LLM_FIXTURE));
}

describe("Strength extraction reproduction", () => {

  // =========================================================================
  // Stage 1: normaliseDraftResponse
  // =========================================================================
  describe("Stage 1: normaliseDraftResponse", () => {
    it("extracts strength_mean from nested strength.mean", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      // Causal edges should have strength_mean extracted
      const priceToRevenue = result.edges.find(
        (e: any) => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect(priceToRevenue).toBeDefined();
      expect(priceToRevenue.strength_mean).toBe(0.6);
      expect(priceToRevenue.strength_std).toBe(0.15);
    });

    it("extracts belief_exists from exists_probability", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      const priceToRevenue = result.edges.find(
        (e: any) => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect(priceToRevenue.belief_exists).toBe(0.9);
    });

    it("extracts varied strength_mean values across all causal edges", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      const causalEdges = result.edges.filter(
        (e: any) => e.from.startsWith("fac_")
      );

      // All causal edges should have strength_mean extracted
      for (const edge of causalEdges) {
        expect(edge.strength_mean).toBeDefined();
        expect(typeof edge.strength_mean).toBe("number");
      }

      // Check they are varied (not all 0.5)
      const means = causalEdges.map((e: any) => e.strength_mean);
      const uniqueMeans = new Set(means);
      expect(uniqueMeans.size).toBeGreaterThan(1);

      // Check specific values
      expect(means).toContain(0.6);   // fac_pro_price → out_revenue
      expect(means).toContain(-0.4);  // fac_pro_price → out_churn
      expect(means).toContain(0.7);   // fac_market_size → out_revenue
    });

    it("extracts strength_mean for ALL edges with nested strength", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      const edgesWithNestedStrength = LLM_FIXTURE.edges.filter(e => e.strength);
      for (const originalEdge of edgesWithNestedStrength) {
        const resultEdge = result.edges.find(
          (e: any) => e.from === originalEdge.from && e.to === originalEdge.to
        );
        expect(resultEdge).toBeDefined();
        expect(resultEdge.strength_mean).toBe(originalEdge.strength!.mean);
        expect(resultEdge.strength_std).toBe(originalEdge.strength!.std);
      }
    });

    it("does not set weight from V4 fields (no cross-mapping)", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      // Edges have no legacy weight — should remain undefined
      const priceToRevenue = result.edges.find(
        (e: any) => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect(priceToRevenue.weight).toBeUndefined();
    });

    it("preserves node data (interventions) on option nodes", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      const optPremium = result.nodes.find((n: any) => n.id === "opt_premium");
      expect(optPremium.data).toBeDefined();
      expect(optPremium.data.interventions).toBeDefined();
      expect(optPremium.data.interventions.fac_pro_price).toBe(0.59);
    });

    it("preserves factor data (value, unit) on factor nodes", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      const facPrice = result.nodes.find((n: any) => n.id === "fac_pro_price");
      expect(facPrice.data).toBeDefined();
      expect(facPrice.data.value).toBe(29);
      expect(facPrice.data.unit).toBe("£/mo");
    });
  });

  // =========================================================================
  // Stage 1b: ensureControllableFactorBaselines
  // =========================================================================
  describe("Stage 1b: ensureControllableFactorBaselines", () => {
    it("does not overwrite existing factor data.value", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response } = ensureControllableFactorBaselines(normalised);
      const result = response as any;

      const facPrice = result.nodes.find((n: any) => n.id === "fac_pro_price");
      expect(facPrice.data.value).toBe(29); // Original value, not 1.0
    });
  });

  // =========================================================================
  // Stage 2: LLMDraftResponse.safeParse (Zod validation in adapter)
  // =========================================================================
  describe("Stage 2: LLMDraftResponse.safeParse", () => {
    it("passes validation with nested strength format", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
      const parseResult = LLMDraftResponse.safeParse(withBaselines);

      expect(parseResult.success).toBe(true);
    });

    it("preserves strength_mean through Zod parse", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
      const parseResult = LLMDraftResponse.safeParse(withBaselines);

      expect(parseResult.success).toBe(true);
      if (!parseResult.success) return;

      const priceToRevenue = parseResult.data.edges.find(
        e => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect(priceToRevenue).toBeDefined();
      expect(priceToRevenue!.strength_mean).toBe(0.6);
      expect(priceToRevenue!.strength_std).toBe(0.15);
      expect(priceToRevenue!.belief_exists).toBe(0.9);
    });

    it("preserves nested strength object through Zod parse", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
      const parseResult = LLMDraftResponse.safeParse(withBaselines);

      expect(parseResult.success).toBe(true);
      if (!parseResult.success) return;

      const priceToRevenue = parseResult.data.edges.find(
        e => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      // LLMEdge schema includes strength: EdgeStrength
      expect(priceToRevenue!.strength).toBeDefined();
      expect(priceToRevenue!.strength?.mean).toBe(0.6);
      expect(priceToRevenue!.strength?.std).toBe(0.15);
    });

    it("preserves ALL varied strength_mean values through Zod parse", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
      const parseResult = LLMDraftResponse.safeParse(withBaselines);

      expect(parseResult.success).toBe(true);
      if (!parseResult.success) return;

      const causalEdges = parseResult.data.edges.filter(e => e.from.startsWith("fac_"));
      for (const edge of causalEdges) {
        expect(edge.strength_mean).toBeDefined();
        expect(typeof edge.strength_mean).toBe("number");
      }

      const means = causalEdges.map(e => e.strength_mean);
      expect(new Set(means).size).toBeGreaterThan(1);
    });

    it("preserves interventions on option nodes through Zod parse", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
      const parseResult = LLMDraftResponse.safeParse(withBaselines);

      expect(parseResult.success).toBe(true);
      if (!parseResult.success) return;

      const optPremium = parseResult.data.nodes.find(n => n.id === "opt_premium");
      expect(optPremium).toBeDefined();
      expect(optPremium!.data).toBeDefined();

      // NodeData is z.union([OptionData, ConstraintNodeData, FactorData])
      // OptionData matches when interventions is present
      const data = optPremium!.data as any;
      expect(data.interventions).toBeDefined();
      expect(data.interventions.fac_pro_price).toBe(0.59);
    });
  });

  // =========================================================================
  // Stage 6: Graph.safeParse (orchestrator-level Zod)
  // This strips the nested strength object but should preserve flat fields
  // =========================================================================
  describe("Stage 6: Graph.safeParse", () => {
    it("preserves strength_mean through Graph.safeParse", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
      const llmParse = LLMDraftResponse.safeParse(withBaselines);
      expect(llmParse.success).toBe(true);
      if (!llmParse.success) return;

      // Simulate the adapter constructing a Graph-compatible object
      const graphInput = {
        version: "1",
        default_seed: 17,
        nodes: llmParse.data.nodes.map(n => ({
          id: n.id,
          kind: n.kind,
          label: n.label,
          body: n.body,
          category: n.category,
          data: n.data,
        })),
        edges: llmParse.data.edges.map(e => ({
          from: e.from,
          to: e.to,
          strength: e.strength,
          exists_probability: e.exists_probability,
          strength_mean: e.strength_mean,
          strength_std: e.strength_std,
          belief_exists: e.belief_exists,
          effect_direction: e.effect_direction,
          weight: e.weight ?? e.strength_mean,
          belief: e.belief ?? e.belief_exists,
          provenance: e.provenance,
          provenance_source: e.provenance_source,
        })),
        meta: {
          roots: ["goal_grow"],
          leaves: ["risk_price_sens"],
          suggested_positions: {},
          source: "assistant" as const,
        },
      };

      const graphResult = Graph.safeParse(graphInput);
      expect(graphResult.success).toBe(true);
      if (!graphResult.success) {
        console.error("Graph.safeParse errors:", JSON.stringify(graphResult.error.flatten(), null, 2));
        return;
      }

      const priceToRevenue = graphResult.data.edges.find(
        e => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect(priceToRevenue).toBeDefined();
      expect(priceToRevenue!.strength_mean).toBe(0.6);
      expect(priceToRevenue!.strength_std).toBe(0.15);
      expect(priceToRevenue!.belief_exists).toBe(0.9);
    });

    it("preserves nested strength object via .passthrough() (CIL Phase 2)", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
      const llmParse = LLMDraftResponse.safeParse(withBaselines);
      expect(llmParse.success).toBe(true);
      if (!llmParse.success) return;

      const graphInput = {
        version: "1",
        default_seed: 17,
        nodes: llmParse.data.nodes.map(n => ({
          id: n.id, kind: n.kind, label: n.label, body: n.body, category: n.category, data: n.data,
        })),
        edges: llmParse.data.edges.map(e => ({
          from: e.from, to: e.to,
          strength: e.strength,
          strength_mean: e.strength_mean,
          strength_std: e.strength_std,
          belief_exists: e.belief_exists,
          weight: e.weight ?? e.strength_mean,
          belief: e.belief ?? e.belief_exists,
        })),
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      };

      const graphResult = Graph.safeParse(graphInput);
      expect(graphResult.success).toBe(true);
      if (!graphResult.success) return;

      // After Graph.safeParse, nested strength object is preserved via .passthrough()
      // (CIL Phase 2: internal schemas use .passthrough() to prevent silent field loss)
      const priceToRevenue = graphResult.data.edges.find(
        e => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect((priceToRevenue as any).strength).toBeDefined();

      // But flat strength_mean should survive
      expect(priceToRevenue!.strength_mean).toBe(0.6);
    });

    it("preserves interventions on option nodes through Graph.safeParse", () => {
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw);
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);
      const llmParse = LLMDraftResponse.safeParse(withBaselines);
      expect(llmParse.success).toBe(true);
      if (!llmParse.success) return;

      const graphInput = {
        version: "1",
        default_seed: 17,
        nodes: llmParse.data.nodes.map(n => ({
          id: n.id, kind: n.kind, label: n.label, body: n.body, category: n.category, data: n.data,
        })),
        edges: llmParse.data.edges.map(e => ({
          from: e.from, to: e.to,
          strength_mean: e.strength_mean,
          strength_std: e.strength_std,
          belief_exists: e.belief_exists,
          weight: e.weight ?? e.strength_mean,
          belief: e.belief ?? e.belief_exists,
        })),
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      };

      const graphResult = Graph.safeParse(graphInput);
      expect(graphResult.success).toBe(true);
      if (!graphResult.success) return;

      const optPremium = graphResult.data.nodes.find(n => n.id === "opt_premium");
      expect(optPremium).toBeDefined();
      const data = optPremium!.data as any;
      expect(data).toBeDefined();
      expect(data.interventions).toBeDefined();
      expect(data.interventions.fac_pro_price).toBe(0.59);
    });
  });

  // =========================================================================
  // ROOT CAUSE: Sampling bias in diagnostic logs
  // Both normalisation diagnostic AND BOUNDARY-CEE-OUT use .slice(0, 3)
  // which always picks structural dec→opt edges that NEVER have strength
  // =========================================================================
  describe("Diagnostic sampling bias", () => {
    it("first 3 edges are structural (no strength) — this is the BOUNDARY-CEE-OUT sample", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      // The first 3 edges in fixture are dec→opt (structural)
      const first3 = result.edges.slice(0, 3);
      for (const edge of first3) {
        expect(edge.from).toMatch(/^dec_/);
        expect(edge.strength_mean).toBeUndefined(); // No nested strength on structural edges
      }
    });

    it("causal edges (index 3+) DO have strength_mean — sampling misses them", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      // Edges from index 3 onward are causal — these have nested strength
      const causalEdges = result.edges.filter((e: any) => e.from.startsWith("fac_"));
      expect(causalEdges.length).toBeGreaterThan(0);

      for (const edge of causalEdges) {
        expect(edge.strength_mean).toBeDefined();
        expect(typeof edge.strength_mean).toBe("number");
        expect(edge.strength_mean).not.toBe(0.5); // Varied, not default
      }
    });

    it("ALL edges with nested strength have strength_mean correctly extracted", () => {
      const raw = cloneFixture();
      const result = normaliseDraftResponse(raw) as any;

      // Count how many input edges have nested strength
      const inputEdgesWithStrength = LLM_FIXTURE.edges.filter(e => e.strength);
      expect(inputEdgesWithStrength.length).toBe(8); // 8 of 11 edges have nested strength

      // Count how many output edges have strength_mean set
      const outputEdgesWithStrengthMean = result.edges.filter(
        (e: any) => e.strength_mean !== undefined
      );
      expect(outputEdgesWithStrengthMean.length).toBe(8); // All 8 should be extracted
    });
  });

  // =========================================================================
  // End-to-end: Full pipeline simulation
  // =========================================================================
  describe("End-to-end: normaliseDraftResponse → Zod → Graph.safeParse", () => {
    it("strength_mean survives the full pipeline from nested LLM output", () => {
      // Stage 1: normalisation
      const raw = cloneFixture();
      const normalised = normaliseDraftResponse(raw) as any;

      // Stage 1 check
      const stage1Edge = normalised.edges.find(
        (e: any) => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect(stage1Edge.strength_mean).toBe(0.6);

      // Stage 1b: baselines
      const { response: withBaselines } = ensureControllableFactorBaselines(normalised);

      // Stage 2: LLM Zod parse
      const llmParse = LLMDraftResponse.safeParse(withBaselines);
      expect(llmParse.success).toBe(true);
      if (!llmParse.success) return;

      // Stage 2 check
      const stage2Edge = llmParse.data.edges.find(
        e => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect(stage2Edge!.strength_mean).toBe(0.6);

      // Stage 6: Graph Zod parse (simulating orchestrator)
      const graphInput = {
        version: "1",
        default_seed: 17,
        nodes: llmParse.data.nodes.map(n => ({
          id: n.id, kind: n.kind, label: n.label, body: n.body,
          category: n.category, data: n.data,
        })),
        edges: llmParse.data.edges.map(e => ({
          from: e.from, to: e.to,
          strength: e.strength,
          exists_probability: e.exists_probability,
          strength_mean: e.strength_mean,
          strength_std: e.strength_std,
          belief_exists: e.belief_exists,
          effect_direction: e.effect_direction,
          weight: e.weight ?? e.strength_mean,
          belief: e.belief ?? e.belief_exists,
          provenance: e.provenance,
          provenance_source: e.provenance_source,
        })),
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      };

      const graphResult = Graph.safeParse(graphInput);
      expect(graphResult.success).toBe(true);
      if (!graphResult.success) {
        console.error("STAGE 6 FAILED:", JSON.stringify(graphResult.error.flatten(), null, 2));
        return;
      }

      // Stage 6 check — this is where the 13-stage trace says nested strength is lost
      const stage6Edge = graphResult.data.edges.find(
        e => e.from === "fac_pro_price" && e.to === "out_revenue"
      );
      expect(stage6Edge!.strength_mean).toBe(0.6);
      expect(stage6Edge!.strength_std).toBe(0.15);
      expect(stage6Edge!.belief_exists).toBe(0.9);

      // Verify ALL causal edges retained varied strength_mean
      const allCausal = graphResult.data.edges.filter(e => e.from.startsWith("fac_"));
      const allMeans = allCausal.map(e => e.strength_mean);
      expect(allMeans.every(m => m !== undefined)).toBe(true);
      expect(new Set(allMeans).size).toBeGreaterThan(1);

      // Verify interventions survived
      const optPremium = graphResult.data.nodes.find(n => n.id === "opt_premium");
      expect((optPremium!.data as any).interventions.fac_pro_price).toBe(0.59);
    });
  });
});
