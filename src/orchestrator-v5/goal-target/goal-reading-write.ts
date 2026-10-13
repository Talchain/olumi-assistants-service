/**
 * ⭐ G — THE USER'S ANSWER TO THEIR GOAL'S OPEN QUESTION (bG brief, "relative to today" continuation; G14).
 *
 * The drafter keeps the target's reading as Olumi's (`goal_target_basis`, `source: 'olumi_reading'`) and, when the user's
 * words read more than one way, ONE question (`open_question`, amendment 3). While it is there no chance is shown (the
 * licence and the gate withhold "can be read more than one way"). Served 13 Oct 13:18Z (CEE afd572e8): hiring's draft held
 * the relative reading ("% of today's productivity", reference today) AND the question "10% relative to today's
 * productivity, or 10 percentage points?"; when the user answered, nothing could record it, so the chance stayed withheld.
 *
 * This is the one writer of that answer. Reached ONLY through the atomic level door's `goal_reading` member
 * (`executeOptionInterventionBatch`), alone in its commit, after the user pressed the card that showed the question and the
 * reading it answers with. Pure:
 *  · the goal must be a goal, by id;
 *  · the stored reading must equal, byte for byte, the one the card showed (`expected_basis`, its question included): the
 *    stale gate — any other change to the reading or its target refuses;
 *  · the question must be a reading question: `CONDITIONS_NOT_KEPT` is admission's refusal of the conditions, never a
 *    question the user can answer, and is never removed here;
 *  · the postimage removes ONLY `open_question`; every other member, the target and the rest of the graph are unchanged.
 * The reading stays Olumi's (`source` is not touched); the answer is the user's, recorded by the approval's own receipt.
 * `goal_target_basis` is in the analysis hash, so the stored Run goes stale and the next Run reads the answered reading.
 */
import { isDeepStrictEqual } from 'node:util';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { CONDITIONS_NOT_KEPT, goalTargetBasisOf, targetChanceWords, type GoalTargetBasis } from './goal-target-basis.js';
import { readHeldGoalComparator } from './goal-direction.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The approved card, as the batch door carries it. */
export interface ApprovedGoalReading {
  readonly goal_id: string;
  /** The stored `goal_target_basis` the card showed, byte for byte, with its `open_question`: the writer's stale gate. */
  readonly expected_basis: Readonly<Rec>;
}

export type GoalReadingRefusal = 'invalid_graph' | 'goal_not_found' | 'not_a_goal' | 'no_open_question' | 'not_a_reading_question'
  | 'reading_changed';

export type GoalReadingEditResult =
  | { readonly kind: 'mutated'; readonly mutatedGraph: Rec; readonly handlerFacts: readonly HandlerFact[]; readonly confirmation: string }
  /** The goal already holds exactly the answered reading: a verified no-op (a retry of a write that landed). */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: GoalReadingRefusal };

/** The reading as the card showed it, without its question: what the approved write leaves (key order kept). */
export function answeredBasisOf(expected: Readonly<Rec>): Rec {
  const answered = structuredClone(expected) as Rec;
  delete answered.open_question;
  return answered;
}

/**
 * The goal's target in words, as its reading states it ("‘productivity’ being at least 10% higher than today at three
 * months"), with what 100% is for a change: the card's and the receipt's one description. `undefined` when not sayable.
 */
export function goalReadingWords(graph: unknown, goal: Rec, basis: GoalTargetBasis): string | undefined {
  const label = typeof goal.label === 'string' ? goal.label : '';
  const comparator = readHeldGoalComparator(graph, goal.id) ?? goal.goal_direction;
  const unit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit : '';
  const words = targetChanceWords({ label, frame: basis.target_frame, comparator: String(comparator ?? ''), value: basis.target_raw,
    unit, basis, quantityFrame: basis.quantity_frame });
  if (words === undefined) return undefined;
  return basis.target_frame !== 'level' && basis.denominator !== undefined ? `${words}, measured against ${basis.denominator}` : words;
}

