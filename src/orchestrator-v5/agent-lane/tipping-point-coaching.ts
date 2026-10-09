/** A deterministic RC-WHAT-CHANGES answer on the canonical reader's selected Run. No new truth or persistence. */
import { tippingPointOf, type TippingPoint } from './decision-sensitivity.js';
import { checkMethodTurn } from './guidance/index.js';
import type { MethodInputs } from './guidance/types.js';
import { runExplanationChip, RUN_EXPLANATION_UNAVAILABLE_TEXT, type RunExplanationRead } from './run-explanation.js';
import { leaderLicenceFromState } from '../compose/leader-licence.js';
import { SEPARATION_NEAR_TIE, WITHHELD_NEAR_TIE } from '../compose/analysis-state-v1.js';

export const TIPPING_POINT_PRESS_ID = 'agent-next-what-would-change';
type Found = Extract<TippingPoint, { status: 'found' }>;
export type TippingPointCoaching =
  | { readonly kind: 'found'; readonly run_key: string; readonly fact: Found; readonly reply: string; readonly check_inputs: MethodInputs }
  | { readonly kind: 'unavailable'; readonly reply: string }
  | { readonly kind: 'no_signal'; readonly run_key: string; readonly status: Exclude<TippingPoint['status'], 'found'>; readonly reply: string };

/**
 * ⭐ NO LEADER, NOTHING TO FLIP (DL 0df0e1, 5 Oct; spine v2 step 5). On a Run whose leader is withheld there is no
 * recommendation a change could overturn, so "no threshold" is not the answer: the reply says so. Words only: the
 * measured path already refuses a withheld leader (`whatChangesTurnFor`, the route's `whatWouldChangeAnswer`), and a
 * FOUND crossing keeps its exact sentence.
 *
 * ⛔ NO CAUSE IT CANNOT PROVE, NO NEXT STEP (Codex P1 on #2569). The canonical no-leader composer needs the Run's limit
 * verdicts, ask coverage and goal-figure warnings to pick a cause and its ask; without them it can name the wrong
 * cause or prescribe a futile rerun. So this says only the typed near-tie verdict (`withheld_reason` /
 * `separation`, CEE's own), or nothing about why. Every word is clear of both egress rails' leader/ranking vocabulary.
 */
export const NO_LEADER_TO_FLIP_TEXT = {
  near_tie: "There's nothing yet for a change to flip: the options came out too close together on this run to tell apart.",
  withheld: "There's nothing yet for a change to flip, because this analysis doesn't put one option forward yet.",
} as const;

/** The read whose licence decides the words: the one the response is composed from (Codex P1 #2569), else the Run's. */
export type LicenceRead = { readonly analysisState?: unknown; readonly analysisReady?: unknown };

function noLeaderToFlip(licence: LicenceRead): string | null {
  if (leaderLicenceFromState(licence.analysisState, licence.analysisReady) !== 'withheld') return null;
  const claim = (licence.analysisState as { leader_claim?: { withheld_reason?: unknown; separation?: unknown } } | null | undefined)?.leader_claim;
  return claim?.withheld_reason === WITHHELD_NEAR_TIE || claim?.separation === SEPARATION_NEAR_TIE
    ? NO_LEADER_TO_FLIP_TEXT.near_tie : NO_LEADER_TO_FLIP_TEXT.withheld;
}

/** The existing Explain control owns currentness and full Run binding; this consumer neither computes nor grants it. */
export function tippingPointCoachingFor(
  scenarioId: string, read: RunExplanationRead & { readonly analysisReady?: unknown }, licence: LicenceRead = read, subjectFactorId: string | null | undefined,
): TippingPointCoaching {
  const bound = runExplanationChip(scenarioId, read);
  if (bound === null) return { kind: 'unavailable', reply: RUN_EXPLANATION_UNAVAILABLE_TEXT };
  const result = read.analysisResult as { enrichment?: unknown };
  const fact = tippingPointOf(result.enrichment, subjectFactorId);
  if (fact.status !== 'found') {
    // A "no threshold" answer is about THIS Run as much as a found one: it keeps the Run key the route re-checks (Codex P1 #2542).
    return { kind: 'no_signal', run_key: bound.id, status: fact.status, reply: noLeaderToFlip(licence) ?? (fact.status === 'no_flip_in_range'
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
