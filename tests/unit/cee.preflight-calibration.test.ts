/**
 * Preflight calibration suite — tests the 10 canonical calibration briefs
 * and edge cases for gibberish detection, readiness scoring, and policy ladder.
 *
 * All 10 calibration briefs MUST produce the expected behaviour after the
 * v1.17 gibberish detection fixes. This file is the regression guard.
 */

import { describe, it, expect } from "vitest";
import { validateBriefPreflight, __test_only } from "../../src/cee/validation/preflight.js";
import { assessBriefReadiness } from "../../src/cee/validation/readiness.js";

const { calculateEntropy, calculateDictionaryCoverage, isLikelyGibberish } = __test_only;

// ============================================================================
// Gibberish detection — unit tests
// ============================================================================

describe("isLikelyGibberish", () => {
  // The pattern /[a-z]{15,}/i was removed in v1.17 because it falsely flagged
  // long valid English words like "internationally" (15 chars).
  it("does NOT flag a valid English word with 15+ characters as gibberish", () => {
    const text = "internationally";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(false);
  });

  it("does NOT flag 'Should we expand internationally?' as gibberish", () => {
    const text = "Should we expand internationally?";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(false);
  });

  it("flags keyboard-mash keyboard rows as gibberish (no coverage)", () => {
    const text = "asdfghjkl qwerty zxcvbnm";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(true);
  });

  it("flags all-symbol input as gibberish (no letters pattern)", () => {
    const text = "!!!$$$###@@@";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(true);
  });

  it("does NOT flag 'expand' as gibberish (single valid word, short exemption)", () => {
    const text = "expand";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    // coverage = 0 (not in COMMON_WORDS) but short-input exemption applies
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(false);
  });

  it("does NOT flag 'Should I hire?' as gibberish (all valid words)", () => {
    const text = "Should I hire?";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(false);
  });

  it("does NOT flag 'Expand to EU?' as gibberish (short, valid words, proper noun)", () => {
    const text = "Expand to EU?";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(false);
  });

  it("flags repeated character runs as gibberish", () => {
    const text = "aaaaaaa bbbbbbb";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(true);
  });

  it("flags emoji-only input as gibberish (no letters)", () => {
    const text = "🚀🔥💡";
    const entropy = calculateEntropy(text);
    const coverage = calculateDictionaryCoverage(text);
    expect(isLikelyGibberish(text, entropy, coverage)).toBe(true);
  });
});

// ============================================================================
// validateBriefPreflight — calibration suite (10 canonical briefs)
// ============================================================================

