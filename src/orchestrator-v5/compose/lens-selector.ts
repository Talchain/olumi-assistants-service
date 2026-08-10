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
 * ── AMENDMENT, DSK slice 1 (2026-08-05): TWO DSK-DERIVED LENSES ─────────────
 * `consider_opposite` (DSK-TR-003 → protocol DSK-P-003, disconfirmation) and
 * `devils_advocacy` (DSK-TR-005 → DSK-P-005, structured dissent) are now
 * selectable, below the three locked core lenses and above the what-if
 * extension. Their triggers are pure computable-fact readings of the bundle's
 * own trigger objects (see the evaluators + `LENS_DSK_PROVENANCE`); their
 * executors are the deterministic ExerciseBlock companions emitted the same
 * turn. An earlier revision of this header said "richer devil's advocacy" was
 * deferred for want of compute — the DSK trigger's actual observable (a
 * dominant factor) is computable from the enrichment we already read, so the
 * deferral no longer applied. (TR-005's declared `robustness != 'fragile'`
 * clause is deliberately NOT implemented — ROADMAP 2.490; the reasoning lives
 * on {@link evaluateDevilsAdvocacy} and nowhere else.) Outside view REMAINS
 * deferred, twice over: DSK-TR-002's signal is a conversation-text heuristic
 * the bundle itself labels "not production quality" (not a compose-time graph
 * fact), and its `reference_class` content must come from the user or real
 * evidence — a deterministic template would fabricate exactly what the
 * protocol exists to elicit.
 */

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  readFlipClaimPosture,
  type FlipClaimPosture,
} from '../context/flip-threshold-rows.js';
import {
  readRawRobustnessSignals,
  type RawRobustnessSignals,
} from '../coaching/pick-raw-robustness.js';
import {
  selectFragileEdge,
  type FragileEdgeDecision,
  type FragileEdgeSelection,
} from '../coaching/select-fragile-edge.js';
import { isRawFragile } from '../coaching/robustness-honesty.js';
import { isFragileEdgeOfferComposable } from '../coaching/fragile-edge-offer-text.js';
import {
  selectUncertaintyPriority,
  type UncertaintyPriorityDecision,
} from '../coaching/uncertainty-priority.js';
import {
  tierForCandidate,
  tierRank,
  type InterventionTier,
} from '../coaching/intervention-tiers.js';
import {
  bandConfidence,
  isLensLowConfidence,
  type ConfidenceBand,
} from './confidence-bands.js';

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
  | 'fragile_edge_resolution'
  | 'consider_opposite'
  | 'devils_advocacy'
  | 'what_if_counterfactual'
  /**
   * ROADMAP 2.692 — the uncertainty this run's result is most SENSITIVE to,
   * named only when ISL's own noise-floor test resolved it. See
   * {@link evaluateUncertaintyReductionPriority} and
   * `coaching/uncertainty-priority.ts` — including the refuted premise that this
   * quantity is a value-of-information.
   */
  | 'uncertainty_reduction_priority';

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
  // fragile_edge_resolution (ROADMAP 2.989) — one specific relationship in the
  // graph is the thing most worth resolving next, and the platform can perform
  // the change. See `coaching/select-fragile-edge.ts` for the gates.
  | 'FRAGILE_EDGE_RESOLVABLE'
  // uncertainty_reduction_priority (ROADMAP 2.692) — ISL's `p_win_sensitivity`
  // marked ONE factor `status: 'resolved'`, i.e. removing that factor's
  // uncertainty moved the run's metric by more than its own noise floor. ⚠ This
  // is NOT a value-of-information claim and must never be copy-written as one —
  // the producer states it "structurally cannot capture option-switching".
  | 'RESOLVED_PWIN_SENSITIVITY'
  // consider_opposite (DSK-TR-003 → DSK-P-003 disconfirmation)
  | 'CLEAR_WINNER_DISCONFIRMATION' // a decisive, attested-non-fragile leader invites structured disconfirmation
  // devils_advocacy (DSK-TR-005 → DSK-P-005 devil's advocate)
  | 'DOMINANT_FACTOR_DISSENT' // one factor carries the result and the analysis is not already challenging it
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
  | 'option_comparison'
  // ROADMAP 2.989 — the fragile-edge lens grounds in `robustness`, which IS in
  // the A1-seeded Tier-2 allow-list (`claim-safety-cage.ts::TIER2_CANDIDATE_FIELDS`)
  // and has a strict companion value schema. The lens still ships NUMBER-FREE
  // (see the copy note on BODY_BY_RATIONALE) — the grounding field is declared
  // so the cage is a live caller on the field the claim is about, per wave-3 σ.
  //
  // ⚠ NOT `edge_e_values`. That field is a RATIFIED TIER-3 DENY key: the
  // selector reads it as a structured gate only and no quantity from it may
  // ever be surfaced. Declaring it here would ask the cage a question whose
  // only answer is `tier3_denied`.
  | 'robustness'
  // ROADMAP 2.692 — the uncertainty lens grounds in the field its claim is
  // about. `p_win_sensitivity` is NOT on the Tier-2 allow-list, so the cage's
  // answer is `not_allowlisted`: a live, organically-observable DENIAL, exactly
  // like `option_comparison` today. The lens ships number-free, so the denial
  // costs nothing and the cage becomes a live caller on the real field.
  | 'p_win_sensitivity';

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
  /**
   * ROADMAP 2.989 — the ONE fragile relationship this lens is about. Present
   * exactly when `lens === 'fragile_edge_resolution'`.
   *
   * It rides on the SELECTION rather than being re-derived at the block-mint
   * site for the same reason `buildLensSurface` returns the pair rather than
   * re-calling `selectLens`: two derivations of one fact over inputs a future
   * refactor can let diverge is the `generateGraphHash`-twins shape (trap
   * 12/16). One selection, threaded. CEE-INTERNAL — never a wire field; the
   * block mint projects it into `target_refs` and the action prompt.
   */
  readonly fragileEdge?: FragileEdgeSelection;
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

/**
 * Rule 4 (consider_opposite, DSK-TR-003) — the leader must be clear of the
 * runner-up by at least this much. This is TR-003's own negative condition
 * ("Do not fire if the analysis shows a close call (separation <10%) — the
 * model already reflects uncertainty") made explicit. With normalised win
 * probabilities a ≥0.7 leader always clears it; the guard exists for the
 * defensive-read case where a producer emits non-normalised values.
 */
export const CONSIDER_OPPOSITE_MIN_SEPARATION = 0.1;

/**
 * DSK provenance for the lenses whose TRIGGER RULE is a computable-fact
 * derivation of a specific `data/dsk/v1.json` trigger object.
 *
 * ⚠ NO LONGER CEE-INTERNAL — corrected at the 0.37.0 pin (ROADMAP 2.490 slice
 * 2). This comment used to read "the ExerciseBlock wire shape at schemas
 * 0.32.0 is `.strict()` with no dsk field, so this provenance rides TELEMETRY
 * (the lens suggestion event), not the wire". That was true when written and is
 * FALSE now: 0.37.0 adds `ExerciseBlock.dsk_provenance`, and
 * `phase3-blocks.ts:buildDskExerciseBlock` reads `protocolId` from THIS map to
 * fill it, so a wrong id here is now user-visible rather than telemetry-only.
 * Only the ID travels from this map — the title and evidence strength are read
 * from the bundle record by `dsk-protocol-record.ts` and are never typed in
 * this repo.
 *
 * HAND-WRITTEN map, so per trap 12 it fails loud on drift:
 * `dsk-provenance-attestation.test.ts` asserts every id here against the
 * bundle BYTES (exists, right type, non-deprecated, trigger links protocol).
 * The three original lenses are deliberately ABSENT — their rules predate the
 * bundle and differ from DSK-TR-001's conditions; claiming provenance they do
 * not have would be a false label (trap 14).
 */
export const LENS_DSK_PROVENANCE: Partial<
  Readonly<Record<LensId, { readonly protocolId: string; readonly triggerId: string }>>
> = {
  consider_opposite: { protocolId: 'DSK-P-003', triggerId: 'DSK-TR-003' },
  devils_advocacy: { protocolId: 'DSK-P-005', triggerId: 'DSK-TR-005' },
};

