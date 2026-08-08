/**
 * ROADMAP 2.972 — IS THIS NUMBER IN THE USER'S OWN WORDS?
 *
 * WHAT THIS ANSWERS, exactly, and nothing wider. Given a number the SYSTEM
 * committed to (an option intervention level) and the text the USER supplied
 * (`brief_text`, as persisted), it answers one question:
 *
 *     "Does this magnitude appear in the user's own words, at this scale,
 *      in this currency?"
 *
 * It is the evidence gate for the provenance claim `source: "brief_extraction"`
 * / `value_confidence: "high"`. It NEVER reads a number OUT of the brief to
 * USE, and it stamps nothing as the user's own — this module is not a writer of
 * any user-owned provenance literal, which is why it is absent from the
 * reviewed manifest in `transforms/__tests__/no-brief-derived-user-override.writers.test.ts`.
 * That distinction is the whole safety argument, and it is the opposite
 * direction from the reverted 2.714 / #853 seam (`graph-data-integrity.ts`,
 * "⚠ NONE OF THESE READS THE BRIEF, and none may") which took a stated number
 * out of prose and presented it back as the user's own statement: that MINTS a
 * value and can be 10^6x wrong; this one only ever WEAKENS a label the model
 * already wrote, and its worst failure is an honest `cee_hypothesis` on a value
 * that was in fact brief-derived.
 *
 * ⚠ IT IS A NECESSARY CONDITION, NOT A SUFFICIENT ONE, and that is stated here
 * so no later reader mistakes it for attestation. "45" appearing in "45 roles"
 * makes a plain-unit 45 locatable even if the model meant something else
 * entirely. The predicate therefore governs only the DOWNGRADE direction: not
 * locatable ⇒ the strong claim is withdrawn; locatable ⇒ we have no grounds to
 * withdraw it and it stands. Fail toward under-claiming, never toward the
 * stronger claim.
 *
 * DELIBERATE REFUSALS (each one costs coverage and buys truth):
 *   - WORD-FORM numerals ("two existing customers", "one compulsory round")
 *     are not read. A lever set to 1 must not become "brief-extracted" because
 *     the brief says "one".
 *   - PERCENT↔FRACTION equivalence is NOT applied. Measured on the trace
 *     corpus: B3 says "if attach were 100%", and admitting 1 ↔ 100% would have
 *     kept the false `brief_extraction` on `opt_copilot.fac_copilot_build = 1`,
 *     a binary lever that has nothing to do with attach rate.
 *   - CURRENCY IDENTITY IS REQUIRED. B1 states "€900k" and "€250k"; the draft
 *     stamped `£m` intervention values. A £-denominated value is not made
 *     brief-backed by a €-denominated statement — that currency swap is itself
 *     one of the measured losses (loss-map B1-A13).
 *   - A numeral glued to letters ("FY28") is not an amount.
 *
 * THE ALPHABET IS NOT RE-DERIVED HERE (CLAUDE.md trap 12). Digits, thousands
 * separators, magnitude suffixes and the ambiguous-trailer guard all come from
 * `utils/magnitude-alphabet.ts`; the currency vocabulary comes from
 * `cee/extraction/numeric-parser.ts`'s `CURRENCY_SYMBOL_TO_CODE`. A key added
 * to either list is live here the instant it lands, with nothing to sync.
 */

import {
  AMOUNT_DIGITS,
  MAGNITUDE_AMBIGUOUS_TRAILER_GUARD,
  magnitudeSuffixPattern,
  parseAmountDigits,
  resolveMagnitude,
} from "../../utils/magnitude-alphabet.js";
import { CURRENCY_SYMBOL_TO_CODE } from "../extraction/numeric-parser.js";

/** What KIND of quantity a written amount (or a unit string) denotes. */
export type AmountKind = "currency" | "percent" | "plain";

/** One amount found in the user's own words. */
export interface StatedAmount {
  /** Absolute magnitude as written: 250000 for "€250k", 60 for "60%", 45 for "45 roles". */
  readonly magnitude: number;
  readonly kind: AmountKind;
  /** ISO-ish currency code (GBP/USD/EUR/…) when `kind === "currency"`. */
  readonly currencyCode?: string;
  readonly matchedText: string;
  readonly index: number;
}

/**
 * The currency alternation, DERIVED from the shared symbol map and sorted
 * longest-first for the same reason the magnitude alternation is: alternation
 * is first-match-wins, so a bare `$` placed before `A$` would swallow it.
 */
