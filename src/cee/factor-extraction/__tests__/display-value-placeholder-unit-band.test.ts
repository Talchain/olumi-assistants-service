/**
 * ⭐ A PLACEHOLDER UNIT IS NOT A UNIT — a 0–1 level under `unit: "scale"` is a
 * qualitative rating and must display as the product's own band, never as
 * `"0.3 scale"`.
 *
 * WHY THIS EXISTS. The draft prompt tells the model that a qualitative factor
 * with no natural unit carries `unit: "scale"` and a human-readable band as its
 * `display_value` (served `draft_graph@v202`, EXTRACTION_RULES: *"very low /
 * low / moderate / high / very high"*). The model never emits `display_value`
 * (`display_value_on_factors: missing` on every logged draft call), so CEE
 * synthesises it here — and `synthesiseDisplayValue` Priority 5 rendered ANY
 * unit as `"<value> <unit>"`. Measured on Paul's 19 Sep drafts, staging build
 * `b7c323c`: `Task Delegation Quality { value: 0.3, unit: "scale",
 * factor_type: "other" }` → `display_value: "0.3 scale"`, and the same on
 * `Strategic Focus Capacity` (0.3), `AI Tool Capability` (0.5), `Delivery
 * Throughput` (0.35), `Team Technical Direction` (0.3). Five of nine factors
 * across two briefs showed a person a number on an undefined scale.
 *
 * WHAT IT BINDS TO. The band vocabulary is `qualitativeBand` — the mapping two
 * composers already import as "the product's own value → label mapping"
 * (`compose/unapplied-edit-reply.ts:72`). No third band table is minted here.
 * The placeholder-unit vocabulary mirrors the UI's `GENERIC_PLACEHOLDER_UNITS`
 * (`DecisionGuideAI:src/utils/unitClassifier.ts`), which is what the canvas
 * already suppresses on the surfaces that adopt `formatValueWithUnit`.
 *
 * SCOPE, STATED. Only the branch where NO raw value exists and the level sits
 * in [0, 1] changes. A placeholder unit beside a raw magnitude, or a level
 * outside the unit interval, is left exactly as before — the contrasts below
 * assert the band does NOT fire there, and deliberately do not pin the
 * pre-existing string, which this change makes no claim about.
 */
import { describe, expect, it } from "vitest";
import { qualitativeBand, synthesiseDisplayValue } from "../display-value.js";

const BAND_FORM = /^(?:Low|Moderate|High|Very high) \([0-9.]+\)$/;

describe("synthesiseDisplayValue — a placeholder unit on a 0–1 level renders the qualitative band", () => {
  it("renders the live 19 Sep shape as a band, not as `0.3 scale`", () => {
    // Exactly the observed_state the V3 wire carried for `Task Delegation Quality`.
    expect(
      synthesiseDisplayValue({ value: 0.3, unit: "scale", factor_type: "other" }),
    ).toBe("Moderate (0.3)");
  });

  it.each([
    [0.35, "scale", "Moderate (0.35)"], // Delivery Throughput, 0b1d9b9a
    [0.5, "scale", "Moderate (0.5)"], // AI Tool Capability, b3d5806d
    [0.1, "index", "Low (0.1)"],
    [0.8, "score", "Very high (0.8)"],
    [0.6, "norm", "High (0.6)"],
  ])("value %s under placeholder unit %s → %s", (value, unit, expected) => {
    expect(synthesiseDisplayValue({ value, unit })).toBe(expected);
  });

  it("the band word is the product's own mapping, not a copy — same function, same answer", () => {
    for (const value of [0.05, 0.3, 0.55, 0.9]) {
      const out = synthesiseDisplayValue({ value, unit: "scale" });
      expect(out).toBe(`${qualitativeBand(value)} (${value})`);
    }
  });

  it("is case- and whitespace-insensitive about the placeholder spelling, as the UI is", () => {
    expect(synthesiseDisplayValue({ value: 0.3, unit: " Scale " })).toBe("Moderate (0.3)");
  });

  // ── Contrasts: where the band must NOT fire ──────────────────────────────

  it("a real unit is untouched — `6 developers` stays a count with its unit", () => {
    expect(synthesiseDisplayValue({ value: 6, unit: "developers" })).toBe("6 developers");
  });

  it("a placeholder unit beside a raw magnitude takes the raw path, not the band", () => {
    // The plot-request-scale-homogeneity fixture shape. The pre-existing output
    // is not pinned here: this change makes no claim about it.
    const out = synthesiseDisplayValue({ value: 0.35, raw_value: 35, cap: 100, unit: "scale" });
    expect(out).toBeDefined();
    expect(out).not.toMatch(BAND_FORM);
  });

  it("a level outside the unit interval is not a rating and does not get a band", () => {
    const out = synthesiseDisplayValue({ value: 3, unit: "score" });
    expect(out).toBeDefined();
    expect(out).not.toMatch(BAND_FORM);
  });

  it("no unit and no factor_type still falls to the bare number (Priority 7 unchanged)", () => {
    expect(synthesiseDisplayValue({ value: 0.3 })).toBe("0.3");
  });
});
