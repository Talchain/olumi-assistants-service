/**
 * ⭐⭐ A TIME UNIT IS A CLAIM ABOUT SCALE, AND IT WAS BEING MADE ABOUT
 * NORMALISED BOUNDS — row 2.1207's defect, one unit family over.
 *
 * ── THE DEFECT, AT THE OWNER'S OWN SESSION ─────────────────────────────────
 * Manual session, 19 Sep 2026, scenario `34678f42`, build `c5e1060`, debug
 * export `olumi-debug-73d5c152-20260919.json`. The brief stated **"under 18
 * months of runway"**. What the product rendered, transcribed from
 * `full_graph.factors[2]` of that export:
 *
 *   { "id": "2e6a7049", "label": "Cash Runway", "kind": "factor",
 *     "category": "external", "observed_state": null,
 *     "display_value": "0.45 to 1 months" }
 *
 * A dimensionless 0–1 anchoring prior wearing a time unit, ~40x out against
 * the figure the user had already typed, on a node that carries no observed
 * value at all.
 *
 * ── THE EXPECTATION COMES FROM THE PRODUCER, NOT FROM MY READING (trap 13c) ─
 * Both producers of a `prior` emit bounds that are NOT on the factor's
 * real-world time scale. Quoted at this tip rather than inferred:
 *
 *   1. THE MODEL, via the draft prompt. `Prompts/canonical/draft_graph.txt`
 *      :466-469 gives the EXTERNAL node shape with
 *      `"prior": { "distribution": "uniform", "range_min": 0.0, "range_max": 1.0 }`
 *      and NO unit field; :472-479 is the whole anchoring table —
 *      `"low", "limited" -> 0.0 | 0.4` … `"high", "intense" -> 0.6 | 1.0`.
 *      Every row is a dimensionless 0–1 coordinate. A duration never appears.
 *
 *   2. `synthesisePriorFromBaseline`
 *      (`cee/unified-pipeline/stages/repair/unreachable-factors.ts:208`),
 *      which derives the range from the factor's own `observed_state.value` —
 *      the NORMALISED value. The same session's `Sales Cycle Duration` carries
 *      `{ value: 0.45, raw_value: 4.5, unit: "months" }`, so a time factor's
 *      `value` is the normalised one and a prior derived from it is too.
 *
 * ── THE SENTENCE THIS REFUTES, IN THE MODULE'S OWN WORDS ───────────────────
 * The domain-edge guard in `synthesiseRangeDisplayValue` asserts:
 *
 *   "Real-world units (currency, time, counts) are untouched — a 0..1 range
 *    there is a genuine quantity."
 *
 * Row 2.1207 already refuted the CURRENCY half of that sentence at a banked
 * capture, and wrote, of what survived: *"It is true of time and counts, where
 * a prior is authored on the real scale."* The `Cash Runway` capture refutes
 * the TIME half. The correction is the same correction, made once more rather
 * than generalised beyond what is measured: counts are NOT touched here, for
 * want of a capture and of a safe predicate (see the twins below).
 *
 * ── THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE FAILURE (trap 13d) ───
 * NOT "0.45 must not render as 0.45 months". The spec claim is:
 *
 *   **a time-unit display string asserts a duration on that unit's scale, so
 *   bounds lying wholly inside the normalised magnitude domain [-1, 1] — where
 *   this function cannot tell an anchoring coordinate from a genuine sub-unit
 *   duration — may not carry a time unit.**
 *
 * Written that way it covers the one-sided and sign-symmetric forms the
 * witnessed draw never contained.
 *
 * ── THE TWO OPPOSITE HARMS, NAMED AND BOTH TESTED (trap 22b) ───────────────
 *  - suppressing too little → a LIE about a number the user never wrote;
 *  - suppressing too much   → a genuine short duration loses its display, a
 *    DEGRADATION — and one bounded the same way row 2.1207 bounded its own: a
 *    time quantity that HAS an observed value reaches
 *    `synthesiseDisplayValue` down Path B of `transforms/schema-v3.ts:780`,
 *    not this range path, which fires only for an external factor with a prior
 *    and no model-authored `display_value`.
 * Every suppression case below has its opposite-direction twin.
 */
