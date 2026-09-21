/**
 * ⭐⭐ THE USER'S OWN NUMBERS MUST BE ABLE TO DECLARE WHAT THEY MEAN.
 *
 * ── THE ASYMMETRY THIS CLOSES ──────────────────────────────────────────────
 * Grammar v10 (#1562) gave `claims[]` a `value_scale` — the MODEL can say what
 * ITS number means. `stated_items[]` never got one, so the USER's number — the
 * one this whole mechanism exists to preserve — cannot. And `stated_items` is
 * `additionalProperties: false`, so the field was not merely unused: it was
 * UNEMITTABLE.
 *
 * ⚠ AND THE INSTRUCTION ASKED FOR IT ANYWAY, IN THAT SECTION. 4 of 6
 * `value_scale` mentions in `instruction.ts` sit inside the `stated_items`
 * block (L176-L316) — the whole vocabulary definition and BOTH worked examples
 * ("3% churn is `value: 0.03` … `unit_interval`", "6 engineers … `raw_count`").
 * The `claims` section, the only shape that can carry it, had one
 * back-reference. An ask pointed at a shape that cannot answer is not a weak
 * ask; it is an unanswerable one.
 *
 * ── MEASURED, 9 REAL SESSIONS, 19-21 Sep 2026 ──────────────────────────────
 * Censused offline over the saved graphs in Paul's own debug exports:
 *
 *   nodes carrying `declared_scale` ................. 0 of 92   (every session)
 *   valued nodes whose `unit` is a SCALE WORD ....... 18 of 18
 *       `"scale"` x17 · `"unit_interval"` x1
 *   real units used correctly where one exists ...... £ · % · months · weeks ·
 *                                                     contacts per week · £/month
 *
 * The model uses `unit` correctly whenever a real unit exists and CORRUPTS it
 * with a scale word whenever what it needs to say is a convention — once
 * emitting `unit: "unit_interval"`, a member of the `value_scale` enum, into
 * the `unit` field. It has nowhere else to put it. Two questions, one slot
 * (trap 21), and the measured cost is that every user-stated number reaches its
 * consumers UNDECLARED and falls to `deriveFactorScaleFrame`'s magnitude ladder
 * — inferring the convention from the magnitude, which the brief forbids.
 *
 * ── ⚠ WHAT THIS FILE DOES NOT CLAIM ────────────────────────────────────────
 *   · It does not claim the model WILL declare. A grammar field is an
 *     opportunity, not an outcome; the rate is a live-draw measurement and one
 *     draw is not a rate.
 *   · It does not claim any FRAME changes. `deriveFactorScaleFrame` is
 *     untouched — a rowed one-way door. This pass makes the declaration exist
 *     and survive; what reads it is a separate, gated decision.
 *   · It does not claim the display is fixed.
 */
import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_OPTIONAL_PARAM_LIMIT,
  DRAFT_RECORD_VALUE_SCALES,
  SERIALIZED_BYTES_BUDGET,
  buildDraftRecordsSchema,
  measureDraftRecordsSchemaBudget,
  type DraftRecordSet,
} from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

/** The stated figure must reach the goal or the projector prunes it. */
function recordsWith(item: Record<string, unknown>): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "ship the platform rewrite this year" },
      { kind: "option", source_quote: "hire two more engineers" },
      item as unknown as DraftRecordSet["stated_items"][number],
    ],
    claims: [
      {
        claim_kind: "causal_link",
        label: "headcount bears on the rewrite",
        from_stated: 2,
        to_stated: 0,
        effect: "positive",
      },
    ],
  };
}

/**
 * ⚠ BOUND BY CONSTRUCTION, NOT BY LABEL (trap 19). The projector normalises
 * labels, so a `label ===` match is a guess about a transform. The fixture
 * declares exactly one stated figure, so "the only factor node" IS an identity
 * — and the count is asserted so it stays one, rather than letting every
 * assertion below pass vacuously on a node that was never minted.
 */
