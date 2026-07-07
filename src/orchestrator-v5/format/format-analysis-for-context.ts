/**
 * Display-safe analysis projection for the LLM-facing context pack
 * (brief brief-display-safe-analysis A2 v2).
 *
 * Design principle: raw model values stay in structured state for
 * handlers, telemetry, signals, and chip generation; the LLM-facing
 * context pack uses decision-language projections only. Sonnet never
 * sees raw probability decimals (`0.862`), raw signed sensitivities
 * (`-0.40`), or internal coefficients (`strength.mean`). Without raw
 * floats in the prompt, Sonnet naturally speaks in percentages and
 * influence bands rather than echoing internal numerics.
 *
 * This formatter operates strictly downstream of `projectAnalysis()` —
 * the raw `ContextPackAnalysis` is preserved for handler-side reads
 * (coaching signals, chip generator, projection summaries, run-analysis
 * fallbacks). Only the prompt-serialised view is transformed.
 *
 * Pure function. No side effects. Idempotency note: feeding raw
 * `ContextPackAnalysis` through twice produces the same `DisplaySafeAnalysis`
 * (the function does not accept its own output as input).
 */

import type {
  ContextPackAnalysis,
  ContextPackAnalysisDriver,
  ContextPackAnalysisEvidenceGap,
  ContextPackAnalysisFlipThreshold,
  ContextPackAnalysisFragileEdge,
} from '../context/context-pack-assembler.js';
import { formatPercentagePoints, formatProbability } from './format-analysis-value.js';
import { bandFromMagnitude, NEAR_ZERO_INFLUENCE_THRESHOLD } from './influence-bands.js';

export interface DisplaySafeAnalysisOption {
  readonly label: string;
  /** Integer-percent string, e.g. `"86%"`. Never a raw decimal. */
  readonly win_probability: string;
}

/**
 * Lane 21 (P0-A) — one entry of the full ranked option list. `rank` is a
 * string ("1", "2", …) to preserve the structural no-numbers-anywhere
 * invariant of the display-safe projection; array order matches rank.
 */
export interface DisplaySafeRankedOption {
  readonly rank: string;
  readonly label: string;
  /** Integer-percent string, e.g. `"72%"`. Never a raw decimal. */
  readonly win_probability: string;
}

/** Lane 21 — banded tipping-risk entry. `risk` is decision-language prose. */
export interface DisplaySafeTippingPoint {
  readonly label: string;
  readonly risk: string;
}

/** Lane 21 — banded value-of-information entry (influence-band vocabulary). */
export interface DisplaySafeEvidenceGap {
  readonly label: string;
  readonly value_of_information: string;
}

/**
 * Lane 21 — LLM-facing char budget for the serialised (2-space-indented)
 * display-safe analysis projection. The pre-widening projection measured
 * ~603 chars and starved the LLM; breadth-first widening must still stay
 * bounded so the ~21k-char routing prompt keeps its shape. Asserted by
 * the maximal-fixture budget test.
 */
export const DISPLAY_ANALYSIS_CHAR_BUDGET = 4000;

/**
 * Relative-distance thresholds for the tipping-risk band phrases
 * (presentation bands, not science): |flip − current| / |current|
 * below `small` reads as a small shift, below `moderate` as a moderate
 * shift, else a large shift.
 */
export const FLIP_PROXIMITY_BANDS = {
  small: 0.1,
  moderate: 0.35,
} as const;

export interface DisplaySafeAnalysisDriver {
  readonly label: string;
  /** Decision-language phrase, e.g. `"very strong positive influence"`,
   *  `"moderate negative influence"`, or `"no material influence"` for
   *  near-zero sensitivities where sign is not meaningful. */
  readonly influence: string;
}

export interface DisplaySafeFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

export interface DisplaySafeAnalysis {
  readonly status: string;
  readonly leading_option?: DisplaySafeAnalysisOption;
  readonly runner_up?: DisplaySafeAnalysisOption;
  /** Phrase like `"7 percentage points"`. Omitted when 0 / unavailable. */
  readonly margin?: string;
  readonly robustness_band?: string;
  readonly top_drivers?: readonly DisplaySafeAnalysisDriver[];
  /** Labels only — no `exists_probability`, no `strength`. */
  readonly fragile_edges?: readonly DisplaySafeFragileEdge[];
  /**
   * Lane 21 (P0-A) breadth fields. All optional, all omitted (never null /
   * never empty-array) when the raw source is missing or empty:
   *
   *  - `options`: EVERY option, ranked, integer-percent probability.
   *  - `tipping_points`: banded flip-risk phrases (never raw thresholds).
   *  - `fragile_edge_count`: string count behind the capped edge list.
   *  - `value_of_information`: banded VOI per evidence-gap factor
   *    (influence-band vocabulary; near-zero entries dropped).
   *  - `goal_fit`: prose stating THAT goal fit was scored and its basis.
   */
  readonly options?: readonly DisplaySafeRankedOption[];
  readonly tipping_points?: readonly DisplaySafeTippingPoint[];
  readonly fragile_edge_count?: string;
  readonly value_of_information?: readonly DisplaySafeEvidenceGap[];
  readonly goal_fit?: string;
}

