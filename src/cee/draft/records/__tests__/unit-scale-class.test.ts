import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyUnitScaleClass,
  isPercentScaledUnit,
  isBasisPointsUnit,
  deriveFactorScaleFrame,
  UNIT_SCALE_CLASS_TOKENS,
  type UnitScaleClass,
} from "../projector.js";

/**
 * ONE SCALE-CLASSIFICATION AUTHORITY — replacing two overlapping predicates
 * whose contract could not describe the domain.
 *
 * ⭐⭐ THE CLAIM THIS FILE EXISTS TO PROVE: **CONVERGENCE, NOT SEMANTICS.**
 * Every unit string classifies exactly as the two replaced predicates classified
 * it, so `deriveFactorScaleFrame` returns a byte-identical frame for every input.
 * The differential block below asserts that against a GENERATED corpus rather
 * than a hand-written one, because a corpus drawn from the author's head cannot
 * see the class the author did not imagine (trap 22) — and that is not
 * hypothetical here, it is what happened.
 *
 * ⚠⚠ WHAT HAPPENED, AND WHY THE RESTRAINT IS THE POINT. The first version of
 * this classifier was EXACT-MATCH ONLY, on the reasoning that a `startsWith`
 * predicate "invents conversions". The reasoning is sound and the consequence
 * was not measured. Base → that head, 32 spellings × 9 magnitudes:
 *
 *     '% churn'           max 1.5   level 0.015 → 0.75    a 50× OVERSTATEMENT
 *     '% churn'           max 3     level 0.03  → 0.6     20×
 *     '% churn'           max 8     level 0.08  → 0.8     10×
 *     'percentage points' max 1.5   level 0.015 → 0.75    50×
 *     '%-of-ARR'          max 12    level 0.12  → 0.6     5×
 *     'bps of revenue'    max 4500  level 0.45  → 0.9     2×
 *
 * 18 of 32 spellings moved, unbounded as `max → 1+`, and the frame also became
 * DATA-DEPENDENT — adding one option rescaled every sibling (baseline level
 * 0.8 → 0.4 → 0.16), which `projector.ts`'s own header forbids by name.
 *
 * ⚠ AND IT FAILED SILENTLY, WHICH IS THE WRONG SIDE OF THE ONE-WAY DOOR.
 * `deriveFactorScaleFrame` CAN refuse — `undefined` for negatives, for
 * `max <= 1`, for a non-finite frame. It does not refuse for an unclassified
 * unit: it falls through to the derived ladder and returns a number the caller
 * cannot distinguish from a pinned one. The ruling behind #1106 turned on
 * exactly this: base was MORE wrong and failed LOUDLY, and "refusing more than
 * needed is safe; a silent wrong number is not". The narrowed classifier was
 * LESS wrong and SILENT, on `% NRR` — the class that ruling named.
 *
 * ⛔ SO THE `pp` SEMANTICS ARE ROWED, NOT SHIPPED. Whether 'percentage points'
 * is a ×1 class that must stop taking frame 100 is a genuine one-way door with a
 * genuine answer. It moves live numbers. It does not ride beside an
 * architectural tidy-up. See `classifyUnitScaleClass`'s docstring for the
 * asymmetry this leaves in place ON PURPOSE, and do not "tidy" it.
 *
 * ⚠ BARE 'bp' IS DELIBERATELY UNKNOWN, and that is inherited, not invented: the
 * original `isBasisPointsUnit` argued it explicitly ("a bare 'bp' is left to the
 * derived frame rather than guessed"). Suppress-rather-than-guess.
 *
 * ⚠⚠ `unit === '%'` IS NEVER SUFFICIENT, AND NEITHER IS THIS CLASSIFIER ALONE.
 * The producer's convention is MAGNITUDE-DEPENDENT: CEE's extractor emits "4%" as
 * `{value: 0.04, unit: '%'}` — a FRACTION under a '%' label — while a '%' value
 * `>= 1` IS percentage points. PLoT documents this at
 * `intervention-normaliser.ts:1153-1180`, citing CEE's own
 * `compound-goal/extractor.ts:925-934`. Any caller converting a magnitude must
 * read the VALUE as well as the unit. Never re-add a bare equality on the unit.
 */