function figureNode(records: DraftRecordSet) {
  const { graph } = projectRecordsToGraph(records);
  const factors = graph.nodes.filter((n) => n.kind === "factor");
  expect(
    factors.length,
    "exactly one factor must be projected, or every assertion below is vacuous",
  ).toBe(1);
  return factors[0]! as (typeof factors)[number] & Record<string, unknown>;
}

describe("the grammar lets a STATED item declare its scale", () => {
  it("declares `value_scale` on the stated_items item schema", () => {
    const schema = buildDraftRecordsSchema() as {
      properties: { stated_items: { items: { properties: Record<string, unknown> } } };
    };
    expect(Object.keys(schema.properties.stated_items.items.properties)).toContain("value_scale");
  });

  it("uses the CONTRACT vocabulary, not a second copy of it", () => {
    const schema = buildDraftRecordsSchema() as {
      properties: { stated_items: { items: { properties: { value_scale?: { enum?: string[] } } } } };
    };
    // Derived from the shared constant, so the two shapes cannot drift apart
    // (trap 12: a hand-copied enum is the mirror that always goes stale).
    expect(schema.properties.stated_items.items.properties.value_scale?.enum).toEqual([
      ...DRAFT_RECORD_VALUE_SCALES,
    ]);
  });

  it("stays OPTIONAL — a model that cannot tell must be able to say nothing", () => {
    const schema = buildDraftRecordsSchema() as {
      properties: { stated_items: { items: { required: string[] } } };
    };
    expect(schema.properties.stated_items.items.required).not.toContain("value_scale");
  });

  it("stays inside BOTH binding budgets", () => {
    // The budget that actually binds is COMPILED GRAMMAR SIZE; a schema over it
    // draws a 400 and the adapter SILENTLY falls back to prompt-only JSON on
    // every draft. Measured here against the exact object the adapter attaches.
    const report = measureDraftRecordsSchemaBudget();
    expect(report.serializedBytes).toBeLessThan(SERIALIZED_BYTES_BUDGET);
    expect(report.optionalParams).toBeLessThanOrEqual(ANTHROPIC_OPTIONAL_PARAM_LIMIT);
    expect(report.forbiddenKeywords).toEqual([]);
    expect(report.objectsMissingAdditionalPropertiesFalse).toEqual([]);
  });
});

