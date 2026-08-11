/**
 * ROADMAP 2.972 — IS THIS MAGNITUDE PRESENT IN THE TEXT THE USER SUBMITTED?
 *
 * WHAT THIS ANSWERS, exactly, and nothing wider. Given a number the SYSTEM
 * committed to (an option intervention level) and the text the USER supplied
 * (`brief_text`, as persisted), it answers one question:
 *
 *     "Is this magnitude PRESENT IN THE TEXT THE USER SUBMITTED, at this
 *      scale, in this currency?"
 *
 * ⚠ THAT IS NOT THE SAME CLAIM AS "the user said this" (naming corrected after
 * the adversarial review of #873, which was right that the earlier wording
 * overclaimed). A number inside a quoted third party's sentence — B1's "legal
 * quoted us €250k", "Priya's cohort model … says £15.8m" — is present in the
 * submitted text without being the user's own assertion. This module cannot
 * tell those apart and does not try: separating them needs intent parsing that
 * fails toward silently disbelieving users, which is a worse failure than the
 * one it would fix. Admitting a quoted number therefore means "we have no
 * grounds to WITHDRAW the claim", never "the claim is attested".
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
 * ⚠⚠ THE FALSE-NEGATIVE SET IS BROADER THAN THE LIST BELOW, AND THE LIST IS
 * NOT COMPLETE. Named so no later reader mistakes it for an inventory: the
 * adversarial review of #873 enumerated further classes this scan does not
 * read — ranges where a currency does not distribute (`£2–3m`; the real corpus
 * contains `10-15%`), a bare magnitude unit measured against a currency
 * statement, word-form currency units ("pounds") and word-form percentages
 * ("60 per cent"), signed values, locale decimal separators, ISO codes written
 * inside the BRIEF (only the UNIT form is read), and postfix currency
 * (`900kr`). All are rowed separately. Every one of them fails toward
 * under-claiming — a genuinely brief-backed value is labelled
 * `cee_hypothesis` — which is the safe direction, but it is a real coverage
 * loss and it is not a closed set.
 *
 * DELIBERATE REFUSALS (a subset of the above, chosen rather than merely
 * unimplemented — each costs coverage and buys truth):
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
import { resolveExistingRawValue } from "../../orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.js";

/** What KIND of quantity a written amount (or a unit string) denotes. */
export type AmountKind = "currency" | "percent" | "plain";

/** One amount found in the text the user submitted. */
export interface StatedAmount {
  /** Absolute magnitude as written: 250000 for "€250k", 60 for "60%", 45 for "45 roles". */
  readonly magnitude: number;
  readonly kind: AmountKind;
  /** ISO-ish currency code (GBP/USD/EUR/…) when `kind === "currency"`. */
  readonly currencyCode?: string;
  readonly matchedText: string;
  readonly index: number;
}

