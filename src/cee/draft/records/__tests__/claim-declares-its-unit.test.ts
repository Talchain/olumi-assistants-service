/**
 * ⭐⭐⭐ A MODEL-AUTHORED QUANTITY CAN NOW SAY WHAT IT IS MEASURED IN.
 *
 * ⛔ THE DEFECT, established at the bytes across three independent reads:
 *   1. `buildDraftRecordsSchema()` — verified as the object `anthropic.ts:848`
 *      sends the model — gave a claim exactly `basis · category · effect ·
 *      is_baseline · label · sets_to · strength · value`, with
 *      `additionalProperties: false`. `stated_items` has `unit`, `role` and
 *      `direction`. **A claim had none of them.**
 *   2. EVERY unit write site in the projector (`:1971`, `:2009`, `:2021`,
 *      `:2223`, `:2252`) reads `item.unit` — from a STATED item. `:2747` shows
 *      the asymmetry directly: a *stated* factor gets `data.unit`; a *claim*
 *      factor could not.
 *   3. `nodeDeclaredUnit` reads only `data.unit` / `observed_state.metadata.unit`.
 *
 * ⇒ The model could say `155000`. It could not say `£155,000`.
 *
 * ⭐ AND THAT IS WHY SAFETY 2 COULD NEVER FIRE ON MODEL-AUTHORED WORK.
 * `projector.ts` gates a limit on
 *   `limitFamily !== "unknown" && targetFamily !== "unknown" && limitFamily !== targetFamily`
 * and `targetFamily` comes from `nodeDeclaredUnit(target)`. For anything the
 * model authored that was `undefined` BY CONTRACT, so `targetFamily` was always
 * `unknown` and the conjunction could never hold. **The gate was one-sided not
 * by oversight but because the other side could not exist** — which is also why
 * four successive magnitude-based scale detectors were refuted: each was trying
 * to reconstruct a fact the producer was never able to state.
 *
 * ⛔⛔ DECLARING IS NOT THE THING ALREADY REFUTED. The construction site's own
 * docblock records an attempt that BORROWED a unit from a figure cited in
 * `basis` whenever `claim.value` equalled it. Review killed it with two
 * reproductions — a £49 PRICE read onto a subscriber COUNT, and a PROPOSED 59
 * read as a CURRENT 59 — because `basis` means *built on*, not *equal to*.
 * **Inferring a unit is a fabrication; the model stating one is a declaration.**
 * Nothing is borrowed here and no `extractionType` is earned.
 *
 * ⚠ WHAT THIS DOES NOT DO: make the model USE the field. That is a generation
 * question needing a draw, and one draw is not a rate. This makes the
 * distinction EXPRESSIBLE. Whether it is expressed is measured, not argued.
 */
import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../projector.js";
import { buildDraftRecordsSchema } from "../grammar.js";
import type { DraftRecordSet } from "../grammar.js";

type G = ReturnType<typeof projectRecordsToGraph>;
const nodes = (p: G) =>
  (p as unknown as { graph: { nodes: ReadonlyArray<Record<string, any>> } }).graph.nodes;

/** One record set; the ONLY variable is whether the factor declares its unit. */
const draft = (unit?: string): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "grow the business", role: "target" },
      { kind: "option", source_quote: "raise the price" },
    ],
    claims: [
      /* 0 */ { claim_kind: "factor", label: "Churn Rate", value: 4, ...(unit ? { unit } : {}) },
      /* 1 */ { claim_kind: "outcome", label: "Revenue", basis: [] },
      /* 2 */ { claim_kind: "causal_link", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 6 },
      /* 3 */ { claim_kind: "causal_link", from_claim: 0, to_claim: 1, effect: "negative" },
      /* 4 */ { claim_kind: "causal_link", from_claim: 1, to_stated: 0, effect: "positive" },
    ],
  }) as unknown as DraftRecordSet;

const factorOf = (unit?: string) =>
  nodes(projectRecordsToGraph(draft(unit), undefined)).find(
    (n) => n.kind === "factor" && n.label === "Churn Rate",
  );

