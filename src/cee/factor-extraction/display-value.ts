/**
 * Display Value Synthesis
 *
 * Pure, deterministic helpers that build human-readable value strings from
 * factor numeric data when the LLM has not provided a `display_value`.
 *
 * Two exported functions:
 *
 * - `synthesiseDisplayValue` — single point-estimate for controllable /
 *   observable factors (e.g. `"£500k"`, `"3%"`, `"42 days"`, `"Low (0.15)"`).
 *
 * - `synthesiseRangeDisplayValue` — range string for external factors whose
 *   numeric state is captured as a `prior` distribution
 *   (e.g. `"£200k to £500k"`, `"10% to 25%"`, `"Up to £500k"`).
 *
 * These functions must never throw. If the input is insufficient to produce a
 * meaningful string they return `undefined` so callers can omit the field.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Input to `synthesiseDisplayValue`.
 * All fields are optional — the function degrades gracefully.
 */
export interface DisplayValueInput {
  /** Normalised numeric value (0–1 or 0–100 range) */
  value?: number;
  /** Pre-normalisation numeric value (e.g. 500000 for £500k) */
  raw_value?: number;
  /** Unit string from LLM/enricher (e.g. "£", "$", "%", "days", "months") */
  unit?: string;
  /** Factor type classification */
  factor_type?: string;
  /** Normalisation cap (e.g. 1000000 for "up to £1m") */
  cap?: number;
}

/**
 * Input to `synthesiseRangeDisplayValue`.
 */
export interface RangeDisplayValueInput {
  /** Lower bound of the prior distribution (pre-normalisation raw value) */
  range_min?: number;
  /** Upper bound of the prior distribution (pre-normalisation raw value) */
  range_max?: number;
  /** Distribution type (unused for formatting, present for future use) */
  distribution?: string;
}

// ============================================================================
// Currency Symbols
// ============================================================================

const CURRENCY_SYMBOLS = new Set(["£", "$", "€", "¥", "₹", "GBP", "USD", "EUR"]);

/**
 * Return the display prefix for a currency unit (e.g. "GBP" → "£").
 * Returns `undefined` if the unit is not a recognised currency.
 */
function currencyPrefix(unit: string): string | undefined {
  if (unit === "£" || unit === "GBP") return "£";
  if (unit === "$" || unit === "USD") return "$";
  if (unit === "€" || unit === "EUR") return "€";
  if (unit === "¥") return "¥";
  if (unit === "₹") return "₹";
  return undefined;
}

function isCurrencyUnit(unit: string | undefined): boolean {
  if (!unit) return false;
  return CURRENCY_SYMBOLS.has(unit) || unit === "GBP" || unit === "USD" || unit === "EUR";
}

// ============================================================================
// Number Formatting
// ============================================================================

/**
 * Format a currency amount with `k` / `m` shorthand.
 * - 1,000 → "1k"    - 1,500 → "1.5k"
 * - 1,000,000 → "1m" - 1,250,000 → "1.25m"
 * - < 1,000 → integer or 1 d.p.
 * Handles negative values: -500000 → "-500k".
 */
function formatCurrencyAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}${m % 1 === 0 ? `${m}m` : `${parseFloat(m.toFixed(2))}m`}`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}${k % 1 === 0 ? `${k}k` : `${parseFloat(k.toFixed(1))}k`}`;
  }
  // Sub-thousand: show as integer or 1 d.p. if non-integer
  return abs % 1 === 0 ? `${sign}${abs}` : `${sign}${parseFloat(abs.toFixed(1))}`;
}

/**
 * Format a plain number with locale-style thousands separator (no currency
 * prefix). Rounds to at most 2 decimal places.
 */
function formatPlainNumber(n: number): string {
  if (Math.abs(n) >= 1_000) {
    // Whole number with thousands separators
    return n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  }
  // Small number — preserve meaningful precision, strip trailing zeros
  return String(parseFloat(n.toFixed(2)));
}

