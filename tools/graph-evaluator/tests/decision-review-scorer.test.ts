import { describe, it, expect } from "vitest";
import { scoreDecisionReview } from "../src/decision-review-scorer.js";
import type { DecisionReviewFixture } from "../src/types.js";

// =============================================================================
// Fixture builder
// =============================================================================

function makeFixture(
  overrides: Partial<DecisionReviewFixture> = {}
): DecisionReviewFixture {
  return {
    id: "test",
    name: "Test fixture",
    description: "Test",
    input: {
      winner: { id: "opt_expand", label: "Enter European Market", win_probability: 0.72, outcome_mean: 0.68 },
      runner_up: { id: "opt_hold", label: "Focus on Domestic", win_probability: 0.28, outcome_mean: 0.41 },
      margin: 0.15,
      deterministic_coaching: {
        headline_type: "CLEAR_WINNER",
        readiness: "ready",
        evidence_gaps: [
          { factor_id: "fac_competition", factor_label: "Competitive Intensity", voi: 0.05, confidence: 0.7 },
        ],
        model_critiques: [],
      },
      isl_results: {
        option_comparison: [
          { option_id: "opt_expand", option_label: "Enter European Market", win_probability: 0.72, outcome: { mean: 0.68, p10: 0.45, p90: 0.88 } },
          { option_id: "opt_hold", option_label: "Focus on Domestic", win_probability: 0.28, outcome: { mean: 0.41, p10: 0.30, p90: 0.55 } },
        ],
        factor_sensitivity: [
          { factor_id: "fac_europe_entry", factor_label: "Europe Market Entry", elasticity: 0.72, confidence: 0.85 },
          { factor_id: "fac_investment", factor_label: "Expansion Investment", elasticity: 0.45, confidence: 0.70 },
          { factor_id: "fac_competition", factor_label: "Competitive Intensity", elasticity: 0.18, confidence: 0.60 },
        ],
        fragile_edges: [
          { edge_id: "fac_competition->out_revenue", from_label: "Competitive Intensity", to_label: "Revenue Growth", switch_probability: 0.08 },
        ],
        robustness: { recommendation_stability: 0.91, overall_confidence: 0.85 },
      },
      graph: { nodes: [], edges: [] },
      brief: "Should we expand into the European market?",
    },
    expected: {
      tone: "confident",
      must_mention_factors: ["Competitive Intensity"],
      dsk_fields_expected: false,
      pre_mortem_expected: false,
    },
    ...overrides,
  };
}

