/**
 * A2 L1 SHADOW (Science 0df0e1): the ONE leader-licence verdict for a Run, compared BY VALUE with each live predicate it
 * will replace in L2. Log-only: the verdict is not stored (`RunAnalysisResultSchema` is `.strict()` at @talchain/schemas
 * 0.76.0, so a new result key would fail the fact parse) and nothing reads it. PURE; never throws.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { validateAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';
import { pickLatestRawRobustness } from '../coaching/pick-raw-robustness.js';
import {
  LEADER_LICENCE_AUTHORITY_VERSION, leaderLicenceVerdict, type LeaderLicenceVerdictV1,
} from './leader-licence-verdict.js';
import { boundRunLeaderClaim } from '../model-management/version-result-binding.js';

/** The live sites L1 shadows (A2-LEADER-CLASS-CEE.md row ids in brackets). */
export type LeaderLicenceShadowSite =
  | 'LL' // `leaderLicence` for this Run, as the Agent lane reads it [#21]
  | 'CV' // stored `constraint_verdict.may_name_leading_option` [#3]
  | 'LC' // composed `analysis_state.leader_claim.permitted` [#19]
  | 'stored_leader' // stored `result.leading_option_id` [#2]
  | 'summary_leader'; // the Run summary names a leader ("X currently leads") [#4]

export interface LeaderLicenceShadowDisagreement {
  readonly site: LeaderLicenceShadowSite;
  /** The live site's value: a licence string, or whether it names/permits a leader. */
  readonly live: string | boolean;
  /** The verdict's value in the site's own terms. */
  readonly verdict: string | boolean;
}

export interface LeaderLicenceShadow {
  readonly verdict: LeaderLicenceVerdictV1;
  readonly disagreements: readonly LeaderLicenceShadowDisagreement[];
  /** True when the verdict could not be computed and failed closed. */
  readonly failed_closed: boolean;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null);

function failedClosed(fact: unknown): LeaderLicenceShadow {
  // The fact itself may be what threw: read it once more only behind its own guard.
  let result: Rec | null = null;
  try { result = rec(rec(fact)?.result); } catch { result = null; }
  return {
    verdict: {
      verdict: 'withheld', leader_option_id: null, reason: null, caveats: [],
      basis: {
        run_id: typeof result?.run_id === 'string' ? result.run_id : '',
        graph_hash: typeof result?.graph_hash_at_run === 'string' ? result.graph_hash_at_run : '',
        admission_mode: 'absent', separation: 'unknown', robustness_level: null,
        constraint_state: 'not_entitled', claim_reason: null,
      },
      authority_version: LEADER_LICENCE_AUTHORITY_VERSION,
    },
    disagreements: [],
    failed_closed: true,
  };
}

export function leaderLicenceShadow(input: {
  /** The validated run_analysis fact, exactly as it will be stored. */
  readonly fact: HandlerFact;
  /** The persisted graph this Run analysed (the one `graph_hash_at_run` was taken over). */
  readonly graph: unknown;
  readonly scenarioId: string;
  /** Whether the Run's stored `summary` names a leader (the headline's own `has_leading_option`). */
  readonly summaryNamesLeader: boolean;
}): LeaderLicenceShadow {
  try {
    const fact = input.fact;
    const result = rec((fact as { result?: unknown }).result);
    if (fact.fact_type !== 'run_analysis' || result === null) return failedClosed(fact);
    const checked = validateAnalysisRunFactIdentity(result);
    const runId = result.run_id;
    if (checked.status !== 'confirmed' || typeof runId !== 'string' || runId === '') return failedClosed(fact);
    const bound = boundRunLeaderClaim({ fact, identity: { ...checked.identity, run_id: runId } },
      { graph: input.graph as never, scenario_id: input.scenarioId });
    const claim = bound.state?.leader_claim ?? { permitted: false };
    // CV is, by the A2 site table's definition, the STORED field. Read it as stored (this fact was built a line ago, so
    // the first-class field is present); the leaf reader keeps its one production caller (acceptance pin).
    const constraintEntitled = rec(result.constraint_verdict)?.may_name_leading_option === true;
    const verdict = leaderLicenceVerdict({
      runId, graphHash: checked.identity.graph_hash_at_run, result, licence: bound.licence,
      leaderClaim: claim, analysisReady: bound.readiness, constraintEntitled,
      robustnessLevel: pickLatestRawRobustness([fact])?.level ?? null,
    });
    const names = verdict.verdict !== 'withheld';
    const storedLeader = typeof result.leading_option_id === 'string' && result.leading_option_id !== '';
    const disagreements: LeaderLicenceShadowDisagreement[] = [];
    if (bound.licence !== verdict.verdict) disagreements.push({ site: 'LL', live: bound.licence, verdict: verdict.verdict });
    if (constraintEntitled !== names) disagreements.push({ site: 'CV', live: constraintEntitled, verdict: names });
    if (claim.permitted !== names) disagreements.push({ site: 'LC', live: claim.permitted, verdict: names });
    if (storedLeader !== names) disagreements.push({ site: 'stored_leader', live: storedLeader, verdict: names });
    if (input.summaryNamesLeader !== names) {
      disagreements.push({ site: 'summary_leader', live: input.summaryNamesLeader, verdict: names });
    }
    return { verdict, disagreements, failed_closed: false };
  } catch {
    return failedClosed(input.fact);
  }
}
