/**
 * THE REFUSED LIMIT CAN NOW BE REPAIRED — and the user's words still cannot be.
 *
 * `constraint_target_unbindable` was raised, was correct, and was UNANSWERABLE:
 * repairing a limit is a change on the `stated_items[]` axis and the completion
 * grammar carried only `claims`. Measured 15 Sep 2026 on 23 captured drafts at
 * served prompt v201 / `claude-sonnet-4-6`: the brief's "keeping monthly churn
 * under 4%" reached the graph in 0 of 20 pricing drafts, while the goal from the
 * SAME sentence bound (`goal_threshold_raw: 20000`) — the contrast control that
 * made it a finding rather than a guess.
 *
 * ⛔ AND THE NEGATIVE CONTROL IS LOAD-BEARING HERE. A previous attempt (#1513)
 * recovered the threshold deterministically from the constraint's span and
 * FABRICATED a 60% floor out of "…dead in enterprise, which is 60% of revenue".
 * It was caught by a byte-stability snapshot on
 * `live-emission-round11-set12.json`. That corpus is asserted in this file
 * FIRST, deliberately: any future change here answers to it before it answers
 * to anything else.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyConstraintCorrections,
  buildRecordsCompletionSchema,
  enumerateCompletionAsk,
  mergeCompletionClaims,
  modelAnswerableAskItems,
  type ConstraintCorrection,
  type ConstraintRepairField,
} from "../completion.js";
import { projectDraftRecords } from "../seam.js";
import type { DraftRecordSet } from "../grammar.js";

const FIX = join(process.cwd(), "src/cee/draft/records/__tests__/fixtures");
const CAPTURE = join(FIX, "2026-09-15-option-effect-references/live-stated-limit-no-value-2026-09-15.json");
const BANKED = join(FIX, "live-emission-round11-set12.json");
const BRIEF =
  "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price to £59 with the next Pro feature release, or hold at £49 and ship the same feature release to drive volume?";

const load = (p: string): DraftRecordSet => JSON.parse(readFileSync(p, "utf8")) as DraftRecordSet;

/**
 * ⭐ THE REPAIR SCOPE, STATED EXPLICITLY PER TEST. `applyConstraintCorrections`
 * now requires it — a correction may only touch a limit this turn was asked
 * about (P1a). These cases are about the OTHER refusals, so each declares the
 * index under test as in-scope and isolates the property it names. Scope itself
 * is covered by `correction-scope-and-conflict.test.ts`.
 */
const ALL: ReadonlySet<ConstraintRepairField> = new Set(["target","value","direction","unit"] as const);
const inScope = (...ix: number[]) => new Map(ix.map((i) => [i, ALL] as const));
const allIndices = (r: DraftRecordSet) =>
  new Map(r.stated_items.map((_, i) => [i, ALL] as const));
function project(r: DraftRecordSet, brief?: string) {
  const out = projectDraftRecords(r, brief);
  if (!out.ok) throw new Error(`projection failed: ${out.reason}`);
  return out.projection;
}

describe("Z — THE NEGATIVE CONTROL, asserted before anything else", () => {
  it("Z1: no magnitude is invented anywhere in the corpus that refuted #1513", () => {
    const dropped = project(load(BANKED)).dropped as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(dropped.filter((d) => typeof d.value === "number").length).toBe(12);
  });

  it("Z2: the 60%-of-revenue aside is NOT read as a floor", () => {
    const dropped = project(load(BANKED)).dropped as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(dropped.some((d) => d.value === 60)).toBe(false);
  });

  it("Z3: a qualitative limit is still ASKED about — honest, not silent", () => {
    const r = load(BANKED);
    const items = enumerateCompletionAsk(r, project(r)).items;
    expect(
      items.some(
        (i) => i.kind === "constraint_target_unbindable" && String(i.detail).includes("legal has NOT confirmed"),
      ),
    ).toBe(true);
  });
});

describe("A — the ask now reaches the model", () => {
  it("A1: the unenforced limit is disclosed and asked about by name", () => {
    const r = load(CAPTURE);
    const item = enumerateCompletionAsk(r, project(r, BRIEF)).items.find(
      (i) => i.kind === "constraint_target_unbindable",
    );
    expect(item).toBeDefined();
    expect(String(item!.detail)).toContain("keeping monthly churn under 4%");
    expect(String(item!.detail)).toContain("not being enforced");
  });

  it("A2: and it is ANSWERABLE — the whole point", () => {
    const r = load(CAPTURE);
    const ask = enumerateCompletionAsk(r, project(r, BRIEF));
    expect(modelAnswerableAskItems(ask).map((i) => i.kind)).toContain("constraint_target_unbindable");
  });

  /** ⭐ The grammar was opened NARROWLY. `no_goal` needs to MINT the user's words. */
  it("A3: `no_goal` is still withheld — the grammar was not over-opened", () => {
    const props = buildRecordsCompletionSchema().properties as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(props, "constraint_corrections")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(props, "stated_items")).toBe(false);
  });
});

