/**
 * ⭐ A HELD CARD IS STALE ONLY WHEN ITS OWN SUBJECT CHANGED (hiring judges post3007/3008/3009, "the deadline card lapses after
 * an unrelated approval"; served post3009 turn 05: approving two link strengths moved the model, and the pending deadline card
 * "no longer fits the model as it now stands, so it has lapsed" while the goal and its date were unchanged). The ONE
 * field-scoped rule, read at BOTH ends of a held card's life:
 *  · the press (`ProposalStore.authorise`'s `scoped_precondition_holds`): a moved model is not `superseded` while it holds;
 *  · the lapse (`reconcileHeldProposals`): a moved model does not lapse the card while it holds.
 * The digest is unchanged (the chip the user sees stays the one they press), the writer CASes on the CURRENT base, and
 * `authorise` still checks the user. Each kind's rule is its own writer's gate:
 *  · a team-time card: what it read is unchanged (`teamTimeReadHolds`);
 *  · a hiring-times card: its parts, carriers and deadline stand (`hiringTimesStillApply`);
 *  · a risk occurrence card: its own writer would not refuse it (`riskOccurrenceCardHolds`: the goal as bound, the node as shown);
 *  · a deadline card: the goal's COMPLETE projection (`goalReadingProjectionOf`: label, target, horizon, period, reading; DL 14 Oct,
 *    the PL's "reuse the complete current goal/reading") is exactly the one the card was made against, so ANY change to the goal
 *    lapses it (conservative) and an unrelated link edit does not. The rule is strict: a retry after the card's own write
 *    is continued by the press and the writer from that proposal's own write identity, never from an equal date. A card made
 *    before its subject was recorded keeps the whole-model rule.
 *  · a new link with its level: the link is still absent and the option still sets nothing on that factor (`newLinkLevelsStillApply`);
 * Initial build: session 4's staged work (`/private/tmp/b-lapse`, 14 Oct), extended to the complete goal subject.
 *  · a model program's card: its program revision is still the saved program's (`programCardApplies`, inventory F6), whatever
 *    the analysis hash says; a program card held before its revision was recorded keeps the rule below.
 * Any other card keeps the whole-model rule.
 */
import { isDeepStrictEqual } from 'node:util';
import type { StructuredProposal } from '../proposal.js';
import type { PendingAction } from '../../session/pending-action.js';
import { teamTimeReadHolds } from '../../goal-target/team-share-write.js';
import { hiringTimesStillApply, type ApprovedHiringTimes } from '../../goal-target/hiring-times.js';
import { optionCapacityChangeStillApplies, type ApprovedOptionCapacityChange } from '../../goal-target/option-capacity-change.js';
import { goalDeadlineFromRecord } from '../../goal-target/goal-kind.js';
import { goalReadingProjectionOf } from '../../goal-target/goal-reading-write.js';
import { riskOccurrenceCardHolds, SET_RISK_OCCURRENCE_OP } from '../risk-occurrence.js';
import { asMemberOp } from '../../statement-door/door.js';
import { applyGoalHorizonEdit } from '../../goal-target/goal-horizon-write.js';
import { cohortForecastCardHolds, statementRecordCardHolds, SET_COHORT_FORECAST_OP, SET_STATEMENT_RECORD_OP } from '../../goal-target/cohort-forecast-write.js';
import { programCardApplies } from '../../model-program-turn/program-card.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** As the stored card carries it (a JSON round trip drops absent members). */
const asStored = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The deadline card's subject at hold time: the goal's complete projection, recorded on the card's own operation. */
export function deadlineCardSubjectOf(graph: unknown, goalId: string): unknown {
  return asStored(goalReadingProjectionOf(graph, goalId));
}

/**
 * Whether a deadline card's recorded subject still holds on `graph`; `undefined` when the card recorded none (made before
 * this rule: its writer keeps its own date gate, and the lapse and press keep the whole-model rule).
 */
export function deadlineSubjectHolds(op: StructuredProposal['operations'][number], graph: unknown): boolean | undefined {
  const v = op.value as { deadline?: unknown; expected_deadline?: unknown; expected_goal?: unknown } | null | undefined;
  if (!isRec(v?.expected_goal)) return undefined;
  if (typeof v.deadline !== 'string' || (v.expected_deadline !== null && typeof v.expected_deadline !== 'string')) return false;
  return deadlineGoalStillBound(graph, op.path, v.expected_deadline, v.expected_goal);
}

