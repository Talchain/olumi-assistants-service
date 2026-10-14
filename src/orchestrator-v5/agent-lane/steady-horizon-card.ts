import { GOAL_FIGURES_HORIZON_NOT_TESTED, GOAL_FIGURES_WITHHELD_CODES } from '../../orchestrator/context/option-result-source.js';
import { goalHorizonVerdict, heldGoalHorizonMonths } from '../goal-target/goal-horizon-verdict.js';
import { timeClassOf } from '../goal-target/time-class.js';
import { approvalChipIdFor } from './approval-chips.js';
import { createProposal, type StructuredProposal } from './proposal.js';

export const STEADY_HORIZON_ANSWER = 'It stays about the same unless we act';

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * True only when the untested month (§(ad)) is the SOLE goal-figures withhold cause on this Run. The producer stacks
 * causes (a held month with a missing current level carries both), and the card would then lead the chips and displace
 * the other cause's own next step, e.g. "Set current level" (DL 58e392 #2903 P1).
 */
function runWithheldOnlyForUntestedHorizon(result: unknown): boolean {
  const block = recordOf(result);
  const causes = new Set([block?.inference_warnings, recordOf(block?.enrichment)?.inference_warnings]
    .flatMap(value => Array.isArray(value) ? value : [])
    .map(warning => recordOf(warning)?.code)
    .filter((code): code is string => typeof code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(code)));
  return causes.size === 1 && causes.has(GOAL_FIGURES_HORIZON_NOT_TESTED);
}

/**
 * Offer only on a Run reply whose Run withheld the goal chance for an untested month and for no other cause; the route
 * also excludes any other held approval. A Run withheld for another cause too (e.g. a missing current level) keeps that
 * cause's own next step.
 * No goal is changed here.
 */
export function steadyHorizonCard(input: {
  graph: unknown; graphHash: string | undefined; scenarioId: string; userId: string | null;
  runReply: boolean; runResult: unknown; approvalHeld: boolean;
  /** The stored brief: a brief that states a timing shape the product cannot work out (`time-class.ts`) is offered no steady card. */
  brief?: string | null;
}): { proposal: StructuredProposal; chip: { id: string; label: string; message: string; detail: string } } | null {
  if (!input.runReply || input.approvalHeld || !input.graphHash || !timeClassOf(input.brief).supported || !runWithheldOnlyForUntestedHorizon(input.runResult)
    || input.graph === null || typeof input.graph !== 'object' || Array.isArray(input.graph)) return null;
  const graph = input.graph as { nodes?: unknown };
  if (!Array.isArray(graph.nodes)) return null;
  const goals = graph.nodes.filter((n): n is Record<string, unknown> => n !== null && typeof n === 'object'
    && !Array.isArray(n) && n.kind === 'goal');
  if (goals.length !== 1) return null;
  const goal = goals[0]!;
  const months = heldGoalHorizonMonths(goal);
  if (typeof goal.id !== 'string' || typeof goal.label !== 'string' || months === undefined
    || goalHorizonVerdict(input.graph) === 'steady_attested') return null;
  // Never beside an accumulation carrier, confirmed or not: there the month is worked out, so confirming that reading is
  // the path (B1 before its Yes).
  if (graph.nodes.some((n) => n !== null && typeof n === 'object'
    && (n as { nonlinear_identity?: { operation?: unknown } }).nonlinear_identity?.operation === 'accumulation')) return null;
  const detail = `Does ‘${goal.label}’ stay about the same over ${months} months unless you act? If yes, Olumi records that as your judgement and the chance is worked out for month ${months}; then run the analysis again.`;
  const proposal = createProposal({ scenario_id: input.scenarioId, user_id: input.userId,
    base_graph_identity_hash: input.graphHash,
    operations: [{ op: 'attest_goal_steady', path: goal.id, value: { months } }],
    provenance: { authored_by: 'model_proposed', basis: 'Offered temporal judgement; only a card answer records it as the user’s.' },
    validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: detail });
  return { proposal, chip: { id: approvalChipIdFor(proposal.proposal_id), label: STEADY_HORIZON_ANSWER,
    message: STEADY_HORIZON_ANSWER, detail } };
}
