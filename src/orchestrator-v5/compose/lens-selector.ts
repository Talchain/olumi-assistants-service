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
 * ── AMENDMENT, 2026-07-31 (ROADMAP 2.211): NO IMMEDIATE REPEAT ──────────────
 * The ORDER above is NOT changed and is not up for change here. What is added
 * is a tie-break on CONSECUTIVE analysis turns: when the lens that would win
 * the slot is the SAME lens that won it on the immediately-preceding analysis
 * turn of this scenario, AND at least one other lens's trigger is currently
 * true with an available executor, the NEXT-PRIORITY triggered lens takes the
 * slot instead. When only one lens triggers, REPEATING IS CORRECT and the
 * repeat stands — and `may-recommend-nothing` is untouched in both directions
 * (no repeat ever manufactures a lens, and no repeat ever suppresses one).
 *
 * EVIDENCE: `PHASE0-EVIDENCE-2026-07-28/probe-premortem-live.md` — a live walk
 * over 7 completed analysis turns on deployed staging measured
 * `sensitivity_flip_risk` winning the slot on 6 of 6 turns where the lens was
 * recorded (100%), and on 5 of those 6 the pre-mortem lens's OWN trigger was
 * simultaneously true and discarded. The reason is structural, not luck: rule
 * 2's most reachable door is a finely-balanced result (`WIN_PROB_MODERATE`),
 * and a finely-balanced result is precisely what produces the fragile edges
 * that make rule 1a fire — so the ladder is self-defeating for lens #2 and the
 * capability layer's first ship was invisible at an emission rate of 0/7.
 *
 * WHY THIS IS INSIDE THE LOCKED DOCTRINE, NOT AGAINST IT: item 5 says "most
 * USEFUL available lens". A lens the user was shown seconds ago has diminishing
 * usefulness; on consecutive turns, diversity IS usefulness. The rule therefore
 * refines what "most useful" means over time rather than re-ranking the lenses.
 *
 * ── AMENDMENT 2.211-①, 2026-07-31 (founder-ratified): CORRELATED-ONLY YIELD ──
 * The ORDER above is still not changed. What is narrowed is rule 1's TRIGGER:
 * when flip-risk's hit is `FLIP_RISK_CORRELATED` — which, by the evaluator's
 * isolated-first precedence, already means NO isolated flip factor exists — AND
 * at least one other lens is triggered with an available executor on the same
 * turn, flip-risk YIELDS the head slot: it steps to the END of this turn's
 * eligible ladder, and the no-immediate-repeat tie-break below then runs
 * unchanged over the adjusted ladder. An ISOLATED hit keeps priority 1
 * unconditionally; a CORRELATED hit with nothing else triggered still emits
 * (yielding to nothing would be suppression, which is not the ruling).
 *
 * EVIDENCE: `PHASE0-EVIDENCE-2026-07-28/probe-premortem-chain-final.md` — a
 * 12-turn live walk on staging: `sensitivity_flip_risk` won the lens race
 * 12/12 (10 on `FLIP_RISK_CORRELATED`, 2 on `FLIP_RISK_ISOLATED`); pre_mortem
 * and EVPI emitted 0/12 with their own triggers simultaneously true on several
 * turns. The correlated claim is the WEAKEST rule-1 door ("flips only in
 * combination"), yet it was preempting every stronger-fit lens below it.
 *
 * WHY YIELD-TO-END RATHER THAN REMOVAL: removal would make the walk's dominant
 * shape (correlated + pre-mortem triggering together every turn) emit
 * pre_mortem unboundedly — recreating the monotony the no-repeat amendment
 * exists to kill, and suppressing a genuinely-triggered lens in steady state.
 * Demoted-to-end, the steady state alternates (pre_mortem leads, correlated
 * flip-risk surfaces only as the no-repeat alternate), and the locked order
 * among the OTHER lenses is untouched.
 *
 * PURITY IS PRESERVED. The selector gains exactly ONE input —
 * {@link LensSelectorOptions.previousAnalysisLens} — and stays a pure function
 * of (fact, options). It performs no read of its own; the caller derives the
 * previous lens from state the pipeline already holds (see
 * `compose/lens-history.ts`, which REPLAYS this same function over the prior
 * `run_analysis` facts rather than persisting a new "last lens" column — a
 * stored copy would be a hand-maintained mirror of a pure derivation, the
 * dominant defect class in this estate).
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

import {
  readFlipClaimPosture,
  type FlipClaimPosture,
} from '../context/flip-threshold-rows.js';
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
  // sensitivity_flip_risk — ROADMAP 2.278 attested-no-flip counterparts. Same
  // lens, same subject factor, same live action; the flippability CLAIM is
  // dropped because this run's own flip evidence contradicts it. See
  // `evaluateSensitivityFlipRisk` for the remap and why it is not a suppression.
  | 'SENSITIVITY_ISOLATED_NO_FLIP'
  | 'SENSITIVITY_CORRELATED_NO_FLIP'
  | 'DOMINANT_DRIVER_NO_FLIP'
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
  /**
   * ROADMAP 2.211 / 2.211-① — set ONLY when a tie-break moved the slot: either
   * the no-immediate-repeat rule or the correlated-only yield displaced the
   * lens that would otherwise have won it. Carries the DISPLACED lens so the
   * emitter can log the (displaced, chosen) pair; absent on every turn where
   * the head lens won normally. Which rule moved the slot is discriminated by
   * {@link displacementCause} — the two fields are present together or absent
   * together. CEE-INTERNAL: never a wire field.
   *
   * When BOTH rules act on one turn (a correlated yield whose beneficiary is
   * itself an immediate repeat, pushed on by no-repeat), the recorded pair is
   * the PROXIMATE displacement — the no-repeat one — because that is the
   * decision that placed the final lens.
   *
   * It lives on the SELECTION rather than being emitted from inside
   * `selectLens` on purpose — the selector is a pure function and must stay
   * one. The observable event is fired by the caller that actually places the
   * block (`buildLensSurface`), which is also the only place that knows the
   * graph hash to stamp on it.
   */
  readonly displacedLens?: LensId;
  /**
   * ROADMAP 2.211-① — WHY the slot moved, present exactly when
   * {@link displacedLens} is: `'no_repeat'` for the 2.211 tie-break,
   * `'correlated_yield'` for the correlated-only yield. CEE-INTERNAL.
   */
  readonly displacementCause?: 'no_repeat' | 'correlated_yield';
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
  /**
   * ROADMAP 2.211 (the no-immediate-repeat amendment — see the module header).
   * The lens that won the slot on the IMMEDIATELY-PRECEDING analysis turn of
   * this scenario, or `null` / omitted when there was no preceding analysis
   * turn (a first run, or one that recommended nothing, or one that has aged
   * out of the caller's fact window).
   *
   * "Analysis TURN", not "turn": the unit is a `run_analysis` fact. A
   * non-analysis turn that re-presents an earlier analysis through the
   * prior-fact lifecycle branch re-shows that analysis's own lens and does NOT
   * count as a preceding analysis turn — see `compose.ts`, which passes this
   * only on the current-turn fresh branch.
   *
   * Omitted / `null` ⇒ byte-identical to the pre-amendment selection. This is
   * the fail-safe direction: an unavailable history can only cost diversity,
   * never manufacture or suppress a lens.
   */
  readonly previousAnalysisLens?: LensId | null;
}

