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
} from '../context/context-pack-assembler.js';
import type { FragileEdge } from '../../orchestrator/context/analysis-compact.js';
import { formatProbability } from './format-analysis-value.js';
import { bandFromMagnitude, NEAR_ZERO_INFLUENCE_THRESHOLD } from './influence-bands.js';

export interface DisplaySafeAnalysisOption {
  readonly label: string;
  /** Integer-percent string, e.g. `"86%"`. Never a raw decimal. */
  readonly win_probability: string;
}

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
 * Project the raw `ContextPackAnalysis` into the display-safe shape
 * sent to Sonnet. `fragileEdgesSource` is the upstream
 * `AnalysisResponseSummary.top_fragile_edges` array — passing it
 * directly preserves the structured `{from_label, to_label}` pair and
 * avoids string-splitting the legacy `"A → B"` join.
 *
 * Returns null when the raw analysis is null. Omits (does not emit
 * `null`) optional fields whose source is missing/empty.
 */
export function formatAnalysisForContext(
  raw: ContextPackAnalysis | null,
  fragileEdgesSource?: readonly FragileEdge[] | null,
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
  // (compactAnalysis stores `margin × 1000 / 10`). We round to whole
  // percentage points for prompt display; 0 is omitted because "0
  // percentage points" reads as a pseudo-tie.
  if (typeof raw.margin_pp === 'number' && Number.isFinite(raw.margin_pp)) {
    const rounded = Math.round(raw.margin_pp);
    if (rounded !== 0) {
      out.margin = `${rounded} percentage points`;
    }
  }

  if (raw.robustness_band) {
    out.robustness_band = raw.robustness_band;
  }

  if (raw.top_drivers.length > 0) {
    out.top_drivers = raw.top_drivers.map(formatDriver);
  }

  // Fragile edges: prefer the upstream structured `{from_label, to_label}`
  // pair. Drop numerics (exists_probability, strength) by construction.
  if (fragileEdgesSource && fragileEdgesSource.length > 0) {
    out.fragile_edges = fragileEdgesSource.map((e) => ({
      from_label: e.from_label,
      to_label: e.to_label,
    }));
  }

  return out;
}
