/**
 * NUMBER-WORD AMOUNTS AND THE HORIZON BLOCKED BY A TRAILING WORD (L67).
 *
 * THE LIVE DEFECT (journey walk, runT1b, 4 Aug 2026 — verbatim): a draft brief
 * whose goal is
 *
 *   "Our goal is to grow MRR from one hundred and eighty thousand pounds to
 *    two hundred and fifty thousand pounds by the end of December 2026."
 *
 * minted NO goal target ("Goal target missing" on the card, `thresholds: []`
 * on the wire), while the digit form "£250,000 by 31 December 2026" minted
 * correctly. This landed HOURS after #812 shipped "calendar dates + complete
 * number words anchor goals" — and #812's claim was true for its class: its
 * number words are the DURATION words in the HORIZON's count slot ("within
 * FIVE months"). The walk's number words sit in the AMOUNT slot, which #812
 * never touched.
 *
 * TWO ROOTS, both measured at pristine `959a953f` through the real path:
 *
 *   ROOT A — the whole goal-pair amount grammar was digit-anchored
 *   (`AMOUNT_DIGITS` = `\d…`). "two hundred and fifty thousand" carries ZERO
 *   digits, so no GOAL_BASELINE_PATTERN could match it anywhere. The magnitude
 *   alphabet only ever read suffixes trailing digits ("250 thousand" — and see
 *   root B for why even THAT failed in the walk's phrasing).
 *
 *   ROOT B — on pattern 4, the target's trailing metric word was read by a
 *   ZERO-WIDTH lookahead (`trailingMetricLookahead`), correct for pattern 1
 *   where the target ends the pattern (#2258 byte-parity), but on pattern 4
 *   the HORIZON slot comes after it: the unconsumed word sat in front of the
 *   horizon, the horizon never matched, `isGoalAnchored` returned false, and
 *   the match was skipped as a lever. Measured: even the DIGIT brief
 *   "…from £180,000 to £250,000 revenue by 31 December 2026" minted NOTHING,
 *   and the mixed "…250 thousand pounds by the end of December 2026" died the
 *   same way. The walk phrase needs BOTH roots fixed: words amounts (A) and a
 *   consumed "pounds" so the horizon can anchor (B).
 *
 * WHY #812's OWN 12d GUARDS COULD NOT SEE THIS — recorded because the
 * instrument finding matters as much as the fix:
 *   · the DERIVED half asserts every goal pattern contains `AMOUNT_DIGITS`
 *     and `MAGNITUDE_ALTERNATION` — agreement about the DIGIT grammar. It is
 *     structurally incapable of noticing an entire absent VOCABULARY
 *     (cardinal words). 12d's second face, exactly as written.
 *   · the HAND CORPUS half spelled every amount in digits or £-symbols, and
 *     never placed a metric/currency WORD between a pattern-4 target and its
 *     horizon. The corpus was short in a different DIMENSION than the one
 *     #812 widened. This file is the corpus for both new dimensions.
 *
 * Trap 19 discipline: every assertion binds by IDENTITY — the pair by its
 * full field set and matchedText, the factor by label + value + baseline +
 * unit together — never by a value predicate another object could satisfy.
 */

import { describe, expect, it } from "vitest";

import {
  extractFactors,
  extractGoalTargetWithBaseline,
  amountPatternForDriftGuard,
} from "../index.js";
import {
  CARDINAL_AMOUNT_SOURCE,
  CARDINAL_WORD_VALUES,
  CARDINAL_SCALE_MULTIPLIERS,
} from "../../../utils/cardinal-words.js";
import { MAGNITUDE_MULTIPLIERS } from "../../../utils/magnitude-alphabet.js";

/** The walk's verbatim brief, byte-for-byte from runT1b/wire-draft-0-req.txt. */
const WALK_BRIEF =
  "We are deciding how to grow our subscription software business next year. " +
  "The options are: raise prices on the existing plan, launch a lower-priced starter tier, " +
  "or invest in outbound sales. Our goal is to grow MRR from one hundred and eighty thousand pounds " +
  "to two hundred and fifty thousand pounds by the end of December 2026. " +
  "Key uncertainties are how churn responds to a price rise and how fast we can hire salespeople.";

