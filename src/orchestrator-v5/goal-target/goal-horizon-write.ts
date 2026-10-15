import { draftedTeamPartOf, withEventShareDate } from './event-by-date-model.js';
/**
 * ⭐ S-E GOALS — THE GOAL'S DEADLINE, WRITTEN AS A DATE (lane GOALS, DL 0fd71f, 7 Oct; Science ruling §3; Paul's prod test
 * item 6). The one CEE writer of `NodeV3.goal_horizon` (schemas 0.69.0 `{deadline: YYYY-MM-DD}`), which DGAI's goal card
 * already reads (`goalPeriodHorizon.ts`) and the Agent's guidance already reads (`guidance-signals.ts`): until now nothing
 * wrote it, so a deadline the user stated in chat was "not encoded in the goal yet" and stayed that way.
 *
 * ⛔ ONE WRITER (DL ruling 7 Oct on the S-E design §6): lane GOALS (`goal-target/`) owns every goal target and horizon
 * write. MG #2454's `goal_target_edit` horizon writer is NOT stacked on; its rows and logic are ported here in S2.
 *
 * Reached ONLY through the atomic level door's `goal_horizon` member (`executeOptionInterventionBatch`), alone in its
 * commit, after the user's Yes on the card "Is your deadline 7 April 2027 (6 months from today)?". Pure:
 *  · the goal must be a goal, by id;
 *  · the date the goal holds NOW must equal the one the card was made against (`expected_deadline`, `null` = none): the
 *    calendar date alone is outside the analysis hash; an admitted carrier binds its month count
 *    (the contract's `expected_goal_horizon` pattern on `goal_target_edit`);
 *  · the date must be a real calendar date;
 *  · the recorded draft reference pins completed-month arithmetic, with no clock at approval;
 *  · the scoped postimage holds the deadline, H, and an eligible unconfirmed structural reading.
 */
import { isDeepStrictEqual } from 'node:util';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { assignEntityRefs } from '../graph/entity-refs.js';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { goalDeadlineFromRecord } from './goal-kind.js';
import { admitStructuralGoalAccumulation } from '../agent-lane/accumulation-identity.js';
import { readGoalRecord } from './goal-record.js';
import { readStatedDeadline, sayDate } from './deadline-date.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The approved card, as the batch door carries it. */
export interface ApprovedGoalHorizon {
  readonly goal_id: string;
  /** The calendar date CEE worked out from the user's words (`deadline-date.ts`). */
  readonly deadline: string;
  /** The date the goal held when the card was made; `null` when it held none. */
  readonly expected_deadline: string | null;
  readonly reference_date?: string;
  readonly stated_months?: number;
}

export type GoalHorizonRefusal = 'invalid_graph' | 'goal_not_found' | 'not_a_goal' | 'date_invalid' | 'deadline_changed' | 'reference_missing' | 'horizon_not_modelled';

export type GoalHorizonEditResult =
  | { readonly kind: 'mutated'; readonly mutatedGraph: Rec; readonly handlerFacts: readonly HandlerFact[]; readonly confirmation: string }
  /** The goal already holds exactly this date: a verified no-op (a retry of a write that landed). Nothing is written. */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: GoalHorizonRefusal };

export const isCalendarDate = (d: unknown): d is string => {
  if (typeof d !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m === null) return false;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, da));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === da;
};

