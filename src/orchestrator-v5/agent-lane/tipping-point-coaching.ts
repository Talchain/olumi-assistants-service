/** A deterministic RC-WHAT-CHANGES answer on the canonical reader's selected Run. No new truth or persistence. */
import { tippingPointOf, type TippingPoint } from './decision-sensitivity.js';
import { checkMethodTurn } from './guidance/index.js';
import type { MethodInputs } from './guidance/types.js';
import { runExplanationChip, RUN_EXPLANATION_UNAVAILABLE_TEXT, type RunExplanationRead } from './run-explanation.js';
import { leaderLicenceFromState } from '../compose/leader-licence.js';
import { agentNoLeaderSentence } from './withheld-leader-fail-closed.js';

export const TIPPING_POINT_PRESS_ID = 'agent-next-what-would-change';
type Found = Extract<TippingPoint, { status: 'found' }>;
export type TippingPointCoaching =
  | { readonly kind: 'found'; readonly run_key: string; readonly fact: Found; readonly reply: string; readonly check_inputs: MethodInputs }
  | { readonly kind: 'unavailable'; readonly reply: string }
  | { readonly kind: 'no_signal'; readonly run_key: string; readonly status: Exclude<TippingPoint['status'], 'found'>; readonly reply: string };

/**
 * ⭐ NO LEADER, NOTHING TO FLIP (DL 0df0e1, 5 Oct; spine v2 step 5). On a Run whose leader is withheld there is no
 * recommendation a change could overturn, so "no threshold" is not the answer: the reply says so, then gives the ONE
 * canonical no-leader sentence for this Run's reason (`agentNoLeaderSentence`, kept by identity at the final egress).
 * Words only: the measured path already refuses a withheld leader (`whatChangesTurnFor`, the route's
 * `whatWouldChangeAnswer`), and a FOUND crossing keeps its exact sentence. The opener avoids every leader/ranking word
 * both egress vocabularies match ("lead", "leader", "recommend"…), or the final egress would remove it.
 */
export const NOTHING_TO_FLIP_OPENER = "There's nothing yet for a change to flip.";

function noLeaderToFlip(read: RunExplanationRead & { readonly analysisReady?: unknown }): string | null {
  if (leaderLicenceFromState(read.analysisState, read.analysisReady) !== 'withheld') return null;
  const claim = (read.analysisState as { leader_claim?: { withheld_reason?: unknown; separation?: unknown } } | null | undefined)?.leader_claim;
  const reason = typeof claim?.withheld_reason === 'string' ? claim.withheld_reason : undefined;
  const separation = typeof claim?.separation === 'string' ? claim.separation : undefined;
  return `${NOTHING_TO_FLIP_OPENER} ${agentNoLeaderSentence(reason, read.analysisReady, [], undefined, undefined, separation)}`;
}

/** The existing Explain control owns currentness and full Run binding; this consumer neither computes nor grants it. */
export function tippingPointCoachingFor(scenarioId: string, read: RunExplanationRead & { readonly analysisReady?: unknown }): TippingPointCoaching {
  const bound = runExplanationChip(scenarioId, read);
  if (bound === null) return { kind: 'unavailable', reply: RUN_EXPLANATION_UNAVAILABLE_TEXT };
  const result = read.analysisResult as { enrichment?: unknown };
  const fact = tippingPointOf(result.enrichment);
  if (fact.status !== 'found') {
    // A "no threshold" answer is about THIS Run as much as a found one: it keeps the Run key the route re-checks (Codex P1 #2542).
    return { kind: 'no_signal', run_key: bound.id, status: fact.status, reply: noLeaderToFlip(read) ?? (fact.status === 'no_flip_in_range'
      ? 'This analysis has no factor threshold to quote within the ranges it checked.'
      : 'This analysis has no grounded factor threshold available to quote.') };
  }
  return { kind: 'found', run_key: bound.id, fact, reply: fact.say,
    check_inputs: { factor_label: fact.label, factor_current_value: fact.current_value,
      tipping_point: fact, 'run.kind': 'complete_current' } };
}

/** One optional elaboration call may follow this instruction; the grounded sentence is supplied, never generated. */
export function tippingPointDirective(plan: Extract<TippingPointCoaching, { kind: 'found' }>): string {
  return `RC-WHAT-CHANGES: begin with this exact sentence, verbatim: ${JSON.stringify(plan.reply)} `
    + 'You may add a short explanation or refinement question. Add no figures, threshold claims, probabilities, '
    + 'winner language or ranking. This crossing is independent of EVPPI. Nothing has been edited or rerun.';
}

/** Before sending: retain checked elaboration, otherwise use the same deterministic sentence. No repair/model retry. */
export function settleTippingPointCoaching(plan: Extract<TippingPointCoaching, { kind: 'found' }>, draft: string): {
  readonly reply: string; readonly passed: boolean; readonly failed: readonly string[];
} {
  const checked = checkMethodTurn('RC-WHAT-CHANGES', draft, plan.check_inputs);
  return { reply: checked.pass ? draft : plan.reply, passed: checked.pass, failed: checked.failed };
}