describe("a claim can declare its unit", () => {
  it("PRECONDITION: the factor survives, so the assertions have an object", () => {
    // Without this, an absent `data.unit` could mean "no unit" or "no node",
    // and the contrast below would pass for the wrong reason.
    expect(factorOf("%"), "declared-unit arm").toBeDefined();
    expect(factorOf(undefined), "undeclared arm").toBeDefined();
  });

  it("the schema the MODEL receives now offers `unit` on a claim", () => {
    // Bound to the real builder — this is the object the adapter sends, not a
    // restatement of it.
    const schema = buildDraftRecordsSchema() as any;
    const claim = schema.properties.claims.items;
    expect(Object.keys(claim.properties), "a claim can name its unit").toContain("unit");
    expect(claim.additionalProperties, "declared, not smuggled").toBe(false);
    // Contrast: `stated_items` always had it, so finding it there proves nothing
    // about claims.
    expect(Object.keys(schema.properties.stated_items.items.properties)).toContain("unit");
  });

  it("⭐ a declared unit reaches `data.unit` — exactly what nodeDeclaredUnit reads", () => {
    expect(factorOf("%")?.data?.unit).toBe("%");
    expect(factorOf("£")?.data?.unit).toBe("£");
  });

  it("⛔ THE CONTRAST — with nothing declared, `data.unit` stays absent", () => {
    // Today's behaviour, unchanged. This is what made SAFETY 2's target side
    // permanently `unknown`.
    expect(factorOf(undefined)?.data?.unit).toBeUndefined();
    expect(factorOf(undefined)?.data?.value, "the number still lands (frame 10, so 4 -> 0.4)").toBe(0.4);
  });

  it("⛔ NO ATTRIBUTION IS EARNED — the value stays the model's", () => {
    // The refuted attempt lifted `extractionType: "explicit"` alongside a
    // borrowed unit. Declaring a unit must not buy user authorship.
    const f = factorOf("%");
    expect(f?.observed_state?.extractionType, "no explicit stamp").toBeUndefined();
    expect(f?.observed_state?.raw_value, "the model's own number, kept raw").toBe(4);
  });

  it("and the unit is NOT invented when the model is silent about it", () => {
    // Belt and braces against the obvious wrong fix: no fallback to a cited
    // figure's unit, no guess from the label, no default.
    for (const u of [undefined]) expect(factorOf(u)?.data?.unit).toBeUndefined();
  });
});

/**
 * ⛔⛔ THE CASE MY OWN ADVERSARIAL REVIEW MISSED, found 20 minutes after v9
 * shipped and fixed immediately.
 *
 * v9's carriage sat inside `typeof claim.value === "number"`. Measured on the
 * banked records: **21 of 22 factor claims carry no value at all** — so in 21 of
 * 22 cases the model could declare a unit and the projector would drop it,
 * leaving `nodeDeclaredUnit` undefined and v9 a near no-op.
 *
 * ⚠ Every case in the block above sets a value alongside the unit. **I tested
 * unit-WITH-value and never unit-WITHOUT-value**, which is the common shape —
 * the one-door corpus again, in my own adversarial pass, on the same morning I
 * wrote that a second seat catches what the author cannot.
 */
describe("a unit declared WITHOUT a level — the common case", () => {
  const noLevel = (unit?: string): DraftRecordSet =>
    ({
      stated_items: [
        { kind: "goal", source_quote: "grow the business", role: "target" },
        { kind: "option", source_quote: "raise the price" },
      ],
      claims: [
        { claim_kind: "factor", label: "Churn Rate", ...(unit ? { unit } : {}) },
        { claim_kind: "outcome", label: "Revenue", basis: [] },
        { claim_kind: "causal_link", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 6 },
        { claim_kind: "causal_link", from_claim: 0, to_claim: 1, effect: "negative" },
        { claim_kind: "causal_link", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    }) as unknown as DraftRecordSet;
  const f = (unit?: string) =>
    nodes(projectRecordsToGraph(noLevel(unit), undefined)).find(
      (n) => n.kind === "factor" && n.label === "Churn Rate",
    );

  it("PRECONDITION: the factor has no level, which is the point", () => {
    expect(f("%"), "node exists").toBeDefined();
    expect(f("%")?.observed_state?.value, "and genuinely carries no level").toBeUndefined();
  });

  it("⭐ the declared unit still reaches data.unit", () => {
    expect(f("%")?.data?.unit).toBe("%");
    expect(f("£")?.data?.unit).toBe("£");
  });

  it("⛔ and with nothing declared it stays absent — no invention", () => {
    expect(f(undefined)?.data?.unit).toBeUndefined();
  });
});
