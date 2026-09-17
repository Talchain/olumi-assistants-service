/**
 * A FACTOR WITH NO SUPPORTING EVIDENCE MUST BE REPORTED AS HAVING NONE.
 *
 * ── THE USER OUTCOME THIS PROTECTS ─────────────────────────────────────────
 * The product coaches a user away from leaning on a high-priority factor that
 * nothing supports:
 *
 *   "X is among the highest-priority factors to review but has no supporting
 *    evidence. Validate it before relying on it."
 *
 * That warning is gated on the factor having no uncertainty drivers. The
 * consuming check is the natural one — `!drivers || drivers.length === 0`.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * `fixControllableMissingData` filled the gap with a PLACEHOLDER SENTENCE
 * standing in for an empty list:
 *
 *   data.uncertainty_drivers = ["Not provided"];        // ← length ONE
 *
 * A placeholder array has length one, so the emptiness check never fired and
 * the product went silent on precisely the population the coaching exists to
 * catch. Nothing errored, no empty state rendered — a line simply never
 * appeared, which is why it read as working.
 *
 * ── MEASURED ON THE DEPLOYED BUILD ─────────────────────────────────────────
 * 32 fresh v202 staging drafts, 2026-09-17. `uncertainty_drivers` occurs 102
 * times and **102 of 102 are exactly `["Not provided"]`** — this repair's
 * literal, on every controllable factor in the corpus. Contrast controls in
 * the same sweep (trap 13e): `factor_type` 102, `observed_state` 106,
 * `label` 660, so the probe was not blind; and `"Estimation uncertainty"` —
 * the OTHER placeholder in this codebase, written by late-STRP — occurs ZERO
 * times, which is what identifies THIS repair as the writer.
 *
 * ── WHY `[]` AND NOT AN ABSENT KEY ─────────────────────────────────────────
 * Both remedies read equally honest; only one survives the pipeline. Pinned as
 * executable cases below rather than asserted, because this is the whole
 * safety argument:
 *
 *   1. ABSENT re-raises the ERROR. `graph-validator.ts:848` is
 *      `if (!data?.uncertainty_drivers) missing.push(...)` → severity
 *      `"error"`. Removing the key leaves standing the very violation this
 *      repair exists to close.
 *   2. ABSENT IS REFILLED WITH A DIFFERENT PLACEHOLDER. The sweep is substep 1
 *      of Stage 4; late-STRP is substep 6 and runs `fillControllableData:
 *      true`, whose rule 5 is `if (!data.uncertainty_drivers)
 *      data.uncertainty_drivers = ["Estimation uncertainty"]`
 *      (`structural-reconciliation.ts:260`). Omitting the key would hand the
 *      consumer a DIFFERENT sentence to mis-parse — the same defect in a new
 *      spelling, which is exactly the move this change must not make.
 *   3. `[]` IS TRUTHY, so it passes both guards untouched and reaches the wire.
 *      It raises only `EMPTY_UNCERTAINTY_DRIVERS`, severity `"warn"` — a code
 *      the validator already defines, i.e. this codebase had already named
 *      "a controllable factor with no uncertainty drivers" as a legitimate,
 *      non-fatal state. We are now telling the truth in a vocabulary that
 *      already existed.
 *
 * ── ASSERTIONS BIND BY IDENTITY (trap 19) ──────────────────────────────────
 * Every node is located by its own id. No assertion finds a node by a value
 * another node could satisfy.
 */
import { describe, expect, it } from "vitest";

import { runDeterministicSweep } from "../deterministic-sweep.js";
import { validateGraph } from "../../../../../validators/graph-validator.js";
import { reconcileStructuralTruth } from "../../../../../validators/structural-reconciliation.js";
import type { GraphT } from "../../../../../schemas/graph.js";

/**
 * A factor is "controllable" when an option acts on it
 * (`graph-validator.ts::inferFactorCategories`), so the option edges are
 * load-bearing, not scenery.
 */
function optionConnectedGraph(factorData?: Record<string, unknown>): any {
  return {
    nodes: [
      { id: "dec_x", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "opt_b", kind: "option", label: "Option B" },
      {
        id: "fac_target",
        kind: "factor",
        label: "Support headcount",
        category: "controllable",
        ...(factorData ? { data: { ...factorData } } : {}),
      },
      { id: "out_x", kind: "outcome", label: "Outcome" },
      { id: "goal_x", kind: "goal", label: "Goal" },
    ],
    edges: [
      { from: "dec_x", to: "opt_a", edge_type: "structural" },
      { from: "dec_x", to: "opt_b", edge_type: "structural" },
      { from: "opt_a", to: "fac_target", edge_type: "causal" },
      { from: "opt_b", to: "fac_target", edge_type: "causal" },
      { from: "fac_target", to: "out_x", edge_type: "causal" },
      { from: "out_x", to: "goal_x", edge_type: "causal" },
    ],
  };
}

const nodeById = (graph: any, id: string): any =>
  graph.nodes.find((n: any) => n.id === id);

/** ctx shape `runDeterministicSweep` reads: the graph and a request id. */
const sweepCtx = (graph: unknown): any => ({
  graph,
  requestId: "test-no-evidence-reported-as-none",
});

const hasCode = (issues: Array<{ code: string }>, code: string): boolean =>
  issues.some((i) => i.code === code);

/** The consuming overconfidence check, verbatim. */
const readsAsNoEvidence = (drivers: unknown): boolean =>
  !drivers || (drivers as unknown[]).length === 0;

