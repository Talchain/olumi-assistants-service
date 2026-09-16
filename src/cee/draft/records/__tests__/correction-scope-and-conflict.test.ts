/**
 * THE TWO P1s FROM INDEPENDENT REVIEW, AS THE REVIEWER REPRODUCED THEM.
 *
 * Both were mine, and both slipped past a 65-test suite because the suite
 * asserted the adjacent thing:
 *
 *  P1a  A correction could rewrite ANY constraint, not the one the turn was
 *       asked about. My test asserted `source_quote` survives byte-for-byte and
 *       I treated that as the safety property. QUOTE PRESERVATION IS NOT
 *       MEANING PRESERVATION — the words were intact and the limit said the
 *       opposite thing.
 *  P1b  Conflicting corrections were FIRST-WINS, so the bound depended only on
 *       arrival order and both orders passed the real keep gate. My `C5`
 *       asserted only that the second does not win, which first-wins satisfies.
 */
import { describe, expect, it } from "vitest";

import {
  applyConstraintCorrections,
  mergeCompletionClaims,
  repairableConstraintIndices,
  type ConstraintCorrection,
} from "../completion.js";
import { projectDraftRecords } from "../seam.js";
import type { DraftRecordSet } from "../grammar.js";

/** A graph where churn IS bindable, plus a separate qualitative Legal limit. */
const RECORDS = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reach £20k MRR", role: "target" },
      { kind: "constraint", source_quote: "keeping monthly churn under 4%", direction: "ceiling", value: 0.04, unit: "%", applies_to_claim: 0 },
      { kind: "constraint", source_quote: "Legal clearance must be maintained", direction: "floor" },
    ],
    claims: [
      { claim_kind: "factor", label: "Monthly Churn Rate", basis: [] },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
      { claim_kind: "causal_link", label: "churn erodes MRR", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.5 },
      { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

function project(r: DraftRecordSet) {
  const out = projectDraftRecords(r, undefined);
  if (!out.ok) throw new Error(`projection failed: ${out.reason}`);
  return out.projection;
}
const rows = (r: DraftRecordSet) =>
  (project(r) as unknown as { goalConstraints: ReadonlyArray<Record<string, unknown>> }).goalConstraints;
const churnRow = (r: DraftRecordSet) => rows(r).find((x) => String(x.source_quote).includes("monthly churn"));

describe("P1a — a correction reaches ONLY the limit the turn asked about", () => {
  it("PRECONDITION: churn is already bound as a ceiling, and Legal is the only repairable one", () => {
    const r = RECORDS();
    expect(churnRow(r)?.operator).toBe("<=");
    expect(churnRow(r)?.value).toBe(0.04);
    const scope = repairableConstraintIndices(project(r));
    expect([...scope], "only the un-repairable Legal limit is in scope").toEqual([2]);
  });

  it("A1: the reviewer's exact attack — a Legal-only ask cannot flip the churn ceiling to a floor", () => {
    const base = RECORDS();
    const scope = repairableConstraintIndices(project(base));
    const merged = mergeCompletionClaims(
      base,
      { claims: [], constraint_corrections: [
        { stated_index: 1, direction: "floor", value: 0.9, applies_to_claim: 0 },
      ] },
      scope,
    );
    // Nothing was in scope, so the turn produced no answer at all.
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.reason).toBe("no_new_claims");
    // and the standing limit is untouched, in MEANING and not merely in wording
    expect(churnRow(base)?.operator).toBe("<=");
    expect(churnRow(base)?.value).toBe(0.04);
  });

  it("A2: POSITIVE CONTROL — the limit that WAS asked about is still repairable", () => {
    const base = RECORDS();
    const scope = repairableConstraintIndices(project(base));
    const out = applyConstraintCorrections(
      base,
      [{ stated_index: 2, direction: "ceiling", value: 5, unit: "days", applies_to_claim: 0 }],
      scope,
    );
    expect(out.applied, "restricting scope must not disable the repair itself").toBe(1);
  });
});

describe("P1b — conflicting corrections are REFUSED, not ordered", () => {
  const scope = () => repairableConstraintIndices(project(RECORDS()));
  const two = (first: ConstraintCorrection, second: ConstraintCorrection) =>
    applyConstraintCorrections(RECORDS(), [first, second], scope());

  const CEIL: ConstraintCorrection = { stated_index: 2, direction: "ceiling", value: 0.04, applies_to_claim: 0 };
  const FLOOR: ConstraintCorrection = { stated_index: 2, direction: "floor", value: 0.9, applies_to_claim: 0 };

  it("B1: ceiling-then-floor applies NEITHER", () => {
    expect(two(CEIL, FLOOR).applied).toBe(0);
  });

  it("B2: floor-then-ceiling applies NEITHER — the same answer, which is the point", () => {
    expect(two(FLOOR, CEIL).applied).toBe(0);
  });

  /** ⭐ THE ASSERTION MY `C5` SHOULD HAVE BEEN: both orders agree. */
  it("B3: the result is INDEPENDENT of arrival order", () => {
    const a = two(CEIL, FLOOR);
    const b = two(FLOOR, CEIL);
    expect(a.applied).toBe(b.applied);
    expect(JSON.stringify(a.stated_items)).toBe(JSON.stringify(b.stated_items));
  });

  it("B4: one unambiguous correction still applies — refusal is scoped to the conflict", () => {
    expect(applyConstraintCorrections(RECORDS(), [CEIL], scope()).applied).toBe(1);
  });
});
