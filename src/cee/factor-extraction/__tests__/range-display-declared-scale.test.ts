import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { DeclaredScale } from "@talchain/schemas";
import { synthesiseRangeDisplayValue } from "../display-value.js";
import { classifyUnitScaleClass, isPercentScaledUnit } from "../../draft/records/projector.js";
import type { DraftRecordSet } from "../../draft/records/grammar.js";
import { projectDraftRecords } from "../../draft/records/seam.js";
import { transformNodeToV3 } from "../../transforms/schema-v3.js";
import { handleUnreachableFactors } from "../../unified-pipeline/stages/repair/unreachable-factors.js";

/**
 * THE PRODUCER ALREADY ANSWERS THE QUESTION THIS FUNCTION WAS SNIFFING.
 *
 * `unified-pipeline/stages/repair/unreachable-factors.ts:540-542` stamps
 * `node.declared_scale` via `declaredScaleOf`, and its own comment at `:555`
 * records the ruling verbatim: *"the producer-side answer is `declared_scale`
 * above"*. `transforms/schema-v3.ts:508` reads `anyNode.unit` off THE SAME
 * OBJECT (`anyNode = node as any`, `:451`) — so `anyNode.declared_scale` sits
 * one property away from a value this function was inferring by magnitude.
 *
 * ⭐ The straddle fix minted no new NAME, so a name sweep misses it — it minted
 * a second CLASSIFIER for a concept the contract already carries. That is the
 * twins defect one level down, and these tests exist to keep it closed.
 *
 * ── THE VOCABULARY IS THE CONTRACT'S, NOT THIS MODULE'S ────────────────────
 * `@talchain/schemas` (0.50.0 at this head) `dist/graph.d.ts:48` —
 * `DeclaredScale = z.enum(['unit_interval', 'ratio', 'raw_count'])`, whose own
 * doc block (`:12-53`) defines each member. Every expectation below is derived
 * from THAT text, never from this lane's reading of what a scale "ought" to
 * mean (trap 13c: a mutant kit validates sensitivity, never the oracle):
 *
 *   * `unit_interval` — "a proportion or a cap-normalised magnitude.
 *     Admissible [0, 1]" — "3% churn -> value 0.03".      => display x100
 *   * `ratio` — "a ratio that can meaningfully exceed 100% (NRR, growth,
 *     ROI). Admissible [0, +inf); 1.0 is parity."          => display x100
 *   * `raw_count` — "a magnitude left un-normalised in `unit`.
 *     Admissible [0, +inf)."                               => display x1
 *
 * ⚠ AND ITS FAILURE SEMANTICS ARE LOAD-BEARING, QUOTED: *"A consumer MUST NOT
 * treat absence as `unit_interval`: that is the unsound guess 2.193 exists to
 * retire."* So absence must fall through to the existing sniff — never to a
 * default. The `absence` block below is what pins that.
 */
describe("synthesiseRangeDisplayValue — the DECLARED scale outranks the sniff (G1)", () => {
  describe("a declared scale is obeyed, and a straddle is no longer a straddle", () => {
    it("ratio [0.56, 1.68] renders 56% to 168% — the contract's parity reading, not a decline", () => {
      // THE PR'S HEADLINE PAIR. Undeclared it is genuinely undecidable and is
      // declined; DECLARED `ratio` it is decided, and declining it would now be
      // the gap-harm rather than the honest state.
      expect(synthesiseRangeDisplayValue({ range_min: 0.56, range_max: 1.68 }, "%", undefined, "ratio")).toBe(
        "56% to 168%",
      );
    });

    it("raw_count [1, 25] renders 1% to 25% — declared display-scale, never multiplied", () => {
      expect(synthesiseRangeDisplayValue({ range_min: 1, range_max: 25 }, "%", undefined, "raw_count")).toBe(
        "1% to 25%",
      );
    });

    it("⭐ raw_count [0.2, 0.8] renders 0.2% to 0.8% — THE DISCRIMINATING CASE (FUTURE-PROOFING, not live coverage)", () => {
      // The sniff reads [0.2, 0.8] as within-unit-interval and multiplies:
      // "20% to 80%". The producer says these are ALREADY display-scale. This
      // is the one case where the declaration and the sniff give DIFFERENT
      // answers on a pair the sniff is perfectly happy with — so it is the only
      // test here that proves the declaration is actually being READ rather
      // than merely being passed and ignored.
      //
      // ⚠⚠ BUT `raw_count` IS UNREACHABLE FROM THE ONLY IN-REPO WRITER, AND
      // THIS TEST SAYS SO RATHER THAN LETTING A LATER READER ASSUME OTHERWISE.
      // `declaredScaleOf` (`unreachable-factors.ts:317`) is typed
      // `"unit_interval" | "ratio" | undefined` and never returns `raw_count` —
      // measured: ZERO occurrences of `raw_count` in that file, against a
      // CONTRAST of 5 for `unit_interval` in the same sweep. And `:542` is the
      // only write of `declared_scale` in `src/` at all.
      //
      // So this pins behaviour NO CURRENT PRODUCER CAN TRIGGER. It is
      // FUTURE-PROOFING for the model-authored producer the contract names
      // ("the draft/edit transform that already applies SCALE_DISCIPLINE"),
      // NOT evidence about a live path. It still earns its place — it is the
      // only case that discriminates the declaration from the sniff — but it
      // must not be mistaken for live coverage in a reachability count.
      expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "%", undefined, "raw_count")).toBe(
        "0.2% to 0.8%",
      );
    });

    it("unit_interval [0.2, 0.8] renders 20% to 80% (agrees with the sniff, pinned against regression)", () => {
      expect(
        synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "%", undefined, "unit_interval"),
      ).toBe("20% to 80%");
    });

    it("a declared scale survives a NEGATIVE bound by magnitude, not by sign", () => {
      // Sign asymmetry is what cost CEE #891 a 100,000x suppression. A
      // declaration decides the SCALE; it must not silently re-open a sign gate.
      expect(
        synthesiseRangeDisplayValue({ range_min: -0.4, range_max: 0.8 }, "%", undefined, "unit_interval"),
      ).toBe("-40% to 80%");
    });
  });

  describe("ABSENCE FAILS OPEN — the contract forbids defaulting it (G1, the other direction)", () => {
    it("an undeclared straddle is still declined — absence is not `unit_interval`", () => {
      // If absence were defaulted to `unit_interval` this would render
      // "100% to 2500%". This test is the one that bites that mutation.
      expect(synthesiseRangeDisplayValue({ range_min: 1, range_max: 25 }, "%")).toBeUndefined();
      expect(synthesiseRangeDisplayValue({ range_min: 0.56, range_max: 1.68 }, "%")).toBeUndefined();
    });

    it("an undeclared decidable pair still renders via the sniff, unchanged", () => {
      expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "%")).toBe("20% to 80%");
      expect(synthesiseRangeDisplayValue({ range_min: 10, range_max: 25 }, "%")).toBe("10% to 25%");
    });

    it("an UNRECOGNISED declaration falls open to the sniff — it is not trusted, and it does not throw", () => {
      // A future contract member, or a corrupt value, must degrade to today's
      // behaviour rather than being coerced into one of the three known arms.
      expect(
        synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "%", undefined, "percentage_points"),
      ).toBe("20% to 80%");
      expect(
        synthesiseRangeDisplayValue({ range_min: 1, range_max: 25 }, "%", undefined, "percentage_points"),
      ).toBeUndefined();
    });
  });
});

