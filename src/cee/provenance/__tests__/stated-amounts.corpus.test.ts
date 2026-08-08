/**
 * ROADMAP 2.972 — THE CORPUS HALF of the brief-locatability predicate.
 *
 * CLAUDE.md trap 12d: a derived guard proves AGREEMENT and can never prove
 * COMPLETENESS; only a hand-written corpus notices that a list is short. And
 * trap 22: a corpus drawn from the author's head cannot see the class the
 * author did not imagine, and a full mutant kit will certify it anyway.
 *
 * So this corpus is NOT invented. Its members come from three places, and each
 * row says which:
 *   [WIRE]  the three real briefs of the 2026-08-08 context-integrity trace,
 *           quoted verbatim from `fixtures/trace-captures.ts`;
 *   [BRIEF] the adversarial classes the row's dispatch named explicitly —
 *           paraphrased numbers, unit-changed restatements, numbers that
 *           appear only in the user's later question, numbers inside a quoted
 *           third party's words;
 *   [ALPHA] the magnitude-alphabet's own history of short lists (`thousand`,
 *           `grand`, `mn`, the `$5mARR` ambiguity, comma separators) — the
 *           keys that were MEASURED wrong in this repo before, which is the
 *           only reason we know to spell them.
 *
 * Every expectation is stated as a DECISION with its reason, so a later change
 * of behaviour has to argue with the reason rather than silently flip a
 * boolean.
 */

import { describe, it, expect } from "vitest";

import { findStatedAmounts, isAmountStatedInBrief, readUnit } from "../stated-amounts.js";
import { MAGNITUDE_MULTIPLIERS } from "../../../utils/magnitude-alphabet.js";
import { CURRENCY_SYMBOL_TO_CODE } from "../../extraction/numeric-parser.js";
import { BRIEF_TEXT_AS_PERSISTED } from "./fixtures/trace-captures.js";

describe("2.972 stated-amount scan — [ALPHA] the alphabet is derived, not re-spelled", () => {
  it("resolves EVERY magnitude key the canonical alphabet carries", () => {
    // Derived, per-key. This is the half that catches a CONSUMER drifting from
    // the list; the corpus rows below are the half that catches the list being
    // short. Neither supersedes the other — ship both.
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      const found = findStatedAmounts(`the figure is 5${key} in total`);
      expect(found.map((a) => a.magnitude), `magnitude key '${key}' did not resolve`).toContain(
        5 * multiplier,
      );
    }
  });

  it("[ALPHA] reads the word forms that were MEASURED missing from sibling lists", () => {
    // `thousand` extracted as 5 while `million` extracted as 5,000,000 until
    // 2.322; `grand` produced a 1,000x under-read at confidence 0.90 until
    // 2.330. Both are spelled here because no corpus spelled them then.
    expect(findStatedAmounts("we hold $5 thousand back")[0]?.magnitude).toBe(5_000);
    expect(findStatedAmounts("budget of £250 grand for the rebuild")[0]?.magnitude).toBe(250_000);
    expect(findStatedAmounts("about £3mn of headroom")[0]?.magnitude).toBe(3_000_000);
  });

  it("[ALPHA] reads thousands separators rather than truncating at the comma", () => {
    // `parseFloat("800,000")` is 800 — the same silent 1,000x loss arriving
    // through punctuation.
    expect(findStatedAmounts("marketing is capped at £1,500,000")[0]?.magnitude).toBe(1_500_000);
  });

  it("[ALPHA] refuses an ambiguous attached trailer rather than guessing", () => {
    // "$5mARR" may be five million ARR or five m-somethings; the two readings
    // are 1,000,000x apart, so nothing is read and nothing can be claimed.
    expect(findStatedAmounts("we did $5mARR last year")).toHaveLength(0);
  });

  it("[ALPHA] every currency symbol in the shared vocabulary is recognised", () => {
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_TO_CODE)) {
      const found = findStatedAmounts(`the quote was ${symbol}250k all in`);
      expect(found[0]?.kind, `currency symbol '${symbol}' not recognised`).toBe("currency");
      expect(found[0]?.currencyCode).toBe(code);
    }
  });
});