const REPO_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/**
 * ⭐⭐ THE REPLACED PREDICATES, FROZEN VERBATIM AS THE ORACLE.
 *
 * These two bodies are `isPercentScaledUnit` and `isBasisPointsUnit` EXACTLY as
 * they stood at `4362fae8`, the commit this change is measured against. They are
 * a HISTORICAL RECORD, not a fixture that tracks the code: their whole value is
 * that they cannot move when the implementation moves (trap 12b — a control
 * pinned to "current" decays into a tautology the first time "current" changes).
 *
 * ⛔ APPEND-ONLY. Do not "update" them to match a new implementation. If the
 * classifier is ever meant to diverge from them, that divergence is a product
 * decision that needs its own frame table and its own review, and the way to
 * record it is a pinned EXPECTED-DIVERGENCE list beside this oracle — never an
 * edit to the oracle itself, which would falsify what this file claims to prove.
 */
const FROZEN_BASE_PREDICATES_4362FAE8 = {
  isPercentScaledUnit(unit: string | undefined): boolean {
    if (typeof unit !== "string") return false;
    const t = unit.trim().toLowerCase();
    return t.startsWith("%") || t.startsWith("percent") || t.startsWith("per cent") || t.startsWith("pct");
  },
  isBasisPointsUnit(unit: string | undefined): boolean {
    if (typeof unit !== "string") return false;
    const t = unit.trim().toLowerCase();
    return t.startsWith("bps") || t.startsWith("basis point");
  },
  /** `deriveFactorScaleFrame`'s two pinning limbs, as they stood at base. */
  frame(magnitudes: readonly number[], unit: string | undefined): number | "ladder-or-undefined" {
    if (magnitudes.length === 0) return "ladder-or-undefined";
    if (magnitudes.some((m) => m < 0)) return "ladder-or-undefined";
    const max = Math.max(...magnitudes);
    if (max <= 1) return "ladder-or-undefined";
    if (FROZEN_BASE_PREDICATES_4362FAE8.isPercentScaledUnit(unit) && max <= 100) return 100;
    if (FROZEN_BASE_PREDICATES_4362FAE8.isBasisPointsUnit(unit) && max <= 10000) return 10000;
    return "ladder-or-undefined";
  },
};

/**
 * A GENERATED corpus — stems × tails × casing × padding, plus every 1–6 character
 * prefix of every stem. Generated rather than listed so it contains spellings
 * nobody chose, which is the only kind that can catch a predicate's breadth.
 */
function generateUnitCorpus(): string[] {
  const stems = [
    "%", "percent", "per cent", "pct", "percentage", "pp", "ppt", "pps", "bps",
    "basis point", "basis points", "bp", "percentage point", "percentage points",
    "percentage-point", "percentage-points", "ppm", "pctg", "percen", "per", "pc",
    "b", "basis", "basispoints", "bpsx", "%%", "p",
  ];
  const tails = [
    "", " NRR", " churn", " of ARR", "-of-ARR", " margin", "s", " points", " point",
    "x", "_growth", " (NRR)", " per year", "/yr", "pt", "%", " ",
  ];
  const unrelated = [
    "widgets", "ratio", "fraction", "count", "people", "£", "$", "GBP", "months",
    "weeks", "years", "x", "", "   ", "bananas per fortnight",
  ];
  const set = new Set<string>();
  for (const s of stems) {
    for (const t of tails) {
      const b = s + t;
      set.add(b);
      set.add(b.toUpperCase());
      set.add(`  ${b}  `);
      set.add(b.charAt(0).toUpperCase() + b.slice(1));
    }
    for (let i = 1; i <= Math.min(s.length, 6); i++) set.add(s.slice(0, i));
  }
  for (const u of unrelated) {
    set.add(u);
    set.add(u.toUpperCase());
    set.add(`  ${u}  `);
  }
  return [...set];
}

