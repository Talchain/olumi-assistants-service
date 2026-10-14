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
import { CONDITIONS_NOT_KEPT, goalTargetBasisOf, periodWords, type GoalTargetBasis } from './goal-target-basis.js';
import { readGoalRecord, type GoalRecord } from './goal-record.js';
import { sayGoalChange } from '../agent-lane/limit-frame.js';
import { sayFigureWithoutRounding } from '../agent-lane/say-figure.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The approved card, as the batch door carries it. */
export interface ApprovedGoalReading {
  readonly goal_id: string;
  /** The stored `goal_target_basis` the card showed, byte for byte, with its `open_question`: the writer's stale gate. */
  readonly expected_basis: Readonly<Rec>;
  /** The user's own words of the turn the card was made on, verbatim: the answer, kept in the committed row's receipt. */
  readonly answer_words?: string;
  /**
   * The goal's complete saved reading as the card showed it ({@link goalReadingProjectionOf}): a renamed goal, a changed
   * unit, period or deadline does not always move the analysis hash, so the card is bound to all of it.
   */
  readonly expected_goal?: unknown;
  /**
   * ⭐ T1H (DL 14 Oct 22:3xZ; hiring r4): members the user's own verified statement sets (S2 `verifyStatements`): what the
   * target is a % of ("We measure productivity as story points completed per sprint" → the denominator and effect unit), and
   * whether every effect is in place by the period's end ("All of these effects would be fully in place by month 3"). Only
   * these members move; the reading stays Olumi's (`source`), the words are the user's on the card and the receipt.
   */
  readonly members?: GoalReadingMembers;
}

/** The reading members a user's verified statement may set ({@link ApprovedGoalReading.members}). */
export interface GoalReadingMembers {
  readonly denominator?: string;
  readonly effect_unit?: string;
  readonly effects_at_period_end?: boolean;
}
/** A set of members the writer accepts: at least one, each within the reading's own bounds (one line, ≤120 characters). */
export function validGoalReadingMembers(m: unknown): m is GoalReadingMembers {
  if (!isRec(m)) return false;
  const keys = Object.keys(m);
  const text = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '' && v.length <= 120 && !/[\r\n]/.test(v);
  return keys.length > 0 && keys.every((k) => (k === 'denominator' || k === 'effect_unit') ? text(m[k])
    : k === 'effects_at_period_end' ? typeof m[k] === 'boolean' : false);
}

/** The goal's complete saved reading: what the card says, and so all that it binds. */
export interface GoalReadingProjection {
  readonly label: string;
  readonly target: GoalRecord['target'];
  readonly horizon: GoalRecord['horizon'];
  /** The period the goal's figures are per (week, month …), from the ONE record, or null. */
  readonly period: string | null;
  /** The reading as the card says it, without its question: reference, denominator, window, effect unit and conditions. */
  readonly reading: Omit<GoalTargetBasis, 'open_question'> | null;
}

/**
 * ⭐ ONE PROJECTION (Codex check r2 on #2995: the horizon, then the goal's period, each found missing in turn). The card's words are
 * rendered from it ({@link goalReadingWords}), the card carries it as `expected_goal`, and the door and the read-back
 * deep-compare it: no member the card says, or that changes what its figure means, can move unseen. Through the ONE goal
 * record (S5) for the label, target, horizon and period; and the validated reading (`goalTargetBasisOf`).
 */
export function goalReadingProjectionOf(graph: unknown, goalId: string): GoalReadingProjection | undefined {
  const record = readGoalRecord(graph, goalId);
  if (record === null) return undefined;
  const node = ((graph as { nodes: unknown[] }).nodes).find((n): n is Rec => isRec(n) && n.kind === 'goal' && n.id === goalId);
  const basis = goalTargetBasisOf(node);
  const reading = basis === undefined ? null : (({ open_question: _question, ...rest }) => rest)(basis);
  return { label: record.label, target: record.target, horizon: record.horizon, period: record.period ?? null, reading };
}

export type GoalReadingRefusal = 'invalid_graph' | 'goal_not_found' | 'not_a_goal' | 'no_open_question' | 'not_a_reading_question'
  | 'reading_changed' | 'goal_changed' | 'invalid_members';

export type GoalReadingEditResult =
  | { readonly kind: 'mutated'; readonly mutatedGraph: Rec; readonly handlerFacts: readonly HandlerFact[]; readonly confirmation: string }
  /** The goal already holds exactly the answered reading: a verified no-op (a retry of a write that landed). */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: GoalReadingRefusal };

/** The reading as the card showed it, without its question: what the approved write leaves (key order kept). */
export function answeredBasisOf(expected: Readonly<Rec>, members?: GoalReadingMembers): Rec {
  const answered = structuredClone(expected) as Rec;
  delete answered.open_question;
  if (members !== undefined) for (const [k, v] of Object.entries(members)) answered[k] = v;
  return answered;
}

/**
 * The goal's target in words, from its ONE projection ({@link goalReadingProjectionOf}) and said as the readiness words and
 * E's sentence say a change (`sayGoalChange`: "up at least 10% from today"), at the reading's period, with what 100% is:
 * "‘productivity’ up at least 10% from today at three months, measured against today's development productivity". The
 * card's and the receipt's one description; `undefined` when it cannot be said exactly.
 */