/**
 * Convert a signed sensitivity into the user-visible influence phrase.
 *
 *   1.0  → "very strong positive influence"
 *   0.5  → "moderate positive influence"
 *  -0.4  → "moderate negative influence"
 *   0.02 → "no material influence"   (sign suppressed below NEAR_ZERO_INFLUENCE_THRESHOLD)
 */
export function influencePhrase(signedSensitivity: number): string {
  if (!Number.isFinite(signedSensitivity)) return 'no material influence';
  const abs = Math.abs(signedSensitivity);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return 'no material influence';
  const band = bandFromMagnitude(abs);
  const sign = signedSensitivity < 0 ? 'negative' : 'positive';
  return `${band} ${sign} influence`;
}

function formatDriver(driver: ContextPackAnalysisDriver): DisplaySafeAnalysisDriver {
  return {
    label: driver.factor_label,
    influence: influencePhrase(driver.sensitivity_value),
  };
}

function formatOption(label: string, probability: number): DisplaySafeAnalysisOption {
  return { label, win_probability: formatProbability(probability, 'display') };
}

/**
 * Lane 21 — banded tipping-risk phrase (doctrine A2: the LLM never sees the
 * raw current/flip values).
 *
 *   tippingRiskPhrase(100, 88, false)
 *     → "a moderate decrease could flip the result"     (12% relative shift)
 *   tippingRiskPhrase(0.3, 0.297, false)
 *     → "close to a tipping point — a small decrease could flip the result"
 *   tippingRiskPhrase(10, 20, false)
 *     → "only a large increase would flip the result"
 *   tippingRiskPhrase(0, 5, false)
 *     → "an increase in this factor could flip the result"  (relative
 *        distance undefined at current = 0 — direction only, no band)
 *   tippingRiskPhrase(null, null, true)
 *     → "no flip point found within the tested range"       (producer-attested)
 *
 * Returns null when nothing can be said safely (no flip pair, no attested
 * no-flip) — the caller omits the entry rather than fabricating a claim.
 */
export function tippingRiskPhrase(
  currentValue: number | null,
  flipValue: number | null,
  noFlipWithinBounds: boolean,
): string | null {
  if (noFlipWithinBounds) return 'no flip point found within the tested range';
  if (
    typeof currentValue !== 'number' ||
    !Number.isFinite(currentValue) ||
    typeof flipValue !== 'number' ||
    !Number.isFinite(flipValue)
  ) {
    return null;
  }
  const direction = flipValue >= currentValue ? 'increase' : 'decrease';
  if (currentValue === 0) {
    // Relative distance undefined — direction only, no proximity band.
    return `an ${direction} in this factor could flip the result`;
  }
  const relative = Math.abs(flipValue - currentValue) / Math.abs(currentValue);
  if (relative < FLIP_PROXIMITY_BANDS.small) {
    return `close to a tipping point — a small ${direction} could flip the result`;
  }
  if (relative < FLIP_PROXIMITY_BANDS.moderate) {
    return `a moderate ${direction} could flip the result`;
  }
  return `only a large ${direction} would flip the result`;
}

/**
 * Lane 21 — band a normalised [0,1] value-of-information score using the
 * SHARED influence-band vocabulary (single source of truth:
 * `./influence-bands.ts`). Near-zero scores return null so the caller drops
 * the entry instead of rendering noise; non-finite scores return null.
 */
export function voiBandPhrase(voiScore: number): string | null {
  if (!Number.isFinite(voiScore)) return null;
  const abs = Math.abs(voiScore);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return null;
  return bandFromMagnitude(abs);
}

const GOAL_FIT_BASIS_PHRASES: Readonly<Record<string, string>> = {
  modelled_outcome_distribution: 'goal fit was scored from the modelled outcome distribution',
};

/**
 * Lane 21 — goal-fit provenance prose (PLoT #204). States THAT goal fit was
 * scored and its basis; never values. Unknown basis tokens are humanised
 * (underscores → spaces) rather than echoed raw.
 */
function goalFitPhrase(goalFit: { scored: boolean; basis: string | null }): string | null {
  if (!goalFit.scored) return null;
  if (goalFit.basis === null) return 'goal fit was scored';
  return (
    GOAL_FIT_BASIS_PHRASES[goalFit.basis] ??
    `goal fit was scored from ${goalFit.basis.replace(/_/g, ' ')}`
  );
}

function formatTippingPoint(
  entry: ContextPackAnalysisFlipThreshold,
): DisplaySafeTippingPoint | null {
  const risk = tippingRiskPhrase(
    entry.current_value,
    entry.flip_value,
    entry.no_flip_within_bounds,
  );
  if (risk === null) return null;
  return { label: entry.factor_label, risk };
}

