import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { DeclaredScale } from "@talchain/schemas";
import { synthesiseRangeDisplayValue } from "../display-value.js";
import { isPercentScaledUnit } from "../../draft/records/projector.js";
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
 * `draft/records/projector.ts:1016` `isPercentScaledUnit` matches by PREFIX —
 * `%` · `percent` · `per cent` · `pct` — while `display-value.ts` tests
 * `unit === "%"` EXACTLY, in seven places. Two predicates, one concept: the
 * differently-named-twins defect this estate keeps paying for.
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

  it("every sampled spelling IS accepted by the twin predicate — the sample is DERIVED, not invented", () => {
    // Binds the sample to `isPercentScaledUnit` itself. Without this the list
    // could drift into units the predicate never accepted, and the "twin
    // predicate" framing would quietly stop being true of its own corpus.
    for (const unit of SAMPLED_DIVERGENT_PERCENT_SPELLINGS) {
      expect(isPercentScaledUnit(unit)).toBe(true);
    }
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
 * The draft prompt MANDATES the ratio encoding in two places
 * (`Prompts/canonical/draft_graph.txt:320` and `src/prompts/defaults-v187.ts:300`,
 * verbatim: *"Ratio that can exceed 100% | raw ratio | percentage points |
 * NRR 110% -> 1.10, raw 110"*). On that encoding `value` (1.10) and
 * `raw_value` (110) DIFFER BY CONSTRUCTION, so the guard cannot fire on a
 * compliant factor. It only fires on a violation — which is precisely the case
 * that was rendering a lie.
 */
describe("COMPOSED TREE — a factor stating 115% renders on ONE scale, in both encodings", () => {
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

  it("the MANDATED ratio encoding (value 1.15, raw 115) renders 57.5% to 172.5%", () => {
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

  it("the compliant factor still earns its ratio declaration", () => {
    expect(
      displayFor({ value: 1.15, raw_value: 115, unit: "%", operator: ">=", extractionType: "explicit" }),
    ).toBe("57.5% to 172.5%");
  });
});

// ---------------------------------------------------------------------------
// THE GUARD'S PREMISE, READ FROM THE PRODUCER'S OWN BYTES
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const SERVED_PROMPT_PATH = resolve(REPO_ROOT, "Prompts/canonical/draft_graph.txt");
const MANIFEST_PATH = resolve(REPO_ROOT, "Prompts/canonical/manifest.json");
const SECOND_COPY_PATH = resolve(REPO_ROOT, "src/prompts/defaults-v187.ts");

/**
 * The ratio-encoding row, matched BY SHAPE rather than by line number (a line
 * number is its own little mirror — `CLAUDE.md` trap 12). The prompt states the
 * encoding as a markdown table row:
 *
 *   | Type | model value | raw_value | Example |
 *   | Ratio that can exceed 100% | raw ratio | percentage points | NRR 110% → 1.10, raw 110 |
 */
const RATIO_ROW_RE = /^\|\s*Ratio that can exceed 100%\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/gm;
/** The worked example's two magnitudes: `… → <model value>, raw <raw_value>`. */
const WORKED_EXAMPLE_RE = /→\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*raw\s+([0-9]+(?:\.[0-9]+)?)/;

/**
 * ⛔ THIS BLOCK REPLACES A GUARD THAT COULD NOT FAIL.
 *
 * It previously read, in full:
 *
 *     const compliant = { value: 1.15, raw_value: 115 };
 *     expect(compliant.value).not.toBe(compliant.raw_value);
 *
 * — two fields of a literal declared on the line above, under a docstring
 * claiming it "REDs if a future producer ever emits value === raw_value".
 * `1.15 !== 115` by construction, so nothing about any producer could move it.
 * MEASURED, not argued: rewriting the mandate row in BOTH cited prompt files to
 * say the two are the SAME left the file 48/48 GREEN. The premise was
 * destroyed at the producer and the guard noticed nothing.
 *
 * The premise IS real and IS readable, so it is now READ. Everything below
 * derives from `Prompts/canonical/draft_graph.txt`, bound to the SERVED
 * artefact by the canonical manifest's own digest — not merely to a file that
 * happens to sit on disk at that path.
 */
describe("PRECONDITION — the ratio encoding is MANDATED by the served draft prompt", () => {
  it("the cited prompt is readable, non-empty, and IS the served artefact (sha256 == manifest)", () => {
    // If this REDs the guard is not "broken" — it is telling you the artefact it
    // derives from has moved or is no longer the one CEE serves, which is
    // precisely when a silent mirror starts rotting.
    const served = readFileSync(SERVED_PROMPT_PATH, "utf8");
    expect(served.length, `prompt unreadable or empty at ${SERVED_PROMPT_PATH}`).toBeGreaterThan(0);

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      pms_prompts: ReadonlyArray<{ key: string; file: string; sha256: string }>;
    };
    const entry = manifest.pms_prompts.find((p) => p.key === "draft_graph");
    expect(entry, "the canonical manifest has no `draft_graph` entry").toBeDefined();
    expect(entry!.file).toBe("Prompts/canonical/draft_graph.txt");
    expect(
      createHash("sha256").update(served, "utf8").digest("hex"),
      "the file at Prompts/canonical/draft_graph.txt is NOT the digest the manifest attests as " +
        "served. Either the file drifted or the manifest did — re-derive which before trusting " +
        "any expectation in this file, because they all rest on these bytes.",
    ).toBe(entry!.sha256);
  });

  it("finds EXACTLY ONE ratio-encoding row — zero would mean this guard silently stopped checking", () => {
    const served = readFileSync(SERVED_PROMPT_PATH, "utf8");
    const rows = [...served.matchAll(RATIO_ROW_RE)];
    expect(
      rows.length,
      `expected exactly one "| Ratio that can exceed 100% | … |" row in ${SERVED_PROMPT_PATH}; ` +
        `found ${rows.length}. ZERO means the row's WORDING changed and every assertion below ` +
        "would pass by matching nothing (trap 13 — an absence probe with no positive control). " +
        "MORE THAN ONE means there are competing authorities on the encoding.",
    ).toBe(1);
  });

  it("⭐ DERIVED: the served prompt's worked example keeps model value and raw_value DISTINCT", () => {
    // THIS IS THE GUARD'S WHOLE PREMISE. `declaredScaleOf`'s ratio arm treats
    // `rawValue === value` as proof of NON-normalisation and declines to stamp
    // `ratio`. That is only safe because a COMPLIANT factor never presents the
    // two as equal — and the reason it never does is that the producer's own
    // instruction mandates the two columns be different quantities.
    const served = readFileSync(SERVED_PROMPT_PATH, "utf8");
    const rows = [...served.matchAll(RATIO_ROW_RE)];

    // ── PIN THE PRECONDITION IN-TEST, so this cannot pass vacuously ──────────
    // Without these three the assertions below hold trivially on a row that
    // stopped matching, or on an example that stopped parsing.
    expect(rows.length, "no ratio row matched — see the previous test").toBe(1);
    const example = rows[0]![3]!;
    const parsed = WORKED_EXAMPLE_RE.exec(example);
    expect(
      parsed,
      `the ratio row's example column (${JSON.stringify(example)}) no longer parses as ` +
        '"→ <model value>, raw <raw_value>". The mandate may still be stated in some other ' +
        "shape, but THIS guard can no longer read it — re-anchor it rather than deleting it.",
    ).not.toBeNull();

    const modelValue = Number(parsed![1]);
    const rawValue = Number(parsed![2]);
    expect(Number.isFinite(modelValue) && Number.isFinite(rawValue)).toBe(true);
    expect(modelValue, "a zero model value would make DISTINCTNESS accidental").toBeGreaterThan(0);

    // ── THE MANDATE ITSELF, written against the SPEC and not against the
    // failure mode (trap 13d): the columns are "raw ratio" and "percentage
    // points", so the raw magnitude IS the model value expressed in percentage
    // points. Distinctness is a CONSEQUENCE of that, which is why it is
    // asserted second rather than assumed first.
    expect(
      Math.round(modelValue * 100),
      `the served prompt now mandates model value ${modelValue} with raw_value ${rawValue}. ` +
        "The ratio row's two columns are declared `raw ratio` and `percentage points`, so " +
        "raw_value should be the model value in percentage points.",
    ).toBe(rawValue);

    // ⭐ AND THE CLAUSE `declaredScaleOf` ACTUALLY RESTS ON. If a future producer
    // ever mandates value === raw_value for a genuine ratio, THIS REDs — which
    // is what the deleted literal-comparison only claimed to do.
    expect(
      modelValue,
      "THE GUARD'S PREMISE HAS BEEN WITHDRAWN AT THE PRODUCER. `declaredScaleOf` " +
        "(unreachable-factors.ts) reads `rawValue === value` as proof a factor was NOT " +
        "normalised and refuses to stamp `ratio`. If the served prompt now mandates them " +
        "equal, that read fires on COMPLIANT factors and strips the declaration from every " +
        "legitimate ratio — re-derive the guard, do not re-point this test.",
    ).not.toBe(rawValue);
  });

  it("the SECOND copy the guard cites has not drifted from the served bytes", () => {
    // Two authorities on one question do not get to drift (trap 21). Both files
    // are cited by `declaredScaleOf`'s own comment; if they disagree, the
    // comment is naming a rule that is only half true.
    const servedRows = [...readFileSync(SERVED_PROMPT_PATH, "utf8").matchAll(RATIO_ROW_RE)];
    const copyRows = [...readFileSync(SECOND_COPY_PATH, "utf8").matchAll(RATIO_ROW_RE)];
    expect(servedRows.length, "served prompt: ratio row missing").toBe(1);
    expect(
      copyRows.length,
      `${SECOND_COPY_PATH} no longer carries the ratio-encoding row that ` +
        "`declaredScaleOf`'s comment cites alongside the canonical prompt.",
    ).toBe(1);
    expect(copyRows[0]![0]!.trim()).toBe(servedRows[0]![0]!.trim());
  });
});