function isLensExecutorAvailable(lens: LensId, options?: LensSelectorOptions): boolean {
  if (LENS_EXECUTOR_INTRINSICALLY_AVAILABLE[lens]) return true;
  return options?.executorAvailable?.[lens] ?? false;
}

/**
 * The ROADMAP 1.195 enable-gate for the what-if counterfactual SUGGESTION,
 * expressed as a code constant (the no-env-gates doctrine — activation is a
 * reviewed code change, never a runtime bit).
 *
 * ── CLEARED 2026-08-03 (L44 activation lane), AND THE ARGUMENT MATTERS ──────
 * This shipped `false` pending items 2/3/4 — the live ISL model-fidelity probe,
 * the owner-placement ruling (CEE-2nd-interpreter vs PLoT proxy) and the
 * target-semantics confirmation (cap/baseline, not the flip `tipping_point`).
 * All three are claims about the NUMBER an EXECUTED counterfactual returns.
 * This constant does not gate an execution. It gates whether the coach ever
 * OFFERS the lens, and the offer was derived at the bytes to be number-free:
 *
 *   - the suggestion is a prose-only `coaching` block with `target_refs: []`
 *     (`phase3-blocks.ts::buildLensSurface`), rendered from the fixed
 *     {@link TITLE_BY_LENS} / {@link BODY_BY_RATIONALE} pair — prose-guard-clean
 *     by test, so no factor id, cap, baseline, tipping point or decimal can ride;
 *   - its structured companion set is EMPTY BY CONSTRUCTION:
 *     `buildLensCompanionBlocks` returns `[]` for `what_if_counterfactual`;
 *   - {@link evaluateWhatIfCounterfactual} is a pure read of the already-computed
 *     influence ranking — clearing this issues no ISL call.
 *
 * The what-if EXECUTOR (explicit `what_would_flip`) has been live and ungated on
 * staging since #659, so the capability the offer points at is one the user can
 * already reach. Items 2/3/4 therefore remain OPEN and remain binding on the
 * EXECUTED-number surfaces (ROADMAP 1.350 M2/M3) — they are not closed by this
 * change, and nothing here should be read as closing them.
 *
 * Item 1 (transport: `ISL_BASE_URL` set / `createCounterfactualClient() !== null`)
 * is STILL ANDed in separately at the call site via
 * {@link whatIfSuggestionExecutorAvailable} — the fail-closed leg is intact, and
 * a test asserts it (activating this did not make the gate unconditional).
 *
 * Blast radius is bounded by position: `what_if_counterfactual` is LAST on the
 * priority ladder in {@link selectLens}, so it can only occupy a slot no other
 * lens claimed. Rollback = revert this constant.
 */
