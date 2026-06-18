/**
 * P0-A value/unit fail-closed containment for `set_factor_value`.
 *
 * The live failure (COMBINED-BUILD acceptance, Gate 6): "Set Incremental
 * Hiring Cost to 5 agents" silently set a £200,000 factor to £5. The chain:
 *   - CQE does not recognise "agents" as a unit (see context/cqe/rules.ts —
 *     the UNIT grammar is %, pp, time, metric, currency only), so it returns a
 *     bare value with `unit: null`;
 *   - `mapCqeQuantityToProposalValue` maps that null unit to `undefined`, so
 *     the synthesised proposal carries NO unit;
 *   - the `unit_mismatch` guard in `evaluate-factor-value-proposal.ts` only
 *     fires when BOTH the proposal AND the factor carry a unit, so it never
 *     compares "agents" against the factor's "£";
 *   - 5 sits inside the factor's cap, so the bare-number range guard passes.
 * Every existing guard is satisfied and the unit is silently dropped.
 *
 * Crucially, this CANNOT be fixed in `evaluateFactorValueProposal`: a locked
 * test there asserts that a bare number against a unit-bearing capped factor
 * is accepted ("reuse the existing unit"). At the predicate level "5 agents"
 * and a legitimate bare "5" are structurally identical — the only difference
 * is the dropped "agents" token, which is lost before the predicate runs. The
 * distinguishing information lives only in the raw user message, so the check
 * must run upstream, where the message is still available.
 *
 * This module is that missing, unit-token-aware check. It inspects the raw
 * user message for a unit/qualifier token attached to the value being set and
 * compares its UNIT FAMILY (currency / percent / time / metric / count) to the
 * target factor's stored unit family. When the user's token belongs to a
 * DIFFERENT family than the typed factor, the value cannot be resolved with
 * confidence and the caller must fail closed (clarify, graph unchanged).
 *
 * Design choices — deliberately narrow; this is containment, not NL hardening:
 *   - Only a RECOGNISED unit token in a different family blocks. Unknown words
 *     (sentence connectives like "now", "instead", "next") classify as `null`
 *     and are IGNORED, so there are no false-positive clarifies on ordinary
 *     phrasing.
 *   - The check is inert unless the factor carries a stored unit. A factor with
 *     no unit has no family to conflict with, so bare-number and count-factor
 *     flows ("Set X to 0.5", "Set headcount to 5") are never affected.
 *   - We anchor on the LAST numeric value in the message (value updates place
 *     the value last) so a unit-family word inside the factor label earlier in
 *     the sentence ("Set the 3 month runway factor to 5") cannot trigger a
 *     false block.
 *   - The vocabulary is broader than CQE's on purpose: it also recognises the
 *     unit WORDS CQE drops ("percent", "pounds") and count nouns ("agents"),
 *     which is exactly the class of token that produced the live failure.
 */

/** Coarse unit families. A user token is "compatible" with a factor unit only
 *  when they share a family. */
export type UnitFamily = 'currency' | 'percent' | 'time' | 'metric' | 'count';

/**
 * Canonical token → family map. Keys are lower-cased. Plural forms are handled
 * by a trailing-`s` fallback in `unitFamilyOf` (so "agents" resolves via
 * "agent"); irregular plurals ("people") are listed explicitly.
 */
const FAMILY_BY_TOKEN: ReadonlyMap<string, UnitFamily> = new Map<string, UnitFamily>([
  // currency — symbols, ISO codes, and the words CQE does NOT recognise.
  ['£', 'currency'],
  ['$', 'currency'],
  ['€', 'currency'],
  ['gbp', 'currency'],
  ['usd', 'currency'],
  ['eur', 'currency'],
  ['pound', 'currency'],
  ['dollar', 'currency'],
  ['euro', 'currency'],
  ['grand', 'currency'],
  ['quid', 'currency'],
  // percent — symbol plus the words CQE's grammar omits ("percent",
  // "percentage"); "pp"/"percentage points" stay percent-family.
  ['%', 'percent'],
  ['pp', 'percent'],
  ['percent', 'percent'],
  ['percentage', 'percent'],
  // time — mirrors CQE's TIME_UNIT.
  ['month', 'time'],
  ['week', 'time'],
  ['day', 'time'],
  ['year', 'time'],
  ['hour', 'time'],
  ['minute', 'time'],
  ['quarter', 'time'],
  // metric — mirrors CQE's METRIC_UNIT.
  ['kg', 'metric'],
  ['km', 'metric'],
  ['mile', 'metric'],
  // count / headcount nouns — the class the live failure used ("agents").
  // A money/percent/time factor cannot take a headcount value, so these
  // conflict with every non-count family.
  ['agent', 'count'],
  ['person', 'count'],
  ['people', 'count'],
  ['staff', 'count'],
  ['head', 'count'],
  ['headcount', 'count'],
  ['hire', 'count'],
  ['employee', 'count'],
  ['fte', 'count'],
  ['developer', 'count'],
  ['engineer', 'count'],
  ['contractor', 'count'],
  ['recruit', 'count'],
  ['seat', 'count'],
  ['user', 'count'],
  ['member', 'count'],
  ['worker', 'count'],
  ['role', 'count'],
  ['position', 'count'],
]);

