/**
 * V5 P0.2 — prior/current run comparison (Test 3: "what changed?").
 *
 * Pure, content-safe diff of the two most recent successful run_analysis
 * facts. No telemetry, no user-facing copy, no IDs — the routing gate
 * (`run-comparison-gate.ts`) owns the text. Reuses the canonical
 * `isSuccessfulRunAnalysisFact` predicate so this layer agrees with the
 * freshness/projection layers on what counts as "a run".
 *
 * Privacy: output carries only option/factor labels (which the user
 * already sees in the analysis), closed-enum directions, and integer
 * percentage points. No raw 0.xx decimals, no node/edge IDs.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  compactAnalysis,
  type AnalysisResponseSummary,
} from '../../orchestrator/context/analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import { isSuccessfulRunAnalysisFact } from '../context/freshness.js';

export type MarginDirection =
  | 'widened'
  | 'narrowed'
  | 'unchanged'
  | 'unavailable';

export interface DriverRankChange {
  readonly factor_label: string;
  /** 1-based rank in the prior run (by absolute influence). */
  readonly from_rank: number;
  /** 1-based rank in the current run. */
  readonly to_rank: number;
}

export interface RunDelta {
  /** True when both runs have a usable leading-option label. */
  readonly comparable: boolean;
  readonly leading_option_changed: boolean;
  readonly prior_leading_label: string;
  readonly current_leading_label: string;
  readonly margin_direction: MarginDirection;
  /** Integer percentage points (current − prior). 0 when unavailable. */
  readonly margin_shift_pp: number;
  /** Up to 3 drivers whose influence rank moved, largest mover first. */
  readonly driver_rank_changes: readonly DriverRankChange[];
  readonly robustness_changed: boolean;
  /** Canonical robustness level of the prior run, or 'unknown'. */
  readonly prior_band: string;
  readonly current_band: string;
}

export interface RunPair {
  /** The older of the two runs (second-newest). */
  readonly prior: HandlerFact;
  /** The most recent run. */
  readonly current: HandlerFact;
}

/**
 * Select the two newest successful run_analysis facts.
 *
 * `prior_facts` arrives newest-first (the build-turn-context loader
 * convention that `selectRunAnalysisFact` relies on for ties), so a
 * stable filter preserves that order: index 0 is the current run, index
 * 1 the prior. Returns null when fewer than two successful runs exist.
 */
export function selectTwoNewestRunAnalysisFacts(
  priorFacts: readonly HandlerFact[],
): RunPair | null {
  const successful = priorFacts.filter(isSuccessfulRunAnalysisFact);
  if (successful.length < 2) return null;
  return { current: successful[0]!, prior: successful[1]! };
}

/**
 * Project a run_analysis fact's PLoT envelope (`result.enrichment`) into
 * the compact analysis summary the comparator diffs. Returns null when
 * the envelope is missing or compaction rejects it (blocked/failed).
 */
export function projectRunFact(
  fact: HandlerFact,
): AnalysisResponseSummary | null {
  const result = (fact as { result?: { enrichment?: unknown } }).result;
  const enrichment = result?.enrichment;
  if (!enrichment) return null;
  return compactAnalysis(enrichment as V2RunResponseEnvelope);
}

function normaliseLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** A margin move smaller than this (in pp) reads as "unchanged". */
const MARGIN_EPSILON_PP = 0.5;

function deriveMargin(
  priorPp: number | null,
  currentPp: number | null,
): { direction: MarginDirection; shift: number } {
  if (priorPp === null || currentPp === null) {
    return { direction: 'unavailable', shift: 0 };
  }
  const rawDelta = currentPp - priorPp;
  const shift = Math.round(rawDelta);
  if (rawDelta > MARGIN_EPSILON_PP) return { direction: 'widened', shift };
  if (rawDelta < -MARGIN_EPSILON_PP) return { direction: 'narrowed', shift };
  return { direction: 'unchanged', shift };
}

function deriveDriverRankChanges(
  prior: AnalysisResponseSummary,
  current: AnalysisResponseSummary,
): DriverRankChange[] {
  // rank = 1-based index in top_drivers (already sorted by |sensitivity|
  // descending in compactAnalysis).
  const priorRank = new Map<string, number>();
  prior.top_drivers.forEach((d, i) => {
    priorRank.set(normaliseLabel(d.factor_label), i + 1);
  });

  const changes: DriverRankChange[] = [];
  current.top_drivers.forEach((d, i) => {
    const before = priorRank.get(normaliseLabel(d.factor_label));
    if (before === undefined) return; // new entrant — not a rank "change"
    const toRank = i + 1;
    if (before !== toRank) {
      changes.push({
        factor_label: d.factor_label,
        from_rank: before,
        to_rank: toRank,
      });
    }
  });

  // Largest rank movement first; deterministic label tiebreak. Top 3.
  return changes
    .sort((a, b) => {
      const am = Math.abs(a.to_rank - a.from_rank);
      const bm = Math.abs(b.to_rank - b.from_rank);
      if (bm !== am) return bm - am;
      return normaliseLabel(a.factor_label).localeCompare(
        normaliseLabel(b.factor_label),
      );
    })
    .slice(0, 3);
}

/**
 * Diff two projected run summaries. `prior` is the older run, `current`
 * the newer. Pure and content-safe (see module header).
 */
export function compareRuns(
  prior: AnalysisResponseSummary,
  current: AnalysisResponseSummary,
): RunDelta {
  const priorLabel = prior.winner.option_label.trim();
  const currentLabel = current.winner.option_label.trim();
  const comparable = priorLabel.length > 0 && currentLabel.length > 0;

  const { direction, shift } = deriveMargin(prior.margin_pp, current.margin_pp);

  const priorBand = prior.robustness_level || 'unknown';
  const currentBand = current.robustness_level || 'unknown';
  const robustnessChanged =
    priorBand !== 'unknown' &&
    currentBand !== 'unknown' &&
    priorBand !== currentBand;

  return {
    comparable,
    leading_option_changed:
      comparable && normaliseLabel(priorLabel) !== normaliseLabel(currentLabel),
    prior_leading_label: priorLabel,
    current_leading_label: currentLabel,
    margin_direction: direction,
    margin_shift_pp: shift,
    driver_rank_changes: deriveDriverRankChanges(prior, current),
    robustness_changed: robustnessChanged,
    prior_band: priorBand,
    current_band: currentBand,
  };
}
