/**
 * WS-A ITEM 1(a) — THE PROVENANCE PREDICATE MUST BE FED THE MAGNITUDE THE
 * ENCODING DENOTES, NOT THE NORMALISED LEVER LEVEL.
 *
 * MEASURED DEFECT (L2B-VARIANCE.md §2.4, arch-decision-2026-08-11, CEE
 * `8e3ad916`): `isAmountStatedInBrief` compares a NORMALISED lever level
 * (0.72) against the brief's RAW stated magnitudes (30000 / 18000 / 6000).
 * `factor.observed_state.cap` — the denominator the producer itself declared —
 * is in scope one line above the call and is never applied. Over the archived
 * corpus that made the predicate STRUCTURALLY INCAPABLE of firing: 117 of 117
 * interventions stamped `cee_hypothesis` / `low` / "this amount is not stated
 * in the brief", 0 of 117 values above 1, while the £0 status-quo baseline was
 * stamped `brief_extraction`. The user's own £18,000 was badged invented and
 * £0 was badged as theirs.
 *
 * This is CLAUDE.md trap 13d's shape: the guard is correct AS WRITTEN and
 * pointed at the wrong bytes. The repair is therefore to the FEED, not to the
 * predicate's own semantics — `isAmountStatedInBrief(value, unit, brief)`
 * still answers exactly the question it always answered.
 *
 * PRODUCER SEMANTICS, DERIVED AT THE BYTES rather than inferred from the
 * symptom (trap 13c — a mutant kit validates sensitivity, never the oracle):
 * `normaliseFactorValue` (d1-shared/normalise-factor-value.ts) stores
 * `value = raw / cap` for EVERY capped factor and `value = raw` when uncapped.
 * The inverse is therefore `raw = value × cap`, and it is not re-derived here:
 * the de-normalisation delegates to `resolveExistingRawValue`, the shared
 * inverse the validator, the executor precheck and the `set_factor_value`
 * handler already agree on (the AC.1 parity invariant).
 *
 * BINDING IS BY IDENTITY (trap 19). Every assertion names THE run, THE option
 * and THE factor from the capture — `A/r9` `opt_switch_hubspot` →
 * `fac_switch_cost` — so a different object satisfying the same shape cannot
 * keep this suite green.
 */

import { describe, it, expect } from "vitest";

import { extractOptionsFromNodes } from "../../extraction/intervention-extractor.js";
import { isAmountStatedInBrief } from "../stated-amounts.js";
import type { NodeV3T, EdgeV3T } from "../../../schemas/cee-v3.js";
import { L2B_CAPTURED_RUNS, type CapturedRun } from "./fixtures/l2b-arch-decision-captures.js";

function runOf(arm: string, run: string): CapturedRun {
  const found = L2B_CAPTURED_RUNS.find((r) => r.arm === arm && r.run === run);
  if (found === undefined) throw new Error(`fixture precondition failed: ${arm}/${run} absent`);
  if (!found.drafted) throw new Error(`fixture precondition failed: ${arm}/${run} has no draft`);
  return found;
}

/** Rebuild the extractor's inputs from a captured run, verbatim. */
function extractFrom(capture: CapturedRun) {
  const factors = (capture.factors ?? []).map((f) => {
    const node: Record<string, unknown> = { id: f.id, kind: "factor", label: f.label };
    if (f.observed_state !== null) node.observed_state = f.observed_state;
    return node as unknown as NodeV3T;
  });
  const optionInputs = (capture.options ?? []).map((o) => ({
    id: o.id,
    label: o.label,
    v4Interventions: o.interventions,
  }));
  return extractOptionsFromNodes(optionInputs, factors, [] as EdgeV3T[], "goal", [], capture.brief);
}

function interventionOf(
  options: ReturnType<typeof extractFrom>,
  optionId: string,
  factorId: string,
) {
  const option = options.find((o) => o.id === optionId);
  if (!option) throw new Error(`fixture precondition failed: option ${optionId} absent`);
  const intervention = option.interventions?.[factorId];
  if (!intervention) {
    throw new Error(`fixture precondition failed: intervention ${optionId}→${factorId} absent`);
  }
  return intervention;
}

