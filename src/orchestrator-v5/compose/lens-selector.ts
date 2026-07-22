/**
 * Capability layer P0 — deterministic lens selector (ROADMAP 1.183).
 *
 * Picks the SINGLE most useful decision-science lens to surface after an
 * analysis, from EXPLICIT auditable rules over REAL analysis state (option
 * comparison, factor sensitivity, EVPI, confidence tier). It is:
 *
 *   - **Deterministic — no LLM call.** The selection is a pure function of the
 *     enrichment already computed by ISL/PLoT. The UI DISPLAYS the decision;
 *     it never re-infers it (single-source-of-truth — the S1 lesson).
 *   - **At most ONE suggestion.** The frequency cap is by construction: the
 *     first rule that fires in priority order wins the slot.
 *   - **Allowed to recommend NOTHING.** When the evidence doesn't justify a
 *     lens (`selectLens` returns `null`), NO suggestion is emitted. This
 *     "may-recommend-nothing" behaviour is load-bearing, not a fallthrough
 *     accident — it is the honest default and has its own negative-control
 *     tests.
 *
 * Lens priority is LOCKED by the capability-layer brief Revision-1 item 5
 * ("most useful available lens"), in order:
 *   1. sensitivity / flip-risk explanation
 *   2. pre-mortem (review-path form)
 *   3. EVPI-ranked evidence priority
 *
 * P0 honesty note: every lens here points at an action that EXECUTES on the
 * live path today (sensitivity → `what_would_flip`; pre-mortem → the
 * review-path pre_mortem card; evidence priority → `gather_evidence`). The
 * suggestion ships as coach TEXT + rationale (see phase3-blocks
 * `buildLensSuggestionCoachingBlock`); it carries NO on-card action chip
 * because that affordance is inert on the live UI today (brief Revision-1
 * item 3 — "no inert chips, ever"). The prose names the live action.
 *
 * Deferred lenses (weighted matrix · outside view · richer devil's advocacy)
 * are NOT selectable here — they need compute / reference-class evidence we do
 * not have (brief Revision-1 items 1 & 5).
 */

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { bandConfidence, type ConfidenceBand } from './confidence-bands.js';

// ============================================================================
// Public result types
// ============================================================================

/** The three P0-selectable lenses, in priority order. */
export type LensId =
  | 'sensitivity_flip_risk'
  | 'pre_mortem'
  | 'evpi_evidence_priority';

/**
 * The specific signal that TRIGGERED the lens. Distinct from `LensId` so
 * telemetry and copy can name the exact reason (a lens can fire for more than
 * one reason). Each code belongs to exactly one lens (see the evaluators).
 */
export type LensRationaleCode =
  // sensitivity_flip_risk
  | 'FLIP_RISK_ISOLATED' // a factor can flip the result ON ITS OWN (PLoT flip_risk_category 'isolated')
  | 'FLIP_RISK_CORRELATED' // a factor can tip the result only in COMBINATION with others ('correlated')
  | 'DOMINANT_DRIVER' // one factor carries a majority share of total influence
  // pre_mortem
  | 'CONFIDENCE_NEEDS_WORK' // overall analysis is usable but not solid
  | 'TOP_FACTOR_LOW_CONFIDENCE' // the #1-influence factor is least certain
  | 'WIN_PROB_MODERATE' // a leader exists but not decisively
  // evpi_evidence_priority
  | 'MATERIAL_EVPI'; // learning more about a factor would move the decision

export interface LensSelection {
  readonly lens: LensId;
  readonly rationaleCode: LensRationaleCode;
  /** Plain-language card title (pre-truncation). */
  readonly title: string;
  /** Plain-language rationale body naming the live action (pre-truncation). */
  readonly body: string;
}

// ============================================================================
// Thresholds — named + auditable. Documented against the brief §2 triggers.
// ============================================================================

/**
 * Rule 1b — a single driver "dominates" when its influence_score is a STRICT
 * majority of the summed positive influence across factors. Scale-invariant
 * (a share, not an absolute), so it is robust to whatever units ISL emits.
 * Strict `>` means two equal drivers (each 0.5 share) do NOT trip it — only a
 * genuine single dominator does.
 */
export const DOMINANCE_SHARE_MIN = 0.5;

/**
 * Rule 1a — PLoT `flip_risk_category` is a CLOSED enum (plot-lite
 * `contracts/README.md`; `computeFlipRiskCategory` in `factor-influence.ts`):
 *   - `isolated`   — this factor ALONE can flip the result (max
 *                    marginal_switch_probability over threshold). The strongest
 *                    single-factor signal.
 *   - `correlated` — flips only in COMBINATION with other factors (marginal
 *                    below threshold, joint switch above). NOT a single-factor
 *                    claim, so it earns its own honest combination wording.
 *   - `negligible` — neither; never worth a lens.
 * Matched by EXACT (lower-cased on read) value — no substring or forward-compat
 * tokens. An unwitnessed token is the mirror-rot class: a hand-listed allow-set
 * that a producer rename would silently desync. A NEW enum value would fall
 * through to the lower-priority rules (no lens from 1a) rather than error — that
 * is the safe direction (silence, not a false single-factor claim); revisit here
 * if plot-lite ever adds a category. */
