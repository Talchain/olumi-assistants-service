/**
 * V5 P0.2 — conservative unit-aware display formatter for a factor's
 * USER-SCALE (raw) value.
 *
 * Used by the flip-threshold proposal producer (`flip-proposal.ts`). It
 * is safety-critical: the value shown to the user (and replayed into the
 * `set_factor_value` proposal) must NEVER be a raw normalised decimal
 * (e.g. "0.62"). We render ONLY the shapes we can present cleanly:
 *   - percentage  ("30%")
 *   - currency    ("£50,000")
 *   - time        ("12 months")
 *   - other explicit unit ("20 engineers")
 *   - plain unitless integer ("30")
 *
 * Anything else — a bare sub-1 decimal, a fractional value under an
 * unrecognised unit, a non-finite number — returns `null` so the caller
 * SKIPS the proposal rather than improvising (the approved hard rule).
 *
 * The returned `value` is the rounded number the user sees; the caller
 * replays the SAME rounded value into the proposal so display === what
 * gets executed.
 */

const PERCENT_UNITS = new Set(['%', 'percent', 'percentage', 'pct']);
const CURRENCY_SYMBOL: Record<string, string> = {
  '£': '£',
  $: '$',
  '€': '€',
  gbp: '£',
  usd: '$',
  eur: '€',
};
const TIME_UNITS = new Set([
  'hour', 'hours', 'day', 'days', 'week', 'weeks',
  'month', 'months', 'quarter', 'quarters', 'year', 'years',
]);

export interface FormattedFactorValue {
  /** User-facing display string (e.g. "20 engineers", "£50,000", "30%"). */
  readonly display: string;
  /** The rounded numeric value the display represents — replay this. */
  readonly value: number;
}

/** Deterministic thousands separator (avoids locale-dependent toLocaleString). */
function thousands(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(n).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function singularise(unit: string, n: number): string {
  if (n === 1 && unit.endsWith('s')) return unit.slice(0, -1);
  return unit;
}

/**
 * Render a user-scale value + optional unit, or null when it cannot be
 * rendered without leaking a raw decimal. Sub-1 values are only allowed
 * for the plain-integer case (which excludes them), so no `0.xx` ever
 * reaches the user.
 */
export function formatFactorValue(
  value: number,
  unit?: string | null,
): FormattedFactorValue | null {
  if (!Number.isFinite(value)) return null;
  // EXACT-only (P0.2 guardrail): display === executed value, and we never
  // round-and-execute. If the user-scale value is not a whole number we
  // SKIP rather than round it for display, because the rounded value would
  // diverge from what gets stored. (This is deliberately conservative and
  // makes the producer sparse — correctness over coverage.)
  if (!Number.isInteger(value)) return null;
  if (Math.abs(value) < 1) return null; // 0 carries no useful "test at" value

  const raw = (unit ?? '').trim();
  const u = raw.toLowerCase();

  // Percentage: 0–100 scale. >100 is nonsensical.
  if (PERCENT_UNITS.has(u)) {
    if (value > 100) return null;
    return { display: `${value}%`, value };
  }

  // Currency.
  const symbol = CURRENCY_SYMBOL[u];
  if (symbol) {
    return { display: `${symbol}${thousands(value)}`, value };
  }

  // Time units.
  if (TIME_UNITS.has(u)) {
    return { display: `${value} ${singularise(u, value)}`, value };
  }

  // Any other explicit unit (engineers, people, units, …).
  if (raw.length > 0) {
    return { display: `${value} ${singularise(raw, value)}`, value };
  }

  // No unit: a plain integer is safe; bare decimals were already skipped.
  return { display: `${value}`, value };
}