export const WHATIF_SUGGESTION_GATE_CLEARED = true;

/**
 * Whether the what-if counterfactual SUGGESTION may be offered: the ROADMAP 1.195
 * enable-gate ({@link WHATIF_SUGGESTION_GATE_CLEARED}, cleared 2026-08-03) AND the
 * ISL transport being configured (item 1, `createCounterfactualClient() !== null`,
 * passed as `islTransportConfigured`). Fail-closed: ANY unmet item ⇒ `false` —
 * with the constant cleared the TRANSPORT leg is now the live one, and it is
 * still ANDed, not folded away. Pure + directly testable so the gate is a
 * mutation witness (revert the constant or drop the transport ⇒ `false`).
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
  /**
   * ROADMAP 2.278 — this run's own answer to "may copy claim the result could
   * flip?", derived from `enrichment.flip_thresholds[]`. Read here rather than
   * threaded from the caller so the selector stays a pure, total function of
   * `fact.result.enrichment` (the property `lens-history.ts` replays on).
   */
  readonly flipClaimPosture: FlipClaimPosture;
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

  return {
    factors,
    optionWinProbabilities,
    confidenceTier,
    flipClaimPosture: readFlipClaimPosture(enrichment),
  };
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

/**
 * Rule 1 — sensitivity / flip-risk (highest-priority lens).
 *
 * ⚠ ROADMAP 2.278 — THIS RULE'S EVIDENCE AND THIS RULE'S COPY CAME FROM
 * DIFFERENT PLACES, AND THEY CONTRADICTED EACH OTHER ON LIVE TURNS.
 *
 * Doors 1a and 1b both key off ROBUSTNESS MARGINALS —
 * `factor_sensitivity[].flip_risk_category` and `influence_score` — which are
 * non-zero on very nearly every run. The copy they select, however, makes a
 * claim about FLIPPING. The evidence for flipping is `enrichment.flip_thresholds[]`,
 * which sits on the SAME enrichment object this evaluator already reads and was
 * never consulted.
 *
 * Measured consequence (`witness-2267-onscreen-flip.md`, four staging turns,
 * 2026-08-01): 19 of 19 flip rows came back `structurally_invariant` — ISL's
 * closed-form proof that no factor can move the winner at all — while 10 of 19
 * factors carried `flip_risk_category: 'isolated'` (8 correlated, 1 negligible).
 * ⚠ That tally read "11" until adversarial review recounted it: an arithmetic
 * slip in a hand-asserted number that the fixture makes derivable. Derive it.
 * It is asserted mechanically in `__tests__/flip-claim-posture.test.ts`. Every one of those turns
 * selected `FLIP_RISK_ISOLATED` and told the user "a small change to it alone
 * could flip the outcome" about a factor that had just been proved unable to
 * flip anything.
 *
 * The remap below is NOT a suppression and must not be turned into one. The
 * factor is still the dominant driver, the lens is still the most useful one,
 * and `what_would_flip` is still a live action that answers honestly on these
 * turns ("no single factor reached a tipping point"). What changes is the
 * CLAIM: from "this could flip the result" to "this carries the margin". A
 * `permitted` posture — including every run with no flip evidence at all —
 * leaves the original rationale codes and copy byte-identical.
 */
