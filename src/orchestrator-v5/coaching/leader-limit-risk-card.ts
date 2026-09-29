/**
 * THE OPTION THAT COMES OUT AHEAD PROBABLY BREAKS A LIMIT — the run-turn card for a limit the analysis DID score,
 * where the option it is allowed to name is more likely than not to break it (AI Quality claim permission
 * 5842498806, accepted by the Delivery Lead 5842513799; the ONE predicate 5842539827, CEE #1960).
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 * `deriveConstraintVerdict` calls a leader infeasible only at P(meets the limit) ≤ 0.05. From just above that to
 * 0.99 the verdict is `evaluated_feasible`: the leader is named and no limit copy speaks. So an option that meets
 * the user's own limit with P = 0.3 was named as if it fitted. The ruling: while a ratified limit is scored and
 * the leader's P < 0.5, the leader may be named only if the same reply AND card name the limit and say it is
 * more likely than not to be broken on these estimates. Never "meets", "keeps … under" or "within".
 *
 * ── WHAT IT READS (typed only; it re-derives nothing) ──────────────────────
 *   · the READBACK's verdict state `=== 'evaluated_feasible'` (`final.constraintVerdictState`, PR-7's carrier);
 *   · the READBACK's `leader_claim.permitted === true`: on a withheld pass no option is named, and "the option that
 *     comes out ahead" would itself be a leader claim;
 *   · the risks `deriveLeaderLimitRisks` returned, computed ONCE where the full PLoT envelope exists and carried
 *     from the same fact (`final.leaderLimitRisks`, contract ask 5842617884). A non-empty, well-formed list is the
 *     evidence; the threshold is never re-applied here.
 * Names come from the HASH-BOUND graph only, joined by `constraint_id` (`coaching/bound-graph.ts`); otherwise the
 * card speaks without a name. The only figure it says is the user's own stated threshold.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import { deterministicBlockId } from '../compose/block-id.js';
import { limitsNamedByIds, type NamedLimit } from './bound-graph.js';
import {
  RUN_TURN_COACHING_CONTRACT,
  copyPasses,
  isAutomaticRun,
  readRecord,
  type FragileLinkChallengeCopy,
  type FragileLinkChallengeInput,
  type RunTurnTrigger,
} from './fragile-link-challenge.js';

export const LEADER_LIMIT_RISK_SIGNAL_ID_PREFIX = 'coach:limit_risk:';
/** The one verdict this card speaks on (`ConstraintVerdictState`, constraint-feasibility.ts). */
const EVALUATED_FEASIBLE = 'evaluated_feasible';

/**
 * The constraint ids of a carried `LeaderLimitRisk[]`, or null when it is not a non-empty list of well-formed
 * entries (a string `constraint_id` and a finite `probability`). A malformed entry is not evidence of a risk.
 */