// ============================================================================
// Qualitative Band
// ============================================================================

/**
 * Map a normalised value (0–1) to a qualitative band label (title case).
 * Bands: 0–0.25 = Low, 0.25–0.5 = Moderate, 0.5–0.75 = High, 0.75–1 = Very high.
 *
 * Exported so orchestrator surfaces (response composer, chip engine) can
 * render a qualitative label for unitless 0–1 factors without reimplementing
 * the banding rule. Callers that want sentence case should call `.toLowerCase()`
 * on the result.
 */
export function qualitativeBand(value: number): string {
  if (value <= 0.25) return "Low";
  if (value <= 0.5) return "Moderate";
  if (value <= 0.75) return "High";
  return "Very high";
}

// ============================================================================
// synthesiseDisplayValue
// ============================================================================

/**
 * Synthesise a human-readable display string for a factor's current value.
 *
 * Priority order (first that produces a result wins):
 * 1. `raw_value` + currency `unit`  → `"£500k"`, `"$2.1m"`
 * 2. `raw_value` + percentage `unit` → `"3%"`
 * 3. `raw_value` + time `unit`       → `"42 days"`, `"18 months"`
 * 4. `raw_value` only                → `"500,000"` (thousands-separated)
 * 5. normalised `value` (0–1) + `factor_type` → `"Low (0.15)"` (qualitative band)
 * 6. normalised `value` only         → `"0.15"` (last resort)
 *
 * Returns `undefined` when there is no usable input.
 * Caps the output at 50 characters.
 *
 * @param data - Numeric factor data available at enrichment time
 * @returns Human-readable display string, or `undefined` if no data available
 */
export function synthesiseDisplayValue(data: DisplayValueInput): string | undefined {
  const { value, raw_value: rawValue, unit, factor_type: factorType } = data;

  let result: string | undefined;

  // ── Priority 1–4: raw_value is available ─────────────────────────────────
  if (rawValue !== undefined && typeof rawValue === "number" && !Number.isNaN(rawValue)) {
    const prefix = unit ? currencyPrefix(unit) : undefined;

    if (prefix) {
      // Priority 1: currency
      result = `${prefix}${formatCurrencyAmount(rawValue)}`;
    } else if (unit === "%") {
      // Priority 2: percentage — raw_value is already the display percentage
      const pct = parseFloat(rawValue.toFixed(2));
      result = `${pct}%`;
    } else if (unit && /^(?:days?|weeks?|months?|years?|hrs?|hours?)$/i.test(unit)) {
      // Priority 3: time unit
      const rounded = parseFloat(rawValue.toFixed(1));
      const display = rounded % 1 === 0 ? String(rounded | 0) : String(rounded);
      result = `${display} ${unit.toLowerCase()}`;
    } else if (unit) {
      // Other explicit unit
      const display = formatPlainNumber(rawValue);
      result = `${display} ${unit}`;
    } else {
      // Priority 4: no unit — plain number with thousands separators
      result = formatPlainNumber(rawValue);
    }
  }

  // ── Priority 5–7: fall back to normalised value ───────────────────────────
  if (result === undefined && value !== undefined && typeof value === "number" && !Number.isNaN(value)) {
    // Check for percentage unit with normalised value (e.g. value=0.03, unit="%")
    if (unit === "%") {
      // Normalised percentage: multiply by 100 if ≤ 1
      const pct = value <= 1 ? parseFloat((value * 100).toFixed(2)) : parseFloat(value.toFixed(2));
      result = `${pct}%`;
    } else if (unit) {
      // Priority 5: value with unit (e.g. "6 developers", "18 months").
      // Covers cases where data.value holds a raw count/quantity rather than
      // a 0-1 normalised score, and raw_value was not separately populated.
      const display = formatPlainNumber(value);
      result = `${display} ${unit}`;
    } else if (factorType) {
      // Priority 6: qualitative band from factor_type
      const band = qualitativeBand(Math.min(1, Math.max(0, value)));
      const displayValue = parseFloat(value.toFixed(2));
      result = `${band} (${displayValue})`;
    } else {
      // Priority 7: bare normalised value
      result = String(parseFloat(value.toFixed(2)));
    }
  }

  if (result === undefined) return undefined;

  // Cap at 50 characters
  return result.length > 50 ? result.slice(0, 50) : result;
}