function evaluateSensitivityFlipRisk(signals: AnalysisSignals): EvaluatorHit | null {
  // The run's own answer to "may we claim this could flip?". `attested_no_flip`
  // ONLY on a positive producer attestation across every usable row; every
  // uncertain state is `permitted` (see `readFlipClaimPosture`).
  const noFlip = signals.flipClaimPosture === 'attested_no_flip';

  // 1a — an explicit PLoT flip-risk flag on any factor. `isolated` (this factor
  // can flip the result on its own) is the strongest single-factor signal and
  // takes precedence; `correlated` (flips only in combination with others) is a
  // weaker, honestly distinct claim. `negligible` never fires.
  const isolated = signals.factors.find(
    (f) => f.flipRiskCategory === FLIP_RISK_ISOLATED_CATEGORY,
  );
  if (isolated) {
    return {
      code: noFlip ? 'SENSITIVITY_ISOLATED_NO_FLIP' : 'FLIP_RISK_ISOLATED',
      subjectFactorId: isolated.factorId,
    };
  }

  const correlated = signals.factors.find(
    (f) => f.flipRiskCategory === FLIP_RISK_CORRELATED_CATEGORY,
  );
  if (correlated) {
    return {
      code: noFlip ? 'SENSITIVITY_CORRELATED_NO_FLIP' : 'FLIP_RISK_CORRELATED',
      subjectFactorId: correlated.factorId,
    };
  }

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
      // DOMINANT_DRIVER's copy ends "…how far it can move before the leading
      // option changes", which presupposes the leading option CAN change. On an
      // attested-no-flip run it cannot, so this door is remapped too.
      return {
        code: noFlip ? 'DOMINANT_DRIVER_NO_FLIP' : 'DOMINANT_DRIVER',
        subjectFactorId: top.factorId,
      };
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

  // ── ROADMAP 2.278 — the attested-no-flip counterparts ──────────────────────
  // What is TRUE on these turns and what is NOT, because the copy turns on it:
  // the robustness Monte Carlo reports the result is not stable (`is_robust:
  // false`, `level: very_low` on all four witnessed turns) while ISL's
  // closed-form flip evaluation proves no factor can move the WINNER at all.
  // Those are not in conflict — they are two different questions. WHICH option
  // leads is settled; HOW FAR ahead it is, is not. So the honest lens keeps
  // pointing at the same driver and re-aims the claim from the ranking to the
  // margin. No flip verb appears in any of these three.
  SENSITIVITY_ISOLATED_NO_FLIP:
    'This factor moves the result more than any other. The analysis swept its whole tested range and the ranking never changed, so what is still open is the size of the gap, not the order. Pressure-testing this factor tells you how much of the margin rests on it.',
  SENSITIVITY_CORRELATED_NO_FLIP:
    'This factor moves the result alongside others rather than on its own. The analysis swept each factor in turn across its tested range and the order never changed on any of them, so what is still open is the size of the gap, not the order. Pressure-testing this factor tells you how much of the margin rests on it.',
  DOMINANT_DRIVER_NO_FLIP:
    'One factor is doing most of the work in this result. The analysis swept its tested range without the ranking changing, so a sensitivity check here tells you how much of the margin it carries rather than whether the order would hold.',
};

