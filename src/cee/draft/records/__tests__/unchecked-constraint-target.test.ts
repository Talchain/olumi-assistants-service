/**
 * ⭐⭐ THE CAPTURED FIRST LOSS, AT THE BOUNDARY THAT ACTUALLY DECIDES IT.
 *
 * Live capture, 15 Sep 2026, five pass-1 record sets on the served prompt. In
 * FOUR OF FOUR that carried the user's limit, the model emitted
 *
 *   { kind: "constraint", source_quote: "keeping monthly churn under 4%",
 *     direction: "ceiling" }                      ← no `value`, no `unit`
 *
 * and put the number in a SEPARATE `figure` stated item. The projector's
 * binding collection sits behind `typeof item.value === "number"`, so with no
 * value NO BINDING IS EVEN ATTEMPTED: the constraint node gets no operator, no
 * `observed_state` and no edge, and the connectivity prune then removes it. The
 * user's limit reaches the graph NOWHERE. Measured in the tape's own
 * `record_disclosures`: `{ label: "keeping monthly churn under 4%",
 * reason: "unconnected_to_goal" }`, and — unlike the figure rows beside it —
 * carrying no value and no unit, because there never was one on the record.
 *
 * ⭐ WHY THE REPAIR PATH DOES NOT REACH IT, WHICH IS THE DEFECT THIS FILE PINS.
 * `constraint_value_unstated` is already repairable and already raises a
 * `constraint_target_unbindable` ask. But `repairableConstraintFields` opens the
 * `target` field only when a TARGET refusal fired, or when the record names no
 * target at all. In 2 of the 4 captures the model DID name a target — it named
 * the GOAL (`applies_to_stated: 0`), which can never carry a threshold. So the
 * model is handed `value` and `unit` and is FORBIDDEN to fix the one field that
 * is actually wrong, and the very next projection refuses the bind again.
 *
 * ⛔ THE DISTINCTION, NAMED APART RATHER THAN FOLDED IN (trap 21).
 * `TARGET_REFUSAL_REASONS` means "the target was CHECKED and found wrong".
 * `constraint_value_unstated` means "the binding pass never ran, so the target
 * was NEVER CHECKED". Treating unchecked as checked-and-fine is what locks the
 * captured case into a dead end, and they are two different questions.
 */
import { describe, expect, it } from "vitest";

