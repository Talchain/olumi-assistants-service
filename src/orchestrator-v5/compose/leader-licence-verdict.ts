/**
 * ⭐ A2 L1 — ONE LEADER-LICENCE VERDICT PER RUN, SHADOW ONLY (Science 0df0e1; design: programme-docs
 * science/olumi-science-20261004 output/science-0df0e1/A2-SINGLE-LICENCE-DESIGN.md; DL GO 5 Oct).
 *
 * CEE has 17 "may a leader be named" predicates that disagree (Paul's Run a994c38a showed four at once). L1 computes the
 * ONE verdict at Run time, stores it on the run fact and LOGS where each live predicate disagrees, so L2 can switch the
 * readers with disagreements = 0 as its gate. NOTHING READS THIS VERDICT YET: no user, model or wire consumer sees it.
 *
 * The RULE is `leaderLicence`'s (compose/leader-licence.ts), fed by `boundRunLeaderLicence` for the stored Run; this
 * module only (a) caps it with the Run's own typed withholds the rule never sees and (b) names one closed reason.
 *
 * PURE. Never throws (`leaderLicenceVerdictSafe` fails closed).
 */
import type { LeaderLicence } from './leader-licence.js';
import {
  WITHHELD_CONSTRAINT_VERDICT, WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT, WITHHELD_GOAL_SCOPE_UNRESOLVED,
  WITHHELD_LEADER_CAUSE_UNRECORDED, WITHHELD_NEAR_TIE, WITHHELD_NO_OPTION_MEETS_LIMIT,
  WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN, WITHHELD_RUN_IDENTITY_CONFLICT, WITHHELD_RUN_IDENTITY_UNCONFIRMED,
  WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_UNREQUESTED_ANALYSIS,
} from './analysis-state-v1.js';
import {
  GOAL_FIGURES_OPTIONS_IDENTICAL, GOAL_FIGURES_TARGET_NOT_TESTABLE, goalFiguresWithheldWarning,
} from '../../orchestrator/context/option-result-source.js';

export const LEADER_LICENCE_AUTHORITY_VERSION = 1 as const;

export type LeaderLicenceWithheldReason =
  | 'separation_unavailable' | 'options_do_not_separate' | 'admission_exploratory' | 'target_not_testable'
  | 'goal_figures_withheld' | 'constraint_infeasible' | 'scope_unresolved' | 'identity_conflict' | 'not_requested'
  | 'sign_unproven' | 'cause_unrecorded';

/** `estimates_accepted` and `robustness_low` are reserved: no ruled Run-time input emits them in L1. */
export type LeaderLicenceCaveat =
  | 'estimates_accepted' | 'robustness_low' | 'provisional_mode' | 'unvalued_root_treated_as_zero';

export interface LeaderLicenceVerdictV1 {
  readonly verdict: LeaderLicence;
  /** Set iff `verdict !== 'withheld'`. */
  readonly leader_option_id: string | null;
  /** Null on a licensed verdict, and on a withhold whose cause this module cannot name (fail closed). */
  readonly reason: LeaderLicenceWithheldReason | null;
  readonly caveats: readonly LeaderLicenceCaveat[];
  readonly basis: {
    readonly run_id: string;
    readonly graph_hash: string;
    /** `permitted_analysis_mode`, or `absent` when no runnable admission was published. */
    readonly admission_mode: string;
    /** `leader_claim.separation`, or `unknown` when no separation statement was computed. */
    readonly separation: string;
    readonly robustness_level: string | null;
    /** The stored constraint verdict's entitlement (CV). */
    readonly constraint_state: 'entitled' | 'not_entitled';
    /** The composed claim's own withheld reason, verbatim (the closed `reason` is lossy by design). */
    readonly claim_reason: string | null;
  };
  readonly authority_version: typeof LEADER_LICENCE_AUTHORITY_VERSION;
}

export interface LeaderLicenceVerdictInput {
  readonly runId: string;
  readonly graphHash: string;
  /** The Run's stored result, AFTER every Run-time withhold. */
  readonly result: Record<string, unknown>;
  /** `leaderLicence` for this Run (`boundRunLeaderLicence`). */
  readonly licence: LeaderLicence;
  /** The composed `leader_claim` for this Run (same composition as `licence`). */
  readonly leaderClaim: { readonly permitted: boolean; readonly withheld_reason?: string; readonly separation?: string };
  /** The Run-time `analysis_ready` (admission + `unvalued_roots`). */
  readonly analysisReady: unknown;
  readonly constraintEntitled: boolean;
  readonly robustnessLevel: string | null;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null);