function formatEvidenceGap(
  entry: ContextPackAnalysisEvidenceGap,
): DisplaySafeEvidenceGap | null {
  const band = voiBandPhrase(entry.voi_score);
  if (band === null) return null;
  return { label: entry.factor_label, value_of_information: band };
}

/**
 * Project the raw `ContextPackAnalysis` into the display-safe shape
 * sent to Sonnet. The structured `{from_label, to_label}` fragile-edge
 * pair lives directly on `ContextPackAnalysis.fragile_edges`, so this
 * function takes a single argument and there is no foot-gun where a
 * caller forgets the second source and silently drops fragile edges.
 *
 * Returns null when the raw analysis is null. Omits (does not emit
 * `null`) optional fields whose source is missing/empty.
 */
export function formatAnalysisForContext(
  raw: ContextPackAnalysis | null,
): DisplaySafeAnalysis | null {
  if (raw === null) return null;

  const out: {
    status: string;
    leading_option?: DisplaySafeAnalysisOption;
    runner_up?: DisplaySafeAnalysisOption;
    margin?: string;
    robustness_band?: string;
    top_drivers?: readonly DisplaySafeAnalysisDriver[];
    fragile_edges?: readonly DisplaySafeFragileEdge[];
    options?: readonly DisplaySafeRankedOption[];
    tipping_points?: readonly DisplaySafeTippingPoint[];
    fragile_edge_count?: string;
    value_of_information?: readonly DisplaySafeEvidenceGap[];
    goal_fit?: string;
  } = {
    status: raw.status,
  };

  if (raw.leading_option) {
    out.leading_option = formatOption(raw.leading_option.label, raw.leading_option.probability);
  }
  if (raw.runner_up) {
    out.runner_up = formatOption(raw.runner_up.label, raw.runner_up.probability);
  }

  // margin_pp arrives upstream pre-scaled to percentage points
  // (compactAnalysis stores `margin × 1000 / 10`). Use the shared
  // `formatPercentagePoints` formatter for consistency with the rest of
  // the analysis-display surface (handles singular `1 percentage point`
  // correctly via the formatter, plus invalid-value telemetry). 0 is
  // omitted because "0 percentage points" reads as a pseudo-tie.
  if (typeof raw.margin_pp === 'number' && Number.isFinite(raw.margin_pp)) {
    const rounded = Math.round(raw.margin_pp);
    if (rounded !== 0) {
      out.margin = formatPercentagePoints(raw.margin_pp, 'prose', { field_path: 'analysis.margin' });
    }
  }

  if (raw.robustness_band) {
    out.robustness_band = raw.robustness_band;
  }

  if (raw.top_drivers.length > 0) {
    out.top_drivers = raw.top_drivers.map(formatDriver);
  }

  if (raw.fragile_edges.length > 0) {
    out.fragile_edges = raw.fragile_edges.map(
      (e: ContextPackAnalysisFragileEdge) => ({
        from_label: e.from_label,
        to_label: e.to_label,
      }),
    );
  }

  // Lane 21 (P0-A) breadth fields — every field below follows the file's
  // omission semantics (absent, never null / empty).

  // Full ranked option list. The raw projection arrives sorted by win
  // probability descending and bounded (MAX_PROJECTED_OPTIONS); rank is a
  // string so no raw number ever enters the display projection.
  const rawOptions = raw.options ?? [];
  if (rawOptions.length > 0) {
    out.options = rawOptions.map((o, i) => ({
      rank: String(i + 1),
      label: o.label,
      win_probability: formatProbability(o.probability, 'display'),
    }));
  }

  // Banded tipping risks. Entries with nothing safe to say are dropped by
  // the formatter (null risk), never fabricated.
  const tipping = (raw.flip_thresholds ?? [])
    .map(formatTippingPoint)
    .filter((t): t is DisplaySafeTippingPoint => t !== null);
  if (tipping.length > 0) {
    out.tipping_points = tipping;
  }

  // Uncapped fragile-edge count as a string (no-numbers invariant). Only
  // rendered when there is something to count.
  if (
    typeof raw.fragile_edge_count === 'number' &&
    Number.isFinite(raw.fragile_edge_count) &&
    raw.fragile_edge_count > 0
  ) {
    out.fragile_edge_count = String(raw.fragile_edge_count);
  }

  // Banded VOI per evidence-gap factor (shared influence-band vocabulary);
  // near-zero entries dropped as noise.
  const gaps = (raw.evidence_gaps ?? [])
    .map(formatEvidenceGap)
    .filter((g): g is DisplaySafeEvidenceGap => g !== null);
  if (gaps.length > 0) {
    out.value_of_information = gaps;
  }

  // Goal-fit provenance prose (fact + basis, never values).
  if (raw.goal_fit) {
    const phrase = goalFitPhrase(raw.goal_fit);
    if (phrase !== null) {
      out.goal_fit = phrase;
    }
  }

  return out;
}
