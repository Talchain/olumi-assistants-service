/**
 * Label cleaning — unit tests for normalisation annotation stripping.
 *
 * Verifies that `cleanNodeLabel` strips LLM-injected normalisation metadata
 * from factor labels while preserving legitimate parenthetical content.
 */
import { describe, it, expect } from "vitest";
import {
  cleanNodeLabel,
  transformNodeToV3,
  type LabelCleaningEntry,
} from "../../src/cee/transforms/schema-v3.js";

// ============================================================================
// cleanNodeLabel — direct unit tests
// ============================================================================

describe("cleanNodeLabel", () => {
  it("strips '(0–1, share of $50k cap)' annotation", () => {
    const { label, entry } = cleanNodeLabel("annual_cost", "Annual Cost (0–1, share of $50k cap)");
    expect(label).toBe("Annual Cost");
    expect(entry).not.toBeNull();
    expect(entry!.original).toBe("Annual Cost (0–1, share of $50k cap)");
    expect(entry!.cleaned).toBe("Annual Cost");
    expect(entry!.node_id).toBe("annual_cost");
  });

  it("strips '(0/1)' annotation", () => {
    const { label } = cleanNodeLabel("market_share", "Market Share (0/1)");
    expect(label).toBe("Market Share");
  });

  it("strips '(0-1 normalised)' annotation", () => {
    const { label } = cleanNodeLabel("x", "Revenue (0-1 normalised)");
    expect(label).toBe("Revenue");
  });

  it("strips '(0–1 scale)' annotation", () => {
    const { label } = cleanNodeLabel("x", "Score (0–1 scale)");
    expect(label).toBe("Score");
  });

  it("strips '(normalised)' annotation", () => {
    const { label } = cleanNodeLabel("x", "Revenue Growth (normalised)");
    expect(label).toBe("Revenue Growth");
  });

  it("strips '(normalized)' annotation (US spelling)", () => {
    const { label } = cleanNodeLabel("x", "Revenue Growth (normalized)");
    expect(label).toBe("Revenue Growth");
  });

  it("strips '(scale 0 to 1)' annotation", () => {
    const { label } = cleanNodeLabel("x", "Risk Level (scale 0 to 1)");
    expect(label).toBe("Risk Level");
  });

  it("strips '(scale 0-10)' annotation", () => {
    const { label } = cleanNodeLabel("x", "Rating (scale 0-10)");
    expect(label).toBe("Rating");
  });

  // ── Legitimate parentheticals must survive ─────────────────────────

  it("preserves '(Q4)' — legitimate time qualifier", () => {
    const { label, entry } = cleanNodeLabel("x", "Revenue (Q4)");
    expect(label).toBe("Revenue (Q4)");
    expect(entry).toBeNull();
  });

  it("preserves '(annual)' — legitimate qualifier", () => {
    const { label, entry } = cleanNodeLabel("x", "Revenue (annual)");
    expect(label).toBe("Revenue (annual)");
    expect(entry).toBeNull();
  });

  it("preserves '(UK)' — legitimate locale qualifier", () => {
    const { label, entry } = cleanNodeLabel("x", "Market Size (UK)");
    expect(label).toBe("Market Size (UK)");
    expect(entry).toBeNull();
  });

  it("preserves '(in millions)' — legitimate unit qualifier", () => {
    const { label, entry } = cleanNodeLabel("x", "Revenue (in millions)");
    expect(label).toBe("Revenue (in millions)");
    expect(entry).toBeNull();
  });

  it("preserves '(0-100 range)' — legitimate bounded range, not 0-1 normalisation", () => {
    const { label, entry } = cleanNodeLabel("x", "Rating (0-100 range)");
    expect(label).toBe("Rating (0-100 range)");
    expect(entry).toBeNull();
  });

  it("preserves '(0-10 rating)' — legitimate non-normalisation range", () => {
    const { label, entry } = cleanNodeLabel("x", "NPS (0-10 rating)");
    expect(label).toBe("NPS (0-10 rating)");
    expect(entry).toBeNull();
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  it("returns unchanged label when no annotation present", () => {
    const { label, entry } = cleanNodeLabel("x", "Customer Satisfaction");
    expect(label).toBe("Customer Satisfaction");
    expect(entry).toBeNull();
  });

  it("returns unchanged label for 'Price Point'", () => {
    const { label, entry } = cleanNodeLabel("x", "Price Point");
    expect(label).toBe("Price Point");
    expect(entry).toBeNull();
  });

  it("never produces an empty label", () => {
    // Pathological case: label is entirely an annotation
    const { label } = cleanNodeLabel("x", "(0-1)");
    expect(label.length).toBeGreaterThan(0);
  });

  it("collapses double internal whitespace after stripping", () => {
    // "Cost  Factor" after stripping should become "Cost Factor"
    const { label } = cleanNodeLabel("x", "Cost (0-1 normalised) Factor");
    expect(label).toBe("Cost Factor");
    expect(label).not.toContain("  ");
  });
});

// ============================================================================
// transformNodeToV3 — label cleaning trace integration
// ============================================================================

describe("transformNodeToV3 label cleaning trace", () => {
  const makeNode = (id: string, label: string) => ({
    id,
    kind: "factor" as const,
    label,
    body: "test description",
    data: undefined as any,
  });

  it("populates trace when annotation is stripped", () => {
    const trace: LabelCleaningEntry[] = [];
    const node = makeNode("cost", "Annual Cost (0–1, share of $50k cap)");
    const v3 = transformNodeToV3(node as any, new Set(), trace);

    expect(v3.label).toBe("Annual Cost");
    expect(trace).toHaveLength(1);
    expect(trace[0].original).toBe("Annual Cost (0–1, share of $50k cap)");
    expect(trace[0].cleaned).toBe("Annual Cost");
  });

  it("does not populate trace when no stripping needed", () => {
    const trace: LabelCleaningEntry[] = [];
    const node = makeNode("satisfaction", "Customer Satisfaction");
    transformNodeToV3(node as any, new Set(), trace);

    expect(trace).toHaveLength(0);
  });

  it("works without trace array (backward compatible)", () => {
    const node = makeNode("cost", "Annual Cost (0/1)");
    const v3 = transformNodeToV3(node as any, new Set());
    expect(v3.label).toBe("Annual Cost");
  });
});
