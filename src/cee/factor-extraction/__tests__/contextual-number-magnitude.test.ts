/**
 * ROADMAP 2.303 — `contextualNumber` is MULTIPLIER-BLIND.
 *
 * THE DEFECT, witnessed live on screen (journey re-walk 2026-08-02, §5 / N7):
 * a goal labelled "Reach £800k Annual Revenue" rendered its target as `800`.
 * The brief said "Our target is 800k revenue"; `contextualNumber` extracted the
 * digits and DROPPED the magnitude suffix, so the goal card — the first card a
 * tester reads — showed a number wrong by 1,000×.
 *
 * WHAT IS AND IS NOT AT STAKE. No wrong PROBABILITY is reachable from this
 * path: these briefs state no current level, so no baseline is minted and ISL
 * refuses with `missing_goal_baseline` and omits the number. The harm is a
 * WRONG MAGNITUDE DISPLAYED AS THE USER'S TARGET — an untruth on screen, on the
 * card the whole goal-probability train exists to serve.
 *
 * WHY IT IS MORE REACHABLE AFTER #795: when a goal (target, baseline) PAIR is
 * refused (`mixed_percent_pair`, `currency_mismatch`, `metric_noun_mismatch`,
 * `currency_vs_metric_noun`), the threshold can still be minted from this
 * INDEPENDENT `contextualNumber` path — so the wrong-magnitude display is
 * exactly what a refused brief now falls back to. The live N7 witness is that
 * fallback: a `metric_noun_mismatch` refusal, then `Target: 800 count`.
 *
 * THE SHAPE OF THE FIX. `contextualNumber` is taught the SAME magnitude
 * alphabet the paired extractor (`extractGoalTargetWithBaseline`) already
 * understands — by REUSING it, not by copying it. Two same-purpose lists that
 * can drift is this estate's dominant defect class (CLAUDE.md trap 12), and
 * this file already carries the precedent (`stemMetricNoun`, `CURRENCY_WORDS`
 * derived from the symbol alphabet rather than listed afresh).
 *
 * AND A SUFFIX OUTSIDE THE ALPHABET REFUSES. "target is 800x" must NOT emit a
 * bare `800`: an unrecognised magnitude is an unknown magnitude, and a refusal
 * is honest where a 1,000×-wrong number is not.
 */

import { describe, it, expect } from "vitest";
import {
  extractFactors,
  extractGoalTargetWithBaseline,
  MAGNITUDE_MULTIPLIERS,
  MAGNITUDE_ALTERNATION,
  PATTERNS_FOR_DRIFT_GUARD,
  amountPatternForDriftGuard,
} from "../index.js";

/** The one `Target`-labelled factor, or undefined — the goal-mint candidate. */
function targetFactor(brief: string) {
  return extractFactors(brief).find((f) => f.label === "Target");
}

