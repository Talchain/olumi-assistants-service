import { goalProjectedAtItsMonth } from './decision-input-ask.js';
import { horizonSteadyAttested } from '../goal-target/horizon-basis.js';
import { approvalChipIdFor } from './approval-chips.js';
import { createProposal, type StructuredProposal } from './proposal.js';

export const STEADY_HORIZON_ANSWER = 'It stays about the same unless we act';

/** Offer only on a Run reply; the route also excludes any other held approval. No goal is changed here. */
export function steadyHorizonCard(input: {
  graph: unknown; graphHash: string | undefined; scenarioId: string; userId: string | null;
  runReply: boolean; approvalHeld: boolean;
}): { proposal: StructuredProposal; chip: { id: string; label: string; message: string; detail: string } } | null {
  if (!input.runReply || input.approvalHeld || !input.graphHash
    || input.graph === null || typeof input.graph !== 'object' || Array.isArray(input.graph)) return null;
  const graph = input.graph as { nodes?: unknown; goal_node_id?: unknown };
  if (!Array.isArray(graph.nodes)) return null;
  const goals = graph.nodes.filter((n): n is Record<string, unknown> => n !== null && typeof n === 'object'
    && !Array.isArray(n) && n.kind === 'goal');
  if (goals.length !== 1) return null;
  const goal = goals[0]!;
  const months = goal.goal_horizon_months;
  if (typeof goal.id !== 'string' || typeof goal.label !== 'string'
    || typeof months !== 'number' || !Number.isInteger(months) || months <= 0
    || horizonSteadyAttested(input.graph, input.scenarioId) || goalProjectedAtItsMonth(input.graph)) return null;
  // Never beside an accumulation carrier, confirmed or not: there the month is worked out, so confirming that reading is
  // the path (B1 before its Yes). Keying the offer on the Run's own horizon withhold follows a1's §(ad) withhold code.
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