/** Escape a literal for use inside a regex alternation built from data. */
function escapeForAlternation(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a longest-first alternation from a set of literals. Alternation is
 * first-match-wins, so a bare `$` placed before `A$` would swallow it; sorting
 * by raw length before escaping cannot get that wrong for any literal, present
 * or future.
 */
function alternationOf(literals: Iterable<string>): string {
  return [...new Set(literals)]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(escapeForAlternation)
    .join("|");
}

/** The currency SYMBOL alternation, derived from the shared map's keys. */
const CURRENCY_ALTERNATION: string = alternationOf(Object.keys(CURRENCY_SYMBOL_TO_CODE));

/**
 * The currency ISO-CODE alternation, derived from the SAME map's values.
 *
 * ⚠ WHY THIS EXISTS (adversarial review of #873). The currency-identity
 * refusal was spelled against the symbol form only, so it held for
 * `unit: "£"` and COLLAPSED for `unit: "GBP"`: the code read as an
 * unrecognised unit, degraded to `plain`, and `plain` accepted any kind — so a
 * £-nothing value was certified brief-extracted against a `€900k` statement.
 * That is the fabrication direction, and `GBP` is the producer's own
 * vocabulary, not a synthetic edge (`schemas/cee-v3.ts:57` documents the unit
 * field as "e.g. 'GBP', 'USD'", and `parseNumericValue("£59")` returns
 * `unit: "GBP"` in the module this one imports the map from).
 *
 * Derived from `Object.values(...)` rather than listed, so the symbol form and
 * the code form of a currency can never disagree about which currencies exist.
 */
const ISO_CURRENCY_ALTERNATION: string = alternationOf(Object.values(CURRENCY_SYMBOL_TO_CODE));

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

/** The same grammar in the ISO-code form ("GBP", "USD", "GBPm"). */
const ISO_UNIT_PATTERN = new RegExp(
  `^\\s*(?<code>${ISO_CURRENCY_ALTERNATION})` + magnitudeSuffixPattern("mag") + `\\s*$`,
  "i",
);

/** Read a graph `unit` string. Unknown units degrade to plain × 1. */
export function readUnit(unit: string | null | undefined): UnitReading {
  if (typeof unit !== "string" || unit.trim().length === 0) {
    return { kind: "plain", multiplier: 1 };
  }
  const trimmed = unit.trim();
  if (/^percent(age)?$/i.test(trimmed)) return { kind: "percent", multiplier: 1 };
  const iso = ISO_UNIT_PATTERN.exec(trimmed);
  if (iso) {
    return {
      kind: "currency",
      currencyCode: (iso.groups?.code ?? trimmed).toUpperCase(),
      multiplier: resolveMagnitude(iso.groups?.mag),
    };
  }
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
 * WS-A ITEM 1 — THE MAGNITUDE A NORMALISED LEVEL DENOTES, given the producer's
 * own declared denominator.
 *
 * WHY THIS EXISTS. The pipeline reasons in NORMALISED lever space
 * (`observed_state.value ∈ [0,1]`) and records the denominator beside it
 * (`observed_state.cap`). Everything that compares a lever against the user's
 * words — this module's predicate, and the commit-time money invariant in
 * `money-invariant.ts` — needs the same inverse, so it is resolved ONCE here
 * rather than multiplied out at each call site (CLAUDE.md trap 21: two
 * derivations of one meaning end up disagreeing inside a single response).
 *
 * THE INVERSE IS NOT RE-DERIVED. `resolveExistingRawValue` is the shared
 * de-normalisation the validator, the executor precheck and the
 * `set_factor_value` handler already agree on (the AC.1 parity invariant), and
 * it is the exact inverse of `normaliseFactorValue`, which stores
 * `value = raw / cap` for every capped factor and `value = raw` when uncapped.
 * `raw_value` is deliberately NOT passed: the question is what THIS level
 * denotes, not what some earlier level denoted (the stale-sibling defect
 * `reconcileObservedValuePair` exists to repair).
 *
 * FAILS TOWARD THE WEAKER CLAIM, like everything else in this module:
 *   - no usable cap (absent, non-finite, ≤ 0 — all off-contract, since
 *     `evaluateFactorValueProposal` guarantees a positive cap on the write
 *     path) ⇒ `null`, and the caller keeps today's raw comparison;
 *   - `ambiguous` (a raw-value-less `%` whose divisor cannot be recovered)
 *     ⇒ `null`, so the strong claim is withheld rather than guessed.
 */
export function denormalisedMagnitude(
  value: number,
  unit: string | null | undefined,
  cap: number | null | undefined,
): number | null {
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const resolved = resolveExistingRawValue({
    value,
    cap,
    ...(typeof unit === "string" ? { unit } : {}),
  });
  return resolved.kind === "resolved" && Number.isFinite(resolved.raw) ? resolved.raw : null;
}

/**
 * Is `value` (in `unit`) an amount the user actually stated in `briefText`?
 *
 * KIND COMPATIBILITY IS PART OF THE ANSWER, not a refinement of it:
 *   - a currency-denominated value needs a stated amount in the SAME currency;
 *   - a percent-denominated value needs a stated percentage;
 *   - a plain / unrecognised-unit value accepts plain and percent statements,
 *     because the writer's "34%" and "34 roles" are both plausibly the source
 *     of a plain 34 — but NEVER a currency statement (see below).
 *
 * ⚠ A CURRENCY-DENOMINATED STATEMENT NEVER MATCHES A UNIT WE COULD NOT READ
 * (adversarial review of #873). The symbol-form refusal was correct and the
 * ISO-code form fell through to `plain`, where "accepts any kind" silently
 * re-opened the cross-currency hole it exists to close. Recognising `GBP` (see
 * `ISO_CURRENCY_ALTERNATION`) fixes the named spelling; this rule closes the
 * CLASS, because a `€`/`£`/`$` in the brief is an explicit statement of
 * denomination and a unit we cannot read tells us nothing about whether the
 * two are the same quantity. It covers word forms ("pounds"), bare magnitudes
 * ("m"), unitless values, and every spelling nobody has thought of — one
 * derived rule instead of an enumeration that would drift.
 *
 * Returns false for a missing brief, a non-finite value, or an empty scan —
 * every "we cannot tell" answer is a refusal.
 *
 * ⚠ WS-A ITEM 1(a) — `cap` IS THE FOURTH ARGUMENT, AND ITS ABSENCE IS THE
 * DEFECT THAT SHIPPED. The one production call site passed a NORMALISED lever
 * level (0.72) while the brief states raw magnitudes (18000), so the predicate
 * was structurally incapable of firing: 117 of 117 interventions disowned,
 * measured at CEE `8e3ad916` (L2B-VARIANCE.md §2.4). Nothing about the
 * question this function answers was wrong — it was fed the wrong number.
 * Supplying the producer's own declared denominator answers the same question
 * about the magnitude the encoding actually denotes. OPTIONAL, so every
 * existing three-argument caller is byte-identical to before.
 */
export function isAmountStatedInBrief(
  value: number,
  unit: string | null | undefined,
  briefText: string | null | undefined,
  cap?: number | null,
): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const amounts = findStatedAmounts(briefText);
  if (amounts.length === 0) return false;

  const reading = readUnit(unit);
  const magnitude = denormalisedMagnitude(value, unit, cap) ?? value;
  const target = magnitude * reading.multiplier;
  if (!Number.isFinite(target)) return false;

  for (const amount of amounts) {
    if (reading.kind === "currency") {
      if (amount.kind !== "currency") continue;
      if (amount.currencyCode !== reading.currencyCode) continue;
    } else if (reading.kind === "percent") {
      if (amount.kind !== "percent") continue;
    } else if (amount.kind === "currency") {
      // Unread unit vs an explicitly denominated amount — see the note above.
      continue;
    }
    if (magnitudesMatch(amount.magnitude, target)) return true;
  }
  return false;
}
