/**
 * THE EXPLICIT UNKNOWN — a factor with no stated value says so, and stops
 * being handed a `0.5` that reaches the maths.
 *
 * ── THE SPEC THESE INVARIANTS ARE WRITTEN AGAINST ──────────────────────────
 * Not the failure mode. The spec is the standing invariant (LANE-STANDING-BRIEF
 * §"NO UNIVERSAL SEMANTIC FALLBACK"): a quantity has exactly three legitimate
 * states — explicit user fact (PRESERVE), defensible Olumi estimate (carry its
 * provenance and uncertainty), genuinely unknown (UNKNOWN / needs input). "A
 * plausible number because a downstream consumer wants a scalar" is none of
 * them.
 *
 * So every assertion below is of the form *"which of the three states is this
 * factor in, and does the wire say so"* — never *"is this number 0.5"*. A
 * magnitude is not a discriminator (CLAUDE.md trap 19): a genuinely stated 0.5
 * and an invented one are the same number.
 *
 * ── WHY IT IS NOT COSMETIC ─────────────────────────────────────────────────
 * Measured against ISL `28fe0c95` with three controls firing: elasticity is
 * `(causal path gain) x (the factor's baseline) / (baseline outcome mean)`.
 * Three factors at 0.5 produced identical elasticity to 17 s.f.; moving one to
 * 0.8 scaled its elasticity by exactly 1.6. PLoT separately derives sigma as
 * `|value| * 0.15`. The placeholder is a multiplicative term in the headline
 * sensitivity, not a caption.
 *
 * ── WHERE THE ORACLE COMES FROM (trap 13c: a mutant kit scores SENSITIVITY, ─
 *    never CORRECTNESS, so a self-authored expectation earns a perfect score
 *    on the wrong exam)
 * EXTERNAL, and it is the load-bearing half of this suite:
 * `MEASURED_FACTOR_NODES` in `./fixtures/trace-captures.ts` is 24 factor nodes
 * captured from DEPLOYED STAGING on 2026-08-08 across three real briefs. It is
 * not authored here. Block B's positive control is drawn from it wholesale
 * rather than from a fixture of this author's design, which is what acceptance
 * criterion 2 ("a real end-to-end brief, not a synthetic fixture") requires.
 *
 * That corpus also supplies a case the author's head did not: TWO of its factors
 * carry a `uniform(0, 1)` prior (`fac_nrr`, `fac_legal_clearance`) — trap 22.
 *
 * ⚠⚠ AND AN EARLIER VERSION OF THIS PARAGRAPH WAS WRONG ABOUT THEM, WHICH IS
 * WORTH KEEPING BECAUSE THE ERROR WAS PLAUSIBLE. It called both "GENUINE" priors
 * and concluded that "a predicate keyed on the RANGE would suppress two real
 * priors". That reasoning is sound for the READ predicate and false for the
 * WRITE sites, and the difference is the served prompt: `defaults-v187.ts:517-521`
 * teaches `0.0 | 1.0` as the encoding for "unknown / no qualifier", so a
 * model-supplied `uniform(0,1)` is most likely the model saying it does NOT
 * know. Reading it as genuine information was the assumption that let a
 * disclosure regression through.
 *
 * THE TWO PREDICATES ARE THEREFORE KEYED ON DIFFERENT THINGS, ON PURPOSE:
 *   `factorIsExplicitlyUnquantified` — reads the FLAG only, never the range.
 *       A node that was never marked is not retro-classified by its numbers.
 *   `shouldPreserveModelPrior`       — reads the RANGE at the WRITE sites, and
 *       deliberately declines to preserve a full-width prior unflagged, because
 *       that is ignorance wearing an estimate's clothes.
 * Neither corpus factor is affected either way: both are `external`, and the
 * write sites do not reach that category.
 *
 * MINE: the structural expectations, each derived from the producer's own
 * declared semantics — `graph-validator.ts`'s gate, and
 * `unquantified-factor.ts`'s stated contract.
 *
 * ⚠ SCOPE, STATED SO IT CANNOT BE OVER-READ. Every assertion below is a
 * PRODUCER assertion about CEE's own output. Nothing here claims anything about
 * what PLoT computes, what ISL samples, or what the UI paints. Status-ladder
 * rung reached by this file alone: TESTED.
 */

import { describe, it, expect } from "vitest";
import { ensureControllableFactorBaselines } from "../../../adapters/llm/normalisation.js";
import { fixObservableMissingData } from "../../unified-pipeline/stages/repair/deterministic-sweep.js";
import { validateGraph } from "../../../validators/graph-validator.js";
import {
  buildUnquantifiedPrior,
  factorIsExplicitlyUnquantified,
  PRIOR_IS_UNQUANTIFIED_FIELD,
} from "../unquantified-factor.js";
import { MEASURED_FACTOR_NODES } from "./fixtures/trace-captures.js";
import type { GraphT } from "../../../schemas/graph.js";

// ───────────────────────────────────────────────────────────────────────────
// Helpers — graphs are built to satisfy the STRUCTURE the validator needs, so
// that the only thing under test is the factor-data gate.
// ───────────────────────────────────────────────────────────────────────────