const WALK_CONSTRUCTION =
  "grow MRR from one hundred and eighty thousand pounds " +
  "to two hundred and fifty thousand pounds by the end of December 2026";

describe("L67 — the walk's verbatim brief mints its goal target", () => {
  it("the pair forms: 250,000 over a 180,000 baseline, in pounds", () => {
    const pair = extractGoalTargetWithBaseline(WALK_BRIEF);
    expect(pair, "the walk brief still mints NO goal pair").not.toBeNull();
    expect(pair!.value).toBe(250_000);
    expect(pair!.baseline).toBe(180_000);
    expect(pair!.unit).toBe("£");
    expect(pair!.matchedText).toBe(WALK_CONSTRUCTION);
  });

  it("extractFactors publishes exactly ONE Target factor, identity-bound", () => {
    const targets = extractFactors(WALK_BRIEF).filter((f) => f.label === "Target");
    expect(targets, "no Target factor — the goal card stays 'Goal target missing'").toHaveLength(1);
    const [target] = targets;
    expect(target.value).toBe(250_000);
    expect(target.baseline).toBe(180_000);
    expect(target.unit).toBe("£");
    expect(target.extractionType).toBe("explicit");
    expect(target.confidence).toBe(0.95);
    expect(target.matchedText).toBe(WALK_CONSTRUCTION);
  });
});

/* ===========================================================================
 * THE MATRIX THE WALK DIDN'T RUN — {digit, number-words, mixed} × {calendar
 * date, end-of-month, no date}, through the REAL path. Expected verdicts are
 * per-cell so a regression names its cell.
 * ========================================================================= */

describe("L67 — the amount-form × date-form matrix", () => {
  const AMOUNTS: ReadonlyArray<readonly [string, string, string]> = [
    ["digit", "£180,000", "£250,000"],
    [
      "number-words",
      "one hundred and eighty thousand pounds",
      "two hundred and fifty thousand pounds",
    ],
    ["mixed", "180 thousand pounds", "250 thousand pounds"],
  ];
  const DATES: ReadonlyArray<readonly [string, string]> = [
    ["calendar-date", " by 31 December 2026"],
    ["end-of-month", " by the end of December 2026"],
  ];

  for (const [aName, fromAmt, toAmt] of AMOUNTS) {
    for (const [dName, date] of DATES) {
      it(`${aName} × ${dName} mints 250,000 over 180,000`, () => {
        const brief = `Our goal is to grow MRR from ${fromAmt} to ${toAmt}${date}.`;
        const pair = extractGoalTargetWithBaseline(brief);
        expect(pair, brief).not.toBeNull();
        expect(pair!.value, brief).toBe(250_000);
        expect(pair!.baseline, brief).toBe(180_000);
        expect(pair!.unit, brief).toBe("£");
      });
    }

    it(`${aName} × no-date stays NULL — pinned residual, not a promise`, () => {
      // The "Our goal is to <verb>…" preamble is NOT read by `isGoalAnchored`
      // (it looks at the goal word after `to`, inside the metric phrase, or a
      // horizon — never BEFORE the direction verb). With no date there is no
      // anchor, so nothing mints — for DIGITS too, at pristine and now. This
      // pin keeps the residual visible; widening the anchor to a pre-verb
      // "goal is to" is a separate, deliberate decision (reported to the
      // orchestrator, not smuggled in here).
      const brief = `Our goal is to grow MRR from ${fromAmt} to ${toAmt}.`;
      expect(extractGoalTargetWithBaseline(brief), brief).toBeNull();
    });
  }
});

/* ===========================================================================
 * ROOT B IN ISOLATION — DIGIT amounts, so a words-grammar fix alone cannot
 * satisfy these: the trailing word must be CONSUMED for the horizon to anchor.
 * ========================================================================= */