describe("ROADMAP 2.303 — contextualNumber honours the magnitude alphabet", () => {
  it("RED 1 — 'target is 800k' mints 800000, not 800", () => {
    // Verbatim from the dispatch. Pristine: 800.
    const f = targetFactor("target is 800k");
    expect(f, "no Target factor extracted at all").toBeDefined();
    expect(f!.value).toBe(800_000);
  });

  it("RED 2 — '$6M' mints 6000000, not 6", () => {
    // Verbatim from the dispatch. Pristine: 6.
    const f = targetFactor("our target is $6M");
    expect(f, "no Target factor extracted at all").toBeDefined();
    expect(f!.value).toBe(6_000_000);
    expect(f!.unit).toBe("$");
  });

  it("RED 3 — an unrecognised suffix REFUSES rather than emitting bare digits", () => {
    // The honesty half. Pristine emitted 800 / 500 / 400000 / 5 — bare digits
    // from a number whose magnitude the extractor could not read.
    expect(targetFactor("target is 800x")).toBeUndefined();
    expect(extractFactors("budget of 500kg")).toEqual([]);
    expect(extractFactors("revenue of 400000USD")).toEqual([]);
    expect(extractFactors("the limit is 30d")).toEqual([]);
    // …and specifically: no factor anywhere carries the bare digit string.
    for (const brief of ["target is 800x", "budget of 500kg", "the limit is 30d"]) {
      for (const f of extractFactors(brief)) {
        expect(String(f.value), `bare digits leaked from: ${brief}`).not.toMatch(
          /^(800|500|30)$/,
        );
      }
    }
  });

  it("RED 4 — a NO-SUFFIX amount is byte-identical to pristine", () => {
    // The control that stops the fix from "passing" by refusing everything.
    // Values, units, confidences AND `matchedText` are pinned: the multiplier
    // group must not consume the separating space of "800 customers", or every
    // matchedText in the corpus shifts by one byte.
    const cases: ReadonlyArray<
      readonly [string, string, number, string | undefined, string]
    > = [
      ["price of 49", "Price", 49, undefined, "price of 49"],
      ["the cost is 100", "Cost", 100, undefined, "cost is 100"],
      ["our target is 800", "Target", 800, undefined, "target is 800"],
      // ⚠ The trailing space is PRISTINE, not a typo: the pattern's closing
      // `\s*(?:%)?` already consumed it before this change, and it must still
      // do so after — the multiplier group is spelled `(?:\s*ALT\b)?` rather
      // than `\s*(ALT)?\b` precisely so it cannot eat that space itself and
      // shift every matchedText in the corpus by a byte.
      ["target is 800 customers", "Target", 800, undefined, "target is 800 "],
      ["budget is 50000", "Budget", 50_000, undefined, "budget is 50000"],
      ["revenue was 400000", "Revenue", 400_000, undefined, "revenue was 400000"],
      ["price is £59", "Price", 59, "£", "price is £59"],
      ["cost of $100.50", "Cost", 100.5, "$", "cost of $100.50"],
      ["growth of 5%", "Growth", 0.05, "%", "growth of 5%"],
      ["the margin is 30 %", "Margin", 0.3, "%", "margin is 30 %"],
      ["threshold 0.8", "Threshold", 0.8, undefined, "threshold 0.8"],
    ];
    for (const [brief, label, value, unit, matchedText] of cases) {
      const f = extractFactors(brief).find((x) => x.label === label);
      expect(f, `regressed — no longer extracts: ${brief}`).toBeDefined();
      expect(f!.value, brief).toBe(value);
      expect(f!.unit, brief).toBe(unit);
      expect(f!.matchedText, brief).toBe(matchedText);
      expect(f!.confidence, brief).toBe(0.9);
      expect(f!.extractionType, brief).toBe("explicit");
    }
  });

  it("the whole alphabet resolves, in every case the flags admit", () => {
    const expected: ReadonlyArray<readonly [string, number]> = [
      ["800k", 800_000],
      ["800K", 800_000],
      ["6m", 6_000_000],
      ["6M", 6_000_000],
      ["3b", 3_000_000_000],
      ["3B", 3_000_000_000],
      ["3bn", 3_000_000_000],
      ["3BN", 3_000_000_000],
      ["1t", 1_000_000_000_000],
      ["4 million", 4_000_000],
      ["2 billion", 2_000_000_000],
      ["1 trillion", 1_000_000_000_000],
    ];
    for (const [suffixed, value] of expected) {
      const f = targetFactor(`target is ${suffixed}`);
      expect(f, `no Target factor for: ${suffixed}`).toBeDefined();
      expect(f!.value, suffixed).toBe(value);
    }
  });

  it("thousands separators are read, not truncated", () => {
    // The SAME defect class and the same card: pristine read "target is
    // 800,000" as 800 and "£6,000,000" as 6. The amount grammar is shared with
    // the paired extractor, which has read separators since #787.
    expect(targetFactor("target is 800,000")!.value).toBe(800_000);
    expect(targetFactor("our target is £6,000,000")!.value).toBe(6_000_000);
    expect(
      extractFactors("budget of 1,250,000").find((f) => f.label === "Budget")!.value,
    ).toBe(1_250_000);
  });

  it("the live N7 brief no longer mints a 1,000×-wrong target", () => {
    // Verbatim from journey-rewalk-2026-08-03.md §5 (`r17-brief.txt`). The
    // goal (target, baseline) pair is REFUSED here by #795's
    // metric_noun_mismatch (revenue vs employees) — correctly — and the
    // threshold falls back to this independent path, which is why the card
    // read `Target: 800 count`.
    const brief =
      "We are a services firm deciding how to grow. Our target is 800k revenue, " +
      "and we are currently at 50 employees. Should we hire more consultants, " +
      "raise prices, or focus on partnerships?";
    expect(extractGoalTargetWithBaseline(brief), "the #795 refusal must be unchanged").toBeNull();
    const f = targetFactor(brief);
    expect(f).toBeDefined();
    expect(f!.value).toBe(800_000);
    expect(f!.baseline, "no baseline may be invented on a refused pair").toBeUndefined();
  });
});

describe("ROADMAP 2.303 — ONE magnitude alphabet, derived not copied (drift guard)", () => {
  // WHY THIS EXISTS. The fix is only worth having if the alphabet stays
  // singular. A hand-copied literal in either pattern is the estate's dominant
  // defect class (CLAUDE.md trap 12): it reads correct on the day it is
  // written and drifts silently forever after. These guards are DERIVED from
  // the map, so they cannot go stale as the map grows — a new key is exercised
  // on both paths the moment it is added, and a copy that omits it REDs.

  it("the alternation is derived from the map, longest-first", () => {
    expect(MAGNITUDE_ALTERNATION.split("|").sort()).toEqual(
      Object.keys(MAGNITUDE_MULTIPLIERS).sort(),
    );
    // Longest-first is the SAFETY property, not a style choice: it is what
    // stops "bn" being consumed as a bare "b" and "million" as a bare "m".
    // Sorting by length guarantees it for every key, present and future.
    const lengths = MAGNITUDE_ALTERNATION.split("|").map((k) => k.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it("BOTH magnitude-bearing patterns are built from that ONE alternation", () => {
    expect(PATTERNS_FOR_DRIFT_GUARD.contextualNumber.source).toContain(MAGNITUDE_ALTERNATION);
    expect(amountPatternForDriftGuard("to")).toContain(MAGNITUDE_ALTERNATION);
  });

  it("every key in the map resolves IDENTICALLY on both paths", () => {
    // Derived from the map itself — the manifest cannot go stale.
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      const viaContextual = targetFactor(`target is 4${key}`);
      expect(viaContextual, `contextualNumber does not know '${key}'`).toBeDefined();
      expect(viaContextual!.value, `contextualNumber '${key}'`).toBe(4 * multiplier);

      const viaPair = extractGoalTargetWithBaseline(`Grow revenue from 2${key} to a target of 4${key}.`);
      expect(viaPair, `the paired extractor does not know '${key}'`).not.toBeNull();
      expect(viaPair!.value, `paired '${key}'`).toBe(4 * multiplier);
      expect(viaPair!.baseline, `paired '${key}'`).toBe(2 * multiplier);
    }
  });
});
