/**
 * ⭐⭐ THE HOLE THAT MEASUREMENT FOUND, AND IT INVERTED THE FIX I WAS ABOUT TO SHIP.
 *
 * Working from the 15 Sep live captures, the obvious repair looked like a prompt
 * change: in 4 of 4 tapes the model emits the limit with a `direction` and NO
 * `value`, so teach it to carry the number. I replayed the banked tapes through
 * this projector in three arms before writing that, and the result refused it.
 *
 *   ARM A  as captured          rows=0  askFields=["target","value","unit"]
 *   ARM B  + value, keep ref    rows=0  askFields=["target"]
 *   ARM D  + value, NO ref      rows=0  askFields=[]          ← nothing is asked
 *
 * ⛔ SO THE "FIX" WOULD HAVE MADE THE PRODUCT QUIETER, NOT BETTER. `constraint_
 * value_unstated` is today the MOST informative state a lost limit can reach:
 * it is the only one that opens all three repair fields. Supplying the value
 * downgrades the ask to `target` alone, and supplying the value while naming no
 * target removes the ask ENTIRELY — the limit is then pruned with nothing but a
 * generic `unconnected_to_goal`, which `enumerateCompletionAsk` deliberately
 * declines to ask about (asking is pressure to invent a causal link).
 *
 * ⭐ THE REAL RULE, which is what this file pins: a limit the user stated and
 * this projector could not bind is a REPAIRABLE FINDING, and which FIELD was
 * missing must not decide whether the user gets a repair. Arm D is the one
 * combination where a complete, well-formed limit falls through in silence.
 *
 * ⚠ It is NOT a licence to invent a target. The disclosure carries the
 * `stated_index` and opens the `target` field so the MODEL may name one; the
 * projector still refuses every binding it cannot justify (SAFETY 1 and 2), and
 * an unconnected constraint is still pruned exactly as before.
 */
import { describe, expect, it } from "vitest";

import {
  enumerateCompletionAsk,
  isModelAnswerableAskItem,
  repairableConstraintFields,
} from "../completion.js";
import { projectDraftRecords } from "../seam.js";
import type { DraftRecordSet } from "../grammar.js";

function project(r: DraftRecordSet) {
  const out = projectDraftRecords(r, undefined);
  if (!out.ok) throw new Error(`projection failed: ${out.reason}`);
  return out.projection;
}
const dropped = (r: DraftRecordSet) =>
  (project(r) as unknown as {
    dropped: ReadonlyArray<{ reason: string; label: string; stated_index?: number }>;
  }).dropped;
const rows = (r: DraftRecordSet) =>
  (project(r) as unknown as { goalConstraints: ReadonlyArray<Record<string, unknown>> }).goalConstraints;

const CLAIMS = [
  { claim_kind: "factor", label: "Monthly Churn Rate", basis: [] },
  { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
  { claim_kind: "causal_link", label: "churn erodes MRR", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.5 },
  { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
];

/** ARM D — complete limit, well formed, names no target. Today: silent. */
const NO_TARGET = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "constraint", source_quote: "keeping monthly churn under 4%", direction: "ceiling", value: 4, unit: "%" },
    ],
    claims: CLAIMS,
  }) as unknown as DraftRecordSet;

/** The already-covered arm: value missing. Must keep its richer ask. */
const NO_VALUE = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "constraint", source_quote: "keeping monthly churn under 4%", direction: "ceiling" },
    ],
    claims: CLAIMS,
  }) as unknown as DraftRecordSet;

/** NEGATIVE CONTROL — a limit that BINDS. Must stay bound and unrepairable. */
const BINDS = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "constraint", source_quote: "keeping monthly churn under 4%", direction: "ceiling", value: 4, unit: "%", applies_to_claim: 0 },
    ],
    claims: CLAIMS,
  }) as unknown as DraftRecordSet;

/** NEGATIVE CONTROL — no direction. The direction gate owns this and must keep it. */
const NO_DIRECTION = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "constraint", source_quote: "keeping monthly churn under 4%", value: 4, unit: "%" },
    ],
    claims: CLAIMS,
  }) as unknown as DraftRecordSet;

