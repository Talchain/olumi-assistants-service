/**
 * Risks & Actions Validation Tests (v1.5.0 - PR J)
 */

import { describe, it, expect } from "vitest";
import { validateRisksAndActions, hasRisksOrActions } from "../../src/utils/risk-action-validation.js";

describe("Risks & Actions Validation (v1.5.0)", () => {
  it("validates risk nodes with labels", () => {
    const graph = {
      version: "v2",
      default_seed: 42,
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      nodes: [
        { id: "risk_1", kind: "risk" as const, label: "Data breach risk" },
      ],
      edges: [],
    };

    const issues = validateRisksAndActions(graph);

    const labelIssues = issues.filter(i => i.message.includes("label"));
    expect(labelIssues).toHaveLength(0);
  });

  it("warns about isolated risk nodes", () => {
    const graph = {
      version: "v2",
      default_seed: 42,
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      nodes: [
        { id: "risk_1", kind: "risk" as const, label: "Risk" },
      ],
      edges: [],
    };

    const issues = validateRisksAndActions(graph);

    expect(issues.some(i => i.message.includes("isolated"))).toBe(true);
  });

  it("suggests actions for risks", () => {
    const graph = {
      version: "v2",
      default_seed: 42,
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      nodes: [
        { id: "risk_1", kind: "risk" as const, label: "Risk 1" },
        { id: "risk_2", kind: "risk" as const, label: "Risk 2" },
      ],
      edges: [],
    };

    const issues = validateRisksAndActions(graph);

    expect(issues.some(i => i.message.includes("no mitigation actions"))).toBe(true);
  });

  it("detects risks and actions", () => {
    const graph1 = {
      version: "v2",
      default_seed: 42,
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      nodes: [
        { id: "goal_1", kind: "goal" as const, label: "Goal" },
      ],
      edges: [],
    };

    expect(hasRisksOrActions(graph1)).toBe(false);

    const graph2 = {
      ...graph1,
      nodes: [
        { id: "risk_1", kind: "risk" as const, label: "Risk" },
      ],
    };

    expect(hasRisksOrActions(graph2)).toBe(true);
  });
});