const CLAIM_REASON: Readonly<Record<string, LeaderLicenceWithheldReason>> = {
  [WITHHELD_NEAR_TIE]: 'options_do_not_separate',
  [WITHHELD_SEPARATION_UNAVAILABLE]: 'separation_unavailable',
  [WITHHELD_GOAL_SCOPE_UNRESOLVED]: 'scope_unresolved',
  [WITHHELD_CONSTRAINT_VERDICT]: 'constraint_infeasible',
  [WITHHELD_NO_OPTION_MEETS_LIMIT]: 'constraint_infeasible',
  [WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT]: 'constraint_infeasible',
  [WITHHELD_RUN_IDENTITY_CONFLICT]: 'identity_conflict',
  [WITHHELD_RUN_IDENTITY_UNCONFIRMED]: 'identity_conflict',
  [WITHHELD_UNREQUESTED_ANALYSIS]: 'not_requested',
  [WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN]: 'sign_unproven',
  [WITHHELD_LEADER_CAUSE_UNRECORDED]: 'cause_unrecorded',
};

function admissionOf(analysisReady: unknown): Rec | null {
  return rec(rec(analysisReady)?.analysis_admission);
}

/** The published mode when the admission is runnable; `absent` otherwise (the licence fails closed on it). */
function admissionMode(analysisReady: unknown): string {
  const a = admissionOf(analysisReady);
  if (a === null) return 'absent';
  const runnable = 'structurally_analysable' in a ? a.structurally_analysable : a.admitted;
  return runnable === true && typeof a.permitted_analysis_mode === 'string' ? a.permitted_analysis_mode : 'absent';
}

function admissionReason(analysisReady: unknown): LeaderLicenceWithheldReason {
  const reasons = admissionOf(analysisReady)?.reasons;
  const targetNotTestable = Array.isArray(reasons) && reasons.some((r) => rec(r)?.code === 'TARGET_NOT_TESTABLE');
  return targetNotTestable ? 'target_not_testable' : 'admission_exploratory';
}

/**
 * The Run's own typed goal-figure withhold, mapped: identical arms do not separate; an untestable target is that.
 * The carrier is the STORED envelope, `result.enrichment.inference_warnings` (run-analysis.ts writes the withhold
 * there); `result` itself never holds the warnings.
 */
function goalFigureReason(result: Rec): LeaderLicenceWithheldReason | null {
  const envelope = rec(result.enrichment);
  if (envelope === null) return null;
  const code = goalFiguresWithheldWarning(envelope)?.code;
  if (typeof code !== 'string') return null;
  if (code === GOAL_FIGURES_OPTIONS_IDENTICAL) return 'options_do_not_separate';
  if (code === GOAL_FIGURES_TARGET_NOT_TESTABLE) return 'target_not_testable';
  return 'goal_figures_withheld';
}

const unvaluedRoots = (analysisReady: unknown): boolean => {
  const roots = rec(analysisReady)?.unvalued_roots;
  return Array.isArray(roots) && roots.length > 0;
};

export function leaderLicenceVerdict(input: LeaderLicenceVerdictInput): LeaderLicenceVerdictV1 {
  const mode = admissionMode(input.analysisReady);
  const claimReason = input.leaderClaim.withheld_reason ?? null;
  const basis = {
    run_id: input.runId,
    graph_hash: input.graphHash,
    admission_mode: mode,
    separation: input.leaderClaim.separation ?? 'unknown',
    robustness_level: input.robustnessLevel,
    constraint_state: input.constraintEntitled ? 'entitled' as const : 'not_entitled' as const,
    claim_reason: claimReason,
  };
  const withheld = (reason: LeaderLicenceWithheldReason | null): LeaderLicenceVerdictV1 => ({
    verdict: 'withheld', leader_option_id: null, reason, caveats: [], basis,
    authority_version: LEADER_LICENCE_AUTHORITY_VERSION,
  });

  // 1. The Run's own typed withhold removed the goal figures (and with them every share and the leader keys): no
  //    leader survives it, whatever the rule says about the readback (a994c38a: CV=true, no stored leader).
  const goalReason = goalFigureReason(input.result);
  if (goalReason !== null) return withheld(goalReason);
  // 2. The rule withholds: name the first failing half the way the rule reads them.
  if (input.licence === 'withheld') {
    if (input.leaderClaim.permitted !== true) return withheld(claimReason === null ? null : CLAIM_REASON[claimReason] ?? null);
    if (mode !== 'comparative_leader' && mode !== 'quantified_provisional') return withheld(admissionReason(input.analysisReady));
    return withheld(null);
  }
  // 3. Licensed: the ONE leader is the stored `leading_option_id`. A licence with no stored leader names nobody.
  const leader = typeof input.result.leading_option_id === 'string' && input.result.leading_option_id !== ''
    ? input.result.leading_option_id : null;
  if (leader === null) return withheld(null);
  const caveats: LeaderLicenceCaveat[] = [];
  if (mode === 'quantified_provisional') caveats.push('provisional_mode');
  // DL 5 Oct ~01:3xZ: a leader resting on a root the engine treated as zero is `permitted_with_caveat` AT MOST.
  if (unvaluedRoots(input.analysisReady)) caveats.push('unvalued_root_treated_as_zero');
  return {
    verdict: caveats.length > 0 ? 'permitted_with_caveat' : input.licence,
    leader_option_id: leader, reason: null, caveats, basis,
    authority_version: LEADER_LICENCE_AUTHORITY_VERSION,
  };
}
