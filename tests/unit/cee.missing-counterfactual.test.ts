import { describe, it, expect } from "vitest";
import { detectMissingCounterfactual } from "../../src/cee/structure/index.js";

/**
 * Helper: build a minimal graph with option nodes.
 */
function makeGraph(
  options: Array<{ id: string; label: string; data?: Record<string, unknown> }>,
) {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Choose strategy" },
      ...options.map((o) => ({ id: o.id, kind: "option", label: o.label, data: o.data })),
      { id: "goal_1", kind: "goal", label: "Revenue" },
    ],
    edges: options.map((o) => ({ from: "dec_1", to: o.id })),
  } as any;
}

describe("detectMissingCounterfactual", () => {
  it("emits no critique when an option is labelled 'Keep current pricing'", () => {
    const graph = makeGraph([
      { id: "opt_a", label: "Raise prices" },
      { id: "opt_b", label: "Keep current pricing" },
    ]);

    const result = detectMissingCounterfactual(graph);
    expect(result.detected).toBe(false);
    expect(result.hasCounterfactual).toBe(true);
  });

  it("emits critique when no status quo option exists", () => {
    const graph = makeGraph([
      { id: "opt_a", label: "Raise prices" },
      { id: "opt_b", label: "Lower prices" },
    ]);

    const result = detectMissingCounterfactual(graph);
    expect(result.detected).toBe(true);
    expect(result.hasCounterfactual).toBe(false);
    // Canonical critique pipeline shape (type: uppercase, severity: "info")
    expect(result.validationIssue).toBeDefined();
    expect(result.validationIssue!.code).toBe("MISSING_COUNTERFACTUAL");
    expect(result.validationIssue!.severity).toBe("info");
    expect(result.validationIssue!.message).toContain("do nothing");
  });

  it("emits no critique for 'Status Quo' (case-insensitive)", () => {
    const graph = makeGraph([
      { id: "opt_a", label: "Raise prices" },
      { id: "opt_b", label: "Status Quo" },
    ]);

    const result = detectMissingCounterfactual(graph);
    expect(result.detected).toBe(false);
    expect(result.hasCounterfactual).toBe(true);
  });

  it("emits no critique for natural phrasing 'leave things as they are'", () => {
    const graph = makeGraph([
      { id: "opt_a", label: "Raise prices" },
      { id: "opt_b", label: "Leave things as they are" },
    ]);

    const result = detectMissingCounterfactual(graph);
    expect(result.detected).toBe(false);
    expect(result.hasCounterfactual).toBe(true);
  });

  it("does not false-positive on 'Improve baseline forecast'", () => {
    // "baseline" in a compound label is not a status quo option —
    // it refers to the forecast methodology, not 'do nothing'.
    // matchesStatusQuoLabel intentionally excludes bare "baseline" substring
    // to avoid this false positive.
    const graph = makeGraph([
      { id: "opt_a", label: "Improve baseline forecast" },
      { id: "opt_b", label: "Switch to ensemble model" },
    ]);

    const result = detectMissingCounterfactual(graph);
    // "Improve baseline forecast" should NOT match — it's not a status quo option.
    // Our patterns don't include bare "baseline" (excluded for false-positive resistance).
    expect(result.detected).toBe(true);
    expect(result.hasCounterfactual).toBe(false);
  });

  it("checks is_status_quo flag before label matching", () => {
    const graph = makeGraph([
      { id: "opt_a", label: "Raise prices" },
      { id: "opt_b", label: "Custom approach", data: { is_status_quo: true } },
    ]);

    const result = detectMissingCounterfactual(graph);
    // is_status_quo flag should be detected even though label doesn't match
    expect(result.detected).toBe(false);
    expect(result.hasCounterfactual).toBe(true);
  });
});
