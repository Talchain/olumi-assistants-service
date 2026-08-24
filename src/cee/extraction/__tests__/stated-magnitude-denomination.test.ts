/**
 * B1-b — THE FACTOR'S OWN DENOMINATION BOUNDS THE STATED-MAGNITUDE ROUTE.
 *
 * PROVENANCE OF THIS CORPUS: it was written by the ADVERSARIAL REVIEWER of
 * #1081, from outside the author's head, and it REFUTED the first version of
 * the fix on six input classes (6 failed | 1 passed at `e013d6cb`). It is
 * adopted here verbatim in substance and kept as the load-bearing evidence for
 * this predicate, per CLAUDE.md trap 22c: for a predicate over user-supplied
 * text, the author's corpus is a development aid and the REVIEWER's corpus is
 * the evidence. R7/R8 were added by the author afterwards.
 *
 * Expectations are written against the SPEC stated in `stated-amounts.ts`, NOT
 * against the failure mode this PR was written to fix (CLAUDE.md trap 13d):
 *
 *   "CURRENCY IDENTITY IS REQUIRED. ... A £-denominated value is not made
 *    brief-backed by a €-denominated statement" (stated-amounts.ts, DELIBERATE
 *    REFUSALS)
 *
 *   "A CURRENCY-DENOMINATED STATEMENT NEVER MATCHES A UNIT WE COULD NOT READ
 *    ... a €/£/$ in the brief is an explicit statement of denomination and a
 *    unit we cannot read tells us nothing about whether the two are the same
 *    quantity. It covers word forms, bare magnitudes, unitless values, and
 *    every spelling nobody has thought of." (magnitudeAppearsInBrief)
 *
 * Each case is the OPPOSITE-DIRECTION TWIN of the PR's happy path: the harm is
 * attributing to the user a denomination or quantity they never wrote.
 *
 * ⚠ R8 IS WHAT STOPS THIS FILE BEING SATISFIED BY A BLANKET REFUSAL. Every case
 * R1-R7 is a refusal, so a fix reading "never fire when the factor declares any
 * unit at all" would score 7/7 here while destroying the capability. R8 is the
 * discriminating twin: a factor that declares the SAME currency the brief states
 * must still earn the attribution. The pair R1+R8 is the evidence that the
 * predicate discriminates on currency IDENTITY rather than on unit PRESENCE.
 */
import { describe, it, expect } from "vitest";
import type { NodeV3T } from "../../../schemas/cee-v3.js";
import { extractInterventionsForOption } from "../intervention-extractor.js";

const GOAL = "goal01";
const OPTION_NODE = "682a7e2d";
const F = "fd255d32";

const BRIEF =
  "A full switch costs £20,000 in migration and training. Our annual Salesforce licensing is £45,000.";

function run(observed: Record<string, unknown>, raw: number, level: number, label = "Migration and Training Cost") {
  const nodes: NodeV3T[] = [
    { id: GOAL, kind: "goal", label: "Goal", provenance: "from_brief" } as unknown as NodeV3T,
    { id: F, kind: "factor", label, provenance: "ai_inferred", observed_state: observed } as unknown as NodeV3T,
  ];
  const o = extractInterventionsForOption(
    "switch CRM", undefined, nodes, [], GOAL, new Set<string>(), [],
    { [F]: level }, OPTION_NODE, BRIEF, { [F]: raw }, undefined,
  );
  return o.interventions[F];
}

