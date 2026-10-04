/** A deterministic RC-WHAT-CHANGES answer on the canonical reader's selected Run. No new truth or persistence. */
import { createHash } from 'node:crypto';
import { tippingPointOf, type TippingPoint } from './decision-sensitivity.js';
import type { SuggestedAction } from '../compose/types.js';
import { checkMethodTurn } from './guidance/index.js';
import type { MethodInputs } from './guidance/types.js';
import { runExplanationChip, RUN_EXPLANATION_UNAVAILABLE_TEXT, type RunExplanationRead } from './run-explanation.js';

export const TIPPING_POINT_PRESS_ID = 'agent-next-what-would-change';
export const TIPPING_POINT_REFINEMENT_PREFIX = 'agent-refine-tipping-factor:';
type Found = Extract<TippingPoint, { status: 'found' }>;
export type TippingPointCoaching =
  | { readonly kind: 'found'; readonly run_key: string; readonly fact: Found; readonly reply: string; readonly check_inputs: MethodInputs }
  | { readonly kind: 'unavailable'; readonly reply: string }
  | { readonly kind: 'no_signal'; readonly status: Exclude<TippingPoint['status'], 'found'>; readonly reply: string };

/** A conversation entry, not an approved edit or a mutation handler. */
export interface TippingPointRefinement {
  readonly factor_id: string;
  readonly run_key: string;
  readonly action: SuggestedAction;
}

/** The existing Explain control owns currentness and full Run binding; this consumer neither computes nor grants it. */
export function tippingPointCoachingFor(scenarioId: string, read: RunExplanationRead): TippingPointCoaching {
  const bound = runExplanationChip(scenarioId, read);
  if (bound === null) return { kind: 'unavailable', reply: RUN_EXPLANATION_UNAVAILABLE_TEXT };
  const result = read.analysisResult as { enrichment?: unknown };
  const fact = tippingPointOf(result.enrichment);
  if (fact.status !== 'found') {
    return { kind: 'no_signal', status: fact.status, reply: fact.status === 'no_flip_in_range'
      ? 'This analysis has no factor threshold to quote within the ranges it checked.'
      : 'This analysis has no grounded factor threshold available to quote.' };
  }
  return { kind: 'found', run_key: bound.id, fact, reply: fact.say,
    check_inputs: { factor_label: fact.label, factor_current_value: fact.current_value,
      tipping_point: fact, 'run.kind': 'complete_current' } };
}

/** Reuse the same current fact; the integrator resolves the ID again before beginning refinement. */
export function tippingPointRefinementFor(scenarioId: string, read: RunExplanationRead): TippingPointRefinement | null {
  const plan = tippingPointCoachingFor(scenarioId, read);
  if (plan.kind !== 'found') return null;
  const binding = { run_key: plan.run_key, factor_id: plan.fact.factor_id };
  const digest = createHash('sha256').update(JSON.stringify(binding)).digest('hex').slice(0, 16);
  return { ...binding, action: {
    id: `${TIPPING_POINT_REFINEMENT_PREFIX}${digest}`,
    label: `Refine ${plan.fact.label}`,
    message: `Help me refine ${plan.fact.label}. Ask me what value or evidence to use before proposing an edit.`,
  } };
}

/** Dispatch recognition only; this prefix does not license a factor, Run or edit. */
export function isTippingPointRefinementAction(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(TIPPING_POINT_REFINEMENT_PREFIX);
}

/** Recover the actual factor ID from today's selected fact, never from a label or old chip text. */
export function readTippingPointRefinement(id: unknown, scenarioId: string, read: RunExplanationRead): TippingPointRefinement | null {
  if (!isTippingPointRefinementAction(id)) return null;
  const current = tippingPointRefinementFor(scenarioId, read);
  return current !== null && current.action.id === id ? current : null;
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