export function applyGoalHorizonEdit(persistedGraph: unknown, approved: ApprovedGoalHorizon): GoalHorizonEditResult {
  if (!isRec(persistedGraph) || !Array.isArray(persistedGraph.nodes) || !Array.isArray(persistedGraph.edges)) {
    return { kind: 'refused', reason: 'invalid_graph' };
  }
  if (!isCalendarDate(approved.deadline)) return { kind: 'refused', reason: 'date_invalid' };
  const matches = persistedGraph.nodes.filter((n): n is Rec => isRec(n) && n.id === approved.goal_id);
  if (matches.length !== 1) return { kind: 'refused', reason: 'goal_not_found' };
  if (matches[0]!.kind !== 'goal') return { kind: 'refused', reason: 'not_a_goal' };
  // ⭐ IDEMPOTENT (Codex buddy r1 on #2742): a retry after a write that landed finds the date already held, and that is the
  // approved outcome, never "the deadline changed". Checked BEFORE the stale gate, which the first write itself moved.
  const held = goalDeadlineFromRecord(persistedGraph, approved.goal_id) ?? null;
  if (held !== approved.deadline && held !== approved.expected_deadline) return { kind: 'refused', reason: 'deadline_changed' };

  // No recorded/user-confirmed R: preserve HEAD's calendar-only write and retry semantics.
  const reference = approved.reference_date;
  let months: number | undefined;
  if (reference === undefined) {
    if (held === approved.deadline) return { kind: 'unchanged' };
  } else {
    if (!isCalendarDate(reference)) return { kind: 'refused', reason: 'reference_missing' };
    if (approved.deadline <= reference) return { kind: 'refused', reason: 'horizon_not_modelled' };
    const [yr, mr, dr] = reference.split('-').map(Number) as [number, number, number];
    const [yd, md, dd] = approved.deadline.split('-').map(Number) as [number, number, number];
    months = approved.stated_months ?? 12 * (yd - yr) + md - mr - (dd < dr ? 1 : 0);
    if (!Number.isInteger(months) || months < 1) return { kind: 'refused', reason: 'horizon_not_modelled' };
    if (held === approved.deadline && readGoalRecord(persistedGraph, approved.goal_id)?.horizon?.months === months
      && matches[0]!.goal_horizon_reference_date === reference && matches[0]!.goal_horizon_stated_months === approved.stated_months) return { kind: 'unchanged' };
  }
  const part = reference === undefined ? null : draftedTeamPartOf(persistedGraph);
  if (part !== null && (approved.reference_date === undefined || !isCalendarDate(approved.reference_date)
    || approved.reference_date >= approved.deadline)) return { kind: 'refused', reason: 'date_invalid' };
  const graph = (part !== null ? withEventShareDate(persistedGraph, approved.deadline, approved.reference_date!)
    : structuredClone(persistedGraph)) as Rec & { nodes: unknown[] };
  const goal = graph.nodes.find((n): n is Rec => isRec(n) && n.id === approved.goal_id)!;
  goal.goal_horizon = { deadline: approved.deadline };
  if (reference !== undefined) {
    goal.goal_horizon_months = months;
    goal.goal_horizon_reference_date = reference;
    if (approved.stated_months !== undefined) goal.goal_horizon_stated_months = approved.stated_months;
    else delete goal.goal_horizon_stated_months;
    if (part === null) Object.assign(graph, admitStructuralGoalAccumulation(graph.nodes as Array<Rec & { id: string }>, graph.edges as Array<Rec & { from: string; to: string }>));
  }

  const label = typeof goal.label === 'string' && goal.label.trim() !== '' ? goal.label.trim() : 'the goal';
  // Commit assigns refs to new entities: bind the door to those same projected bytes before hashing/read-back.
  const postimage = reference === undefined ? graph : assignEntityRefs(projectGraphForPersistence(graph), persistedGraph).graph;
  const hash = computeAnalysisAffectingGraphHash(postimage as never) || null;
  const beforeHash = computeAnalysisAffectingGraphHash(persistedGraph as never) || null;
  const summary = `Set the deadline to ${sayDate(approved.deadline)}`;
  const fact = EditGraphHandlerFactSchema.parse({
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind: 'parameter_update',
      status: 'applied',
      operations_count: 1,
      affected_entities: [{ kind: 'goal', label: label.slice(0, 120) }],
      // An admitted structural reading binds H into the analysis hash; otherwise the read-time gate withholds.
      graph_hash_before: beforeHash,
      graph_hash_after: hash,
      safe_summary: summary.length <= 80 ? summary : 'Set the deadline',
      impact: 'low',
      rerun_recommended: reference !== undefined && beforeHash !== hash || part !== null,
    },
  });
  return { kind: 'mutated', mutatedGraph: postimage, handlerFacts: [fact as HandlerFact],
    confirmation: `Your deadline for "${label}" is now ${sayDate(approved.deadline)}.` };
}

/** Validate the entire freshly computed atomic write; landed retries use the field-scoped recovery check below. */
export function goalHorizonPostimageIsScoped(before: unknown, after: unknown, goalId: string, expectedReference?: string | null, statedMonths?: number): boolean {
  if (!isRec(before) || !isRec(after) || !Array.isArray(before.nodes) || !Array.isArray(after.nodes)) return false;
  const deadline = readGoalRecord(after, goalId)?.horizon?.deadline;
  const goal = (after.nodes as Rec[]).find(n => n.id === goalId);
  if (!goal || typeof deadline !== 'string') return false;
  // null pins the date-only door; omitted keeps legacy callers that infer the held reference.
  const reference = expectedReference === null ? undefined : expectedReference ?? goal.goal_horizon_reference_date;
  if (reference !== undefined && typeof reference !== 'string') return false;
  const written = applyGoalHorizonEdit(before, { goal_id: goalId, deadline,
    expected_deadline: readGoalRecord(before, goalId)?.horizon?.deadline ?? null, reference_date: reference,
    ...(statedMonths !== undefined ? { stated_months: statedMonths } : {}) });
  return written.kind === 'mutated' && isDeepStrictEqual(written.mutatedGraph, after);
}