describe("L67 — a trailing metric word no longer blocks the horizon anchor (pattern 4)", () => {
  const CASES: ReadonlyArray<readonly [string, number, number, string | undefined]> = [
    ["Our goal is to grow MRR from £180,000 to £250,000 revenue by 31 December 2026.", 250_000, 180_000, "£"],
    ["Grow MRR from £180k to £250k MRR by 31 Dec 2026", 250_000, 180_000, "£"],
    ["Our goal is to grow MRR from 180 thousand pounds to 250 thousand pounds by the end of December 2026.", 250_000, 180_000, "£"],
  ];
  for (const [brief, value, baseline, unit] of CASES) {
    it(brief, () => {
      const pair = extractGoalTargetWithBaseline(brief);
      expect(pair, "horizon still blocked by the trailing word").not.toBeNull();
      expect(pair!.value).toBe(value);
      expect(pair!.baseline).toBe(baseline);
      expect(pair!.unit).toBe(unit);
    });
  }

  it("the consumed word still feeds the cross-metric refusal: pounds vs dollars refuses", () => {
    // Root B consumes the trailing word — the refusal machinery must SEE it,
    // not lose it: a dollars target against a pounds baseline is still refused
    // (and the refusal suppresses the bare target too).
    const brief =
      "Our goal is to grow MRR from 180 thousand pounds to 250 thousand dollars by the end of December 2026.";
    expect(extractGoalTargetWithBaseline(brief)).toBeNull();
    expect(extractFactors(brief).filter((f) => f.label === "Target")).toHaveLength(0);
  });
});

/* ===========================================================================
 * FAIL-CLOSED — the shapes the words grammar deliberately does NOT read must
 * yield NOTHING, never a fragment. "two and a half million" as 2 (or 2M) is a
 * fabrication; null is honest and re-askable.
 * ========================================================================= */

describe("L67 — unreadable word amounts refuse rather than mint a fragment", () => {
  const REFUSED: readonly string[] = [
    "Our goal is to grow MRR from two and a half million to four million by the end of December 2026.",
    "Our goal is to grow MRR from half a million to a million by the end of December 2026.",
  ];
  for (const brief of REFUSED) {
    it(brief, () => {
      expect(extractGoalTargetWithBaseline(brief), brief).toBeNull();
      // And no fragment reaches the factor stream as a Target either.
      expect(extractFactors(brief).filter((f) => f.label === "Target")).toHaveLength(0);
    });
  }
});

/* ===========================================================================
 * CONTROLS — byte-parity pins measured at pristine 959a953f. These passed
 * BEFORE this change and their matchedText must not move by a byte.
 * ========================================================================= */

describe("L67 — pristine controls are byte-identical", () => {
  const CONTROLS: ReadonlyArray<readonly [string, number, number, string]> = [
    [
      "Increase annual revenue from £4 million today to £6 million within 12 months",
      6_000_000,
      4_000_000,
      "Increase annual revenue from £4 million today to £6 million within 12 months",
    ],
    [
      "Grow MRR from £180k to £250k by 31 Dec 2026",
      250_000,
      180_000,
      "Grow MRR from £180k to £250k by 31 Dec 2026",
    ],
    [
      "Raise the target from £600,000 to £800,000",
      800_000,
      600_000,
      "Raise the target from £600,000 to £800,000",
    ],
    [
      "We could increase the price from £49 to £59 this year. Increase annual revenue from £4 million today to £6 million within 12 months.",
      6_000_000,
      4_000_000,
      "Increase annual revenue from £4 million today to £6 million within 12 months",
    ],
    [
      "Increase revenue from £4M to 6M eventually",
      6_000_000,
      4_000_000,
      "Increase revenue from £4M to 6M eventually",
    ],
    [
      "Increase annual revenue from £4 million to £6 million sustainably within 12 months",
      6_000_000,
      4_000_000,
      "Increase annual revenue from £4 million to £6 million sustainably within 12 months",
    ],
  ];
  for (const [brief, value, baseline, matchedText] of CONTROLS) {
    it(brief, () => {
      const pair = extractGoalTargetWithBaseline(brief);
      expect(pair, brief).not.toBeNull();
      expect(pair!.value).toBe(value);
      expect(pair!.baseline).toBe(baseline);
      expect(pair!.matchedText, "m[0] moved — byte-parity broken").toBe(matchedText);
    });
  }

  it("a lever sentence still mints nothing (the anchor and proposal guards are untouched)", () => {
    expect(extractGoalTargetWithBaseline("We could increase the price from £49 to £59")).toBeNull();
  });
});