/** Readback only. An applied deadline needs its own committed operation as well as this native unchanged verdict. */
export function appliedDeadlineHolds(op: StructuredProposal['operations'][number], graph: unknown): boolean {
  const v = op.value;
  if (op.op !== 'set_goal_deadline' || !isRec(v) || typeof v.deadline !== 'string'
    || (v.expected_deadline !== null && typeof v.expected_deadline !== 'string')
    || (v.reference !== undefined && typeof v.reference !== 'string')
    || (v.stated_months !== undefined && typeof v.stated_months !== 'number')
    || (v.answers_question !== undefined && typeof v.answers_question !== 'string')) return false;
  return applyGoalHorizonEdit(graph, { goal_id: op.path, deadline: v.deadline, expected_deadline: v.expected_deadline,
    ...(v.reference === undefined ? {} : { reference_date: v.reference }),
    ...(v.stated_months === undefined ? {} : { stated_months: v.stated_months }),
    ...(v.answers_question === undefined ? {} : { answers_question: v.answers_question }),
  }).kind === 'unchanged';
}

/**
 * The goal exactly as a deadline card bound it, its date NOT yet written: the one check the press, the lapse, the commit seams
 * and the store-reading writer all read. Strict: an equal date set by anyone is never taken for the card's own landed write
 * (Codex r1 on #3024); a retry continues only from THIS proposal's own write identity, which only the press and the writer
 * hold (its partial progress, its own commit), never this rule.
 */
export function deadlineGoalStillBound(graph: unknown, goalId: string, expectedDeadline: string | null, expectedGoal: unknown): boolean {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  if (nodes.filter((n) => n.id === goalId).length !== 1 || !nodes.some((n) => n.id === goalId && n.kind === 'goal')) return false;
  const now = deadlineCardSubjectOf(graph, goalId);
  if (now === undefined) return false;
  return (goalDeadlineFromRecord(graph, goalId) ?? null) === expectedDeadline && isDeepStrictEqual(now, expectedGoal);
}

/**
 * ⭐ A NEW LINK WITH ITS LEVEL reads only its own subject (assessment 18 Oct K5 T4: approving Olumi's starting value for the
 * factor lapsed the user's pending "acts on … (a new link) and sets it to 10%" card). Every level op has its link op on the
 * same `option::factor` path, so the card still applies while each option and factor exists, the link is still absent and
 * the option still sets nothing on that factor. A write elsewhere (that factor's own starting value included) never stales
 * it; one that adds the link or a level on that path does. `undefined`: not this shape (the caller's other rules decide).
 */
function newLinkLevelsStillApply(ops: StructuredProposal['operations'], graph: unknown): boolean | undefined {
  const levels = ops.filter((o) => o.op === 'set_option_intervention');
  const links = ops.filter((o) => o.op === 'add_edge');
  if (levels.length === 0 || levels.length + links.length !== ops.length || links.length !== levels.length
    || !levels.every((l) => links.some((e) => e.path === l.path && isRec(e.value) && e.value['link_for_level'] === true))) return undefined;
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return false;
  const nodes = graph.nodes.filter(isRec);
  const edges = graph.edges.filter(isRec);
  return levels.every((l) => {
    const [optionId, factorId] = l.path.split('::');
    const option = nodes.filter((n) => n.id === optionId);
    if (option.length !== 1 || option[0]!.kind !== 'option' || nodes.filter((n) => n.id === factorId).length !== 1) return false;
    if (edges.some((e) => e.from === optionId && e.to === factorId)) return false;
    const carriers = [option[0]!.interventions, isRec(option[0]!.data) ? option[0]!.data.interventions : undefined].filter(isRec);
    return !carriers.some((c) => Object.hasOwn(c, factorId!)) && !Object.hasOwn(option[0]!, `data/interventions/${factorId}`);
  });
}

export function heldCardStillApplies(p: Pick<StructuredProposal, 'operations'>, graph: unknown): boolean {
  const program = programCardApplies(p, graph);
  if (program !== undefined) return program;
  if (teamTimeReadHolds(p, graph)) return true;
  const newLink = newLinkLevelsStillApply(p.operations, graph);
  if (newLink !== undefined) return newLink;
  if (p.operations.length !== 1) return false;
  // A card through the ONE statement door is judged by its carrier member's own rule (`asMemberOp`).
  const op = asMemberOp(p.operations[0]!) ?? p.operations[0]!;
  if (op.op === 'set_hiring_times') return hiringTimesStillApply(op.value as ApprovedHiringTimes, graph);
  if (op.op === 'set_option_capacity_change') return optionCapacityChangeStillApplies(op.value as ApprovedOptionCapacityChange, graph);
  if (op.op === 'set_goal_deadline') return deadlineSubjectHolds(op, graph) === true;
  // A limit card: its row still reads the figure it was made against (verifier F1: a same-turn limit card beside a figure card).
  if (op.op === 'set_limit') return limitRowReadsAsMade(op, graph);
  // A risk occurrence card: its own writer's gate (its goal as bound, its node as shown; #3013).
  if (op.op === SET_RISK_OCCURRENCE_OP) return riskOccurrenceCardHolds(op, graph);
  // A cohort forecast card: its own writer's gate (the option as shown, the two targets as read).
  if (op.op === SET_COHORT_FORECAST_OP) return cohortForecastCardHolds(op, graph);
  // The goal's same-people card: its own writer's gate (the goal as shown).
  if (op.op === SET_STATEMENT_RECORD_OP) return statementRecordCardHolds(op, graph);
  return false;
}