describe("⭐⭐ CONVERGENCE, NOT SEMANTICS — differential against the frozen base predicates", () => {
  const CORPUS = generateUnitCorpus();
  const MAGS = [1.0001, 1.5, 3, 8, 12, 30, 45, 99, 100, 101, 115, 4500, 9999, 10001];

  it("the corpus is large and DIVERSE (positive control — a probe that collected nothing agrees with everything)", () => {
    expect(CORPUS.length).toBeGreaterThan(1000);
    // It must contain members of every class, or "identical" below proves nothing.
    const classes = new Set(CORPUS.map((u) => classifyUnitScaleClass(u)));
    expect(classes).toEqual(new Set(["percent", "percentage_points", "basis_points", "unknown"]));
    // and the frozen oracle must itself discriminate over this corpus
    expect(CORPUS.filter((u) => FROZEN_BASE_PREDICATES_4362FAE8.isPercentScaledUnit(u)).length).toBeGreaterThan(100);
    expect(CORPUS.filter((u) => FROZEN_BASE_PREDICATES_4362FAE8.isBasisPointsUnit(u)).length).toBeGreaterThan(10);
  });

  it("`isPercentScaledUnit` answers IDENTICALLY to the frozen base predicate, for every generated spelling", () => {
    const moved = CORPUS.filter(
      (u) => isPercentScaledUnit(u) !== FROZEN_BASE_PREDICATES_4362FAE8.isPercentScaledUnit(u),
    );
    expect(moved, `spellings whose percent verdict MOVED: ${JSON.stringify(moved.slice(0, 20))}`).toEqual([]);
    expect(isPercentScaledUnit(undefined)).toBe(FROZEN_BASE_PREDICATES_4362FAE8.isPercentScaledUnit(undefined));
  });

  it("`isBasisPointsUnit` answers IDENTICALLY to the frozen base predicate, for every generated spelling", () => {
    const moved = CORPUS.filter(
      (u) => isBasisPointsUnit(u) !== FROZEN_BASE_PREDICATES_4362FAE8.isBasisPointsUnit(u),
    );
    expect(moved, `spellings whose basis-point verdict MOVED: ${JSON.stringify(moved.slice(0, 20))}`).toEqual([]);
    expect(isBasisPointsUnit(undefined)).toBe(FROZEN_BASE_PREDICATES_4362FAE8.isBasisPointsUnit(undefined));
  });

  it("⛔ `deriveFactorScaleFrame` RETURNS THE SAME FRAME as base, for every spelling × every magnitude", () => {
    /**
     * ⚠ THE FIRST VERSION OF THIS ASSERTION WAS WRONG, IN THE FALSE-ALARM
     * DIRECTION, AND THE MISTAKE IS WORTH KEEPING. It collapsed "the frame came
     * back as 100" into "the percent limb pinned it" — but the {1,2,5}·10^k
     * ladder ALSO returns 100 (for max 99) and 10000 (for max 9999). So a
     * genuinely unclassified unit like `'bananas per fortnight'` was scored as a
     * regression when nothing had moved. A collapsed oracle cannot tell two
     * mechanisms apart just because their outputs agree on some inputs.
     *
     * ⭐ THE LADDER IS NOT REIMPLEMENTED HERE. It is DERIVED from the function
     * under test by asking it for a unit that pins nothing — a hand-copied
     * `nextNiceNumberAbove` would be the hand-maintained mirror this file is
     * about, and it would drift the first time the ladder legitimately changed.
     * The precondition (that the probe unit really is unclassified) is pinned
     * in-test, so this cannot silently stop discriminating.
     */
    const UNCLASSIFIED_PROBE = "bananas per fortnight";
    expect(classifyUnitScaleClass(UNCLASSIFIED_PROBE), "precondition: the ladder probe must pin nothing").toBe("unknown");
    expect(FROZEN_BASE_PREDICATES_4362FAE8.isPercentScaledUnit(UNCLASSIFIED_PROBE)).toBe(false);
    expect(FROZEN_BASE_PREDICATES_4362FAE8.isBasisPointsUnit(UNCLASSIFIED_PROBE)).toBe(false);

    const moved: string[] = [];
    for (const u of CORPUS) {
      for (const m of MAGS) {
        const actual = deriveFactorScaleFrame([m], u);
        const basePin = FROZEN_BASE_PREDICATES_4362FAE8.frame([m], u);
        const expected =
          basePin === "ladder-or-undefined" ? deriveFactorScaleFrame([m], UNCLASSIFIED_PROBE) : basePin;
        if (actual !== expected) moved.push(`${JSON.stringify(u)}@${m}: base=${expected} now=${actual}`);
      }
    }
    expect(moved, `frames that MOVED: ${JSON.stringify(moved.slice(0, 20))}`).toEqual([]);
  });

  it("⛔ …and for GROWING option sets — the data-dependence gate, across the whole corpus", () => {
    const UNCLASSIFIED_PROBE = "bananas per fortnight";
    const GROWING: ReadonlyArray<readonly number[]> = [[8], [8, 12], [8, 12, 30], [0.5, 40], [3, 3000]];
    const moved: string[] = [];
    for (const u of CORPUS) {
      for (const mags of GROWING) {
        const actual = deriveFactorScaleFrame(mags, u);
        const basePin = FROZEN_BASE_PREDICATES_4362FAE8.frame(mags, u);
        const expected =
          basePin === "ladder-or-undefined" ? deriveFactorScaleFrame(mags, UNCLASSIFIED_PROBE) : basePin;
        if (actual !== expected) moved.push(`${JSON.stringify(u)}@[${mags}]: base=${expected} now=${actual}`);
      }
    }
    expect(moved, `frames that MOVED: ${JSON.stringify(moved.slice(0, 20))}`).toEqual([]);
  });
});