describe("B — a correction repairs the limit, and CANNOT rewrite the user", () => {
  const r = () => load(CAPTURE);
  const idx = (x: DraftRecordSet) =>
    x.stated_items.findIndex((i) => (i as { kind?: string }).kind === "constraint");

  /**
   * ⭐⭐⭐ THE CAPABILITY, on a graph where the target is reachable. A correction
   * carrying subject + direction + value produces a REAL row with the user's own
   * operator and `provenance: "explicit"` — nothing guessed, nothing inferred.
   */
  it("B1: a correction BINDS the limit and produces a real row", () => {
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "reach £20k MRR", role: "target" },
        { kind: "constraint", source_quote: "keeping monthly churn under 4%", direction: "ceiling" },
      ],
      claims: [
        { claim_kind: "factor", label: "Monthly Churn Rate", basis: [] },
        { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
        { claim_kind: "causal_link", label: "churn erodes MRR", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.5 },
        { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
      ],
    } as unknown as DraftRecordSet;

    // Before the correction: asked about, and not enforced.
    const asked = enumerateCompletionAsk(records, project(records)).items;
    expect(asked.some((i) => i.kind === "constraint_target_unbindable")).toBe(true);

    const merged = mergeCompletionClaims(records, {
      claims: [],
      constraint_corrections: [
        { stated_index: 1, direction: "ceiling", value: 0.04, unit: "%", applies_to_claim: 0 },
      ],
    }, allIndices(records));
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.corrections_applied).toBe(1);

    const rows = (project(merged.records) as unknown as {
      goalConstraints: ReadonlyArray<Record<string, unknown>>;
    }).goalConstraints;
    const row = rows.find((x) => String(x.source_quote).includes("monthly churn"));
    expect(row, "the user's limit is now ON the model, not merely disclosed").toBeDefined();
    expect(row!.operator).toBe("<=");
    expect(row!.value).toBe(0.04);
    expect(row!.provenance).toBe("explicit");
  });

  /**
   * ⚠⚠ AND THE CAPTURED CASE STILL CANNOT BIND — pinned so the remaining blocker
   * is visible in the suite rather than claimed as solved.
   *
   * Measured: with the target set to the churn FACTOR the binding is accepted
   * (no refusal disclosure), and the row still does not appear — because that
   * factor is itself pruned `unconnected_to_goal`. The only goal-reachable churn
   * quantity in this draft is a RISK (`Churn Acceleration`), and a risk is
   * outside `MINTABLE_TARGET_KINDS`, so it cannot carry a threshold.
   *
   * So two structural blockers remain on the real draft, and NEITHER is
   * guessable: the quantity the limit bounds is disconnected, and the connected
   * one cannot hold a limit. This mechanism is necessary and not sufficient.
   */
  it("B1b: the CAPTURED draft still cannot bind — the blocker is the graph, not the grammar", () => {
    const base = load(CAPTURE);
    const ci = base.stated_items.findIndex((s) => (s as { kind?: string }).kind === "constraint");
    const churnFactor = base.claims.findIndex(
      (c) => (c as { claim_kind?: string }).claim_kind === "factor"
        && /churn/i.test(String((c as { label?: string }).label)),
    );
    const merged = mergeCompletionClaims(base, {
      claims: [],
      constraint_corrections: [
        { stated_index: ci, direction: "ceiling", value: 0.04, unit: "%", applies_to_claim: churnFactor },
      ],
    }, allIndices(base));
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const projection = project(merged.records, BRIEF);
    const rows = (projection as unknown as { goalConstraints: ReadonlyArray<unknown> }).goalConstraints;
    expect(rows.length, "still unbound — recorded, not claimed fixed").toBe(0);
    // and the reason is the graph: that factor did not survive to be bound to.
    const survived = projection.graph.nodes.some((n) => /monthly churn rate/i.test(String(n.label)));
    expect(survived).toBe(false);
  });

  it("B2: a correction-only completion is a REAL answer, not `no_new_claims`", () => {
    const base = r();
    const merged = mergeCompletionClaims(base, {
      claims: [],
      constraint_corrections: [
        { stated_index: idx(base), direction: "ceiling", value: 0.04, applies_to_claim: 0 },
      ],
    }, allIndices(base));
    expect(merged.ok).toBe(true);
  });

  it("B3: an EMPTY completion is still `no_new_claims`", () => {
    expect(mergeCompletionClaims(r(), { claims: [] }, allIndices(r()))).toEqual({ ok: false, reason: "no_new_claims" });
  });

  it("B4: `source_quote` and `kind` survive a correction byte-for-byte", () => {
    const base = r();
    const i = idx(base);
    const out = applyConstraintCorrections(base, [
      { stated_index: i, direction: "floor", value: 1, applies_to_claim: 0 },
    ], inScope(i));
    expect(out.applied).toBe(1);
    expect(out.stated_items[i]!.source_quote).toBe(base.stated_items[i]!.source_quote);
    expect((out.stated_items[i] as { kind?: string }).kind).toBe("constraint");
  });

  it("B5: wholesale `stated_items` is STILL refused", () => {
    expect(mergeCompletionClaims(r(), { stated_items: [], claims: [] }, allIndices(r()))).toEqual({
      ok: false,
      reason: "stated_items_disturbed",
    });
  });
});