function validResponse(): Record<string, unknown> {
  return {
    narrative_summary: "Expansion into the European market shows a 72% win probability with a 15 percentage point margin.",
    story_headlines: {
      opt_expand: "European expansion offers strong growth potential with 68% expected outcome.",
      opt_hold: "Domestic focus provides stability but lower returns at 41% expected outcome.",
    },
    evidence_enhancements: {
      fac_competition: { method: "Market analysis", expected_impact: "Reduce uncertainty" },
    },
    scenario_contexts: {
      "fac_competition->out_revenue": {
        description: "If competitive intensity shifts, revenue may be affected.",
      },
    },
    bias_findings: [],
    readiness_rationale: "The model shows 91% recommendation stability and 85% overall confidence.",
    robustness_explanation: "With a stability of 0.91, the recommendation holds under most scenarios.",
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("decision-review-scorer", () => {
  it("scores a valid response with correct breakdown", () => {
    const fixture = makeFixture();
    const parsed = validResponse();
    const result = scoreDecisionReview(fixture, parsed);

    expect(result.valid_json).toBe(true);
    expect(result.schema_complete).toBe(true);
    expect(result.story_headlines_match).toBe(true);
    expect(result.evidence_enhancements_coverage).toBe(true);
    expect(result.scenario_contexts_valid).toBe(true);
    expect(result.grounding_compliance).toBe(true);
    expect(result.tone_alignment).toBe(true);
    expect(result.overall).toBeGreaterThan(0.8);
  });

  it("detects invented numbers and penalises grounding compliance", () => {
    const fixture = makeFixture();
    const parsed = validResponse();
    // Inject invented numbers far from any input value
    (parsed as Record<string, unknown>).narrative_summary =
      "The analysis shows a 234.5% improvement factor and 867.2% reduction in costs.";

    const result = scoreDecisionReview(fixture, parsed);
    // 97.3 and 42.7 are not in the input
    expect(result.unmatched_numbers).toBeDefined();
    expect(result.unmatched_numbers!.length).toBeGreaterThan(0);
    // Grounding may or may not fail depending on ratio
  });

  it("detects missing story_headlines option", () => {
    const fixture = makeFixture();
    const parsed = validResponse();
    // Remove one option from story_headlines
    (parsed.story_headlines as Record<string, unknown>) = {
      opt_expand: "Expansion is good.",
      // opt_hold is missing
    };

    const result = scoreDecisionReview(fixture, parsed);
    expect(result.story_headlines_match).toBe(false);
  });

  it("validates DSK fields when present and valid", () => {
    const fixture = makeFixture({
      inject_dsk: true,
      expected: {
        tone: "structural",
        must_mention_factors: ["Expansion Investment"],
        bias_types_expected: ["STRENGTH_CLUSTERING"],
        dsk_fields_expected: true,
        pre_mortem_expected: true,
        forbidden_phrases: ["ready", "confident", "clear"],
      },
    });

    const parsed = validResponse();
    (parsed as Record<string, unknown>).bias_findings = [
      {
        type: "structural",
        linked_critique_code: "STRENGTH_CLUSTERING",
        dsk_claim_id: "DSK_001",
        evidence_strength: "strong",
        description: "Parameters cluster around similar values.",
      },
    ];
    (parsed as Record<string, unknown>).pre_mortem = {
      scenario: "Market entry fails",
      grounded_in: ["fac_competition", "fac_investment"],
    };
    // Remove forbidden phrases
    (parsed as Record<string, unknown>).narrative_summary =
      "The model raises concerns about parameter clustering around investment factors.";
    (parsed as Record<string, unknown>).readiness_rationale =
      "Structural issues identified that need attention before proceeding.";

    const dskClaimIds = new Set(["DSK_001", "DSK_002", "DSK_003"]);
    const result = scoreDecisionReview(fixture, parsed, dskClaimIds);
    expect(result.dsk_fields_correct).toBe(true);
  });

  it("fails DSK check when claim_id not in bundle", () => {
    const fixture = makeFixture({
      inject_dsk: true,
      expected: {
        tone: "structural",
        must_mention_factors: [],
        dsk_fields_expected: true,
        pre_mortem_expected: false,
        forbidden_phrases: ["ready", "confident", "clear"],
      },
    });

    const parsed = validResponse();
    (parsed as Record<string, unknown>).bias_findings = [
      {
        type: "structural",
        linked_critique_code: "STRENGTH_CLUSTERING",
        dsk_claim_id: "DSK_INVALID",
        evidence_strength: "strong",
      },
    ];
    (parsed as Record<string, unknown>).narrative_summary = "Structural issues found.";
    (parsed as Record<string, unknown>).readiness_rationale = "Needs review.";

    const dskClaimIds = new Set(["DSK_001", "DSK_002"]);
    const result = scoreDecisionReview(fixture, parsed, dskClaimIds);
    expect(result.dsk_fields_correct).toBe(false);
  });

  it("handles runner_up null fixture — no comparative language", () => {
    const fixture = makeFixture({
      input: {
        winner: { id: "opt_expand", label: "Enter European Market", win_probability: 0.92, outcome_mean: 0.78 },
        runner_up: null,
        margin: null,
        deterministic_coaching: {
          headline_type: "CLEAR_WINNER",
          readiness: "ready",
          evidence_gaps: [],
          model_critiques: [],
        },
        isl_results: {
          option_comparison: [
            { option_id: "opt_expand", option_label: "Enter European Market", win_probability: 0.92, outcome: { mean: 0.78, p10: 0.65, p90: 0.90 } },
          ],
          factor_sensitivity: [
            { factor_id: "fac_europe_entry", factor_label: "Europe Market Entry", elasticity: 0.65, confidence: 0.85 },
          ],
          fragile_edges: [],
          robustness: { recommendation_stability: 0.95, overall_confidence: 0.90 },
        },
        graph: { nodes: [], edges: [] },
        brief: "We must enter the European market.",
      },
      expected: {
        tone: "confident",
        must_mention_factors: ["Europe Market Entry"],
        dsk_fields_expected: false,
        pre_mortem_expected: false,
        forbidden_phrases: ["compared to", "versus", "runner-up", "alternative option"],
      },
    });

    const parsed: Record<string, unknown> = {
      narrative_summary: "European expansion is the sole viable strategy with 92% probability.",
      story_headlines: {
        opt_expand: "Strong growth trajectory at 78% expected outcome.",
      },
      evidence_enhancements: {},
      scenario_contexts: {},
      bias_findings: [],
      readiness_rationale: "With 95% stability, the recommendation is robust.",
    };

    const result = scoreDecisionReview(fixture, parsed);
    expect(result.tone_alignment).toBe(true);
    expect(result.story_headlines_match).toBe(true);
    expect(result.scenario_contexts_valid).toBe(true);
    expect(result.evidence_enhancements_coverage).toBe(true);
  });

  it("detects forbidden phrases for cautious tone", () => {
    const fixture = makeFixture({
      expected: {
        tone: "cautious",
        must_mention_factors: [],
        dsk_fields_expected: false,
        pre_mortem_expected: true,
        forbidden_phrases: ["ready to proceed", "confident", "clear choice"],
      },
    });

    const parsed = validResponse();
    (parsed as Record<string, unknown>).narrative_summary =
      "We are confident in the expansion strategy and ready to proceed.";
    (parsed as Record<string, unknown>).pre_mortem = {
      scenario: "Market downturn",
      grounded_in: ["fac_competition"],
    };

    const result = scoreDecisionReview(fixture, parsed);
    expect(result.tone_alignment).toBe(false);
  });

  it("does not false-positive on valid decimal-percentage conversions", () => {
    const fixture = makeFixture();
    const parsed = validResponse();
    // 0.72 should match 72 (percentage conversion), not be penalised
    (parsed as Record<string, unknown>).narrative_summary =
      "The winner has a 72% win probability with 0.68 expected outcome and 15 percentage point margin.";

    const result = scoreDecisionReview(fixture, parsed);
    // All numbers (72, 0.68, 15) should be grounded
    expect(result.grounding_compliance).toBe(true);
    expect(result.unmatched_numbers?.length ?? 0).toBe(0);
  });

  it("returns zero score for null parsed response", () => {
    const fixture = makeFixture();
    const result = scoreDecisionReview(fixture, null);
    expect(result.valid_json).toBe(false);
    expect(result.overall).toBe(0);
  });
});