import { describe, expect, it } from "vitest";

import { synthesiseRangeDisplayValue } from "../display-value.js";
import { transformNodeToV3 } from "../../transforms/schema-v3.js";
import type { V1Node } from "../../transforms/schema-v2.js";

describe("time-unit range display requires a time-scaled bound", () => {
  // ⭐ THE WITNESSED CASE, transcribed from the owner's export.
  it("the Cash Runway prior (0.45–1, months) does not render a duration", () => {
    const out = synthesiseRangeDisplayValue(
      { distribution: "uniform", range_min: 0.45, range_max: 1 },
      "months",
      "other",
    );
    expect(out).toBeUndefined();
  });

  it("…and specifically never emits the measured string", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: 0.45, range_max: 1 },
        "months",
        "other",
      ) ?? "",
    ).not.toBe("0.45 to 1 months");
  });

  // ── CLASS COVERAGE. None of these appeared in the witnessed draw; all are
  // admitted by the same input space, and a corpus that omits a class it
  // admits cannot certify the code over it (trap 13d(c)). The unit vocabulary
  // is the one `formatBound` itself recognises, so this list and the formatter
  // cannot disagree.
  it.each([
    ["day", { range_min: 0.2, range_max: 0.8 }],
    ["days", { range_min: 0.0, range_max: 0.4 }],
    ["week", { range_min: 0.3, range_max: 0.7 }],
    ["weeks", { range_min: 0.6, range_max: 1.0 }],
    ["month", { range_min: 0.45, range_max: 1 }],
    ["months", { range_min: 0.1, range_max: 0.9 }],
    ["year", { range_min: 0.5, range_max: 0.5 }],
    ["years", { range_min: 0.01, range_max: 0.99 }],
    ["hr", { range_min: 0.25, range_max: 0.75 }],
    ["hrs", { range_min: 0.33, range_max: 0.67 }],
    ["hour", { range_min: 0.05, range_max: 0.95 }],
    ["hours", { range_min: 0.2, range_max: 1 }],
    ["Months", { range_min: 0.45, range_max: 1 }],
    ["MONTHS", { range_min: 0.45, range_max: 1 }],
  ])("normalised bounds under unit %s render no duration", (unit, prior) => {
    expect(synthesiseRangeDisplayValue(prior, unit, "other")).toBeUndefined();
  });

  it.each([
    ["one-sided max", { range_max: 1 }],
    ["one-sided min", { range_min: 0.45 }],
  ])("the %s form is covered too", (_name, prior) => {
    expect(synthesiseRangeDisplayValue(prior, "months", "other")).toBeUndefined();
  });

  // The schema admits a negative bound (`range_min: z.number()`, unbounded),
  // and a predicate written only for the `> 1` direction would let it through
  // — the sign asymmetry that cost CEE #891 a 100,000x suppression.
  it("a negative bound inside the normalised magnitude domain renders no duration", () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: -0.4, range_max: 0.4 }, "months", "other"),
    ).toBeUndefined();
  });
});