/**
 * G4 — TWO HARMS, TWO WINDOWS. THEY CANNOT SHARE ONE.
 *
 * Declining renders `undefined`, the caller omits `display_value`, and the node
 * reads "no value set yet" — a SILENT GAP, not a loud failure. #1130's own head
 * commit was already a repair for OVER-declining (the zero-bound false
 * straddle). So both directions are live regressions and both must be pinned:
 * a mis-scaled number is a LIE, a missing display is a GAP, and a corpus that
 * only points at one of them applauds a fix that trades it for the other
 * (trap 22b, measured on this exact seam).
 */
describe("synthesiseRangeDisplayValue — both directions pinned (G4)", () => {
  describe("THE LIE direction: an undecidable percent pair must never render", () => {
    it.each([
      ["classic straddle", 0.56, 1.68],
      ["inverted-reading straddle", 1, 25],
      ["negative straddle by magnitude", -0.4, 25],
      ["just across the boundary", 0.999, 1.001],
    ])("declines %s [%s, %s]", (_label, min, max) => {
      expect(synthesiseRangeDisplayValue({ range_min: min, range_max: max }, "%")).toBeUndefined();
    });
  });

  describe("THE GAP direction: a decidable percent pair must still render", () => {
    it.each([
      ["a zero bound is scale-invariant and must not vote", 0, 25, "0% to 25%"],
      ["zero with a within-interval partner", 0, 0.8, "0% to 80%"],
      ["both zero", 0, 0, "0% to 0%"],
      ["both within", 0.2, 0.8, "20% to 80%"],
      ["both outside", 10, 25, "10% to 25%"],
      ["negative, both within by magnitude", -0.4, 0.8, "-40% to 80%"],
      // ⚠⚠ THESE TWO CLOSE A GAP IN THIS LANE'S OWN CORPUS, FOUND BY A SURVIVING
      // MUTANT. Replacing `Math.abs(rangeMin!)` with `rangeMin!` — the exact
      // sign asymmetry that cost CEE #891 a 100,000x suppression — SURVIVED the
      // first version of this file with 26/26 green. Every negative case here
      // paired a negative with a POSITIVE partner, and on those the two
      // predicates agree: `-0.4 <= 1` is true with or without the absolute
      // value. The asymmetry only becomes observable when BOTH bounds are
      // negative AND outside the unit interval by magnitude, because only then
      // does dropping `Math.abs` flip the classification: `[-5, -2]` reads as
      // "both within" and renders "-500% to -200%" instead of "-5% to -2%".
      // A corpus that omits a class the contract admits cannot certify the code
      // over that class — and `range_min`/`range_max` are bare `z.number()`.
      ["both negative, both OUTSIDE by magnitude", -5, -2, "-5% to -2%"],
      ["both negative, both WITHIN by magnitude", -0.4, -0.8, "-40% to -80%"],
    ])("renders %s", (_label, min, max, expected) => {
      expect(synthesiseRangeDisplayValue({ range_min: min, range_max: max }, "%")).toBe(expected);
    });

    it("a SINGLE bound can never straddle and must always render", () => {
      // ⚠ THESE EXPECTATIONS WERE CORRECTED AGAINST THE MEASURED BEHAVIOUR.
      // This lane first asserted `{range_max: 1.68}` -> "Up to 168%" from its
      // own head, and the run refuted it. A lone bound has nothing to straddle
      // against, so the sniff classifies it ALONE: |1.68| > 1 is outside the
      // unit interval, therefore already display-scale, therefore x1. That is
      // the same convention `[10, 25] -> "10% to 25%"` follows, and it is the
      // function's rule rather than a defect — so the pin records the rule.
      // (Bending the code to match a self-authored expectation is trap 13c: a
      // mutant kit would then have scored a perfect kill-rate on a wrong oracle.)
      expect(synthesiseRangeDisplayValue({ range_max: 1.68 }, "%")).toBe("Up to 1.68%");
      expect(synthesiseRangeDisplayValue({ range_min: 0.56 }, "%")).toBe("At least 56%");
      expect(synthesiseRangeDisplayValue({ range_max: 25 }, "%")).toBe("Up to 25%");
    });
  });
});

