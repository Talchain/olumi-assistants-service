/**
 * ⭐ G14 + G — A CHANGE TARGET THE USER RESTATES OR CLARIFIES IS MET WITH THE GOAL AS SAVED (bG brief, "relative to today").
 *
 * `propose_goal_target` writes LEVEL targets and refuses a goal stated as a change (`goal_is_a_change`). Served 13 Oct 07:44Z:
 * the saved hiring goal already read "at least 10% above today's productivity at month three"; the user said "I mean 10%
 * relative to today's productivity, not percentage points."; the refusal gave the Agent no way to see the saved meaning
 * matched, and it told the user the update was refused, then that the target "still hasn't been corrected" — false. Served
 * 13:18Z: the same reading held its open question ("relative, or percentage points?"), and the answer had no route at all.
 *
 * The one comparison of a requested target with the goal's HELD change target: the same frame (`change_abs`), the same figure,
 * a unit of the same family that is not points for a change measured as a % of today (or is points for a % level), the held
 * comparator exactly, and the figure written about this goal. On a match:
 *   · the reading holds an open question (not admission's conditions refusal) → ONE card that answers it
 *     (`confirm_goal_reading`, written by `goal-reading-write.ts` only);
 *   · otherwise → `already_saved`, nothing prepared, with the saved meaning.
 * Anything else is not this target: the caller's refusal stands, carrying the saved meaning so the Agent can compare.
 * Structured fields only, apart from the card's own words and its note (AIE_TEXT_PENDING).
 */
import { createProposal, type StructuredProposal } from '../agent-lane/proposal.js';
import { figureTheUserWroteFor } from '../agent-lane/stated-by-user.js';
import { unitPhraseFamily, unitsConflict } from '../agent-lane/unit-conflict.js';
import { readHeldGoalComparator } from './goal-direction.js';
import { CONDITIONS_NOT_KEPT, goalTargetBasisOf } from './goal-target-basis.js';
import { goalReadingWords } from './goal-reading-write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export const CONFIRM_GOAL_READING_OP = 'confirm_goal_reading';

/** The goal's saved target meaning, as structured fields (G14): what the Agent compares a restatement with. */
export interface SavedGoalMeaning {
  readonly label: string;
  readonly quantity_frame: 'level' | 'change';
  readonly target_frame: 'level' | 'change_abs' | 'change_rel';
  readonly target_raw: number;
  readonly unit: string | null;
  readonly comparator: string | null;
  readonly reference?: 'today' | 'launch';
  readonly denominator?: string;
  readonly effect_unit?: string;
  readonly period_months?: number;
  readonly period_kind?: 'at_end' | 'over_period';
  readonly also_required?: readonly string[];
  readonly open_question?: string;
}

const heldComparatorOf = (raw: unknown, goal: Rec): string | null => {
  const held = readHeldGoalComparator(raw, goal.id) ?? goal.goal_direction;
  return typeof held === 'string' ? held : null;
};

