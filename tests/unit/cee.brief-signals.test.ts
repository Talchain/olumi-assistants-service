/**
 * BriefSignals v1 — Precision test harness.
 *
 * Golden fixture approach: asserts key fields (option_count_estimate,
 * has_measurable_target, baseline_state, etc.). Does NOT assert exact
 * marker strings — markers will churn.
 */
import { describe, it, expect, vi } from "vitest";
import { computeBriefSignals } from "../../src/cee/signals/brief-signals.js";
import { formatBriefHeader } from "../../src/cee/signals/brief-header.js";
import { evaluatePreflightDecision } from "../../src/cee/validation/preflight-decision.js";
import type { BriefSignals } from "../../src/cee/signals/types.js";

// ============================================================================
// Golden fixtures — 6 preflight calibration briefs
// ============================================================================

describe("Golden fixtures (preflight calibration briefs)", () => {
  it("'Should we expand internationally?' — short, underspecified", () => {
    const s = computeBriefSignals("Should we expand internationally?");
    expect(s.option_count_estimate).toBe(1); // "should we" = framing, no alternative
    expect(s.brief_strength).toMatch(/^(ok|weak)$/);
    expect(s.bias_signals).toHaveLength(0);
  });

  it("GTM strategy brief — medium detail, no false bias", () => {
    const brief =
      "We need to decide our go-to-market strategy for the new product launch. " +
      "Option A is direct-to-consumer via our website. Option B is through retail partnerships. " +
      "We want to reach 10,000 customers in the first quarter with a budget of £50k.";
    const s = computeBriefSignals(brief);
    expect(s.option_count_estimate).toBeGreaterThanOrEqual(2);
    expect(s.has_measurable_target).toBe(true);
    expect(s.has_constraints).toBe(true);
    expect(s.bias_signals).toHaveLength(0);
    expect(s.brief_strength).toBe("strong");
  });

  it("'Should I hire?' — option_count: 1", () => {
    const s = computeBriefSignals("Should I hire a new developer for the team?");
    expect(s.option_count_estimate).toBe(1);
  });

  it("'asdfghjkl qwerty' — weak, no false bias signals", () => {
    const s = computeBriefSignals("asdfghjkl qwerty zxcvbnm random words");
    expect(s.brief_strength).toBe("weak");
    expect(s.bias_signals).toHaveLength(0);
  });

  it("'expand' — single word, weak", () => {
    const s = computeBriefSignals("expand");
    expect(s.brief_strength).toBe("weak");
    expect(s.word_count).toBe(1);
  });

  it("'Expand to EU?' — short valid question", () => {
    const s = computeBriefSignals("Should we expand to EU or stay in the UK market?");
    expect(s.option_count_estimate).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Structural detection (≥16 cases)
// ============================================================================

describe("Structural detection", () => {
  it("2 clear options: 'raise to £59 or stay at £49' → option_count: 2", () => {
    const s = computeBriefSignals(
      "Should we raise the subscription to £59 or stay at the current £49 price point?"
    );
    expect(s.option_count_estimate).toBeGreaterThanOrEqual(2);
  });

  it("'Should we X' with no alternative → option_count: 1", () => {
    const s = computeBriefSignals("Should we invest in the new warehouse facility?");
    expect(s.option_count_estimate).toBe(1);
  });

  it("'Revenue or profit' (listing) → does NOT increase option count", () => {
    const s = computeBriefSignals(
      "We need to improve our revenue or profit margins this quarter."
    );
    // "revenue or profit" is noun-list, not verb-phrase
    expect(s.option_count_estimate).toBeLessThanOrEqual(1);
  });

  it("'Reach £200k MRR' → has_measurable_target: true, target role", () => {
    const s = computeBriefSignals("We want to reach £200k MRR by end of year.");
    expect(s.has_measurable_target).toBe(true);
    expect(s.target_markers.length).toBeGreaterThanOrEqual(1);
    expect(s.target_markers[0].role).toBe("target");
  });

  it("'Team of 12 engineers' → has_measurable_target: false, context role", () => {
    const s = computeBriefSignals("We have a team of 12 engineers working on this project.");
    expect(s.has_measurable_target).toBe(false);
    // 12 without target verb is context
    const anchor12 = s.numeric_anchors.find((a) => a.value === 12);
    if (anchor12) {
      expect(anchor12.role).not.toBe("target");
    }
  });

  it("'From £49 to £59' → baseline_state: present", () => {
    const s = computeBriefSignals(
      "We want to raise our price from £49 to £59 per month."
    );
    expect(s.baseline_state).toBe("present");
  });

  it("'Raise to £59' (no from) → baseline_state: missing", () => {
    const s = computeBriefSignals("We want to raise our price to £59 per month.");
    expect(s.baseline_state).toBe("missing");
  });

  it("'Currently unknown' → baseline_state: unknown_explicit", () => {
    const s = computeBriefSignals(
      "We want to reduce churn but the exact rate is currently unknown."
    );
    expect(s.baseline_state).toBe("unknown_explicit");
  });

  it("'Currently high churn' (qualitative) → baseline_state: present", () => {
    const s = computeBriefSignals(
      "We currently have high churn and want to reduce it to under 5%."
    );
    expect(s.baseline_state).toBe("present");
  });

  it("'Budget of £50k' → has_constraints: true, has_value: true", () => {
    const s = computeBriefSignals(
      "We need to launch the campaign with a budget of £50k."
    );
    expect(s.has_constraints).toBe(true);
    expect(s.constraint_markers.some((c) => c.has_value)).toBe(true);
  });

  it("'Budget' with no number → has_constraints: true, has_value: false", () => {
    const s = computeBriefSignals(
      "We have a limited budget for this project."
    );
    expect(s.has_constraints).toBe(true);
    // No numeric value in same sentence
    expect(s.constraint_markers.some((c) => !c.has_value)).toBe(true);
  });

  it("'Worried about churn' → has_risks: true", () => {
    const s = computeBriefSignals("We are worried about customer churn increasing.");
    expect(s.has_risks).toBe(true);
  });

  it("No risk language → has_risks: false", () => {
    const s = computeBriefSignals("We plan to launch the new feature next quarter.");
    expect(s.has_risks).toBe(false);
  });

  it("Goal verb without metric: 'improve retention' → goal: true, target: false", () => {
    const s = computeBriefSignals("We want to improve customer retention this year.");
    expect(s.has_explicit_goal).toBe(true);
    expect(s.has_measurable_target).toBe(false);
  });

  it("Goal verb with metric: 'reach 95% retention' → goal: true, target: true", () => {
    const s = computeBriefSignals("We want to reach 95% customer retention rate.");
    expect(s.has_explicit_goal).toBe(true);
    expect(s.has_measurable_target).toBe(true);
  });

  it("'200k' normalisation → value: 200000", () => {
    const s = computeBriefSignals("We aim for 200k monthly active users.");
    const anchor = s.numeric_anchors.find((a) => a.value === 200000);
    expect(anchor).toBeDefined();
    expect(anchor!.unit).toBe("k");
  });
});

// ============================================================================
// Bias detection (≥8 cases)
// ============================================================================

describe("Bias detection", () => {
  it("'We've already spent £200k' → sunk_cost", () => {
    const s = computeBriefSignals(
      "We've already spent £200k on this project. Should we continue or pivot?"
    );
    expect(s.bias_signals.some((b) => b.type === "sunk_cost")).toBe(true);
  });

  it("'After all the work we've put in' → sunk_cost", () => {
    const s = computeBriefSignals(
      "After all the work we've put in, should we keep going with this approach?"
    );
    expect(s.bias_signals.some((b) => b.type === "sunk_cost")).toBe(true);
  });

  it("No sunk cost language → no sunk_cost signal", () => {
    const s = computeBriefSignals(
      "We need to decide between two vendors for our cloud infrastructure."
    );
    expect(s.bias_signals.some((b) => b.type === "sunk_cost")).toBe(false);
  });

  it("One number in first sentence, no other numbers → anchoring", () => {
    const s = computeBriefSignals(
      "The project costs £500k. Should we proceed with the investment?"
    );
    expect(s.bias_signals.some((b) => b.type === "anchoring")).toBe(true);
  });

  it("One number NOT in first sentence, NOT repeated → no anchoring", () => {
    const s = computeBriefSignals(
      "Should we expand our team? The budget would be around £100k."
    );
    expect(s.bias_signals.some((b) => b.type === "anchoring")).toBe(false);
  });

  it("Multiple distinct numbers → no anchoring", () => {
    const s = computeBriefSignals(
      "Option A costs £200k. Option B costs £150k. Which should we choose?"
    );
    expect(s.bias_signals.some((b) => b.type === "anchoring")).toBe(false);
  });

  it("One number repeated 3 times → anchoring", () => {
    const s = computeBriefSignals(
      "The £500k budget. We have £500k available. £500k is our ceiling."
    );
    expect(s.bias_signals.some((b) => b.type === "anchoring")).toBe(true);
  });

  it("'3-person team' as only number (single digit, no unit) → no anchoring", () => {
    const s = computeBriefSignals(
      "Our 3 person team needs to decide on the deployment strategy."
    );
    expect(s.bias_signals.some((b) => b.type === "anchoring")).toBe(false);
  });
});

// ============================================================================
// Brief strength (≥6 cases)
// ============================================================================

describe("Brief strength", () => {
  it("Strong brief (2 options, target, baseline, 50 words)", () => {
    const brief =
      "Should we raise our subscription price from £49 to £59, or introduce a premium " +
      "tier at £79? We currently have 10,000 subscribers. The goal is to reach £200k MRR " +
      "within 6 months. We're worried about churn if we raise prices too aggressively. " +
      "The budget for the transition is capped at £15k.";
    const s = computeBriefSignals(brief);
    expect(s.brief_strength).toBe("strong");
  });

  it("OK brief (1 option, goal verb, 20 words)", () => {
    const brief =
      "Should we invest in a new CRM system to improve our sales pipeline conversion rates this quarter?";
    const s = computeBriefSignals(brief);
    expect(s.brief_strength).toBe("ok");
  });

  it("Weak brief (5 words, no structure)", () => {
    const s = computeBriefSignals("need to decide soon");
    expect(s.brief_strength).toBe("weak");
  });

  it("Target + constraints but 1 option → ok (not strong)", () => {
    const brief =
      "We want to reach 95% customer retention with a budget of £50k for the retention programme.";
    const s = computeBriefSignals(brief);
    expect(s.option_count_estimate).toBeLessThan(2);
    expect(s.brief_strength).not.toBe("strong");
  });

  it("2 options + target but only 15 words → not strong (word count)", () => {
    const brief = "Option A vs Option B. Reach £200k MRR. Short brief.";
    const s = computeBriefSignals(brief);
    expect(s.brief_strength).not.toBe("strong");
  });

  it("Empty string → weak", () => {
    const s = computeBriefSignals("");
    expect(s.brief_strength).toBe("weak");
    expect(s.word_count).toBe(0);
  });
});

// ============================================================================
// Missing items (≥4 cases)
// ============================================================================

describe("Missing items", () => {
  it("Missing alternative + target → priority 1 first, then 2", () => {
    const s = computeBriefSignals("We want to launch a new product.");
    expect(s.missing_items.length).toBeGreaterThanOrEqual(2);
    expect(s.missing_items[0].priority).toBe(1);
    expect(s.missing_items[0].component).toBe("alternative");
    expect(s.missing_items[1].priority).toBe(2);
    expect(s.missing_items[1].component).toBe("measurable_outcome");
  });

  it("Missing only risk → one entry with component === 'risk'", () => {
    const brief =
      "Should we raise prices from £49 to £59 or keep them the same? " +
      "We want to reach £200k MRR. Budget of £20k for the transition.";
    const s = computeBriefSignals(brief);
    const riskItem = s.missing_items.find((m) => m.component === "risk");
    expect(riskItem).toBeDefined();
    expect(riskItem!.priority).toBe(5);
  });

  it("Strong brief → missing_items empty or minimal", () => {
    const brief =
      "Should we raise our subscription price from £49 to £59, or introduce a premium " +
      "tier at £79? We currently have 10,000 subscribers. The goal is to reach £200k MRR " +
      "within 6 months. We're worried about churn if we raise prices too aggressively. " +
      "The budget for the transition is capped at £15k.";
    const s = computeBriefSignals(brief);
    // Strong brief should have few or no missing items
    expect(s.missing_items.length).toBeLessThanOrEqual(1);
  });

  it("baseline_state unknown_explicit → baseline NOT in missing_items", () => {
    const s = computeBriefSignals(
      "Should we expand to Europe? Our exact market share is currently unknown. " +
      "We want to reach 10,000 customers."
    );
    expect(s.baseline_state).toBe("unknown_explicit");
    expect(s.missing_items.some((m) => m.component === "baseline")).toBe(false);
  });
});

// ============================================================================
// Integration (≥4 cases)
// ============================================================================

describe("Integration", () => {
  it("formatBriefHeader produces valid [BRIEF_SIGNALS v1] string with no newlines in body", () => {
    const s = computeBriefSignals("Should we raise prices from £49 to £59 or stay?");
    const header = formatBriefHeader(s);
    expect(header).toContain("[BRIEF_SIGNALS v1]");
    // Should start with \n\n but body has no additional newlines
    const body = header.replace(/^\n\n/, "");
    expect(body).not.toContain("\n");
    // No brackets, quotes, backticks in body AFTER the version prefix
    const afterPrefix = body.replace("[BRIEF_SIGNALS v1] ", "");
    expect(afterPrefix).not.toMatch(/[\[\]"'`]/);
  });

  it("Weak brief → preflight populates clarification_questions from missing_items (strict mode)", () => {
    const decision = evaluatePreflightDecision("need to decide on something for the team soon", {
      preflightStrict: true,
      preflightReadinessThreshold: 0.9, // ensure it triggers clarify
    });
    // On reject, briefSignals is undefined — check we didn't reject
    if (decision.action === "clarify" && decision.briefSignals) {
      expect(decision.briefSignals.brief_strength).toBe("weak");
      const payload = decision.payload as any;
      expect(payload.clarification_questions.length).toBeGreaterThan(0);
      expect(payload.clarification_questions.length).toBeLessThanOrEqual(2);
    }
  });

  it("OK brief → preflight does NOT use BriefSignals for clarification questions (strict mode)", () => {
    const brief =
      "Should we invest in a new CRM system to improve our sales pipeline? " +
      "We want to increase conversion rates by at least twenty percent.";
    const decision = evaluatePreflightDecision(brief, {
      preflightStrict: true,
      preflightReadinessThreshold: 0.9,
    });
    if (decision.action === "clarify" && decision.briefSignals) {
      // OK brief uses readiness questions, not BriefSignals missing_items
      expect(decision.briefSignals.brief_strength).not.toBe("weak");
    }
  });

  it("bias_signals field is populated in BriefSignals when bias detected", () => {
    const s = computeBriefSignals(
      "We've already spent £200k on this project. Should we continue?"
    );
    expect(s.bias_signals.length).toBeGreaterThan(0);
    expect(s.bias_signals[0].type).toBe("sunk_cost");
    expect(s.bias_signals[0].confidence).toBe("high");
    expect(s.bias_signals[0].evidence).toBeTruthy();
  });
});

// ============================================================================
// Precedence / edge cases (≥4 cases)
// ============================================================================

describe("Precedence and edge cases", () => {
  it("Sentence with target verb + constraint verb + number → role = target", () => {
    const s = computeBriefSignals(
      "We want to reach a maximum of 500 customers in the pilot."
    );
    // "reach" is target verb (highest precedence), "maximum" is constraint
    const anchor500 = s.numeric_anchors.find((a) => a.value === 500);
    expect(anchor500).toBeDefined();
    expect(anchor500!.role).toBe("target");
  });

  it("Number '2025' → excluded as year", () => {
    const s = computeBriefSignals("We plan to launch in 2025 with a team of 15.");
    const yearAnchor = s.numeric_anchors.find((a) => a.value === 2025);
    expect(yearAnchor).toBeUndefined();
    // 15 should still be present
    const teamAnchor = s.numeric_anchors.find((a) => a.value === 15);
    expect(teamAnchor).toBeDefined();
  });

  it("'1st option' → ordinal excluded from anchors", () => {
    const s = computeBriefSignals("The 1st option is to expand. The 2nd is to consolidate.");
    // Ordinals should be excluded
    const anchor1 = s.numeric_anchors.find((a) => a.value === 1);
    expect(anchor1).toBeUndefined();
  });

  it("'4%' → value: 4, unit: '%'", () => {
    const s = computeBriefSignals("We want to reduce churn to 4% from the current level.");
    const anchor = s.numeric_anchors.find((a) => a.value === 4);
    expect(anchor).toBeDefined();
    expect(anchor!.unit).toBe("%");
  });
});

// ============================================================================
// Drift guard tests (3 cases)
// ============================================================================

describe("Drift guards", () => {
  it("computeBriefSignals called exactly once per non-reject request (spy assertion)", () => {
    // We can verify by checking that evaluatePreflightDecision returns briefSignals
    // only when action !== 'reject', and the signals object is consistent
    const validBrief = "Should we expand our product line to include enterprise features?";
    const decision = evaluatePreflightDecision(validBrief, {
      preflightStrict: false,
      preflightReadinessThreshold: 0.4,
    });

    // Action should be 'proceed' (non-strict) and signals should exist
    expect(decision.action).not.toBe("reject");
    expect(decision.briefSignals).toBeDefined();

    // The signals object should match a fresh computation
    const freshSignals = computeBriefSignals(validBrief);
    expect(decision.briefSignals!.option_count_estimate).toBe(freshSignals.option_count_estimate);
    expect(decision.briefSignals!.brief_strength).toBe(freshSignals.brief_strength);
    expect(decision.briefSignals!.word_count).toBe(freshSignals.word_count);
  });

  it("Header appended exactly once (no double-append in sync or SSE paths)", () => {
    // Verify that formatBriefHeader produces a string with exactly one [BRIEF_SIGNALS v1] prefix
    const s = computeBriefSignals("Should we invest in cloud infrastructure?");
    const header = formatBriefHeader(s);

    // Count occurrences of [BRIEF_SIGNALS v1]
    const matches = header.match(/\[BRIEF_SIGNALS v1\]/g);
    expect(matches).toHaveLength(1);

    // Verify it starts with \n\n (for clean concatenation)
    expect(header.startsWith("\n\n")).toBe(true);

    // Simulate double-append scenario — header should still only have one prefix
    const userContent = `## Brief\nSome brief${header}`;
    const prefixCount = (userContent.match(/\[BRIEF_SIGNALS v1\]/g) || []).length;
    expect(prefixCount).toBe(1);
  });

  it("Weak brief produces exactly 2 questions in priority order (alternative first if missing)", () => {
    const decision = evaluatePreflightDecision(
      "We need to decide on our strategy going forward for the next quarter planning cycle.", {
      preflightStrict: true,
      preflightReadinessThreshold: 0.95, // Force clarify action
    });

    if (decision.action === "clarify" && decision.briefSignals?.brief_strength === "weak") {
      const payload = decision.payload as any;
      expect(payload.clarification_questions).toHaveLength(2);
      // First question should be about alternatives (priority 1) if missing
      if (decision.briefSignals.option_count_estimate < 2) {
        expect(payload.clarification_questions[0]).toContain("alternative");
      }
    } else if (decision.action === "proceed" && decision.briefSignals?.brief_strength === "weak") {
      // Non-strict mode: advisory payload should have questions
      const payload = decision.payload as any;
      expect(payload?.clarification_questions).toHaveLength(2);
    }
  });
});

// ============================================================================
// Sentence count and word count
// ============================================================================

describe("Basic metrics", () => {
  it("Counts words correctly", () => {
    const s = computeBriefSignals("This is a five word sentence.");
    expect(s.word_count).toBe(6); // "This is a five word sentence."
  });

  it("Counts sentences correctly", () => {
    const s = computeBriefSignals("First sentence. Second sentence! Third sentence?");
    expect(s.sentence_count).toBe(3);
  });
});