describe("⛔ RED-FIRST — the exact regressions this fix exists to prevent", () => {
  /**
   * These four fail at `bd034779` (the exact-match-only head) and pass here.
   * They are named for the value that moved, not for the code that moved it.
   */
  it("'% churn' at max 1.5 stays level 0.015 — NOT 0.75, a 50× overstatement", () => {
    const frame = deriveFactorScaleFrame([1.5], "% churn");
    expect(frame).toBe(100);
    expect(1.5 / frame!).toBeCloseTo(0.015, 10);
  });

  it("'% NRR' — the founder's named class — at max 45 stays level 0.45, not 0.9", () => {
    const frame = deriveFactorScaleFrame([45], "% NRR");
    expect(frame).toBe(100);
    expect(45 / frame!).toBeCloseTo(0.45, 10);
  });

  it("'bps of revenue' at max 4500 stays level 0.45 — the basis-point family was NOT narrowed", () => {
    const frame = deriveFactorScaleFrame([4500], "bps of revenue");
    expect(frame).toBe(10000);
    expect(4500 / frame!).toBeCloseTo(0.45, 10);
  });

  it("⛔ DATA-DEPENDENCE: adding an option must NOT rescale a labelled-ratio sibling", () => {
    // The harm: a user adds one option and the STATUS QUO's own level falls 5×,
    // so the analysis can recommend the wrong option with no refusal anywhere.
    const grow = [[8], [8, 12], [8, 12, 30]];
    const labelled = grow.map((mags) => deriveFactorScaleFrame(mags, "% churn"));
    expect(labelled, "'% churn' frame must be invariant to the option set").toEqual([100, 100, 100]);
    const canonical = grow.map((mags) => deriveFactorScaleFrame(mags, "%"));
    expect(canonical, "contrast control: canonical '%' was always invariant").toEqual([100, 100, 100]);

    // ⭐ THE DISCRIMINATING PARTNER. Without this the assertion above could pass
    // on a function that pins 100 for everything. A genuinely unclassified unit
    // MUST still be data-dependent — that is the ladder working as designed, and
    // it is precisely what the labelled spellings must not be doing.
    const unclassified = grow.map((mags) => deriveFactorScaleFrame(mags, "widgets"));
    expect(unclassified, "the ladder IS data-dependent — so the pins above are real pins").toEqual([10, 20, 50]);
  });
});