/**
 * G3 — THE TWIN-PREDICATE CLASS THIS SEAM IS EXPOSED TO, PINNED AS A KNOWN GAP.
 *
 * `draft/records/projector.ts` `isPercentScaledUnit` — now delegating to the one
 * authority `classifyUnitScaleClass`, which matches EXACT-then-PREFIX on
 * `%` · `percent` · `per cent` · `pct` — while `display-value.ts` tests
 * `unit === "%"` EXACTLY, in seven places. Two predicates, one concept: the
 * differently-named-twins defect this estate keeps paying for.
 * ⚠ The prefix limb is what makes the family UNBOUNDED, and it is intact: the
 * exact limb in front of it is redundant today and exists only as the mechanism
 * a future scale-class decision will need. So the sample below is still a
 * SAMPLE of an unbounded family, exactly as its author wrote it.
 *
 * ⚠⚠ THE RULING THAT COMMISSIONED THIS TEST SAID `'% NRR'` "honestly throws".
 * MEASURED AT PR HEAD ffb9aacc, IT DOES NOT. It falls through the exact-match
 * gate to the plain-number limb and renders the UN-MULTIPLIED normalised value
 * with the unit glued on: `[0.2, 0.8]` + `"percent"` -> `"0.2 to 0.8 percent"`.
 * That is a 100x UNDER-statement wearing a percent label — silent, not loud. So
 * BOTH halves of the twin predicate fail silently and only the DIRECTION of the
 * error differs, which makes this class worse than it was ruled, not better.
 *
 * ⚠ NOT FIXED HERE, DELIBERATELY. Widening the predicate means changing all
 * seven `unit === "%"` sites, two of which are on the POINT-ESTIMATE path
 * (`:214`, `:236`) that this lane does not own and #1130 does not touch. Under
 * the scope-expansion rule that is a re-brief, not a "while we're here" edit.
 * What is owed NOW is that the gap stops being invisible: this pins the
 * divergent set EXACTLY, so the suite stays green for the RIGHT REASON and REDs
 * if the set GROWS (a new spelling silently joins) or SHRINKS (someone fixes it
 * without updating the record) — the honest way to ship a known gap (trap 22f).
 */