/**
 * ROADMAP 2.278 — per-RATIONALE title override, applied over
 * {@link TITLE_BY_LENS}. Sparse by design: a rationale absent from this map
 * takes its lens's shared title, so the default path is byte-identical to
 * pre-2.278 behaviour and only the attested-no-flip rationales differ.
 *
 * Why the shared title needed replacing at all: "pressure-test the key driver"
 * is not itself a false claim on an attested-no-flip turn — you can pressure-test
 * a result whose ranking is settled — but it is the headline of a card whose
 * whole body used to be about flipping, and read beside a `fragile` verdict it
 * invites the same inference. These titles say what the card now actually does.
 */
const TITLE_OVERRIDE_BY_RATIONALE: Partial<Readonly<Record<LensRationaleCode, string>>> = {
  SENSITIVITY_ISOLATED_NO_FLIP: 'Strengthen your model: size up the key driver',
  SENSITIVITY_CORRELATED_NO_FLIP: 'Strengthen your model: size up the key driver',
  DOMINANT_DRIVER_NO_FLIP: 'Strengthen your model: size up the key driver',
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
  // 2.278 counterparts ground in the same field as the rationales they replace:
  // the claim is still about factor sensitivity, only narrowed to the margin.
  SENSITIVITY_ISOLATED_NO_FLIP: 'factor_sensitivity',
  SENSITIVITY_CORRELATED_NO_FLIP: 'factor_sensitivity',
  DOMINANT_DRIVER_NO_FLIP: 'factor_sensitivity',
  // The what-if claim is about the OUTCOME (option win probability) → grounds in
  // option_comparison, which is deliberately NOT allow-listed, so the σ cage
  // DENIES surfacing its value: the counterfactual outcome number stays omitted
  // until Neil rules (doctrine-pending) — an honest double-lock alongside the
  // 1.195 enable gate.
  WHATIF_EXPLORE_DRIVER: 'option_comparison',
};

/**
 * ROADMAP 2.278 amendment — the rationale codes that YIELD the head slot under
 * the 2.211-① correlated-only rule.
 *
 * ⚠ THIS WAS A ONE-STRING MIRROR AND IT BROKE ON THE FIRST NEW CODE. The yield
 * test matched the literal `'FLIP_RISK_CORRELATED'`, so the moment 2.278 added
 * `SENSITIVITY_CORRELATED_NO_FLIP` — the SAME weakest-door claim, merely with
 * the flip language removed — that code silently stopped yielding and would
 * have preempted every stronger-fit lens below it, re-creating exactly the
 * monotony 2.211-① was ratified to kill. Caught in adversarial review, not by
 * a test. A set, named for the PROPERTY it encodes (a correlated-only door),
 * so the next counterpart is added here rather than discovered in a walk.
 */
const CORRELATED_YIELD_CODES: ReadonlySet<LensRationaleCode> = new Set([
  'FLIP_RISK_CORRELATED',
  'SENSITIVITY_CORRELATED_NO_FLIP',
]);