export function leaderLimitRiskIds(risks: unknown): readonly string[] | null {
  if (!Array.isArray(risks) || risks.length === 0) return null;
  const ids: string[] = [];
  for (const raw of risks) {
    const risk = readRecord(raw);
    const id = risk?.constraint_id;
    const p = risk?.probability;
    if (typeof id !== 'string' || id.length === 0 || typeof p !== 'number' || !Number.isFinite(p)) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

const RISK = 'On Olumi\'s estimates, the option that comes out ahead is more likely than not to break';
const ASK = 'Don\'t change the model or re-run anything yet.';

/** The first prompt that fits: a longer one drops its trade-off clause, never the no-write ask. */
const promptOf = (forms: readonly string[]): string =>
  forms.find((p) => p.length <= RUN_TURN_COACHING_CONTRACT.limits.action_prompt_max) ?? forms[forms.length - 1]!;

/** The card's words. `limits` null or empty → no limit is named. */
export function composeLeaderLimitRiskCard(limits: readonly NamedLimit[] | null): FragileLinkChallengeCopy {
  const quoted = (limits ?? []).map((l) => `“${l.label}”${l.stated !== null ? ` (${l.stated})` : ''}`);
  if (quoted.length >= 2) {
    const list = `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
    return {
      title: 'Check this result against your limits',
      body: `${RISK} each of your limits on ${list}. Worth deciding how firm they are before acting on this result.`,
      action_label: 'Decide how firm my limits are',
      action_prompt: promptOf([
        `${RISK} each of my limits on ${list}. Ask me how firm each one is, and what I would give up to hold to it. ${ASK}`,
        `${RISK} each of my limits on ${list}. Ask me how firm each one is. ${ASK}`,
      ]),
    };
  }
  if (quoted.length === 1) {
    return {
      title: 'Check this result against your limit',
      body: `${RISK} your limit on ${quoted[0]}. Worth deciding how firm it is before acting on this result.`,
      action_label: 'Decide how firm my limit is',
      action_prompt: promptOf([
        `${RISK} my limit on ${quoted[0]}. Ask me how firm that limit is, and what I would give up to hold to it. ${ASK}`,
        `${RISK} my limit on ${quoted[0]}. Ask me how firm that limit is. ${ASK}`,
      ]),
    };
  }
  return {
    title: 'Check this result against your limits',
    body: `${RISK} at least one of your limits. Worth deciding how firm they are before acting on this result.`,
    action_label: 'Decide how firm my limits are',
    action_prompt: `${RISK} at least one of my limits. Ask me which limits matter most, and how firm each one is. ${ASK}`,
  };
}

export type LeaderLimitRiskCardDecision =
  | { readonly block: CoachingBlock; readonly reason: null }
  | { readonly block: null; readonly reason: 'no_leader_limit_risk' | 'identity_mismatch' | 'copy_gate' };

/**
 * Build the one leader-limit-risk card, or say why not. Total. `verdictState`, `leaderClaim` and `risks` are the
 * READBACK's (`final.constraintVerdictState`, `analysis_state.leader_claim`, `final.leaderLimitRisks`);
 * `boundGraph` is the graph proven to be the run's own (null otherwise).
 */
export function buildLeaderLimitRiskCard(
  input: FragileLinkChallengeInput,
  verdictState: unknown,
  leaderClaim: unknown,
  risks: unknown,
  boundGraph: Record<string, unknown> | null,
): LeaderLimitRiskCardDecision {
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) {
    return { block: null, reason: 'identity_mismatch' };
  }
  if (verdictState !== EVALUATED_FEASIBLE || readRecord(leaderClaim)?.permitted !== true) {
    return { block: null, reason: 'no_leader_limit_risk' };
  }
  const ids = leaderLimitRiskIds(risks);
  if (ids === null) return { block: null, reason: 'no_leader_limit_risk' };

  // Names with the user's figures → names only → no names: the first form the copy gate passes.
  const named = boundGraph !== null ? limitsNamedByIds(boundGraph, ids) : null;
  const forms = [
    ...(named !== null ? [composeLeaderLimitRiskCard(named), composeLeaderLimitRiskCard(named.map((l) => ({ ...l, stated: null })))] : []),
    composeLeaderLimitRiskCard(null),
  ];
  const copy = forms.find(copyPasses);
  if (copy === undefined) return { block: null, reason: 'copy_gate' };
  const trigger: RunTurnTrigger =
    input.trigger === 'auto_first_pass' || isAutomaticRun(readRecord(result.enrichment)) ? 'auto_first_pass' : 'explicit_run';
  const signalId = `${LEADER_LIMIT_RISK_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:${trigger}`;
  const parsed = CoachingBlockSchema.safeParse({
    type: 'coaching',
    coaching_kind: RUN_TURN_COACHING_CONTRACT.block.coaching_kind,
    block_id: deterministicBlockId(signalId),
    signal_id: signalId,
    created_at: input.computedAt,
    source_handler: RUN_TURN_COACHING_CONTRACT.block.source_handler,
    graph_hash_at_generation: input.graphHash,
    freshness: 'fresh',
    source: RUN_TURN_COACHING_CONTRACT.block.source,
    priority_rank: RUN_TURN_COACHING_CONTRACT.block.priority_rank,
    target_refs: [],
    ...copy,
  });
  return parsed.success ? { block: parsed.data, reason: null } : { block: null, reason: 'copy_gate' };
}