/* ===========================================================================
 * 12d — BOTH HALVES, for the new vocabulary.
 * The derived half proves the goal grammar and the parser read the SAME word
 * sets; the corpus half (here and in cardinal-words.test.ts) is what can
 * notice a set is SHORT. Neither supersedes the other.
 * ========================================================================= */

describe("L67 — 12d derived half: the words grammar is shared, not copied", () => {
  it("the goal amount grammar embeds the ONE cardinal source", () => {
    expect(amountPatternForDriftGuard("to")).toContain(CARDINAL_AMOUNT_SOURCE);
    expect(amountPatternForDriftGuard("from")).toContain(CARDINAL_AMOUNT_SOURCE);
  });

  it("EVERY word-form magnitude key resolves identically on BOTH amounts of a pair", () => {
    // Parallels the digit per-key guard above it in the suite: iterate the
    // DERIVED scale map so a word-form key the alphabet gains is exercised
    // through the goal grammar the instant it lands. Blind to the map being
    // short — the corpus in cardinal-words.test.ts is the other half.
    for (const [word, multiplier] of Object.entries(CARDINAL_SCALE_MULTIPLIERS)) {
      const brief = `Currently at four ${word}, and our target is six ${word}.`;
      const pair = extractGoalTargetWithBaseline(brief);
      expect(pair, `the scale word '${word}' does not resolve: ${brief}`).not.toBeNull();
      expect(pair!.value, word).toBe(6 * multiplier);
      expect(pair!.baseline, word).toBe(4 * multiplier);
    }
  });

  it("every SMALL cardinal reads on both sides of a pair", () => {
    for (const [word, n] of Object.entries(CARDINAL_WORD_VALUES)) {
      const brief = `Currently at ${word} hundred, and our target is ${word} hundred fifty.`;
      const pair = extractGoalTargetWithBaseline(brief);
      expect(pair, `the cardinal '${word}' does not resolve: ${brief}`).not.toBeNull();
      expect(pair!.value, word).toBe(n * 100 + 50);
      expect(pair!.baseline, word).toBe(n * 100);
    }
  });

  it("the scale words are DERIVED from the canonical alphabet (union direction)", () => {
    // Every ≥1000, word-shaped key of MAGNITUDE_MULTIPLIERS must be readable
    // as a cardinal scale — the derivation direction that would have caught a
    // hand-copied scale list going short when the alphabet gains a word form.
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      if (!/^[a-z]{3,}$/.test(key) || multiplier < 1000) continue;
      expect(
        CARDINAL_SCALE_MULTIPLIERS[key],
        `alphabet word-form key '${key}' is not a cardinal scale word`,
      ).toBe(multiplier);
    }
  });
});

/* ===========================================================================
 * DISCLOSED RESIDUALS — pinned so the cost stays visible, not promises.
 * ========================================================================= */

describe("L67 — disclosed residuals (pinned, reported to the orchestrator)", () => {
  it("number-word amounts do NOT extract as ORDINARY factors — goal grammar only", () => {
    // The eleven PATTERNS (currency, percentage, contextualNumber, …) stay
    // digit-anchored: widening every extractor at once is exactly what the
    // pattern-4 history warns against. The tester-visible class was the goal
    // target; ordinary word-amount factors are a separate, deliberate row.
    const factors = extractFactors("The price is forty nine pounds.");
    expect(factors).toHaveLength(0);
  });

  it("parseCardinalAmount is the ONLY value authority — a vocab word never doubles as a metric noun", () => {
    // Guard against the sharpest words-vocabulary failure: if a scale word
    // fell OUT of the vocabulary, "fifty grand" would re-parse as amount 50 +
    // trailing noun "grand" and mint a 1,000× under-read pair at 0.95. The
    // corpus values above make that mutation RED; this pin documents the
    // direction of the hazard at the shape where it would bite.
    const pair = extractGoalTargetWithBaseline(
      "Currently at fifty grand, and our target is eighty grand.",
    );
    expect(pair).not.toBeNull();
    expect(pair!.value).toBe(80_000);
    expect(pair!.baseline).toBe(50_000);
  });
});