/**
 * Resolve a single token (symbol or word) to its unit family, or `null` when
 * the token is not a recognised unit. Tolerant of case and simple plurals.
 */
export function unitFamilyOf(raw: string | undefined): UnitFamily | null {
  if (raw === undefined) return null;
  const t = raw.trim().toLowerCase();
  if (t.length === 0) return null;
  const direct = FAMILY_BY_TOKEN.get(t);
  if (direct !== undefined) return direct;
  // Simple plural fallback: "agents" → "agent", "months" → "month".
  if (t.length > 1 && t.endsWith('s')) {
    const singular = FAMILY_BY_TOKEN.get(t.slice(0, -1));
    if (singular !== undefined) return singular;
  }
  return null;
}

/**
 * The numeric value of a value-update phrasing comes LAST ("Set X to 5
 * agents"). This pattern finds each `<number>[suffix] <token>` occurrence so
 * the caller can take the last one. The magnitude suffix (k/m/bn/…) is
 * word-bounded so "5 miles" is parsed as value 5 + token "miles", not value 5m
 * + token "iles". The trailing token group is optional so bare numbers ("5")
 * simply yield no token.
 */
const VALUE_TRAILING_TOKEN_RE =
  /(\d[\d,]*(?:\.\d+)?)(?:\s*(?:k|m|bn?|thousand|million|billion)\b)?\s*([%£$€]|[a-z][a-z]*)?/gi;

/**
 * Extract the unit/qualifier token attached to the LAST numeric value in the
 * message, or `null` when the last value has no trailing token. Trailing
 * currency symbols and alphabetic words are both returned; a bare number
 * yields `null`.
 */
export function lastValueTrailingToken(message: string): string | null {
  let token: string | null = null;
  // Reset lastIndex defensively — the regex is module-scoped and stateful.
  VALUE_TRAILING_TOKEN_RE.lastIndex = 0;
  for (let m = VALUE_TRAILING_TOKEN_RE.exec(message); m !== null; m = VALUE_TRAILING_TOKEN_RE.exec(message)) {
    // Guard against zero-width matches (the whole pattern is optional after
    // the leading digit, but the digit is required, so this is belt-and-braces).
    if (m.index === VALUE_TRAILING_TOKEN_RE.lastIndex) VALUE_TRAILING_TOKEN_RE.lastIndex++;
    const trailing = m[2];
    token = trailing !== undefined && trailing.length > 0 ? trailing : null;
  }
  return token;
}

/** Verdict from comparing the user's value-unit token against the factor. */
export type ValueUnitVerdict =
  | { readonly resolved: true }
  | {
      readonly resolved: false;
      readonly reason: 'incompatible_unit';
      /** Families are coarse enums (no user text) — safe for telemetry. */
      readonly user_unit_family: UnitFamily;
      readonly factor_unit_family: UnitFamily;
    };

/**
 * Decide whether the value-unit the user expressed for a `set_factor_value`
 * edit can be resolved against the target factor with confidence.
 *
 * Returns `{ resolved: true }` (the caller proceeds) when:
 *   - the factor carries no stored unit (nothing to conflict with), OR
 *   - the value has no trailing unit token, OR
 *   - the trailing token is not a recognised unit (an ordinary word), OR
 *   - the trailing token shares the factor's unit family.
 *
 * Returns `{ resolved: false, reason: 'incompatible_unit', … }` when the
 * trailing token IS a recognised unit but belongs to a DIFFERENT family than
 * the factor — e.g. "5 agents" (count) on a "£" factor (currency), or "50
 * percent" (percent) on a "£" factor. The caller must then fail closed.
 */
export function classifyValueUnitAgainstFactor(
  message: string,
  factorUnit: string | undefined,
): ValueUnitVerdict {
  const factorFamily = unitFamilyOf(factorUnit);
  // Untyped factor (or a unit we don't classify) — no family to conflict with.
  // Bare-number and count-factor flows must keep working, so do not block.
  if (factorFamily === null) return { resolved: true };

  const token = lastValueTrailingToken(message ?? '');
  if (token === null) return { resolved: true };

  const userFamily = unitFamilyOf(token);
  // Unrecognised trailing word (sentence connective / noise) — ignore. This is
  // what keeps the guard from firing on ordinary phrasing.
  if (userFamily === null) return { resolved: true };

  if (userFamily === factorFamily) return { resolved: true };

  return {
    resolved: false,
    reason: 'incompatible_unit',
    user_unit_family: userFamily,
    factor_unit_family: factorFamily,
  };
}
