import { describe, it, expect } from "vitest";

import { BranchProbabilityValidator } from "../../src/cee/verification/validators/branch-probability-validator.js";

describe("BranchProbabilityValidator", () => {
  it("always skips — structural edges don't carry branch probabilities", async () => {
    // Decision→option edges are structural (belief_exists = 1.0 = existence
    // certainty). No dedicated branch-selection-probability field exists in
    // the current schema, so this validator is intentionally a no-op.
    const validator = new BranchProbabilityValidator();

    const result = await validator.validate({} as any);

    expect(result.valid).toBe(true);
    expect(result.stage).toBe("branch_probabilities");
    expect(result.skipped).toBe(true);
  });
});
