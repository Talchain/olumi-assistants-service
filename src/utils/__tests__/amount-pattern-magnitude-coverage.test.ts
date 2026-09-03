/**
 * ⭐⭐ THE DERIVED HALF — "does every pattern that reads an AMOUNT consult the
 * ONE alphabet?" (ROADMAP 2.1131)
 *
 * ── WHY THIS GUARD DID NOT EXIST, AND WHAT IT COSTS ────────────────────────
 * `magnitude-alphabet.union.test.ts` asks whether every sibling's KEY LIST is a
 * subset of canonical. That is the right question and it is answered soundly —
 * and it is structurally incapable of seeing the defect Paul hit on 3 Sep,
 * because a pattern that consults NO KEYS AT ALL has no key list to compare.
 * MEASURED at `f4c8f50`, the deployed build, with the union guard green:
 *
 *     NINE of the ELEVEN patterns in `cee/factor-extraction` read an amount
 *     and never touched the alternation.
 *
 * The consequence reached a user. "£80-120k for the first hire" extracted a
 * range of **80 to 120**, that 80 set the factor's scale, and when Paul
 * supplied the true £100,000 the product refused it against a cap of £100.
 *
 * ── WHAT THIS GUARD CAN AND CANNOT DO, stated before it is trusted ─────────
 * It is DERIVED from `PATTERNS` itself, so a pattern added tomorrow is inside
 * it the instant it lands — there is no list here for anyone to remember to
 * extend, and that is the whole of trap 12.
 *
 * It proves AGREEMENT — every amount-reading pattern names the alternation —
 * and it can NEVER prove the patterns read their captures correctly, nor that
 * the alphabet is long enough (trap 12d). A pattern could name the alternation
 * in a group its consumer ignores and this guard would applaud. That is why the
 * hand-written corpus in `amount-range.test.ts` and
 * `factor-extraction/__tests__/range-magnitude-cross-extractor.test.ts` ships
 * beside it and neither supersedes the other: derivation stops the copies
 * drifting, a corpus is what notices the list is short OR the wiring wrong.
 *
 * ── THE EXCLUSION IS DERIVED, NOT DECLARED ─────────────────────────────────
 * Percent patterns legitimately carry no magnitude — "5k%" is not English, and
 * admitting the alternation there would let its `m`/`t` branches bite the first
 * letter of a following word. A hand-written exclusion LIST would be the mirror
 * this file exists to abolish, so the exclusion is a PREDICATE over the
 * pattern's own source: a pattern may be excused only if it REQUIRES a literal
 * `%`. Nothing can be added to the excused set by editing this file; a pattern
 * joins it by requiring a percent sign, and leaves it by not.
 */

import { describe, expect, it } from "vitest";
import {
  PATTERN_SOURCES_FOR_DRIFT_GUARD,
  PATTERN_NAMES_FOR_DRIFT_GUARD,
} from "../../cee/factor-extraction/index.js";
import { AMOUNT_DIGITS, MAGNITUDE_ALTERNATION } from "../magnitude-alphabet.js";

/** Does this pattern source read an amount at all? */
function readsAnAmount(source: string): boolean {
  return source.includes(AMOUNT_DIGITS);
}

/** Does it consult the ONE alternation? */
function consultsTheAlphabet(source: string): boolean {
  return source.includes(MAGNITUDE_ALTERNATION);
}

/**
 * The excuse, derived. A pattern that REQUIRES a literal `%` is reading a
 * percentage, which takes no magnitude suffix. `%?` (optional) does not excuse
 * anything — an optional percent sign means the pattern also matches text
 * without one, which is exactly where a magnitude can appear.
 */
function requiresAPercentSign(source: string): boolean {
  return /%(?![?*])/.test(source);
}

describe("every amount-reading pattern consults the one magnitude alphabet", () => {
  it("has patterns to check at all (positive control — a probe over an empty set passes vacuously)", () => {
    expect(PATTERN_NAMES_FOR_DRIFT_GUARD.length).toBeGreaterThanOrEqual(11);
    expect(Object.keys(PATTERN_SOURCES_FOR_DRIFT_GUARD).sort()).toEqual(
      [...PATTERN_NAMES_FOR_DRIFT_GUARD].sort(),
    );
    // CONTRAST CONTROL: the two halves of the predicate must each discriminate
    // on the live set, or a uniformly-true or uniformly-false answer would be
    // reporting on the probe rather than on the patterns (trap 20).
    const sources = Object.values(PATTERN_SOURCES_FOR_DRIFT_GUARD);
    expect(sources.some(readsAnAmount)).toBe(true);
    expect(sources.some((s) => requiresAPercentSign(s))).toBe(true);
    expect(sources.some((s) => !requiresAPercentSign(s))).toBe(true);
  });

  it("no pattern reads an amount without the alternation, unless it requires a % sign", () => {
    const uncovered = Object.entries(PATTERN_SOURCES_FOR_DRIFT_GUARD)
      .filter(
        ([, source]) =>
          readsAnAmount(source) &&
          !consultsTheAlphabet(source) &&
          !requiresAPercentSign(source),
      )
      .map(([name]) => name);

    expect(
      uncovered,
      `These patterns read an amount, do not consult MAGNITUDE_ALTERNATION, and are ` +
        `not percentage patterns. Every one of them silently drops the magnitude a ` +
        `user wrote: at f4c8f50 that published 80 for "£80-120k" and 800 for ` +
        `"roughly 800k users". Either build the pattern from ` +
        `magnitudeSuffixPattern()/amountRangePattern(), or make it require a literal %.`,
    ).toEqual([]);
  });

  it("names the patterns it EXCUSED, so an excuse cannot grow silently", () => {
    const excused = Object.entries(PATTERN_SOURCES_FOR_DRIFT_GUARD)
      .filter(
        ([, source]) =>
          readsAnAmount(source) && !consultsTheAlphabet(source) && requiresAPercentSign(source),
      )
      .map(([name]) => name)
      .sort();

    // Pinned EXACTLY, so this REDs if the excused set grows OR shrinks. A new
    // name here is a claim that a magnitude cannot appear in that pattern's
    // text, and it must be argued, not absorbed (trap 22f: an honest gap is
    // one the suite can see).
    expect(excused).toEqual(["percentFromTo", "percentRange", "percentage"]);
  });
});

describe("the exclusion predicate is not a rubber stamp", () => {
  it("refuses to excuse an OPTIONAL percent sign", () => {
    // `%?` means the pattern also matches text with no percent sign, which is
    // precisely where a magnitude can ride. This is the mutation that would
    // let any pattern excuse itself by adding one optional character.
    expect(requiresAPercentSign(`(?<amount>${AMOUNT_DIGITS})\\s*%?`)).toBe(false);
    expect(requiresAPercentSign(`(?<amount>${AMOUNT_DIGITS})\\s*%`)).toBe(true);
  });

  it("recognises the real alternation and not a hand-spelled lookalike", () => {
    // A byte-correct hand-copied alternation is the mirror that drifts later
    // (trap 12). Identity against the derived string is what makes this guard
    // structural rather than cosmetic.
    expect(consultsTheAlphabet(`(?:\\s*(?:${MAGNITUDE_ALTERNATION})\\b)?`)).toBe(true);
    expect(consultsTheAlphabet("(?:\\s*(?:k|m|bn|b|t)\\b)?")).toBe(false);
  });
});