const CURRENCY_ALTERNATION: string = Object.keys(CURRENCY_SYMBOL_TO_CODE)
  .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  .map((symbol) => symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

/**
 * The scan pattern.
 *
 * `(?<![\w.])` is load-bearing twice over: it stops the "28" of "FY28" being
 * read as an amount, and it stops the trailing "2" of "11.2" being re-read as
 * its own amount on the next scan position.
 */
const STATED_AMOUNT_PATTERN = new RegExp(
  `(?<![\\w.])(?<currency>${CURRENCY_ALTERNATION})?\\s*` +
    `(?<digits>${AMOUNT_DIGITS})` +
    magnitudeSuffixPattern("mag") +
    MAGNITUDE_AMBIGUOUS_TRAILER_GUARD +
    `(?<pct>\\s*%)?`,
  "gi",
);

/**
 * Every amount stated in `text`, in source order.
 *
 * Pure. Never throws. An empty / non-string input yields an empty array, which
 * makes every value un-locatable — the fail-closed direction.
 */
export function findStatedAmounts(text: string | null | undefined): readonly StatedAmount[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const out: StatedAmount[] = [];
  // A fresh RegExp per call: `lastIndex` on a shared /g instance is
  // cross-call state, and a shared one would make this function's answer
  // depend on who called it last.
  const pattern = new RegExp(STATED_AMOUNT_PATTERN.source, STATED_AMOUNT_PATTERN.flags);
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    const groups = m.groups ?? {};
    const digits = parseAmountDigits(groups.digits);
    if (digits === null) continue;
    const magnitude = digits * resolveMagnitude(groups.mag);
    if (!Number.isFinite(magnitude)) continue;

    const symbol = groups.currency;
    const isPercent = typeof groups.pct === "string";
    // A currency symbol wins over a trailing '%': "£40%" is not a shape any
    // brief writes, and reading it as currency keeps the two kinds disjoint.
    const kind: AmountKind = symbol ? "currency" : isPercent ? "percent" : "plain";
    const currencyCode = symbol
      ? CURRENCY_SYMBOL_TO_CODE[symbol] ?? CURRENCY_SYMBOL_TO_CODE[symbol.toUpperCase()] ?? symbol
      : undefined;

    out.push({
      magnitude,
      kind,
      ...(currencyCode !== undefined && { currencyCode }),
      matchedText: m[0],
      index: m.index,
    });
  }
  return out;
}

/** What a graph unit string denotes, and the multiplier it implies. */
export interface UnitReading {
  readonly kind: AmountKind;
  readonly currencyCode?: string;
  /** Multiplier from the unit's own magnitude letter: "£m" ⇒ 1e6. */
  readonly multiplier: number;
}

/**
 * The unit-string grammar: an optional currency symbol, an optional magnitude
 * key, an optional '%'. Anything else ("scale", "hires", "Trustpilot score")
 * reads as `plain` with multiplier 1 — a unit this module does not understand
 * must never inflate a magnitude.
 */
const UNIT_PATTERN = new RegExp(
  `^\\s*(?<currency>${CURRENCY_ALTERNATION})?\\s*` + magnitudeSuffixPattern("mag") + `\\s*(?<pct>%)?\\s*$`,
  "i",
);

/** Read a graph `unit` string. Unknown units degrade to plain × 1. */
export function readUnit(unit: string | null | undefined): UnitReading {
  if (typeof unit !== "string" || unit.trim().length === 0) {
    return { kind: "plain", multiplier: 1 };
  }
  const trimmed = unit.trim();
  if (/^percent(age)?$/i.test(trimmed)) return { kind: "percent", multiplier: 1 };
  const m = UNIT_PATTERN.exec(trimmed);
  if (!m) return { kind: "plain", multiplier: 1 };
  const groups = m.groups ?? {};
  const symbol = groups.currency;
  const multiplier = resolveMagnitude(groups.mag);
  if (symbol) {
    const code =
      CURRENCY_SYMBOL_TO_CODE[symbol] ?? CURRENCY_SYMBOL_TO_CODE[symbol.toUpperCase()] ?? symbol;
    return { kind: "currency", currencyCode: code, multiplier };
  }
  if (typeof groups.pct === "string") return { kind: "percent", multiplier };
  return { kind: "plain", multiplier };
}

/**
 * Relative tolerance for the magnitude comparison. Values arrive normalised
 * and re-scaled (`0.8 × 1e6`), so binary floating point makes exact equality
 * the wrong test; 1e-9 is far tighter than any real amount collision.
 */
const RELATIVE_EPSILON = 1e-9;

function magnitudesMatch(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= RELATIVE_EPSILON * scale;
}

/**
 * Is `value` (in `unit`) an amount the user actually stated in `briefText`?
 *
 * KIND COMPATIBILITY IS PART OF THE ANSWER, not a refinement of it:
 *   - a currency-denominated value needs a stated amount in the SAME currency;
 *   - a percent-denominated value needs a stated percentage;
 *   - a plain / unrecognised-unit value accepts any kind, because the writer's
 *     "34%" and "34 roles" are both plausibly the source of a plain 34.
 *
 * Returns false for a missing brief, a non-finite value, or an empty scan —
 * every "we cannot tell" answer is a refusal.
 */
export function isAmountStatedInBrief(
  value: number,
  unit: string | null | undefined,
  briefText: string | null | undefined,
): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const amounts = findStatedAmounts(briefText);
  if (amounts.length === 0) return false;

  const reading = readUnit(unit);
  const target = value * reading.multiplier;
  if (!Number.isFinite(target)) return false;

  for (const amount of amounts) {
    if (reading.kind === "currency") {
      if (amount.kind !== "currency") continue;
      if (amount.currencyCode !== reading.currencyCode) continue;
    } else if (reading.kind === "percent") {
      if (amount.kind !== "percent") continue;
    }
    if (magnitudesMatch(amount.magnitude, target)) return true;
  }
  return false;
}
