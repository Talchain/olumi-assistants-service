import { describe, it, expect } from "vitest";

import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { BranchProbabilityValidator } from "../../src/cee/verification/validators/branch-probability-validator.js";

function makeGraph(partial: Partial<GraphV1>): GraphV1 {
  return {
    version: "1",
    default_seed: 17,
    nodes: [],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    ...(partial as any),
  } as GraphV1;
}

describe("BranchProbabilityValidator", () => {
  it("skips when payload has no graph", async () => {
    const validator = new BranchProbabilityValidator();

    const result = await validator.validate({} as any);

    expect(result.valid).toBe(true);
    expect(result.stage).toBe("branch_probabilities");
    expect(result.skipped).toBe(true);
  });

  it("passes when decision branches are already normalised", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal" } as any,
        { id: "dec_1", kind: "decision" } as any,
        { id: "opt_1", kind: "option" } as any,
        { id: "opt_2", kind: "option" } as any,
      ],
      edges: [
        { from: "goal_1", to: "dec_1" } as any,
        { from: "dec_1", to: "opt_1", belief: 0.3 } as any,
        { from: "dec_1", to: "opt_2", belief: 0.7 } as any,
      ],
    });

    const validator = new BranchProbabilityValidator();
    const result = await validator.validate({ graph } as any);

    expect(result.valid).toBe(true);
    expect(result.stage).toBe("branch_probabilities");
    expect(result.skipped).not.toBe(true);
    expect(result.severity).toBeUndefined();
    expect(result.code).toBeUndefined();
  });

  it("emits a warning when decision branches are not normalised", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal" } as any,
        { id: "dec_1", kind: "decision" } as any,
        { id: "opt_1", kind: "option" } as any,
        { id: "opt_2", kind: "option" } as any,
      ],
      edges: [
        { from: "goal_1", to: "dec_1" } as any,
        { from: "dec_1", to: "opt_1", belief: 0.7 } as any,
        { from: "dec_1", to: "opt_2", belief: 0.7 } as any,
      ],
    });

    const validator = new BranchProbabilityValidator();
    const result = await validator.validate({ graph } as any);

    expect(result.valid).toBe(true);
    expect(result.stage).toBe("branch_probabilities");
    expect(result.severity).toBe("warning");
    expect(result.code).toBe("BRANCH_PROBABILITIES_UNNORMALIZED");
    expect(result.message).toMatch(/do not sum to 1.0/i);
    expect(result.details).toBeDefined();
    const details = result.details as any;
    expect(details.total_decisions_with_issue).toBeGreaterThanOrEqual(1);
  });
});
