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
 *    field is outside the analysis hash, so a concurrent change to it alone moves no revision, and this is its stale gate
 *    (the contract's `expected_goal_horizon` pattern on `goal_target_edit`);
 *  · the date must be a real calendar date;
 *  · ONLY `goal_horizon` on that one node changes (`goalHorizonPostimageIsScoped`).
 */
import { isDeepStrictEqual } from 'node:util';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { goalDeadlineOf } from './goal-kind.js';
import { sayDate } from './deadline-date.js';

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
}

export type GoalHorizonRefusal = 'invalid_graph' | 'goal_not_found' | 'not_a_goal' | 'date_invalid' | 'deadline_changed';

export type GoalHorizonEditResult =
  | { readonly kind: 'mutated'; readonly mutatedGraph: Rec; readonly handlerFacts: readonly HandlerFact[]; readonly confirmation: string }
  /** The goal already holds exactly this date: a verified no-op (a retry of a write that landed). Nothing is written. */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: GoalHorizonRefusal };

const isCalendarDate = (d: unknown): d is string => {
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
  const held = goalDeadlineOf(matches[0]) ?? null;
  if (held === approved.deadline) return { kind: 'unchanged' };
  if (held !== approved.expected_deadline) return { kind: 'refused', reason: 'deadline_changed' };

  const part = draftedTeamPartOf(persistedGraph);
  if (part !== null && (approved.reference_date === undefined || !isCalendarDate(approved.reference_date)
    || approved.reference_date >= approved.deadline)) return { kind: 'refused', reason: 'date_invalid' };
  const graph = (part !== null ? withEventShareDate(persistedGraph, approved.deadline, approved.reference_date!)
    : structuredClone(persistedGraph)) as Rec & { nodes: unknown[] };
  const goal = graph.nodes.find((n): n is Rec => isRec(n) && n.id === approved.goal_id)!;
  goal.goal_horizon = { deadline: approved.deadline };

  const label = typeof goal.label === 'string' && goal.label.trim() !== '' ? goal.label.trim() : 'the goal';
  const hash = computeAnalysisAffectingGraphHash(graph as never) || null;
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
      // A conventional horizon is outside the hash; materialising forecast shares moves the analysis revision.
      graph_hash_before: computeAnalysisAffectingGraphHash(persistedGraph as never) || null,
      graph_hash_after: hash,
      safe_summary: summary.length <= 80 ? summary : 'Set the deadline',
      impact: 'low',
      rerun_recommended: part !== null,
    },
  });
  return { kind: 'mutated', mutatedGraph: graph, handlerFacts: [fact as HandlerFact],
    confirmation: `Your deadline for "${label}" is now ${sayDate(approved.deadline)}.` };
}

/** A conventional deadline changes only its horizon; a forecast date also refreshes its own defined shares. */
export function goalHorizonPostimageIsScoped(before: unknown, after: unknown, goalId: string, expectedReference?: string): boolean {
  if (!isRec(before) || !isRec(after) || !Array.isArray(before.nodes) || !Array.isArray(after.nodes)) return false;
  const part = draftedTeamPartOf(before), goal = (after.nodes as Rec[]).find(n => n.id === goalId);
  if (part !== null && part.goal.id === goalId && goal !== undefined) {
    const reference = (after.nodes as Rec[]).find(n => n.observed_state && isRec(n.observed_state)
      && isRec(n.observed_state.extra_share_by_date))?.observed_state as Rec | undefined;
    const date = goalDeadlineOf(goal), ref = expectedReference ?? (reference?.extra_share_by_date as Rec | undefined)?.reference_date;
    return typeof date === 'string' && typeof ref === 'string'
      && isDeepStrictEqual(withEventShareDate(before, date, ref), after);
  }
  const strip = (g: Rec): Rec => ({ ...g, nodes: (g.nodes as unknown[]).map((n) => {
    if (!isRec(n) || n.id !== goalId) return n;
    const { goal_horizon: _h, ...rest } = n;
    return rest;
  }) });
  return isDeepStrictEqual(strip(before), strip(after));
}