/**
 * ⚠ THE DSK "DO NOT RUN IMMEDIATELY AFTER" CONTRAINDICATIONS — AND WHY THE
 * 2.211 DIVERSITY RULE POINTS THE WRONG WAY WITHOUT THEM.
 *
 * Verbatim from the bundle (`data/dsk/v1.json`, protocol `contraindications`):
 *   DSK-P-003 (disconfirmation) — "Do not run immediately after the user has
 *     already run a pre-mortem on the same decision"
 *   DSK-P-005 (devil's advocate) — "Do not run immediately after a pre-mortem
 *     or disconfirmation exercise on the same decision"
 *
 * 2.211's no-immediate-repeat hands a repeated head's slot to the RUNNER-UP.
 * With these lenses on the ladder that promotion produces exactly the sequence
 * the protocols forbid: measured before this filter, `pre_mortem` on turn N
 * yielded `consider_opposite` on turn N+1 with `displacementCause: 'no_repeat'`.
 * The diversity heuristic and the protocol's own science disagreed, and the
 * science wins — a platform that ships a decision-science bundle must not emit
 * the sequence that bundle contraindicates.
 *
 * NO NEW PERSISTENCE IS NEEDED for this case, which is why it is here and not
 * deferred: `previousAnalysisLens` is already threaded for 2.211, so
 * "immediately after" is answerable from inputs the selector already has. The
 * filter removes the lens from the ELIGIBLE set (not merely from the head), so
 * a runner-up promotion cannot re-introduce it.
 *
 * THE ASYMMETRY IS THE BUNDLE'S AND MUST NOT BE TIDIED: P-003 names only the
 * pre-mortem; P-005 names the pre-mortem AND disconfirmation. Making these two
 * sets symmetric would suppress a protocol its own science permits — pinned by
 * a test.
 *
 * ⚠ ACCEPTED TRADE-OFF: THIS FILTER CAN CAUSE THE pre_mortem REPEAT THAT 2.211
 * EXISTS TO PREVENT. When the only lens available to take a repeated
 * `pre_mortem` head's slot is a contraindicated one, removing it leaves nothing
 * to promote, so 2.211's condition (2) fails and the repeat stands — the user
 * sees the pre-mortem lens twice running. That is the correct direction:
 * DSK-P-001 carries NO immediately-after clause (its contraindications are
 * "only one option / no meaningful alternatives" and "already identified
 * fragile edges and wants to proceed" — verified at the bundle bytes), so a
 * repeated pre-mortem is merely monotonous, whereas the promotion it replaces
 * would have been a sequence the bundle explicitly forbids. Monotony is a UX
 * cost; a contraindicated sequence is a science defect. Stated here because it
 * is a real regression against 2.211's intent and must not be discovered as a
 * surprise.
 *
 * SCOPE, STATED HONESTLY (this note replaces an earlier one that framed the
 * whole cooldown class as un-implementable — a false label the next slice would
 * have inherited): what is NOT covered is the GENERAL cooldown class — "already
 * fired for this decision in this stage", "user has already completed a
 * structured risk assessment", "already run this exercise this stage". Those
 * need a persisted per-stage fired-ledger the selector has no input for today,
 * and they remain slice-2 work. What IS covered is precisely the
 * immediately-after ordering, on the immediately-preceding ANALYSIS turn.
 */
const CONTRAINDICATED_IMMEDIATELY_AFTER: Partial<
  Readonly<Record<LensId, ReadonlySet<LensId>>>
> = {
  consider_opposite: new Set<LensId>(['pre_mortem']),
  devils_advocacy: new Set<LensId>(['pre_mortem', 'consider_opposite']),
};

/**
 * Is `lens` contraindicated because of what ran on the immediately-preceding
 * analysis turn? Absent history ⇒ never contraindicated (the fail-safe
 * direction: an unavailable history can only cost the filter, never
 * manufacture a suppression).
 */
function isContraindicatedAfter(lens: LensId, previous: LensId | null | undefined): boolean {
  if (previous == null) return false;
  return CONTRAINDICATED_IMMEDIATELY_AFTER[lens]?.has(previous) ?? false;
}

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
  // ROADMAP 2.989: the executor is the `edit_graph` path, which is live and
  // ungated — the composed acceptance turn passes EDIT_GRAPH_POSITIVE_REGEX,
  // clears EDIT_GRAPH_NEGATIVE_REGEX (asserted in-test against the imported
  // regexes, never eyeballed) and resolves to the `adjust_edge_strength`
  // handler registered at `tools/registry.ts`. The lens is only ever selected
  // when `selectFragileEdge` returned a row, so the offer names a relationship
  // the platform can actually change — 2.770, no inert chips.
  fragile_edge_resolution: true,
  // DSK slice 1: the executor for each DSK lens is the deterministic
  // ExerciseBlock companion emitted on the SAME turn (fixed copy, no
  // transport, no producer-content dependency) plus the conversational
  // follow-through — intrinsically present on the live path.
  consider_opposite: true,
  devils_advocacy: true,
  what_if_counterfactual: false,
  // ROADMAP 2.692: the executor is the SAME live `gather_evidence` /
  // investigate-this-factor path the EVPI lens already points at — the offer is
  // "test this assumption first", which the user can act on today. No new
  // transport, no producer-content dependency: intrinsically present.
  uncertainty_reduction_priority: true,
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
  /**
   * ROADMAP 2.989 — the fragile-edge decision, THREADED rather than recomputed.
   *
   * `selectFragileEdge` is pure and total, so computing it here or at the caller
   * gives the same answer; the option exists because the CALLER also has to emit
   * the decision's telemetry (`v5.capability.fragile_edge_selection`, BOTH arms
   * — a refusal is an outcome, not a non-event), and a selector that emitted it
   * itself would stop being pure.
   *
   * Omitted ⇒ `readAnalysisSignals` computes it from the same enrichment, so
   * every existing `selectLens` caller (`compose/lens-history.ts`'s replay,
   * `compose/ui-directive.ts`) keeps working unchanged and sees the identical
   * selection. Pinned by a threaded-vs-omitted equality test.
   */
  readonly fragileEdge?: FragileEdgeDecision;
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
  /**
   * ROADMAP 2.681 — the LADDER's low-confidence signal, which is NOT
   * `confidenceBand === 'low'` and must not be re-derived from it.
   *
   * `confidenceBand` is the DISPLAY band, pinned to the boundary PLoT already
   * showed the user (< 0.4 → "low"). This flag is the ladder's own trigger
   * question — "is the top factor uncertain enough to outrank the other
   * coaching exercises?" — pinned at the historical < 0.3. See
   * `confidence-bands.ts` for why the two numbers differ and what happens if
   * they are merged (measured: it starves both DSK exercises on live captures).
   */
  readonly lensLowConfidence: boolean;
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
  /**
   * DSK slice 1 — the RAW `enrichment.robustness` signals, through the shared
   * S4 normaliser (`readRawRobustnessSignals` — one normaliser, every caller;
   * `robustness-honesty.ts` owns the fragile truth table). `null` when the
   * producer emitted no robustness object. Consulted by ONE DSK trigger rule:
   * TR-003 states a POSITIVE robustness condition (an absent attestation must
   * NOT fire consider_opposite). TR-005's NEGATIVE clause was removed at
   * ROADMAP 2.490 — see {@link evaluateDevilsAdvocacy} for the override and
   * why the field it was implemented against does not measure the thing the
   * clause exists to detect.
   */
  readonly rawRobustness: RawRobustnessSignals | null;
  /**
   * ROADMAP 2.989 — the fragile-edge decision for this run (both arms). Read
   * through the shared pure selector so the ladder and the block mint cannot
   * disagree about which relationship the turn is about.
   */
  readonly fragileEdge: FragileEdgeDecision;
  /**
   * ROADMAP 2.692 — the uncertainty-priority decision for this run (both arms).
   * Read here rather than threaded, so the selector stays a pure, total function
   * of `fact.result.enrichment` — the property `lens-history.ts` replays on.
   */
  readonly uncertaintyPriority: UncertaintyPriorityDecision;
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
function readAnalysisSignals(
  fact: RunAnalysisHandlerFact,
  fragileEdge?: FragileEdgeDecision,
): AnalysisSignals | null {
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
        lensLowConfidence: isLensLowConfidence(e.confidence),
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
    rawRobustness: readRawRobustnessSignals(enrichment.robustness),
    // Threaded when the caller already computed it (so the caller can emit the
    // decision telemetry without a second derivation); otherwise computed here
    // from the same enrichment — the function is pure, so both routes agree.
    fragileEdge: fragileEdge ?? selectFragileEdge(enrichment),
    // Pure and total over the same enrichment — no option, no threading, so
    // the replay in `lens-history.ts` reproduces it by construction.
    uncertaintyPriority: selectUncertaintyPriority(enrichment),
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
  /** ROADMAP 2.989 — set ONLY by {@link evaluateFragileEdgeResolution}. */
  readonly fragileEdge?: FragileEdgeSelection;
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

  // 1b — one factor carries a STRICT majority share of total positive influence
  // (the shared dominance derivation). Behaviour-identical to the prior inline
  // trigger; additionally carries the dominating factor's id as the focus
  // subject.
  const dominant = findDominantDriver(signals);
  if (dominant !== null) {
    // DOMINANT_DRIVER's copy ends "…how far it can move before the leading
    // option changes", which presupposes the leading option CAN change. On an
    // attested-no-flip run it cannot, so this door is remapped too.
    return {
      code: noFlip ? 'DOMINANT_DRIVER_NO_FLIP' : 'DOMINANT_DRIVER',
      subjectFactorId: dominant.factorId,
    };
  }
  return null;
}