/** Confirm only this deadline writer's fields and its admitted structural postimage, allowing unrelated edits. */
export function goalHorizonLandedWriteIsScoped(expected: unknown, actual: unknown, goalId: string): boolean {
  if (!isRec(expected) || !isRec(actual) || !Array.isArray(expected.nodes) || !Array.isArray(actual.nodes)
    || !Array.isArray(expected.edges) || !Array.isArray(actual.edges)) return false;
  const expectedGoals = expected.nodes.filter((n): n is Rec => isRec(n) && n.id === goalId);
  const actualGoals = actual.nodes.filter((n): n is Rec => isRec(n) && n.id === goalId);
  if (expectedGoals.length !== 1 || actualGoals.length !== 1 || actualGoals[0]!.kind !== 'goal') return false;
  const goal = expectedGoals[0]!, held = actualGoals[0]!;
  const horizonFields = ['goal_horizon', 'goal_horizon_months', 'goal_horizon_reference_date', 'goal_horizon_stated_months'];
  if (!horizonFields.every(field => isDeepStrictEqual(goal[field], held[field]))) return false;
  // A drafted-team date also owns the forecast shares and labels; retain its stricter recovery contract.
  if (goal.goal_horizon_reference_date !== undefined && draftedTeamPartOf(expected) !== null) return isDeepStrictEqual(expected, actual);
  const identity = isRec(goal.nonlinear_identity) ? goal.nonlinear_identity : undefined;
  const carrierIds = identity?.operation === 'sum' && Array.isArray(identity.factor_ids) ? identity.factor_ids : [];
  const carriers = expected.nodes.filter((n): n is Rec => isRec(n) && carrierIds.includes(n.id)
    && isRec(n.nonlinear_identity) && n.nonlinear_identity.operation === 'accumulation');
  if (carriers.length === 0) return true;
  if (!isDeepStrictEqual(goal.nonlinear_identity, held.nonlinear_identity)
    || !isDeepStrictEqual(goal.observed_state, held.observed_state)) return false;
  const ownedIds = new Set(carriers.flatMap(n => [n.id, `${String(n.id)}_net_zero_rate`]));
  const ownedNodes = (graph: Rec) => (graph.nodes as unknown[]).filter((n): n is Rec => isRec(n) && ownedIds.has(n.id));
  const ownedEdges = (graph: Rec) => (graph.edges as unknown[]).filter((e): e is Rec => isRec(e)
    && (ownedIds.has(e.from) || ownedIds.has(e.to)));
  return isDeepStrictEqual(ownedNodes(expected), ownedNodes(actual))
    && isDeepStrictEqual(ownedEdges(expected), ownedEdges(actual));
}

/**
 * ⭐ S7 B2 (hiring e2e c1e944a4/2c43f563, judge item 6): WHO SET THE DATE. A deadline held with the month count the user stated
 * (`goal_horizon_stated_months`, written only by `applyGoalHorizonEdit` above, after the user's Yes on the card) is Olumi's
 * reading of the user's words, counted from the recorded reference date, and approved by the user: the date itself is not
 * the user's. Served: the card said "Olumi's interpretation" of "three months", the user approved it, and a later reply listed
 * "a 15 January 2027 deadline" under "What you supplied". Approval never changes authorship. `undefined` for any other date.
 */
export interface ApprovedDeadlineReading {
  readonly origin: 'olumi_reading';
  readonly approved_by_user: true;
  /** The user's own words the date was read from, verbatim, when the goal holds them. */
  readonly from_words?: string;
  readonly months: number;
  /** The date the months were counted from, in British words. */
  readonly counted_from: string;
}

export function approvedDeadlineReadingOf(graph: unknown, goalId: string): ApprovedDeadlineReading | undefined {
  const goal = isRec(graph) && Array.isArray(graph.nodes)
    ? graph.nodes.find((n): n is Rec => isRec(n) && n.kind === 'goal' && n.id === goalId) : undefined;
  const record = readGoalRecord(graph, goalId)?.horizon;
  const months = goal?.goal_horizon_stated_months;
  const reference = goal?.goal_horizon_reference_date;
  if (record?.deadline === undefined || typeof months !== 'number' || !Number.isInteger(months) || months < 1 || !isCalendarDate(reference)) return undefined;
  // The construction's stated words only where they read to THIS date (served funding run 3: "12 months" held beside an
  // approved 6): otherwise the words the user approved are not known here, and none are quoted.
  const words = record.as_stated !== undefined && readStatedDeadline(record.as_stated, reference, { leadWordsOnly: true })?.date === record.deadline
    ? { from_words: record.as_stated } : {};
  return { origin: 'olumi_reading', approved_by_user: true, ...words, months, counted_from: sayDate(reference) };
}
