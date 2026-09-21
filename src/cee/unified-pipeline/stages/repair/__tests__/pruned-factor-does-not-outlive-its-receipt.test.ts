/**
 * A RECEIPT MUST NOT OUTLIVE THE NODE IT DESCRIBES.
 *
 * ── THE LIVE DEFECT THIS PINS ──────────────────────────────────────────────
 * Persisted trace, 2026-08-29 16:40:05.093 — four stages, one millisecond:
 *
 *   1. `cee.simple_repair.invalid_edges_removed`
 *      removed {from:"factor_budget_0", to:"f9579b4f"}, pattern "factor→decision"
 *   2. `SIMPLE_REPAIR_UNREACHABLE_FACTORS_PRESERVED`
 *      "Preserved 1 unreachable factor(s) (protected kind)"
 *   3. "Pruning isolated nodes (goal/decision/option/outcome/risk protected)"
 *      isolated_ids:["factor_budget_0"] pruned_count:0 protected_count:1
 *   4. `cee.deterministic_sweep.observable_pruned` category:"external"
 *
 * The user had written "our budget is £200,000". Stage 2 stripped the magnitude
 * (`previous_raw_value: 200000`, `previous_unit: "£"`, `previous_cap: 1000000`)
 * and wrote the user a receipt for it — the ONE sweep repair that reaches the
 * user as a `model_adjustments` row (`boundary.ts:43`):
 *
 *   "Reclassified unreachable factor "Budget" to external with synthesised
 *    prior [0.1, 0.3]. The extracted value £200,000 is not used in the maths
 *    — the range shown is a placeholder"
 *
 * Stage 4 then DELETED the node. Node count 15 → 14. So the shipped, live,
 * user-visible sentence promises a placeholder range for a factor that no
 * longer exists — there is no range, no node, and nothing the user can act on.
 * **The receipt survived its own subject.**
 *
 * ── WHAT IS AND IS NOT FIXED HERE, STATED PLAINLY ──────────────────────────
 * FIXED: the sentence. When the prune invalidates a receipt this same sweep
 * wrote, the prune amends it, so one channel carries one true account.
 *
 * NOT FIXED, AND DELIBERATELY SO: the magnitude is still destroyed and the node
 * is still removed. RETAINING the node was built and MEASURED first, over the
 * 14-draw governed baseline, and rejected on its own evidence — orphan counts
 * 0 → 5/5/8 on three briefs, factor counts roughly doubled (05-product-feature
 * 5→10, 07-cloud-migration 7→12, 10-many-observables 7→15) and post-repair
 * quality 164 → 159 of 246 on `D5.1-no-orphan-nodes` and
 * `D5.2-no-connectivity-errors`. Magnitude destruction is widespread in that
 * corpus, so no predicate wide enough to catch the £200,000 leaves the canvas
 * readable. That fix belongs at the seam that destroys the value or fails to
 * wire the factor, and is left named rather than smuggled in here.
 *
 * ⚠ THE PHRASING IS LOAD-BEARING, for the reason `unreachable-factors.ts:793`
 * gives on the sentence this amends: the figure was extracted by the pipeline,
 * so it must not be attributed to the user, and it must survive the deployed
 * UI's `sanitiseDetail()`, which strips parenthesised bare numbers. The
 * amendment adds no new figure — it only corrects the claim about the range —
 * so it cannot introduce either fault.
 */
import { describe, it, expect } from "vitest";
import { fixDisconnectedObservables } from "../deterministic-sweep.js";

const RECEIPT =
  'Reclassified unreachable factor "Budget" to external with synthesised prior ' +
  "[0.1, 0.30000000000000004]. The extracted value £200,000 is not used in the maths" +
  " — the range shown is a placeholder";

/** The live trace's node, rebuilt by IDENTITY (id + label + category). */
function budgetGraph(): any {
  return {
    nodes: [
      { id: "goal_0", kind: "goal", label: "Grow revenue" },
      { id: "f9579b4f", kind: "decision", label: "Which plan" },
      // `external` was assigned by `handleUnreachableFactors`, not by the user.
      { id: "factor_budget_0", kind: "factor", label: "Budget", category: "external" },
    ],
    edges: [], // the factor→decision edge was removed one stage earlier
  };
}