describe("REFUTATION — the currency-identity refusal must survive the raw-magnitude route", () => {
  it("POSITIVE CONTROL: the PR's intended fix still fires on a unitless scaleless factor", () => {
    const iv = run({ value: 0.5, source: "cee_inference" }, 20000, 0.4);
    expect(iv?.source).toBe("brief_extraction"); // the fix works — probe is live
  });

  it("R1: a USD-denominated factor must NOT be certified by a GBP statement", () => {
    const iv = run({ value: 0.5, source: "cee_inference", unit: "USD" }, 20000, 0.4);
    expect(iv?.source).toBe("cee_hypothesis");
  });

  it("R2: a $-denominated factor must NOT be certified by a £ statement", () => {
    const iv = run({ value: 0.5, source: "cee_inference", unit: "$" }, 20000, 0.4);
    expect(iv?.source).toBe("cee_hypothesis");
  });

  it("R3: a £m-denominated factor must NOT be certified by a £20,000 statement (10^6 skew)", () => {
    const iv = run({ value: 0.5, source: "cee_inference", unit: "£m" }, 20000, 0.4);
    // raw 20000 under unit "£m" denotes £20,000,000,000 — six orders from the brief.
    expect(iv?.source).toBe("cee_hypothesis");
  });

  it("R4: a percent-denominated factor must NOT be certified by a currency statement", () => {
    const iv = run({ value: 0.5, source: "cee_inference", unit: "%" }, 20000, 0.4);
    expect(iv?.source).toBe("cee_hypothesis");
  });

  it("R5: an unreadable-unit factor ('customers') must NOT be certified by a currency statement", () => {
    const iv = run({ value: 0.5, source: "cee_inference", unit: "customers" }, 20000, 0.4);
    expect(iv?.source).toBe("cee_hypothesis");
  });

  it("R7: a raw ZERO must not be relabelled as a stated amount, even against a brief that writes £0", () => {
    // Zero is the model's commonest default and the valid status-quo control.
    // `transforms/analysis-ready.ts` already rules that it "must never be
    // relabelled as the stated switch cost"; this route obeys the same ruling.
    const nodes: NodeV3T[] = [
      { id: GOAL, kind: "goal", label: "Goal", provenance: "from_brief" } as unknown as NodeV3T,
      { id: F, kind: "factor", label: "Migration and Training Cost", provenance: "ai_inferred",
        observed_state: { value: 0.5, source: "cee_inference" } } as unknown as NodeV3T,
    ];
    const o = extractInterventionsForOption(
      "stay put", undefined, nodes, [], GOAL, new Set<string>(), [],
      { [F]: 0 }, OPTION_NODE, "Staying put costs £0 up front and £45,000 a year.",
      { [F]: 0 }, undefined,
    );
    expect(o.interventions[F]?.source).toBe("cee_hypothesis");
  });

  it("R8 (DISCRIMINATING TWIN): a GBP-declared factor IS certified by the GBP statement", () => {
    // Without this case, "refuse whenever a unit is declared" would pass R1-R7.
    // The refusal must key on currency IDENTITY, not on unit PRESENCE.
    const iv = run({ value: 0.5, source: "cee_inference", unit: "£" }, 20000, 0.4);
    expect(iv?.source).toBe("brief_extraction");
    expect(iv?.unit).toBe("£");
  });

  it("R9 (THE GATE DISCRIMINATOR): a DECIDED not_stated verdict is not overturned even when the factor's currency MATCHES", () => {
    // ⚠ R6 BELOW DOES NOT PIN THE GATE, AND THAT WAS ONLY FOUND BY MUTATION.
    // Widening the gate back to `!statedInBrief` leaves R6 GREEN, because its
    // "headcount" unit is refused by the denomination guard long before the gate
    // matters — a guard agreeing with itself (CLAUDE.md trap 13b). This case
    // removes that masking: the factor declares "£", the brief states £20,000, and
    // the ONLY thing preventing attribution is that the verdict is `not_stated`
    // (cap 100,000 × level 0.5 = £50,000, which the brief does not state) rather
    // than `undecidable`. Measured: at HEAD this is cee_hypothesis; under the
    // gate-widening mutant it flips to brief_extraction. R6 does not move either way.
    const iv = run({ value: 0.5, cap: 100000, raw_value: 50000, unit: "£" }, 20000, 0.5);
    expect(iv?.source).toBe("cee_hypothesis");
    expect(iv?.reasoning).toContain("not stated in the brief");
  });

  it("R6: a decided not_stated verdict on a non-currency capped factor stays disowned", () => {
    // cap present ⇒ resolveMagnitudeScale = {kind:"cap"}; magnitude 20000 is
    // decidable and the authority answers not_stated (unit 'headcount' vs a £
    // statement). At pristine this reads: "this amount is not stated in the brief".
    const iv = run({ value: 0.2, cap: 100000, raw_value: 20000, unit: "headcount" }, 20000, 0.2);
    expect(iv?.source).toBe("cee_hypothesis");
    expect(iv?.reasoning).toContain("not stated in the brief");
  });
});
