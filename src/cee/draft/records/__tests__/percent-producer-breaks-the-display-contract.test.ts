/**
 * 19 Sep 2026: the independently reviewed producer correction acts on an
 * explicit value_scale declaration. Keep the dated capture below immutable;
 * assert current producer behaviour separately through the actual V3 transform.
 * This does not close mixed-convention calculation or establish served evidence.
 */
/**
 * ⛔⛔ THE DISPLAY DECLARES ITS CONTRACT AND THE PRODUCER BREAKS IT — a 100×
 * disagreement between two consumers of the same byte, pinned end to end inside
 * ONE service so neither side has to be mirrored.
 *
 * ── THE MEASUREMENT (Paul's manual test, 17 Sep 2026, staging, 18:16Z) ──────
 * Brief: *"while keeping monthly churn under 4%"*. Capture
 * `olumi-debug-6edb1cdb-20260917.json`:
 *
 *   node ab78e513   observed_state { value 0.0003 · raw_value 0.03 · unit '%' }
 *                   display_value                    "0.03%"   <- CEE's string
 *   display_state.rendered_factors[] value_displayed  "3%"     <- what the UI drew
 *   constraint      '<=' 0.04 · unit 'fraction' · provenance explicit
 *   result          CONSTRAINT_TARGET_UNRELIABLE ×9 (18:01-18:17Z)
 *                   -> leader_claim.permitted false -> NO recommendation named
 *
 * ⭐ NEITHER CONSUMER IS BUGGY, AND THAT IS THE POINT. `synthesiseDisplayValue`
 * states its contract in its own Priority-2 comment — *"percentage — raw_value
 * is already the display percentage"* — and renders `0.03` as `"0.03%"`, which
 * is CORRECT under that contract. The UI applies the other convention (raw as a
 * fraction) and renders `"3%"`, which is correct under that one. **The producer
 * wrote a number that satisfies neither side's stated reading, and nothing
 * reconciles them.**
 *
 * ⚠ AND THE SEMANTICS ARE GENUINELY CONTESTED, WHICH IS WHY THIS FILE PINS
 * RATHER THAN FIXES. Two live documents imply different `raw_value`:
 *   · `d1-shared/normalise-factor-value.ts:5` — `{ value: 5, unit: '%', cap: 100 }`,
 *     "percentage on 0-1 model scale", i.e. the USER-UNIT number is 5 for 5%.
 *   · `@talchain/schemas` beside `DeclaredScale` — SCALE_DISCIPLINE's
 *     bounded-percentage rule, "3% churn -> value 0.03", i.e. `value` is the
 *     fraction.
 * Both can be true at once only if `raw_value` is the user-unit number (3) and
 * `value` is the fraction (0.03). The producer wrote `raw_value 0.03`, so it
 * broke that reading too. **Picking a side moves live numbers on the seam this
 * estate has been burned by most, so it is a decision with a frame table and an
 * independent seat, not a patch.** Trap 22f: pin the gap, keep the suite green
 * for the right reason, RED the moment anything moves.
 *
 * ⛔ DO NOT "FIX" THIS BY EDITING `synthesiseDisplayValue`. Its Priority-2 limb
 * is correct against its own stated contract, and `display-value.ts:507` already
 * carries a dated deletion condition for the magnitude sniff one path over —
 * *"THE ENTIRE `else` BRANCH IS DELETED, NOT EXTENDED … a magnitude sniff is
 * never a reason to keep this alive."* The fix belongs at the producer, and
 * grammar v10 / instruction v19 (#1562) are the first half of it: once the model
 * declares `value_scale`, the producer can honour one convention instead of
 * guessing which the reader wants.
 */
import { describe, expect, it } from "vitest";

import { synthesiseDisplayValue } from "../../../factor-extraction/display-value.js";
import { transformGraphToV3 } from "../../../transforms/schema-v3.js";
import type { DraftRecordSet } from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

const CHURN = "Monthly churn rate";

/** The live shape: a percentage the model wrote as a fraction, declared. */
const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "reach £20k MRR while keeping monthly churn under 4%" },
    { kind: "option", source_quote: "raise the Pro plan price to £59" },
  ],
  claims: [
    { claim_kind: "factor", label: CHURN, value: 0.03, unit: "%", value_scale: "unit_interval" },
    {
      claim_kind: "causal_link",
      label: "raising the price moves churn",
      from_stated: 1,
      to_claim: 0,
      effect: "positive",
      sets_to: 0.055,
    },
    // Required: without a path to the goal the projector drops the factor with
    // `unconnected_to_goal` and every assertion below reads undefined.
    {
      claim_kind: "causal_link",
      label: "churn bears on the goal",
      from_claim: 0,
      to_stated: 0,
      effect: "negative",
    },
  ],
};

/** Bound by construction — one factor claim, so "the only factor" is identity. */
function churnCarriers() {
  const { graph } = projectRecordsToGraph(RECORDS);
  const factors = graph.nodes.filter((n) => n.kind === "factor");
  expect(factors.length, "exactly one factor, or every assertion is vacuous").toBe(1);
  const f = factors[0] as {
    observed_state?: Record<string, unknown>;
    data?: Record<string, unknown>;
  };
  expect(f.observed_state, "the factor must carry observed_state").toBeDefined();
  expect(f.data, "the factor must carry data, which is where the unit lives here").toBeDefined();
  return { os: f.observed_state as Record<string, unknown>, data: f.data as Record<string, unknown> };
}