describe("a stated figure's declaration reaches canonical state", () => {
  // ⭐ AN UNFRAMED MAGNITUDE, DELIBERATELY. `deriveFactorScaleFrame` returns
  // `undefined` when every magnitude is <= 1, so nothing divides and the stored
  // `value` IS the user's number. That is the case where a declaration is
  // purely carried, and it is the 18-of-18 case from the census: a qualitative
  // or already-decimal quantity.
  //
  // ⚠ `ratio` is chosen over `unit_interval` on purpose, so these assertions
  // cannot pass by accident. 0.9 with `unit: "%"` is exactly what an inference
  // reads as `unit_interval`; the user says it is a ratio (an NRR-style measure
  // that may pass 100%). If the declaration were being dropped and re-derived,
  // every assertion below would read `unit_interval` and fail.
  const DECLARED = recordsWith({
    kind: "figure",
    source_quote: "net revenue retention is currently 0.9",
    value: 0.9,
    unit: "%",
    value_scale: "ratio",
  });

  it("reaches observed_state, the PUBLISHED carrier", () => {
    const node = figureNode(DECLARED);
    const os = node.observed_state as Record<string, unknown> | undefined;
    expect(os, "observed_state must exist for the published carrier to be readable").toBeDefined();
    expect(os?.declared_scale).toBe("ratio");
  });

  it("reaches the NODE level, which is what schema-v3.ts reads", () => {
    expect(figureNode(DECLARED).declared_scale).toBe("ratio");
  });

  it("THE TWO CARRIERS AGREE — trap 21, they do not get to drift", () => {
    const node = figureNode(DECLARED);
    const atNode = node.declared_scale;
    const atObserved = (node.observed_state as Record<string, unknown> | undefined)?.declared_scale;
    // Pin the precondition: both PRESENT, or "they agree" is satisfied
    // vacuously by two undefineds — a guard agreeing with itself (trap 13b).
    expect(atNode).toBeDefined();
    expect(atObserved).toBeDefined();
    expect(atNode).toBe(atObserved);
  });

  it("the NATIVE magnitude round-trips unchanged when nothing frames it", () => {
    const os = figureNode(DECLARED).observed_state as Record<string, unknown>;
    expect(os.raw_value, "the native magnitude the user stated").toBe(0.9);
    expect(os.value, "unframed, so the stored level IS the user's number").toBe(0.9);
  });

  it("ABSENCE STAYS ABSENCE — an undeclared figure stamps nothing", () => {
    // The contract's own failure semantics: absence means UNDECLARED and a
    // consumer MUST NOT read it as `unit_interval`. This is the case that makes
    // the change safe for every graph drafted before the field existed.
    const node = figureNode(
      recordsWith({ kind: "figure", source_quote: "we have 6 engineers", value: 6, unit: "engineers" }),
    );
    expect(node.declared_scale).toBeUndefined();
    expect((node.observed_state as Record<string, unknown> | undefined)?.declared_scale).toBeUndefined();
  });

  it("CONFLICT CONTROL — the declaration survives what an inference would choose", () => {
    // 0.9 under `unit: "%"` is precisely the shape a magnitude-and-unit
    // inference reads as `unit_interval` (`declaredScaleOf` returns exactly
    // that for a sub-1 percent value). The USER said `ratio`. A declaration
    // beats an inference, so the stored declaration must still say `ratio`.
    // Without this case the tests above could all be satisfied by a producer
    // that re-derived the field and happened to agree.
    const node = figureNode(DECLARED);
    expect(node.declared_scale).toBe("ratio");
    expect(node.declared_scale).not.toBe("unit_interval");
  });

  it("⚠ FRAMED FACTORS: `declared_scale` describes the STORED value, not the user's", () => {
    // ⭐⭐ MEASURED WHILE BUILDING THIS, AND IT CORRECTED THE PREMISE I STARTED
    // FROM. `projector.ts` rewrites `declared_scale` to `unit_interval` after
    // it divides a factor by its scale frame, and that rewrite is CORRECT: the
    // contract puts `declared_scale` on `observed_state` beside `value`, where
    // it describes THAT number — and after division that number genuinely is a
    // unit interval. Removing the rewrite would make the field lie.
    //
    // ⛔ SO THIS IS NOT A DEFECT TO PATCH, AND I NEARLY PATCHED IT. It is trap
    // 21 once more: "what convention is the STORED value in" and "what
    // convention did the USER write in" are two questions, and after framing
    // their answers differ. `declared_scale` answers the first. `raw_value` +
    // `unit` are what carry the second, and they are asserted here so a later
    // change cannot quietly drop the only surviving record of the user's
    // magnitude.
    //
    // A stated "6 engineers" is framed by `nextNiceNumberAbove(6)` = 10 and
    // stored as 0.6. The declaration the user gave (`raw_count`) describes the
    // 6, not the 0.6 — and there is no carrier for it today. Named here so the
    // frame decision, when it is taken against an outside corpus, starts from a
    // located gap rather than a rediscovery.
    const node = figureNode(
      recordsWith({
        kind: "figure",
        source_quote: "we have 6 engineers",
        value: 6,
        unit: "engineers",
        value_scale: "raw_count",
      }),
    );
    const os = node.observed_state as Record<string, unknown>;
    expect(os.raw_value, "the user's native magnitude, still recoverable").toBe(6);
    expect(os.value, "today's normalised level — recorded, not endorsed").toBe(0.6);
    expect(node.declared_scale, "describes the STORED 0.6, which is a unit interval").toBe(
      "unit_interval",
    );
  });
});
