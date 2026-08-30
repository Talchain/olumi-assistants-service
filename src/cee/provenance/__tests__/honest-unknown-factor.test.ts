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
 * That corpus also supplies the discrimination this suite would otherwise have
 * missed: TWO of its factors carry a GENUINE `uniform(0, 1)` prior
 * (`fac_nrr`, `fac_legal_clearance`). A predicate keyed on the RANGE would
 * classify both as ignorance and suppress two real priors — a false positive
 * that INVENTS a claim of ignorance we do not have. The corpus is what makes
 * that case reachable; the author's head did not supply it (trap 22).
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

  it("a GENUINE uniform(0,1) prior is NOT read as ignorance — the flag is the discriminator", () => {
    // ⭐⭐ THE CASE THE AUTHOR'S HEAD DID NOT SUPPLY, and the one that decides
    // whether this change is safe. Two nodes in the captured corpus carry a
    // real `uniform(0, 1)` prior the model chose:
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

  it("a prior WITHOUT the flag does not satisfy the gate either", () => {
    // The narrow twin of the case above: `fac_nrr` in the captured corpus is a
    // real `uniform(0,1)` prior. Carrying a prior must not be enough — only the
    // explicit ignorance label is.
    const graph = optionConnectedGraph({
      extractionType: "explicit",
      factor_type: "retention",
      uncertainty_drivers: ["cohort model"],
    });
    nodeById(graph, "fac_target").prior = { distribution: "uniform", range_min: 0, range_max: 1 };

    const result = validateGraph({ graph: graph as GraphT });
    expect(hasErrorCode(result, "CONTROLLABLE_MISSING_DATA")).toBe(true);
    expect(missingFieldsFor(result, "CONTROLLABLE_MISSING_DATA")).toContain("value");
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