describe("classifyUnitScaleClass — one authority, exact-then-prefix", () => {
  it("PERCENT: every canonical spelling, case-insensitively", () => {
    for (const u of ["%", "percent", "per cent", "pct", "percentage", "Percent", "PCT", "  %  "]) {
      expect(classifyUnitScaleClass(u), u).toBe("percent");
    }
  });

  it("PERCENT: tailed spellings too — the prefix layer, and the reason 18 spellings did not move", () => {
    for (const u of ["% NRR", "% churn", "%-of-ARR", "% of ARR", "pcts", "per cent NRR", "%pt", "%%"]) {
      expect(classifyUnitScaleClass(u), u).toBe("percent");
    }
  });

  it("PERCENTAGE POINTS: the abbreviations — a family that matched NEITHER old predicate", () => {
    for (const u of ["pp", "ppt", "pps", "PP", "  pps  ", "pp of margin"]) {
      expect(classifyUnitScaleClass(u), u).toBe("percentage_points");
    }
  });

  it("⛔ THE ROWED ASYMMETRY, PINNED: spelled-out 'percentage points' is still `percent`", () => {
    /**
     * ⛔ THIS IS NOT A BUG AND IT IS NOT TIDINESS DEBT. It is the deliberate
     * boundary of this change, and it is pinned so that closing it has to be a
     * DECISION rather than a cleanup.
     *
     * Both old predicates sent 'percentage point(s)' down `startsWith("percent")`
     * to frame 100, and every build to date has shipped that. The abbreviations
     * matched nothing and fell to the ladder. Making the spelled-out forms agree
     * with the abbreviations moves live levels 50× on this seam — measured, and
     * in the direction #1106 was written to stop. So it is ROWED.
     *
     * If you are here to "make the classifier consistent": that change needs a
     * frame table across every spelling and its own review. Changing this line to
     * make the vocabulary tidy IS the product decision, taken by accident.
     */
    for (const u of ["percentage point", "percentage points", "percentage-point", "percentage-points"]) {
      expect(classifyUnitScaleClass(u), u).toBe("percent");
      expect(deriveFactorScaleFrame([10, 20, 30], u), u).toBe(100);
    }
    // The abbreviations, the other half of the asymmetry — deliberately unpinned.
    expect(classifyUnitScaleClass("pp")).toBe("percentage_points");
    expect(deriveFactorScaleFrame([10, 20, 30], "pp")).toBe(50);
  });

  it("BASIS POINTS: keeps the behaviour CEE already had right, prefixes included", () => {
    for (const u of ["bps", "basis point", "basis points", "BPS", "Basis Points", "bps of revenue", "basis points of margin"]) {
      expect(classifyUnitScaleClass(u), u).toBe("basis_points");
    }
  });

  it("OPPOSITE-DIRECTION TWIN: a bare 'bp' stays UNKNOWN, deliberately", () => {
    expect(classifyUnitScaleClass("bp")).toBe("unknown");
    expect(classifyUnitScaleClass("bp spread")).toBe("unknown");
  });

  it("UNKNOWN: unsupported, empty and non-string units fail visibly, not by default", () => {
    for (const u of ["widgets", "flurbs", "bananas per fortnight", "", "   "]) {
      expect(classifyUnitScaleClass(u), JSON.stringify(u)).toBe("unknown");
    }
    expect(classifyUnitScaleClass(undefined)).toBe("unknown");
  });

  it("OPPOSITE-DIRECTION TWIN: the other unit families are UNKNOWN to this classifier", () => {
    for (const u of ["ratio", "fraction", "count", "people", "£", "$", "GBP", "months", "weeks", "years"]) {
      expect(classifyUnitScaleClass(u), u).toBe("unknown");
    }
  });

  it("the classifier DISCRIMINATES (it is not returning one answer for everything)", () => {
    const answers = new Set(["%", "pp", "bps", "widgets"].map((u) => classifyUnitScaleClass(u)));
    expect(answers.size).toBe(4);
  });

  it("⚠ THE TWO LAYERS AGREE — DERIVED from the production table, not from a list in this file", () => {
    /**
     * A lookup table that overrides the prefix layer is how a silent behaviour
     * change gets to wear a data structure's clothes. Today the exact layer is
     * REDUNDANT — every one of its tokens resolves the same way by prefix — and
     * that redundancy is WHY this change is byte-for-byte. It is kept because it
     * is the mechanism the rowed decision will need.
     *
     * ⭐⭐ THIS TEST USED TO ITERATE AN ELEVEN-TOKEN LITERAL DECLARED RIGHT HERE,
     * AND THAT IS WHY IT DID NOT BITE. A second copy of the production
     * vocabulary is the hand-maintained mirror this whole module exists to
     * abolish — reintroduced, of all places, in the guard against it. Measured
     * at `8111337c`: adding the single token `"percentile"` to the production
     * table's `basis_points` row moved `deriveFactorScaleFrame([45],
     * "percentile")` from 100 to 10000 — level 0.45 to 0.0045, a 100x
     * understatement — with **26/26 GREEN**. The literal did not name the token,
     * and the generated corpus (1785 spellings) does not contain it either, so
     * BOTH layers of cover missed it for the same reason: each was a set of
     * tokens somebody had already thought of.
     *
     * It now iterates `UNIT_SCALE_CLASS_TOKENS` itself, so a token added to the
     * production table is judged the moment it is added.
     *
     * ⚠ WHAT THIS CANNOT SEE — trap 12d, and it is why the sibling test exists.
     * Deriving a guard from a list proves the two LAYERS agree; it is
     * structurally blind to a list that is SHORT, and it cannot tell you a
     * token's class is the RIGHT class. `"percentile" -> percent` would pass
     * here — both layers agree on it — and admitting it is a product decision.
     */
    const rows: ReadonlyArray<readonly [UnitScaleClass, string]> = UNIT_SCALE_CLASS_TOKENS.flatMap(
      ([cls, tokens]) => tokens.map((t) => [cls, t] as const),
    );

    // POSITIVE CONTROL. An emptied or gutted table would make the loop below
    // iterate nothing and pass by asserting nothing — the vacuity this file
    // spends its whole length hunting. Pinned so the guard cannot go quiet.
    expect(rows.length, "the exact table must be non-empty, or the loop below proves nothing").toBeGreaterThan(0);
    expect(
      new Set(rows.map(([cls]) => cls)),
      "every class the exact layer claims to serve must actually appear in it",
    ).toEqual(new Set<UnitScaleClass>(["percent", "percentage_points", "basis_points"]));

    for (const [cls, token] of rows) {
      expect(classifyUnitScaleClass(token), token).toBe(cls);
      // …and the same answer when reached with a tail, i.e. through the prefix
      // layer. THIS is the half that bites: an exact token can always satisfy
      // its own lookup, so only the tailed form can expose a contradiction.
      expect(classifyUnitScaleClass(`${token} of revenue`), `${token} of revenue`).toBe(cls);
    }
  });

  it("…and the exact table has NOT SILENTLY SHRUNK — the completeness half a derived guard cannot supply", () => {
    /**
     * ⭐ TRAP 12d, THE SECOND FACE. Deriving the test above from the production
     * table removed one mirror and MOVED the risk rather than removing it: a
     * derived guard proves the copies AGREE and can never prove the list is
     * COMPLETE. The only thing that catches a short list is a hand-written
     * corpus — i.e. exactly the mirror derivation was introduced to abolish.
     * Both guards ship; neither supersedes the other.
     *
     * ⚠ DELIBERATELY A SUBSET ASSERTION, NOT AN EQUALITY. Adding a token is
     * judged by the derived test above, so requiring equality here would make
     * every legitimate addition a false alarm and train the next lane to edit
     * this list without reading it. Removing one is what this REDs on — and a
     * removal is a semantics change, because these eleven have been pinned to
     * frame 100 / 10000 by every build to date.
     *
     * ⚠ ITS SCOPE IS THESE ELEVEN AND NOTHING ELSE. It cannot notice a token
     * that ought to exist and never did.
     */
    const rows = UNIT_SCALE_CLASS_TOKENS.flatMap(([cls, tokens]) => tokens.map((t) => [cls, t] as const));
    const MUST_CONTAIN: ReadonlyArray<readonly [UnitScaleClass, string]> = [
      ["percent", "%"], ["percent", "percent"], ["percent", "per cent"],
      ["percent", "pct"], ["percent", "percentage"],
      ["percentage_points", "pp"], ["percentage_points", "ppt"], ["percentage_points", "pps"],
      ["basis_points", "bps"], ["basis_points", "basis point"], ["basis_points", "basis points"],
    ];
    for (const [cls, token] of MUST_CONTAIN) {
      expect(rows, `"${token}" must still be an exact \`${cls}\` token`).toContainEqual([cls, token]);
    }
  });
});

