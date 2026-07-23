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

/**
 * The P0-selectable lenses, in priority order. The first three are the shipped
 * capability-layer core (ROADMAP 1.183). `what_if_counterfactual` is the first
 * wave-3 λ EXTENSION lens (#646): it is placed LAST (lowest priority — it never
 * displaces a core lens on a healthy turn) and its executor is env/programme-gated
 * (see {@link LENS_EXECUTOR_INTRINSICALLY_AVAILABLE} + the ROADMAP 1.195 gate),
 * so it can only be suggested when the caller injects its availability.
 */
export type LensId =
  | 'sensitivity_flip_risk'
  | 'pre_mortem'
  | 'evpi_evidence_priority'
  | 'what_if_counterfactual';

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
  | 'MATERIAL_EVPI' // learning more about a factor would move the decision
  // what_if_counterfactual (wave-3 λ extension, executor-gated)
  | 'WHATIF_EXPLORE_DRIVER'; // a top-influence factor is worth a counterfactual probe

/**
 * The science-bearing enrichment FIELD each lens grounds its claim in. Wave-3 σ
 * (ROADMAP 1.203) routes this field through the claim-safety cage before any
 * value it carries is surfaced. Keyed by rationale (the specific grounding).
 */
export type LensGroundingField =
  | 'factor_sensitivity'
  | 'confidence_tier'
  | 'option_comparison';

/**
 * Wave-4 δ2 (ROADMAP 1.202) — the specific graph node this lens POINTS AT, for
 * the `focus` ui_directive. CEE-INTERNAL only (never a wire type → no schema
 * change). The id is a structured `factor_id` read from the analysis signals; the
 * directive emitter resolves it to a label via the shared `GraphNodeLookup`,
 * fail-closed on miss. `kind` is `'factor'` for every subject the selector emits
 * today — the lens subjects are all factors (the dominant driver, the isolated
 * flip factor, the top-influence low-confidence factor, the material-EVPI
 * factor). Lenses with no single-factor subject (CONFIDENCE_NEEDS_WORK,
 * WIN_PROB_MODERATE) leave this undefined → the directive falls through to the v1
 * winner-highlight rather than fabricating a target.
 */
export interface LensSubjectRef {
  readonly id: string;
  readonly kind: 'factor';
}

