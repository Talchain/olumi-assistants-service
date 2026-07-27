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
import { winnerOptionResultSource } from '../../orchestrator/context/option-result-source.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import {
  orderSuccessfulRunAnalysisFactsNewestFirst,
  type FreshnessDerivation,
} from '../context/freshness.js';
import { partitionInterventionControlledDrivers } from '../context/intervention-controlled-drivers.js';

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

/**
 * On what evidence the leader-change verdict rests.
 *
 *   - `option_id`     — both runs' enrichments named their leading option by
 *                       id, so `leading_option_changed` is a real identity
 *                       comparison.
 *   - `indeterminate` — at least one run carried no `option_id` for its
 *                       leader (legacy enrichment). `leading_option_changed`
 *                       is then FORCED false: it is the "we cannot tell"
 *                       answer, not "we checked and it is the same option".
 *
 * Kept as a typed field rather than a comment so a test — or a future
 * telemetry field — can tell the two `false`s apart. An assertion that only
 * checks `leading_option_changed === false` cannot.
 */
export type LeaderIdentityBasis = 'option_id' | 'indeterminate';

export interface RunDelta {
  /** True when both runs have a usable leading-option label. */
  readonly comparable: boolean;
  readonly leading_option_changed: boolean;
  /** Evidence behind `leading_option_changed` — see {@link LeaderIdentityBasis}. */
  readonly leader_identity_basis: LeaderIdentityBasis;
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
 * ⭐ ORDERED BY THE CANONICAL SELECTOR, NOT BY ARRAY POSITION. This calls
 * {@link orderSuccessfulRunAnalysisFactsNewestFirst} — the very function
 * `selectRunAnalysisFact` takes its head from — so `pair.current` IS the fact
 * the turn's freshness verdict was derived from, for every window.
 *
 * ⚠ IT USED TO TAKE `filter(isSuccessfulRunAnalysisFact)[0]` and `[1]`,
 * trusting the build-turn-context loader's newest-first delivery convention.
 * That is the mirror defect (CLAUDE.md trap #12): the canonical selector sorts
 * by `computed_at` desc with untimestamped facts LAST, and the two disagreed
 * on real inputs —
 *
 *   - a legacy fact with no `computed_at` (still "successful") at window
 *     position 0 became `current` here while freshness selected a timestamped
 *     fact, so the comparison described a run the `fresh` verdict never
 *     vouched for; and
 *   - with `computed_at` skew the prior/current ROLES swap, which inverts
 *     `margin_shift_pp`'s sign and every `widened`/`narrowed` verdict derived
 *     from it, and makes #731's per-run leader authority read verdicts off the
 *     wrong run — withholding the wrong leader, or naming one that was withheld.
 *
 * Returns null when fewer than two successful runs exist.
 */
export function selectTwoNewestRunAnalysisFacts(
  priorFacts: readonly HandlerFact[],
): RunPair | null {
  const ordered = orderSuccessfulRunAnalysisFactsNewestFirst(priorFacts);
  if (ordered.length < 2) return null;
  return { current: ordered[0]!.fact, prior: ordered[1]!.fact };
}

/**
 * Redacted rerun / what-changed readiness (Track 2). Counts + a readiness
 * boolean — no run content. Structurally identical to the frame's
 * `FrameRerunReadiness` so the executor can assign it directly.
 */
export interface RerunReadiness {
  readonly priorSuccessfulRunCount: number;
  readonly comparisonCandidatesReady: boolean;
}

/**
 * Compose the rerun-readiness diagnostic from the SAME authorities the
 * run-comparison gate consults. `comparisonCandidatesReady` MIRRORS the gate's
 * own precondition (`run-comparison-gate.ts`: a CONFIRMED-fresh verdict AND a
 * `selectTwoNewestRunAnalysisFacts` pair) — fresh analysis AND ≥2 successful
 * prior runs. It means the PRECONDITIONS hold; the projection/diff can still
 * decline downstream, hence "candidates". Single-pass: the `≥2` check reuses
 * `priorSuccessfulRunCount`, counted off the SAME ordered candidate list
 * `selectTwoNewestRunAnalysisFacts` slices its pair from — so
 * `comparisonCandidatesReady` and `selectTwoNewestRunAnalysisFacts(...) !== null`
 * cannot disagree about what counts as a run. Pure; total.
 */
export function deriveRerunReadiness(
  priorFacts: readonly HandlerFact[],
  freshnessVerdict: FreshnessDerivation['freshness'],
): RerunReadiness {
  const priorSuccessfulRunCount =
    orderSuccessfulRunAnalysisFactsNewestFirst(priorFacts).length;
  const comparisonCandidatesReady =
    freshnessVerdict === 'fresh' && priorSuccessfulRunCount >= 2;
  return { priorSuccessfulRunCount, comparisonCandidatesReady };
}

/**
 * One run, as the comparator needs it: the compact summary PLUS the leading
 * option's STRUCTURAL identity.
 *
 * The identity travels WITH the summary — rather than being an extra argument
 * to {@link compareRuns} — so a call site cannot project two runs and then
 * forget to supply what makes their leaders comparable. Same construction as
 * the F2 fix: make the coupling a property of one value, not of an agreement
 * between two call sites.
 */
export interface RunProjection {
  readonly summary: AnalysisResponseSummary;
  /**
   * The leading option's `option_id` as it appears on the RAW enrichment, or
   * null when this run's enrichment carries no id for that option (legacy
   * shape). NEVER a label: see {@link readLeaderOptionId}.
   */
  readonly leader_option_id: string | null;
}

/**
 * The leading option's genuine `option_id`, or null.
 *
 * ⚠ `summary.winner.option_id` ALONE IS NOT AN IDENTITY. `compactAnalysis`
 * falls back `option_id ← option_label` when a raw option record carries no
 * `option_id`, so on legacy enrichment the field holds a display string and an
 * "id comparison" would silently degrade back into the label comparison this
 * whole change exists to remove. So the id is confirmed against the RAW
 * records — read through `winnerOptionResultSource`, the same single-sourced
 * reader `compactAnalysis` crowned the winner from, so "the id we compare is
 * the id of the option the projection called the leader" needs no second
 * derivation and no re-implementation of source precedence (trap #12).
 *
 * Deliberately NOT `result.leading_option_id` (PLoT's DECLARED leader): compact
 * crowns the highest-probability recommendable option, and the two are
 * different notions by design (see option-result-source.ts "STRATEGY SPLIT").
 * Taking identity from one and the displayed label from the other would let a
 * run report "unchanged" while showing two different labels.
 */
function readLeaderOptionId(
  enrichment: Record<string, unknown>,
  summary: AnalysisResponseSummary,
): string | null {
  const winnerId = summary.winner.option_id;
  if (winnerId.length === 0) return null;
  for (const entry of winnerOptionResultSource(enrichment)) {
    if (typeof entry.option_id === 'string' && entry.option_id === winnerId) {
      return winnerId;
    }
  }
  return null;
}

/**
 * Project a run_analysis fact's PLoT envelope (`result.enrichment`) into
 * the compact analysis summary the comparator diffs, plus the leading
 * option's structural identity. Returns null when the envelope is missing
 * or compaction rejects it (blocked/failed).
 */
export function projectRunFact(fact: HandlerFact): RunProjection | null {
  const result = (fact as { result?: { enrichment?: unknown } }).result;
  const enrichment = result?.enrichment;
  if (!enrichment) return null;
  const summary = compactAnalysis(enrichment as V2RunResponseEnvelope);
  if (summary === null) return null;
  return {
    summary,
    leader_option_id: readLeaderOptionId(
      enrichment as Record<string, unknown>,
      summary,
    ),
  };
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
/**
 * Spine A backstop: drop option-controlled drivers from a summary's
 * `top_drivers` before the rank diff, so an option-controlled lever is never
 * reported as gaining/losing influence. Keyed on structural `factor_id`.
 * Returns the input unchanged when nothing is controlled (cheap, allocation-free).
 */
function withoutControlledDrivers(
  summary: AnalysisResponseSummary,
  controlledFactorIds?: ReadonlySet<string>,
): AnalysisResponseSummary {
  if (controlledFactorIds === undefined || controlledFactorIds.size === 0) {
    return summary;
  }
  const { kept } = partitionInterventionControlledDrivers(
    summary.top_drivers,
    controlledFactorIds,
  );
  if (kept.length === summary.top_drivers.length) return summary;
  return { ...summary, top_drivers: kept };
}

export function compareRuns(
  priorRun: RunProjection,
  currentRun: RunProjection,
  controlledFactorIds?: ReadonlySet<string>,
): RunDelta {
  const prior = priorRun.summary;
  const current = currentRun.summary;
  const priorLabel = prior.winner.option_label.trim();
  const currentLabel = current.winner.option_label.trim();
  const comparable = priorLabel.length > 0 && currentLabel.length > 0;

  // ⭐ IDENTITY IS THE OPTION ID; THE LABEL IS DISPLAY ONLY.
  //
  // `context/graph-hash.ts` deliberately EXCLUDES option labels from the
  // analysis-affecting hash, so rename → re-run leaves freshness `fresh` and
  // both runs permitted — straight into the both-permitted arm of the gate's
  // `composeComparison`, which asserted "X came out ahead before, and Y now
  // leads" about ONE option the user had merely renamed. Comparing labels made
  // a claim the hash had already ruled out.
  //
  // Compared EXACTLY (no `normaliseLabel`): an id is a structural key, and
  // case-folding or trimming one would be inventing an equality the store does
  // not have.
  //
  // LEGACY FALLBACK — SILENT, NOT GUESSED. When either run's enrichment carries
  // no id for its leader, we do not know whether the leader changed, and the
  // two possible errors are not symmetric: a false "your leader changed"
  // rewrites the user's decision, a false "nothing changed" merely withholds.
  // So indeterminate ⇒ no change claim, recorded in `leader_identity_basis`
  // so the two `false`s stay distinguishable.
  const priorId = priorRun.leader_option_id;
  const currentId = currentRun.leader_option_id;
  const identified = priorId !== null && currentId !== null;

  const { direction, shift } = deriveMargin(prior.margin_pp, current.margin_pp);

  const priorBand = prior.robustness_level || 'unknown';
  const currentBand = current.robustness_level || 'unknown';
  const robustnessChanged =
    priorBand !== 'unknown' &&
    currentBand !== 'unknown' &&
    priorBand !== currentBand;

  return {
    comparable,
    leading_option_changed: comparable && identified && priorId !== currentId,
    leader_identity_basis: identified ? 'option_id' : 'indeterminate',
    prior_leading_label: priorLabel,
    current_leading_label: currentLabel,
    margin_direction: direction,
    margin_shift_pp: shift,
    driver_rank_changes: deriveDriverRankChanges(
      withoutControlledDrivers(prior, controlledFactorIds),
      withoutControlledDrivers(current, controlledFactorIds),
    ),
    robustness_changed: robustnessChanged,
    prior_band: priorBand,
    current_band: currentBand,
  };
}
