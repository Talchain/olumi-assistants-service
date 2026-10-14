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
 * a unit of the same family that names points exactly when the held unit does, the held comparator exactly, and the figure
 * written about this goal — all read through the ONE goal record (S5). On a match:
 *   · the reading holds an open question (not admission's conditions refusal) → ONE card that answers it
 *     (`confirm_goal_reading`, written by `goal-reading-write.ts` only);
 *   · otherwise → `already_saved`, nothing prepared, with the saved meaning.
 * Anything else is not this target: the caller's refusal stands, carrying the saved meaning so the Agent can compare.
 * Structured fields only, apart from the card's own words and its note (AIE_TEXT_PENDING).
 */
import { createProposal, type StructuredProposal } from '../agent-lane/proposal.js';
import { figureTheUserWroteFor } from '../agent-lane/stated-by-user.js';
import { unitsConflict } from '../agent-lane/unit-conflict.js';
import { CONDITIONS_NOT_KEPT, goalTargetBasisOf } from './goal-target-basis.js';
import { readGoalRecord } from './goal-record.js';
import { goalMeaningOf, goalReadingWords } from './goal-reading-write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export const CONFIRM_GOAL_READING_OP = 'confirm_goal_reading';

/** The goal's saved target meaning, as structured fields (G14): what the Agent compares a restatement with. */
export interface SavedGoalMeaning {
  readonly label: string;
  readonly target_frame: 'change_abs' | 'change_rel';
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

const goalNodeOf = (raw: unknown, goalId: string): Rec | undefined => (isRec(raw) && Array.isArray(raw.nodes)
  ? raw.nodes.find((n): n is Rec => isRec(n) && n.kind === 'goal' && n.id === goalId) : undefined);

/** Through the ONE goal record (S5) and the validated reading; `undefined` for a goal with no change target. */
export function savedGoalMeaningOf(raw: unknown, goalId: string): SavedGoalMeaning | undefined {
  const record = readGoalRecord(raw, goalId);
  const target = record?.target;
  if (record == null || target == null || (target.frame !== 'change_abs' && target.frame !== 'change_rel') || target.raw === undefined) return undefined;
  const basis = goalTargetBasisOf(goalNodeOf(raw, goalId));
  return {
    label: record.label, target_frame: target.frame, target_raw: target.raw, unit: target.unit ?? null, comparator: target.comparator ?? null,
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
/** One unit phrase, compared exactly: case, apostrophe form and spacing aside; "percent" is "%". */
const unitPhrase = (unit: string): string => unit.trim().toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ')
  .replace(/^(?:per ?cent|percent)\b/, '%');

/** The one equality: the requested target IS the goal's held change target (see the module note). */
export function restatesHeldChangeTarget(
  graph: { readonly raw: unknown; readonly nodes: readonly { readonly label?: unknown; readonly kind?: unknown }[] },
  goalId: string,
  requested: { readonly operator: string; readonly value: number; readonly unit: string },
  userText: string | null | undefined,
): boolean {
  const record = readGoalRecord(graph.raw, goalId);
  const target = record?.target;
  // The FULL saved meaning (PL amendment): a validated reading holds the reference, denominator and period the request is
  // compared within; without one the request is never "the same target".
  const basis = goalTargetBasisOf(goalNodeOf(graph.raw, goalId));
  if (record == null || target == null || basis === undefined || target.frame !== 'change_abs' || basis.target_frame !== 'change_abs'
    || target.raw !== requested.value || basis.target_raw !== requested.value) return false;
  const heldUnit = target.unit ?? '';
  if (heldUnit === '' || unitsConflict(requested.unit, heldUnit) !== null) return false;
  // A unit saying more than the bare sign must be the held unit or the reading's own effect unit, exactly: a request naming
  // another denominator ("% of revenue") is another quantity, never this target restated.
  const asked = unitPhrase(requested.unit);
  if (asked !== unitPhrase(heldUnit) && asked !== unitPhrase(basis.effect_unit)) return false;
  // Points are never a % of today, nor a % of today points (ruling 20): the held unit's own words decide.
  if (namesPoints(requested.unit) !== namesPoints(heldUnit)) return false;
  if (target.comparator !== requested.operator) return false;
  // The scope reads the figure in the HELD unit (its phrase was compared exactly above): a long phrase's own words
  // ("today's productivity") would otherwise be passed over as unit words, the goal's label among them.
  return writtenAboutTheGoal(graph, record.label, { value: requested.value, unit: heldUnit }, userText);
}

/**
 * The figure written about THIS goal in these words, under the strict reading (a conjunction ends a figure's phrase; in a
 * message with two figures or more a figure no label word attributes is nobody's): never another quantity's value elsewhere
 * in the same sentence.
 */
function writtenAboutTheGoal(graph: { readonly nodes: readonly { readonly label?: unknown; readonly kind?: unknown }[] }, label: string,
  requested: { readonly value: number; readonly unit: string }, words: string | null | undefined): boolean {
  const others = graph.nodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision')
    .map((n) => (typeof n.label === 'string' ? n.label : '')).filter((l) => l !== '' && l !== label);
  return label !== '' && figureTheUserWroteFor(requested.value, requested.unit, words, { target: [label], others, strict: true });
}

/**
 * Which members of the saved meaning the request was compared on (structured, no prose): the figure, the unit and the
 * comparator only. The reference, denominator, period and additional conditions are never compared here (AIE G.binding:
 * unchecked members belong in not_compared), so the partial-match note says exactly that.
 */
export const COMPARED_MEMBERS = { compared: ['target_frame', 'target_raw', 'unit', 'comparator'],
  not_compared: ['reference', 'denominator', 'period', 'conditions'] } as const;

/** The card's words, the AIE's AMEND byte for byte (`AIE-GOAL-READING-2995-TEXT-RULINGS-20261013.json` card.replacement). */
export const CONFIRM_GOAL_READING_LABEL_TEMPLATE = 'Confirm this reading of your target: {reading}. Question being answered: {question}.';
/**
 * The card. The template's closing full stop is not doubled after a question that already ends a sentence ("…score?" not
 * "…score?."; Codex buddy r3) — AIE_TEXT_PENDING for that one character. Function replacers: a "$" in the words is literal.
 */
export function confirmGoalReadingCard(reading: string, question: string): string {
  const q = question.trim();
  const card = CONFIRM_GOAL_READING_LABEL_TEMPLATE.replace('{reading}', () => reading).replace('{question}', () => q);
  return /[.?!]$/.test(q) ? card.slice(0, -1) : card;
}
/** The Agent's note on the card, the AIE's AMEND byte for byte (same ruling, agent_note.replacement). */
export const CONFIRM_GOAL_READING_NOTE = 'Nothing has changed yet. This card proposes confirming the saved target reading shown on it, as an answer to the '
  + 'stored question. Offer it only when the user\u2019s actual source or bound answer supports that complete reading, including its quantity, unit, '
  + 'comparator, reference, denominator, period and conditions; matching a figure alone is insufficient. Show the full reading and question, never the '
  + 'proposal id. Use authorise_change only when the user\u2019s bound approval for this shown card permits this proposal_id. It confirms the reading only; '
  + 'it does not change the underlying claim\u2019s authorship or give permission to Run.';
/**
 * The AIE's partial-match note, byte for byte (`AIE-CURRENT-SOURCE-AND-CARD-RULINGS-20261014.json` G.partial_match_note), beside
 * `already_saved`: the saved reading as saved, and that only figure, unit and comparator were compared.
 */
export const ALREADY_SAVED_NOTE_TEMPLATE = 'The saved reading is {saved_reading}. Only the figure, unit and comparator were compared with this '
  + 'request and matched. The reference, denominator, period and additional conditions were not compared; this does not confirm that your '
  + 'complete requested reading is saved.';
/** The note, filled; without a sayable reading its first sentence is left out (never a placeholder). */
export function alreadySavedNote(savedReading: string | undefined): string {
  const filled = ALREADY_SAVED_NOTE_TEMPLATE.replace('{saved_reading}', () => savedReading ?? '');
  return savedReading === undefined ? filled.slice(filled.indexOf('Only the figure')) : filled;
}

/**
 * The answer for a requested target that restates the goal's held change target, or `undefined` when it does not (the
 * caller's own path, and its refusal, stand). Nothing is written here: a card is stored for the user's approval.
 */
export function heldChangeTargetAnswer(args: {
  readonly scenario_id: string;
  readonly user_id: string | null;
  readonly user_text: string | null | undefined;
  /** This turn's own words: the user's answer, kept verbatim on the card for the receipt and the ledger. */
  readonly user_turn_text?: string | null;
  readonly graph: { readonly graph_hash: string; readonly raw: unknown; readonly nodes: readonly { readonly label?: unknown; readonly kind?: unknown }[] };
  readonly goal_id: string;
  readonly requested: { readonly operator: string; readonly value: number; readonly unit: string };
  readonly rationale?: unknown;
  readonly proposals: { put(p: StructuredProposal): void };
}): { readonly ok: boolean; readonly mutated: boolean; readonly [k: string]: unknown } | undefined {
  const { goal_id: goalId, graph } = args;
  if (!restatesHeldChangeTarget(graph, goalId, args.requested, args.user_text)) return undefined;
  const saved = savedGoalMeaningOf(graph.raw, goalId)!;
  const goal = goalNodeOf(graph.raw, goalId);
  const basis = goalTargetBasisOf(goal);
  const stored = goal?.goal_target_basis;
  const reading = basis === undefined ? undefined : goalReadingWords(graph.raw, goalId, basis);
  if (basis?.open_question === undefined || basis.open_question === CONDITIONS_NOT_KEPT || !isRec(stored) || reading === undefined) {
    return { ok: true, mutated: false, already_saved: true, saved_goal: saved, compared: [...COMPARED_MEMBERS.compared],
      not_compared: [...COMPARED_MEMBERS.not_compared], ...(reading !== undefined ? { saved_reading: reading } : {}), note: alreadySavedNote(reading) };
  }
  // The user's words are the ANSWER only when THIS turn states the target about this goal; an earlier statement that matched
  // never credits an unrelated current turn (the card, pressed, is still the user's choice of the reading it shows).
  const turn = typeof args.user_turn_text === 'string' ? args.user_turn_text.trim() : '';
  const answered = turn !== '' && writtenAboutTheGoal(graph, saved.label, { value: args.requested.value, unit: saved.unit ?? args.requested.unit }, turn);
  const proposal = createProposal({
    scenario_id: args.scenario_id,
    user_id: args.user_id,
    base_graph_identity_hash: graph.graph_hash,
    operations: [{ op: CONFIRM_GOAL_READING_OP, path: goalId, value: { expected_basis: stored, open_question: basis.open_question,
      expected_goal: goalMeaningOf(graph.raw, goalId), ...(answered ? { answer_words: turn } : {}) } }],
    provenance: { authored_by: 'user_stated', basis: String(args.rationale ?? '') },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: confirmGoalReadingCard(reading, basis.open_question),
  });
  args.proposals.put(proposal);
  return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label, base_revision: graph.graph_hash,
    saved_goal: saved, note: CONFIRM_GOAL_READING_NOTE };
}