describe("D1 — a complete limit that names no target is disclosed and repairable", () => {
  it("D1a PRECONDITION: it really does bind nothing", () => {
    expect(rows(NO_TARGET()).length).toBe(0);
  });

  it("D1b THE HOLE: the model is ASKED about it, and the ask is answerable", () => {
    const base = NO_TARGET();
    const ask = enumerateCompletionAsk(base, project(base));
    const mine = ask.items.filter((i) => i.detail.includes("does not say what it bounds"));
    expect(mine.length, "a stated limit that binds nothing is a finding").toBe(1);
    expect(mine[0]?.kind).toBe("constraint_target_unbindable");
    expect(mine[0]?.detail, "the user's own words are quoted back").toContain("keeping monthly churn under 4%");
    expect(
      isModelAnswerableAskItem(mine[0]!),
      "an ask the model has no field to answer is an advertised action ending in refusal",
    ).toBe(true);
  });

  it("D1b2 NO NEW DISCLOSURE: this is derived, so the dropped list is byte-unchanged", () => {
    // The projector is deliberately untouched — a second `dropped` row for a node
    // the connectivity prune already discloses is a duplicate, and it measurably
    // displaced a magnitude at the wire when first attempted.
    expect(dropped(NO_TARGET()).map((x) => x.reason)).toEqual(["unconnected_to_goal"]);
  });

  it("D1c THE CONSEQUENCE: the model is invited to name a target", () => {
    const base = NO_TARGET();
    expect([...(repairableConstraintFields(base, project(base)).get(1) ?? [])].sort()).toEqual(["target"]);
  });
});

/**
 * ⚠ THESE TWO EXIST BECAUSE MUTANTS SURVIVED, NOT BECAUSE I THOUGHT OF THEM.
 * Deleting the `kind !== "constraint"` guard and deleting the
 * `typeof value !== "number"` guard both left the suite fully GREEN — so the
 * suite could not see either guard doing its job. A surviving mutant is a claim
 * about coverage either way, and the only settlement is a discriminating case.
 */
describe("D3 — the two guards no earlier test could see", () => {
  it("D3a a non-constraint item is never treated as a limit, however it is shaped", () => {
    const base = {
      stated_items: [
        { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
        // A figure wearing a constraint's clothes. The grammar does not put
        // `direction` on a figure; the guard must not rely on that.
        { kind: "figure", source_quote: "4%", value: 4, unit: "%", direction: "ceiling" },
      ],
      claims: CLAIMS,
    } as unknown as DraftRecordSet;
    const ask = enumerateCompletionAsk(base, project(base));
    expect(
      ask.items.filter((i) => i.detail.includes("does not say what it bounds")).length,
      "a figure is not a limit",
    ).toBe(0);
    expect(repairableConstraintFields(base, project(base)).get(1)).toBeUndefined();
  });

  it("D3b a limit with NO threshold raises ONE ask, not two", () => {
    // Without the value guard this limit matches BOTH derivations and the user
    // is asked about the same sentence twice, in two different vocabularies.
    const base = NO_VALUE();
    const ask = enumerateCompletionAsk(base, project(base));
    const aboutThisLimit = ask.items.filter(
      (i) => i.kind === "constraint_target_unbindable" && i.detail.includes("keeping monthly churn under 4%"),
    );
    expect(aboutThisLimit.length, "one finding, one question").toBe(1);
    expect(aboutThisLimit[0]?.detail, "and it is the one that asks for the threshold").toContain(
      "no threshold we can apply",
    );
  });
});

describe("D2 — the three controls that bound the change", () => {
  it("D2a a MISSING VALUE keeps its richer ask — this must not be downgraded", () => {
    const base = NO_VALUE();
    expect([...(repairableConstraintFields(base, project(base)).get(1) ?? [])].sort()).toEqual([
      "target",
      "unit",
      "value",
    ]);
    expect(dropped(base).map((x) => x.reason)).toContain("constraint_value_unstated");
  });

  it("D2b a limit that BINDS is untouched and stays unrepairable", () => {
    const base = BINDS();
    expect(rows(base).length, "precondition: it really binds").toBe(1);
    expect(rows(base)[0]?.value).toBe(4);
    expect(dropped(base).map((x) => x.reason)).not.toContain("constraint_target_unstated");
    expect(repairableConstraintFields(base, project(base)).get(1)).toBeUndefined();
  });

  it("D2c an UNSTATED DIRECTION still belongs to the direction gate, not to this one", () => {
    const base = NO_DIRECTION();
    const reasons = dropped(base).filter((x) => x.label.includes("monthly churn")).map((x) => x.reason);
    expect(reasons, "the direction gate owns it").toContain("constraint_direction_unstated");
    expect(reasons, "and this new reason must not also fire — one finding, one name").not.toContain(
      "constraint_target_unstated",
    );
  });
});