/** `undefined` for a goal with no change target (a level is the caller's own path). */
export function savedGoalMeaningOf(raw: unknown, goal: Rec): SavedGoalMeaning | undefined {
  const frame = goal.goal_threshold_frame;
  const value = goal.goal_threshold_raw;
  if ((frame !== 'change_abs' && frame !== 'change_rel') || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const basis = goalTargetBasisOf(goal);
  return {
    label: typeof goal.label === 'string' ? goal.label : String(goal.id),
    quantity_frame: goal.quantity_frame === 'change' ? 'change' : 'level',
    target_frame: frame,
    target_raw: value,
    unit: typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit : null,
    comparator: heldComparatorOf(raw, goal),
    ...(basis === undefined ? {} : {
      reference: basis.reference,
      ...(basis.denominator !== undefined ? { denominator: basis.denominator } : {}),
      effect_unit: basis.effect_unit, period_months: basis.period_months, period_kind: basis.period_kind,
      ...(basis.also_required !== undefined ? { also_required: basis.also_required } : {}),
      ...(basis.open_question !== undefined ? { open_question: basis.open_question } : {}),
    }),
  };
}

const namesPoints = (unit: string): boolean => /\bpoints?\b|\bpp\b/i.test(unit);

/** The one equality: the requested target IS the goal's held change target (see the module note). */
export function restatesHeldChangeTarget(
  graph: { readonly raw: unknown; readonly nodes: readonly { readonly label?: unknown; readonly kind?: unknown }[] },
  goal: Rec,
  requested: { readonly operator: string; readonly value: number; readonly unit: string },
  userText: string | null | undefined,
): boolean {
  if (goal.goal_threshold_frame !== 'change_abs' || goal.goal_threshold_raw !== requested.value) return false;
  const heldUnit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit : '';
  if (heldUnit === '' || unitsConflict(requested.unit, heldUnit) !== null) return false;
  // A % change of a quantity measured AS a change is a % of today; of a percentage LEVEL it moves in points (ruling 20).
  const heldInPoints = namesPoints(heldUnit) || (goal.quantity_frame !== 'change' && unitPhraseFamily(heldUnit) === 'percent');
  if (namesPoints(requested.unit) !== heldInPoints) return false;
  if (heldComparatorOf(graph.raw, goal) !== requested.operator) return false;
  const label = typeof goal.label === 'string' ? goal.label : '';
  const others = graph.nodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision')
    .map((n) => (typeof n.label === 'string' ? n.label : '')).filter((l) => l !== '' && l !== label);
  return label !== '' && figureTheUserWroteFor(requested.value, requested.unit, userText, { target: [label], others });
}

/** AIE_TEXT_PENDING: the card's words, built from the stored question and the reading it answers with. */
export const CONFIRM_GOAL_READING_LABEL_TEMPLATE = 'Read your target as {reading}. This answers: {question}';
/** AIE_TEXT_PENDING: the Agent's note on the card. */
export const CONFIRM_GOAL_READING_NOTE = 'Nothing has changed yet. This card answers the question the saved goal holds about how its target is read, '
  + 'with the reading shown on it. Offer it only when the user has said that is the reading they mean; show its words, never the id, '
  + 'and call authorise_change with this proposal_id once they agree.';

/**
 * The answer for a requested target that restates the goal's held change target, or `undefined` when it does not (the
 * caller's own path, and its refusal, stand). Nothing is written here: a card is stored for the user's approval.
 */
export function heldChangeTargetAnswer(args: {
  readonly scenario_id: string;
  readonly user_id: string | null;
  readonly user_text: string | null | undefined;
  readonly graph: { readonly graph_hash: string; readonly raw: unknown; readonly nodes: readonly { readonly label?: unknown; readonly kind?: unknown }[] };
  readonly goal: Rec;
  readonly requested: { readonly operator: string; readonly value: number; readonly unit: string };
  readonly rationale?: unknown;
  readonly proposals: { put(p: StructuredProposal): void };
}): { readonly ok: boolean; readonly mutated: boolean; readonly [k: string]: unknown } | undefined {
  const { goal, graph } = args;
  if (!restatesHeldChangeTarget(graph, goal, args.requested, args.user_text)) return undefined;
  const saved = savedGoalMeaningOf(graph.raw, goal)!;
  const basis = goalTargetBasisOf(goal);
  const stored = goal.goal_target_basis;
  const reading = basis === undefined ? undefined : goalReadingWords(graph.raw, goal, basis);
  if (basis?.open_question === undefined || basis.open_question === CONDITIONS_NOT_KEPT
    || !isRec(stored) || reading === undefined) {
    return { ok: true, mutated: false, already_saved: true, saved_goal: saved };
  }
  const proposal = createProposal({
    scenario_id: args.scenario_id,
    user_id: args.user_id,
    base_graph_identity_hash: graph.graph_hash,
    operations: [{ op: CONFIRM_GOAL_READING_OP, path: String(goal.id), value: { expected_basis: stored, open_question: basis.open_question } }],
    provenance: { authored_by: 'user_stated', basis: String(args.rationale ?? '') },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: CONFIRM_GOAL_READING_LABEL_TEMPLATE.replace('{reading}', reading).replace('{question}', basis.open_question),
  });
  args.proposals.put(proposal);
  return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label, base_revision: graph.graph_hash,
    saved_goal: saved, note: CONFIRM_GOAL_READING_NOTE };
}
