import { describe, it, expect } from "vitest";
import { estimateTokens, checkBudget } from "../../../../src/orchestrator/context-fabric/token-estimator.js";
import type { TokenBudget } from "../../../../src/orchestrator/context-fabric/types.js";

// ============================================================================
// estimateTokens
// ============================================================================

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 1 for 1-4 characters", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("ab")).toBe(1);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("returns 2 for 5-8 characters", () => {
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up (ceiling)", () => {
    expect(estimateTokens("abcdefghi")).toBe(3); // 9/4 = 2.25 → 3
  });

  it("handles known lengths", () => {
    const text = "x".repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  it("handles large text", () => {
    const text = "x".repeat(40000);
    expect(estimateTokens(text)).toBe(10000);
  });
});

// ============================================================================
// checkBudget
// ============================================================================

describe("checkBudget", () => {
  const budget: TokenBudget = {
    zone1: 1000,
    zone2: 500,
    zone3: 5700,
    safety_margin: 800,
    effective_total: 7200, // floor(8000 * 0.9)
  };

  it("within_budget true when estimated <= effective_total", () => {
    const result = checkBudget(7000, budget);
    expect(result.within_budget).toBe(true);
    expect(result.overage).toBe(0);
  });

  it("within_budget true when estimated equals effective_total", () => {
    const result = checkBudget(7200, budget);
    expect(result.within_budget).toBe(true);
    expect(result.overage).toBe(0);
  });

  it("within_budget false when estimated > effective_total", () => {
    const result = checkBudget(8000, budget);
    expect(result.within_budget).toBe(false);
    expect(result.overage).toBe(800);
  });

  it("zone percentages are computed correctly", () => {
    const result = checkBudget(7000, budget);
    expect(result.zone1_pct).toBeCloseTo(1000 / 7200 * 100, 5);
    expect(result.zone2_pct).toBeCloseTo(500 / 7200 * 100, 5);
    expect(result.zone3_pct).toBeCloseTo(5700 / 7200 * 100, 5);
  });

  it("zone percentages sum to approximately 100%", () => {
    const result = checkBudget(7000, budget);
    const sum = result.zone1_pct + result.zone2_pct + result.zone3_pct;
    expect(sum).toBeCloseTo(100, 1);
  });

  it("handles zero effective_total without crashing", () => {
    const zeroBudget: TokenBudget = {
      zone1: 0,
      zone2: 0,
      zone3: 0,
      safety_margin: 0,
      effective_total: 0,
    };
    const result = checkBudget(100, zeroBudget);
    expect(result.within_budget).toBe(false);
    expect(result.overage).toBe(100);
    // Should not throw on division by zero
    expect(Number.isFinite(result.zone1_pct)).toBe(true);
  });
});

// ============================================================================
// Heuristic Accuracy — Representative Payloads
//
// Claude tokenizers typically produce ~3.5–4.5 chars/token for English prose,
// ~2–3 chars/token for structured JSON (lots of punctuation/braces), and
// ~1.5–2.5 chars/token for CJK/emoji. The 4 chars/token heuristic is a
// reasonable middle ground that slightly underestimates JSON-heavy payloads.
// ============================================================================

