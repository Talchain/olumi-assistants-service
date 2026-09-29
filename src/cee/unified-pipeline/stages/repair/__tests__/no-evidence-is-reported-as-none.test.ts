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
 * then the OTHER placeholder in this codebase, written by late-STRP — occurs
 * ZERO times, which is what identifies THIS repair as the writer. ⚠ That zero
 * is a measurement of the corpus, NOT a claim that late-STRP could not write
 * it: its rule 1 fires only on a factor whose DECLARED category was wrong, a
 * shape this corpus happens not to contain. Both late-STRP sites have since
 * been changed to write `[]`.
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
 *   2. ⚠ RETIRED, BY FIXING THE PRODUCER IT DESCRIBED — kept because a reader
 *      inheriting the old sentence would act on it. This limb read: omitting
 *      the key hands the consumer a DIFFERENT sentence, because late-STRP's
 *      rule 5 wrote `["Estimation uncertainty"]`. Both late-STRP sites now
 *      write `[]` (`structural-reconciliation.ts` rules 1 and 5), so that is no
 *      longer true. Limb 1 carries the remedy ALONE and is unaffected.
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

  it("DISCRIMINATING CONTROL — an ABSENT key is still refilled, and the refill is now NONE too", () => {
    // ⭐⭐ THIS CASE FIRED ON THE LATE-STRP FIX, AND THE FIRING IS RECORDED HERE
    // RATHER THAN SILENCED.
    //
    // It used to assert that an omitted key came back as
    // `["Estimation uncertainty"]` — late-STRP's own placeholder — and that was
    // limb 2 of this file's "why `[]` and not an absent key" argument. The
    // late-STRP sites have since been changed to write `[]` as well
    // (`structural-reconciliation.ts` rules 1 and 5), because that sentence
    // REACHED THE READER: the UI's whole-string filter does not contain it, so
    // unlike "Not provided" it rendered as genuine evidence.
    //
    // ⭐ THE DECISION THIS DEMANDED, stated rather than assumed: the remedy is
    // UNCHANGED, because limb 1 carries it alone. An absent key still re-raises
    // the ERROR at `graph-validator.ts:848` (`if (!data?.uncertainty_drivers)`,
    // severity "error"), which the case below pins. Only limb 2 has been
    // retired — by fixing the producer it described, which is the right
    // direction for a supporting reason to disappear.
    //
    // The case keeps its discriminating power: it still proves the refill FIRES
    // on an absent key (so it cannot decay into a guard that passes because
    // nothing ran), and now pins that what the refill writes is not a sentence.
    const graph = optionConnectedGraph({
      value: 0.5,
      extractionType: "inferred",
      factor_type: "other",
      // uncertainty_drivers deliberately ABSENT — the omission remedy's output
    });
    expect(nodeById(graph, "fac_target").data.uncertainty_drivers).toBeUndefined();

    const { graph: afterStrp, mutations } = reconcileStructuralTruth(graph as GraphT, {
      fillControllableData: true,
      requestId: "test-no-evidence-reported-as-none",
    }) as any;

    // PRECONDITION, pinned in-test (trap 13b): the refill actually ran on THIS
    // node. Without this the assertion below would also pass if late-STRP had
    // simply stopped touching the field.
    expect(
      (mutations as Array<{ rule: string; node_id: string; field: string }>).some(
        (m) =>
          m.rule === "controllable_data_completeness" &&
          m.node_id === "fac_target" &&
          m.field === "data.uncertainty_drivers",
      ),
    ).toBe(true);

    // ⭐ And what it writes is NONE, not a second sentence for the consumer to
    // mis-parse.
    expect(nodeById(afterStrp, "fac_target").data.uncertainty_drivers).toEqual([]);
    expect(
      readsAsNoEvidence(nodeById(afterStrp, "fac_target").data.uncertainty_drivers),
    ).toBe(true);
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
