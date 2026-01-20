import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveContext,
  detectDomain,
  loadContext,
  clearContextCache,
  formatGlossaryForPrompt,
  formatConstraintsForPrompt,
  formatContextForPrompt,
  extractNumericValues,
  validateAgainstBrief,
  findTermByAlias,
  expandAbbreviation,
} from "../../src/context/resolver.js";

describe("Context Resolver", () => {
  beforeEach(() => {
    clearContextCache();
  });

  afterEach(() => {
    clearContextCache();
  });

  describe("loadContext", () => {
    it("loads core context successfully", () => {
      const context = loadContext("core");
      expect(context).not.toBeNull();
      expect(context?.domain).toBe("core");
      expect(context?.glossary.length).toBeGreaterThan(10);
      expect(context?.constraint_patterns.length).toBeGreaterThan(5);
    });

    it("loads saas context successfully", () => {
      const context = loadContext("saas");
      expect(context).not.toBeNull();
      expect(context?.domain).toBe("saas");
      expect(context?.glossary.length).toBeGreaterThan(10);
    });

    it("returns null for non-existent domain", () => {
      const context = loadContext("nonexistent");
      expect(context).toBeNull();
    });

    it("caches loaded contexts", () => {
      const first = loadContext("core");
      const second = loadContext("core");
      expect(first).toBe(second); // Same reference
    });
  });

  describe("detectDomain", () => {
    it("detects SaaS domain from strong keywords", () => {
      // Strong keywords (weight=2) trigger detection on their own
      expect(detectDomain("We need to increase our MRR by 20%")).toBe("saas");
      expect(detectDomain("Our ARR is growing")).toBe("saas");
      expect(detectDomain("seat license pricing")).toBe("saas");
      expect(detectDomain("freemium conversion rate")).toBe("saas");
    });

    it("detects SaaS from multiple weak keywords", () => {
      // Two weak keywords (1 + 1 = 2) reach threshold
      expect(detectDomain("subscription with expansion revenue")).toBe("saas");
      expect(detectDomain("churn rate and upsell opportunities")).toBe("saas");
    });

    it("returns null for single weak keyword", () => {
      // Single weak keyword (weight=1) doesn't reach threshold of 2
      expect(detectDomain("subscription pricing model")).toBeNull();
      expect(detectDomain("generic churn discussion")).toBeNull();
    });

    it("returns null for generic briefs", () => {
      expect(detectDomain("We need to make a decision")).toBeNull();
      expect(detectDomain("What color should we paint the office?")).toBeNull();
      // Generic tech words no longer trigger SaaS detection
      expect(detectDomain("Our cloud platform is growing")).toBeNull();
    });

    it("handles case insensitivity", () => {
      expect(detectDomain("Our ARR is growing")).toBe("saas");
      expect(detectDomain("Our arr is growing")).toBe("saas");
      expect(detectDomain("Our Arr is growing")).toBe("saas");
    });

    it("uses word boundaries for short keywords", () => {
      // "arr" should not match within "warranty" or "array"
      expect(detectDomain("Check the warranty terms")).toBeNull();
      expect(detectDomain("The array contains data")).toBeNull();
      // But standalone "arr" should still match
      expect(detectDomain("Our ARR is $1M")).toBe("saas");
      // "mrr" should not match within "smrr"
      expect(detectDomain("The smrrg protocol")).toBeNull();
      expect(detectDomain("Our MRR is growing")).toBe("saas");
    });
  });

  describe("resolveContext", () => {
    it("always includes core context", () => {
      const result = resolveContext("Simple decision brief");
      expect(result.sources).toContain("core");
      expect(result.glossary.length).toBeGreaterThan(0);
    });

    it("auto-detects and includes SaaS context", () => {
      const result = resolveContext("We need to increase MRR and improve churn rates");
      expect(result.sources).toContain("core");
      expect(result.sources).toContain("saas");
      expect(result.domain).toBe("saas");
    });

    it("respects explicit domain override", () => {
      const result = resolveContext("Generic brief", "saas");
      expect(result.domain).toBe("saas");
      expect(result.sources).toContain("saas");
    });

    it("deduplicates glossary terms", () => {
      const result = resolveContext("SaaS pricing decision", "saas");
      const terms = result.glossary.map((t) => t.term.toLowerCase());
      const uniqueTerms = new Set(terms);
      expect(terms.length).toBe(uniqueTerms.size);
    });

    it("returns correct structure", () => {
      const result = resolveContext("Test brief");
      expect(result).toHaveProperty("domain");
      expect(result).toHaveProperty("glossary");
      expect(result).toHaveProperty("constraintPatterns");
      expect(result).toHaveProperty("sources");
      expect(Array.isArray(result.glossary)).toBe(true);
      expect(Array.isArray(result.constraintPatterns)).toBe(true);
      expect(Array.isArray(result.sources)).toBe(true);
    });
  });

  describe("formatGlossaryForPrompt", () => {
    it("formats glossary terms with aliases and units", () => {
      const glossary = [
        {
          term: "Annual Recurring Revenue",
          aliases: ["ARR"],
          definition: "Yearly subscription revenue",
          typical_unit: "$",
        },
      ];
      const formatted = formatGlossaryForPrompt(glossary);
      expect(formatted).toContain("## Business Glossary");
      expect(formatted).toContain("Annual Recurring Revenue");
      expect(formatted).toContain("(ARR)");
      expect(formatted).toContain("[$]");
      expect(formatted).toContain("Yearly subscription revenue");
    });

    it("returns empty string for empty glossary", () => {
      const formatted = formatGlossaryForPrompt([]);
      expect(formatted).toBe("");
    });
  });

  describe("formatConstraintsForPrompt", () => {
    it("formats constraint patterns", () => {
      const constraints = [
        {
          pattern: "budget",
          description: "Financial spending limit",
          operator: "max" as const,
          examples: ["budget of $500K"],
        },
      ];
      const formatted = formatConstraintsForPrompt(constraints);
      expect(formatted).toContain("## Constraint Patterns");
      expect(formatted).toContain("budget");
      expect(formatted).toContain("[max]");
      expect(formatted).toContain("Financial spending limit");
    });

    it("returns empty string for empty constraints", () => {
      const formatted = formatConstraintsForPrompt([]);
      expect(formatted).toBe("");
    });
  });

  describe("formatContextForPrompt", () => {
    it("combines glossary and constraints", () => {
      const context = resolveContext("SaaS pricing decision", "saas");
      const formatted = formatContextForPrompt(context);
      expect(formatted).toContain("# Market Context");
      expect(formatted).toContain("## Business Glossary");
      expect(formatted).toContain("## Constraint Patterns");
    });
  });

  describe("extractNumericValues", () => {
    it("extracts currency values", () => {
      const values = extractNumericValues("Budget is $500K");
      expect(values).toContain(500000);
    });

    it("extracts currency with multipliers", () => {
      const values = extractNumericValues("Revenue of $1M and costs of $500K");
      expect(values).toContain(1000000);
      expect(values).toContain(500000);
    });

    it("extracts percentages", () => {
      const values = extractNumericValues("Growth rate of 25%");
      expect(values).toContain(25);
    });

    it("extracts plain numbers", () => {
      const values = extractNumericValues("We have 100 users");
      expect(values).toContain(100);
    });

    it("handles multiple values", () => {
      const values = extractNumericValues("From $100 to $200 with 5% growth");
      expect(values.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("validateAgainstBrief", () => {
    it("validates values that appear in brief", () => {
      const brief = "Budget is $500K with 10% contingency";
      const result = validateAgainstBrief([500000, 10], brief);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("warns about values not in brief", () => {
      const brief = "Budget is $500K";
      const result = validateAgainstBrief([500000, 999999], brief);
      expect(result.isValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("999999");
    });

    it("handles close matches for floating point", () => {
      const brief = "Rate is 0.05";
      const result = validateAgainstBrief([0.0500001], brief);
      expect(result.validatedValues[0].foundInBrief).toBe(true);
    });
  });

  describe("findTermByAlias", () => {
    it("finds term by exact name", () => {
      const context = resolveContext("Test", "core");
      const term = findTermByAlias(context, "Annual Recurring Revenue");
      expect(term).not.toBeNull();
      expect(term?.term).toBe("Annual Recurring Revenue");
    });

    it("finds term by alias", () => {
      const context = resolveContext("Test", "core");
      const term = findTermByAlias(context, "ARR");
      expect(term).not.toBeNull();
      expect(term?.term).toBe("Annual Recurring Revenue");
    });

    it("is case insensitive", () => {
      const context = resolveContext("Test", "core");
      const term = findTermByAlias(context, "arr");
      expect(term).not.toBeNull();
    });

    it("returns null for unknown term", () => {
      const context = resolveContext("Test", "core");
      const term = findTermByAlias(context, "NonexistentTerm");
      expect(term).toBeNull();
    });
  });

  describe("expandAbbreviation", () => {
    it("expands known abbreviations", () => {
      const context = resolveContext("Test", "core");
      expect(expandAbbreviation(context, "ARR")).toBe("Annual Recurring Revenue");
      expect(expandAbbreviation(context, "MRR")).toBe("Monthly Recurring Revenue");
    });

    it("returns original if no match", () => {
      const context = resolveContext("Test", "core");
      expect(expandAbbreviation(context, "UNKNOWN")).toBe("UNKNOWN");
    });

    it("handles case insensitivity", () => {
      const context = resolveContext("Test", "core");
      expect(expandAbbreviation(context, "arr")).toBe("Annual Recurring Revenue");
    });
  });
});
