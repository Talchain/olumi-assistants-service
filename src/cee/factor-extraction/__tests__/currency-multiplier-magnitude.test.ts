/**
 * ROADMAP 2.316 — the THIRD magnitude list, folded onto the ONE alphabet.
 *
 * WHAT #797 LEFT BEHIND. 2.303 unified TWO magnitude lists in this module
 * (`contextualNumber` and the paired `amountPattern`) onto one derived
 * alphabet, so "target is 800k" stopped extracting as 800. A THIRD list
 * survived, deliberately out of that scope: `currencyWithMultiplier` carried
 * its own hand-spelled alternation `k|m|b|t|million|billion|trillion` and its
 * own hand-spelled `MULTIPLIER_MAP`. Two independent defects fell out of it,
 * both measured at `7f57602` before this change:
 *
 *   1. NO `bn` IN THE ALTERNATION. `$5bn` failed the pattern entirely (the `b`
 *      branch cannot match "b" followed by "n" — no word boundary), fell
 *      through to the bare `currency` pattern, and extracted **5**. A
 *      1,000,000,000× error presented as the user's stated figure.
 *
 *   2. A CASE-SENSITIVE LOOKUP UNDER A CASE-INSENSITIVE REGEX. The pattern
 *      carried `i`, so `MILLION` matched; `MULTIPLIER_MAP` listed only `million`
 *      and `Million`, so the lookup missed and `?? 1` silently applied. `$5MILLION`
 *      extracted as **5** — and, worse than case 1, as an `explicit` factor at
 *      confidence 0.85 rather than an `inferred` fallback at 0.60. The regex and
 *      its own lookup table disagreed about what a magnitude was.
 *
 * THE SHAPE OF THE FIX, identical in kind to #797's. The third list is DELETED,
 * not corrected: `currencyWithMultiplier` is now built from the same
 * `MAGNITUDE_ALTERNATION` as the other two patterns, and resolves through the
 * same `resolveMagnitude`. A fourth list is not written and the third is not
 * hand-copied — there is one alphabet and three consumers of it.
 *
 * WHY THE PAIR CAN NO LONGER DISAGREE ABOUT CASE. There is no second lookup
 * table left to disagree with. `resolveMagnitude` indexes a map DERIVED from
 * `MAGNITUDE_MULTIPLIERS` by case-folding its keys, so every casing the `i`
 * flag admits resolves by construction — including a mixed-case key someone
 * adds to the source map in future, which under the old spelling would have
 * matched the regex and then resolved to `?? 1`.
 *
 * AND AN UNREADABLE SUFFIX REFUSES. `$5kg` must not emit a bare `5`. That is
 * the rule #797 established on `contextualNumber` ("budget of 500kg" → no
 * factor) and this path now matches it: a magnitude the module cannot read is a
 * magnitude it does not know, and a refusal is honest where a wrong one is not.
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

/** The highest-confidence factor for a brief, or undefined — what a reader sees first. */
function best(brief: string) {
  return extractFactors(brief).sort((a, b) => b.confidence - a.confidence)[0];
}

/** Every value any factor carries for a brief — for "no bare digits anywhere" sweeps. */
function allValues(brief: string): number[] {
  return extractFactors(brief).map((f) => f.value);
}

