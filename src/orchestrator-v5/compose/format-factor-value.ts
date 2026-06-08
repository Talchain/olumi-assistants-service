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
 * Render an underscored machine unit as human words: `story_points` →
 * `story points`. Case is preserved. Recognised symbol/percent/time units
 * never carry underscores, so this only affects the free-text-unit branch.
 */
function humaniseUnit(unit: string): string {
  return unit.replace(/_/g, ' ');
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

  // Any other explicit unit (engineers, people, units, story_points, …).
  // Underscored machine units render with spaces.
  if (raw.length > 0) {
    return { display: `${value} ${singularise(humaniseUnit(raw), value)}`, value };
  }

  // No unit: a plain integer is safe; bare decimals were already skipped.
  return { display: `${value}`, value };
}

/** Round to one decimal place — the readable-approximate display precision. */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Stringify a one-decimal-place value, dropping a trailing `.0` and (optionally)
 * grouping thousands. `rounded` is assumed already 1-dp.
 */
function approxNumberString(rounded: number, group: boolean): string {
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const intPart = Math.trunc(abs);
  const tenths = Math.round((abs - intPart) * 10); // 0–9 (abs is already 1-dp)
  const intStr = group ? thousands(intPart) : `${intPart}`;
  return sign + intStr + (tenths > 0 ? `.${tenths}` : '');
}

export interface ApproxFactorValue {
  /** Readable display string, e.g. "6.1 story points", "£20,000". */
  readonly display: string;
  /** The 1-dp rounded number shown — NOT necessarily what gets executed. */
  readonly rounded: number;
  /**
   * True when `rounded` differs from the exact input. The caller MUST prefix
   * "around" (honest-approximate wording) and store the EXACT input value in
   * the action payload so display === meaning while the executed value stays
   * the precise scientific threshold.
   */
  readonly approximate: boolean;
}

/**
 * DISPLAY-scale formatter for chip copy. The input is ALREADY a user-unit value
 * (PLoT `value_scale: "display"`), so — unlike {@link formatFactorValue} — this
 * MAY round to one decimal place for readability. It NEVER mutates the value the
 * caller executes; it only produces the string shown to the user plus the
 * `approximate` flag that forces honest "around …" wording.
 *
 * Returns null for shapes we cannot present safely: non-finite, a value that
 * rounds to 0 (no useful "test at" threshold), a percentage outside 0–100, or a
 * bare fractional value with no unit (which would read as a raw normalised
 * decimal). Mirrors {@link formatFactorValue}'s unit-awareness.
 */
export function formatFactorValueApprox(
  value: number,
  unit?: string | null,
): ApproxFactorValue | null {
  if (!Number.isFinite(value)) return null;
  const rounded = roundToTenth(value);
  if (rounded === 0) return null; // 0 carries no useful "test at" value
  const approximate = rounded !== value;

  const raw = (unit ?? '').trim();
  const u = raw.toLowerCase();

  if (PERCENT_UNITS.has(u)) {
    if (rounded < 0 || rounded > 100) return null;
    return { display: `${approxNumberString(rounded, false)}%`, rounded, approximate };
  }

  const symbol = CURRENCY_SYMBOL[u];
  if (symbol) {
    return { display: `${symbol}${approxNumberString(rounded, true)}`, rounded, approximate };
  }

  if (TIME_UNITS.has(u)) {
    return {
      display: `${approxNumberString(rounded, false)} ${singularise(u, rounded)}`,
      rounded,
      approximate,
    };
  }

  if (raw.length > 0) {
    return {
      display: `${approxNumberString(rounded, false)} ${singularise(humaniseUnit(raw), rounded)}`,
      rounded,
      approximate,
    };
  }

  // No unit: only a plain integer is safe; a bare fractional value could be
  // mistaken for a raw normalised decimal, so SKIP rather than show it.
  if (Number.isInteger(rounded)) {
    return { display: `${rounded}`, rounded, approximate };
  }
  return null;
}
