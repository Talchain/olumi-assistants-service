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
 * Sentence/function words that legitimately follow a value in an edit message
 * and are NOT units ("set X to 50000 now", "to £300k for", "to £2 instead").
 * A trailing token in this allowlist is treated as ordinary prose and ignored.
 * Anything NOT here and NOT a recognised unit is, on a typed factor, an
 * unresolved unit-like token and fails closed (e.g. "5 widgets") — see the
 * `unresolved_unit_token` verdict. The list errs toward completeness; a missed
 * connective only costs a (safe) clarify, never a silent coercion.
 */
const CONNECTIVE_TOKENS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'so', 'yet', 'for', 'to', 'from',
  'by', 'per', 'with', 'of', 'in', 'on', 'at', 'as', 'if', 'when', 'while',
  'because', 'since', 'via', 'than', 'then', 'that', 'this', 'these', 'those',
  'it', 'its', 'times', 'x', 'now', 'today', 'tomorrow', 'soon', 'immediately',
  'currently', 'already', 'still', 'again', 'next', 'later', 'earlier',
  'instead', 'also', 'too', 'here', 'there', 'about', 'around', 'approximately',
  'roughly', 'exactly', 'only', 'just', 'even', 'more', 'less', 'up', 'down',
  'max', 'min', 'maximum', 'minimum', 'total', 'overall', 'please', 'thanks',
  'ok', 'okay', 'is', 'are', 'was', 'be', 'our', 'current', 'baseline',
  'going', 'forward', 'each', 'every', 'all',
]);

/**
 * Parse every `<number>[magnitude-suffix] <trailing-token>` occurrence in the
 * message. The numeric value is normalised (commas stripped, suffix expanded)
 * so it can be compared to the proposed mutation value. The magnitude suffix
 * (k/m/bn/…) is word-bounded so "5 miles" is value 5 + token "miles", not value
 * 5m + token "iles". A leading-dot decimal (".5") is accepted. The trailing
 * token is optional — a bare number yields `token: null`.
 */
const VALUE_TOKEN_RE =
  /(\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*(k|m|bn?|thousand|million|billion)\b)?\s*([%£$€]|[a-z][a-z]*)?/gi;

const SUFFIX_FACTOR: ReadonlyMap<string, number> = new Map([
  ['k', 1e3], ['thousand', 1e3],
  ['m', 1e6], ['million', 1e6],
  ['b', 1e9], ['bn', 1e9], ['billion', 1e9],
]);

interface ValueTokenEntry {
  /** Normalised numeric value (commas stripped, magnitude suffix applied). */
  readonly value: number;
  /** The trailing unit/qualifier token, or null for a bare number. */
  readonly token: string | null;
}

