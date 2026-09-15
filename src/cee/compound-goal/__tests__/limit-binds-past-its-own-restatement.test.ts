import { describe, it, expect } from "vitest";
import { remapConstraintTargets, type ExtractedGoalConstraint } from "../extractor.js";

/**
 * A stated limit must still bind when the draft has ALSO minted a node whose
 * label is the limit sentence itself.
 *
 * WIRE-MEASURED on serving build 07da2c0b, 4 of 4 pricing runs: the row is
 * extracted correctly (fac_churn <= 0.07) and then dropped at target binding,
 * because `fuzzyMatchNodeId` binds only on a UNIQUE match and the
 * self-referential node matches the same predicate as the real metric.
 *
 * This is a DISCRIMINATING PAIR, not a single assertion: same code, one node
 * different. Without the restatement node the row must bind (proves the fixture
 * can bind at all); with it the row must STILL bind (proves the fix). A single
 * arm would pass on a fixture that binds for the wrong reason.
 */
const CHURN_LIMIT: ExtractedGoalConstraint = {
  targetName: "Churn",
  targetNodeId: "fac_churn",
  operator: "<=",
  value: 0.07,
  unit: "%",
  label: "Churn at most 7%",
  sourceQuote: "Churn must not exceed 7% for more than 3 months",
  confidence: 0.9,
  provenance: "explicit",
  valueFrame: "proportion",
} as ExtractedGoalConstraint;

const REAL_METRIC = ["fac_sub_churn", "Subscriber Churn Rate"] as const;
const OTHERS: ReadonlyArray<readonly [string, string]> = [
  ["fac_cash", "Cash Flow Pressure"],
  ["fac_mrr", "MRR"],
  ["opt_rise", "Price Increase"],
];
const RESTATEMENT = ["risk_churn_limit", "Churn must not exceed 7% for more than 3 months"] as const;

function bind(pairs: ReadonlyArray<readonly [string, string]>) {
  const labels = new Map(pairs.map(([id, l]) => [id, l]));
  return remapConstraintTargets([CHURN_LIMIT], pairs.map(([id]) => id), labels, "test-req");
}

describe("a stated limit binds past the node that merely restates it", () => {
  it("CONTROL — binds when the draft did NOT mint a restatement node", () => {
    const r = bind([REAL_METRIC, ...OTHERS]);
    expect(r.constraints).toHaveLength(1);
    expect(r.constraints[0]!.targetNodeId).toBe("fac_sub_churn");
  });

  it("⛔ THE DEFECT — still binds when the draft DID mint one", () => {
    const r = bind([REAL_METRIC, ...OTHERS, RESTATEMENT]);
    expect(r.constraints).toHaveLength(1);
    // IDENTITY, not a value predicate: it must bind to the METRIC, never to
    // the node that restates the limit.
    expect(r.constraints[0]!.targetNodeId).toBe("fac_sub_churn");
  });

  it("does not filter down to nothing when every label looks self-referential", () => {
    const r = bind([RESTATEMENT]);
    // The exclusion must not be able to empty the candidate set; behaviour here
    // is whatever the unfiltered matcher does, never a crash.
    expect(Array.isArray(r.constraints)).toBe(true);
  });
});