describe("deriveFactorScaleFrame — the single consumer, behaviour pinned", () => {
  it("percent frames at 100 when the magnitudes fit", () => {
    expect(deriveFactorScaleFrame([20, 40, 60], "%")).toBe(100);
    expect(deriveFactorScaleFrame([20, 40, 60], "per cent")).toBe(100);
  });

  it("basis points frame at 10000", () => {
    expect(deriveFactorScaleFrame([30, 250], "bps")).toBe(10000);
  });

  it("above the pinning band the ladder still takes over — unchanged, and the #1106 case", () => {
    expect(deriveFactorScaleFrame([115], "% NRR")).toBe(200);
    expect(deriveFactorScaleFrame([20000], "bps")).toBe(50000);
  });

  it("POSITIVE CONTROL + preserved invariants: unit-interval and negatives unchanged", () => {
    expect(deriveFactorScaleFrame([0.2, 0.9], "%")).toBeUndefined(); // already unit interval
    expect(deriveFactorScaleFrame([-5, 10], "%")).toBeUndefined(); // negative -> no truthful frame
    expect(deriveFactorScaleFrame([], "%")).toBeUndefined();
  });

  it("the legacy predicates still answer their own question (kept, delegating, unchanged)", () => {
    expect(isPercentScaledUnit("%")).toBe(true);
    expect(isBasisPointsUnit("bps")).toBe(true);
    // ⚠ Unchanged from base ON PURPOSE — see the rowed asymmetry above.
    expect(isPercentScaledUnit("percentage points")).toBe(true);
    expect(isPercentScaledUnit("% NRR")).toBe(true);
    expect(isPercentScaledUnit("pp")).toBe(false);
    expect(isBasisPointsUnit("bp")).toBe(false);
  });
});