// ============================================================================
// synthesiseRangeDisplayValue
// ============================================================================

/**
 * Synthesise a human-readable range string for an external factor's prior
 * distribution (e.g. `"£200k to £500k"`, `"10% to 25%"`, `"Up to £500k"`).
 *
 * Uses the same formatting conventions as `synthesiseDisplayValue` for each
 * individual bound.
 *
 * Fallbacks:
 * - Both bounds available → `"£200k to £500k"`
 * - Only `range_max`      → `"Up to £500k"`
 * - Only `range_min`      → `"At least £200k"`
 * - Neither bound but `distribution` present → `"Estimated (uncertain)"`
 * - No usable data         → `undefined`
 *
 * @param prior - Prior distribution data from the external factor node
 * @param unit - Unit string from the factor node
 * @param factorType - Factor type classification
 * @returns Human-readable range string, or `undefined` if no data available
 */
export function synthesiseRangeDisplayValue(
  prior: RangeDisplayValueInput,
  unit?: string,
  _factorType?: string,
): string | undefined {
  const { range_min: rangeMin, range_max: rangeMax, distribution } = prior;

  const hasMin = rangeMin !== undefined && typeof rangeMin === "number" && !Number.isNaN(rangeMin);
  const hasMax = rangeMax !== undefined && typeof rangeMax === "number" && !Number.isNaN(rangeMax);

  if (!hasMin && !hasMax) {
    // Fallback: distribution type present
    if (distribution) return "Estimated (uncertain)";
    return undefined;
  }

  /**
   * Format a single bound using the same logic as synthesiseDisplayValue
   * (currency prefix, % multiply, time unit, plain number).
   */
  function formatBound(n: number): string {
    const prefix = unit ? currencyPrefix(unit) : undefined;
    if (prefix) return `${prefix}${formatCurrencyAmount(n)}`;
    if (unit === "%") {
      // range_min/range_max are normalised (0–1) values; multiply by 100 for display.
      // For values outside 0–1 (e.g. already-display percentages like 25), use as-is.
      const pct = n >= 0 && n <= 1 ? parseFloat((n * 100).toFixed(2)) : parseFloat(n.toFixed(2));
      return `${pct}%`;
    }
    if (unit && /^(?:days?|weeks?|months?|years?|hrs?|hours?)$/i.test(unit)) {
      const rounded = parseFloat(n.toFixed(1));
      const display = rounded % 1 === 0 ? String(rounded | 0) : String(rounded);
      return `${display} ${unit.toLowerCase()}`;
    }
    if (unit) return `${formatPlainNumber(n)} ${unit}`;
    return formatPlainNumber(n);
  }

  let result: string;

  if (hasMin && hasMax) {
    // For time and plain-number units, format as "3 to 8 months" (unit once at end)
    // rather than "3 months to 8 months". Currency and % are prefix/suffix per-bound
    // so they always display both (e.g. "£200k to £500k", "10% to 25%").
    const isUnitPerBound = !unit || isCurrencyUnit(unit) || unit === "%";
    if (isUnitPerBound) {
      result = `${formatBound(rangeMin!)} to ${formatBound(rangeMax!)}`;
    } else {
      // Time and other suffix units: format number only for min, full for max
      const minNumeric = formatPlainNumber(rangeMin!);
      result = `${minNumeric} to ${formatBound(rangeMax!)}`;
    }
  } else if (hasMax) {
    result = `Up to ${formatBound(rangeMax!)}`;
  } else {
    result = `At least ${formatBound(rangeMin!)}`;
  }

  // Cap at 50 characters
  return result.length > 50 ? result.slice(0, 50) : result;
}