describe("C — every way a correction could smuggle something is refused", () => {
  const base = () => load(CAPTURE);
  const i = (x: DraftRecordSet) => x.stated_items.findIndex((s) => (s as { kind?: string }).kind === "constraint");
  const apply = (c: Partial<ConstraintCorrection>) =>
    applyConstraintCorrections(base(), [{ stated_index: i(base()), direction: "ceiling", value: 1, ...c } as ConstraintCorrection], allIndices(base())).applied;

  it("C1: BOTH subject namespaces at once is refused", () => {
    expect(apply({ applies_to_claim: 0, applies_to_stated: 0 })).toBe(0);
  });
  it("C2: NEITHER namespace is refused — a bound with no subject", () => {
    expect(apply({})).toBe(0);
  });
  it("C3: a non-constraint target is refused — it cannot mint a limit", () => {
    expect(
      applyConstraintCorrections(base(), [
        { stated_index: 0, direction: "ceiling", value: 1, applies_to_claim: 0 },
      ], allIndices(base())).applied,
    ).toBe(0);
  });
  it("C4: an out-of-range index is refused", () => {
    expect(apply({ stated_index: 9999 } as Partial<ConstraintCorrection>)).toBe(0);
  });
  it("C5: a SECOND correction for one limit refuses BOTH — order-independent", () => {
    // ⚠ THIS ASSERTED THE WRONG THING. It checked only that the second entry
    // does not win, which FIRST-WINS satisfies — so it passed under the exact
    // defect it was named for. Independent review reproduced the ordering
    // dependence. The real property is in `correction-scope-and-conflict.test.ts`
    // (B1-B3); this keeps a local guard on the same behaviour.
    const b = base();
    const k = i(b);
    const out = applyConstraintCorrections(b, [
      { stated_index: k, direction: "ceiling", value: 0.04, applies_to_claim: 0 },
      { stated_index: k, direction: "floor", value: 999, applies_to_claim: 1 },
    ], inScope(k));
    expect(out.applied).toBe(0);
    expect(out.stated_items).toBe(b.stated_items);
  });

  it("C6: a non-finite value is refused", () => {
    expect(apply({ value: Number.NaN, applies_to_claim: 0 })).toBe(0);
  });
});

/**
 * ⭐⭐ IDENTITY, NOT EQUALITY — the guarantee my own suite missed and CI caught.
 *
 * `namespace-merge-and-completion.test.ts` asserts the `stated_items`
 * pass-through with `Object.is`, because "the user's words are untouched" is a
 * claim about IDENTITY; a fresh array with equal contents is a weaker claim that
 * would slip past a deep-equality check. My first version rebuilt the array
 * unconditionally and broke it even on turns with no corrections at all. Pinned
 * here too, so it cannot regress on this side.
 */
describe("D — with nothing to apply, the user's items come back BY REFERENCE", () => {
  const base = () => load(CAPTURE);

  it("D1: no corrections at all ⇒ the very same array", () => {
    const b = base();
    expect(applyConstraintCorrections(b, [], allIndices(b)).stated_items).toBe(b.stated_items);
  });

  it("D2: every correction REFUSED ⇒ still the very same array", () => {
    const b = base();
    const out = applyConstraintCorrections(b, [
      { stated_index: 9999, direction: "ceiling", value: 1, applies_to_claim: 0 },
      { stated_index: 0, direction: "ceiling", value: 1, applies_to_claim: 0 },
    ], allIndices(b));
    expect(out.applied).toBe(0);
    expect(out.stated_items).toBe(b.stated_items);
  });

  it("D3: one applied ⇒ a new array, and every OTHER item still by reference", () => {
    const b = base();
    const ci = b.stated_items.findIndex((x) => (x as { kind?: string }).kind === "constraint");
    const out = applyConstraintCorrections(b, [
      { stated_index: ci, direction: "ceiling", value: 0.04, applies_to_claim: 0 },
    ], inScope(ci));
    expect(out.stated_items).not.toBe(b.stated_items);
    b.stated_items.forEach((item, i) => {
      if (i === ci) return;
      expect(out.stated_items[i], `stated_items[${i}] must not be rebuilt`).toBe(item);
    });
  });
});
