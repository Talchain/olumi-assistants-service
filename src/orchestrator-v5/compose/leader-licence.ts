/**
 * ⭐ ONE LEADER LICENCE — the single answer to "may Olumi name a leading option on this turn?" (AI HARNESS PR-L1,
 * programme-docs#85 5931097719; DL rulings 5930708980 §4 (i) and (ii)).
 *
 * The RULE belongs to F1b (analysis truth, 52f8cd): this function only reads the published verdicts — the composed
 * `leader_claim` and the admission's `permitted_analysis_mode` — and never re-derives either. Every consumer that
 * decides whether a leader may be named reads THIS function, so two rails can no longer disagree about WHETHER:
 * the Agent lane's wire gate (`agentLaneLeaderWithheld`), the Agent's told permission (`claimPermissionsFrom`), the
 * model-facing run view (`licensed-run-view.ts`) and the Agent lane's final egress backstop. The V5 rails migrate in
 * PR-L2.
 *
 * Arms, in order (lifted unchanged from the shared wire gate `enforceLeadingOptionClaimsAtWire`):
 * 1. not entitled → `withheld`;
 * 2. entitled, separated, `quantified_provisional` → `permitted_with_caveat` (Paul: "caveat, not withhold",
 *    programme-docs#38 5576895511);
 * 3. the admission does not license a leader, or the run looked and declined (a `withheld`-kind reason) → `withheld`;
 * 4. ruling (ii): a separation that could not be evaluated (`separation_unavailable`) → `withheld` (fail-closed);
 * 5. otherwise `permitted`.
 * 0. (before all of these, P0 SHARED DATA) an admission that is absent, malformed, or on the run-refusal axis
 *    (`structurally_analysable: false`) → `withheld`. Only M1 (comparative_leader) and M2 (quantified_provisional,
 *    caveated) can license; the matrix is in programme-docs `output/p0-shared-data/AUDIT.md` §1b.
 *
 * PURE. Never throws.
 */
import { leaderClaimReasonKind, WITHHELD_SEPARATION_UNAVAILABLE } from './analysis-state-v1.js';

export type LeaderLicence = 'permitted' | 'permitted_with_caveat' | 'withheld';

export interface LeaderLicenceInput {
  /** The run's entitlement to name a leader: on the Agent lane, the readback's `leader_claim.permitted`. */
  readonly mayNameLeadingOption?: boolean;
  /** `analysis_state.leader_claim.separation === 'separated'` on the same readback. */
  readonly separationEstablished?: boolean;
  /** `analysis_state.leader_claim.withheld_reason` on the same readback. */
  readonly leaderClaimWithheldReason?: string;
  /** The `analysis_ready` this turn ships; read only for `analysis_admission.permitted_analysis_mode`. */
  readonly analysisReady?: unknown;
}

export function leaderLicence(o: LeaderLicenceInput): LeaderLicence {
  if (o.mayNameLeadingOption !== true) return 'withheld';
  // Read both producer spellings here. The legacy V5 predicate intentionally
  // stands down on projected admissions and cannot enforce this licence.
  const mode = claimStrengthMode(o.analysisReady);
  if (mode === null) return 'withheld';
  // A provisional caveat cannot override a canonical restriction, including
  // an unresolved goal scope on a separated Run.
  if (leaderClaimReasonKind(o.leaderClaimWithheldReason) === 'withheld') return 'withheld';
  if (o.leaderClaimWithheldReason === WITHHELD_SEPARATION_UNAVAILABLE) return 'withheld';
  if (mode === 'quantified_provisional') {
    return o.separationEstablished === true ? 'permitted_with_caveat' : 'withheld';
  }
  return 'permitted';
}

/**
 * A published admission that answers "how strong a claim?": the run-axis flag is `true` and the mode is recognised.
 *
 * ⚠ TWO SPELLINGS OF ONE FLAG, BOTH PRODUCER-MINTED. `analysis_ready.analysis_admission.structurally_analysable` (the
 * canonical payload) and the `/graph` read's top-level projection `analysis_admission.admitted`
 * (`routes/analysis-admission-projection.ts`: `admitted: a.structurally_analysable`), which the Agent's follow-up state
 * passes in (`withSavedRunCertainty`). The canonical spelling wins when present; neither present fails closed.
 */
function claimStrengthMode(analysisReady: unknown): 'comparative_leader' | 'quantified_provisional' | null {
  const admission = (analysisReady as { analysis_admission?: unknown } | null | undefined)?.analysis_admission;
  if (admission === null || typeof admission !== 'object' || Array.isArray(admission)) return null;
  const a = admission as { structurally_analysable?: unknown; admitted?: unknown; permitted_analysis_mode?: unknown };
  const runnable = 'structurally_analysable' in a ? a.structurally_analysable : a.admitted;
  if (runnable !== true) return null;
  return a.permitted_analysis_mode === 'comparative_leader' || a.permitted_analysis_mode === 'quantified_provisional'
    ? a.permitted_analysis_mode : null;
}

/** The licence from a turn's `analysis_state` + `analysis_ready`, read the way the Agent lane's wire gate reads them. */
export function leaderLicenceFromState(analysisState: unknown, analysisReady: unknown): LeaderLicence {
  const claim = (analysisState as { leader_claim?: { permitted?: unknown; separation?: unknown; withheld_reason?: unknown } } | null | undefined)?.leader_claim;
  return leaderLicence({
    mayNameLeadingOption: claim?.permitted === true,
    separationEstablished: claim?.separation === 'separated',
    ...(typeof claim?.withheld_reason === 'string' ? { leaderClaimWithheldReason: claim.withheld_reason } : {}),
    analysisReady,
  });
}