const receipt = () => ({
  code: "UNREACHABLE_FACTOR_RECLASSIFIED",
  path: "nodes[factor_budget_0].category",
  action: RECEIPT,
});

describe("the prune corrects the receipt it invalidates", () => {
  it("no longer promises a placeholder range for a node it deleted", () => {
    const graph = budgetGraph();
    const priorRepairs = [receipt()];

    const result = fixDisconnectedObservables(graph, priorRepairs);

    // The node is still pruned — this fix does not change topology.
    expect(result.pruned).toContain("factor_budget_0");
    // …and the sentence the user reads no longer claims a range is shown.
    expect(priorRepairs[0]!.action).not.toContain("the range shown is a placeholder");
    expect(priorRepairs[0]!.action).toContain("removed from the model");
    expect(priorRepairs[0]!.action).toContain("no range is shown");
  });

  it("keeps the user's figure in the corrected sentence", () => {
    const priorRepairs = [receipt()];
    fixDisconnectedObservables(budgetGraph(), priorRepairs);
    // The £200,000 is the whole point of the receipt and must survive the edit.
    expect(priorRepairs[0]!.action).toContain("£200,000");
  });

  it("does not attribute the extracted figure to the user", () => {
    const priorRepairs = [receipt()];
    fixDisconnectedObservables(budgetGraph(), priorRepairs);
    expect(priorRepairs[0]!.action).not.toMatch(/you stated|you told us|your figure/i);
  });

  // ── TWINS ────────────────────────────────────────────────────────────────
  it("TWIN: leaves the receipt ALONE when the node was NOT pruned", () => {
    const graph = budgetGraph();
    // Give the factor an edge, so the prune has no business with it.
    graph.edges = [{ id: "e1", from: "factor_budget_0", to: "goal_0" }];
    const priorRepairs = [receipt()];

    const result = fixDisconnectedObservables(graph, priorRepairs);

    expect(result.pruned).toEqual([]);
    expect(priorRepairs[0]!.action).toBe(RECEIPT); // byte-identical
  });

  it("TWIN: leaves a DIFFERENT node's receipt alone", () => {
    const priorRepairs = [
      { ...receipt(), path: "nodes[factor_headcount_9].category" },
    ];
    const result = fixDisconnectedObservables(budgetGraph(), priorRepairs);

    expect(result.pruned).toContain("factor_budget_0");
    expect(priorRepairs[0]!.action).toBe(RECEIPT); // not ours to touch
  });

  it("TWIN: leaves a receipt that never promised a range alone", () => {
    const bare = {
      code: "UNREACHABLE_FACTOR_RECLASSIFIED",
      path: "nodes[factor_budget_0].category",
      action: 'Reclassified unreachable factor "Budget" to external',
    };
    const priorRepairs = [bare];
    fixDisconnectedObservables(budgetGraph(), priorRepairs);
    // Still true as written — amending it would add a claim, not fix one.
    expect(priorRepairs[0]!.action).toBe('Reclassified unreachable factor "Budget" to external');
  });

  it("TWIN: ignores repairs of another code entirely", () => {
    const other = {
      code: "DISCONNECTED_OBSERVABLE_PRUNED",
      path: "nodes[factor_budget_0]",
      action: "the range shown is a placeholder",
    };
    const priorRepairs = [other];
    fixDisconnectedObservables(budgetGraph(), priorRepairs);
    expect(priorRepairs[0]!.action).toBe("the range shown is a placeholder");
  });

  it("TWIN: with no prior repairs, behaviour is byte-identical to before", () => {
    const graph = budgetGraph();
    const result = fixDisconnectedObservables(graph);
    expect(result.pruned).toContain("factor_budget_0");
    expect(result.repairs.map((r) => r.code)).toEqual(["DISCONNECTED_OBSERVABLE_PRUNED"]);
  });

  it("leaves the pre-existing controllable exemption untouched", () => {
    const graph: any = {
      nodes: [{ id: "factor_spend_0", kind: "factor", label: "Spend", category: "controllable" }],
      edges: [],
    };
    expect(fixDisconnectedObservables(graph, [receipt()]).pruned).toEqual([]);
  });
});