export function goalReadingWords(projection: GoalReadingProjection | undefined): string | undefined {
  const target = projection?.target;
  const basis = projection?.reading;
  const label = projection?.label.trim() ?? '';
  if (basis == null || target == null || target.raw === undefined || label === '' || /[\r\n]/.test(label)) return undefined;
  // Every digit: this is what the user confirms (`sayFigureWithoutRounding`; a saved 0.125% was said "0.13%", Codex buddy r3).
  const change = sayGoalChange(target.frame, target.raw, target.unit, (v, u) => sayFigureWithoutRounding(v, u ?? ''), target.comparator);
  const also = basis.also_required ?? [];
  if (change === undefined || also.some((c) => /[\r\n]/.test(c))) return undefined;
  // The reading's retained conditions are additional requirements of the whole held reading (AIE G.conditions_scope): never
  // extra numerical targets, never evaluated. The words supply no closing full stop (the card's and receipt's templates do).
  const conditions = also.join('; ').replace(/\.$/, '');
  return `‘${label}’ ${change} ${periodWords(basis)}${basis.denominator !== undefined ? `, measured against ${basis.denominator}` : ''}`
    + (also.length > 0 ? `. ${GOAL_READING_CONDITIONS_TEMPLATE.replace('{conditions}', () => conditions).replace(/\.$/, '')}` : '');
}

/** The AIE's words (`AIE-CURRENT-SOURCE-AND-CARD-RULINGS-20261014.json` G.conditions), after the reading's own sentence. */
export const GOAL_READING_CONDITIONS_TEMPLATE = 'Other stated requirements: {conditions}.';

/**
 * The receipt, the AIE's AMEND byte for byte (`AIE-GOAL-READING-2995-TEXT-RULINGS-20261013.json` receipt): said only after the
 * writer's confirmed commit and a matching read-back; no "again" and no Run (the existing Run action offers its own step).
 */
export const GOAL_READING_CONFIRMED_TEMPLATE = 'Confirmed the saved target reading: {reading}.';
/** The AIE's optional sentence: only the retained verbatim human answer bound to this card (typed, never chip text). */
export const GOAL_READING_ANSWER_TEMPLATE = 'Your recorded answer was: \u201c{answer}\u201d.';
const ANSWER_QUOTE_MAX = 300;

/** The receipt: the confirmed reading, then the user's answer quoted whole (never cut) when it is held. */
export function goalReadingRecordedWords(reading: string, answer: string | undefined): string {
  const words = answer?.trim() ?? '';
  const base = GOAL_READING_CONFIRMED_TEMPLATE.replace('{reading}', () => reading);
  if (words === '' || words.length > ANSWER_QUOTE_MAX || /[\r\n]/.test(words)) return base;
  // The template's closing full stop is not doubled after an answer that already ends a sentence ("…points.”", the card's rule).
  const said = GOAL_READING_ANSWER_TEMPLATE.replace('{answer}', () => words);
  return `${base} ${/[.?!]$/.test(words) ? said.slice(0, -1) : said}`;
}

export function applyGoalReadingEdit(persistedGraph: unknown, approved: ApprovedGoalReading): GoalReadingEditResult {
  if (!isRec(persistedGraph) || !Array.isArray(persistedGraph.nodes) || !Array.isArray(persistedGraph.edges)) {
    return { kind: 'refused', reason: 'invalid_graph' };
  }
  const expected = approved.expected_basis;
  const members = approved.members;
  if (members !== undefined && !validGoalReadingMembers(members)) return { kind: 'refused', reason: 'invalid_members' };
  // An answer to the open question needs one; the user's statement of a member answers that question too when one is held.
  const asked = isRec(expected) && typeof expected.open_question === 'string' && expected.open_question.trim() !== '';
  if (!isRec(expected) || (!asked && members === undefined)) return { kind: 'refused', reason: 'no_open_question' };
  if (expected.open_question === CONDITIONS_NOT_KEPT) return { kind: 'refused', reason: 'not_a_reading_question' };
  const matches = persistedGraph.nodes.filter((n): n is Rec => isRec(n) && n.id === approved.goal_id);
  if (matches.length !== 1) return { kind: 'refused', reason: 'goal_not_found' };
  if (matches[0]!.kind !== 'goal') return { kind: 'refused', reason: 'not_a_goal' };
  if (approved.expected_goal !== undefined && !isDeepStrictEqual(goalReadingProjectionOf(persistedGraph, approved.goal_id), approved.expected_goal)) {
    return { kind: 'refused', reason: 'goal_changed' };
  }
  const held = matches[0]!.goal_target_basis;
  const answered = answeredBasisOf(expected, members);
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
      safe_summary: members !== undefined ? 'Recorded from your words how the target is read' : 'Recorded your answer about how the target is read',
      impact: 'low',
      rerun_recommended: true,
    },
  });
  const reading = goalReadingWords(goalReadingProjectionOf(graph, approved.goal_id)) ?? `the target for ‘${label}’ as the model states it`;
  return { kind: 'mutated', mutatedGraph: graph, handlerFacts: [fact as HandlerFact],
    confirmation: goalReadingRecordedWords(reading, approved.answer_words) };
}

/** The freshly computed atomic write, exactly: the writer's own postimage of `before`, nothing else. */
export function goalReadingPostimageIsScoped(before: unknown, after: unknown, approved: ApprovedGoalReading): boolean {
  const written = applyGoalReadingEdit(before, approved);
  return written.kind === 'mutated' && isDeepStrictEqual(written.mutatedGraph, after);
}
