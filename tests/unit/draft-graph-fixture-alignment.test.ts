/**
 * Zod-to-Anthropic alignment test with comprehensive fixture.
 *
 * Validates that a realistic Sonnet 4.6 draft graph output covering ALL
 * node kinds, edge types, provenance values, and optional fields passes
 * through the normalisation layer and Zod validation without error.
 *
 * This is the single most important regression test for the draft_graph
 * structured outputs pipeline.
 */

import { describe, it, expect } from "vitest";
import { LLMDraftResponse } from "../../src/adapters/llm/shared-schemas.js";
import { normaliseDraftResponse } from "../../src/adapters/llm/normalisation.js";

// ============================================================================
// Comprehensive fixture: covers all node kinds, edge types, provenance values
// ============================================================================

const COMPREHENSIVE_DRAFT_GRAPH_FIXTURE = {
  topology_plan: [
    "goal_mrr → decision_pricing → opt_keep, opt_raise, opt_tier",
    "fac_price_level → out_arpu → goal_mrr",
    "fac_churn_rate → goal_mrr",
    "fac_marketing_spend → out_new_accounts → goal_mrr",
    "fac_competitor_pricing → fac_churn_rate",
    "risk_churn_uplift → goal_mrr",
    "fac_trial_conversion → out_new_accounts",
    "act_launch_campaign → fac_marketing_spend",
  ],
  nodes: [
    // goal node — with threshold fields
    {
      id: "goal_mrr",
      kind: "goal",
      label: "Monthly Recurring Revenue",
      goal_threshold: 0.75,
      goal_threshold_raw: 150000,
      goal_threshold_unit: "£",
      goal_threshold_cap: 200000,
    },
    // decision node
    {
      id: "dec_pricing",
      kind: "decision",
      label: "Pricing strategy decision",
    },
    // option node — with interventions data
    {
      id: "opt_keep",
      kind: "option",
      label: "Keep Standard Plan at £49/month",
      data: {
        interventions: {
          fac_price_level: 0.69,
          fac_marketing_spend: 0.1,
          fac_tier_structure: 0,
        },
      },
    },
    // option node — different interventions
    {
      id: "opt_raise",
      kind: "option",
      label: "Raise Standard Plan to £59/month",
      data: {
        interventions: {
          fac_price_level: 0.83,
          fac_marketing_spend: 0.4,
          fac_tier_structure: 0,
        },
      },
    },
    // option node — tiered
    {
      id: "opt_tier",
      kind: "option",
      label: "Introduce Tiered Pricing",
      data: {
        interventions: {
          fac_price_level: 0.69,
          fac_marketing_spend: 0.7,
          fac_tier_structure: 1,
        },
      },
    },
    // factor node — controllable with full data
    {
      id: "fac_price_level",
      kind: "factor",
      label: "Price Level",
      category: "controllable",
      data: {
        value: 0.69,
        raw_value: 49,
        unit: "£",
        cap: 100,
        extractionType: "explicit",
        factor_type: "price",
        confidence: 0.9,
        range: { min: 0.3, max: 1.0 },
      },
    },
    // factor node — observable
    {
      id: "fac_marketing_spend",
      kind: "factor",
      label: "Marketing Spend",
      category: "observable",
      data: {
        value: 0.1,
        raw_value: 5000,
        unit: "£",
        extractionType: "inferred",
        factor_type: "cost",
        uncertainty_drivers: ["historical variance", "seasonal patterns"],
      },
    },
    // factor node — external (no data)
    {
      id: "fac_competitor_pricing",
      kind: "factor",
      label: "Competitor Pricing Pressure",
      category: "external",
    },
    // factor node — external (no data, no category — backward compat)
    {
      id: "fac_churn_rate",
      kind: "factor",
      label: "Churn Rate",
      category: "external",
    },
    // factor node — controllable
    {
      id: "fac_tier_structure",
      kind: "factor",
      label: "Tier Structure",
      category: "controllable",
      data: {
        value: 0,
        extractionType: "explicit",
        factor_type: "other",
      },
    },
    // factor node — observable
    {
      id: "fac_trial_conversion",
      kind: "factor",
      label: "Trial Conversion Rate",
      category: "observable",
      data: {
        value: 0.12,
        raw_value: 12,
        unit: "%",
        extractionType: "range",
        rangeMin: 0.08,
        rangeMax: 0.18,
      },
    },
    // outcome nodes
    {
      id: "out_arpu",
      kind: "outcome",
      label: "Average Revenue Per User",
    },
    {
      id: "out_new_accounts",
      kind: "outcome",
      label: "New Account Volume",
    },
    // risk node
    {
      id: "risk_churn_uplift",
      kind: "risk",
      label: "Churn Uplift Risk",
    },
    // action node
    {
      id: "act_launch_campaign",
      kind: "action",
      label: "Launch Marketing Campaign",
    },
    // constraint node (normalised to "risk" by normaliseDraftResponse)
    {
      id: "con_budget_limit",
      kind: "constraint",
      label: "Budget Limit",
      data: {
        operator: "<=",
      },
    },
  ],
  edges: [
    // structural edges — decision→option
    { from: "dec_pricing", to: "opt_keep", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive", edge_type: "directed", provenance_source: "structural" },
    { from: "dec_pricing", to: "opt_raise", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive", edge_type: "directed", provenance_source: "structural" },
    { from: "dec_pricing", to: "opt_tier", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive", edge_type: "directed", provenance_source: "structural" },
    // option→factor (structural)
    { from: "opt_keep", to: "fac_price_level", strength: { mean: 0.69, std: 0.05 }, exists_probability: 1.0, effect_direction: "positive", edge_type: "directed", provenance_source: "structural" },
    // domain_knowledge provenance
    { from: "fac_price_level", to: "out_arpu", strength: { mean: 0.8, std: 0.12 }, exists_probability: 0.95, effect_direction: "positive", edge_type: "directed", provenance_source: "domain_knowledge" },
    // inferred provenance
    { from: "out_arpu", to: "goal_mrr", strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.9, effect_direction: "positive", edge_type: "directed", provenance_source: "inferred" },
    // document provenance
    { from: "fac_churn_rate", to: "goal_mrr", strength: { mean: -0.5, std: 0.2 }, exists_probability: 0.85, effect_direction: "negative", edge_type: "directed", provenance_source: "document" },
    // metric provenance
    { from: "fac_marketing_spend", to: "out_new_accounts", strength: { mean: 0.4, std: 0.18 }, exists_probability: 0.8, effect_direction: "positive", edge_type: "directed", provenance_source: "metric" },
    // hypothesis provenance
    { from: "out_new_accounts", to: "goal_mrr", strength: { mean: 0.35, std: 0.2 }, exists_probability: 0.75, effect_direction: "positive", edge_type: "directed", provenance_source: "hypothesis" },
    // engine provenance
    { from: "risk_churn_uplift", to: "goal_mrr", strength: { mean: -0.3, std: 0.25 }, exists_probability: 0.7, effect_direction: "negative", edge_type: "directed", provenance_source: "engine" },
    // synthetic provenance
    { from: "fac_trial_conversion", to: "out_new_accounts", strength: { mean: 0.25, std: 0.15 }, exists_probability: 0.6, effect_direction: "positive", edge_type: "directed", provenance_source: "synthetic" },
    // explicit provenance (new)
    { from: "act_launch_campaign", to: "fac_marketing_spend", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive", edge_type: "directed", provenance_source: "explicit" },
    // bidirected edge (confounder)
    { from: "fac_competitor_pricing", to: "fac_churn_rate", strength: { mean: 0.45, std: 0.2 }, exists_probability: 0.65, effect_direction: "positive", edge_type: "bidirected", provenance_source: "domain_knowledge" },
  ],
  causal_claims: [
    {
      type: "direct_cause",
      from: "fac_price_level",
      to: "out_arpu",
      stated_strength: "strong positive",
    },
    {
      type: "mediated",
      from: "fac_competitor_pricing",
      to: "goal_mrr",
      via: "fac_churn_rate",
      stated_strength: "moderate negative",
    },
    {
      type: "confound",
      between: ["fac_competitor_pricing", "fac_churn_rate"],
      stated_strength: "moderate",
    },
  ],
  goal_constraints: [
    {
      constraint_id: "auto_goal_threshold",
      node_id: "goal_mrr",
      operator: ">=",
      value: 0.75,
      label: "MRR target",
      unit: "£",
      source_quote: "We need MRR above £150k",
      confidence: 0.9,
      provenance: "explicit",
    },
  ],
  coaching: {
    summary: "The graph captures the core pricing decision with three well-differentiated options. Consider adding competitor response timing as an external factor.",
    strengthen_items: [
      {
        id: "strengthen_1",
        label: "Add competitor response timing",
        detail: "Competitor pricing pressure is modelled as static. Consider adding a temporal factor for response lag.",
        action_type: "add_factor",
        bias_category: "anchoring",
      },
      {
        id: "strengthen_2",
        label: "Quantify trial conversion range",
        detail: "Trial conversion rate uncertainty_drivers suggest the range is wider than modelled.",
        action_type: "refine_range",
      },
    ],
  },
  rationales: [
    { target: "fac_price_level", why: "Direct lever in pricing decision — controllable by each option." },
    { target: "fac_competitor_pricing", why: "External market force affecting churn independently of pricing.", provenance_source: "document" },
  ],
};

// ============================================================================
// Tests
// ============================================================================

describe("Comprehensive draft graph fixture — Zod alignment", () => {
  /** Fresh clone to avoid mutation by normaliseDraftResponse */
  function freshFixture() {
    return JSON.parse(JSON.stringify(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE));
  }

  it("fixture passes normaliseDraftResponse without error", () => {
    const normalised = normaliseDraftResponse(freshFixture());
    expect(normalised).toBeDefined();
    expect(typeof normalised).toBe("object");
  });

  it("normalised fixture passes LLMDraftResponse Zod validation", () => {
    const normalised = normaliseDraftResponse(freshFixture());
    const result = LLMDraftResponse.safeParse(normalised);

    if (!result.success) {
      console.error("Zod validation errors:", JSON.stringify(result.error.flatten(), null, 2));
    }

    expect(result.success).toBe(true);
  });

  it("all 6+ node kinds present in raw fixture (before normalisation)", () => {
    // Use fresh clone — normaliseDraftResponse mutates the input
    const fresh = JSON.parse(JSON.stringify(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE));
    const kinds = new Set(fresh.nodes.map((n: { kind: string }) => n.kind));
    expect(kinds).toContain("goal");
    expect(kinds).toContain("decision");
    expect(kinds).toContain("option");
    expect(kinds).toContain("outcome");
    expect(kinds).toContain("risk");
    expect(kinds).toContain("factor");
    expect(kinds).toContain("action");
    // "constraint" is present in raw fixture, normalised to "risk" by normaliseDraftResponse
    expect(kinds).toContain("constraint");
  });

  it("all 3 factor categories present", () => {
    const categories = new Set(
      COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.nodes
        .filter(n => n.kind === "factor" && "category" in n)
        .map(n => (n as { category: string }).category),
    );
    expect(categories).toContain("controllable");
    expect(categories).toContain("observable");
    expect(categories).toContain("external");
  });

  it("both edge types present (directed, bidirected)", () => {
    const types = new Set(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.edges.map(e => e.edge_type));
    expect(types).toContain("directed");
    expect(types).toContain("bidirected");
  });

  it("both effect directions present (positive, negative)", () => {
    const dirs = new Set(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.edges.map(e => e.effect_direction));
    expect(dirs).toContain("positive");
    expect(dirs).toContain("negative");
  });

  it("all accepted provenance values present", () => {
    const sources = new Set(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.edges.map(e => e.provenance_source));
    for (const expected of [
      "structural", "domain_knowledge", "inferred", "document",
      "metric", "hypothesis", "engine", "synthetic", "explicit",
    ]) {
      expect(sources, `Missing provenance_source: ${expected}`).toContain(expected);
    }
  });

  it("goal_constraints with provenance:'explicit' present and valid", () => {
    expect(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.goal_constraints.length).toBeGreaterThan(0);
    expect(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.goal_constraints[0].provenance).toBe("explicit");
  });

  it("causal_claims present and non-empty", () => {
    expect(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.causal_claims.length).toBeGreaterThan(0);
  });

  it("coaching with summary and strengthen_items present", () => {
    expect(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.coaching.summary).toBeTruthy();
    expect(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.coaching.strengthen_items.length).toBeGreaterThan(0);
  });

  it("topology_plan present as string array", () => {
    expect(Array.isArray(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.topology_plan)).toBe(true);
    expect(COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.topology_plan.length).toBeGreaterThan(0);
    expect(typeof COMPREHENSIVE_DRAFT_GRAPH_FIXTURE.topology_plan[0]).toBe("string");
  });

  it("nested strength { mean, std } accepted by Zod", () => {
    const normalised = normaliseDraftResponse(freshFixture());
    const result = LLMDraftResponse.safeParse(normalised);
    expect(result.success).toBe(true);
    if (result.success) {
      // Check a specific edge has nested strength parsed correctly
      const edge = result.data.edges.find(e => e.from === "fac_price_level" && e.to === "out_arpu");
      expect(edge).toBeDefined();
      expect(edge!.strength).toBeDefined();
      expect(edge!.strength!.mean).toBeCloseTo(0.8);
      expect(edge!.strength!.std).toBeCloseTo(0.12);
    }
  });

  it("constraint node kind is accepted (normalised to risk downstream)", () => {
    const normalised = normaliseDraftResponse(freshFixture()) as Record<string, unknown>;
    const nodes = (normalised as { nodes: Array<{ id: string; kind: string }> }).nodes;
    const constraintNode = nodes.find(n => n.id === "con_budget_limit");
    // normaliseDraftResponse maps "constraint" → "risk"
    expect(constraintNode).toBeDefined();
    expect(constraintNode!.kind).toBe("risk");
  });
});