/**
 * KNOWN-UNMIGRATED: the inline `unit === '%'` sites.
 *
 * 41 CODE SITES across 21 files, re-derived at base 4362fae8 (staging with #1154 merged). They are NOT migrated here, on purpose:
 * `findings` derived that the x100/÷100 sites among them are fed by the regex
 * extractor, whose unit output domain is CLOSED to { '%', a currency symbol,
 * undefined } — its only unit capture group is literally `(?<unit>%)?`. An exact
 * equality is therefore CORRECT AND COMPLETE for that producer, and migrating it
 * would be churn with non-zero risk and no harm removed.
 *
 * The set is pinned so it REDs if it GROWS (a new bare equality is added) or
 * SHRINKS (one is migrated without recording it). A gap recorded in the suite is
 * honest; a gap invisible to it is how this class reopens.
 */
const KNOWN_INLINE_PERCENT_EQUALITY_SITES: Readonly<Record<string, number>> = {
  "cee/compound-goal/direction-gate.ts": 3,
  "cee/compound-goal/extractor.ts": 1,
  "cee/compound-goal/node-generator.ts": 1,
  "cee/decision-review/shape-check.ts": 1,
  "cee/factor-extraction/display-value.ts": 7,
  "cee/factor-extraction/enricher.ts": 3,
  "cee/factor-extraction/index.ts": 4,
  "cee/transforms/graph-data-integrity.ts": 2,
  "cee/unified-pipeline/stages/repair/deterministic-sweep.ts": 1,
  "cee/unified-pipeline/stages/repair/unreachable-factors.ts": 3,
  "orchestrator-v5/compose/validation-failure-responses.ts": 1,
  "orchestrator-v5/compose/warrant-demotion.ts": 1,
  "orchestrator-v5/context/cqe/compromise-backstop.ts": 1,
  "orchestrator-v5/context/cqe/rules.ts": 1,
  "orchestrator-v5/handlers/describe-changeset.ts": 1,
  "orchestrator-v5/label-value-divergence.ts": 1,
  "orchestrator-v5/routing/resolve-relative-factor-delta.ts": 1,
  "orchestrator-v5/tools/handlers/add-constraint.ts": 3,
  "orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.ts": 1,
  "orchestrator/canonicalise-value-ops.ts": 3,
  "utils/goal-threshold-cap.ts": 1,
};

function deriveInlinePercentEqualitySites(): Record<string, number> {
  const re = /=== *['"]%['"]/g;
  const out: Record<string, number> = {};
  // `withFileTypes` deliberately: reading the kind off the Dirent the directory
  // listing ALREADY returned removes the separate `statSync` and with it the
  // check-then-use pattern CodeQL correctly flagged here (js/file-system-race).
  // One syscall per entry instead of two, and nothing to race against.
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      // CODE SITES ONLY. Comment lines are excluded: prose that MENTIONS the
      // pattern (including this module's own "do not re-add a bare equality" note)
      // is not a site, and counting it would make the pin drift on documentation edits.
      const n = readFileSync(full, "utf8")
        .split("\n")
        .filter((line) => {
          const t = line.trim();
          return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
        })
        .reduce((acc, line) => acc + (line.match(re) ?? []).length, 0);
      if (n > 0) out[relative(REPO_SRC, full)] = n;
    }
  };
  walk(REPO_SRC);
  return out;
}

describe("inline `unit === '%'` sites — pinned as an explicit KNOWN-UNMIGRATED set", () => {
  it("the scanner can SEE the pattern (positive control)", () => {
    const found = deriveInlinePercentEqualitySites();
    expect(Object.keys(found).length).toBeGreaterThan(10);
    const total = Object.values(found).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(30);
  });

  it("carries EXACTLY the known set — REDs if it GROWS or SHRINKS", () => {
    expect(deriveInlinePercentEqualitySites()).toEqual(KNOWN_INLINE_PERCENT_EQUALITY_SITES);
  });
});