describe("G3 — percent-scaled spellings that this function does NOT treat as percent", () => {
  /**
   * ⚠⚠ THIS IS A **SAMPLE**, NOT A COMPLETE SET, AND THE CLAIM IS WORDED THAT
   * WAY DELIBERATELY.
   *
   * An earlier version of this block asserted the divergent set was "EXACTLY
   * these four". THAT WAS FALSE AT THIS VERY HEAD, and it is the false-label
   * class: `isPercentScaledUnit` matches by `startsWith`, an UNBOUNDED family,
   * so no hand-written list can ever be "the set". Measured here, all divergent
   * with the suite green: `percentage` · `percentage points` · `%NRR` · `pcts` ·
   * `per cent NRR` · `PERCENT` · `"  percent  "` · `%%` — eight more than the
   * four originally claimed. A docstring promising it REDs when the set grows,
   * which does not, teaches the next reader to trust a guard that is not there.
   *
   * So the honest claim is the one asserted below: THESE SAMPLED SPELLINGS ARE
   * DIVERGENT, and the sample is drawn from the twin predicate rather than from
   * this lane's imagination (`isPercentScaledUnit` accepts every member — the
   * test asserts that too, so the sample cannot silently drift into units the
   * predicate never claimed).
   */
  const SAMPLED_DIVERGENT_PERCENT_SPELLINGS = [
    "% NRR",
    "percent",
    "per cent",
    "pct",
    "percentage",
    "percentage points",
    "%NRR",
    "pcts",
    "per cent NRR",
    "PERCENT",
    "  percent  ",
    "%%",
  ] as const;

  it.each(SAMPLED_DIVERGENT_PERCENT_SPELLINGS)(
    "%s renders UN-MULTIPLIED — recorded as a known under-statement, not endorsed",
    (unit) => {
      expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, unit)).toBe(`0.2 to 0.8 ${unit}`);
    },
  );

  it("every sampled spelling DIVERGES — pinned at BOTH ends, so the set cannot move in either direction", () => {
    /**
     * ⭐⭐ THIS GUARD BINDS TO BOTH MODULES ON PURPOSE, AND THE REASON IS A
     * MEASURED FAILURE OF THE VERSION THAT DID NOT.
     *
     * An earlier revision re-pointed this assertion from the predicate boolean to
     * the RENDERED OUTPUT alone, on the sound-sounding grounds that the output is
     * what a user sees. Measured, that DISCONNECTED it from the module under
     * change: `display-value.ts` has exactly one import and it is NOT `projector`,
     * so `synthesiseRangeDisplayValue` is structurally incapable of being affected
     * by a change to `isPercentScaledUnit`. A mutant on `projector.ts` left this
     * test GREEN, and G3's divergent set silently HALVED — 12/12 → 6/12 — in
     * exactly the SHRINK direction the docstring below promises to catch.
     *
     * ⭐ THE LESSON, worth more than the fix: RE-POINTING A GUARD AT "THE OUTPUT"
     * DISCONNECTS IT FROM THE INPUT YOU CARE ABOUT WHEN THE OUTPUT IS PRODUCED BY
     * A DIFFERENT MODULE. Divergence is a claim about TWO modules disagreeing. A
     * guard over it must therefore assert BOTH halves, or it is watching one door.
     *
     * So: the projector's CLASS per spelling (not a boolean — a class, so the
     * assertion says which way it moved) AND the rendered output. The set REDs if
     * it grows, if it shrinks, or if either side changes its mind.
     */
    // Original author's rationale, carried forward: "Without this the list could
    // drift into units the predicate never accepted, and the 'twin predicate'
    // framing would quietly stop being true of its own corpus."
    const canonical = synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "%");
    expect(canonical).toBe("20% to 80%"); // DISCRIMINATING CONTRAST: the exact gate DOES multiply.
    for (const unit of SAMPLED_DIVERGENT_PERCENT_SPELLINGS) {
      // HALF ONE — the projector's verdict. Binds this block to the module that
      // owns the percent family; pinned as the CLASS so a re-classification is
      // named in the failure rather than collapsed into `false`.
      expect(classifyUnitScaleClass(unit), `${unit}: projector must still class this percent`).toBe("percent");
      expect(isPercentScaledUnit(unit), `${unit}: the twin predicate must still accept it`).toBe(true);
      // HALF TWO — what the user actually sees.
      const rendered = synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, unit);
      expect(rendered, `${unit} must render un-multiplied`).toBe(`0.2 to 0.8 ${unit}`);
      expect(rendered, `${unit} must differ from the canonical '%' rendering`).not.toBe(canonical);
    }
  });

  it("CONTRAST CONTROL for the binding above: `%` satisfies half two and FAILS half one's divergence", () => {
    // Proves the block discriminates rather than accepting anything: the canonical
    // spelling is percent-classed AND multiplied, so it is NOT divergent and is
    // correctly outside the sample. Without this, "every member is percent-classed"
    // could pass on a classifier that says percent to everything.
    expect(classifyUnitScaleClass("%")).toBe("percent");
    expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "%")).toBe("20% to 80%");
    // …and a non-percent unit is classed away, so "percent" is a real verdict.
    expect(classifyUnitScaleClass("bps")).toBe("basis_points");
    expect(classifyUnitScaleClass("widgets")).toBe("unknown");
  });

  it("CONTRAST CONTROL: `bps` is divergent but NOT percent-scaled — a different class, correctly excluded", () => {
    // Proves the sample is selecting on percent-scaledness rather than on
    // "anything that is not exactly '%'". `bps` also fails the exact-match gate,
    // but `isPercentScaledUnit` rejects it and its correct multiplier is 10,000
    // (`isBasisPointsUnit`, projector.ts) — so its exclusion here is a decision,
    // not an oversight.
    expect(isPercentScaledUnit("bps")).toBe(false);
    expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "bps")).toBe("0.2 to 0.8 bps");
  });

  /**
   * ⛔⛔ THE TRAP FOR WHOEVER WIDENS THIS PREDICATE NEXT — READ BEFORE YOU DO.
   *
   * `"percentage points"` is ACCEPTED by `isPercentScaledUnit` (it starts with
   * "percent"), but its CORRECT MULTIPLIER IS x1, NOT x100. A range of
   * `[0.2, 0.8]` percentage points IS "0.2pp to 0.8pp" — it is already on the
   * display scale. A widening that routes every `isPercentScaledUnit` spelling
   * through the x100 limb would render it "20% to 80%": A 100x LIE, shipped by
   * a change whose whole purpose was to stop a 100x under-statement.
   *
   * ⭐ THE TWO HARMS CANNOT SHARE ONE WINDOW — the under-statement (a GAP) and
   * the over-statement (a LIE) point in opposite directions, and one predicate
   * cannot serve both. `isPercentScaledUnit` answers "is this metric expressed
   * in percent-like units?", which is NOT the question the display multiplier
   * needs answered ("is this VALUE already on the display scale?"). They are
   * two questions under one name.
   *
   * The real fix therefore needs the PRODUCER'S DECLARATION for these spellings
   * too — exactly the `declared_scale` read this file's G1 block installs for
   * `'%'` — not a wider unit-string match.
   */
  it("⛔ `percentage points` is percent-scaled BUT must never be multiplied — pinned so a widening cannot silently ship a 100x lie", () => {
    /**
     * ⛔ THE PREDICATE PIN IS RESTORED, AND ITS RESTORATION IS THE POINT.
     *
     * An earlier revision replaced it with `classifyUnitScaleClass(...) ===
     * "percentage_points"` plus `isPercentScaledUnit(...) === false`, arguing the
     * "wrong route" was gone. Two problems, both measured:
     *
     *  1. It was not a test change, it was a PRODUCT change wearing one. Moving
     *     'percentage points' out of the percent class moves its frame from a
     *     pinned 100 to the derived ladder — at max 1.5 that is level 0.015 →
     *     0.75, a 50× overstatement, silent. That is a one-way door and it is now
     *     ROWED, not taken (see `classifyUnitScaleClass`'s docstring).
     *  2. The docstring above is right that this is "the CORRECT number reached by
     *     the WRONG route" — but the fix it prescribes is the PRODUCER'S
     *     DECLARATION, not a re-classification of the unit string. Until that
     *     exists, the wrong route is what ships, and a test that pretends
     *     otherwise stops guarding the ×100 lie.
     *
     * So both halves are asserted: it IS routed as percent (the honest, current,
     * measured state), and it still renders un-multiplied.
     */
    expect(classifyUnitScaleClass("percentage points")).toBe("percent");
    expect(isPercentScaledUnit("percentage points")).toBe(true);
    // Today it renders un-multiplied, which for THIS spelling is the CORRECT
    // number reached by the wrong route. If a future widening changes this to
    // "20% to 80%", that is a regression even though it looks like the fix.
    expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "percentage points")).toBe(
      "0.2 to 0.8 percentage points",
    );
  });

  /**
   * ⚠ MEASURED, AND IT SIZES THE REAL FIX: THE PERCENT GATE IS DUPLICATED, SO A
   * PARTIAL WIDENING IS DEAD CODE.
   *
   * A mutant that widened ONLY the scale-decision gate at the top of
   * `synthesiseRangeDisplayValue` (`unit === "%"` -> `unit.startsWith("%")`)
   * SURVIVED this whole file — zero tests moved. Not because the set assertion
   * below is weak, but because the decision it widens is then DISCARDED:
   * `formatBound` re-tests `unit === "%"` exactly, and so does `isUnitPerBound`.
   * A `"% NRR"` pair would have a correct multiplier computed for it and still
   * be rendered by the plain-number limb.
   *
   * So the twin-predicate fix is NOT a one-line widening — it is all three
   * sites in this function plus the two on the point-estimate path, and it must
   * also decide what happens to the qualifier (`"56% to 168% NRR"` vs dropping
   * "NRR"). That is the re-brief this lane is declining to do inline, and this
   * note exists so the next lane inherits the SIZE of it rather than
   * rediscovering it from a surviving mutant.
   */
  it("EVERY sampled spelling diverges, and '%' does not — a SAMPLED claim, never a complete one", () => {
    // ⚠ Deliberately NOT `toStrictEqual` against a hand-written "complete set".
    // The predicate matches an unbounded family, so completeness is not
    // assertable here; what IS assertable is that each sampled member diverges
    // and the exact-match spelling does not. Wording the claim to what the
    // instrument can actually support is the whole point of this rewrite.
    const divergent = SAMPLED_DIVERGENT_PERCENT_SPELLINGS.filter(
      (u) => synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, u) !== "20% to 80%",
    );
    expect(divergent).toHaveLength(SAMPLED_DIVERGENT_PERCENT_SPELLINGS.length);
    expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "%")).toBe("20% to 80%");
  });

  it("CONTRAST CONTROL: the exact-match spelling is NOT divergent, so the probe discriminates", () => {
    // Without this, every member of the set above could be divergent because
    // the function is broken for ALL units, and the set assertion would still
    // pass. A guard that agrees with itself is not evidence (trap 13b).
    expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "%")).toBe("20% to 80%");
  });

  it("a declared scale does NOT rescue a divergent spelling — the gap is in the PREDICATE, not the scale", () => {
    // Pins WHERE the defect lives: passing the producer's answer does not help
    // a unit that never reaches the percent limb at all.
    expect(synthesiseRangeDisplayValue({ range_min: 0.2, range_max: 0.8 }, "percent", undefined, "unit_interval")).toBe(
      "0.2 to 0.8 percent",
    );
  });
});