describe("WS-A 1(a) — a stated amount encoded as level × cap is recognised as stated", () => {
  it("stamps A/r9 opt_switch_hubspot→fac_switch_cost brief_extraction/high (0.72 × cap 25000 = the stated £18,000)", () => {
    const capture = runOf("A", "r9");

    // PRECONDITION PINNED IN-TEST (trap 13b, third face): this assertion is
    // only about the fix if the fixture really carries the normalised pair.
    // A capture whose cap or level drifted would otherwise let the test pass
    // for the wrong reason.
    const factor = (capture.factors ?? []).find((f) => f.id === "fac_switch_cost");
    expect(factor?.observed_state).toMatchObject({ unit: "£", cap: 25000 });
    expect((capture.options ?? []).find((o) => o.id === "opt_switch_hubspot")?.interventions)
      .toMatchObject({ fac_switch_cost: 0.72 });
    expect(capture.brief).toContain("£18,000");
    // And the normalised level is NOT itself locatable in the brief — so a
    // green result here cannot come from the pre-fix comparison succeeding.
    expect(isAmountStatedInBrief(0.72, "£", capture.brief)).toBe(false);

    const intervention = interventionOf(extractFrom(capture), "opt_switch_hubspot", "fac_switch_cost");
    expect(intervention.source).toBe("brief_extraction");
    expect(intervention.value_confidence).toBe("high");
    expect(intervention.reasoning).not.toContain("not stated in the brief");
    // The VALUE is never rewritten — only the label it had not earned.
    expect(intervention.value).toBe(0.72);
  });

  it("leaves A/r9 opt_switch_hubspot→fac_training_cost cee_hypothesis/low (0.24 × cap 6000 = £1,440, which the brief never states)", () => {
    // The discriminating twin. The same option, the same run, the same fix:
    // one intervention earns the label and the other does not. A blanket
    // upgrade — the ROADMAP 2.972 over-claim this predicate was introduced to
    // withdraw — fails HERE while the assertion above stays green.
    const capture = runOf("A", "r9");
    const factor = (capture.factors ?? []).find((f) => f.id === "fac_training_cost");
    expect(factor?.observed_state).toMatchObject({ unit: "£", cap: 6000 });
    expect(capture.brief).toContain("£6,000");

    const intervention = interventionOf(extractFrom(capture), "opt_switch_hubspot", "fac_training_cost");
    expect(intervention.source).toBe("cee_hypothesis");
    expect(intervention.value_confidence).toBe("low");
    expect(intervention.value).toBe(0.24);
  });

  it("stamps A/r1 opt_hubspot→fac_training_cost brief_extraction/high (0.6 × cap 10000 = the stated £6,000)", () => {
    // A SECOND run, a DIFFERENT cap convention (10000 rather than 6000) and a
    // different option id — so the first assertion cannot be passing on a
    // single lucky arithmetic coincidence.
    const capture = runOf("A", "r1");
    expect((capture.factors ?? []).find((f) => f.id === "fac_training_cost")?.observed_state)
      .toMatchObject({ unit: "£", cap: 10000 });

    const intervention = interventionOf(extractFrom(capture), "opt_hubspot", "fac_training_cost");
    expect(intervention.source).toBe("brief_extraction");
    expect(intervention.value_confidence).toBe("high");
  });

  it("leaves a non-currency lever untouched: A/r9 opt_switch_hubspot→fac_crm_capability stays cee_hypothesis", () => {
    // `fac_crm_capability` is `unit: "scale", cap: 1`. De-normalising it
    // yields 0.8, which is not a stated amount in any currency — and a "scale"
    // unit must never be matched against a £ statement. Guards the direction
    // the whole module fails toward: under-claim, never over-claim.
    const capture = runOf("A", "r9");
    const intervention = interventionOf(extractFrom(capture), "opt_switch_hubspot", "fac_crm_capability");
    expect(intervention.source).toBe("cee_hypothesis");
    expect(intervention.value_confidence).toBe("low");
  });

  it("de-normalises ONLY when the producer declared a cap — a capless call is byte-identical to today", () => {
    // The whole pinned 2.972 corpus calls this predicate with three
    // arguments. The cap parameter is additive: absent ⇒ the pre-existing
    // comparison, exactly.
    expect(isAmountStatedInBrief(0.9, "£m", "we'd need £900k a year fully loaded")).toBe(true);
    expect(isAmountStatedInBrief(900_000, "£", "we'd need £900k a year fully loaded")).toBe(true);
    expect(isAmountStatedInBrief(0.72, "£", "switching would cost roughly £18,000 one-off")).toBe(false);
    // …and with the cap, the same normalised level resolves.
    expect(isAmountStatedInBrief(0.72, "£", "switching would cost roughly £18,000 one-off", 25000)).toBe(true);
  });

  it("refuses a cap that cannot denote a scale: zero, negative, and non-finite all fall back to the raw comparison", () => {
    // `evaluateFactorValueProposal` guarantees a positive cap on the write
    // path, so these are off-contract graphs. The safe reading of an
    // off-contract denominator is to ignore it, never to divide by it.
    const brief = "switching would cost roughly £18,000 one-off";
    expect(isAmountStatedInBrief(18_000, "£", brief, 0)).toBe(true);
    expect(isAmountStatedInBrief(18_000, "£", brief, -25_000)).toBe(true);
    expect(isAmountStatedInBrief(18_000, "£", brief, Number.NaN)).toBe(true);
    expect(isAmountStatedInBrief(0.72, "£", brief, 0)).toBe(false);
  });

  it("an already-raw level with a cap is NOT multiplied twice", () => {
    // A normalised value is always in [0,1] (`normaliseFactorValue` divides by
    // the cap); a stored value outside that range is an off-contract graph
    // carrying an already-raw magnitude. `resolveExistingRawValue` reads it as
    // raw, so 18000 × 25000 is never computed.
    expect(isAmountStatedInBrief(18_000, "£", "switching would cost roughly £18,000 one-off", 25_000))
      .toBe(true);
  });
});