/**
 * The limit row a `set_limit` card changes, EXACTLY as the card was made against (`row_as_made`, its whole meaning: comparator
 * as stated, figure, unit, frame, role). Codex BLOCK on #3424 @db2376d0: a strictness edit ("at most 3" → "less than 3") left a
 * card showing "at most 2" applicable, and its press saved "less than 2". A card made before the snapshot holds only on its base.
 */
function limitRowReadsAsMade(op: { readonly path?: string; readonly value?: unknown }, graph: unknown): boolean {
  const v = op.value as { constraint_id?: unknown; row_as_made?: unknown } | undefined;
  if (!isRec(v?.row_as_made)) return false;
  const rows = isRec(graph) && Array.isArray(graph['goal_constraints']) ? (graph['goal_constraints'] as unknown[]).filter(isRec) : [];
  const row = rows.filter((r) => r['constraint_id'] === v.constraint_id);
  return row.length === 1 && row[0]!['node_id'] === op.path && isDeepStrictEqual(row[0], v.row_as_made);
}

/**
 * A card whose RECORDED subject moved although the model's hash did not (a goal's date, label or reading can change outside the
 * analysis hash): lapsed by the reconcile too, so ANY change to the card's goal retires it (DL 14 Oct, conservative). A card
 * with no recorded subject is never judged here (the whole-model rule owns it).
 */
export function heldCardSubjectMoved(p: Pick<StructuredProposal, 'operations'>, graph: unknown): boolean {
  // A program card's subject is its program revision: one that moved outside the analysis hash (a label, a quote, an approval).
  const program = programCardApplies(p, graph);
  if (program !== undefined) return !program;
  if (p.operations.length !== 1) return false;
  const op = asMemberOp(p.operations[0]!) ?? p.operations[0]!;
  if (op.op === SET_RISK_OCCURRENCE_OP) return !riskOccurrenceCardHolds(op, graph);
  if (op.op === SET_COHORT_FORECAST_OP) return !cohortForecastCardHolds(op, graph);
  if (op.op === SET_STATEMENT_RECORD_OP) return !statementRecordCardHolds(op, graph);
  return op.op === 'set_goal_deadline' && deadlineSubjectHolds(op, graph) === false;
}

/**
 * The same rule for a HELD Agent card as a stored pending carries it (`inline_patch.agent_proposal`), at the two lapse seams
 * that see only pendings: a mutating commit's referee (`threadHoldsThroughMutatingCommit`) and the commit's own carry-forward
 * (`computeSurvivingPriorPendingsDetailed`, its hash rule). The hold keeps its pin: an Agent card's pin IS its proposal's base
 * (`agentProposalOf`), so re-pinning it would break the card the user sees.
 */
/** A held Agent card as a stored pending carries it (`inline_patch.agent_proposal`). */
export function isHeldAgentCard(pa: PendingAction): boolean {
  return pa.action.kind === 'apply_proposed_change' && isRec((pa.action.inline_patch as Rec | undefined)?.['agent_proposal']);
}

// The review marker and the card being applied live with the program card's rules (`program-card.ts`, inventory F6 part b):
// one definition of the persisted marker and one async context, read here by the legacy seams.
export { heldCardForReview, heldCardUnderReview, heldCardUnderReviewIn, isHeldCardBeingApplied, runApplyingHeldCard } from '../../model-program-turn/program-card.js';

export { heldProgramCardMoved } from '../../model-program-turn/program-card.js';

export function heldAgentCardStillApplies(pa: PendingAction, graph: unknown): boolean {
  if (pa.action.kind !== 'apply_proposed_change') return false;
  const proposal = (pa.action.inline_patch as Rec | undefined)?.['agent_proposal'];
  const operations = isRec(proposal) ? proposal['operations'] : undefined;
  // The whole stored proposal: a program card is judged by its revision; every other rule reads its operations alone.
  return Array.isArray(operations) && heldCardStillApplies({ ...(proposal as Rec), operations } as Pick<StructuredProposal, 'operations'>, graph);
}

/**
 * Whether a held card applies to `graph` NOW, the whole rule in one place (#3024): on the model it was made against, unless
 * its own subject moved (`heldCardSubjectMoved`); on a moved model, only by its own field-scoped rule (`heldCardStillApplies`).
 * Read wherever a held card is SHOWN (the turn's cards and fields, a replay, a cold reload), as the press and the lapse read it.
 */
export function heldCardAppliesAt(p: Pick<StructuredProposal, 'operations' | 'base_graph_identity_hash'>, graph: unknown, graphHash: string | undefined): boolean {
  if (graphHash === undefined || graphHash === '') return false;
  const program = programCardApplies(p, graph);
  if (program !== undefined) return program;
  return p.base_graph_identity_hash === graphHash ? !heldCardSubjectMoved(p, graph) : heldCardStillApplies(p, graph);
}