describe("validateBriefPreflight — 10 calibration briefs", () => {
  // Brief #1: Should we expand internationally?
  it("brief #1: 'Should we expand internationally?' is valid (NOT gibberish)", () => {
    const result = validateBriefPreflight("Should we expand internationally?");
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeUndefined();
    // May have other issues (word count, length) but NOT gibberish
    expect(result.issues.every(i => i.code !== "BRIEF_APPEARS_GIBBERISH")).toBe(true);
  });

  // Brief #2: Medium-detail decision
  it("brief #2: mobile app build vs outsource brief passes preflight", () => {
    const text = "We need to decide whether to build our mobile app in-house with our current engineering team or outsource it to an agency. We want to launch within 6 months. Budget is a concern but we don't have a specific limit yet.";
    const result = validateBriefPreflight(text);
    expect(result.valid).toBe(true);
    expect(result.issues.filter(i => i.severity === "error")).toHaveLength(0);
  });

  // Brief #3: High-detail decision
  it("brief #3: go-to-market strategy brief passes preflight", () => {
    const text = "We're deciding between three go-to-market strategies for our new B2B SaaS product: direct sales hiring, channel partnerships, or product-led growth. Our goal is to reach 500k ARR within 12 months. We currently have 15 beta customers, a 3-person founding team, and 200k runway remaining.";
    const result = validateBriefPreflight(text);
    expect(result.valid).toBe(true);
    expect(result.issues.filter(i => i.severity === "error")).toHaveLength(0);
  });

  // Brief #4: Keyboard mash — must be gibberish
  it("brief #4: 'asdfghjkl qwerty zxcvbnm' is flagged as gibberish", () => {
    const result = validateBriefPreflight("asdfghjkl qwerty zxcvbnm");
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeDefined();
    expect(result.valid).toBe(false);
  });

  // Brief #5: Single word — too short/few words, but NOT gibberish
  it("brief #5: 'expand' fails on length/word-count, NOT as gibberish", () => {
    const result = validateBriefPreflight("expand");
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeUndefined();
    // Should fail on other structural grounds
    const shortIssue = result.issues.find(i =>
      i.code === "BRIEF_TOO_SHORT" || i.code === "BRIEF_TOO_FEW_WORDS"
    );
    expect(shortIssue).toBeDefined();
  });

  // Brief #6: Short but valid — NOT gibberish
  it("brief #6: 'Should I hire?' is NOT gibberish (short valid English)", () => {
    const result = validateBriefPreflight("Should I hire?");
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeUndefined();
  });

  // Brief #7: Empty string
  it("brief #7: empty string fails preflight with structural errors", () => {
    const result = validateBriefPreflight("");
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  // Brief #8: Whitespace only
  it("brief #8: whitespace-only string fails preflight", () => {
    const result = validateBriefPreflight("   ");
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  // Brief #9: Symbol spam — must be gibberish
  it("brief #9: '!!!$$$###@@@' is flagged as gibberish", () => {
    const result = validateBriefPreflight("!!!$$$###@@@");
    expect(result.valid).toBe(false);
    // Should have either BRIEF_APPEARS_GIBBERISH or BRIEF_INVALID_CHARACTERS
    const blockingIssue = result.issues.find(i =>
      i.code === "BRIEF_APPEARS_GIBBERISH" || i.code === "BRIEF_INVALID_CHARACTERS"
    );
    expect(blockingIssue).toBeDefined();
  });

  // Brief #10: Short with proper noun — NOT gibberish
  it("brief #10: 'Expand to EU?' is NOT gibberish (proper noun in short input)", () => {
    const result = validateBriefPreflight("Expand to EU?");
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeUndefined();
  });
});

// ============================================================================
// assessBriefReadiness — readiness scoring for calibration briefs
// ============================================================================

describe("assessBriefReadiness — calibration suite", () => {
  it("brief #1: 'Should we expand internationally?' passes preflight and gets a low readiness score", () => {
    const result = assessBriefReadiness("Should we expand internationally?");
    // Must NOT be not_ready due to gibberish — preflight must pass
    expect(result.preflight.valid).toBe(true);
    // Score should be low (short, underspecified) but not zero
    expect(result.score).toBeGreaterThan(0);
    // Level should be needs_clarification or not_ready (underspecified), never failing due to gibberish
    expect(result.level).not.toBe("ready");
    // Suggested questions should be present
    expect(result.suggested_questions).toBeDefined();
    expect(Array.isArray(result.suggested_questions)).toBe(true);
  });

  it("brief #2: mobile app brief has medium-high readiness", () => {
    const text = "We need to decide whether to build our mobile app in-house with our current engineering team or outsource it to an agency. We want to launch within 6 months. Budget is a concern but we don't have a specific limit yet.";
    const result = assessBriefReadiness(text);
    expect(result.preflight.valid).toBe(true);
    expect(result.score).toBeGreaterThan(0.6);
    expect(result.level).toBe("ready");
  });

  it("brief #3: go-to-market brief has high readiness", () => {
    const text = "We're deciding between three go-to-market strategies for our new B2B SaaS product: direct sales hiring, channel partnerships, or product-led growth. Our goal is to reach 500k ARR within 12 months. We currently have 15 beta customers, a 3-person founding team, and 200k runway remaining.";
    const result = assessBriefReadiness(text);
    expect(result.preflight.valid).toBe(true);
    expect(result.score).toBeGreaterThan(0.6);
    expect(result.level).toBe("ready");
  });

  it("brief #4: keyboard mash returns not_ready (gibberish)", () => {
    const result = assessBriefReadiness("asdfghjkl qwerty zxcvbnm");
    expect(result.preflight.valid).toBe(false);
    expect(result.level).toBe("not_ready");
    expect(result.score).toBe(0);
  });

  it("brief #6: 'Should I hire?' is not_ready or needs_clarification — not gibberish", () => {
    const result = assessBriefReadiness("Should I hire?");
    expect(result.preflight.valid).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("brief #9: symbol spam returns not_ready (invalid chars / gibberish)", () => {
    const result = assessBriefReadiness("!!!$$$###@@@");
    expect(result.preflight.valid).toBe(false);
    expect(result.level).toBe("not_ready");
  });

  it("brief #10: 'Expand to EU?' passes preflight with low readiness", () => {
    const result = assessBriefReadiness("Expand to EU?");
    expect(result.preflight.valid).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    // Short, underspecified — should not be ready
    expect(result.level).not.toBe("ready");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("validateBriefPreflight — edge cases", () => {
  it("emoji-only input is rejected (no letters)", () => {
    const result = validateBriefPreflight("🚀🔥💡");
    expect(result.valid).toBe(false);
  });

  it("a 15-character valid English word does not trigger gibberish pattern", () => {
    // 'internationally' = 15 chars — was falsely flagged before v1.17 fix
    const result = validateBriefPreflight("internationally");
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeUndefined();
  });

  it("a very long brief (>2000 chars) is not gibberish but may get a lower length score", () => {
    const longBrief = "We need to decide whether to expand our engineering team. ".repeat(100); // ~5600 chars
    const truncated = longBrief.slice(0, 5000); // within max
    const result = validateBriefPreflight(truncated);
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeUndefined();
  });

  it("brief with only numbers and spaces is not English text — fails coverage check with corroborating signal", () => {
    // Numbers only, no letters — triggers /^[^a-zA-Z]*$/ pattern
    const result = validateBriefPreflight("1234 5678 9012 3456");
    expect(result.valid).toBe(false);
  });

  it("a long-word valid brief with 'responsibilities' (16 chars) passes gibberish check", () => {
    const text = "We are evaluating whether to expand responsibilities for our team leaders.";
    const result = validateBriefPreflight(text);
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it("mixed valid and invalid tokens — short input with all-letter words passes exemption", () => {
    // 5 words all pure letters, low coverage, but short exemption should apply
    const text = "Should we acquire startup now";
    const result = validateBriefPreflight(text);
    // 'acquire' and 'startup' may not be in COMMON_WORDS but all tokens are pure letters
    const gibberishIssue = result.issues.find(i => i.code === "BRIEF_APPEARS_GIBBERISH");
    expect(gibberishIssue).toBeUndefined();
  });
});
