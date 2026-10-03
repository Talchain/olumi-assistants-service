/** A deterministic RC-WHAT-CHANGES answer on the canonical reader's selected Run. No new truth or persistence. */
import { tippingPointOf, type TippingPoint } from './decision-sensitivity.js';
import { checkMethodTurn } from './guidance/index.js';
import type { MethodInputs } from './guidance/types.js';
import { runExplanationChip, RUN_EXPLANATION_UNAVAILABLE_TEXT, type RunExplanationRead } from './run-explanation.js';

export const TIPPING_POINT_PRESS_ID = 'agent-next-what-would-change';
type Found = Extract<TippingPoint, { status: 'found' }>;
export type TippingPointCoaching =
  | { readonly kind: 'found'; readonly run_key: string; readonly fact: Found; readonly reply: string; readonly check_inputs: MethodInputs }
  | { readonly kind: 'unavailable'; readonly reply: string }
  | { readonly kind: 'no_signal'; readonly run_key: string; readonly status: Exclude<TippingPoint['status'], 'found'>; readonly reply: string };

/** The existing Explain control owns currentness and full Run binding; this consumer neither computes nor grants it. */
export function tippingPointCoachingFor(scenarioId: string, read: RunExplanationRead): TippingPointCoaching {
  const bound = runExplanationChip(scenarioId, read);
  if (bound === null) return { kind: 'unavailable', reply: RUN_EXPLANATION_UNAVAILABLE_TEXT };
  const result = read.analysisResult as { enrichment?: unknown };
  const fact = tippingPointOf(result.enrichment);
  if (fact.status !== 'found') {
    // A "no threshold" answer is about THIS Run as much as a found one: it keeps the Run key the route re-checks (Codex P1 #2542).
    return { kind: 'no_signal', run_key: bound.id, status: fact.status, reply: fact.status === 'no_flip_in_range'
      ? 'This analysis has no factor threshold to quote within the ranges it checked.'
      : 'This analysis has no grounded factor threshold available to quote.' };
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
