/**
 * ⭐⭐⭐ AN OPTION PRICED AT £0.85 AGAINST £80,000 — WITNESSED LIVE, PINNED AS AN
 * EXACT KNOWN GAP. Not fixed here: two fixes were tried and both were refuted.
 *
 * One captured draw on the served build, 16 Sep 2026 (instruction sha `52c1c94a`
 * = v17, model `claude-sonnet-4-6`, PMS prompt v201), on Paul's own brief.
 * Factor "Hiring and Onboarding Cost", `scale_frame` 200000 — the user's budget:
 *
 *     hire a Tech lead                       raw 80000   ->  0.4
 *     two developers                         raw 120000  ->  0.6
 *     Hire One Tech Lead and One Developer   raw 0.85    ->  0.00000425
 *
 * ~141,000x understated. On a product that ranks options, an option costing
 * nothing can win on a number nobody authored.
 *
 * ⭐ THE MECHANISM, established by comparing the two captured stages rather than
 * argued. BEFORE the completion pass, the hybrid was the ONLY option carrying
 * interventions — 0.6 / 0.85 / 0.5, a coherent UNIT-INTERVAL set, framed against
 * itself. Its siblings had none, because the one-edge rule had refused their
 * links. The completion pass then recovered those links onto the stated options
 * and valued them in REAL POUNDS (80000 / 120000 — neither appears anywhere in
 * the pass-1 record set). Pass 3d then derives ONE frame from the NOW-MIXED
 * population and divides everything by it. The hybrid's already-normalised 0.85
 * is normalised a second time, against a population it was never authored
 * beside.
 *
 * ⛔ FIX ATTEMPT 1 — REFUSE A SUB-UNIT MAGNITUDE BESIDE AN ABSOLUTE ONE.
 * Refuted by `projector-scale-projection.test.ts`, which asserts the opposite
 * deliberately and gives its reason: "The grammar's own contract: sets_to is
 * 'in the same unit the factor is measured in'. A £0.50 beside £50,000 is
 * projected by the SAME frame — the projector honours the record rather than
 * second-guessing it." Its example is penny pricing versus enterprise pricing,
 * which is a REAL strategy. Magnitude alone cannot tell penny pricing from a
 * convention clash, so a magnitude rule is wrong.
 *
 * ⛔ FIX ATTEMPT 2 — the same rule with zero excluded. The existing
 * `source-authority-option-magnitude` suite caught it immediately: a status quo
 * that spends nothing sets a cost factor to exactly 0, and my first predicate
 * deleted that legitimate £0 alongside the intruder. Four cases went red on
 * `expected undefined to be +0`. Corrected, and then attempt 1's refutation
 * still stands.
 *
 * ⭐ SO THE DISCRIMINATOR IS NEITHER MAGNITUDE NOR SIGN. It is that a magnitude
 * authored BEFORE the completion pass was framed against a different population
 * than the one pass 3d finally frames against. Choosing between re-basing the
 * completion's magnitudes, re-deriving the pass-1 ones, or framing per pass is a
 * design decision that interacts with the penny-pricing contract above, and it
 * belongs to whoever owns that contract — not to a guard bolted on here.
 *
 * This file therefore pins the DEFECT so it cannot be lost or silently closed.
 */
import { describe, expect, it } from "vitest";

import { projectDraftRecords } from "../seam.js";
import type { DraftRecordSet } from "../grammar.js";

function project(r: DraftRecordSet) {
  const out = projectDraftRecords(r, undefined);
  if (!out.ok) throw new Error(`projection failed: ${out.reason}`);
  return out.projection as unknown as { graph: { nodes: ReadonlyArray<Record<string, any>> } };
}
const ivOf = (r: DraftRecordSet, optLabel: string, facLabel: string) => {
  const p = project(r);
  const fac = p.graph.nodes.find((n) => n.kind === "factor" && n.label === facLabel);
  const opt = p.graph.nodes.find((n) => n.kind === "option" && n.label === optLabel);
  const iv = (opt?.data?.interventions ?? {}) as Record<string, number>;
  return fac === undefined ? undefined : iv[String(fac.id)];
};

/** The live shape: two pound magnitudes and one unit-interval one, on one factor. */
const COLLIDING = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "increase productivity while maintaining code quality", role: "target" },
      { kind: "option", source_quote: "hire a Tech lead" },
      { kind: "option", source_quote: "two developers" },
    ],
    claims: [
      { claim_kind: "factor", label: "Hiring and Onboarding Cost", basis: [] },
      { claim_kind: "outcome", label: "Delivery Speed to Launch", basis: [] },
      { claim_kind: "option_refinement", label: "Hire One Tech Lead and One Developer", basis: [1, 2] },
      { claim_kind: "causal_link", label: "lead costs", from_stated: 1, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 80000 },
      { claim_kind: "causal_link", label: "devs cost", from_stated: 2, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 120000 },
      { claim_kind: "causal_link", label: "hybrid costs", from_claim: 2, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 0.85 },
      { claim_kind: "causal_link", label: "cost slows delivery", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.4 },
      { claim_kind: "causal_link", label: "delivery drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

describe("C1 — the live defect, pinned exactly", () => {
  it("C1a KNOWN GAP: the odd-one-out is priced at effectively zero", () => {
    expect(
      ivOf(COLLIDING(), "Hire One Tech Lead and One Developer", "Hiring and Onboarding Cost"),
      "reproduces the live witness; when this stops being ~4e-06 the gap has been closed DELIBERATELY",
    ).toBeCloseTo(0.00000425, 10);
  });

  it("C1b and its siblings are priced correctly, so the harm is one option not the factor", () => {
    const r = COLLIDING();
    expect(ivOf(r, "hire a Tech lead", "Hiring and Onboarding Cost"), "80000 / 200000").toBeCloseTo(0.4, 6);
    expect(ivOf(r, "two developers", "Hiring and Onboarding Cost"), "120000 / 200000").toBeCloseTo(0.6, 6);
  });

  it("C1c CONTRAST — a £0 status quo must keep its zero, which fix attempt 2 broke", () => {
    // Pinned here because my own first predicate deleted it: 0 means "none of
    // this" at every scale and is never evidence of a second convention.
    const r = COLLIDING();
    const withZero = {
      ...r,
      claims: [
        ...r.claims,
        { claim_kind: "option_refinement", label: "Do Nothing", basis: [1] },
        { claim_kind: "causal_link", label: "nothing costs nothing", from_claim: 8, to_claim: 0, effect: "positive", strength: 0.1, sets_to: 0 },
      ],
    } as unknown as DraftRecordSet;
    const v = ivOf(withZero, "Do Nothing", "Hiring and Onboarding Cost");
    if (v !== undefined) expect(v, "a legitimate zero survives").toBe(0);
  });
});