function parseValueTokenEntries(message: string): ValueTokenEntry[] {
  const entries: ValueTokenEntry[] = [];
  VALUE_TOKEN_RE.lastIndex = 0;
  for (let m = VALUE_TOKEN_RE.exec(message); m !== null; m = VALUE_TOKEN_RE.exec(message)) {
    if (m.index === VALUE_TOKEN_RE.lastIndex) VALUE_TOKEN_RE.lastIndex++; // zero-width guard
    const numText = m[1];
    if (numText === undefined) continue;
    let value = Number.parseFloat(numText.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const suffix = m[2]?.toLowerCase();
    if (suffix !== undefined) {
      const factor = SUFFIX_FACTOR.get(suffix);
      if (factor !== undefined) value *= factor;
    }
    const trailing = m[3];
    entries.push({ value, token: trailing !== undefined && trailing.length > 0 ? trailing : null });
  }
  return entries;
}

/**
 * Back-compat helper: the trailing token of the LAST numeric value (the value
 * of a single-clause "Set X to N <unit>" comes last). Retained for callers /
 * tests that don't attribute to a specific proposed value.
 */
export function lastValueTrailingToken(message: string): string | null {
  const entries = parseValueTokenEntries(message ?? '');
  return entries.length > 0 ? entries[entries.length - 1]!.token : null;
}

/** How a single trailing token relates to the factor's unit family. */
type TokenClass = 'compatible' | 'incompatible' | 'connective' | 'unresolved' | 'none';

function classifyToken(token: string | null, factorFamily: UnitFamily): TokenClass {
  if (token === null) return 'none';
  const fam = unitFamilyOf(token);
  if (fam !== null) return fam === factorFamily ? 'compatible' : 'incompatible';
  if (CONNECTIVE_TOKENS.has(token.trim().toLowerCase())) return 'connective';
  return 'unresolved';
}

/** Verdict from comparing the user's value-unit token against the factor. */
export type ValueUnitVerdict =
  | { readonly resolved: true }
  | {
      readonly resolved: false;
      /**
       * `incompatible_unit`: a recognised unit in a DIFFERENT family (e.g. "5
       * agents" / "50 percent" on a £ factor). `unresolved_unit_token`: a
       * value-attached unit-like token we cannot resolve at all (e.g. "5
       * widgets") — also fails closed so a dropped unit can never coerce.
       */
      readonly reason: 'incompatible_unit' | 'unresolved_unit_token';
      /** Coarse enums (no user text) — safe for telemetry. Omitted when unknown. */
      readonly user_unit_family?: UnitFamily;
      readonly factor_unit_family: UnitFamily;
    };

/** Numeric tolerance for matching a message value to the proposed value. */
function valueMatches(entry: ValueTokenEntry, proposed: number): boolean {
  const scale = Math.max(1, Math.abs(proposed), Math.abs(entry.value));
  return Math.abs(entry.value - proposed) <= 1e-6 * scale;
}

/**
 * Decide whether the value-unit the user expressed for a `set_factor_value`
 * edit can be resolved against the target factor with confidence.
 *
 * The check is bound to the value ATTACHED TO THE PROPOSED MUTATION, not merely
 * the last number in the message — so a compound turn ("Set Cost to 5 agents
 * and set Programme to 0.5") is judged on the cost-factor's own value (5
 * agents), not the unrelated 0.5. `proposedValue` is the numeric the handler
 * would apply; when omitted (back-compat / single-value callers) the last value
 * is used.
 *
 * Fails closed (`resolved: false`) when the attributed token is EITHER a
 * recognised unit in a different family (`incompatible_unit`) OR a value-
 * attached unit-like token we cannot resolve (`unresolved_unit_token`).
 * Resolves when: the factor is untyped (no family to conflict with), the value
 * has no trailing token, the token is an ordinary connective, or the token
 * shares the factor's family. In a multi-quantity message where the proposed
 * value cannot be attributed, only a KNOWN-incompatible unit blocks (an
 * unattributable unknown word is treated as prose, never a silent coercion).
 */
export function classifyValueUnitAgainstFactor(
  message: string,
  factorUnit: string | undefined,
  proposedValue?: number,
): ValueUnitVerdict {
  const factorFamily = unitFamilyOf(factorUnit);
  // Untyped factor (or a unit we don't classify) — no family to conflict with.
  // Bare-number and count-factor flows must keep working, so do not block.
  if (factorFamily === null) return { resolved: true };

  const entries = parseValueTokenEntries(message ?? '');
  if (entries.length === 0) return { resolved: true };

  // Attribute to the proposed value where possible.
  let tokensToCheck: Array<string | null>;
  let attributed: boolean;
  if (proposedValue !== undefined && Number.isFinite(proposedValue)) {
    const matches = entries.filter((e) => valueMatches(e, proposedValue));
    if (matches.length > 0) {
      tokensToCheck = matches.map((e) => e.token);
      attributed = true;
    } else if (entries.length === 1) {
      tokensToCheck = [entries[0]!.token];
      attributed = true;
    } else {
      // Multi-quantity and the proposed value is not in the message text —
      // cannot attribute. Inspect all, but only a KNOWN-incompatible unit may
      // block (an unattributable unknown word is prose, not a dropped unit).
      tokensToCheck = entries.map((e) => e.token);
      attributed = false;
    }
  } else {
    tokensToCheck = [entries[entries.length - 1]!.token];
    attributed = true;
  }

  for (const token of tokensToCheck) {
    const cls = classifyToken(token, factorFamily);
    if (cls === 'incompatible') {
      return {
        resolved: false,
        reason: 'incompatible_unit',
        user_unit_family: unitFamilyOf(token ?? undefined) as UnitFamily,
        factor_unit_family: factorFamily,
      };
    }
    if (cls === 'unresolved' && attributed) {
      return {
        resolved: false,
        reason: 'unresolved_unit_token',
        factor_unit_family: factorFamily,
      };
    }
  }
  return { resolved: true };
}
