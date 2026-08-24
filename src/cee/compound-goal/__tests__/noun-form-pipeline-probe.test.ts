/**
 * PROBE — does a minted noun-form row SURVIVE the rest of the drafter?
 *
 * ⚠ MINTING IS NOT REACHING. The corpus spec measures `extractCompoundGoals`
 * in isolation, which is the right instrument for the recogniser and the wrong
 * one for the product: between the extractor and `graph.goal_constraints[]`
 * sit `remapConstraintTargets` (which BINS any row whose target stem is under
 * four characters — `fac_cap`, `fac_max` — and any row it cannot bind to a
 * node) and `partitionUnprovenDirection` (which withholds any row whose
 * direction it cannot prove). A fix measured only at the extractor can be
 * completely green while every new row is dropped one hop later.
 *
 * ── WHAT THIS FILE'S GRAPH IS, AND WHY ────────────────────────────────────
 * The graph offered to `remapConstraintTargets` is the set of node ids the
 * extractor itself asked for. That is deliberate and it is NOT a claim that a
 * real drafted graph contains them: it holds node binding constant so the
 * measurement isolates THE DIRECTION GATE. A first cut of this probe used a
 * fixed five-node graph and reported eight extra casualties — every one of
 * them a target absent from that graph (`fac_gross_margin`, `fac_total_spend`,
 * `fac_unspecified`), i.e. the PROBE's artefact and not the product's
 * behaviour. Binding against a real drafted graph is a different question with
 * a different answer, and this file does not pretend to answer it.
 */

import { describe, it, expect } from "vitest";
import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
  remapConstraintTargets,
} from "../index.js";
import { partitionUnprovenDirection } from "../direction-gate.js";
import corpus from "./fixtures/intake-constraint-reviewer-corpus.json" with { type: "json" };

interface ReviewerCase {
  id: string;
  brief: string;
  expect: "fire" | "silent";
}
const CASES = (corpus as { cases: ReviewerCase[] }).cases;

function throughPipeline(brief: string) {
  const extracted = extractCompoundGoals(brief, { includeProxies: false });
  if (extracted.constraints.length === 0) {
    return { minted: 0, bound: 0, proven: 0, reasons: [] as string[] };
  }
  const targets = [...new Set(extracted.constraints.map((c) => c.targetNodeId))];
  const remapped = remapConstraintTargets(extracted.constraints, targets, new Map(), "probe", undefined);
  const bound = toGoalConstraints(normaliseConstraintUnits(remapped.constraints));
  const partition = partitionUnprovenDirection(bound, brief, new Map());
  return {
    minted: extracted.constraints.length,
    bound: bound.length,
    proven: partition.proven.length,
    reasons: partition.unresolved.map((u) => u.reason as string),
  };
}

/** The eleven noun forms this lane closed, by corpus id. */
const NOUN_FORM_IDS = ["H1", "H5", "H7", "I3", "I4", "I8", "I9", "R3", "R8", "R9", "R10"];

/**
 * ⚠ TWO OF THE ELEVEN ARE MINTED, BOUND, AND THEN WITHHELD BY THE #888
 * DIRECTION GATE — AND THIS LANE DELIBERATELY DID NOT FIX IT.
 *
 *   H7  "The budget of £120,000 is fixed and cannot move."
 *   R3  "…the goal is to avoid downtime on a £90,000 budget."
 *
 * Both are withheld `unspent_negation`: the gate's negation screen is
 * SENTENCE-scoped, so `cannot` and `avoid` reach a noun form whose direction
 * was never in doubt. A budget is a ceiling by definition — there is no
 * direction here for a negation to reverse, which is precisely why the noun
 * path reads it without the direction machinery. The gate does not know that.
 *
 * Correcting it means editing the 1,882-line direction predicate that cost
 * this programme four consecutive rounds of oscillation, and this lane's brief
 * makes that an explicit STOP. So it is REPORTED, not fixed, and pinned here
 * with its exact reason so it cannot be mistaken for a gap in the recogniser.
 *
 * Note what withheld does NOT mean: the row is not silently lost. The gate
 * raises a direction clarification, so the user is ASKED — the #888 exit of
 * making the ambiguity the product. It is a degraded outcome, not a wrong one.
 */
const GATE_WITHHELD_NOUN_FORMS = new Set(["H7", "R3"]);

describe("noun-form rows — survival through remap and the direction gate", () => {
  it("collects the corpus (a shrunk fixture voids every number here)", () => {
    expect(CASES).toHaveLength(72);
    expect(NOUN_FORM_IDS).toHaveLength(11);
  });

  it("nine of the eleven newly-recognised noun forms reach goal_constraints[] with direction PROVEN", () => {
    const withheld: string[] = [];
    for (const id of NOUN_FORM_IDS) {
      const c = CASES.find((x) => x.id === id);
      expect(c, `corpus case ${id} is missing`).toBeDefined();
      const r = throughPipeline(c!.brief);
      // Every one of the eleven is MINTED and BOUND — that is this lane's work
      // and it holds for all eleven without exception.
      expect(r.minted, `${id} minted nothing`).toBeGreaterThan(0);
      expect(r.bound, `${id} bound nothing`).toBeGreaterThan(0);
      if (r.proven === 0) withheld.push(id);
    }
    expect(new Set(withheld)).toEqual(GATE_WITHHELD_NOUN_FORMS);
  });

  it("names the gate's reason for each withheld row, so a different cause cannot hide behind the same count", () => {
    for (const id of GATE_WITHHELD_NOUN_FORMS) {
      const c = CASES.find((x) => x.id === id)!;
      expect(throughPipeline(c.brief).reasons, id).toContain("unspent_negation");
    }
  });

  it("records the residual population — stated limits that still produce NO proven row", () => {
    const residual = CASES.filter(
      (c) => c.expect === "fire" && throughPipeline(c.brief).proven === 0,
    ).map((c) => c.id);

    // THE BACKSTOP POPULATION, pinned exactly so it cannot grow unnoticed:
    //   7 never recognised  — verb/comparative/temporal forms this lane did not touch
    //   3 recognised, withheld by the direction gate — H7, R3 (noun, above) and
    //     I10 ("We must not go over £50,000", a pre-existing verb form withheld
    //     `evidence_contradiction`).
    expect(new Set(residual)).toEqual(
      new Set(["I2", "I5", "I6", "I11", "I12", "I13", "R4", "H7", "R3", "I10"]),
    );
  });
});
