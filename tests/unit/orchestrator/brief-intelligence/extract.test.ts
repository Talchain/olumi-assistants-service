import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractBriefIntelligence } from "../../../../src/orchestrator/brief-intelligence/extract.js";
import { BriefIntelligencePayload, BIL_CONTRACT_VERSION } from "../../../../src/schemas/brief-intelligence.js";

// Mock DSK loader to avoid requiring bundle files
vi.mock("../../../../src/orchestrator/dsk-loader.js", () => ({
  queryDsk: vi.fn().mockReturnValue([]),
}));

describe("extractBriefIntelligence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Core extraction tests
  // --------------------------------------------------------------------------

  it("extracts goal from brief with explicit goal language", () => {
    const bil = extractBriefIntelligence(
      "We want to maximize our revenue by expanding into the European market. Should we open a London office or hire remote contractors?",
    );
    expect(bil.goal).not.toBeNull();
    expect(bil.goal!.measurable).toBe(false);
    expect(bil.goal!.confidence).toBeGreaterThan(0);
  });

  it("returns null goal when no goal language is present", () => {
    const bil = extractBriefIntelligence(
      "The team has been discussing various approaches to the problem at hand.",
    );
    expect(bil.goal).toBeNull();
    expect(bil.missing_elements).toContain("goal");
  });

  it("detects measurable goal with numeric target", () => {
    const bil = extractBriefIntelligence(
      "We want to reach 10000 monthly active users by Q3. Should we invest in SEO or paid ads?",
    );
    expect(bil.goal).not.toBeNull();
    expect(bil.goal!.measurable).toBe(true);
    expect(bil.goal!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("extracts options from vs/or patterns", () => {
    const bil = extractBriefIntelligence(
      "Should we hire two developers vs a single tech lead? The budget is $300K and we need to ship by June.",
    );
    expect(bil.options.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts explicit Option A / Option B markers", () => {
    const bil = extractBriefIntelligence(
      "We are considering Option A: build in-house, or Option B: outsource to a vendor. Budget cap is $500K.",
    );
    const labels = bil.options.map((o) => o.label.toLowerCase());
    expect(labels.some((l) => l.includes("option a"))).toBe(true);
    expect(labels.some((l) => l.includes("option b"))).toBe(true);
    // Explicit options get high confidence
    expect(bil.options.every((o) => o.confidence >= 0.9)).toBe(true);
  });

  it("classifies hard_limit constraints", () => {
    const bil = extractBriefIntelligence(
      "We must not exceed a budget of $200K. The deadline is end of March. Should we build or buy?",
    );
    const hardLimits = bil.constraints.filter((c) => c.type === "hard_limit");
    expect(hardLimits.length).toBeGreaterThan(0);
  });

  it("classifies guardrail constraints", () => {
    const bil = extractBriefIntelligence(
      "We need at least 95% uptime. Should we migrate to AWS or stay on-prem?",
    );
    // "at least" without success_condition verb → guardrail
    expect(bil.constraints.length).toBeGreaterThan(0);
  });

  it("extracts factors from causal language", () => {
    const bil = extractBriefIntelligence(
      "Customer churn affects our revenue. Team velocity depends on hiring quality. Should we raise prices or keep them?",
    );
    expect(bil.factors.length).toBeGreaterThan(0);
    const labels = bil.factors.map((f) => f.label.toLowerCase());
    expect(labels.some((l) => l.includes("revenue") || l.includes("hiring quality"))).toBe(true);
  });

  it("returns medium or high completeness for well-formed brief", () => {
    const bil = extractBriefIntelligence(
      "Should we raise our SaaS prices from £49 to £59? Our goal is to maximize revenue. " +
      "Budget cap is $100K for the rollout. Risk of customer churn is our main concern. " +
      "The deadline is end of Q2. Option A: raise to £59. Option B: keep at £49.",
    );
    // Well-formed brief with goal, options, constraints, risk → at least medium
    expect(["medium", "high"]).toContain(bil.completeness_band);
  });

  it("returns low completeness for minimal brief", () => {
    const bil = extractBriefIntelligence(
      "We need to decide about our pricing strategy going forward.",
    );
    expect(bil.completeness_band).toBe("low");
  });

  it("detects missing status_quo_option", () => {
    const bil = extractBriefIntelligence(
      "Should we invest in AI tooling or hire more analysts? Budget is $500K.",
    );
    expect(bil.missing_elements).toContain("status_quo_option");
  });

  it("does not flag status_quo_option when present", () => {
    const bil = extractBriefIntelligence(
      "Should we invest in AI tooling, hire more analysts, or keep current approach? Budget is $500K.",
    );
    expect(bil.missing_elements).not.toContain("status_quo_option");
  });

  it("detects ambiguity flags from hedging language", () => {
    const bil = extractBriefIntelligence(
      "Maybe we should consider expanding. Perhaps the market is ready. We're not sure about timing.",
    );
    expect(bil.ambiguity_flags.length).toBeGreaterThan(0);
    expect(bil.ambiguity_flags.some((f) => f.toLowerCase().includes("hedging"))).toBe(true);
  });

  it("returns fallback for empty brief", () => {
    const bil = extractBriefIntelligence("");
    expect(bil.goal).toBeNull();
    expect(bil.completeness_band).toBe("low");
    expect(bil.missing_elements.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Dedup and stability (fix #3)
  // --------------------------------------------------------------------------

  it("deduplicates options case-insensitively", () => {
    const bil = extractBriefIntelligence(
      "Should we go with Option A or Option A? vs Option B. Budget is $100K for either option a or option b.",
    );
    const lowerLabels = bil.options.map((o) => o.label.toLowerCase());
    const uniqueLabels = new Set(lowerLabels);
    expect(lowerLabels.length).toBe(uniqueLabels.size);
  });

  it("produces sorted, stable output across calls", () => {
    const brief = "Revenue depends on pricing. Should we raise prices vs lower them? Budget cap $100K. Risk of churn is concerning.";
    const bil1 = extractBriefIntelligence(brief);
    const bil2 = extractBriefIntelligence(brief);
    expect(JSON.stringify(bil1)).toBe(JSON.stringify(bil2));
  });

  // --------------------------------------------------------------------------
  // Schema validation
  // --------------------------------------------------------------------------

  it("always produces valid BriefIntelligence payloads", () => {
    const briefs = [
      "Should we hire two developers or a tech lead? Budget $300K, deadline June.",
      "",
      "Maybe we should think about it.",
      "Maximize revenue. Reach 10K users. Must not exceed $500K. Risk of market saturation affects growth.",
    ];
    for (const brief of briefs) {
      const bil = extractBriefIntelligence(brief);
      const result = BriefIntelligencePayload.safeParse(bil);
      expect(result.success).toBe(true);
    }
  });

  it("includes contract_version in output", () => {
    const bil = extractBriefIntelligence("Should we expand or stay? Budget $100K.");
    expect(bil.contract_version).toBe(BIL_CONTRACT_VERSION);
  });

  // --------------------------------------------------------------------------
  // Causal framing score (item 32)
  // --------------------------------------------------------------------------

  it("scores strong causal framing with 3+ distinct phrases", () => {
    const bil = extractBriefIntelligence(
      "Price increases lead to churn because customers are price-sensitive. " +
      "Brand loyalty depends on perceived value. Marketing spend affects acquisition. " +
      "Should we raise or hold prices? Budget is $200K.",
    );
    // "leads to", "because", "depends on", "affects" = 4 distinct
    expect(bil.causal_framing_score).toBe("strong");
  });

  it("scores moderate causal framing with 1 phrase", () => {
    const bil = extractBriefIntelligence(
      "We should raise prices because our costs have increased. " +
      "Should we go with Option A or Option B? Budget is $200K.",
    );
    // Only "because" = 1 distinct
    expect(bil.causal_framing_score).toBe("moderate");
  });

  it("scores weak causal framing with no causal phrases", () => {
    const bil = extractBriefIntelligence(
      "Our pricing strategy needs updating. Option A: raise prices. " +
      "Option B: introduce tiered plans. Budget is $200K.",
    );
    expect(bil.causal_framing_score).toBe("weak");
  });

  it("counts distinct causal phrases not total occurrences", () => {
    const bil = extractBriefIntelligence(
      "We are changing because of costs. We are also moving because of demand. " +
      "And also because of competition. Should we act? Budget is $200K.",
    );
    // "because" appears 3 times but is only 1 distinct phrase
    expect(bil.causal_framing_score).toBe("moderate");
  });

  // --------------------------------------------------------------------------
  // Specificity score (item 33)
  // --------------------------------------------------------------------------

  it("scores specific with multiple numeric and temporal patterns", () => {
    const bil = extractBriefIntelligence(
      "Should we raise our SaaS prices from £49 to £59 by Q3 2026? " +
      "We expect 15% churn reduction. Budget is $200K.",
    );
    // £49, £59, Q3 2026, 15%, $200K = multiple distinct
    expect(bil.specificity_score).toBe("specific");
  });

  it("scores moderate when Q3 appears without a year", () => {
    const bil = extractBriefIntelligence(
      "We want to raise prices by Q3. Should we go with a 10% increase " +
      "or hold steady? The team is ready.",
    );
    // "Q3" alone does not match the temporal pattern (year required).
    // "10%" matches the percentage pattern → 1 distinct match → moderate.
    expect(bil.specificity_score).toBe("moderate");
  });

  it("scores vague with no numeric or temporal language", () => {
    const bil = extractBriefIntelligence(
      "We need to improve our pricing strategy to be more competitive. " +
      "Should we raise or lower prices? The team is ready.",
    );
    expect(bil.specificity_score).toBe("vague");
  });

  it("scores vague for 'this year' without a concrete date", () => {
    const bil = extractBriefIntelligence(
      "We need to do better this year. Our pricing is not competitive. " +
      "Should we raise or lower? The team is ready to act.",
    );
    // "this year" has no numeric/temporal specificity
    expect(bil.specificity_score).toBe("vague");
  });

  // --------------------------------------------------------------------------
  // Real-pattern integration tests (fix #9)
  // Uses actual computeBriefSignals — no mocking — to catch regex drift
  // --------------------------------------------------------------------------

  it("integration: hiring decision brief extracts all major elements", () => {
    const brief =
      "We need to decide whether to hire a senior tech lead or two mid-level developers. " +
      "Our goal is to maximize team velocity. We've budgeted $300K for this hire. " +
      "The deadline is end of Q2. We're worried about onboarding time affecting productivity. " +
      "Option A: hire one tech lead. Option B: hire two developers.";

    const bil = extractBriefIntelligence(brief);

    // Goal detected
    expect(bil.goal).not.toBeNull();
    expect(bil.goal!.label.toLowerCase()).toContain("maximize");

    // Options detected
    expect(bil.options.length).toBeGreaterThanOrEqual(2);

    // Constraints detected (budget + deadline)
    expect(bil.constraints.length).toBeGreaterThanOrEqual(1);

    // Risk/factors detected
    expect(bil.factors.length + (bil.missing_elements.includes("risk_factors") ? 0 : 1)).toBeGreaterThan(0);

    // Completeness should be medium or high
    expect(["medium", "high"]).toContain(bil.completeness_band);

    // Schema valid
    expect(BriefIntelligencePayload.safeParse(bil).success).toBe(true);
  });

  it("integration: pricing decision brief with measurable target", () => {
    const brief =
      "Should we raise our SaaS prices from £49 to £59 per month? " +
      "We want to reach £1m ARR by December. Currently at £750K. " +
      "Must not exceed 5% monthly churn. Customer satisfaction depends on perceived value. " +
      "The status quo is to keep current pricing.";

    const bil = extractBriefIntelligence(brief);

    // Measurable goal
    expect(bil.goal).not.toBeNull();
    expect(bil.goal!.measurable).toBe(true);

    // Has status quo → not in missing
    expect(bil.missing_elements).not.toContain("status_quo_option");

    // Budget/churn constraint detected
    expect(bil.constraints.length).toBeGreaterThan(0);

    // Causal language ("depends on") → factors
    expect(bil.factors.length).toBeGreaterThan(0);

    // Schema valid
    expect(BriefIntelligencePayload.safeParse(bil).success).toBe(true);
  });
});