/** AIE_TEXT_PENDING: the receipt after the approved answer. Facts only; no promise of a chance. */
export const GOAL_READING_RECORDED_TEMPLATE = 'Recorded your answer: your target is read as {reading}. Run the analysis again.';

export function applyGoalReadingEdit(persistedGraph: unknown, approved: ApprovedGoalReading): GoalReadingEditResult {
  if (!isRec(persistedGraph) || !Array.isArray(persistedGraph.nodes) || !Array.isArray(persistedGraph.edges)) {
    return { kind: 'refused', reason: 'invalid_graph' };
  }
  const expected = approved.expected_basis;
  if (!isRec(expected) || typeof expected.open_question !== 'string' || expected.open_question.trim() === '') {
    return { kind: 'refused', reason: 'no_open_question' };
  }
  if (expected.open_question === CONDITIONS_NOT_KEPT) return { kind: 'refused', reason: 'not_a_reading_question' };
  const matches = persistedGraph.nodes.filter((n): n is Rec => isRec(n) && n.id === approved.goal_id);
  if (matches.length !== 1) return { kind: 'refused', reason: 'goal_not_found' };
  if (matches[0]!.kind !== 'goal') return { kind: 'refused', reason: 'not_a_goal' };
  const held = matches[0]!.goal_target_basis;
  const answered = answeredBasisOf(expected);
  // ⭐ IDEMPOTENT: a retry after a write that landed finds the answered reading held — the approved outcome. Checked BEFORE
  // the stale gate, which the first write itself moved; the reading must still be the goal's own (its target unchanged).
  if (isDeepStrictEqual(held, answered)) {
    return goalTargetBasisOf(matches[0]) !== undefined ? { kind: 'unchanged' } : { kind: 'refused', reason: 'reading_changed' };
  }
  if (!isDeepStrictEqual(held, expected) || goalTargetBasisOf(matches[0]) === undefined) return { kind: 'refused', reason: 'reading_changed' };

  const graph = structuredClone(persistedGraph) as Rec & { nodes: unknown[] };
  const goal = graph.nodes.find((n): n is Rec => isRec(n) && n.id === approved.goal_id)!;
  goal.goal_target_basis = answered;
  const basis = goalTargetBasisOf(goal);
  if (basis === undefined || basis.open_question !== undefined) return { kind: 'refused', reason: 'reading_changed' };

  const label = typeof goal.label === 'string' && goal.label.trim() !== '' ? goal.label.trim() : 'the goal';
  const beforeHash = computeAnalysisAffectingGraphHash(persistedGraph as never) || null;
  const afterHash = computeAnalysisAffectingGraphHash(graph as never) || null;
  const fact = EditGraphHandlerFactSchema.parse({
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind: 'parameter_update',
      status: 'applied',
      operations_count: 1,
      affected_entities: [{ kind: 'goal', label: label.slice(0, 120) }],
      graph_hash_before: beforeHash,
      graph_hash_after: afterHash,
      safe_summary: 'Recorded your answer about how the target is read',
      impact: 'low',
      rerun_recommended: true,
    },
  });
  const reading = goalReadingWords(graph, goal, basis) ?? `the target for ‘${label}’ as the model states it`;
  return { kind: 'mutated', mutatedGraph: graph, handlerFacts: [fact as HandlerFact],
    confirmation: GOAL_READING_RECORDED_TEMPLATE.replace('{reading}', reading) };
}

/** The freshly computed atomic write, exactly: the writer's own postimage of `before`, nothing else. */
export function goalReadingPostimageIsScoped(before: unknown, after: unknown, approved: ApprovedGoalReading): boolean {
  const written = applyGoalReadingEdit(before, approved);
  return written.kind === 'mutated' && isDeepStrictEqual(written.mutatedGraph, after);
}
