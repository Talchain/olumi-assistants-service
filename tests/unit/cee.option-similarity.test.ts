import { describe, it, expect } from "vitest";
import { detectOptionSimilarity } from "../../src/cee/structure/index.js";

/**
 * Helper: build a minimal graph with option + factor nodes and edges.
 * Uses `as any` because GraphV1 is loosely typed in the detection functions.
 */
function makeGraph(
  options: Array<{ id: string; label: string }>,
  factors: Array<{ id: string; label: string }>,
  edges: Array<{ from: string; to: string }>,
) {
  return {
    nodes: [
      ...options.map((o) => ({ id: o.id, kind: "option", label: o.label })),
      ...factors.map((f) => ({ id: f.id, kind: "factor", label: f.label })),
      { id: "goal_1", kind: "goal", label: "Revenue" },
    ],
    edges,
  } as any;
}

describe("detectOptionSimilarity", () => {
  it("emits critique when two options have identical edge targets (Jaccard 1.0)", () => {
    const graph = makeGraph(
      [
        { id: "opt_a", label: "Option A" },
        { id: "opt_b", label: "Option B" },
      ],
      [
        { id: "fac_1", label: "Price" },
        { id: "fac_2", label: "Volume" },
      ],
      [
        { from: "opt_a", to: "fac_1" },
        { from: "opt_a", to: "fac_2" },
        { from: "opt_b", to: "fac_1" },
        { from: "opt_b", to: "fac_2" },
      ],
    );

    const result = detectOptionSimilarity(graph);
    expect(result.detected).toBe(true);
    expect(result.critiques).toHaveLength(1);
    expect(result.critiques[0].jaccard).toBe(1.0);
    // Legacy warnings no longer populated — critiques emit via validationIssues only
    expect(result.warnings).toHaveLength(0);
    // Canonical critique pipeline shape (type: uppercase, severity: "info")
    expect(result.validationIssues).toHaveLength(1);
    expect(result.validationIssues[0].code).toBe("OPTION_SIMILARITY");
    expect(result.validationIssues[0].severity).toBe("info");
    expect(result.validationIssues[0].message).toContain("Option A");
    expect(result.validationIssues[0].message).toContain("Option B");
  });

  it("emits no critique when options have completely different targets", () => {
    const graph = makeGraph(
      [
        { id: "opt_a", label: "Option A" },
        { id: "opt_b", label: "Option B" },
      ],
      [
        { id: "fac_1", label: "Price" },
        { id: "fac_2", label: "Volume" },
        { id: "fac_3", label: "Churn" },
        { id: "fac_4", label: "Brand" },
      ],
      [
        { from: "opt_a", to: "fac_1" },
        { from: "opt_a", to: "fac_2" },
        { from: "opt_b", to: "fac_3" },
        { from: "opt_b", to: "fac_4" },
      ],
    );

    const result = detectOptionSimilarity(graph);
    expect(result.detected).toBe(false);
    expect(result.critiques).toHaveLength(0);
  });

  it("emits one critique for 3 options with one similar pair", () => {
    const graph = makeGraph(
      [
        { id: "opt_a", label: "Option A" },
        { id: "opt_b", label: "Option B" },
        { id: "opt_c", label: "Option C" },
      ],
      [
        { id: "fac_1", label: "Price" },
        { id: "fac_2", label: "Volume" },
        { id: "fac_3", label: "Churn" },
      ],
      [
        // A and B share identical targets → Jaccard 1.0
        { from: "opt_a", to: "fac_1" },
        { from: "opt_a", to: "fac_2" },
        { from: "opt_b", to: "fac_1" },
        { from: "opt_b", to: "fac_2" },
        // C is different
        { from: "opt_c", to: "fac_3" },
      ],
    );

    const result = detectOptionSimilarity(graph);
    expect(result.detected).toBe(true);
    // Only A-B pair meets threshold; A-C and B-C do not
    expect(result.critiques).toHaveLength(1);
    expect(result.critiques[0].optionA).toBe("opt_a");
    expect(result.critiques[0].optionB).toBe("opt_b");
  });

  it("deduplicates edges before comparison", () => {
    const graph = makeGraph(
      [
        { id: "opt_a", label: "Option A" },
        { id: "opt_b", label: "Option B" },
      ],
      [
        { id: "fac_1", label: "Price" },
        { id: "fac_2", label: "Volume" },
        { id: "fac_3", label: "Churn" },
      ],
      [
        // A has duplicate edges to fac_1 — should be deduped to {fac_1, fac_2}
        { from: "opt_a", to: "fac_1" },
        { from: "opt_a", to: "fac_1" },
        { from: "opt_a", to: "fac_2" },
        // B targets {fac_1, fac_2, fac_3} → Jaccard = 2/3 ≈ 0.67 < 0.8
        { from: "opt_b", to: "fac_1" },
        { from: "opt_b", to: "fac_2" },
        { from: "opt_b", to: "fac_3" },
      ],
    );

    const result = detectOptionSimilarity(graph);
    // After dedup: A={fac_1,fac_2}, B={fac_1,fac_2,fac_3} → Jaccard = 2/3 < 0.8
    expect(result.detected).toBe(false);
  });

  it("emits no critique when both options have zero factor edges", () => {
    const graph = makeGraph(
      [
        { id: "opt_a", label: "Option A" },
        { id: "opt_b", label: "Option B" },
      ],
      [{ id: "fac_1", label: "Price" }],
      // No edges from options to factors
      [],
    );

    const result = detectOptionSimilarity(graph);
    // Jaccard is undefined for empty sets — no critique
    expect(result.detected).toBe(false);
    expect(result.critiques).toHaveLength(0);
  });

  it("emits no critique when options share 1 of 4 factors (low Jaccard ~0.25)", () => {
    const graph = makeGraph(
      [
        { id: "opt_a", label: "Option A" },
        { id: "opt_b", label: "Option B" },
      ],
      [
        { id: "fac_1", label: "Shared factor" },
        { id: "fac_2", label: "A only 1" },
        { id: "fac_3", label: "B only 1" },
        { id: "fac_4", label: "B only 2" },
        { id: "fac_5", label: "B only 3" },
      ],
      [
        // A targets {fac_1, fac_2}
        { from: "opt_a", to: "fac_1" },
        { from: "opt_a", to: "fac_2" },
        // B targets {fac_1, fac_3, fac_4, fac_5}
        { from: "opt_b", to: "fac_1" },
        { from: "opt_b", to: "fac_3" },
        { from: "opt_b", to: "fac_4" },
        { from: "opt_b", to: "fac_5" },
      ],
    );

    const result = detectOptionSimilarity(graph);
    // intersection = {fac_1}, union = {fac_1..fac_5} → Jaccard = 1/5 = 0.2
    expect(result.detected).toBe(false);
    expect(result.critiques).toHaveLength(0);
  });

  it("caps at 2 critiques sorted by descending Jaccard when >2 pairs exceed threshold", () => {
    // 4 options: A, B, C, D — all share the same 2 factors but with varying overlap
    // A={fac_1,fac_2}, B={fac_1,fac_2}, C={fac_1,fac_2,fac_3}, D={fac_1,fac_2,fac_3}
    // Pairs exceeding 0.8:
    //   A-B: Jaccard = 2/2 = 1.0
    //   C-D: Jaccard = 3/3 = 1.0
    //   A-C: Jaccard = 2/3 ≈ 0.67 (below threshold)
    //   A-D: Jaccard = 2/3 ≈ 0.67 (below threshold)
    //   B-C: Jaccard = 2/3 ≈ 0.67 (below threshold)
    //   B-D: Jaccard = 2/3 ≈ 0.67 (below threshold)
    // → Only 2 pairs exceed threshold, both at Jaccard 1.0.
    // Now adjust so 3 pairs exceed: make E share all of A's targets plus one extra
    const graph = makeGraph(
      [
        { id: "opt_a", label: "Option A" },
        { id: "opt_b", label: "Option B" },
        { id: "opt_c", label: "Option C" },
        { id: "opt_d", label: "Option D" },
      ],
      [
        { id: "fac_1", label: "Factor 1" },
        { id: "fac_2", label: "Factor 2" },
        { id: "fac_3", label: "Factor 3" },
        { id: "fac_4", label: "Factor 4" },
        { id: "fac_5", label: "Factor 5" },
      ],
      [
        // A={fac_1,fac_2,fac_3,fac_4,fac_5}
        { from: "opt_a", to: "fac_1" },
        { from: "opt_a", to: "fac_2" },
        { from: "opt_a", to: "fac_3" },
        { from: "opt_a", to: "fac_4" },
        { from: "opt_a", to: "fac_5" },
        // B={fac_1,fac_2,fac_3,fac_4,fac_5} → A-B Jaccard = 1.0
        { from: "opt_b", to: "fac_1" },
        { from: "opt_b", to: "fac_2" },
        { from: "opt_b", to: "fac_3" },
        { from: "opt_b", to: "fac_4" },
        { from: "opt_b", to: "fac_5" },
        // C={fac_1,fac_2,fac_3,fac_4} → A-C = 4/5 = 0.8, B-C = 4/5 = 0.8
        { from: "opt_c", to: "fac_1" },
        { from: "opt_c", to: "fac_2" },
        { from: "opt_c", to: "fac_3" },
        { from: "opt_c", to: "fac_4" },
        // D={fac_1,fac_2,fac_3} → A-D = 3/5 = 0.6 (below), C-D = 3/4 = 0.75 (below)
        { from: "opt_d", to: "fac_1" },
        { from: "opt_d", to: "fac_2" },
        { from: "opt_d", to: "fac_3" },
      ],
    );

    const result = detectOptionSimilarity(graph);
    expect(result.detected).toBe(true);
    // 3 pairs exceed threshold: A-B (1.0), A-C (0.8), B-C (0.8)
    // Cap at 2, sorted by descending Jaccard
    expect(result.critiques).toHaveLength(2);
    // First: A-B with Jaccard 1.0
    expect(result.critiques[0].jaccard).toBe(1.0);
    expect(result.critiques[0].optionA).toBe("opt_a");
    expect(result.critiques[0].optionB).toBe("opt_b");
    // Second: one of the 0.8 pairs
    expect(result.critiques[1].jaccard).toBe(0.8);
    // validationIssues also capped at 2
    expect(result.validationIssues).toHaveLength(2);
    expect(result.validationIssues[0].code).toBe("OPTION_SIMILARITY");
    expect(result.validationIssues[1].code).toBe("OPTION_SIMILARITY");
  });
});