/**
 * ⛔⛔ GATE 1 — THE WIRE, NOT THE FUNCTION. THIS IS THE BLOCK THAT MAKES THE
 * WHOLE PR NON-VACUOUS.
 *
 * Every test above calls `synthesiseRangeDisplayValue` DIRECTLY and hands it
 * `declaredScale` itself. So none of them exercises the one line that makes the
 * mechanism reachable — `schema-v3.ts:522` passing `anyNode.declared_scale`.
 *
 * ⚠ MEASURED, NOT ARGUED: replacing that argument with `undefined` — deleting
 * the entire mechanism this PR exists to add — gives `applied=1` and
 * **728/728 GREEN across 22 files**. A fix whose tests pass with the defect
 * re-introduced is theatre (trap 11), and this lane had shipped exactly that.
 *
 * ⭐ It is also the precise shape this lane closed in ANOTHER lane's work
 * hours earlier (the surviving `Math.abs` mutant): a corpus that tests the
 * FUNCTION but never the WIRE. Recording that, because catching a defect class
 * in someone else's diff plainly does not immunise you against it in your own.
 *
 * The pair below is the remedy, and both halves are load-bearing:
 *   * the FIRST assertion RE-REDS the arg-drop mutant;
 *   * the SECOND proves the declaration is what did the work — without it the
 *     first could pass for the wrong reason (e.g. the sniff happening to agree),
 *     which is the "guard agreeing with itself" failure (trap 13b).
 */
describe("GATE 1 — the producer→consumer hop is exercised through the real transform", () => {
  const externalFactor = {
    id: "fac_nrr",
    kind: "factor" as const,
    label: "Net Revenue Retention",
    category: "external",
    extractionType: "explicit",
    prior: { distribution: "uniform", range_min: 0.56, range_max: 1.68 },
    unit: "%",
  };

  it("a DECLARED ratio straddle renders through transformNodeToV3 — bites the arg-drop mutant", () => {
    const v3 = transformNodeToV3({ ...externalFactor, declared_scale: "ratio" } as never);
    expect(v3.display_value).toBe("56% to 168%");
  });

  it("the SAME node WITHOUT the declaration declines — proving it is the DECLARATION doing the work", () => {
    const v3 = transformNodeToV3({ ...externalFactor } as never);
    expect(v3.display_value).toBeUndefined();
  });

  it("a DECLARED raw_count reaches the transform too — the read is not special-cased to one member", () => {
    const v3 = transformNodeToV3({
      ...externalFactor,
      prior: { distribution: "uniform", range_min: 1, range_max: 25 },
      declared_scale: "raw_count",
    } as never);
    expect(v3.display_value).toBe("1% to 25%");
  });
});