describe("2.972 stated-amount scan — [WIRE] the three real briefs", () => {
  it("finds B1's stated £ amounts at their true magnitudes", () => {
    const gbp = findStatedAmounts(BRIEF_TEXT_AS_PERSISTED.B1)
      .filter((a) => a.currencyCode === "GBP")
      .map((a) => a.magnitude);
    // "£11.2m ARR", "£20m ARR", "£3.1m cash", "£100k a quarter",
    // "capped at £1.5m", "£16m without any new market", "£15.8m by FY28"
    expect(gbp).toEqual(
      expect.arrayContaining([11_200_000, 20_000_000, 3_100_000, 100_000, 1_500_000, 16_000_000, 15_800_000]),
    );
  });

  it("keeps B1's € amounts DISTINCT from its £ amounts", () => {
    const eur = findStatedAmounts(BRIEF_TEXT_AS_PERSISTED.B1)
      .filter((a) => a.currencyCode === "EUR")
      .map((a) => a.magnitude);
    expect(eur).toEqual(expect.arrayContaining([400_000_000, 250_000, 900_000]));
    // The measured B1-A13 loss was a €→£ swap. A £-denominated value must not
    // be earned by any of these.
    expect(isAmountStatedInBrief(0.9, "£m", BRIEF_TEXT_AS_PERSISTED.B1)).toBe(false);
    expect(isAmountStatedInBrief(0.25, "£m", BRIEF_TEXT_AS_PERSISTED.B1)).toBe(false);
  });

  it("[BRIEF] a UNIT-CHANGED restatement still matches — same currency, same magnitude", () => {
    // "£900k" written, 0.9 committed in £m: one amount, two spellings.
    expect(isAmountStatedInBrief(0.9, "£m", "we'd need £900k a year fully loaded")).toBe(true);
    expect(isAmountStatedInBrief(900_000, "£", "we'd need £900k a year fully loaded")).toBe(true);
  });

  it("[BRIEF] a PARAPHRASED (word-form) number does not match", () => {
    // Deliberate refusal: a lever set to 1 must not become brief-extracted
    // because the brief says "one compulsory redundancy round". The cost is
    // coverage; the benefit is that no claim is made we cannot show.
    expect(isAmountStatedInBrief(1, undefined, "no more than one compulsory redundancy round")).toBe(false);
    expect(isAmountStatedInBrief(11_200_000, "£", "we do eleven point two million in ARR")).toBe(false);
  });

  it("[BRIEF] a number that appears ONLY in a later question is not in the brief", () => {
    // The predicate is scoped to the text it is handed. A figure the user
    // types in a follow-up turn is not evidence about the brief the draft was
    // built from.
    const brief = BRIEF_TEXT_AS_PERSISTED.B1;
    expect(isAmountStatedInBrief(0.42, "£m", brief)).toBe(false);
    expect(isAmountStatedInBrief(0.42, "£m", `${brief} What if we spent £0.42m instead?`)).toBe(true);
  });

  it("[BRIEF] a number inside a QUOTED third party's words still counts as stated", () => {
    // Decision, pinned so it cannot flip silently: the predicate asks whether
    // the magnitude is in the text the user supplied, not whose mouth it came
    // from. B1's "legal quoted us €250k" and "Priya's cohort model … says
    // £15.8m" are both the user's own submitted words.
    expect(isAmountStatedInBrief(250_000, "€", BRIEF_TEXT_AS_PERSISTED.B1)).toBe(true);
    expect(isAmountStatedInBrief(15.8, "£m", BRIEF_TEXT_AS_PERSISTED.B1)).toBe(true);
  });

  it("[WIRE] B3 states 100% but a plain 1 does not match it", () => {
    // Measured consequence: admitting a percent↔fraction equivalence would
    // have kept the false `brief_extraction` on `opt_copilot.fac_copilot_build
    // = 1`, a binary lever with nothing to do with attach rate.
    expect(BRIEF_TEXT_AS_PERSISTED.B3).toContain("100%");
    expect(isAmountStatedInBrief(1, undefined, BRIEF_TEXT_AS_PERSISTED.B3)).toBe(false);
    // …while the percentage itself, asked as a percentage, does match.
    expect(isAmountStatedInBrief(100, "%", BRIEF_TEXT_AS_PERSISTED.B3)).toBe(true);
  });

  it("[WIRE] a numeral glued to letters is not an amount", () => {
    // "FY28" is a fiscal year, not 28 of anything.
    expect(isAmountStatedInBrief(28, undefined, "by end of FY28")).toBe(false);
    // …but B1 does separately state "about 28% year on year".
    expect(isAmountStatedInBrief(28, "%", BRIEF_TEXT_AS_PERSISTED.B1)).toBe(true);
  });

  it("[WIRE] a plain-unit value accepts any kind of stated amount", () => {
    // "~40% saving on 45 roles": a plain 45 is locatable. DISCLOSED — the
    // predicate is a NECESSARY condition on the claim, not attestation of it.
    expect(isAmountStatedInBrief(45, undefined, BRIEF_TEXT_AS_PERSISTED.B2)).toBe(true);
    expect(isAmountStatedInBrief(34, "scale", BRIEF_TEXT_AS_PERSISTED.B2)).toBe(true);
  });

  it("refuses everything when there is no brief, or the brief states no amounts", () => {
    expect(isAmountStatedInBrief(0.8, "£m", undefined)).toBe(false);
    expect(isAmountStatedInBrief(0.8, "£m", "")).toBe(false);
    expect(isAmountStatedInBrief(0.8, "£m", "we should probably do the German thing")).toBe(false);
    expect(isAmountStatedInBrief(Number.NaN, "£m", BRIEF_TEXT_AS_PERSISTED.B1)).toBe(false);
  });

  it("is not order-dependent across calls (no shared regex lastIndex)", () => {
    const brief = BRIEF_TEXT_AS_PERSISTED.B1;
    const first = findStatedAmounts(brief).length;
    findStatedAmounts("unrelated 5m call in between");
    expect(findStatedAmounts(brief).length).toBe(first);
  });
});

describe("2.972 unit reading", () => {
  it("reads currency, magnitude and percent units, and degrades unknown units to plain x1", () => {
    expect(readUnit("£m")).toEqual({ kind: "currency", currencyCode: "GBP", multiplier: 1_000_000 });
    expect(readUnit("£")).toEqual({ kind: "currency", currencyCode: "GBP", multiplier: 1 });
    expect(readUnit("%")).toEqual({ kind: "percent", multiplier: 1 });
    expect(readUnit("percent")).toEqual({ kind: "percent", multiplier: 1 });
    // A unit this module does not understand must never inflate a magnitude.
    expect(readUnit("scale")).toEqual({ kind: "plain", multiplier: 1 });
    expect(readUnit("Trustpilot score")).toEqual({ kind: "plain", multiplier: 1 });
    expect(readUnit("hires")).toEqual({ kind: "plain", multiplier: 1 });
    expect(readUnit(undefined)).toEqual({ kind: "plain", multiplier: 1 });
  });
});