/**
 * A graph whose single controllable factor is reachable from an option — which
 * is precisely `ensureControllableFactorBaselines`' structural target set
 * (`normalisation.ts` derives it from `option→factor` edges, not from a label).
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

function nodeById(graph: any, id: string): any {
  return graph.nodes.find((n: any) => n.id === id);
}

function hasErrorCode(result: { errors: Array<{ code: string }> }, code: string): boolean {
  return result.errors.some((e) => e.code === code);
}

/** The missing-field list the validator attached, for the named code. */
function missingFieldsFor(
  result: { errors: Array<{ code: string; context?: Record<string, unknown> }> },
  code: string,
): string[] {
  const issue = result.errors.find((e) => e.code === code);
  const missing = issue?.context?.missing;
  return Array.isArray(missing) ? (missing as string[]) : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// A — THE SUBSTITUTION IS GONE (acceptance 1)
// ═══════════════════════════════════════════════════════════════════════════

describe("A — a factor with no stated value emits an explicit unknown, not 0.5", () => {
  it("W1 (ensureControllableFactorBaselines) writes NO value and marks the factor unquantified", () => {
    const graph = optionConnectedGraph({ extractionType: "explicit" });

    const { response, unquantifiedFactors } = ensureControllableFactorBaselines(graph) as any;
    const factor = nodeById(response, "fac_target");

    // BOUND BY IDENTITY (node id), never by a value predicate a sibling could
    // satisfy — CLAUDE.md trap 19.
    expect(unquantifiedFactors).toContain("fac_target");

    // The three claims that together ARE the fix:
    //  1. no number was invented …
    expect(factor.data?.value).toBeUndefined();
    //  2. … the factor is still VISIBLY PRESENT and carries maximal
    //     uncertainty (MARK, NEVER SUPPRESS — withholding the prior leaves a
    //     constraint on this node evaluating trivially at intercept=0) …
    expect(factor.prior).toEqual({
      distribution: "uniform",
      range_min: 0,
      range_max: 1,
      [PRIOR_IS_UNQUANTIFIED_FIELD]: true,
      source: 'cee_repair',
      value_tier: 'fallback_default',
    });
    //  3. … and the range is LABELLED as ignorance, which is the only thing
    //     that stops a downstream reader treating U(0,1) as an estimate.
    expect(factorIsExplicitlyUnquantified(factor)).toBe(true);
  });

  it("W3 (fixObservableMissingData) does the same for the observable population", () => {
    // Observables never reach W1 — `ensureControllableFactorBaselines` gates on
    // the option→factor edge set. W3 is the ONLY writer for this population, so
    // asserting it separately is not duplication; it is the second of two
    // disjoint populations.
    const graph: any = {
      nodes: [
        { id: "dec_x", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Option A" },
        {
          id: "fac_obs",
          kind: "factor",
          label: "Customer satisfaction",
          category: "observable",
          data: {},
        },
        { id: "goal_x", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_x", to: "opt_a", edge_type: "structural" },
        { from: "fac_obs", to: "goal_x", edge_type: "causal" },
      ],
    };

    const repairs = fixObservableMissingData(graph as GraphT, [
      { code: "OBSERVABLE_MISSING_DATA", severity: "error", message: "", path: "nodes[fac_obs]" },
    ] as any);

    const factor = nodeById(graph, "fac_obs");
    expect(factor.data?.value).toBeUndefined();
    expect(factorIsExplicitlyUnquantified(factor)).toBe(true);
    expect(factor.prior.range_min).toBe(0);
    expect(factor.prior.range_max).toBe(1);

    // A repair record is emitted, bound to THIS node by id, and its text is the
    // plain-English form — no bracket notation, no leaked figure, and above all
    // NOT the disowned `0.5` (adversarial-review C1: an earlier draft of the
    // sibling string printed all three to a user).
    const repair = repairs.find((r) => r.path.includes("fac_obs"));
    expect(repair).toBeDefined();
    expect(repair!.action).not.toMatch(/0\.5/);
    expect(repair!.action).not.toMatch(/[[\]]/);
    expect(repair!.action.toLowerCase()).toContain("no estimate");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B — A REAL STATED VALUE IS UNTOUCHED (acceptance 2)
//
// THE OPPOSITE-DIRECTION TWIN, and the reason it is not optional. This change
// guards two OPPOSITE harms: leaving a placeholder in place (a lie by
// substitution) and stripping a real value (a lie by erasure). They cannot
// share one predicate — LANE-STANDING-BRIEF §3. Block A watches one door; this
// block watches the other, on a corpus captured from the deployed product.
// ═══════════════════════════════════════════════════════════════════════════

describe("B — real values survive, on the captured wire corpus", () => {
  const withRealValue = MEASURED_FACTOR_NODES.filter(
    (f) => f.category === "controllable" && typeof f.observedValue === "number",
  );

  it("the corpus actually contains the class under test (positive control)", () => {
    // A probe for a rare condition needs a control that FIRES. Without this, a
    // corpus filter that silently matched nothing would leave every assertion
    // below vacuously green (trap 13).
    expect(withRealValue.length).toBeGreaterThanOrEqual(8);
    // And a MAGNITUDE check against an independently known figure: the corpus
    // header declares 24 factor nodes across B1/B2/B3.
    expect(MEASURED_FACTOR_NODES.length).toBe(24);
  });

  it.each(withRealValue.map((f) => [f.id, f.observedValue as number] as const))(
    "leaves %s (captured value %s) exactly as it was",
    (factorId, capturedValue) => {
      const graph = optionConnectedGraph();
      const factor = nodeById(graph, "fac_target");
      factor.id = factorId;
      factor.data = { value: capturedValue, extractionType: "explicit" };
      // Re-point the edges at the renamed node so it stays option-connected —
      // i.e. so W1 genuinely LOOKS at it. A test that passes because the writer
      // never ran is a test that proves nothing.
      for (const e of graph.edges) {
        if (e.to === "fac_target") e.to = factorId;
        if (e.from === "fac_target") e.from = factorId;
      }

      // ⚠ DELIBERATELY ASSERTS THE NODE, NOT THE RETURNED ID LIST. This block
      // is the POSITIVE CONTROL and must be GREEN at pristine as well as after
      // the fix — a control that is red before the change proves nothing about
      // the change. Reading the returned list would couple it to a field this
      // PR renames, manufacturing a RED that is about a rename rather than
      // about behaviour.
      const { response } = ensureControllableFactorBaselines(graph) as any;
      const after = nodeById(response, factorId);

      expect(after.data.value).toBe(capturedValue);
      expect(after.prior).toBeUndefined();
      expect(factorIsExplicitlyUnquantified(after)).toBe(false);
    },
  );

  it("a captured value of exactly 0 is preserved — zero is a stated value, not an absence", () => {
    // `fac_germany_direct`, `fac_uk_depth`, `fac_office_closure` and five more
    // in the corpus carry `observedValue: 0`. A `!data.value` truthiness test
    // anywhere on this path would erase every one of them and read as green,
    // because the harm is invisible to a suite that only fixtures non-zero
    // numbers. The corpus is what makes the case reachable.
    const zeroValued = MEASURED_FACTOR_NODES.filter((f) => f.observedValue === 0);
    expect(zeroValued.length).toBeGreaterThanOrEqual(5); // control fires

    const graph = optionConnectedGraph({ value: 0, extractionType: "explicit" });
    const { response } = ensureControllableFactorBaselines(graph) as any;

    expect(nodeById(response, "fac_target").data.value).toBe(0);
    expect(nodeById(response, "fac_target").prior).toBeUndefined();
  });

  it("the FLAG, not the range, is what `factorIsExplicitlyUnquantified` reads", () => {
    // ⭐⭐ THE CASE THE AUTHOR'S HEAD DID NOT SUPPLY. Two nodes in the captured
    // corpus carry a `uniform(0, 1)` prior the model chose:
    //
    // ⚠ SCOPE, CORRECTED: this asserts only what the PREDICATE reads — the flag,
    // never the range. It does NOT claim these two priors are informative. The
    // served prompt (`defaults-v187.ts:517-521`) teaches `0.0 | 1.0` for
    // "unknown / no qualifier", so a `uniform(0,1)` is very likely the model
    // saying it does not know; `shouldPreserveModelPrior` treats it that way at
    // the WRITE sites. These two are `external` factors, which those sites do
    // not reach, so nothing here contradicts that.
    //   fac_nrr             (B1) — provenance from_brief, extractionType explicit
    //   fac_legal_clearance (B3) — provenance ai_inferred
    // A predicate keyed on the RANGE — "is this prior [0,1]?" — matches both and
    // would suppress two real priors, inventing a claim of ignorance we do not
    // have. That is the harm in the OPPOSITE direction from the one this lane
    // set out to fix (trap 22b), and the corpus is the only reason it is
    // visible here at all.
    const genuineUnitPriors = MEASURED_FACTOR_NODES.filter(
      (f) => f.prior?.range_min === 0 && f.prior?.range_max === 1,
    );
    // Bind by IDENTITY, not by the range predicate that produced the list.
    expect(genuineUnitPriors.map((f) => f.id).sort()).toEqual([
      "fac_legal_clearance",
      "fac_nrr",
    ]);

    for (const captured of genuineUnitPriors) {
      expect(factorIsExplicitlyUnquantified({ prior: { ...captured.prior } })).toBe(false);
    }

    // …while the marked form, which differs ONLY by the flag, reads true. The
    // pair is what proves the discrimination is the flag's doing and not the
    // fixture's failure (trap 13b: a discriminator must pin its own
    // precondition in-test).
    expect(factorIsExplicitlyUnquantified({ prior: buildUnquantifiedPrior() })).toBe(true);
  });

  it("REFUSES the near-miss forms — positive evidence only", () => {
    // The gate this relaxes is what stops a structurally broken node reaching
    // the maths, so the discriminator's BREADTH is the whole safety argument.
    expect(factorIsExplicitlyUnquantified({})).toBe(false);
    expect(factorIsExplicitlyUnquantified(null)).toBe(false);
    expect(factorIsExplicitlyUnquantified({ prior: null })).toBe(false);
    expect(factorIsExplicitlyUnquantified({ [PRIOR_IS_UNQUANTIFIED_FIELD]: true })).toBe(false);
    // Truthy-but-not-true must NOT pass: `!== false` and truthiness are both
    // wider than the spec, and a widened gate is how this estate loses gates.
    expect(
      factorIsExplicitlyUnquantified({ prior: { [PRIOR_IS_UNQUANTIFIED_FIELD]: "true" } }),
    ).toBe(false);
    expect(
      factorIsExplicitlyUnquantified({ prior: { [PRIOR_IS_UNQUANTIFIED_FIELD]: 1 } }),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C — THE GRAPH STILL VALIDATES (acceptance 3), AND THE GATE IS NOT DELETED
// ═══════════════════════════════════════════════════════════════════════════

describe("C — an explicit unknown satisfies the factor-data gate; nothing else does", () => {
  it("a controllable factor carrying an explicit unknown raises no CONTROLLABLE_MISSING_DATA", () => {
    const graph = optionConnectedGraph({
      extractionType: "inferred",
      factor_type: "capacity",
      uncertainty_drivers: ["not stated in the brief"],
    });
    nodeById(graph, "fac_target").prior = buildUnquantifiedPrior();

    const result = validateGraph({ graph: graph as GraphT });
    expect(hasErrorCode(result, "CONTROLLABLE_MISSING_DATA")).toBe(false);
  });

  it("CORRECTED PREMISE — `OBSERVABLE_MISSING_DATA` can never report a missing VALUE, so the observable arm of the relaxation is currently unreachable", () => {
    // ⚠⚠ THIS TEST REPLACES ONE THAT WAS VACUOUS, AND THE REPLACEMENT IS THE
    // FINDING. The original asserted "an observable factor carrying an explicit
    // unknown raises no OBSERVABLE_MISSING_DATA" and passed at PRISTINE — i.e.
    // before the fix existed. Adding a precondition control (assert the error
    // fires WITHOUT the prior) turned it red, which is what exposed the reason:
    //
    //   `inferFactorCategories` (graph-validator.ts) assigns
    //     hasOptionEdge -> "controllable"
    //     else hasValue -> "observable"          <- hasValue = data.value !== undefined
    //     else          -> "external"
    //
    // A factor is classified OBSERVABLE only if it HAS a value. The observable
    // branch of `validateFactorData` then pushes "value" onto `missing` when
    // `data?.value === undefined` — a condition its own gate has just excluded.
    // The branch is structurally dead FOR THE VALUE FIELD.
    //
    // MEASURED BY EXECUTION over eight factor shapes with a positive control
    // firing (a controllable factor with no value DOES raise
    // CONTROLLABLE_MISSING_DATA):
    //   no data / data {} / category=observable+data {} / value undefined /
    //   value null            -> OBSERVABLE_MISSING_DATA = false (all classify EXTERNAL)
    //   value "abc" / value 0.4 with no extractionType
    //                         -> OBSERVABLE_MISSING_DATA = true, and `missing`
    //                            is ["extractionType"], never ["value"]
    //
    // So the relaxation at the observable arm is CORRECT and INERT today. It is
    // kept — symmetric with the controllable arm, and it fails safe if category
    // inference ever changes — but it is NOT evidence that anything currently
    // reaches it, and this test exists so that claim cannot be over-read.
    //
    // The guard is DERIVED, not asserted: it drives the validator rather than
    // restating the reading above, so it REDs if inference ever starts
    // classifying a valueless factor as observable.
    const valuelessShapes: Array<Record<string, unknown> | undefined> = [
      undefined,
      {},
      { extractionType: "observed" },
    ];

    for (const data of valuelessShapes) {
      const graph: any = optionConnectedGraph(data);
      const factor = nodeById(graph, "fac_target");
      factor.category = "observable";
      graph.edges = graph.edges.filter((e: any) => e.to !== "fac_target");
      graph.edges.push({ from: "opt_a", to: "out_x", edge_type: "causal" });
      graph.edges.push({ from: "opt_b", to: "out_x", edge_type: "causal" });

      const result = validateGraph({ graph: graph as GraphT });
      expect(missingFieldsFor(result, "OBSERVABLE_MISSING_DATA")).not.toContain("value");
    }

    // POSITIVE CONTROL, in the same run: the code IS reachable — just never for
    // `value`. Without this the loop above is satisfied by a validator that
    // emits no observable errors at all, which is the vacuity being fixed.
    const reachable: any = optionConnectedGraph({ value: 0.4 });
    reachable.edges = reachable.edges.filter((e: any) => e.to !== "fac_target");
    reachable.edges.push({ from: "opt_a", to: "out_x", edge_type: "causal" });
    reachable.edges.push({ from: "opt_b", to: "out_x", edge_type: "causal" });
    const control = validateGraph({ graph: reachable as GraphT });
    expect(hasErrorCode(control, "OBSERVABLE_MISSING_DATA")).toBe(true);
    expect(missingFieldsFor(control, "OBSERVABLE_MISSING_DATA")).toEqual(["extractionType"]);
  });

  it("OPPOSITE-DIRECTION TWIN — a factor carrying NEITHER a value NOR an explicit unknown still errors", () => {
    // Relaxing the gate for an explicit unknown is the change. Relaxing it for
    // a factor carrying NOTHING would delete the gate, and the suite would look
    // exactly the same. This is the case that tells the two apart.
    const graph = optionConnectedGraph({
      extractionType: "inferred",
      factor_type: "capacity",
      uncertainty_drivers: ["unstated"],
    });
    // deliberately NO prior, NO value

    const result = validateGraph({ graph: graph as GraphT });
    expect(hasErrorCode(result, "CONTROLLABLE_MISSING_DATA")).toBe(true);
    expect(missingFieldsFor(result, "CONTROLLABLE_MISSING_DATA")).toContain("value");
  });

  it("a MODEL-SUPPLIED prior satisfies the gate too — a stated distribution is a stated level", () => {
    // ⚠⚠ THIS TEST'S VERDICT IS INVERTED FROM ITS FIRST VERSION, AND THE
    // INVERSION IS A DEFECT FIX, NOT A RELAXATION.
    //
    // It used to assert that only an EXPLICITLY-FLAGGED prior satisfied the
    // gate, so a model's own `uniform(0.6, 1.0)` was refused — and
    // `fixControllableMissingData` would then "repair" that refusal by writing
    // `0.5`, reinstating the exact placeholder this PR removes, for precisely
    // the population carrying the MOST information.
    //
    // The gate asks "has this factor's level been stated?", and there are TWO
    // legitimate ways to state it as a distribution: a defensible estimate with
    // its uncertainty, and an admission of ignorance. Both are answers.
    // `prior_is_unquantified` is what tells a downstream reader WHICH — that is
    // a different question, asked by a different predicate (trap 21).
    const graph = optionConnectedGraph({
      extractionType: "inferred",
      factor_type: "retention",
      uncertainty_drivers: ["cohort model"],
    });
    nodeById(graph, "fac_target").prior = { distribution: "uniform", range_min: 0.6, range_max: 1 };

    const result = validateGraph({ graph: graph as GraphT });
    expect(hasErrorCode(result, "CONTROLLABLE_MISSING_DATA")).toBe(false);

    // …and it is NOT thereby relabelled as ignorance. The two predicates must
    // disagree on this node, which is what makes them two predicates.
    expect(factorIsExplicitlyUnquantified(nodeById(graph, "fac_target"))).toBe(false);
  });

  it("an UNEXPRESSIBLE prior does not satisfy the gate — the relaxation is not 'has a prior'", () => {
    // OPPOSITE-DIRECTION TWIN of the case above. A prior PLoT cannot express is
    // not a stated level; accepting it would ship a node ISL centres on a silent
    // 0.0 with no disclosure, which is worse than the placeholder.
    const unexpressible: Array<[string, Record<string, unknown>]> = [
      ["degenerate point mass", { distribution: "uniform", range_min: 0.5, range_max: 0.5 }],
      ["inverted bounds", { distribution: "uniform", range_min: 0.9, range_max: 0.1 }],
      ["non-finite bound", { distribution: "uniform", range_min: 0, range_max: Number.POSITIVE_INFINITY }],
      ["unknown family", { distribution: "beta", range_min: 0, range_max: 1 }],
      ["missing bounds", { distribution: "uniform" }],
    ];

    for (const [name, prior] of unexpressible) {
      const graph = optionConnectedGraph({
        extractionType: "inferred",
        factor_type: "retention",
        uncertainty_drivers: ["cohort model"],
      });
      nodeById(graph, "fac_target").prior = prior;
      const result = validateGraph({ graph: graph as GraphT });
      expect(
        missingFieldsFor(result, "CONTROLLABLE_MISSING_DATA"),
        `an unexpressible prior (${name}) must not satisfy the gate`,
      ).toContain("value");
    }
  });

  it("the OTHER required fields are still required — the relaxation is scoped to `value` alone", () => {
    // A widened predicate is how a gate quietly stops gating. `extractionType`,
    // `factor_type` and `uncertainty_drivers` are separate requirements and the
    // explicit unknown says nothing about any of them.
    const graph = optionConnectedGraph({});
    nodeById(graph, "fac_target").prior = buildUnquantifiedPrior();

    const result = validateGraph({ graph: graph as GraphT });
    expect(hasErrorCode(result, "CONTROLLABLE_MISSING_DATA")).toBe(true);
    const missing = missingFieldsFor(result, "CONTROLLABLE_MISSING_DATA");
    expect(missing).not.toContain("value");
    expect(missing).toContain("extractionType");
    expect(missing).toContain("factor_type");
    expect(missing).toContain("uncertainty_drivers");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D — THE CHANGE IS NOT INERT: W2 MUST NOT REFILL WHAT W1 DECLINED TO INVENT
//
// ⚠ THIS IS THE RISK THAT WOULD MAKE THE WHOLE PR A NO-OP, AND IT IS INVISIBLE
// TO EVERY ASSERTION ABOVE. `fixControllableMissingData` (W2,
// `deterministic-sweep.ts`) writes `value = 0.5` for any controllable factor
// the validator reports as missing one. It is dead today ONLY because W1 got
// there first. Stop W1 writing and W2 inherits the population — unless the
// validator relaxation (block C) removes the violation W2 is gated on.
//
// So the fix has TWO halves and they only work together. This block is the one
// that fails if half of it lands.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// F — THE EMITTED UNKNOWN MUST BE EXPRESSIBLE DOWNSTREAM, AND VALUE-LESS +
//     PRIOR-LESS IS A HARD ERROR HERE, NOT A DOWNSTREAM DISCLOSURE PROBLEM
//
// ⚠⚠ WHY THIS BLOCK IS THE MOST IMPORTANT ONE IN THE FILE FOR SAFETY.
// Measured on the PLoT/ISL half (`robustness_analyzer_v2.py:1907`): ISL never
// fires `ROOT_NODE_DEFAULT_VALUE` for a NON-ROOT factor — and a CONTROLLABLE
// factor is non-root by construction, because an option edge points at it.
//
// So if a controllable factor arrives with no value AND no prior PLoT can
// express, ISL centres it on a SILENT `0.0` with NO disclosure anywhere. That
// is strictly worse than the placeholder this PR removes: `0.5` was at least a
// visible wrong number.
//
// PLoT correctly emits NOTHING for a prior it cannot express (NO UNIVERSAL
// SEMANTIC FALLBACK), so the burden sits HERE, at the producer. These are
// therefore not style assertions about a literal — they are the preconditions
// of the whole change being safe, and each one names the harm it prevents.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// G — A MODEL-SUPPLIED PRIOR IS INFORMATION AND SURVIVES
//
// ⚠⚠ THIS BLOCK EXISTS BECAUSE THE FIRST ROUND OF THIS PR SHIPPED THE EXACT
// HARM IT WAS WRITTEN TO PREVENT, IN THE OPPOSITE DIRECTION.
//
// W1 wrote the ignorance prior UNCONDITIONALLY, so a model's `uniform(0.6, 1.0)`
// — centre 0.8 — became `uniform(0, 1)` STAMPED `prior_is_unquantified: true`.
// That is a FALSE CLAIM OF IGNORANCE about a factor the model had information
// on, and it moves the maths: elasticity is linear in the baseline, so the
// centre shifting 0.8 → 0.5 is a real change to the headline sensitivity.
// Before this PR the prior survived, so it was a REGRESSION, not a gap.
//
// It is not hypothetical. The SERVED prompt is v187 (not `defaults-v19.ts`,
// which is not served) and teaches narrowed ranges; a sweep of all five shipped
// starters found 14 priors, EVERY ONE `uniform` and EVERY ONE NARROWED
// (0.4–0.9, 0.25–0.75, 0.3–0.8, 0.265–0.795 …), and ZERO at exactly (0,1).
// Under the first round every one of those would have been flattened and
// falsely flagged — on the starter corpus a tester meets.
//
// THE TELL WAS UNIFORMITY (CLAUDE.md trap 20): the informative arm and the
// no-prior arm returned byte-identical output. Both cases below are kept in one
// block so that can never be true again unnoticed.
// ═══════════════════════════════════════════════════════════════════════════

describe("G — a model-supplied prior is preserved, never overwritten or relabelled", () => {
  // Ranges taken from the starter sweep, not invented here.
  const STARTER_PRIORS: ReadonlyArray<readonly [number, number]> = [
    [0.4, 0.9],
    [0.25, 0.75],
    [0.3, 0.8],
    [0.265, 0.795],
    [0.6, 1.0],
  ];

  it.each(STARTER_PRIORS.map((r) => [r[0], r[1]] as const))(
    "W1 leaves a model-supplied uniform(%s, %s) exactly as the model wrote it",
    (min, max) => {
      const graph = optionConnectedGraph({ extractionType: "inferred" });
      nodeById(graph, "fac_target").prior = { distribution: "uniform", range_min: min, range_max: max };

      const { response, unquantifiedFactors } = ensureControllableFactorBaselines(graph) as any;
      const factor = nodeById(response, "fac_target");

      // The prior is untouched, bound by VALUE of the model's own bounds.
      expect(factor.prior).toEqual({ distribution: "uniform", range_min: min, range_max: max });
      // …and never relabelled as ignorance, which is the false-claim half.
      expect(factor.prior.prior_is_unquantified).toBeUndefined();
      expect(factorIsExplicitlyUnquantified(factor)).toBe(false);
      expect(unquantifiedFactors).not.toContain("fac_target");
      // The centre the maths uses is the model's, not 0.5.
      expect((factor.prior.range_min + factor.prior.range_max) / 2).toBeCloseTo((min + max) / 2, 10);
    },
  );

  it("RESTORED PIN — a model-supplied uniform(0,1) IS ignorance and is flagged; a narrowed one is not", () => {
    // ⚠⚠ THIS CASE WAS DELETED RATHER THAN UPDATED, AND THAT IS THE REAL LESSON.
    //
    // A test named "a prior WITHOUT the flag does not satisfy the gate either"
    // used `uniform(0, 1)` as its input. When the gate legitimately widened, the
    // input was SWAPPED to `uniform(0.6, 1.0)` — so the `(0,1)` behaviour ended
    // up asserted in NEITHER direction, and a disclosure regression walked
    // straight through a suite that had once covered it. Changing a test's INPUT
    // to keep it green is not the same as updating its verdict: the first
    // silently drops coverage, the second moves it.
    //
    // What makes `(0,1)` different is not arithmetic, it is the SERVED PROMPT.
    // `defaults-v187.ts:514,517-521` teaches the model to encode ignorance as a
    // prior, and `unknown / no qualifier` is exactly `0.0 | 1.0`. So a
    // model-supplied `uniform(0,1)` is the model saying it does not know, in the
    // vocabulary we taught it — not an estimate to preserve. Left unflagged it
    // gave LESS disclosure than staging, which at least stamped
    // `value_tier: "fallback_default"`.
    //
    // ⭐ The range is IDENTICAL before and after; only the disclosure changes.
    const ignorance = optionConnectedGraph({ extractionType: "inferred" });
    nodeById(ignorance, "fac_target").prior = { distribution: "uniform", range_min: 0, range_max: 1 };
    const { response: r1, unquantifiedFactors: u1 } = ensureControllableFactorBaselines(ignorance) as any;
    const flagged = nodeById(r1, "fac_target");

    expect(factorIsExplicitlyUnquantified(flagged)).toBe(true);
    expect(u1).toContain("fac_target");
    // Nothing narrowed, nothing widened — the interval is the one the model gave.
    expect(flagged.prior.range_min).toBe(0);
    expect(flagged.prior.range_max).toBe(1);

    // OPPOSITE DIRECTION, in the same test so the two cannot drift apart: the
    // narrowest possible informative prior is still preserved and still NOT
    // relabelled as ignorance. Without this, flagging everything would pass.
    const informative = optionConnectedGraph({ extractionType: "inferred" });
    nodeById(informative, "fac_target").prior = { distribution: "uniform", range_min: 0, range_max: 0.999 };
    const { response: r2, unquantifiedFactors: u2 } = ensureControllableFactorBaselines(informative) as any;
    const preserved = nodeById(r2, "fac_target");

    expect(factorIsExplicitlyUnquantified(preserved)).toBe(false);
    expect(u2).not.toContain("fac_target");
    expect(preserved.prior).toEqual({ distribution: "uniform", range_min: 0, range_max: 0.999 });
  });

  it("CONTRAST — the same node with NO prior is still marked, so the guard discriminates", () => {
    // ⭐ THE DISCRIMINATION, not merely the preservation. Without this the block
    // above would also pass on a W1 that had simply stopped writing anything —
    // which would be the value-less + prior-less state ISL cannot disclose.
    const graph = optionConnectedGraph({ extractionType: "inferred" });
    const { response, unquantifiedFactors } = ensureControllableFactorBaselines(graph) as any;
    const factor = nodeById(response, "fac_target");

    expect(unquantifiedFactors).toContain("fac_target");
    expect(factorIsExplicitlyUnquantified(factor)).toBe(true);
    expect(factor.prior.range_min).toBe(0);
    expect(factor.prior.range_max).toBe(1);
  });

  it("an UNEXPRESSIBLE model prior is replaced by the honest unknown, not shipped unusable", () => {
    // The third direction, and the reason the guard is `factorHasExpressiblePrior`
    // rather than "has a prior": a malformed prior is not information either, and
    // forwarding it would hand PLoT something it must decline — which lands the
    // node in the silent-0.0 state. Preserving information and shipping garbage
    // are different things.
    for (const prior of [
      { distribution: "uniform", range_min: 0.5, range_max: 0.5 },
      { distribution: "uniform", range_min: 0.9, range_max: 0.1 },
      { distribution: "beta", range_min: 0, range_max: 1 },
    ]) {
      const graph = optionConnectedGraph({ extractionType: "inferred" });
      nodeById(graph, "fac_target").prior = { ...prior };
      const { response } = ensureControllableFactorBaselines(graph) as any;
      const factor = nodeById(response, "fac_target");
      expect(factorIsExplicitlyUnquantified(factor)).toBe(true);
      expect(factor.prior.range_min).toBeLessThan(factor.prior.range_max);
    }
  });

  it("ONE SHAPE FOR ONE CONCEPT — unreachable-factors' collapse emits the SAME flagged prior", async () => {
    // ⭐⭐ BLOCKER 2. The PR body claimed "one mechanism, not two" while
    // `unreachable-factors.ts` still wrote an UNFLAGGED `uniform(0,1)` — two
    // node-level shapes for one concept, of which a downstream discriminator
    // keyed on `prior_is_unquantified` could see only one. This test is what
    // makes the claim true rather than asserted.
    const { handleUnreachableFactors } = await import("../../unified-pipeline/stages/repair/unreachable-factors.js");
    const { FACTOR_VALUE_TIER_FIELD } = await import("../factor-value-provenance.js");

    // A factor unreachable from any option, carrying a STAMPED fabricated
    // baseline — the precondition for the collapse arm. Pinned in-test.
    const graph: any = {
      nodes: [
        { id: "dec_x", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "opt_b", kind: "option", label: "B" },
        { id: "fac_far", kind: "factor", label: "Unreachable", data: { value: 0.5, extractionType: "inferred", [FACTOR_VALUE_TIER_FIELD]: "fallback_default" } },
        { id: "out_x", kind: "outcome", label: "O" },
        { id: "goal_x", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "dec_x", to: "opt_a", edge_type: "structural" },
        { from: "dec_x", to: "opt_b", edge_type: "structural" },
        { from: "opt_a", to: "out_x", edge_type: "causal" },
        { from: "opt_b", to: "out_x", edge_type: "causal" },
        { from: "fac_far", to: "out_x", edge_type: "causal" },
        { from: "out_x", to: "goal_x", edge_type: "causal" },
      ],
    };

    const result = handleUnreachableFactors(graph as GraphT, "from_to" as any);
    expect(result.reclassified).toContain("fac_far"); // precondition fired

    const factor = nodeById(graph, "fac_far");
    // THE SAME SHAPE a downstream reader gets from W1/W3 — byte-for-byte.
    expect(factor.prior).toEqual(buildUnquantifiedPrior());
    expect(factorIsExplicitlyUnquantified(factor)).toBe(true);
  });

  it("…and the OTHER arm stays UNFLAGGED, because a narrowed prior is an estimate, not ignorance", async () => {
    // OPPOSITE-DIRECTION TWIN, and the reason the two arms are legitimately
    // different: `synthesisePriorFromBaseline` narrows around a baseline the
    // system has grounds for. Flagging that would be a false claim of ignorance
    // in the other direction — the same harm as blocker 1, mirrored.
    const { handleUnreachableFactors } = await import("../../unified-pipeline/stages/repair/unreachable-factors.js");
    const graph: any = {
      nodes: [
        { id: "dec_x", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "opt_b", kind: "option", label: "B" },
        // A REAL baseline, no fabrication stamp.
        { id: "fac_far", kind: "factor", label: "Unreachable", data: { value: 0.62, extractionType: "explicit" } },
        { id: "out_x", kind: "outcome", label: "O" },
        { id: "goal_x", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "dec_x", to: "opt_a", edge_type: "structural" },
        { from: "dec_x", to: "opt_b", edge_type: "structural" },
        { from: "opt_a", to: "out_x", edge_type: "causal" },
        { from: "opt_b", to: "out_x", edge_type: "causal" },
        { from: "fac_far", to: "out_x", edge_type: "causal" },
        { from: "out_x", to: "goal_x", edge_type: "causal" },
      ],
    };

    handleUnreachableFactors(graph as GraphT, "from_to" as any);
    const factor = nodeById(graph, "fac_far");
    expect(factor.prior).toBeDefined();
    expect(factorIsExplicitlyUnquantified(factor)).toBe(false);
    // It is narrowed, i.e. genuinely a different shape from the ignorance one.
    expect(factor.prior.range_min > 0 || factor.prior.range_max < 1).toBe(true);
  });
});

describe("F — the emitted prior is expressible, and no factor escapes value-less AND prior-less", () => {
  it("the prior meets every condition PLoT needs to express a uniform parameter-uncertainty", () => {
    const prior = buildUnquantifiedPrior() as unknown as Record<string, unknown>;

    // FAMILY. `schema-v3.ts`'s drift alarm logs an error for any distribution
    // outside `PriorDistribution`, whose only member is "uniform"; a wrong
    // family is passed through unlabelled and PLoT cannot type it.
    expect(prior.distribution).toBe("uniform");

    // FINITE BOUNDS. `NaN`/`Infinity` are numbers to `typeof` and would pass a
    // naive shape check while being unusable as sampler parameters.
    expect(Number.isFinite(prior.range_min as number)).toBe(true);
    expect(Number.isFinite(prior.range_max as number)).toBe(true);

    // NON-DEGENERATE, AND STRICTLY ORDERED. `min === max` is a point mass, not
    // an expression of ignorance, and `min > max` relies on a downstream swap
    // repair we must not depend on. Asserted with `<`, never `<=`.
    expect(prior.range_min as number).toBeLessThan(prior.range_max as number);

    // SPANS THE WHOLE NORMALISED SCALE. A narrower range would be an
    // information claim, which is the exact defect the founder's ruling names.
    expect(prior.range_min).toBe(0);
    expect(prior.range_max).toBe(1);
  });

  it("HARD ERROR — W1 never leaves a factor value-less AND prior-less, across every shape it can meet", () => {
    // A derived invariant, not a restatement: it drives the producer over the
    // shapes that reach it and asserts the postcondition on the OUTPUT, so it
    // REDs if any future branch returns early without writing the prior.
    //
    // "Leave it to downstream disclosure" is not available on this path: the
    // ISL branch that would disclose a default does not fire for a non-root
    // factor, and a controllable factor is non-root by construction.
    const shapes: Array<[string, Record<string, unknown> | undefined]> = [
      ["no data at all", undefined],
      ["empty data bag", {}],
      ["extractionType only", { extractionType: "inferred" }],
      ["a non-numeric value", { value: "not a number", unit: "%" }],
      ["a value that is null", { value: null }],
      ["a value that is NaN-producing text", { value: "£" }],
      ["metadata but no value", { factor_type: "cost", uncertainty_drivers: ["x"] }],
    ];

    for (const [name, data] of shapes) {
      const graph = optionConnectedGraph(data);
      const { response } = ensureControllableFactorBaselines(graph) as any;
      const factor = nodeById(response, "fac_target");

      const hasNumericValue = typeof factor.data?.value === "number";
      const hasExplicitUnknown = factorIsExplicitlyUnquantified(factor);

      // The invariant, written against the SPEC: every factor leaves this
      // producer in ONE of the three legitimate states. Never in neither.
      expect(
        hasNumericValue || hasExplicitUnknown,
        `shape "${name}" left the factor with no value AND no explicit unknown — ` +
          `ISL would silently centre it on 0.0 with no disclosure`,
      ).toBe(true);
    }
  });

  it("DELIBERATE DIFFERENCE FROM THE PRECEDENT — the category is NOT changed to external", () => {
    // ⭐⭐ STATED, NOT ASSUMED, because the shipped precedent does change it.
    // `unreachable-factors.ts` performs THREE actions together:
    //   :449  category = "external"
    //   :496  delete data.value  (+ promote factor_type / extractionType to node level)
    //   :731  write the prior
    //
    // Those are ONE decision with two consequences, not a three-part recipe for
    // "how to say a value is unknown". The decision is the RECLASSIFICATION —
    // the factor is genuinely unreachable from any option, so it genuinely is
    // external. The value deletion and the metadata promotion are then FORCED
    // by `EXTERNAL_HAS_DATA` (`graph-validator.ts:867-875`), which refuses an
    // external factor carrying `value`, `factor_type` or `uncertainty_drivers`.
    //
    // This lane's decision is a different one, and CLAUDE.md trap 21 is exactly
    // about not merging two authorities because their outputs overlap:
    //   `handleUnreachableFactors` answers "is this factor reachable from an option?"
    //   this change answers            "does this factor have a stated level?"
    //
    // Three reasons the category must stay:
    //  1. A controllable factor with an unknown baseline is STILL controllable —
    //     an option acts on it. Reclassifying removes it from the intervention
    //     set, changes the maths, and deletes the very affordance ("set this
    //     factor's value") this change exists to unlock.
    //  2. Setting external would trigger `EXTERNAL_HAS_DATA` and force us to
    //     strip `factor_type` and `uncertainty_drivers` — real information the
    //     model produced, discarded to satisfy a category we chose.
    //  3. The PLoT half is specifically dropping its `category === 'external'`
    //     conjunct so a NON-external factor's prior becomes a uniform
    //     parameter-uncertainty. The two halves are consistent only if the
    //     category stays.
    //
    // Measured with a positive control and a fabricated contrast: no validator
    // rule forbids a prior on a non-external factor; the only prior-adjacent
    // rule is `EXTERNAL_HAS_DATA`, which is about an EXTERNAL factor's `data`.
    const graph = optionConnectedGraph({
      extractionType: "inferred",
      factor_type: "capacity",
      uncertainty_drivers: ["not stated in the brief"],
    });

    const { response } = ensureControllableFactorBaselines(graph) as any;
    const factor = nodeById(response, "fac_target");

    expect(factor.category).toBe("controllable");
    // …and the information the model DID produce is still on the node, which is
    // what the external route would have been forced to strip.
    expect(factor.data.factor_type).toBe("capacity");
    expect(factor.data.uncertainty_drivers).toEqual(["not stated in the brief"]);

    // The graph still validates, i.e. carrying a prior on a controllable factor
    // is not itself an offence. Pinned here so the claim above is derived from
    // the validator rather than asserted from a reading of it.
    const result = validateGraph({ graph: response as GraphT });
    expect(hasErrorCode(result, "CONTROLLABLE_MISSING_DATA")).toBe(false);
    expect(hasErrorCode(result, "EXTERNAL_HAS_DATA")).toBe(false);
  });

  it("W3 obeys the same postcondition on the observable population", () => {
    const graph: any = {
      nodes: [
        { id: "dec_x", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Option A" },
        { id: "fac_obs", kind: "factor", label: "Customer satisfaction", category: "observable", data: {} },
        { id: "goal_x", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_x", to: "opt_a", edge_type: "structural" },
        { from: "fac_obs", to: "goal_x", edge_type: "causal" },
      ],
    };
    fixObservableMissingData(graph as GraphT, [
      { code: "OBSERVABLE_MISSING_DATA", severity: "error", message: "", path: "nodes[fac_obs]" },
    ] as any);

    const factor = nodeById(graph, "fac_obs");
    expect(typeof factor.data?.value === "number" || factorIsExplicitlyUnquantified(factor)).toBe(true);
    expect(factor.prior.range_min).toBeLessThan(factor.prior.range_max);
    expect(factor.category).toBe("observable"); // unchanged here too
  });
});

describe("E — WHAT THE USER NOW SEES: the factor_values slice stops reporting a value that was never stated", () => {
  // ⭐⭐ ACCEPTANCE 5. Removing a dishonest number and saying nothing would
  // replace one dishonesty with another, so this block pins the surface that
  // carries the change to a person.
  //
  // The channel is NOT a repair record. `boundary.ts:42-44`'s
  // `REPAIR_CODE_TO_ADJUSTMENT` allowlist has ONE member
  // (`UNREACHABLE_FACTOR_RECLASSIFIED`), so a sweep repair never becomes a
  // `model_adjustments` row; `ModelAdjustmentCode` is a closed five-value enum,
  // so minting a truthful new code is a cross-repo contract change and is
  // deliberately out of scope here.
  //
  // The channel that DOES reach the user is the `factor_values` context-pack
  // slice, and it is already built and already instructed:
  //   producer     `context/factor-value-record.ts:170` `has_value`, `:175` `without_value_count`
  //   predicate    `provenance/factor-value-provenance.ts` `factorHasExtractedValue`
  //                → `readFactorValueView` reads `observed_state.value` then `data.value`
  //   assembled    `context/context-pack-assembler.ts:1874-1876`
  //   instruction  `routing/route-with-tool-use.ts` FACTOR_VALUES_INSTRUCTION:
  //                "When the count is above 0, name the factors whose
  //                 has_value is false, using their labels as given, and offer
  //                 to set them."
  //
  // It has been DARK for the whole option-connected controllable population,
  // because CEE always supplied a number and `has_value` was therefore always
  // true. This test is the binding between the two.
  //
  // ⚠ RUNG. This is a PRODUCER assertion: it proves the slice reports the gap.
  // It does NOT prove a sentence reached a screen — that needs a live turn.
  it("a factor left explicitly unquantified is reported as has_value:false and counted", async () => {
    const { projectFactorValueRecord } = await import(
      "../../../orchestrator-v5/context/factor-value-record.js"
    );

    const graph = optionConnectedGraph({ extractionType: "inferred" });

    // PRECONDITION PINNED IN-TEST: with a stated value the slice reports no gap,
    // so a green result below is the change's doing and not the fixture's.
    const stated = optionConnectedGraph({ value: 0.42, extractionType: "explicit" });
    const before = projectFactorValueRecord(stated) as any;
    expect(before.without_value_count).toBe(0);
    expect(before.factors.find((f: any) => f.label === "Support headcount").has_value).toBe(true);

    const { response } = ensureControllableFactorBaselines(graph) as any;
    const after = projectFactorValueRecord(response) as any;

    // Bound by the factor's LABEL as the slice emits it — which is also the
    // string the instruction tells the model to use when naming it back.
    const entry = after.factors.find((f: any) => f.label === "Support headcount");
    expect(entry).toBeDefined();
    expect(entry.has_value).toBe(false);
    expect(after.without_value_count).toBe(1);
  });

  it("the ignorance prior does NOT masquerade as a value to that slice", () => {
    // The prior is the honest representation of the gap; it must not close the
    // gap. `readFactorValueView` reads `observed_state.value` and `data.value`
    // and never `prior`, so this is a derived guard on that boundary rather
    // than a restatement of it — it REDs if a future change starts reading a
    // prior as a value and quietly re-darkens the surface above.
    const marked: any = { id: "fac_x", kind: "factor", label: "L", prior: buildUnquantifiedPrior() };
    expect(factorIsExplicitlyUnquantified(marked)).toBe(true);
    expect(marked.data?.value).toBeUndefined();
    expect(marked.observed_state).toBeUndefined();
  });
});

describe("D — W2 stays dead: no second writer refills the value", () => {
  it("after W1 marks the factor, the validator reports no violation for W2 to repair", () => {
    const graph = optionConnectedGraph({
      extractionType: "inferred",
      factor_type: "capacity",
      uncertainty_drivers: ["not stated in the brief"],
    });

    const { response } = ensureControllableFactorBaselines(graph) as any;
    const result = validateGraph({ graph: response as GraphT });

    // W2's ENTIRE gate is `violations.filter(v => v.code === "CONTROLLABLE_MISSING_DATA")`
    // being non-empty. Assert the gate's own input, not a proxy for it.
    expect(hasErrorCode(result, "CONTROLLABLE_MISSING_DATA")).toBe(false);

    // …and the end state a user would receive: still no invented number.
    expect(nodeById(response, "fac_target").data?.value).toBeUndefined();
    expect(factorIsExplicitlyUnquantified(nodeById(response, "fac_target"))).toBe(true);
  });
});