function buildSelection(
  lens: LensId,
  hit: EvaluatorHit,
  displacedLens?: LensId,
  displacementCause?: 'no_repeat' | 'correlated_yield',
): LensSelection {
  return {
    lens,
    rationaleCode: hit.code,
    title: TITLE_OVERRIDE_BY_RATIONALE[hit.code] ?? TITLE_BY_LENS[lens],
    body: BODY_BY_RATIONALE[hit.code],
    groundingField: GROUNDING_FIELD_BY_RATIONALE[hit.code],
    // Wave-4 δ2: expose the focus subject when the lens points at a single
    // factor. Omitted (undefined) for subject-less rationales → the directive
    // defers to the v1 highlight (never fabricates a target).
    ...(hit.subjectFactorId !== null
      ? { subjectRef: { id: hit.subjectFactorId, kind: 'factor' as const } }
      : {}),
    // ROADMAP 2.211 / 2.211-①: present ONLY on a displacement (either cause),
    // so the absence of the keys is itself the "the head lens won normally"
    // assertion (and `toStrictEqual` against a pre-amendment selection stays
    // exact). The pair is set together or not at all.
    ...(displacedLens !== undefined && displacementCause !== undefined
      ? { displacedLens, displacementCause }
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

  // THE PRIORITY LADDER, unchanged and still the only ordering in this file.
  // Materialised as a list rather than four sequential early-returns purely so
  // the 2.211 tie-break can ask "is there a NEXT one?" — the ladder's ORDER and
  // its per-lens executor gate are byte-identical to the early-return form, and
  // an empty list still means "recommend nothing".
  const ladder: readonly (readonly [LensId, EvaluatorHit | null])[] = [
    ['sensitivity_flip_risk', evaluateSensitivityFlipRisk(signals)],
    ['pre_mortem', evaluatePreMortem(signals)],
    ['evpi_evidence_priority', evaluateEvpiEvidencePriority(signals)],
    ['what_if_counterfactual', evaluateWhatIfCounterfactual(signals)],
  ];
  const eligible: { lens: LensId; hit: EvaluatorHit }[] = [];
  for (const [lens, hit] of ladder) {
    if (hit !== null && isLensExecutorAvailable(lens, options)) eligible.push({ lens, hit });
  }

  // Load-bearing negative: no lens whose evidence fired has an available executor.
  const eligibleHead = eligible[0];
  if (eligibleHead === undefined) return null;

  // ROADMAP 2.211-① — THE CORRELATED-ONLY YIELD (founder-ratified; module
  // header). Two conditions, both required:
  //   (1) the eligible head is flip-risk on its CORRELATED hit — the weakest
  //       rule-1 door, and by evaluator precedence one that only exists when NO
  //       isolated flip factor does ("only because of correlated" holds by
  //       construction), and
  //   (2) at least one OTHER lens fired with an available executor.
  // Then flip-risk steps to the END of this turn's ladder — a yield, not a
  // removal: it remains the last-resort alternate (so the no-repeat tie-break
  // below can still alternate onto it rather than repeating the beneficiary),
  // and with nothing else triggered the condition (2) guard means it still
  // emits (yield-to-nothing would be suppression, which is not the ruling).
  // An ISOLATED or DOMINANT_DRIVER hit never yields. The order of the OTHER
  // lenses is untouched — this narrows rule 1's trigger; it does not re-rank
  // the locked ladder.
  let slotOrder: readonly { lens: LensId; hit: EvaluatorHit }[] = eligible;
  let yieldedLens: LensId | undefined;
  if (
    eligibleHead.lens === 'sensitivity_flip_risk' &&
    CORRELATED_YIELD_CODES.has(eligibleHead.hit.code) &&
    eligible.length > 1
  ) {
    slotOrder = [...eligible.slice(1), eligibleHead];
    yieldedLens = eligibleHead.lens;
  }

  const head = slotOrder[0]!;

  // ROADMAP 2.211 — NO IMMEDIATE REPEAT, over the (possibly yield-adjusted)
  // ladder. Two conditions, both required:
  //   (1) the head lens is the SAME lens the immediately-preceding analysis turn
  //       of this scenario selected, and
  //   (2) a NEXT lens exists that ALSO fired and ALSO has an available executor.
  // Condition (2) is what makes a single-trigger repeat correct rather than a
  // suppression: with nothing to move to, the head stands. The replacement is
  // taken from the SAME ladder in the SAME order, so this is a tie-break within
  // the locked priority, never a re-ranking of it. `next` is never equal to
  // `head` (each lens appears once), so one displacement cannot cascade.
  const runnerUp = slotOrder[1];
  if (
    options?.previousAnalysisLens != null &&
    options.previousAnalysisLens === head.lens &&
    runnerUp !== undefined
  ) {
    return buildSelection(runnerUp.lens, runnerUp.hit, head.lens, 'no_repeat');
  }

  return buildSelection(
    head.lens,
    head.hit,
    yieldedLens,
    yieldedLens !== undefined ? 'correlated_yield' : undefined,
  );
}