export interface LensSelection {
  readonly lens: LensId;
  readonly rationaleCode: LensRationaleCode;
  /** Plain-language card title (pre-truncation). */
  readonly title: string;
  /** Plain-language rationale body naming the live action (pre-truncation). */
  readonly body: string;
  /**
   * The enrichment field this lens's claim is grounded in — the field wave-3 σ
   * consults the claim-safety cage for. Exposed here (rather than re-derived at
   * the call site) so the selector stays the single source of the lens→field map.
   */
  readonly groundingField: LensGroundingField;
  /**
   * Wave-4 δ2 — the node the `focus` directive points at (§2.1 rows 2). Undefined
   * when the lens has no single-factor subject; the directive then defers to the
   * v1 highlight (the safe floor). NOT a wire field — see {@link LensSubjectRef}.
   */
  readonly subjectRef?: LensSubjectRef;
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
// Executor availability + the extension-lens enable gate (wave-3 λ)
// ============================================================================

/**
 * NEVER suggest a lens whose executor is absent (design §2.6/2.7): the selector
 * must not point a user at a decision-science method the platform cannot honestly
 * run. Every `LensId` declares here whether its executor is INTRINSICALLY present
 * on the live path:
 *   - the three core lenses point at actions that always execute — sensitivity →
 *     `what_would_flip`, pre-mortem → the review-path pre_mortem card, EVPI →
 *     `gather_evidence` — so they are always available;
 *   - `what_if_counterfactual` runs against ISL (`createCounterfactualClient()`,
 *     latent when `ISL_BASE_URL` is unset) and is additionally gated by ROADMAP
 *     1.195 — so it is NOT intrinsically available; the caller must inject its
 *     availability (see {@link whatIfSuggestionExecutorAvailable}).
 * Compile-exhaustive over `LensId`: a NEW lens must declare its intrinsic
 * availability here (fail-loud on drift, never a silent default).
 */
const LENS_EXECUTOR_INTRINSICALLY_AVAILABLE: Readonly<Record<LensId, boolean>> = {
  sensitivity_flip_risk: true,
  pre_mortem: true,
  evpi_evidence_priority: true,
  what_if_counterfactual: false,
};

/** Options threading caller-owned, non-deterministic state into the otherwise-pure
 *  selector. Kept OUT of `selectLens`'s core so the rule logic stays testable and
 *  env-free (the env/config read lives at the compose call site). */
export interface LensSelectorOptions {
  /**
   * Per-lens executor availability for NON-intrinsic (extension) lenses. A lens
   * whose executor is absent is NEVER suggested — the selector falls through to
   * the next available lens (design §2.6/2.7). Omitted / `false` ⇒ the extension
   * lens is not suggested (fail-closed).
   */
  readonly executorAvailable?: Partial<Record<LensId, boolean>>;
}

function isLensExecutorAvailable(lens: LensId, options?: LensSelectorOptions): boolean {
  if (LENS_EXECUTOR_INTRINSICALLY_AVAILABLE[lens]) return true;
  return options?.executorAvailable?.[lens] ?? false;
}

/**
 * The ROADMAP 1.195 four-item enable-gate for the what-if counterfactual
 * SUGGESTION, expressed as a fail-closed code constant (the no-env-gates
 * doctrine — activation is a reviewed code change, never a runtime bit).
 * Items 2/3/4 — the live ISL model-fidelity probe (A3), the owner-placement
 * ruling (CEE-2nd-interpreter vs PLoT proxy), and the target-semantics
 * confirmation (cap/baseline, not the flip tipping_point) — are programme
 * decisions that are NOT cleared, so this ships `false`. Item 1 (transport:
 * `ISL_BASE_URL` set / `createCounterfactualClient() !== null`) is ANDed in
 * separately at the call site via {@link whatIfSuggestionExecutorAvailable}.
 * While this is `false`, the selector can NEVER suggest the what-if lens,
 * however the transport is configured. Enabling it is a Paul/A1-gated code
 * change once all four items clear; rollback = revert.
 */
export const WHATIF_SUGGESTION_GATE_CLEARED = false;

/**
 * Whether the what-if counterfactual SUGGESTION may be offered: the ROADMAP 1.195
 * enable-gate (items 2/3/4, {@link WHATIF_SUGGESTION_GATE_CLEARED}) AND the ISL
 * transport being configured (item 1, `createCounterfactualClient() !== null`,
 * passed as `islTransportConfigured`). Fail-closed: ANY unmet item ⇒ `false`.
 * Pure + directly testable so the gate is a mutation witness (flip the constant
 * or drop the transport ⇒ this returns `false`).
 */
export function whatIfSuggestionExecutorAvailable(islTransportConfigured: boolean): boolean {
  return WHATIF_SUGGESTION_GATE_CLEARED && islTransportConfigured;
}

// ============================================================================
// Normalised, defensively-read analysis signals
// ============================================================================

interface FactorSignal {
  /** Structured `factor_id` from the enrichment (wave-4 δ2 — the lens-subject
   *  id the `focus` directive points at). `null` when absent. */
  readonly factorId: string | null;
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
        factorId: typeof e.factor_id === 'string' && e.factor_id.length > 0 ? e.factor_id : null,
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
// rationale code + the subject FACTOR id it points at (wave-4 δ2), or `null`.
// Pure over the normalised signals. `subjectFactorId` is `null` for a rationale
// with no single-factor subject (the directive then defers to the v1 highlight).
// ============================================================================

interface EvaluatorHit {
  readonly code: LensRationaleCode;
  /** The factor the lens points at (§2.1 focus subject); `null` when the lens
   *  has no single-factor subject (overall-confidence / option-level). */
  readonly subjectFactorId: string | null;
}

/** Rule 1 — sensitivity / flip-risk (highest-priority lens). */
function evaluateSensitivityFlipRisk(signals: AnalysisSignals): EvaluatorHit | null {
  // 1a — an explicit PLoT flip-risk flag on any factor. `isolated` (this factor
  // can flip the result on its own) is the strongest single-factor signal and
  // takes precedence; `correlated` (flips only in combination with others) is a
  // weaker, honestly distinct claim. `negligible` never fires.
  const isolated = signals.factors.find(
    (f) => f.flipRiskCategory === FLIP_RISK_ISOLATED_CATEGORY,
  );
  if (isolated) return { code: 'FLIP_RISK_ISOLATED', subjectFactorId: isolated.factorId };

  const correlated = signals.factors.find(
    (f) => f.flipRiskCategory === FLIP_RISK_CORRELATED_CATEGORY,
  );
  if (correlated) return { code: 'FLIP_RISK_CORRELATED', subjectFactorId: correlated.factorId };

  // 1b — one factor carries a STRICT majority share of total positive influence.
  // Behaviour-identical to the prior `Math.max`/`reduce` trigger; additionally
  // carries the dominating factor's id as the focus subject.
  const scored = signals.factors.filter(
    (f): f is FactorSignal & { influenceScore: number } =>
      f.influenceScore !== null && f.influenceScore > 0,
  );
  if (scored.length >= 1) {
    const total = scored.reduce((a, f) => a + f.influenceScore, 0);
    let top = scored[0]!;
    for (const f of scored) if (f.influenceScore > top.influenceScore) top = f;
    if (total > 0 && top.influenceScore / total > DOMINANCE_SHARE_MIN) {
      return { code: 'DOMINANT_DRIVER', subjectFactorId: top.factorId };
    }
  }
  return null;
}

/** Rule 2 — pre-mortem: the decision is acceptance-plausible but fragile. */
function evaluatePreMortem(signals: AnalysisSignals): EvaluatorHit | null {
  // 2a — the overall analysis is usable but not solid (no single-factor subject).
  if (signals.confidenceTier === 'needs_work') {
    return { code: 'CONFIDENCE_NEEDS_WORK', subjectFactorId: null };
  }

  // 2b — the single most-influential factor is also the least certain.
  const topRankLowConfidence = signals.factors.find(
    (f) => f.influenceRank === 1 && f.confidenceBand === 'low',
  );
  if (topRankLowConfidence) {
    return { code: 'TOP_FACTOR_LOW_CONFIDENCE', subjectFactorId: topRankLowConfidence.factorId };
  }

  // 2c — a leader exists but not decisively (option-level; no factor subject).
  if (signals.optionWinProbabilities.length > 0) {
    const topWin = Math.max(...signals.optionWinProbabilities);
    if (topWin >= PREMORTEM_WINPROB_MIN && topWin < PREMORTEM_WINPROB_MAX) {
      return { code: 'WIN_PROB_MODERATE', subjectFactorId: null };
    }
  }
  return null;
}

/** Rule 3 — EVPI-ranked evidence priority. */
function evaluateEvpiEvidencePriority(signals: AnalysisSignals): EvaluatorHit | null {
  // Behaviour-identical trigger (max present pp ≥ MIN); carries the max-pp
  // factor's id as the focus subject.
  let best: (FactorSignal & { evpiPercentagePoints: number }) | null = null;
  for (const f of signals.factors) {
    if (f.evpiPercentagePoints === null) continue;
    if (best === null || f.evpiPercentagePoints > best.evpiPercentagePoints) {
      best = f as FactorSignal & { evpiPercentagePoints: number };
    }
  }
  if (best === null) return null;
  if (best.evpiPercentagePoints >= EVPI_MATERIAL_MIN_PP) {
    return { code: 'MATERIAL_EVPI', subjectFactorId: best.factorId };
  }
  return null;
}

/**
 * Rule 4 (wave-3 λ extension, executor-gated) — what-if counterfactual. LOWEST
 * priority: only reached when no flip-risk / pre-mortem / EVPI lens fired, so it
 * NEVER displaces a core lens (priority-preservation guard). Points the user at
 * exploring how the leading option changes if the single most-influential factor
 * moves — a counterfactual they can run explicitly (`what_would_flip`'s ISL
 * counterfactual extension, #646). Trigger: an identifiable top-influence factor
 * (rank 1 with a finite influence score) exists to intervene on. NOTE: the exact
 * intervention-target semantics are ROADMAP 1.195 gate item 4 (pending); this
 * evaluator is provisional and, crucially, the lens is enable-GATED — its
 * executor availability is injected `false` today, so it never fires in
 * production regardless of this trigger.
 */
function evaluateWhatIfCounterfactual(signals: AnalysisSignals): EvaluatorHit | null {
  const topDriver = signals.factors.find(
    (f) => f.influenceRank === 1 && f.influenceScore !== null,
  );
  return topDriver
    ? { code: 'WHATIF_EXPLORE_DRIVER', subjectFactorId: topDriver.factorId }
    : null;
}

// ============================================================================
// Copy — compile-enforced exhaustive over the input unions (a new LensId or
// LensRationaleCode fails the build HERE until it is given copy — fail-loud on
// drift, never a silent default). Every string is prose-guard-clean (no
// forbidden vocabulary, no raw decimals, no entity IDs) — asserted in tests.
// ============================================================================

export const TITLE_BY_LENS: Readonly<Record<LensId, string>> = {
  sensitivity_flip_risk: 'Strengthen your model: pressure-test the key driver',
  pre_mortem: 'Strengthen your model: run a quick pre-mortem',
  evpi_evidence_priority: 'Strengthen your model: focus your evidence-gathering',
  what_if_counterfactual: 'Strengthen your model: try a what-if on the key driver',
};

export const BODY_BY_RATIONALE: Readonly<Record<LensRationaleCode, string>> = {
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
  WHATIF_EXPLORE_DRIVER:
    'One factor shapes this result more than the others. Trying a what-if on that driver — seeing how the leading option changes as it moves — shows how much the choice hangs on it.',
};

/**
 * The science-bearing enrichment field each rationale grounds its claim in —
 * compile-enforced-exhaustive over `LensRationaleCode` (a new rationale fails the
 * build here until given a grounding field). This is the wave-3 σ input: the
 * field the claim-safety cage is consulted for. `option_comparison` is
 * deliberately NOT in the A1-seeded Tier-2 allow-list, so the WIN_PROB_MODERATE
 * lens's grounding field is a live, organically-observable cage DENIAL (positive
 * control on staging); the others ground in allow-listed fields.
 */
export const GROUNDING_FIELD_BY_RATIONALE: Readonly<Record<LensRationaleCode, LensGroundingField>> = {
  FLIP_RISK_ISOLATED: 'factor_sensitivity',
  FLIP_RISK_CORRELATED: 'factor_sensitivity',
  DOMINANT_DRIVER: 'factor_sensitivity',
  CONFIDENCE_NEEDS_WORK: 'confidence_tier',
  TOP_FACTOR_LOW_CONFIDENCE: 'factor_sensitivity',
  WIN_PROB_MODERATE: 'option_comparison',
  MATERIAL_EVPI: 'factor_sensitivity',
  // The what-if claim is about the OUTCOME (option win probability) → grounds in
  // option_comparison, which is deliberately NOT allow-listed, so the σ cage
  // DENIES surfacing its value: the counterfactual outcome number stays omitted
  // until Neil rules (doctrine-pending) — an honest double-lock alongside the
  // 1.195 enable gate.
  WHATIF_EXPLORE_DRIVER: 'option_comparison',
};

function buildSelection(lens: LensId, hit: EvaluatorHit): LensSelection {
  return {
    lens,
    rationaleCode: hit.code,
    title: TITLE_BY_LENS[lens],
    body: BODY_BY_RATIONALE[hit.code],
    groundingField: GROUNDING_FIELD_BY_RATIONALE[hit.code],
    // Wave-4 δ2: expose the focus subject when the lens points at a single
    // factor. Omitted (undefined) for subject-less rationales → the directive
    // defers to the v1 highlight (never fabricates a target).
    ...(hit.subjectFactorId !== null
      ? { subjectRef: { id: hit.subjectFactorId, kind: 'factor' as const } }
      : {}),
  };
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Select the single most useful lens for this analysis, or `null` when the
 * evidence doesn't justify one (or the only lens whose evidence fired has no
 * executor). Priority order: sensitivity/flip-risk → pre-mortem → EVPI evidence
 * priority → what-if counterfactual (extension, executor-gated); the first rule
 * that BOTH fires AND has an available executor wins.
 *
 * The "never suggest a lens whose executor is absent" rule (design §2.6/2.7) is
 * applied uniformly: a lens whose evidence fires but whose executor is
 * unavailable is SKIPPED, falling through to the next — never a suggestion the
 * platform cannot honestly run. The three core lenses are intrinsically
 * available; `what_if_counterfactual` requires the caller to inject availability
 * (which is itself gated by ROADMAP 1.195 — see
 * {@link whatIfSuggestionExecutorAvailable}).
 *
 * ── Extension harness (lenses 2..N, design §2.7) ──────────────────────────────
 * To add a lens: (1) add its `LensId` + `LensRationaleCode(s)`; (2) add a pure
 * `evaluate<Lens>(signals)` over the (possibly extended) signal bag; (3) add copy
 * (`TITLE_BY_LENS` / `BODY_BY_RATIONALE`) and its `GROUNDING_FIELD_BY_RATIONALE`
 * entry and `LENS_EXECUTOR_INTRINSICALLY_AVAILABLE` flag — the compiler forces all
 * four (fail-loud on drift); (4) insert ONE priority-ordered branch below, gated
 * on `isLensExecutorAvailable`. The at-most-one + may-return-null invariants hold
 * by construction. A lens with a NON-intrinsic executor (needs an ISL/PLoT caller
 * that may be absent) MUST ship executor-intrinsic `false` and be added to
 * `selectLens` only in lockstep with a real executor + its availability injection
 * — never suggest a method that cannot run.
 */
export function selectLens(
  fact: RunAnalysisHandlerFact,
  options?: LensSelectorOptions,
): LensSelection | null {
  const signals = readAnalysisSignals(fact);
  if (signals === null) return null;

  const sensitivity = evaluateSensitivityFlipRisk(signals);
  if (sensitivity !== null && isLensExecutorAvailable('sensitivity_flip_risk', options)) {
    return buildSelection('sensitivity_flip_risk', sensitivity);
  }

  const preMortem = evaluatePreMortem(signals);
  if (preMortem !== null && isLensExecutorAvailable('pre_mortem', options)) {
    return buildSelection('pre_mortem', preMortem);
  }

  const evpi = evaluateEvpiEvidencePriority(signals);
  if (evpi !== null && isLensExecutorAvailable('evpi_evidence_priority', options)) {
    return buildSelection('evpi_evidence_priority', evpi);
  }

  const whatIf = evaluateWhatIfCounterfactual(signals);
  if (whatIf !== null && isLensExecutorAvailable('what_if_counterfactual', options)) {
    return buildSelection('what_if_counterfactual', whatIf);
  }

  // Load-bearing negative: no lens whose evidence fired has an available executor.
  return null;
}
