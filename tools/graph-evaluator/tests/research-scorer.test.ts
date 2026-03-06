import { describe, it, expect } from "vitest";
import { scoreResearch } from "../src/research-scorer.js";
import type { ResearchFixture } from "../src/types.js";

// =============================================================================
// Fixture factory
// =============================================================================

function makeFixture(overrides: Partial<ResearchFixture["expected"]> = {}): ResearchFixture {
  return {
    id: "rt-test",
    name: "Test fixture",
    description: "Test",
    query: "What is the average churn rate for SaaS companies?",
    context_hint: null,
    target_factor: null,
    expected: {
      min_findings_length: 50,
      min_source_count: 1,
      must_contain_keywords: ["churn", "SaaS"],
      expects_numeric_values: true,
      expects_confidence_note: true,
      forbidden_substrings: [],
      ...overrides,
    },
  };
}

function makeParsed(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    summary: "SaaS churn rates typically range from 1% to 5% monthly for B2B companies with annual contracts.",
    sources: [{ title: "Benchmark report", url: "https://example.com" }],
    confidence_note: "Web search results — verify before updating your model",
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("scoreResearch", () => {
  it("returns null score for null parsed", () => {
    const fixture = makeFixture();
    const result = scoreResearch(fixture, null);
    expect(result.valid_json).toBe(false);
    expect(result.overall).toBe(0);
  });

  it("returns null score when summary field is missing", () => {
    const fixture = makeFixture();
    const result = scoreResearch(fixture, { sources: [] });
    expect(result.valid_json).toBe(false);
    expect(result.overall).toBe(0);
  });

  it("scores a perfect response correctly", () => {
    const fixture = makeFixture();
    const parsed = makeParsed();
    const result = scoreResearch(fixture, parsed);
    expect(result.valid_json).toBe(true);
    expect(result.has_findings).toBe(true);
    expect(result.findings_length_met).toBe(true);
    expect(result.source_count_met).toBe(true);
    expect(result.keyword_coverage).toBe(true);
    expect(result.no_forbidden_substrings).toBe(true);
    expect(result.has_numeric_values).toBe(true);
    expect(result.has_confidence_note).toBe(true);
    expect(result.overall).toBeCloseTo(1.0, 5);
  });

  it("fails findings_length_met when summary is too short", () => {
    const fixture = makeFixture({ min_findings_length: 500 });
    const parsed = makeParsed();
    const result = scoreResearch(fixture, parsed);
    expect(result.findings_length_met).toBe(false);
    expect(result.overall).toBeLessThan(1.0);
  });

  it("fails source_count_met when sources are insufficient", () => {
    const fixture = makeFixture({ min_source_count: 3 });
    const parsed = makeParsed({ sources: [{ title: "One", url: "https://a.com" }] });
    const result = scoreResearch(fixture, parsed);
    expect(result.source_count_met).toBe(false);
  });

  it("passes source_count_met when min is 0 and sources is empty", () => {
    const fixture = makeFixture({ min_source_count: 0 });
    const parsed = makeParsed({ sources: [] });
    const result = scoreResearch(fixture, parsed);
    expect(result.source_count_met).toBe(true);
  });

  it("fails keyword_coverage when a keyword is missing", () => {
    const fixture = makeFixture({ must_contain_keywords: ["churn", "SaaS", "elasticity"] });
    const parsed = makeParsed();
    const result = scoreResearch(fixture, parsed);
    expect(result.keyword_coverage).toBe(false);
  });

  it("passes keyword_coverage when must_contain_keywords is empty", () => {
    const fixture = makeFixture({ must_contain_keywords: [] });
    const parsed = makeParsed({ summary: "Completely generic text." });
    const result = scoreResearch(fixture, parsed);
    expect(result.keyword_coverage).toBe(true);
  });

  it("fails no_forbidden_substrings when forbidden text is present", () => {
    const fixture = makeFixture({ forbidden_substrings: ["I don't know"] });
    const parsed = makeParsed({ summary: "I don't know the exact churn rate for SaaS companies." });
    const result = scoreResearch(fixture, parsed);
    expect(result.no_forbidden_substrings).toBe(false);
  });

  it("passes has_numeric_values when number present and expected", () => {
    const fixture = makeFixture({ expects_numeric_values: true });
    const parsed = makeParsed({ summary: "Churn is typically 3.5% per month." });
    const result = scoreResearch(fixture, parsed);
    expect(result.has_numeric_values).toBe(true);
  });

  it("fails has_numeric_values when no numbers present and expected", () => {
    const fixture = makeFixture({ expects_numeric_values: true });
    const parsed = makeParsed({ summary: "Churn affects many companies significantly." });
    const result = scoreResearch(fixture, parsed);
    expect(result.has_numeric_values).toBe(false);
  });

  it("passes has_numeric_values when not expected (regardless of content)", () => {
    const fixture = makeFixture({ expects_numeric_values: false });
    const parsed = makeParsed({ summary: "Churn affects many companies." });
    const result = scoreResearch(fixture, parsed);
    expect(result.has_numeric_values).toBe(true);
  });

  it("fails has_confidence_note when note missing and expected", () => {
    const fixture = makeFixture({ expects_confidence_note: true });
    const parsed = makeParsed({ confidence_note: undefined });
    const result = scoreResearch(fixture, parsed);
    expect(result.has_confidence_note).toBe(false);
  });

  it("passes has_confidence_note when not expected", () => {
    const fixture = makeFixture({ expects_confidence_note: false });
    const parsed = makeParsed({ confidence_note: undefined });
    const result = scoreResearch(fixture, parsed);
    expect(result.has_confidence_note).toBe(true);
  });
});
