/**
 * LATE-STRP MUST REPORT "NO EVIDENCE" AS NONE, NOT AS A SENTENCE IT INVENTED.
 *
 * ── THE USER OUTCOME THIS PROTECTS ─────────────────────────────────────────
 * A person opens a factor and reads what is genuinely uncertain about it. If
 * the model recorded nothing, they must see nothing — and be coached:
 *
 *   "X is the most influential factor in this model, and no uncertainty
 *    drivers are recorded for it. Validate it before relying on it."
 *
 * A producer-invented driver is strictly worse than an absent one. It is a
 * sentence the person did not write and the model did not derive, rendered
 * under their own factor as though it were evidence. This product's value is
 * that a person can trust what it tells them about their own model.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * Two sites in `structural-reconciliation.ts` filled the gap with a
 * PLACEHOLDER SENTENCE:
 *
 *   data.uncertainty_drivers = ["Estimation uncertainty"];   // ← length ONE
 *
 *   · Rule 1 (category_override, :189) — a factor whose DECLARED category was
 *     wrong and which is structurally controllable.
 *   · Rule 5 (controllable_data_completeness, :261) — any controllable factor
 *     still missing the field in the late pass.
 *
 * ⛔ AND THIS ONE REACHES THE READER, which the sibling defect did not.
 * #1572 removed `["Not provided"]` from the deterministic sweep. The UI filters
 * that string — `PLACEHOLDER_EVIDENCE_STRINGS` in
 * `canvas/utils/observedStateHelpers.ts` is
 * `{not provided, n/a, none, not specified, unknown}`, matched WHOLE-STRING and
 * case-insensitively. Swept at UI staging `3b7e5d4c`: "estimation uncertainty"
 * occurs 0 times in `src/`, contrast control "not provided" 93 — so the filter
 * cannot suppress it and `meaningfulUncertaintyDrivers` returns it as real
 * evidence. The person is shown a fabricated driver, and the overconfidence
 * coaching stays silent because the array has length one.
 *
 * ── WHY THE SWEEP'S FIX DID NOT CLOSE THESE ────────────────────────────────
 * `fixControllableMissingData` early-returns unless the validator raised
 * `CONTROLLABLE_MISSING_DATA` (`deterministic-sweep.ts:380`), and those
 * violations are computed against the PRE-repair categories. A factor declared
 * `observable` raises no such violation, so the sweep never fills it — and
 * `fixObservableExtraData` DELETES `data.uncertainty_drivers` from it
 * (`:696-698`). Late-STRP then infers it as controllable and stamps the
 * sentence. The two passes also infer categories differently: the sweep's
 * `fixCategoryMismatch` is two-way (`hasOptionEdge ? controllable : external`),
 * late-STRP's `inferFactorCategories` is three-way. Same name, two questions
 * (CLAUDE.md trap 21).
 *
 * ── WHY `[]` AND NOT AN ABSENT KEY ─────────────────────────────────────────
 * Settled for the sibling site in `no-evidence-is-reported-as-none.test.ts`
 * and unchanged here: `[]` is TRUTHY, so it passes `graph-validator.ts:848`
 * (`if (!data?.uncertainty_drivers)`, severity "error") untouched, and raises
 * only `EMPTY_UNCERTAINTY_DRIVERS`, severity "warn" — a state this codebase had
 * already named legitimate. The schemas declare `z.array(z.string()).max(2)`
 * with no `.min(1)` (`schemas/graph.ts:188`, `schemas/cee-v3.ts:168`), so an
 * empty list validates. Removing the key instead would re-raise the error.
 *
 * ── ASSERTIONS BIND BY IDENTITY (trap 19) ──────────────────────────────────
 * Every node is located by its own id, and each case pins IN-TEST that its
 * rule actually fired (trap 13b) — so a green result is provably the code's
 * doing and not a graph that never opened the gate.
 */
import { describe, expect, it } from "vitest";

import { reconcileStructuralTruth } from "../structural-reconciliation.js";
import type { GraphT } from "../../schemas/graph.js";