describe("OPPOSITE-DIRECTION TWINS: genuine durations and every other unit are untouched", () => {
  // If any of these RED, the fix over-suppressed and traded a lie for a gap.
  it("a real duration range still renders", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 3, range_max: 8 }, "months")).toBe(
      "3 to 8 months",
    );
  });

  it("a real one-sided duration still renders", () => {
    expect(synthesiseRangeDisplayValue({ range_max: 8 }, "months")).toBe("Up to 8 months");
    expect(synthesiseRangeDisplayValue({ range_min: 3 }, "months")).toBe("At least 3 months");
  });

  it("a duration range straddling the domain edge is a genuine quantity and renders", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.5, range_max: 8 }, "months")).toBe(
      "0.5 to 8 months",
    );
  });

  /**
   * ⭐ DISCRIMINATOR for `Math.abs(x) <= 1` vs the sign-asymmetric `x <= 1`.
   * Both classify `{-0.4, 0.4}` as normalised, so that case alone cannot tell
   * them apart. The two forms diverge on a LARGE NEGATIVE bound — which the
   * schema admits and which the asymmetric form would silently suppress.
   */
  it("DISCRIMINATOR — a large NEGATIVE bound is a genuine quantity and renders", () => {
    const out = synthesiseRangeDisplayValue({ range_min: -18, range_max: 0.5 }, "months");
    expect(out).toBe("-18 to 0.5 months");
  });

  // ── UNITS DELIBERATELY NOT IN SCOPE. A blanket "any real-world unit"
  // predicate would need a hand-maintained exclusion list for the units that
  // GENUINELY live in [0,1] — `scale`, `index`, `probability` — which is the
  // mirror this estate keeps paying for (trap 12). No capture has been
  // measured for counts, so they keep today's behaviour and these pin it.
  it("a count unit is NOT suppressed — out of scope, behaviour unchanged", () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 0.3, range_max: 0.7 }, "senior engineers"),
    ).toBe("0.3 to 0.7 senior engineers");
  });

  it("a genuinely unit-interval unit keeps its display", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.3, range_max: 0.7 }, "scale")).toBe(
      "0.3 to 0.7 scale",
    );
  });

  it("percentages are untouched — the branch that already scaled correctly", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.1, range_max: 0.25 }, "%")).toBe(
      "10% to 25%",
    );
  });

  it("currency keeps its own ratified rule", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 200000, range_max: 500000 }, "£")).toBe(
      "£200k to £500k",
    );
    expect(synthesiseRangeDisplayValue({ range_min: 0.21, range_max: 0.63 }, "£")).toBeUndefined();
  });

  it("the full-domain guard still omits a defaulted unitless prior", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 })).toBeUndefined();
  });

  it("a unitless non-domain range still renders", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 3, range_max: 8 })).toBe("3 to 8");
  });

  it("no bounds at all still falls back to the distribution string", () => {
    expect(synthesiseRangeDisplayValue({ distribution: "uniform" }, "months")).toBe(
      "Estimated (uncertain)",
    );
  });
});

/**
 * ⭐⭐ THE RENDERED FIELD, NOT THE HELPER'S RETURN VALUE.
 *
 * `display_value` is what the UI prints verbatim — `formatFactorDisplayValue.ts`
 * in `DecisionGuideAI` reads it off the node and ranks it above its own
 * heuristics. A unit-level assertion on the helper would not have caught a
 * caller that stopped consulting it, so the node that crosses the wire is
 * pinned here too, bound to the capture BY IDENTITY (the export's own node id
 * and label), never by a value predicate another node could satisfy.
 */
describe("the wire node the UI renders", () => {
  const cashRunwayV1 = (): V1Node =>
    ({
      id: "2e6a7049",
      kind: "factor",
      label: "Cash Runway",
      category: "external",
      unit: "months",
      prior: { distribution: "uniform", range_min: 0.45, range_max: 1 },
    }) as unknown as V1Node;

  it("POSITIVE CONTROL — this fixture really does reach the range-display path", () => {
    // Bounds outside the normalised domain must still produce a display_value
    // on the IDENTICAL fixture shape. Without this, a fixture that silently
    // stopped reaching Path A would make the assertion below pass by testing
    // nothing (trap 13).
    const reaching = transformNodeToV3({
      ...(cashRunwayV1() as unknown as Record<string, unknown>),
      prior: { distribution: "uniform", range_min: 3, range_max: 18 },
    } as unknown as V1Node) as Record<string, unknown>;
    expect(reaching.display_value).toBe("3 to 18 months");
  });

  it("node 2e6a7049 'Cash Runway' carries NO display_value on the wire", () => {
    const out = transformNodeToV3(cashRunwayV1()) as Record<string, unknown>;
    expect(out.id).toBe("2e6a7049");
    expect(out.label).toBe("Cash Runway");
    expect(out).not.toHaveProperty("display_value");
  });

  it("…and in particular never ships the measured string", () => {
    const out = transformNodeToV3(cashRunwayV1()) as Record<string, unknown>;
    expect(out.display_value ?? "").not.toBe("0.45 to 1 months");
  });
});