import {
  applyConstraintCorrections,
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

/**
 * THE CAPTURED SHAPE, transcribed from `priceonly/1_pass1_record_set_RAW.json`:
 * the limit names the GOAL and carries no threshold, and the churn quantity the
 * limit is really about exists as a bindable `factor`.
 */
const CAPTURED = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      {
        kind: "constraint",
        source_quote: "keeping monthly churn under 4%",
        direction: "ceiling",
        applies_to_stated: 0,
      },
      { kind: "figure", source_quote: "4%", value: 4, unit: "%" },
    ],
    claims: [
      { claim_kind: "factor", label: "Monthly Churn Rate", basis: [1, 2] },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
      { claim_kind: "causal_link", label: "churn erodes MRR", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.5 },
      { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

/**
 * THE NEGATIVE CONTROL — same graph, but the limit is COMPLETE and its reference
 * was CHECKED and bound. Nothing here may become editable.
 */
const ALREADY_BOUND = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      {
        kind: "constraint",
        source_quote: "keeping monthly churn under 4%",
        direction: "ceiling",
        value: 4,
        unit: "%",
        applies_to_claim: 0,
      },
    ],
    claims: [
      { claim_kind: "factor", label: "Monthly Churn Rate", basis: [] },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
      { claim_kind: "causal_link", label: "churn erodes MRR", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.5 },
      { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

/**
 * A limit with NO direction, so the projector's direction gate fires first and
 * `constraint_value_unstated` cannot: its only other disclosure is the
 * connectivity prune. Nothing here is repairable.
 */
const ORPHAN_LIMIT = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "constraint", source_quote: "a purely qualitative clearance must hold" },
    ],
    claims: [
      { claim_kind: "factor", label: "Monthly Churn Rate", basis: [] },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
      { claim_kind: "causal_link", label: "churn erodes MRR", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.5 },
      { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

describe("U1 — the captured case, pinned before anything is claimed about it", () => {
  it("U1a PRECONDITION: the live shape refuses for a MISSING THRESHOLD, not for a bad target", () => {
    const d = dropped(CAPTURED()).filter((x) => x.label.includes("monthly churn"));
    expect(d.map((x) => x.reason), "the binding pass never ran, so no target refusal can appear").toContain(
      "constraint_value_unstated",
    );
    expect(
      d.map((x) => x.reason),
      "if this ever contains a target refusal the premise of this file has changed",
    ).not.toContain("constraint_target_not_measurable");
    expect(d.find((x) => x.reason === "constraint_value_unstated")?.stated_index).toBe(1);
  });

  it("U1b PRECONDITION: the user's limit binds NOWHERE — the loss this file exists to close", () => {
    expect(rows(CAPTURED()).length, "no threshold, so no row").toBe(0);
  });

  it("U1c THE DEFECT: the model may fix the value but is FORBIDDEN to fix the target that is wrong", () => {
    const base = CAPTURED();
    const scope = repairableConstraintFields(base, project(base));
    expect([...(scope.get(1) ?? [])].sort(), "target must be offered: it was never checked").toEqual(
      ["target", "unit", "value"],
    );
  });
});

describe("U2 — the widening is scoped, proven by the case it must NOT touch", () => {
  it("U2a NEGATIVE CONTROL: a complete, checked, bound limit is not repairable at all", () => {
    const base = ALREADY_BOUND();
    expect(rows(base).length, "precondition: this one really did bind").toBe(1);
    const scope = repairableConstraintFields(base, project(base));
    expect(scope.get(1), "a checked target is not re-openable").toBeUndefined();
  });

  it("U2b WRONG-TARGET CONTROL: a correction may not re-point a limit outside the turn's scope", () => {
    const base = ALREADY_BOUND();
    const scope = repairableConstraintFields(base, project(base));
    const out = applyConstraintCorrections(
      base,
      [{ stated_index: 1, direction: "floor", value: 99, applies_to_stated: 0 }],
      scope,
    );
    expect(out.applied, "out of scope, so nothing is written").toBe(0);
    expect(out.stated_items, "the object identity is preserved when nothing applies").toBe(base.stated_items);
  });
});

/**
 * ⚠⚠ WHAT THIS PINS, MEASURED RATHER THAN CLAIMED — AND MY FIRST VERSION OF THIS
 * COMMENT WAS WRONG. It said U2c pins the REPAIRABILITY GATE. It does not: a
 * mutant that turns that gate into `if (false) continue;` leaves this test
 * GREEN. So do mutants that remove the `stated_index` gate, and the `item`
 * lookup gate. Only removing ALL THREE together REDs it.
 *
 * The honest statement is therefore: these three gates are JOINTLY load-bearing
 * and no single one of them is exercisable by any input this projector can
 * produce — because every disclosure that carries a `stated_index` is already a
 * repairable reason (contrast-controlled: `constraint_value_unstated` sets
 * `stated_index`, `constraint_direction_unstated` and the connectivity prune do
 * not). The reason gate is defence in depth against a FUTURE disclosure that
 * carries an index, not a discrimination being made today.
 *
 * ⭐ Kept anyway, and kept with this note, because a guard whose name overstates
 * what it proves is how a suite starts agreeing with itself. The all-gates
 * mutant is the one that bites, and it is the one recorded.
 *
 * ⚠ Second thing this makes explicit: with `constraint_value_unstated` now
 * classified, the two sets between them cover EVERY reason in
 * `REPAIRABLE_CONSTRAINT_REASONS`, so `target` is opened for every limit that
 * reaches the map at all. Intended — each reason is either "checked and
 * rejected" or "never checked" — but nobody should read a live discrimination
 * into the three-clause shape.
 */
describe("U2c — a disclosure alone opens nothing (three gates, jointly)", () => {
  it("a limit dropped `unconnected_to_goal` opens NOTHING, even though it is disclosed", () => {
    const base = ORPHAN_LIMIT();
    const reasons = dropped(base)
      .filter((x) => x.label.includes("qualitative"))
      .map((x) => x.reason);
    expect(reasons, "precondition: it really is disclosed, and not for a repairable reason").toContain(
      "unconnected_to_goal",
    );
    expect(
      reasons.some((r) => r === "constraint_value_unstated" || r.startsWith("constraint_target_")),
      "precondition: no repairable reason is present to carry it in",
    ).toBe(false);
    const scope = repairableConstraintFields(base, project(base));
    // Bitten only by the ALL-THREE-GATES mutant; see the note above for why no
    // single-gate mutant discriminates here.
    expect(scope.get(1), "a disclosure alone must never open a field").toBeUndefined();
  });
});

describe("U3 — with the target editable, the captured limit actually reaches the graph", () => {
  it("U3a the model re-points at the churn factor and the user's 4% ceiling binds", () => {
    const base = CAPTURED();
    const scope = repairableConstraintFields(base, project(base));
    const out = applyConstraintCorrections(
      base,
      [{ stated_index: 1, direction: "ceiling", value: 4, unit: "%", applies_to_claim: 0 }],
      scope,
    );
    expect(out.applied).toBe(1);
    const row = rows(out.stated_items === base.stated_items
      ? base
      : ({ ...base, stated_items: out.stated_items } as DraftRecordSet))
      .find((x) => String(x.source_quote).includes("monthly churn"));
    expect(row, "the limit now has a row").toBeDefined();
    expect(row?.value, "the user's own number, unrescaled").toBe(4);
    expect(row?.unit, "the user's own unit").toBe("%");
    expect(row?.operator, "a ceiling is <=, never flipped").toBe("<=");
    expect(String(row?.source_quote), "the user's own words").toContain("keeping monthly churn under 4%");
  });

  it("U3b PRESERVATION: the user's words and every other stated item are untouched", () => {
    const base = CAPTURED();
    const before = JSON.stringify(base.stated_items);
    const scope = repairableConstraintFields(base, project(base));
    const out = applyConstraintCorrections(
      base,
      [{ stated_index: 1, direction: "ceiling", value: 4, unit: "%", applies_to_claim: 0 }],
      scope,
    );
    expect(JSON.stringify(base.stated_items), "the input is never mutated").toBe(before);
    expect(out.stated_items[0], "the goal is untouched").toEqual(base.stated_items[0]);
    expect(out.stated_items[2], "the figure is untouched").toEqual(base.stated_items[2]);
    expect(
      (out.stated_items[1] as { source_quote: string }).source_quote,
      "the limit keeps the user's own sentence",
    ).toBe("keeping monthly churn under 4%");
  });
});
