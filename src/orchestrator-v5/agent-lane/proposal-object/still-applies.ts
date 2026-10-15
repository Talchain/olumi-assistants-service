/**
 * ⭐ A HELD CARD IS STALE ONLY WHEN ITS OWN SUBJECT CHANGED (served hiring witness on 35a66525, turn 04: a pending deadline
 * card "no longer fits the model as it now stands, so it has lapsed" after two unrelated link strengths were approved; the
 * saved goal and its date were unchanged). The ONE field-scoped rule, read at BOTH ends of a held card's life:
 *  · the press (`ProposalStore.authorise`'s `scoped_precondition_holds`): a moved model is not `superseded` while it holds;
 *  · the lapse (`reconcileHeldProposals`): a moved model does not lapse the card while it holds.
 * Each kind's rule is the gate its own writer applies, so the card survives exactly when its press could still write:
 *  · a team-time card: what it read is unchanged (`teamTimeReadHolds`);
 *  · a hiring-times card: its parts, carriers and deadline stand (`hiringTimesStillApply`);
 *  · a deadline card: its goal is still the model's goal and holds the date the card was made against, or the card's own
 *    date (a retry of a write that landed) — `applyGoalDeadline`'s stale gate.
 * Any other card keeps the whole-model rule.
 */
import type { StructuredProposal } from '../proposal.js';
import { teamTimeReadHolds } from '../../goal-target/team-share-write.js';
import { hiringTimesStillApply, type ApprovedHiringTimes } from '../../goal-target/hiring-times.js';
import { goalDeadlineFromRecord } from '../../goal-target/goal-kind.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function goalDeadlineStillApplies(op: StructuredProposal['operations'][number], graph: unknown): boolean {
  const v = op.value as { deadline?: unknown; expected_deadline?: unknown } | null | undefined;
  if (typeof v?.deadline !== 'string' || (v.expected_deadline !== null && typeof v.expected_deadline !== 'string')) return false;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  if (nodes.filter((n) => n.id === op.path).length !== 1 || !nodes.some((n) => n.id === op.path && n.kind === 'goal')) return false;
  const heldNow = goalDeadlineFromRecord(graph, op.path) ?? null;
  return heldNow === v.expected_deadline || heldNow === v.deadline;
}

export function heldCardStillApplies(p: Pick<StructuredProposal, 'operations'>, graph: unknown): boolean {
  if (teamTimeReadHolds(p, graph)) return true;
  if (p.operations.length !== 1) return false;
  const op = p.operations[0]!;
  if (op.op === 'set_hiring_times') return hiringTimesStillApply(op.value as ApprovedHiringTimes, graph);
  if (op.op === 'set_goal_deadline') return goalDeadlineStillApplies(op, graph);
  return false;
}