describe("ROADMAP 2.316 — currencyWithMultiplier honours the ONE magnitude alphabet", () => {
  it("RED 1 — '$5bn' extracts 5000000000, not 5", () => {
    // Pristine at 7f57602: the ONLY factor was { value: 5, unit: '$',
    // extractionType: 'inferred' } — the `currency` fallback's bare digits,
    // because the alternation had no `bn` and `b\b` cannot match "bn".
    const f = best("We raised $5bn last year.");
    expect(f, "no factor extracted at all").toBeDefined();
    expect(f!.value).toBe(5_000_000_000);
    expect(f!.unit).toBe("$");
    expect(f!.extractionType).toBe("explicit");
  });

  it("RED 1b — every case of 'bn' resolves, because the regex says it may", () => {
    // The `i` flag admits all four; only one alternation exists to admit them.
    for (const shape of ["$5bn", "$5BN", "$5Bn", "$5bN"]) {
      const f = best(`We raised ${shape} last year.`);
      expect(f, `no factor for: ${shape}`).toBeDefined();
      expect(f!.value, shape).toBe(5_000_000_000);
    }
  });

  it("RED 2 — '$5MILLION' extracts 5000000, not 5", () => {
    // Pristine at 7f57602: { value: 5, unit: '$', extractionType: 'explicit',
    // confidence: 0.85 } — the regex MATCHED (i flag) and the lookup MISSED
    // (case-sensitive map), so `?? 1` published a 1,000,000×-wrong number
    // wearing the confidence of a successful explicit extraction.
    const f = best("We raised $5MILLION last year.");
    expect(f, "no factor extracted at all").toBeDefined();
    expect(f!.value).toBe(5_000_000);
    expect(f!.unit).toBe("$");
  });

  it("RED 2b — the whole word-alphabet resolves in EVERY case the `i` flag admits", () => {
    // Pristine: the all-caps and mixed-inner-case forms all resolved to the
    // bare digits. `Million` and `million` happened to be listed; `MILLION`
    // and `MiLLiOn` were not, and nothing said they had to be.
    const cases: ReadonlyArray<readonly [string, number]> = [
      ["$5MILLION", 5_000_000],
      ["$5Million", 5_000_000],
      ["$5million", 5_000_000],
      ["$5MiLLiOn", 5_000_000],
      ["£5BILLION", 5_000_000_000],
      ["£5billion", 5_000_000_000],
      ["£5Billion", 5_000_000_000],
      ["€5TRILLION", 5_000_000_000_000],
      ["€5trillion", 5_000_000_000_000],
      ["$5 MILLION", 5_000_000],
      ["$5 bn", 5_000_000_000],
      ["$5 BN", 5_000_000_000],
    ];
    for (const [shape, value] of cases) {
      const f = best(`We raised ${shape} last year.`);
      expect(f, `no factor for: ${shape}`).toBeDefined();
      expect(f!.value, shape).toBe(value);
    }
  });

  it("RED 3 — an unreadable suffix REFUSES rather than emitting the bare digits", () => {
    // #797's rule, applied to this path. Pristine emitted 5 for all three.
    // "$5kg" is not 5 dollars; publishing it as the user's stated figure is
    // the same untruth as the dropped multiplier above, only quieter.
    for (const shape of ["$5kg", "$5KILO", "$5x", "£5zz"]) {
      const brief = `We raised ${shape} last year.`;
      expect(allValues(brief), `bare digits leaked from: ${brief}`).not.toContain(5);
    }
  });

  it("PRESERVED — a suffix SEPARATED from the amount is a metric noun, and still extracts", () => {
    // The other half of #797's rule: only letters ATTACHED to the digits
    // refuse. "$5 kg" is a whole number beside a unit noun, exactly as
    // "target is 800 customers" is, and both still extract.
    expect(allValues("We raised $5 kg last year.")).toContain(5);
    expect(allValues("We raised $100 last year.")).toContain(100);
    expect(allValues("We raised £49.50 last year.")).toContain(49.5);
  });
});

describe("ROADMAP 2.316 — the pre-2.316 behaviour of this path is byte-identical", () => {
  // The control that stops the fix from "passing" by refusing everything, and
  // that pins the shapes the third list ALREADY got right — every one of which
  // must survive the deletion of the list that got them right.
  it("every shape the old hand-spelled list resolved still resolves identically", () => {
    const cases: ReadonlyArray<
      readonly [string, number, string, string, number]
    > = [
      // [brief, value, unit, matchedText, confidence]
      ["We raised $5 million last year.", 5_000_000, "$", "$5 million", 0.85],
      ["We raised $5Million last year.", 5_000_000, "$", "$5Million", 0.85],
      ["We raised $5million last year.", 5_000_000, "$", "$5million", 0.85],
      ["We raised £5m last year.", 5_000_000, "£", "£5m", 0.85],
      ["We raised £5M last year.", 5_000_000, "£", "£5M", 0.85],
      ["We raised €5k last year.", 5_000, "€", "€5k", 0.85],
      ["We raised €5K last year.", 5_000, "€", "€5K", 0.85],
      ["We raised $5b last year.", 5_000_000_000, "$", "$5b", 0.85],
      ["We raised $5B last year.", 5_000_000_000, "$", "$5B", 0.85],
      ["We raised $5t last year.", 5e12, "$", "$5t", 0.85],
      ["We raised $5T last year.", 5e12, "$", "$5T", 0.85],
      ["We raised $2.5m last year.", 2_500_000, "$", "$2.5m", 0.85],
      ["We raised £5billion last year.", 5e9, "£", "£5billion", 0.85],
      ["We raised €5trillion last year.", 5e12, "€", "€5trillion", 0.85],
      ["We raised $1.5 billion overall.", 1.5e9, "$", "$1.5 billion", 0.85],
    ];
    for (const [brief, value, unit, matchedText, confidence] of cases) {
      const f = extractFactors(brief).find((x) => x.extractionType === "explicit");
      expect(f, `regressed — no longer extracts: ${brief}`).toBeDefined();
      expect(f!.value, brief).toBe(value);
      expect(f!.unit, brief).toBe(unit);
      // `matchedText` is pinned because the suffix fragment must not gain or
      // lose the `\s*` that sits in front of it — the byte-parity property
      // #797 spent a comment block on, now load-bearing on a third pattern.
      expect(f!.matchedText, brief).toBe(matchedText);
      expect(f!.confidence, brief).toBe(confidence);
    }
  });

  it("PRESERVED — #797's contextualNumber behaviour is unchanged in BOTH directions", () => {
    const target = (b: string) => extractFactors(b).find((f) => f.label === "Target");
    expect(target("target is 800k")!.value).toBe(800_000);
    expect(target("target is 800K")!.value).toBe(800_000);
    expect(target("target is 800 customers")!.value).toBe(800);
    expect(target("target is 800 customers")!.matchedText).toBe("target is 800 ");
    expect(target("target is 6000000 this year")!.value).toBe(6_000_000);
    expect(extractFactors("budget of 500kg")).toEqual([]);
    expect(extractFactors("revenue of 400000USD")).toEqual([]);
    expect(extractFactors("revenue of 5bn").find((f) => f.label === "Revenue")!.value).toBe(5e9);
    expect(extractFactors("revenue of 5MILLION").find((f) => f.label === "Revenue")!.value).toBe(5e6);
  });

  it("PRESERVED — the #2258 worked briefs mint identically, in BOTH stated forms", () => {
    // The live goal number depends on these two exact shapes
    // (PHASE0-EVIDENCE-2026-07-28/witness-2258-goal-probability-THIRD.md,
    // runs 1 and 3). The digit-string form pins `matchedText` too, because the
    // witness records it verbatim.
    const digitForm = extractGoalTargetWithBaseline(
      "Grow revenue from 4000000 to a target of 6000000 this year.",
    );
    expect(digitForm).not.toBeNull();
    expect(digitForm!.value).toBe(6_000_000);
    expect(digitForm!.baseline).toBe(4_000_000);
    expect(digitForm!.matchedText).toBe("from 4000000 to a target of 6000000 ");

    const proseForm = extractGoalTargetWithBaseline(
      "We want to grow our annual revenue. We are currently at £4,000,000 and our " +
        "target is £6,000,000 within a year.",
    );
    expect(proseForm).not.toBeNull();
    expect(proseForm!.value).toBe(6_000_000);
    expect(proseForm!.baseline).toBe(4_000_000);
    expect(proseForm!.unit).toBe("£");
  });
});