describe("4 chars/token heuristic — representative payloads", () => {
  it("English prose: ~4 chars/token (heuristic matches well)", () => {
    // Typical analysis explanation text
    const prose = "Revenue is the dominant driver of profitability, " +
      "accounting for approximately 60% of the variance in outcomes. " +
      "Price increases of 10% would yield a 15% improvement in margin.";
    const estimated = estimateTokens(prose);
    // 158 chars → 40 tokens estimated. Real tokenizer: ~35-42 tokens.
    // Ratio: 158/40 = 3.95 chars/token — very close to heuristic.
    expect(estimated).toBe(Math.ceil(prose.length / 4));
    expect(estimated).toBeGreaterThanOrEqual(35);
    expect(estimated).toBeLessThanOrEqual(45);
  });

  it("JSON graph: ~2.5-3.5 chars/token (heuristic underestimates by ~20-30%)", () => {
    // Compact JSON graph — lots of braces, colons, quotes
    const graph = JSON.stringify({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Maximise revenue" },
        { id: "opt_hire", kind: "option", label: "Hire sales team" },
        { id: "fac_cost", kind: "factor", label: "Cost", data: { value: 0.5, unit: "£" } },
      ],
      edges: [
        { from: "goal_1", to: "opt_hire", strength_mean: 1.0, strength_std: 0.01 },
        { from: "opt_hire", to: "fac_cost", strength_mean: -0.3, strength_std: 0.1 },
      ],
    });
    const estimated = estimateTokens(graph);
    // JSON has ~3 chars/token due to punctuation. Real token count would be
    // ~30% higher than our estimate. This is an acceptable conservative bias
    // (we won't truncate prematurely) but means budget usage tracking underreads.
    expect(estimated).toBeGreaterThan(0);
    // Document: our estimate for this payload
    const actualCharCount = graph.length;
    const ratio = actualCharCount / estimated;
    // Ratio should be ~4 (our heuristic)
    expect(ratio).toBeCloseTo(4, 0);
  });

  it("Unicode node labels: heuristic overestimates for CJK", () => {
    // CJK characters are ~1 char = ~1 token (each is a full token)
    // but our heuristic treats 4 chars = 1 token
    const cjkLabel = "顧客満足度を最大化する"; // 11 chars, ~11 real tokens
    const estimated = estimateTokens(cjkLabel);
    // 11 chars / 4 = 3 tokens (our estimate)
    // Reality: ~11 tokens → we underestimate by ~3.7x for pure CJK
    expect(estimated).toBe(3);
    // Document: for CJK-heavy content, actual tokens ≈ estimated × 3-4
  });

  it("Mixed content (English + JSON keys): reasonable middle ground", () => {
    // Realistic orchestrator context assembly output
    const mixed = [
      "## Graph Summary",
      "Decision: Which CRM to adopt",
      "Options: Salesforce, HubSpot, Pipedrive",
      "Factors: cost (£50k), migration_effort (0.7), team_size (12)",
      '{"stage":"evaluate","goal":"Choose best CRM"}',
    ].join("\n");
    const estimated = estimateTokens(mixed);
    // Mixed content: ~3.5-4 chars/token. Our heuristic is reasonable.
    expect(estimated).toBeGreaterThan(30);
    expect(estimated).toBeLessThan(80);
  });

  it("analysis summary blob: JSON-heavy, heuristic conservatively underestimates", () => {
    // Representative PLoT analysis response summary
    const analysisSummary = JSON.stringify({
      results: [
        { option_id: "opt_1", option_label: "Option A", expected_value: 0.72, probability_best: 0.45 },
        { option_id: "opt_2", option_label: "Option B", expected_value: 0.68, probability_best: 0.35 },
        { option_id: "opt_3", option_label: "Option C", expected_value: 0.55, probability_best: 0.20 },
      ],
      drivers: [
        { factor_id: "fac_1", label: "Revenue", sensitivity: 0.82 },
        { factor_id: "fac_2", label: "Cost", sensitivity: 0.65 },
      ],
      meta: { seed_used: 42, n_samples: 10000, response_hash: "abc123def456" },
    });
    const estimated = estimateTokens(analysisSummary);
    // Verify the estimate is positive and documents the ratio
    expect(estimated).toBeGreaterThan(50);
    // At 4 chars/token, for a ~500 char JSON payload we'd get ~125 tokens
    // Real tokenizer would likely give ~150-180 tokens
    // Conservative underestimate is acceptable: won't truncate too aggressively
    const ratio = analysisSummary.length / estimated;
    expect(ratio).toBeCloseTo(4, 0);
  });
});
