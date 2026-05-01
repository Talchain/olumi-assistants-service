/**
 * Centralised display formatters for analysis numeric values (Phase 2 workstream C).
 *
 * Before Phase 2 the deterministic explain fallbacks ran every numeric
 * value through `String(value)`, producing user-facing prose like
 * "performs best, with a probability of 0.62" while chips elsewhere
 * read "62%". This module is the single source of truth for how
 * probabilities, percentage points and margins are rendered to users.
 *
 * Design rules:
 *   - Display mode targets users — round, append the unit, never leak
 *     raw decimals.
 *   - Debug mode targets ops surfaces (inspector, telemetry) — preserve
 *     the underlying value for reproducibility.
 *   - No silent clamping. A probability outside [0, 1] is a contract
 *     bug — return "Not available" and emit telemetry so ops can chase
 *     the upstream root cause. The numeric ingress guard at run-analysis
 *     (workstream E) already rejects NaN/Infinity, so the
 *     ProbabilityOutOfRange telemetry firing here is defence-in-depth.
 *   - Sentence-mode prose uses "percentage points" in full; chips and
 *     compact debug surfaces use "pp". Probabilities never use "pp".
 *
 * The format helpers are pure — they compute, format and (for invalid
 * inputs) emit a telemetry breadcrumb. They never throw.
 */

import { emit, TelemetryEvents } from '../../utils/telemetry.js';

export type FormatMode = 'display' | 'debug';
export type FormatSurface = 'prose' | 'compact';

const NOT_AVAILABLE = 'Not available';

interface OutOfRangeContext {
  /** Caller-supplied path used for telemetry only. Best-effort, defaults to "value". */
  readonly field_path?: string;
}

/**
 * Stable representation tag used for non-finite values in telemetry.
 * Matches the workstream E walker's `value_repr` so operators can
 * correlate ingress-rejection events with display-side defence events.
 */
function nonFiniteRepr(value: number): 'NaN' | 'Infinity' | '-Infinity' | null {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  return null;
}

function emitOutOfRange(
  field_path: string,
  value_kind: 'non_finite' | 'out_of_range',
  detail: string,
): void {
  emit(TelemetryEvents.ProbabilityOutOfRange, {
    field_path,
    value_kind,
    detail,
  });
}

/**
 * Format a probability (a number expected in `[0, 1]`).
 *
 *   formatProbability(0.964)            // "96%"
 *   formatProbability(0.964, 'debug')   // "0.964"
 *   formatProbability(NaN)              // "Not available" + ProbabilityOutOfRange
 *   formatProbability(1.5)              // "Not available" + ProbabilityOutOfRange
 *
 * `display` mode rounds half-to-even via `Math.round` (acceptable for
 * coarse display; we do not need bankers' rounding for whole-percent
 * targets). `debug` mode preserves the underlying value with three-digit
 * precision when the value has decimals; integers pass through.
 */
export function formatProbability(
  value: number,
  mode: FormatMode = 'display',
  ctx: OutOfRangeContext = {},
): string {
  const path = ctx.field_path ?? 'value';
  if (typeof value !== 'number') {
    emitOutOfRange(path, 'out_of_range', `non-number type ${typeof value}`);
    return NOT_AVAILABLE;
  }
  const repr = nonFiniteRepr(value);
  if (repr !== null) {
    emitOutOfRange(path, 'non_finite', repr);
    return NOT_AVAILABLE;
  }
  if (value < 0 || value > 1) {
    emitOutOfRange(path, 'out_of_range', String(value));
    return NOT_AVAILABLE;
  }
  if (mode === 'debug') {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(3);
  }
  return `${Math.round(value * 100)}%`;
}

/**
 * Format a value already on the percentage-points scale (e.g. a margin
 * already expressed as "24" meaning 24 percentage points).
 *
 *   formatPercentagePoints(24)              // "24 percentage points"
 *   formatPercentagePoints(24, 'compact')   // "24pp"
 *   formatPercentagePoints(NaN)             // "Not available"
 *
 * `prose` is the default — the surface that produces user-visible text.
 * `compact` targets chips and debug surfaces where the long phrase would
 * crowd the layout.
 */
export function formatPercentagePoints(
  value: number,
  surface: FormatSurface = 'prose',
  ctx: OutOfRangeContext = {},
): string {
  const path = ctx.field_path ?? 'value';
  if (typeof value !== 'number') {
    emitOutOfRange(path, 'out_of_range', `non-number type ${typeof value}`);
    return NOT_AVAILABLE;
  }
  const repr = nonFiniteRepr(value);
  if (repr !== null) {
    emitOutOfRange(path, 'non_finite', repr);
    return NOT_AVAILABLE;
  }
  // Negative pp values can occur in debug bundles ("how far behind") —
  // surface them as-is rather than rejecting.
  const rounded = Math.round(value);
  if (surface === 'compact') return `${rounded}pp`;
  return `${rounded} percentage points`;
}

/**
 * Format the gap between two probabilities as percentage points.
 *
 *   formatProbabilityMargin(0.62, 0.38)              // "24 percentage points"
 *   formatProbabilityMargin(0.62, 0.38, 'compact')   // "24pp"
 *
 * Returns "Not available" when either input is invalid; emits
 * ProbabilityOutOfRange for whichever input is the offender so ops can
 * trace upstream.
 */
export function formatProbabilityMargin(
  leader: number,
  runner: number,
  surface: FormatSurface = 'prose',
  ctx: OutOfRangeContext = {},
): string {
  const path = ctx.field_path ?? 'margin';
  for (const [name, v] of [
    ['leader', leader],
    ['runner', runner],
  ] as const) {
    if (typeof v !== 'number') {
      emitOutOfRange(`${path}.${name}`, 'out_of_range', `non-number type ${typeof v}`);
      return NOT_AVAILABLE;
    }
    const repr = nonFiniteRepr(v);
    if (repr !== null) {
      emitOutOfRange(`${path}.${name}`, 'non_finite', repr);
      return NOT_AVAILABLE;
    }
    if (v < 0 || v > 1) {
      emitOutOfRange(`${path}.${name}`, 'out_of_range', String(v));
      return NOT_AVAILABLE;
    }
  }
  const marginPp = (leader - runner) * 100;
  return formatPercentagePoints(marginPp, surface, { field_path: path });
}