/**
 * ⛔ GATE 2 — A CONTRACT RENAME MUST NOT FAIL SILENT.
 *
 * `display-value.ts` imports NOTHING from `@talchain/schemas` (contrast: 479
 * files under `src/` do). `percentMultiplierFromDeclaredScale` takes a plain
 * `string` and switches on three string literals with a `default` arm. That
 * shape is deliberate for ADDITION — a new contract member must fail OPEN to
 * the sniff, which the contract's own failure semantics require.
 *
 * ⚠ BUT RENAME IS THE OTHER DIRECTION, AND IT IS THE DANGEROUS ONE. If
 * `unit_interval` were renamed, every declared pair would silently fall to the
 * `default` arm and revert to the magnitude sniff — REOPENING the straddle this
 * PR closes, with no error anywhere and a fully green suite. Fail-open is the
 * right default for a member we have never seen; it is the WRONG response to a
 * member that has been taken away.
 *
 * This binds the local literals to the contract's own enum, so a rename REDs
 * here and forces a conscious decision. It REDs on ADDITION too — which is
 * correct: adding `percentage_points` would need someone to decide its
 * multiplier (see the `"percentage points"` trap above), not inherit the sniff
 * by default.
 *
 * ⚠ Verified against the pin AT THIS HEAD (`@talchain/schemas` 0.50.0, bumped
 * from 0.48.0 by staging mid-lane): `DeclaredScale` is still exported and still
 * carries the same three members. The bump is exactly the event this guard
 * exists for, and it is why the check is derived rather than hand-copied.
 */
describe("GATE 2 — the declared-scale vocabulary is pinned to the contract", () => {
  it("the contract's members are exactly the three this module maps — REDs on rename OR addition", () => {
    expect([...DeclaredScale.options].sort()).toStrictEqual(["ratio", "raw_count", "unit_interval"]);
  });

  it("each contract member resolves to a decided multiplier, none falls through to the sniff", () => {
    // Derived from the enum rather than hand-listed: if a member is renamed,
    // this iterates the NEW name and the declared pair reverts to the sniff,
    // which for [0.2, 0.8] + raw_count is observably wrong.
    for (const member of DeclaredScale.options) {
      const rendered = synthesiseRangeDisplayValue(
        { range_min: 1, range_max: 25 },
        "%",
        undefined,
        member,
      );
      // Every declared member decides the pair, so NONE of them may decline.
      // Undeclared, [1, 25] is a straddle and returns undefined.
      expect(rendered).toBeDefined();
    }
    expect(synthesiseRangeDisplayValue({ range_min: 1, range_max: 25 }, "%")).toBeUndefined();
  });
});

/**
 * ⛔⛔ THE COMPOSED TREE — REAL REPAIR STAGE + REAL TRANSFORM, AND THE ONE PATH
 * WHERE THIS PR COULD SHIP A 100x OVER-STATEMENT.
 *
 * ── THE QUESTION, AND THE HALF OF IT THAT IS REFUTED ──────────────────────
 * `declaredScaleOf`'s ratio arm is `unit === "%" && value > 1`, which cannot
 * distinguish `1.15` on ratio scale from `115` on raw scale. The concern was
 * that a raw-scale value would render "5750% to 17250%".
 *
 * MEASURED on the composed tree, and the ORDINARY path is IMMUNE — for a
 * reason that has nothing to do with this fix: `unreachable-factors.ts:589`
 * sets `withholdUnit = scale === "ratio"` and does not stamp `node.unit`, and
 * `:622` deletes `node.data`. Both arms of `schema-v3.ts:508` are then
 * undefined, the '%' limb never runs, and the display is a bare number
 * ("57.5 to 172.5"). The predicted output is NOT reachable that way.
 *
 * ── BUT THE `data.operator` PATH DEFEATS THE WITHHOLDING, AND IT IS REAL ──
 * `:612` only deletes `data` when `!hasInterventions && !hasOperator &&
 * !hasValue`. A factor carrying a string `data.operator` KEEPS its `data`, so
 * `node.data.unit` feeds `priorUnit` even though the node-level unit was
 * withheld. MEASURED at this head, before the guard below:
 *
 *   value=115, raw_value=115, unit='%', operator='>='  ->  "5750% to 17250%"
 *
 * A 100x OVER-STATEMENT — shipped by a change whose whole purpose was to stop a
 * 100x under-statement. ⭐ THE TWO HARMS CANNOT SHARE ONE WINDOW, and that rule
 * applies to this lane's own fix exactly as it applied to the one it reviewed.
 *
 * ── THE GUARD USES AN EXISTING CARRIER, NOT A NEW SIGNAL ──────────────────
 * `normalise-factor-value.ts:14-18`: *"When `cap` is defined, value =
 * raw_value / cap ... When `cap` is absent, value = raw_value."* So
 * `rawValue === value` IS the un-normalised signal, and `declaredScaleOf`
 * ALREADY consumes it on the opposite arm (`rawValue !== value` => normalised
 * => `unit_interval`). The ratio arm now reads the same carrier symmetrically.
 *
 * ── WHY THIS COSTS THE COMPLIANT CASE NOTHING ────────────────────────────
 * Legacy ratio-encoded inputs carry distinct model and raw magnitudes;
 * raw-scale inputs may legitimately carry equal ones. These tests protect both
 * repair inputs, not a model mandate. The current records producer is tested
 * separately below through the real parser, projector and display consumer.
 */