describe("ROADMAP 2.316 — ONE alphabet, THREE consumers (drift guard)", () => {
  // #797 proved its reuse structurally, not just behaviourally: a hand-copied
  // literal that is byte-correct on the day it is written passes every
  // behavioural test and drifts silently forever after (CLAUDE.md trap 12) —
  // which is precisely how the third list came to be missing `bn`. These
  // guards are DERIVED from the map, so a copy that omits a future key REDs.

  it("ALL THREE magnitude-bearing patterns are built from that ONE alternation", () => {
    // The structural half. `currencyWithMultiplier` is the addition; the other
    // two are #797's assertions, carried forward unchanged.
    expect(PATTERNS_FOR_DRIFT_GUARD.currencyWithMultiplier.source).toContain(
      MAGNITUDE_ALTERNATION,
    );
    expect(PATTERNS_FOR_DRIFT_GUARD.contextualNumber.source).toContain(MAGNITUDE_ALTERNATION);
    expect(amountPatternForDriftGuard("to")).toContain(MAGNITUDE_ALTERNATION);
  });

  it("no SECOND magnitude list survives anywhere in the pattern set", () => {
    // The behavioural half, and the one a byte-identical copy cannot survive:
    // it is derived from the map, so a key added to the map is REQUIRED to
    // work on this path immediately. A copy frozen at today's key set REDs the
    // moment the map grows — which is the drift this guard exists to catch.
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      const f = best(`We raised $4${key} last year.`);
      expect(f, `currencyWithMultiplier does not know '${key}'`).toBeDefined();
      expect(f!.value, `currencyWithMultiplier '${key}'`).toBe(4 * multiplier);
      expect(f!.extractionType, `currencyWithMultiplier '${key}'`).toBe("explicit");
    }
  });

  it("the alphabet resolves under EVERY casing, because the lookup is derived by case-folding", () => {
    // The property that makes "the regex and the lookup cannot disagree"
    // structural rather than incidental. The `i` flag admits any casing of a
    // key; `resolveMagnitude` case-folds before looking up; therefore every
    // casing the regex admits resolves. Derived from the map, so it holds for
    // keys that do not exist yet — including a MIXED-CASE key, which under the
    // pre-2.316 spelling would have matched the regex and then silently
    // resolved to `?? 1`.
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      for (const cased of [key.toUpperCase(), key.toLowerCase(), titleCase(key)]) {
        const f = best(`We raised $4${cased} last year.`);
        expect(f, `no factor for cased key '${cased}'`).toBeDefined();
        expect(f!.value, `cased key '${cased}'`).toBe(4 * multiplier);
      }
    }
  });
});

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