/**
 * A factor is "controllable" to `inferFactorCategories` when an option acts on
 * it, so the option edges are load-bearing, not scenery.
 */
function optionConnectedGraph(
  declaredCategory: string | undefined,
  factorData?: Record<string, unknown>,
): any {
  return {
    nodes: [
      { id: "dec_x", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      {
        id: "fac_target",
        kind: "factor",
        label: "Support headcount",
        ...(declaredCategory ? { category: declaredCategory } : {}),
        ...(factorData ? { data: { ...factorData } } : {}),
      },
      { id: "out_x", kind: "outcome", label: "Outcome" },
      { id: "goal_x", kind: "goal", label: "Goal" },
    ],
    edges: [
      { from: "dec_x", to: "opt_a", edge_type: "structural" },
      { from: "opt_a", to: "fac_target", edge_type: "causal" },
      { from: "fac_target", to: "out_x", edge_type: "causal" },
      { from: "out_x", to: "goal_x", edge_type: "causal" },
    ],
  };
}

const nodeById = (graph: any, id: string): any =>
  graph.nodes.find((n: any) => n.id === id);

/** The consuming overconfidence check, verbatim. */
const readsAsNoEvidence = (drivers: unknown): boolean =>
  !drivers || (drivers as unknown[]).length === 0;

/**
 * The UI's predicate, verbatim from
 * `DecisionGuideAI/src/canvas/utils/observedStateHelpers.ts` at staging
 * `3b7e5d4c`. Reproduced rather than imported because it lives in another
 * repo; its CONTENT is what makes an invented sentence reach the reader, and
 * the contrast case below pins that this copy still discriminates.
 */
const PLACEHOLDER_EVIDENCE_STRINGS = new Set([
  "not provided",
  "n/a",
  "none",
  "not specified",
  "unknown",
]);
const meaningfulUncertaintyDrivers = (drivers: unknown): string[] =>
  Array.isArray(drivers)
    ? drivers.filter(
        (d): d is string =>
          typeof d === "string" &&
          d.trim() !== "" &&
          !PLACEHOLDER_EVIDENCE_STRINGS.has(d.trim().toLowerCase()),
      )
    : [];

describe("late-STRP uncertainty_drivers — none, never an invented sentence", () => {
  it("PRECONDITION — the UI predicate this depends on really does discriminate", () => {
    // Trap 13b: the claim "an invented driver reaches the reader" rests on this
    // set NOT containing the producer's sentence. Pinned with a contrast case
    // so a decayed copy cannot silently agree with everything.
    expect(meaningfulUncertaintyDrivers(["Not provided"])).toEqual([]);
    expect(meaningfulUncertaintyDrivers(["Estimation uncertainty"])).toEqual([
      "Estimation uncertainty",
    ]);
    // A real driver containing a placeholder WORD must survive — the filter is
    // whole-string, and this is why a re-spelling cannot be fixed downstream.
    expect(meaningfulUncertaintyDrivers(["Onboarding complexity unknown"])).toEqual([
      "Onboarding complexity unknown",
    ]);
  });

  it("RULE 1 (category_override) — a reclassified factor is filled with NONE, not a sentence", () => {
    // Declared `observable`, but an option acts on it, so late-STRP infers
    // `controllable` and takes the `declared && inferred === "controllable"`
    // branch that fills the data fields.
    const graph = optionConnectedGraph("observable", { value: 0.4 });
    expect(nodeById(graph, "fac_target").data?.uncertainty_drivers).toBeUndefined();

    const result = reconcileStructuralTruth(graph as GraphT, {
      requestId: "test-late-strp-none-not-a-sentence",
    });

    // Precondition pinned IN-TEST: the rule fired on THIS node, by id.
    const override = result.mutations.find(
      (m) => m.rule === "category_override" && m.node_id === "fac_target",
    );
    expect(override).toBeDefined();
    expect(override!.after).toBe("controllable");

    const after = nodeById(graph, "fac_target");

    // ⭐ THE ASSERTION, bound to the node by ID.
    expect(after.data?.uncertainty_drivers).toEqual([]);

    // ⭐ THE USER OUTCOME: the coaching can see there is no evidence.
    expect(readsAsNoEvidence(after.data?.uncertainty_drivers)).toBe(true);

    // ⭐ AND NOTHING FABRICATED REACHES THE READER.
    expect(meaningfulUncertaintyDrivers(after.data?.uncertainty_drivers)).toEqual([]);
  });

  it("RULE 5 (controllable_data_completeness) — a bare controllable factor is filled with NONE", () => {
    // Declared category already agrees with inference, so Rule 1 skips it and
    // Rule 5 is the only writer.
    const graph = optionConnectedGraph("controllable");
    expect(nodeById(graph, "fac_target").data?.uncertainty_drivers).toBeUndefined();

    const result = reconcileStructuralTruth(graph as GraphT, {
      requestId: "test-late-strp-none-not-a-sentence",
      fillControllableData: true,
    });

    // Precondition pinned IN-TEST, by id and by field — and Rule 1 must NOT be
    // the writer here, or this case would silently test the branch above.
    const fill = result.mutations.find(
      (m) =>
        m.rule === "controllable_data_completeness" &&
        m.node_id === "fac_target" &&
        m.field === "data.uncertainty_drivers",
    );
    expect(fill).toBeDefined();
    expect(
      result.mutations.some((m) => m.rule === "category_override" && m.node_id === "fac_target"),
    ).toBe(false);

    const after = nodeById(graph, "fac_target");

    expect(after.data?.uncertainty_drivers).toEqual([]);
    expect(readsAsNoEvidence(after.data?.uncertainty_drivers)).toBe(true);
    expect(meaningfulUncertaintyDrivers(after.data?.uncertainty_drivers)).toEqual([]);

    // The observability record must not claim a sentence was written either —
    // it is read by operators deciding whether the product fabricated.
    expect(fill!.after).toEqual([]);
  });

  it("NO SPELLING OF THE PLACEHOLDER SURVIVES EITHER RULE", () => {
    // ⚠ A DIFFERENT SPELLING REPRODUCES THE DEFECT EXACTLY: the consumer would
    // simply mis-parse a new sentence. This REDs on a re-spelling as well as on
    // a revert, over BOTH writers, so the fix cannot be undone by renaming.
    for (const declared of ["observable", "controllable"] as const) {
      const graph = optionConnectedGraph(
        declared,
        declared === "observable" ? { value: 0.4 } : undefined,
      );
      reconcileStructuralTruth(graph as GraphT, {
        requestId: "test-late-strp-none-not-a-sentence",
        fillControllableData: true,
      });

      const drivers = nodeById(graph, "fac_target").data?.uncertainty_drivers;
      expect(Array.isArray(drivers)).toBe(true);
      // Every element must be real evidence. An empty list trivially satisfies
      // this; a producer-invented sentence of ANY wording does not, because the
      // producer has nothing to derive one from.
      expect(drivers).toEqual([]);
    }

    // The literal, over the whole serialised graph, as a belt-and-braces catch
    // for any site this test does not name.
    const graph = optionConnectedGraph("observable", { value: 0.4 });
    reconcileStructuralTruth(graph as GraphT, {
      requestId: "test-late-strp-none-not-a-sentence",
      fillControllableData: true,
    });
    expect(JSON.stringify(graph)).not.toContain("Estimation uncertainty");
  });

  it("OPPOSITE-DIRECTION TWIN — a factor's REAL drivers are never replaced", () => {
    // The fix must not become "always write []". A factor that carries genuine
    // evidence must reach the reader untouched, through both rules.
    const graph = optionConnectedGraph("observable", {
      value: 0.4,
      uncertainty_drivers: ["Onboarding complexity unknown"],
    });

    reconcileStructuralTruth(graph as GraphT, {
      requestId: "test-late-strp-none-not-a-sentence",
      fillControllableData: true,
    });

    const after = nodeById(graph, "fac_target");
    expect(after.data?.uncertainty_drivers).toEqual(["Onboarding complexity unknown"]);
    expect(meaningfulUncertaintyDrivers(after.data?.uncertainty_drivers)).toEqual([
      "Onboarding complexity unknown",
    ]);
  });
});