const FLIP_RISK_ISOLATED_CATEGORY = 'isolated';
const FLIP_RISK_CORRELATED_CATEGORY = 'correlated';

/**
 * Rule 2b — the leading option's win_probability band that reads as
 * "acceptance-plausible but not decisive". Below MIN there is no clear leader
 * (a different situation); at/above MAX the choice is decisive (no pre-mortem
 * nudge warranted).
 */
export const PREMORTEM_WINPROB_MIN = 0.4;
export const PREMORTEM_WINPROB_MAX = 0.7;

/**
 * Rule 3 — EVPI is material at/above this many percentage points. Below this
 * (or `evpi_status: 'below_resolution'`, where the value is deliberately
 * ABSENT) there is nothing worth a dedicated research nudge.
 */
export const EVPI_MATERIAL_MIN_PP = 1.0;

// ============================================================================
// Normalised, defensively-read analysis signals
// ============================================================================

interface FactorSignal {
  readonly influenceScore: number | null;
  readonly influenceRank: number | null;
  /** Present ONLY when a finite value exists and status is not below-resolution. */
  readonly evpiPercentagePoints: number | null;
  readonly confidenceBand: ConfidenceBand | null;
  /** Lower-cased; `null` when absent. */
  readonly flipRiskCategory: string | null;
}