describe("LEGACY/REPAIR COMPATIBILITY — 115% renders on ONE scale, in both encodings", () => {
  function statedFactorGraph(data: Record<string, unknown>): any {
    // Shape taken from the existing repair suite's own helper
    // (`stated-quantity-survival.test.ts:69`), which derives it from the
    // committed cold-read captures — not invented here.
    return {
      nodes: [
        { id: "goal_x", kind: "goal", label: "Goal" },
        { id: "dec_x", kind: "decision", label: "Decision" },
        { id: "opt_x", kind: "option", label: "Option" },
        { id: "fac_nrr", kind: "factor", label: "Net Revenue Retention", data },
      ],
      edges: [
        { from: "dec_x", to: "opt_x", edge_type: "structural" },
        { from: "opt_x", to: "goal_x", edge_type: "causal" },
      ],
    };
  }

  function displayFor(data: Record<string, unknown>): string | undefined {
    const graph = statedFactorGraph(data);
    handleUnreachableFactors(graph as never, "edge_type" as never);
    const node = graph.nodes.find((n: any) => n.id === "fac_nrr");
    return (transformNodeToV3(node as never) as any).display_value;
  }

  it("ratio-encoded input (value 1.15, raw 115) renders 57.5% to 172.5%", () => {
    const display = displayFor({
      value: 1.15,
      raw_value: 115,
      unit: "%",
      operator: ">=",
      extractionType: "explicit",
    });
    expect(display).toBe("57.5% to 172.5%");
    expect(display).not.toBe("5750% to 17250%"); // raw-scale misread
    expect(display).not.toBe("0.575% to 1.725%"); // double-normalisation
  });

  it("⛔ an UN-NORMALISED value (115, raw 115) must NOT render 5750% — one assertion, both directions", () => {
    const display = displayFor({
      value: 115,
      raw_value: 115,
      unit: "%",
      operator: ">=",
      extractionType: "explicit",
    });
    expect(display).toBe("57.5% to 172.5%");
    expect(display).not.toBe("5750% to 17250%"); // the 100x OVER-statement
    expect(display).not.toBe("0.575% to 1.725%"); // the 100x UNDER-statement
  });

  it("⚠ ABSENT raw_value is NOT evidence — the guard must NOT fire without it", () => {
    // A SURVIVING MUTANT FOUND THIS GAP IN THIS LANE'S OWN CORPUS. Widening the
    // guard to `rawValue === undefined || rawValue === value` left every test in
    // this file GREEN, because no case here omitted `raw_value`. The wider
    // repair suite did catch it (`stated-quantity-survival.test.ts`, 2 RED), but
    // this file is where the guard's contract is documented, so the immunity is
    // pinned HERE rather than left to depend on another suite noticing.
    //
    // The direction matters: absence of `raw_value` is absence of EVIDENCE, not
    // evidence of un-normalisation. Firing on it would strip the declaration
    // from every legitimate ratio factor that simply never carried a raw
    // magnitude — reopening the under-statement this PR closed, from the other
    // side. Two harms, two windows, again.
    expect(
      displayFor({ value: 1.15, unit: "%", operator: ">=", extractionType: "explicit" }),
    ).toBe("57.5% to 172.5%");
  });

  it("the ratio-encoded factor still earns its ratio declaration", () => {
    expect(
      displayFor({ value: 1.15, raw_value: 115, unit: "%", operator: ">=", extractionType: "explicit" }),
    ).toBe("57.5% to 172.5%");
  });
});

// ---------------------------------------------------------------------------
// RECORDS → PARSER → PROJECTOR → DISPLAY (the current draft producer)
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const SERVED_PROMPT_PATH = resolve(REPO_ROOT, "Prompts/canonical/draft_graph.txt");
const MANIFEST_PATH = resolve(REPO_ROOT, "Prompts/canonical/manifest.json");

/**
 * Canonical is a verified served export, not the unpromoted candidate. This
 * checks artefact identity only: matching a hash cannot prove model behaviour.
 * The adapter assembly tests separately bind the selected snapshot to a request.
 */
describe("draft prompt capture identity (not behavioural evidence)", () => {
  it("keeps the verified served export bound to its recorded full digest", () => {
    const served = readFileSync(SERVED_PROMPT_PATH, "utf8");
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      pms_prompts: ReadonlyArray<{
        key: string;
        file: string;
        sha256: string;
        served_hash_verified: boolean;
      }>;
    };
    const entries = manifest.pms_prompts.filter((entry) => entry.key === "draft_graph");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.file).toBe("Prompts/canonical/draft_graph.txt");
    expect(entries[0]!.served_hash_verified).toBe(true);
    expect(createHash("sha256").update(served, "utf8").digest("hex")).toBe(entries[0]!.sha256);
  });
});

interface DraftScaleCase {
  id: string;
  quote: string;
  value: number;
  unit: string;
  effect: number;
  frame: number;
  display: string;
}

// These are quantities, not prose-table examples. In particular a >100%
// percentage is framed deterministically by the projector, not normalised by
// the model into the old graph prompt's prescribed 1.15 / raw 115 shape.
const DRAFT_SCALE_CASES: readonly DraftScaleCase[] = [
  { id: "percentage", quote: "Rejections are 12%", value: 12, unit: "%", effect: 8, frame: 100, display: "12%" },
  { id: "ratio_above_100_percent", quote: "Net revenue retention is 115%", value: 115, unit: "%", effect: 120, frame: 200, display: "115%" },
  { id: "currency_magnitude", quote: "Operating cost is £50000", value: 50000, unit: "GBP", effect: 20000, frame: 100000, display: "£50k" },
];