/**
 * ⭐ THE DISPLAY INPUT IS THE CAPTURE'S OWN BYTES, TRANSCRIBED VERBATIM — not
 * rebuilt from the projector output above.
 *
 * The projector is only stage 4 of 8; `transforms/schema-v3.ts` rebuilds
 * `observed_state` from `data` afterwards, which is how the unit arrives. Feeding
 * the display a shape I assembled myself would be mirroring that transform, and
 * a self-authored fixture is not evidence about the wire (trap 16). So this is
 * the exact `observed_state` from `full_graph.factors[]` in
 * `olumi-debug-6edb1cdb-20260917.json`, node `ab78e513`, Paul's 17 Sep staging
 * test. Transcribed rather than read from disk because a spec that reads a file
 * outside the repo cannot collect in CI.
 *
 * ⚠ APPEND-ONLY RECORD. These are bytes the product actually produced on a dated
 * build. Do not "update" them to match a later fix — add a new case.
 */
const CAPTURED_OBSERVED_STATE_2026_09_17 = {
  value: 0.0003,
  unit: "%",
  source: "cee_inference",
  raw_value: 0.03,
  extractionType: "inferred",
  factor_type: "other",
} as const;

describe("the percent display contract: historical gap and current producer", () => {
  it("the current declared producer carries raw 3 for a 3% calculation value", () => {
    const { os, data } = churnCarriers();
    expect(os.value).toBe(0.03);
    expect(os.raw_value).toBe(3);
    expect(data.raw_value).toBe(3);
    // ⚠ AND NOTE WHICH CARRIER HOLDS THE UNIT AT THIS STAGE — it cost a round to
    // find and it is the kind of thing that makes a guard assert nothing. The
    // projector writes the unit to `data`, NOT to `observed_state`; the unit only
    // reaches `observed_state` later, when `transforms/schema-v3.ts` rebuilds it
    // from `data`. A guard written against `observed_state.unit` here reads
    // `undefined` and renders a plain number, which looks like agreement.
    expect(os.unit).toBeUndefined();
    expect(data.unit).toBe("%");
    // The declaration describes the calculation value, not the display magnitude.
    expect(os.declared_scale).toBe("unit_interval");
  });

  it("the current producer reaches V3 as 3%, without changing the historical capture", () => {
    const { graph } = projectRecordsToGraph(RECORDS);
    const v3 = transformGraphToV3(graph as never);
    const factors = v3.graph.nodes.filter((node) => node.kind === "factor");
    expect(factors).toHaveLength(1);
    expect(factors[0]!.observed_state).toMatchObject({
      value: 0.03, raw_value: 3, unit: "%", declared_scale: "unit_interval", source: "cee_inference",
    });
    expect(factors[0]!.display_value).toBe("3%");
    expect(factors[0]!.observed_state?.baseline).toBeUndefined();
    expect(CAPTURED_OBSERVED_STATE_2026_09_17.raw_value).toBe(0.03);
  });

  it("PINS THE CONSUMER: the display is correct against its own stated contract", () => {
    const os = CAPTURED_OBSERVED_STATE_2026_09_17;
    const rendered = synthesiseDisplayValue({
      value: os.value,
      raw_value: os.raw_value,
      unit: os.unit,
    });
    // Priority 2's comment: "raw_value is already the display percentage". Given
    // `raw_value 0.03` that yields "0.03%", which is RIGHT under that contract
    // and 100x under the convention the UI applies.
    expect(rendered).toBe("0.03%");
  });

  it("the immutable historical capture retains its measured 100x disagreement", () => {
    const os = CAPTURED_OBSERVED_STATE_2026_09_17;
    const cee = synthesiseDisplayValue({
      value: os.value,
      raw_value: os.raw_value,
      unit: os.unit,
    });
    // The UI's reading of the SAME byte, taken from the capture rather than
    // reimplemented: `display_state.rendered_factors[].value_displayed` = "3%".
    const uiRenderedInCapture = "3%";
    const ceeNumber = parseFloat(String(cee).replace("%", ""));
    const uiNumber = parseFloat(uiRenderedInCapture.replace("%", ""));
    // Exactly 100x in the dated capture. Current producer output is tested
    // separately above; historical bytes are never changed to match a fix.
    expect(uiNumber / ceeNumber).toBeCloseTo(100, 6);
  });

  it("CONTRAST CONTROL: a currency factor agrees across both readings", () => {
    // Same shape, non-percent unit — the display reads `raw_value` directly and
    // there is no convention to disagree about. Proves the assertions above
    // discriminate rather than always reading 100x.
    const rendered = synthesiseDisplayValue({ value: 0.49, raw_value: 49, unit: "£" });
    expect(rendered).toBe("£49");
    // 49 under both readings; no factor of 100 anywhere.
    expect(49 / parseFloat(String(rendered).replace("£", ""))).toBe(1);
  });
});