interface AnalysisSignals {
  readonly factors: readonly FactorSignal[];
  /** Finite win_probability values across option_comparison entries. */
  readonly optionWinProbabilities: readonly number[];
  readonly confidenceTier: 'strong' | 'fair' | 'needs_work' | null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read the enrichment into a normalised signal bag, or `null` when there is
 * no enrichment at all (nothing to point a lens at). Every field is read
 * defensively; a missing / non-finite value becomes `null` — NEVER a defaulted
 * zero (absent ≠ zero, per the enrichment doc).
 */
function readAnalysisSignals(fact: RunAnalysisHandlerFact): AnalysisSignals | null {
  const enrichment = readRecord((fact.result as Record<string, unknown>).enrichment);
  if (enrichment === null) return null;

  const factors: FactorSignal[] = [];
  const fs = enrichment.factor_sensitivity;
  if (Array.isArray(fs)) {
    for (const raw of fs) {
      const e = readRecord(raw);
      if (e === null) continue;
      // EVPI counts only when a finite value is present AND ISL did not mark it
      // below resolution (where the pp value is deliberately absent).
      const evpiStatus = typeof e.evpi_status === 'string' ? e.evpi_status : null;
      const evpiPp =
        evpiStatus === 'below_resolution'
          ? null
          : finiteNumberOrNull(e.evpi_percentage_points);
      factors.push({
        influenceScore: finiteNumberOrNull(e.influence_score),
        influenceRank: finiteNumberOrNull(e.influence_rank),
        evpiPercentagePoints: evpiPp,
        confidenceBand: bandConfidence(e.confidence),
        flipRiskCategory:
          typeof e.flip_risk_category === 'string'
            ? e.flip_risk_category.toLowerCase()
            : null,
      });
    }
  }

  const optionWinProbabilities: number[] = [];
  const oc = enrichment.option_comparison;
  if (Array.isArray(oc)) {
    for (const raw of oc) {
      const e = readRecord(raw);
      if (e === null) continue;
      const wp = finiteNumberOrNull(e.win_probability);
      if (wp !== null) optionWinProbabilities.push(wp);
    }
  }

  const tier = enrichment.confidence_tier;
  const confidenceTier =
    tier === 'strong' || tier === 'fair' || tier === 'needs_work' ? tier : null;

  return { factors, optionWinProbabilities, confidenceTier };
}

// ============================================================================
// Rule evaluators — one per lens, priority order. Each returns the triggering
// rationale code or `null`. Pure over the normalised signals.
// ============================================================================

/** Rule 1 — sensitivity / flip-risk (highest-priority lens). */
function evaluateSensitivityFlipRisk(signals: AnalysisSignals): LensRationaleCode | null {
  // 1a — an explicit PLoT flip-risk flag on any factor. `isolated` (this factor
  // can flip the result on its own) is the strongest single-factor signal and
  // takes precedence; `correlated` (flips only in combination with others) is a
  // weaker, honestly distinct claim. `negligible` never fires.
  const hasIsolated = signals.factors.some(
    (f) => f.flipRiskCategory === FLIP_RISK_ISOLATED_CATEGORY,
  );
  if (hasIsolated) return 'FLIP_RISK_ISOLATED';

  const hasCorrelated = signals.factors.some(
    (f) => f.flipRiskCategory === FLIP_RISK_CORRELATED_CATEGORY,
  );
  if (hasCorrelated) return 'FLIP_RISK_CORRELATED';

  // 1b — one factor carries a STRICT majority share of total positive influence.
  const scores = signals.factors
    .map((f) => f.influenceScore)
    .filter((s): s is number => s !== null && s > 0);
  if (scores.length >= 1) {
    const total = scores.reduce((a, b) => a + b, 0);
    const top = Math.max(...scores);
    if (total > 0 && top / total > DOMINANCE_SHARE_MIN) {
      return 'DOMINANT_DRIVER';
    }
  }
  return null;
}

/** Rule 2 — pre-mortem: the decision is acceptance-plausible but fragile. */
function evaluatePreMortem(signals: AnalysisSignals): LensRationaleCode | null {
  // 2a — the overall analysis is usable but not solid.
  if (signals.confidenceTier === 'needs_work') return 'CONFIDENCE_NEEDS_WORK';

  // 2b — the single most-influential factor is also the least certain.
  const topRankLowConfidence = signals.factors.some(
    (f) => f.influenceRank === 1 && f.confidenceBand === 'low',
  );
  if (topRankLowConfidence) return 'TOP_FACTOR_LOW_CONFIDENCE';

  // 2c — a leader exists but not decisively.
  if (signals.optionWinProbabilities.length > 0) {
    const topWin = Math.max(...signals.optionWinProbabilities);
    if (topWin >= PREMORTEM_WINPROB_MIN && topWin < PREMORTEM_WINPROB_MAX) {
      return 'WIN_PROB_MODERATE';
    }
  }
  return null;
}

/** Rule 3 — EVPI-ranked evidence priority. */
function evaluateEvpiEvidencePriority(signals: AnalysisSignals): LensRationaleCode | null {
  const presentPp = signals.factors
    .map((f) => f.evpiPercentagePoints)
    .filter((p): p is number => p !== null);
  if (presentPp.length === 0) return null;
  if (Math.max(...presentPp) >= EVPI_MATERIAL_MIN_PP) return 'MATERIAL_EVPI';
  return null;
}

// ============================================================================
// Copy — compile-enforced exhaustive over the input unions (a new LensId or
// LensRationaleCode fails the build HERE until it is given copy — fail-loud on
// drift, never a silent default). Every string is prose-guard-clean (no
// forbidden vocabulary, no raw decimals, no entity IDs) — asserted in tests.
// ============================================================================

const TITLE_BY_LENS: Readonly<Record<LensId, string>> = {
  sensitivity_flip_risk: 'Strengthen your model: pressure-test the key driver',
  pre_mortem: 'Strengthen your model: run a quick pre-mortem',
  evpi_evidence_priority: 'Strengthen your model: focus your evidence-gathering',
};

const BODY_BY_RATIONALE: Readonly<Record<LensRationaleCode, string>> = {
  FLIP_RISK_ISOLATED:
    'The result leans on a single factor that could tip which option leads on its own — a small change to it alone could flip the outcome. Asking what would flip the decision shows how much room for error you have.',
  FLIP_RISK_CORRELATED:
    'No single factor is decisive here, but the right combination of factors could tip which option leads — the outcome is more finely balanced than it first looks. Asking what would flip the decision shows which factors move together.',
  DOMINANT_DRIVER:
    'One factor is doing most of the work in this result. A sensitivity check shows how far it can move before the leading option changes.',
  CONFIDENCE_NEEDS_WORK:
    'The analysis is usable but not yet solid. A pre-mortem — imagining the choice went wrong and asking why — surfaces the weak points worth shoring up first.',
  TOP_FACTOR_LOW_CONFIDENCE:
    'The factor that moves this result the most is also the one you are least sure about. A pre-mortem helps you name what could go wrong before you commit.',
  WIN_PROB_MODERATE:
    'The leading option is ahead, but not by a wide margin. A pre-mortem — assuming it went wrong and asking why — helps you see what would have to break for that to happen.',
  MATERIAL_EVPI:
    'There is a factor where learning more would change the decision the most. Gathering evidence there first, rather than everywhere, is the fastest way to firm up the choice.',
};

function buildSelection(lens: LensId, rationaleCode: LensRationaleCode): LensSelection {
  return {
    lens,
    rationaleCode,
    title: TITLE_BY_LENS[lens],
    body: BODY_BY_RATIONALE[rationaleCode],
  };
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Select the single most useful lens for this analysis, or `null` when the
 * evidence doesn't justify one. Priority order: sensitivity/flip-risk →
 * pre-mortem → EVPI evidence priority; the first rule that fires wins.
 */
export function selectLens(fact: RunAnalysisHandlerFact): LensSelection | null {
  const signals = readAnalysisSignals(fact);
  if (signals === null) return null;

  const sensitivity = evaluateSensitivityFlipRisk(signals);
  if (sensitivity !== null) return buildSelection('sensitivity_flip_risk', sensitivity);

  const preMortem = evaluatePreMortem(signals);
  if (preMortem !== null) return buildSelection('pre_mortem', preMortem);

  const evpi = evaluateEvpiEvidencePriority(signals);
  if (evpi !== null) return buildSelection('evpi_evidence_priority', evpi);

  // Load-bearing negative: the evidence doesn't justify any lens.
  return null;
}
