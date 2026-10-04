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
 * Text for a probability that is strictly inside `(0, 1)` but which
 * whole-percent rounding would render as a certainty.
 *
 * `<1%` is not invented here — it is this estate's existing house form for a
 * sub-one-percent probability. `coaching/analysis-result-headline.ts:184-186`
 * declares `ELIMINATED_WIN_PROBABILITY_CEILING = 0.01` under the comment
 * 'Mirrors the mission wording "<1% win probability"', and its `:197` note
 * records that an INTEGER percentage is used there specifically so the
 * defence-in-depth raw-decimal rule holds. `>99%` is that form's arithmetic
 * mirror at the other end of the range.
 *
 * Both tokens are safe against the guards that read our own prose:
 *   - `RAW_DECIMAL_RE` (`compose/forbidden-user-facing-phrases.ts:340`) matches
 *     LEADING-decimal form only (`0.9`, `.9`) — neither token contains one.
 *   - every pattern in `LEADER_CLAIM_PATTERNS`
 *     (`compose/leading-option-egress-guard.ts:82+`) is LEXICAL (`leads`,
 *     `winner`, `performs best`, `ahead by`, …), never numeric, so a leak
 *     detector cannot lose sensitivity because the figure beside the claim
 *     changed shape.
 */
const NEARLY_CERTAIN = '>99%';
const NEARLY_IMPOSSIBLE = '<1%';

/**
 * Format a probability (a number expected in `[0, 1]`).
 *
 *   formatProbability(0.964)            // "96%"
 *   formatProbability(0.9991)           // ">99%"  (NOT "100%" — see below)
 *   formatProbability(0.0009)           // "<1%"   (NOT "0%"   — see below)
 *   formatProbability(1)                // "100%"
 *   formatProbability(0)                // "0%"
 *   formatProbability(0.964, 'debug')   // "0.964"
 *   formatProbability(NaN)              // "Not available" + ProbabilityOutOfRange
 *   formatProbability(1.5)              // "Not available" + ProbabilityOutOfRange
 *
 * `display` mode rounds half-to-even via `Math.round` (acceptable for
 * coarse display; we do not need bankers' rounding for whole-percent
 * targets). `debug` mode preserves the underlying value with three-digit
 * precision when the value has decimals; integers pass through.
 *
 * ⚠ ROADMAP 2.229 slice 3 — ROUNDING MAY NOT MANUFACTURE CERTAINTY.
 *
 * "100%" and "0%" are not rounded values to a reader; they are CLAIMS —
 * that an outcome is guaranteed, and that another is impossible. Plain
 * `Math.round(value * 100)` makes both claims on our behalf for any value
 * within half a percentage point of the ends of the range.
 *
 * Measured on the deployed build `335a938`: ISL computed `win_probabilities`
 * of `0.9991` / `0.0009` and the deterministic post-analysis composer emitted
 * "…with a probability of 100%" and "…with a probability of 0%"
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/coaching-surface-2026-08-12/`,
 * `drive-20260813/raw-T3_ANALYSE.json` for the computed pair,
 * `raw-Q4_METHOD.json` for the emitted prose). A ~1-in-1,100 live possibility
 * was reported to the user as impossible.
 *
 * The rule is stated over the whole domain rather than over a threshold, so
 * there is no constant here to drift out of step with the rounding above: a
 * value that is not EXACTLY 1 never reads as "100%", and a value that is not
 * EXACTLY 0 never reads as "0%". Genuine certainties are unaffected — the
 * honest 1 and the honest 0 still render as themselves, because suppressing
 * those would be a different and equally untruthful product.
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
  const whole = Math.round(value * 100);
  // Certainty is a claim, not a rounding — see the note on this function.
  // Keyed off the RENDERED result rather than off a threshold constant, so
  // this cannot drift out of step with the rounding on the line above: the
  // question asked is exactly "did rounding just assert something the value
  // does not support?".
  if (whole >= 100 && value !== 1) return NEARLY_CERTAIN;
  if (whole <= 0 && value !== 0) return NEARLY_IMPOSSIBLE;
  return `${whole}%`;
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
  // Singular "1 percentage point" reads correctly; everything else
  // (including 0 and -1) takes the plural.
  const noun = Math.abs(rounded) === 1 ? 'percentage point' : 'percentage points';
  return `${rounded} ${noun}`;
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