describe("uncertainty_drivers — an empty list, never a sentence saying the list is empty", () => {
  it("PRECONDITION — the sweep really is asked to fill this field", () => {
    // Pinned in-test (trap 13b) so the assertion below is provably the
    // repair's doing, and cannot decay into a guard that passes because the
    // gate never opened.
    const graph = optionConnectedGraph();
    const result = validateGraph({ graph: graph as GraphT });

    const issue = result.errors.find((e) => e.code === "CONTROLLABLE_MISSING_DATA");
    expect(issue).toBeDefined();
    expect((issue!.context as { missing: string[] }).missing).toContain(
      "uncertainty_drivers",
    );
  });

  it("THE DEFECT — the sweep emits an EMPTY list, so the consumer can see there is no evidence", async () => {
    const graph = optionConnectedGraph(); // BARE, exactly as the model emits

    // Precondition pinned in-test: nothing to preserve before the sweep runs.
    expect(nodeById(graph, "fac_target").data?.uncertainty_drivers).toBeUndefined();

    await runDeterministicSweep(sweepCtx(graph));

    const after = nodeById(graph, "fac_target");

    // ⭐ THE ASSERTION, bound to the node by ID.
    expect(after.data?.uncertainty_drivers).toEqual([]);

    // ⭐ THE USER OUTCOME, stated as the consumer states it. This is the line
    // that was silently false on 102 of 102 measured factors.
    expect(readsAsNoEvidence(after.data?.uncertainty_drivers)).toBe(true);

    // …and it must not be a sentence of ANY spelling. A different placeholder
    // string reproduces the defect exactly, so this REDs on a re-spelling as
    // well as on a revert.
    expect(after.data?.uncertainty_drivers).not.toContain("Not provided");
    expect((after.data?.uncertainty_drivers as unknown[]).every((d) => typeof d === "string")).toBe(true);
    expect((after.data?.uncertainty_drivers as unknown[]).length).toBe(0);
  });

  it("OPPOSITE-DIRECTION TWIN — the ERROR the repair exists to close stays closed", async () => {
    // Deleting the fill outright would also satisfy the case above, and would
    // ship a factor the validator still rejects. Only the empty-list form
    // passes both.
    const graph = optionConnectedGraph();
    await runDeterministicSweep(sweepCtx(graph));

    const result = validateGraph({ graph: graph as GraphT });
    expect(hasCode(result.errors, "CONTROLLABLE_MISSING_DATA")).toBe(false);

    // What IS raised is the warn-level code this codebase already had a name
    // for — an honest gap the suite can see, rather than one invisible to it.
    expect(hasCode(result.warnings, "EMPTY_UNCERTAINTY_DRIVERS")).toBe(true);
    expect(
      result.warnings.find((w) => w.code === "EMPTY_UNCERTAINTY_DRIVERS")!.severity,
    ).toBe("warn");
  });

  it("LATE-STRP LEAVES THE EMPTY LIST ALONE — the fix survives to the wire", async () => {
    // Substep 6 runs after this repair with `fillControllableData: true`. If it
    // overwrote an empty list, the fix would be dead on the deployed path while
    // every assertion above stayed green (trap 21 — two fixes for one harm).
    const graph = optionConnectedGraph();
    await runDeterministicSweep(sweepCtx(graph));
    expect(nodeById(graph, "fac_target").data?.uncertainty_drivers).toEqual([]);

    const { graph: afterStrp } = reconcileStructuralTruth(graph as GraphT, {
      fillControllableData: true,
      requestId: "test-no-evidence-reported-as-none",
    }) as any;

    expect(nodeById(afterStrp, "fac_target").data?.uncertainty_drivers).toEqual([]);
    expect(readsAsNoEvidence(nodeById(afterStrp, "fac_target").data?.uncertainty_drivers)).toBe(true);
  });

  it("DISCRIMINATING CONTROL — an ABSENT key is refilled with a DIFFERENT placeholder", () => {
    // ⭐ This is why the remedy is `[]` and not an omitted key, proven by
    // execution rather than argued. The case is constructed to be the exact
    // state omission would leave behind.
    const graph = optionConnectedGraph({
      value: 0.5,
      extractionType: "inferred",
      factor_type: "other",
      // uncertainty_drivers deliberately ABSENT — the omission remedy's output
    });
    expect(nodeById(graph, "fac_target").data.uncertainty_drivers).toBeUndefined();

    const { graph: afterStrp } = reconcileStructuralTruth(graph as GraphT, {
      fillControllableData: true,
      requestId: "test-no-evidence-reported-as-none",
    }) as any;

    // A second placeholder sentence, and the consumer would read it as
    // evidence exactly as it read "Not provided".
    expect(nodeById(afterStrp, "fac_target").data.uncertainty_drivers).toEqual([
      "Estimation uncertainty",
    ]);
    expect(
      readsAsNoEvidence(nodeById(afterStrp, "fac_target").data.uncertainty_drivers),
    ).toBe(false);
  });

  it("REAL DRIVERS ARE UNTOUCHED — including ones containing placeholder WORDS", async () => {
    // ⚠ THE CONSUMER'S LOAD-BEARING CONSTRAINT. Whole-string matching is what
    // protects genuine drivers that happen to contain "unknown" — both of
    // these are real evidence from the captured corpus, and a substring filter
    // would delete them. This repair must never create a placeholder that
    // forces the consumer off whole-string matching.
    const stated = [
      "Onboarding complexity unknown",
      "Actual usage patterns of large accounts unknown",
    ];
    const graph = optionConnectedGraph({
      value: 0.4,
      extractionType: "explicit",
      factor_type: "cost",
      uncertainty_drivers: [...stated],
    });

    await runDeterministicSweep(sweepCtx(graph));

    const after = nodeById(graph, "fac_target");
    expect(after.data.uncertainty_drivers).toEqual(stated);
    expect(readsAsNoEvidence(after.data.uncertainty_drivers)).toBe(false);
  });
});