function scaleRecords(row: DraftScaleCase): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "improve resilience" },
      { kind: "option", source_quote: "fund the programme" },
      { kind: "figure", source_quote: row.quote, value: row.value, unit: row.unit, role: "baseline" },
    ],
    claims: [
      { claim_kind: "causal_link", label: "programme changes the quantity", from_stated: 1, to_stated: 2, sets_to: row.effect, effect: "positive" },
      { claim_kind: "causal_link", label: "the quantity affects resilience", from_stated: 2, to_stated: 0, effect: "positive" },
    ],
  };
}

function projectScaleCase(row: DraftScaleCase, records = scaleRecords(row)) {
  const brief = `We want to improve resilience. We could fund the programme. ${row.quote}.`;
  const seam = projectDraftRecords(records, brief);
  expect(seam.ok, "the real records parser must accept this fixture").toBe(true);
  if (!seam.ok) throw new Error(seam.detail);
  expect(seam.records.stated_items[2]).toEqual(records.stated_items[2]);
  expect(seam.records.claims[0]!.sets_to).toBe(records.claims[0]!.sets_to);
  expect(seam.projection.dropped).toEqual([]);
  const factors = seam.projection.graph.nodes.filter((node) => node.kind === "factor");
  const options = seam.projection.graph.nodes.filter((node) => node.kind === "option");
  expect(factors, "a missing factor must not make a display check vacuous").toHaveLength(1);
  expect(options).toHaveLength(1);
  return { seam, factor: factors[0]!, option: options[0]! };
}

function expectConsumedQuantity(
  row: DraftScaleCase,
  factor: ReturnType<typeof projectScaleCase>["factor"],
) {
  // This is the actual V3 transform and its display synthesiser, not a
  // hand-written normalisation or an assertion on the input fixture.
  const consumed = transformNodeToV3(factor as Parameters<typeof transformNodeToV3>[0]);
  expect(consumed.id).toBe(factor.id);
  expect(consumed.kind).toBe("factor");
  expect(consumed.observed_state?.value).toBeCloseTo(row.value / row.frame, 12);
  expect(consumed.observed_state?.raw_value).toBe(row.value);
  expect(consumed.observed_state?.unit).toBe(row.unit);
  expect(consumed.observed_state?.source).toBe("brief_extraction");
  expect(consumed.provenance).toBe("from_brief");
  expect(consumed.display_value).toBe(row.display);
  return consumed;
}

describe("current records scalar and unit contract reaches the actual display consumer", () => {
  it.each(DRAFT_SCALE_CASES)("$id: raw value, model scale and source stay distinct", (row) => {
    const { factor, option } = projectScaleCase(row);
    expect(factor.scale_frame).toBe(row.frame);
    expectConsumedQuantity(row, factor);

    // The same factor frame must govern the option's supported sets_to value.
    const optionData = option.data as {
      interventions: Record<string, number>;
      raw_interventions: Record<string, number>;
      intervention_details: Record<string, { source: string; raw_value: number }>;
    };
    expect(Object.keys(optionData.interventions)).toEqual([factor.id]);
    expect(optionData.interventions[factor.id]).toBeCloseTo(row.effect / row.frame, 12);
    expect(optionData.raw_interventions[factor.id]).toBe(row.effect);
    expect(optionData.intervention_details[factor.id]).toMatchObject({
      source: "cee_hypothesis",
      raw_value: row.effect,
    });
  });

  it.each(DRAFT_SCALE_CASES)("$id: losing raw magnitude fails; changing an unrelated label passes", (row) => {
    const { factor } = projectScaleCase(row);
    const lostRaw = structuredClone(factor);
    if (lostRaw.data) delete (lostRaw.data as Record<string, unknown>).raw_value;
    if (lostRaw.observed_state) delete lostRaw.observed_state.raw_value;
    expect(() => expectConsumedQuantity(row, lostRaw)).toThrow();

    const renamed = { ...factor, label: "A different display caption" };
    expectConsumedQuantity(row, renamed);
  });

  it("a cited source earns user authority; the same uncited number does not", () => {
    const original = DRAFT_SCALE_CASES[2]!;
    const row = { ...original, effect: original.value };
    const uncited = projectScaleCase(row);
    const citedRecords = scaleRecords(row);
    const citedClaim = { ...citedRecords.claims[0]!, basis: [2] };
    const cited = projectScaleCase(row, {
      ...citedRecords,
      claims: [citedClaim, ...citedRecords.claims.slice(1)],
    });
    const detail = (result: ReturnType<typeof projectScaleCase>) =>
      (result.option.data as {
        intervention_details: Record<string, { source: string; raw_value: number }>;
      }).intervention_details[result.factor.id]!;
    expect(detail(uncited)).toMatchObject({ source: "cee_hypothesis", raw_value: row.value });
    expect(detail(cited)).toMatchObject({ source: "brief_extraction", raw_value: row.value });
  });

  it("deleting a required claim label is rejected by the real parser", () => {
    const records = structuredClone(scaleRecords(DRAFT_SCALE_CASES[0]!));
    delete (records.claims[0] as unknown as Record<string, unknown>).label;
    expect(projectDraftRecords(records)).toMatchObject({ ok: false, reason: "not_a_record_set" });
  });
});