/**
 * Shared dominance derivation — ONE derivation, two callers (rule 1b above and
 * the devils_advocacy DSK rule below). Two inline copies of "which factor
 * dominates?" over the same fact is the two-derivations-of-one-fact shape this
 * module's own comments refuse (trap 12/16), so the extraction is the point,
 * not a convenience. A factor dominates when its influence_score is a STRICT
 * majority of the summed positive influence — scale-invariant, and two equal
 * halves do NOT trip it (only a genuine single dominator does).
 */
function findDominantDriver(
  signals: AnalysisSignals,
): (FactorSignal & { influenceScore: number }) | null {
  const scored = signals.factors.filter(
    (f): f is FactorSignal & { influenceScore: number } =>
      f.influenceScore !== null && f.influenceScore > 0,
  );
  if (scored.length === 0) return null;
  const total = scored.reduce((a, f) => a + f.influenceScore, 0);
  let top = scored[0]!;
  for (const f of scored) if (f.influenceScore > top.influenceScore) top = f;
  return total > 0 && top.influenceScore / total > DOMINANCE_SHARE_MIN ? top : null;
}

/** Rule 2 — pre-mortem: the decision is acceptance-plausible but fragile. */
function evaluatePreMortem(signals: AnalysisSignals): EvaluatorHit | null {
  // 2a — the overall analysis is usable but not solid (no single-factor subject).
  if (signals.confidenceTier === 'needs_work') {
    return { code: 'CONFIDENCE_NEEDS_WORK', subjectFactorId: null };
  }

  // 2b — the single most-influential factor is also the least certain.
  //
  // ⚠ ROADMAP 2.681 — reads `lensLowConfidence`, NOT `confidenceBand === 'low'`.
  // The display band moved to PLoT's 0.4 boundary to stop the product showing
  // two different confidence words for one factor; this trigger deliberately
  // stayed at the historical 0.3, because widening it reorders the coaching
  // ladder on 54% of live traffic and starves the two DSK exercises (measured
  // on the sessionA/sessionB2 captures). Byte-identical to pre-2.681 behaviour.
  // The two questions, and why they are not the same question, are written out
  // in `confidence-bands.ts`.
  const topRankLowConfidence = signals.factors.find(
    (f) => f.influenceRank === 1 && f.lensLowConfidence,
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
 * Rule 4 — consider_opposite (DSK slice 1: TR-003 → DSK-P-003 disconfirmation).
 *
 * The DSK trigger's observable signal, read at the computable facts:
 * "Analysis results show one option with win probability >70% AND robustness =
 * 'robust' or 'moderate'", with its own negative condition "do not fire on a
 * close call (separation <10%)". Mapping choices, stated because each is a
 * fidelity decision:
 *
 *   - DECISIVE region = `top ≥ PREMORTEM_WINPROB_MAX` — the exact complement
 *     of pre_mortem rule 2c's [MIN, MAX) band, SHARING the constant so the
 *     boundary cannot drift a gap or an overlap between the two rules.
 *   - The robustness condition is POSITIVE in the DSK ("robust or moderate"),
 *     so it requires an ATTESTED, non-fragile raw level: absent robustness
 *     does NOT fire (fail-closed), the shared `RAW_FRAGILE_LEVELS` truth table
 *     decides fragility (never a local copy), and the raw `near_tie.is_tie`
 *     override suppresses regardless of margin (upstream knows things the
 *     projection does not — robustness-honesty doctrine).
 *   - ≥2 finite win probabilities are required: with a single option there is
 *     no alternative to argue for, and no separation is computable.
 *
 * ⚠ THE ROBUSTNESS CHECK IS A DENYLIST IMPLEMENTING A POSITIVE CONDITION, AND
 * THAT MISMATCH IS DELIBERATE. DSK-TR-003 names an ALLOWLIST — "robustness =
 * 'robust' or 'moderate'" — but only half of that vocabulary is real. MEASURED
 * over this repo's fixtures (`robustness.level` values only, excluding the
 * distinct `robustness_band` / `robustness.score` / review-`severity` fields):
 * `moderate` (48), `low`, `high` (9), `very_low`, `stable`, `fragile`, and the
 * stray `mid` / `medium` — while **`robust` never appears as a level at all**.
 * So a literal `['robust','moderate']` allowlist would NOT be dead: it would
 * fire on the `moderate` turns, which are the most common single value here.
 * What it would do is MISS most live non-fragile turns — `high` (the level on
 * both live decision-review captures), `stable`, and the strays all sit outside
 * it — while its `robust` limb matched nothing ever.
 *
 * ⚠ An earlier revision of this comment said a literal allowlist "would match
 * NOTHING and ship this lens 100% dark". That was MEASURABLY FALSE (`moderate`
 * fires today) and is corrected here at the bytes rather than inherited — an
 * unverified correction is how the next false label lands (trap 7b). The
 * architectural decision is unchanged; only the justification was wrong.
 *
 * So the implemented rule is: an ATTESTED level that is not a known
 * fragile synonym. The consequence, stated rather than hidden: an unrecognised
 * level (`unknown`, `insufficient_data`, or a producer typo) reads as
 * non-fragile and CAN fire this lens. That is the accepted cost of not shipping
 * dark, it is bounded (the lens offers a reflective exercise; it makes no claim
 * about the robustness value itself), and the honest fix is a canonical
 * robustness vocabulary shared by producer and bundle — slice-2 work, not a
 * silent local allowlist.
 *
 * DSK negative conditions: the "do not run immediately after a pre-mortem"
 * contraindication IS enforced — see {@link CONTRAINDICATED_IMMEDIATELY_AFTER},
 * applied at eligibility in `selectLens`. The GENERAL per-stage fired-cooldown
 * ("already fired this stage", "user already completed a structured risk
 * assessment") is NOT: it needs a persisted ledger the selector has no input
 * for, and is slice-2 work rather than a silent claim.
 */
/**
 * Rule 3b (ROADMAP 2.989) — THE HIGHEST-VALUE ISSUE TO RESOLVE NEXT.
 *
 * Fires when, and only when, the shared pure selector
 * (`coaching/select-fragile-edge.ts`) returned ONE relationship that cleared
 * every gate: it joined an `edge_e_values` row on `(from_id, to_id)`, its
 * 10-seed stability band is non-degenerate, its source factor was not computed
 * from degenerate-fallback inputs, and both endpoint labels exist. There is no
 * threshold of this rule's own — the trigger IS the selector's verdict, so the
 * ladder and the block mint cannot disagree about whether an offer exists.
 *
 * `subjectFactorId` is deliberately `null`. The subject of this lens is an
 * EDGE, and {@link LensSubjectRef} is `kind: 'factor'` by contract — a
 * fragile edge's `from_id` is often a risk or outcome node (measured: four of
 * session-a's eleven rows), so stamping it as a factor would be a wrong-kind
 * label on the `focus` directive. With it absent the directive defers to the
 * v1 winner-highlight and fabricates nothing; the EDGE identity travels on the
 * block's own `target_refs` with the correct `kind: 'edge'` instead.
 */
function evaluateFragileEdgeResolution(signals: AnalysisSignals): EvaluatorHit | null {
  const edge = signals.fragileEdge.selected;
  if (edge === null) return null;
  return { code: 'FRAGILE_EDGE_RESOLVABLE', subjectFactorId: null, fragileEdge: edge };
}

/**
 * Rule 0 (ROADMAP 2.692) — THE UNCERTAINTY THIS RESULT IS MOST SENSITIVE TO.
 *
 * Fires when, and only when, the shared pure reader
 * (`coaching/uncertainty-priority.ts`) found a `p_win_sensitivity` row that
 * ISL's OWN noise-floor test marked `status: 'resolved'`. There is no threshold
 * of this rule's own — the trigger IS the producer's verdict, so CEE never
 * re-derives a statistical label from rounded wire values.
 *
 * ⚠ READ `coaching/uncertainty-priority.ts` BEFORE TOUCHING THE COPY. The design
 * brief this rule was commissioned from files `p_win_sensitivity` under "real
 * per-factor EVPI"; the producer says at its own bytes that it is "NOT
 * value-of-information" and "structurally cannot capture option-switching", and
 * that "calling it EVPI was a mislabel". The copy below therefore claims
 * SENSITIVITY, never decision value.
 *
 * `subjectFactorId` IS set: the subject is a factor by construction (the row is
 * keyed by `factor_id`), so the `focus` directive can point at it honestly.
 */
function evaluateUncertaintyReductionPriority(signals: AnalysisSignals): EvaluatorHit | null {
  const selected = signals.uncertaintyPriority.selected;
  if (selected === null) return null;
  return { code: 'RESOLVED_PWIN_SENSITIVITY', subjectFactorId: selected.factorId };
}

function evaluateConsiderOpposite(signals: AnalysisSignals): EvaluatorHit | null {
  const raw = signals.rawRobustness;
  if (raw === null || raw.level === null) return null;
  if (isRawFragile(raw)) return null;
  if (raw.near_tie_is_tie) return null;

  const probs = signals.optionWinProbabilities;
  if (probs.length < 2) return null;
  const sorted = [...probs].sort((a, b) => b - a);
  const top = sorted[0]!;
  const runnerUp = sorted[1]!;
  if (top < PREMORTEM_WINPROB_MAX) return null;
  if (top - runnerUp < CONSIDER_OPPOSITE_MIN_SEPARATION) return null;

  // Option-level subject: no single-factor subjectRef — the focus directive
  // falls back to the v1 winner-highlight, which IS the leading option.
  return { code: 'CLEAR_WINNER_DISCONFIRMATION', subjectFactorId: null };
}

/**
 * Rule 5 — devils_advocacy (DSK slice 1: TR-005 → DSK-P-005 devil's advocate).
 *
 * The DSK trigger's observable signal: "top factor contributing >50% of
 * outcome variance AND robustness != 'fragile'". The computable analogue of
 * the variance-contribution clause is the platform's own dominance signal —
 * the SAME strict-majority influence-share derivation rule 1b uses
 * ({@link findDominantDriver}; one derivation, two callers).
 *
 * ⚠ THE ROBUSTNESS CLAUSE IS DELIBERATELY NOT IMPLEMENTED — ROADMAP 2.490.
 * Read this before "restoring" it. Until 2.490 this evaluator opened with
 * `if (isRawFragile(signals.rawRobustness)) return null;`, and MEASURED over
 * five live staging captures that clause selected the lens on ZERO of five:
 * it admitted devils_advocacy EXACTLY where consider_opposite (which outranks
 * it) also fired, and blocked it everywhere else — a perfect anti-filter.
 * The cause is one hop upstream and invisible here: ISL sets
 * `is_robust = recommendation_stability >= 0.7` (`robustness_analyzer_v2.py`
 * @ 88275e5c, where `recommendation_stability` IS the winner's sample-win
 * share) and PLoT bands that into `high|medium|low|very_low` (@ 45e23f10). So
 * `robustness.level` is NOT an independent robustness measure — it is the
 * LEADER'S WIN PROBABILITY compared against 0.7, which is
 * {@link PREMORTEM_WINPROB_MAX}, consider_opposite's own decisive floor.
 *
 * The override is justified by the clause's OWN stated rationale: "do not fire
 * if the model already shows fragile robustness — the analysis is already
 * providing the challenge". On a fragile-banded run the field means "no option
 * clearly wins", which says nothing about the dominant driver's weighting —
 * and DSK-P-005 challenges the FACTOR ("I'll take the position that [dominant
 * factor] matters much less than the model suggests"), not the option
 * separation. The clause exists to suppress a redundant adversary; the field
 * it was implemented against does not measure the thing it would be redundant
 * with, so honouring it here is honouring a false label (trap 14).
 * MEASURED AND REJECTED as substitutes: `robustness.fragile_edges` is
 * non-empty on 5/5 live sessions (vacuous as a gate), and the
 * `flip_thresholds` posture discriminates 3/2 but suppresses the lens on the
 * one session that needs it. If a future slice gives CEE a genuine,
 * win-probability-INDEPENDENT fragility signal, re-implement TR-005's clause
 * against THAT — the override is a response to the available data, not a
 * rejection of the science. Pinned by `lens-dsk-sequence-2490.test.ts`.
 *
 * Because the trigger condition is (deliberately) a subset of rule 1b's, this
 * lens can never win the head slot outright: it depends entirely on a
 * displacement, which is why 2.490 also had to give it one (the SEQUENCE rule
 * in {@link selectLens}). Same subject factor, different decision-science
 * method — diversity IS usefulness on consecutive turns (the 2.211 ruling).
 *
 * DSK-P-005's "do not run immediately after a pre-mortem or disconfirmation"
 * contraindication is enforced at eligibility — see
 * {@link CONTRAINDICATED_IMMEDIATELY_AFTER}.
 */
function evaluateDevilsAdvocacy(signals: AnalysisSignals): EvaluatorHit | null {
  // ROADMAP 2.490 — NO robustness clause here, deliberately. The reasoning is
  // stated ONCE, on this function's doc comment above; a second copy here is
  // the drift surface this module refuses elsewhere. Do not re-add
  // `isRawFragile(signals.rawRobustness)` without reading it.
  const dominant = findDominantDriver(signals);
  if (dominant === null) return null;
  return { code: 'DOMINANT_FACTOR_DISSENT', subjectFactorId: dominant.factorId };
}

/**
 * Rule 6 (wave-3 λ extension, executor-gated) — what-if counterfactual. LOWEST
 * priority: it is LAST on the ladder, so it never OUTRANKS a lens that fired.
 * Points the user at exploring how the leading option changes if the single
 * most-influential factor moves — a counterfactual they can run explicitly
 * (`what_would_flip`'s ISL counterfactual extension, #646). Trigger: an
 * identifiable top-influence factor (rank 1 with a finite influence score)
 * exists to intervene on. The exact intervention-target semantics are ROADMAP
 * 1.195 gate item 4 (pending), so this evaluator is provisional.
 *
 * ⚠ THIS COMMENT USED TO END: "the lens is enable-GATED — its executor
 * availability is injected `false` today, so it never fires in production
 * regardless of this trigger." THAT WAS FALSE, and it was measured false on
 * 5 Aug 2026: a live guest walk captured 10 analysis turns across five staging
 * sessions and `what_if_counterfactual` was the EMITTED lens on THREE of them
 * (sessions A2/A3/B, turn 2 each), identified on the wire by its companion
 * title `TITLE_BY_LENS.what_if_counterfactual`. A verification control written
 * from this sentence predicted the wrong lens on 2 of 10 live turns and had to
 * be corrected at the observation — a false comment in a selector teaches a
 * probe to stop looking (trap 14).
 *
 * ⚠ AND THE "only reached when no flip-risk / pre-mortem / EVPI lens fired"
 * clause that stood here was false too, by the same evidence: all three live
 * emissions were as the ROADMAP 2.211 no-repeat RUNNER-UP, i.e. on turns where
 * a higher lens had fired and was displaced. Last position bounds this lens's
 * PRIORITY; it does not make it unreachable.
 *
 * FOR THE ACTUAL GATE POSTURE, READ {@link WHATIF_SUGGESTION_GATE_CLEARED} —
 * deliberately the ONLY place it is described. It is not restated here, and a
 * restatement must not be re-added: the defect above was one prose copy of a
 * posture going stale while its twin stayed correct, which is trap 12's
 * hand-maintained mirror in comment form. Note that a test pinning the two
 * copies' AGREEMENT would not have caught it — agreement is not truth, and
 * both copies can be wrong together (trap 12d). One description, cross-
 * referenced, is the only version with no drift surface.
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
  fragile_edge_resolution: 'Strengthen your model: firm up the relationship carrying the result',
  consider_opposite: 'Strengthen your model: argue the other side',
  devils_advocacy: 'Strengthen your model: challenge the main assumption',
  what_if_counterfactual: 'Strengthen your model: try a what-if on the key driver',
  uncertainty_reduction_priority: 'Strengthen your model: pin down the assumption this run is most sensitive to',
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
  // ── ROADMAP 2.989 — the resolvable fragile relationship ────────────────────
  // ⚠ NUMBER-FREE, AND THAT IS A RULING, NOT AN OMISSION. Two independent
  // constraints, both derived at the bytes:
  //   (a) every quantity that describes this edge's fragility in a way a user
  //       could act on — `e_value`, `current_mean`, `flip_mean` — lives on
  //       `edge_e_values`, a RATIFIED TIER-3 DENY field. The cage's answer is
  //       `tier3_denied` and there is no route to surfacing it;
  //   (b) `switch_probability` (on `robustness`, Tier-2 allow-listed) IS
  //       claim-permittable, but NEITHER producer has a ratified gloss for it —
  //       the UI's own copy authority (`results/utils/fragileEdgeCopy.ts`)
  //       glosses the E-value and never the switch probability. Authoring a
  //       method gloss here would be an expectation written from the
  //       implementer's reading rather than the producer's semantics, which is
  //       how a full mutant kit certifies a wrong oracle (CLAUDE.md trap 13c).
  // The quantities therefore ride TELEMETRY (booleans + closed enums) and the
  // copy states only what the run's robustness output actually establishes.
  // Surfacing the switch probability behind a reviewed gloss is rowed.
  //
  // The consequence clause is taken VERBATIM from the UI's ratified permitted
  // form (`fragileEdgeConsequence`): one field must not be described two ways
  // on one screen, and the hero's treatment is canonical.
  // ⚠ THIS STRING IS THE TAIL, NOT THE WHOLE BODY. `phase3-blocks.ts`
  // (`composeFragileEdgeBody`) puts the sentence that NAMES the relationship
  // FIRST and appends this one — because the body is truncated at `BODY_MAX`
  // and a naming sentence placed last is the first thing truncation eats. That
  // is not hypothetical: the naming-last ordering was written, measured, and
  // silently lost the second endpoint label on the live capture.
  FRAGILE_EDGE_RESOLVABLE:
    'Change it and which option is most likely to hit your goal could change, so firming it up is the highest-value thing to resolve next.',
  // ── DSK slice 1 — disconfirmation + devil's advocacy ───────────────────────
  CLEAR_WINNER_DISCONFIRMATION:
    'One option is clearly ahead here. Before you commit, spend a few minutes making the strongest honest case against it — if that case falls apart, the choice has earned more trust; if it holds up, you have found something worth checking first.',
  DOMINANT_FACTOR_DISSENT:
    'Most of this result rests on a single factor. Arguing the case against that factor — that it is overstated, less certain than it looks, or outweighed by something outside the model — shows quickly whether the result would survive honest dissent.',
  WHATIF_EXPLORE_DRIVER:
    'One factor shapes this result more than the others. Trying a what-if on that driver — seeing how the leading option changes as it moves — shows how much the choice hangs on it.',
  // ── ROADMAP 2.692 — the resolved sensitivity priority ──────────────────────
  // ⚠ EVERY CLAUSE HERE IS BOUNDED BY THE PRODUCER'S OWN SEMANTICS, and the
  // three things it must NOT say are as load-bearing as what it does say:
  //   (a) NOT "this would change your decision" / "which option wins". ISL:
  //       "holding the decision fixed, it structurally cannot capture
  //       option-switching" (`response_v2.py:1766-1771`). The decision is held
  //       FIXED at the recommended option across every pass.
  //   (b) NOT "value of information" or "worth X". ISL: "calling it EVPI was a
  //       mislabel" (`robustness_analyzer_v2.py:7473-7485`). The genuine VOI
  //       quantities are `decision_evpi` / `factor_evppi`, in outcome units,
  //       and both read below resolution on 2/2 committed captures.
  //   (c) NO MAGNITUDE, and no naming of WHICH metric moved. `metric_type` is
  //       `p_win_recommended` OR `p_joint_goal` depending on whether the run
  //       carried goal constraints, so "the chance your front-runner wins"
  //       would be FALSE on a joint-goal run. The copy stays metric-neutral.
  //   (d) NOT "of everything uncertain here". FALSE SCOPE, and it is a fact
  //       about the sweep's INPUT, not loose wording: the sweep ranks only
  //       `request.parameter_uncertainties`. Edge and structural uncertainty
  //       run in BOTH arms and are never ranked, so they cannot appear in this
  //       ordering at all. The copy names the scope it actually ranks.
  //   (e) NOT "its own measurement noise". The floor is `1.96*sqrt(0.5/n)` —
  //       a function of the SAMPLE COUNT alone, identical for every factor in
  //       the run. It is the RUN's floor, not the factor's.
  //
  // ⚠⚠ ALL FIVE WERE DERIVED CORRECTLY AND THE FIRST SHIPPED COPY STILL
  // VIOLATED (a) IN SUBSTANCE, avoiding every banned WORD: "the picture
  // steadies more than it would from anything else you could look into" is a
  // comparative value-of-information claim wearing plain English. Caught by
  // adversarial review, not by this comment — which is why the prohibitions are
  // now MECHANICAL, in `__tests__/uncertainty-copy-claim-shapes.test.ts`. A
  // comment is not a guard (trap 13c, one level up: a correct oracle and an
  // expectation that slipped past it).
  // The hedge in the last sentence is ISL's own: its science validation says
  // "treat `resolved` as 'distinguishable from noise at 95%', not 'real'"
  // (`docs/science-validation/REPORT.md:362-364`) — roughly one in twenty
  // truly-zero factors will be labelled resolved. Stating the strength of the
  // evidence beside the recommendation is the differentiator, not a caveat to
  // be tidied away.
  RESOLVED_PWIN_SENSITIVITY:
    "Of the parameter uncertainties this run measured, the headline number moves most with one: pinning down what you believe about it would steady that number most. This ranks how far the number moves, not what you should do. It cleared the run's noise floor — a strong hint, not a settled fact.",

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
  // 2.989: the claim is about the run's ROBUSTNESS output (which relationships
  // can move the ranking), so the cage is consulted for `robustness`.
  FRAGILE_EDGE_RESOLVABLE: 'robustness',
  // 2.278 counterparts ground in the same field as the rationales they replace:
  // the claim is still about factor sensitivity, only narrowed to the margin.
  SENSITIVITY_ISOLATED_NO_FLIP: 'factor_sensitivity',
  SENSITIVITY_CORRELATED_NO_FLIP: 'factor_sensitivity',
  DOMINANT_DRIVER_NO_FLIP: 'factor_sensitivity',
  // DSK slice 1: disconfirmation's claim is about the OPTION-LEVEL result
  // (win-probability decisiveness) → option_comparison (deliberately not
  // Tier-2 allow-listed — the suggestion ships prose-only, same as
  // WIN_PROB_MODERATE); dissent's claim is about the dominant factor →
  // factor_sensitivity.
  CLEAR_WINNER_DISCONFIRMATION: 'option_comparison',
  DOMINANT_FACTOR_DISSENT: 'factor_sensitivity',
  // The what-if claim is about the OUTCOME (option win probability) → grounds in
  // option_comparison, which is deliberately NOT allow-listed, so the σ cage
  // DENIES surfacing its value: the counterfactual outcome number stays omitted
  // until Neil rules (doctrine-pending) — an honest double-lock alongside the
  // 1.195 enable gate.
  WHATIF_EXPLORE_DRIVER: 'option_comparison',
  // 2.692: the claim is about the run's sensitivity to one factor's uncertainty
  // → the field that computed it. Deliberately NOT `factor_sensitivity`, which
  // is a DIFFERENT producer quantity (PLoT's OAT influence/heuristic block);
  // grounding a claim in a field it did not come from is the wrong-field
  // MISLABEL class the cage's own header says it cannot catch.
  RESOLVED_PWIN_SENSITIVITY: 'p_win_sensitivity',
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
    // ROADMAP 2.989: present exactly on the fragile-edge lens (its evaluator is
    // the only producer of the key), absent everywhere else — so the absence of
    // the key is itself the "this is not an edge lens" assertion and existing
    // `toStrictEqual` comparisons against other lenses stay exact.
    ...(hit.fragileEdge !== undefined ? { fragileEdge: hit.fragileEdge } : {}),
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
  return rankInterventions(fact, options).chosen;
}

// ============================================================================
// ROADMAP 2.692 — THE RANKED CANDIDATE LIST, EXPOSED
// ============================================================================

/**
 * Why a candidate never entered the race. Closed enum — a skip is an OUTCOME,
 * not a non-event, and an unobservable skip is how three capabilities in this
 * module shipped dark before anyone measured them.
 */
export type InterventionIneligibleReason =
  /** The lens's own trigger did not fire on this run's enrichment. */
  | 'trigger_not_fired'
  /** The platform cannot honestly RUN the method this lens points at. */
  | 'executor_unavailable'
  /** A DSK protocol contraindicated by what ran on the previous analysis turn. */
  | 'contraindicated_after_previous'
  /**
   * ROADMAP 2.1024 — the trigger fired but the OFFER could not be composed into
   * a dispatchable turn from this run's producer-authored labels. Previously
   * this was discovered AFTER the lens had won the slot, and it dropped the
   * whole coaching card; now it never enters the race and the slot passes on.
   */
  | 'offer_not_composable';

/** Why an ELIGIBLE candidate did not take the slot. `null` on the chosen one. */
export type InterventionNotSelectedReason =
  /** A higher tier (or a higher rung of the same tier) took the slot. */
  | 'outranked'
  /** It WAS the slot head and the no-immediate-repeat tie-break moved it. */
  | 'displaced_head'
  /** It was the eligible head and stepped aside under the 2.211-① yield. */
  | 'yielded';

export interface RankedIntervention {
  readonly lens: LensId;
  readonly tier: InterventionTier;
  readonly rationaleCode: LensRationaleCode;
  readonly notSelectedReason: InterventionNotSelectedReason | null;
}

export interface IneligibleIntervention {
  readonly lens: LensId;
  readonly reason: InterventionIneligibleReason;
}

/**
 * The whole race, not just its winner.
 *
 * ⚠ WHY THIS TYPE EXISTS. The selector always BUILT a ranked list and then threw
 * all but one element away at the return. Everything downstream — telemetry,
 * reviews, every "is this capability reachable?" question — had to be answered
 * by hand-written replay scripts, three times, after three capabilities had
 * already shipped dark (2.490, 2.989, and this lane's own finding about
 * `p_win_sensitivity`). The ranking is now a first-class, testable value, so the
 * next placement question is a census against real captures rather than a guess.
 */
export interface InterventionRanking {
  /**
   * Every ELIGIBLE candidate in TIER order (`intervention-tiers.ts`), with the
   * locked method ladder as the within-tier order. This is the RANKING; the
   * tie-breaks below decide which of them takes the single slot.
   */
  readonly candidates: readonly RankedIntervention[];
  /** Every candidate that never entered the race, with its closed reason. */
  readonly ineligible: readonly IneligibleIntervention[];
  /** The one selection, or `null` — may-recommend-nothing is still first-class. */
  readonly chosen: LensSelection | null;
}

/**
 * Can this candidate's user-facing offer actually be composed and dispatched
 * from THIS run's producer data? (ROADMAP 2.1024.)
 *
 * A per-candidate ELIGIBILITY predicate, deliberately a new named concept rather
 * than a conjunct bolted onto `isLensExecutorAvailable`: "the platform can run
 * this method" and "this run's data can be phrased into a dispatchable offer"
 * are different questions with different failure modes, and CLAUDE.md trap 21 is
 * the record of what happens when two such questions share one predicate.
 *
 * Total over `LensId`: every lens whose offer has no composition step is
 * trivially composable, and the ONE lens that composes an offer answers with the
 * same pure leaf the block mint uses (`coaching/fragile-edge-offer-text.ts`) —
 * one function, two callers, so the eligibility test and the composition cannot
 * disagree about what is composable.
 */
function isInterventionComposable(lens: LensId, hit: EvaluatorHit): boolean {
  if (lens !== 'fragile_edge_resolution') return true;
  const edge = hit.fragileEdge;
  if (edge === undefined) return false;
  return isFragileEdgeOfferComposable(edge.fromLabel, edge.toLabel);
}

/**
 * Rank every candidate intervention for this analysis and choose at most one.
 *
 * The ladder below is UNCHANGED and is still the only method ordering in this
 * file. What is added above it is the lexicographic TIER order
 * (`coaching/intervention-tiers.ts`), which asks a different question — what
 * KIND of issue is most worth resolving — and uses the ladder as the within-tier
 * tie-break. Both tie-breaks (2.211-① correlated yield, 2.211 no-immediate-repeat
 * with its 2.490 sequence exception) run afterwards over the tier-ordered list,
 * exactly as they ran over the ladder before.
 *
 * ⚠ ONE DISCLOSED CONSEQUENCE OF A TOP TIER, stated rather than discovered: on a
 * run where `resolve_uncertainty` fires, it takes the slot from whatever would
 * otherwise have won it — including, on the shape measured in session-b2, the
 * `devils_advocacy` cell that ROADMAP 2.490's sequence rule exists to protect.
 * 2.490's guarantee is preserved on every run where the tier is EMPTY, which is
 * 1 of the 2 committed captures and — per the l47 depth finding the design
 * records — the common case. That is the honest shape of the trade: a
 * statistically-gated recommendation outranks an ungated exercise on the runs
 * where the statistics licensed it, and nowhere else.
 */
export function rankInterventions(
  fact: RunAnalysisHandlerFact,
  options?: LensSelectorOptions,
): InterventionRanking {
  const signals = readAnalysisSignals(fact, options?.fragileEdge);
  if (signals === null) return { candidates: [], ineligible: [], chosen: null };

  // THE PRIORITY LADDER, unchanged and still the only ordering in this file.
  // Materialised as a list rather than four sequential early-returns purely so
  // the 2.211 tie-break can ask "is there a NEXT one?" — the ladder's ORDER and
  // its per-lens executor gate are byte-identical to the early-return form, and
  // an empty list still means "recommend nothing".
  const ladder: readonly (readonly [LensId, EvaluatorHit | null])[] = [
    ['sensitivity_flip_risk', evaluateSensitivityFlipRisk(signals)],
    ['pre_mortem', evaluatePreMortem(signals)],
    ['evpi_evidence_priority', evaluateEvpiEvidencePriority(signals)],
    // DSK slice 1 — below the three locked core lenses (their order is not
    // touched), above the generic what-if explorer: a lens derived from a
    // specific DSK trigger's evidence condition outranks the last-resort
    // exploration filler, and what_if keeps its documented "only occupies a
    // slot no other lens claimed" position.
    //
    // ⚠⚠ ROADMAP 2.490 — devils_advocacy WAS STRUCTURALLY DARK AT THIS ORDER,
    // AND REORDERING DOES NOT FIX IT. Both halves were MEASURED; read both
    // before touching these two entries, because the obvious fix is wrong.
    // ⭐ FIXED — NOT BY REORDERING. The ladder ORDER below is UNCHANGED. What
    // changed is (a) devils' anti-filter clause was removed (see
    // {@link evaluateDevilsAdvocacy}) and (b) a displaced sensitivity head now
    // hands its slot to devils as a SEQUENCE rather than to the next ladder
    // entry (see the sequence rule further down this function). Each is INERT
    // ALONE and load-bearing only TOGETHER — measured; do not judge either on
    // its own. The record of the defect is kept below because it is what makes
    // the two hunks legible, and because three plausible fixes are refuted in
    // it. `lens-dsk-sequence-2490.test.ts` pins the fixed behaviour on the
    // live captures themselves.
    //
    // THE DEFECT. Replaying the five live staging captures in
    // `PHASE0-EVIDENCE-2026-07-28/walk-dsk-raw/` (real `enrichment`, through
    // this selector): `devils_advocacy` was selected on ZERO of 5 sessions,
    // across every `previousAnalysisLens` state and every turn of a 6-turn
    // cycle walk.
    //
    // WHY — and it is NOT that these two rules share a threshold in this file.
    // They read different fields (option win_probability vs the shared
    // dominance derivation). The coupling is one hop upstream and invisible
    // here:
    //   ISL  — `is_robust = recommendation_stability >= 0.7`
    //          (`robustness_analyzer_v2.py:5459` @ 88275e5c;
    //          `recommendation_stability` IS the winner's sample-win share)
    //   PLoT — `level` in 'high'|'medium'|'low'|'very_low', mapped from that
    //          (`isl/adapters/robustness-analysis.ts` @ 45e23f10)
    //   here — `isRawFragile(level)` gates devils_advocacy
    // So `robustness.level` is NOT an independent robustness measure: it is
    // the leader's win probability compared against 0.7 — which is
    // `PREMORTEM_WINPROB_MAX`, consider_opposite's own decisive floor.
    // Confirmed on all five captures: level was non-fragile iff the leader
    // cleared 0.7 (0.8576→high; 0.6664/0.6740/0.6401→low; 0.4363→very_low).
    // devils_advocacy's fragility clause therefore admits it EXACTLY where
    // consider_opposite also fires (and outranks it), and blocks it
    // everywhere else. A perfect anti-filter.
    //
    // THREE FIXES WERE TRIED AND MEASURED. All three fail; none is shipped:
    //  (1) Drop devils' win-prob-derived robustness clause — byte-identical
    //      selections on all 5 live sessions. Inert: the ladder binds first.
    //  (2) Swap these two entries — a STARVATION SWAP, not a fix. With
    //      exactly two eligible lenses the 2.211 no-repeat promotion is a
    //      fixed-order 2-CYCLE (head <-> runner-up), so whichever DSK lens is
    //      second is dark. Measured on a dominant+decisive fixture: at this
    //      order `sensitivity <-> consider_opposite` (devils dark); swapped,
    //      `sensitivity <-> devils_advocacy` (consider_opposite dark).
    //      Reordering chooses WHICH protocol is dark; it cannot surface both.
    //  (3) (1)+(2) together — byte-identical to (2).
    //
    // THE ROOT, stated so the next lane does not re-derive it: devils'
    // trigger is a strict SUBSET of sensitivity rule 1b's — both call
    // {@link findDominantDriver} on the same fact. So sensitivity ALWAYS
    // fires when devils does; devils can never be the eligible HEAD and
    // depends entirely on a displacement, of which there is at most one per
    // turn (the no-repeat explicitly does not cascade). Two lenses, one
    // observable, fixed priority => the lower one is unreachable by
    // construction.
    //
    // ONE CONFIGURATION DID surface both, and its scope must be stated
    // exactly, because it is easy to over-read. Under the SWAPPED order AND
    // with a `correlated` flip hit engaging the 2.211-(1) yield (live
    // sessionA's real shape), the cycle became
    //   devils_advocacy -> consider_opposite -> sensitivity_flip_risk -> ...
    // with both protocols surfacing and DSK-P-005's "not immediately after a
    // disconfirmation" contraindication still honoured — the yield supplies a
    // THIRD rotation position, which is what breaks the 2-cycle. ⚠ That was
    // measured under the SWAPPED order ONLY. At the order shipped here, the
    // same correlated fixture still yields NO devils_advocacy (measured) —
    // the yield promotes consider_opposite, which is still above it. So the
    // third position is necessary but not sufficient on its own.
    // The candidate fix is therefore a rotation position PLUS a resolution of
    // the pair's fixed priority — e.g. letting a defanged
    // `DOMINANT_DRIVER_NO_FLIP` head yield the way a correlated head does,
    // which is a change to the LOCKED CORE ladder's yield semantics.
    // Deliberately NOT taken here: it needs a product ruling, not a lane's
    // preference.
    //
    // ⭐ THE RULING THAT RESOLVED IT (2.490, founder-programme). The two DSK
    // lenses are NOT competitors for one slot — they are a SEQUENCE. Sensitivity
    // states a FACT ("this one driver is carrying your recommendation"); devils
    // is the exercise performed ABOUT that fact. That is why their triggers are
    // NESTED rather than disjoint. Corroborated at the bundle bytes, not merely
    // compatible: DSK-P-005's own step 1 is written as a sequel — "The analysis
    // shows [dominant factor] is driving the recommendation heavily. Let's
    // challenge that." — and its contraindications name pre-mortem and
    // disconfirmation but NOT sensitivity. So the fix is a sequence rule on the
    // displaced-head path, not a re-ranking of this ladder.
    //
    // The bundle does NOT adjudicate the PRIORITY between the two. `data/dsk/
    // v1.json` declares only RECIPROCAL deference — TR-003 "Do not fire if user
    // has already run a pre-mortem or devil's advocate exercise on this decision
    // this stage"; TR-005 "...a pre-mortem or disconfirmation exercise this
    // stage" — which presumes both are reachable, but names no priority between
    // them. Because the bundle is silent, the sequence rule below must NOT
    // silently invert the order shipped here: they separate onto their own
    // declared observables instead (decisive leader ⇒ TR-003's disconfirmation;
    // dominant driver without a decisive leader ⇒ TR-005's dissent).
    ['consider_opposite', evaluateConsiderOpposite(signals)],
    ['devils_advocacy', evaluateDevilsAdvocacy(signals)],
    // ── ROADMAP 2.989 — THE FRAGILE-EDGE RESOLUTION LENS. POSITION IS A RULING
    // AND IT WAS MEASURED, NOT PREFERRED. Read this before moving it.
    //
    // ⚠ THIS COMMENT WAS WRONG WHEN SHIPPED AND IS CORRECTED HERE (CEE #883
    // review). It said this entry sits "ABOVE the DSK exercises" and asked "WHY
    // ABOVE THE DSK PAIR" — while the entry itself was, and still is, BELOW
    // them. It was also parked 130 lines further up, next to the core lenses,
    // so it read as the ruling for a position it did not occupy. Both are fixed
    // by MOVING the comment to the entry it describes rather than by moving the
    // entry: the position below is the measured one and is unchanged.
    //
    // THE ACTUAL POSITION: SECOND FROM THE FOOT. The three locked core lenses
    // are above it, the DSK pair (`consider_opposite`, `devils_advocacy`) is
    // ALSO above it, and the only entry below it is the last-resort
    // `what_if_counterfactual` explorer.
    //
    // WHAT THAT POSITION ACHIEVES, MEASURED — the number the original comment
    // never stated. Replaying `selectLens` through `liveLensExecutorAvailability()`
    // exactly as `buildLensSurface` calls it, over the two COMMITTED captures ×
    // all eight `previousAnalysisLens` states (the seven `LensId`s + `null`):
    // this lens wins the slot on **2 of 16 cells**. Both wins are on session-a
    // (`prev = 'pre_mortem'` and `prev = 'consider_opposite'`), and both arrive
    // ONLY as the 2.211 no-repeat DISPLACEMENT alternate — never as the outright
    // ladder head. session-b2 is **0 of 8**. A FIRST ANALYSIS (`prev = null`) is
    // **0 of 2**: on a fresh session's first analysis this lens does not fire at
    // all, so no loop witness can be obtained there.
    //
    // ⚠ SCOPE OF THAT FIGURE, stated so it is not generalised (trap 20): it is a
    // claim about THE TWO COMMITTED CAPTURES ONLY. It is NOT a claim about the
    // 56-turn census, which is not in this repo and was not replayed here.
    //
    // WHY NOT LOWER: appending below `what_if_counterfactual` is the bottom of
    // the ladder, and on the same cells the slot is otherwise always occupied —
    // so a bottom entry is selected on ZERO cells: structurally dark, which is
    // ROADMAP 2.490's defect verbatim ("two lenses, one observable, fixed
    // priority ⇒ the lower one is unreachable by construction"). Shipping a
    // capability no user can reach is the estate's first chronic failure, so a
    // dark placement was refused. 2/16 is small; 0/16 is not a capability.
    //
    // WHY NOT HIGHER — i.e. why BELOW the DSK pair, stated as the judgement it
    // is: the DSK entries derive from a ratified bundle trigger, this one does
    // not, and the 2.490 partition that made `devils_advocacy` observable at all
    // is preserved rather than re-litigated by a new neighbour above it. The
    // bundle names no priority between a DSK protocol and a non-DSK capability
    // lens (its declared deference is reciprocal and internal to the pair), so
    // nothing ratified is inverted by this entry sitting under them. Pinned: on
    // the live captures both DSK exercises are still observed in their own walks.
    //
    // Two no-ladder-change routes were MEASURED AND REFUTED before this position
    // was taken, and are recorded so they are not re-tried:
    //   (1) attach the offer to `sensitivity_flip_risk`'s block instead of
    //       adding a lens — the two subjects DISAGREE on 12 of 12 cells (the
    //       sensitivity subject is picked from `flip_risk_category`/dominance,
    //       the edge from producer robustness order), so the card would focus
    //       one node while its chip offered to change a different one;
    //   (2) attach it only when the subjects agree — the same 0/12.
    ['fragile_edge_resolution', evaluateFragileEdgeResolution(signals)],
    ['what_if_counterfactual', evaluateWhatIfCounterfactual(signals)],
    // ROADMAP 2.692 — position in THIS list is the within-tier order only; the
    // tier order below is what places it against the others. Appended here (not
    // spliced) precisely so the locked ladder's own sequence is untouched.
    ['uncertainty_reduction_priority', evaluateUncertaintyReductionPriority(signals)],
  ];
  const eligible: { lens: LensId; hit: EvaluatorHit; tier: InterventionTier }[] = [];
  const ineligible: IneligibleIntervention[] = [];
  for (const [lens, hit] of ladder) {
    if (hit === null) {
      ineligible.push({ lens, reason: 'trigger_not_fired' });
      continue;
    }
    if (!isLensExecutorAvailable(lens, options)) {
      ineligible.push({ lens, reason: 'executor_unavailable' });
      continue;
    }
    // DSK "do not run immediately after" — applied at ELIGIBILITY, before both
    // tie-breaks, so neither the correlated yield nor the no-repeat promotion
    // can hand the slot to a contraindicated protocol. See
    // CONTRAINDICATED_IMMEDIATELY_AFTER for why the diversity rule alone
    // produced the forbidden sequence.
    if (isContraindicatedAfter(lens, options?.previousAnalysisLens)) {
      ineligible.push({ lens, reason: 'contraindicated_after_previous' });
      continue;
    }
    // ROADMAP 2.1024 — the SAME stage, for the same reason: an intervention the
    // platform cannot phrase into a dispatchable offer must not win the slot and
    // then take the whole card down with it.
    if (!isInterventionComposable(lens, hit)) {
      ineligible.push({ lens, reason: 'offer_not_composable' });
      continue;
    }
    eligible.push({ lens, hit, tier: tierForCandidate(lens) });
  }

  // THE TIER ORDER. A STABLE sort by tier rank, so the locked method ladder
  // survives verbatim as the within-tier order — `Array.prototype.sort` is
  // required to be stable (ECMA-262 §23.1.3.30), and the comparator returns 0
  // for same-tier pairs, so their ladder order is preserved by the spec rather
  // than by luck.
  const tierOrdered = [...eligible].sort((a, b) => tierRank(a.tier) - tierRank(b.tier));

  const candidatesInTierOrder: RankedIntervention[] = tierOrdered.map((e) => ({
    lens: e.lens,
    tier: e.tier,
    rationaleCode: e.hit.code,
    notSelectedReason: 'outranked' as InterventionNotSelectedReason | null,
  }));

  function finish(
    chosen: LensSelection | null,
    marks: ReadonlyMap<LensId, InterventionNotSelectedReason>,
  ): InterventionRanking {
    return {
      candidates: candidatesInTierOrder.map((c) => ({
        ...c,
        notSelectedReason:
          c.lens === chosen?.lens ? null : (marks.get(c.lens) ?? 'outranked'),
      })),
      ineligible,
      chosen,
    };
  }

  // Load-bearing negative: no lens whose evidence fired has an available executor
  // (or every one that did could not be composed). Recommending NOTHING is a
  // first-class outcome and must never be manufactured away.
  const eligibleHead = tierOrdered[0];
  if (eligibleHead === undefined) return finish(null, new Map());

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
  const marks = new Map<LensId, InterventionNotSelectedReason>();
  let slotOrder: readonly { lens: LensId; hit: EvaluatorHit; tier: InterventionTier }[] =
    tierOrdered;
  let yieldedLens: LensId | undefined;
  if (
    eligibleHead.lens === 'sensitivity_flip_risk' &&
    CORRELATED_YIELD_CODES.has(eligibleHead.hit.code) &&
    tierOrdered.length > 1
  ) {
    slotOrder = [...tierOrdered.slice(1), eligibleHead];
    yieldedLens = eligibleHead.lens;
    marks.set(eligibleHead.lens, 'yielded');
  }

  const head = slotOrder[0]!;

  // ROADMAP 2.211 — NO IMMEDIATE REPEAT, over the (possibly yield-adjusted)
  // ladder. Two conditions, both required:
  //   (1) the head lens is the SAME lens the immediately-preceding analysis turn
  //       of this scenario selected, and
  //   (2) a NEXT lens exists that ALSO fired and ALSO has an available executor.
  // Condition (2) is what makes a single-trigger repeat correct rather than a
  // suppression: with nothing to move to, the head stands. The replacement is
  // taken from the SAME ladder — in the SAME order EXCEPT for the one 2.490
  // sequence case immediately below, which is a named exception, not a
  // re-ranking of the ladder itself. The replacement is never equal to `head`
  // (each lens appears once), so one displacement cannot cascade.
  // ── ROADMAP 2.490 — THE SEQUENCE RULE ───────────────────────────────────────
  // A DISPLACED `sensitivity_flip_risk` head hands its slot to the EXERCISE
  // ABOUT THE DRIVER IT JUST NAMED, rather than to the next ladder entry. This
  // uses the 2.211 machinery in its intended direction (the fired lens defers,
  // the sequel takes the slot) instead of re-ranking the locked ladder — see
  // the ruling on the ladder above for why the pair is a sequence and not a
  // competition, and {@link evaluateDevilsAdvocacy} for the other half of the
  // fix (each is INERT ALONE).
  //
  // ⚠ TWO CLAUSES, BOTH LOAD-BEARING, BOTH MEASURED:
  //
  //   `head.lens === 'sensitivity_flip_risk'` — the sequel is a sequel to a
  //   SPECIFIC fact. Without it, a turn on which the correlated yield has
  //   already left devils_advocacy at the head would find devils in slotOrder
  //   and hand the slot straight back to it: a no-repeat rule emitting a
  //   repeat.
  //
  //   `!slotOrder.some(consider_opposite)` — WHENEVER consider_opposite IS
  //   ELIGIBLE, THIS RULE STANDS DOWN ENTIRELY AND THE TURN IS DECIDED BY THE
  //   UNCHANGED LADDER. State it that way and no stronger: the clause is
  //   PRISTINE-PRESERVING, it is NOT "the slot goes to consider_opposite".
  //   What it buys, measured on a fixture where consider_opposite is the
  //   ordinary runner-up: without it the sequel takes that slot and
  //   consider_opposite goes dark for the whole cycle — the same STARVATION
  //   SWAP that refuted fix (2) above, arriving by a different door. The bundle
  //   names no priority between the two, so a tie-break here would be this file
  //   silently inverting the shipped ladder.
  //
  //   ⚠ AND THE LIMIT, measured by adversarial review and recorded because the
  //   over-read is the tempting one: on a shape where a CORE lens is eligible
  //   BETWEEN the two (sensitivity + pre_mortem + both DSK lenses, non-yielding
  //   head), this clause suppresses the sequel and `pre_mortem` takes the slot
  //   — which then contraindicates BOTH DSK exercises, so the cycle locks to
  //   sensitivity ↔ pre_mortem and consider_opposite is NEVER selected even
  //   though its own observable holds. That is byte-identical to pristine, so
  //   this rule neither causes nor fixes it; it is the shipped ladder's
  //   behaviour and a separate question. The clause's guarantee is only the
  //   pristine-preservation. No live capture contains either shape, which is
  //   why the one this rule does change is pinned by a test rather than
  //   trusted to the walk.
  //
  // ⚠ THIS IS A BEHAVIOUR CHANGE TO SHARED, LOCKED-ORDER MACHINERY, not a
  // DSK-local tweak: a displaced sensitivity head that would previously have
  // promoted `pre_mortem` or `evpi_evidence_priority` now promotes
  // `devils_advocacy` whenever the latter is eligible, so a CORE lens loses
  // that slot. Intended, ratified, and pinned as its own case in
  // `lens-dsk-sequence-2490.test.ts`.
  const sequel =
    head.lens === 'sensitivity_flip_risk' &&
    !slotOrder.some((e) => e.lens === 'consider_opposite')
      ? slotOrder.find((e) => e.lens === 'devils_advocacy')
      : undefined;
  const runnerUp = sequel ?? slotOrder[1];
  if (
    options?.previousAnalysisLens != null &&
    options.previousAnalysisLens === head.lens &&
    runnerUp !== undefined
  ) {
    marks.set(head.lens, 'displaced_head');
    return finish(
      buildSelection(runnerUp.lens, runnerUp.hit, head.lens, 'no_repeat'),
      marks,
    );
  }

  return finish(
    buildSelection(
      head.lens,
      head.hit,
      yieldedLens,
      yieldedLens !== undefined ? 'correlated_yield' : undefined,
    ),
    marks,
  );
}
