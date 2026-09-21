/**
 * ⭐⭐ WHAT THE REPLY IS ALLOWED TO SAY ABOUT THE WRITE — enforced, not requested.
 *
 * THE DEFECT THIS CLOSES. Every failure arm in `run-replacement-turn.ts`
 * returns a TOOL RESULT whose content instructs the model ("Tell the user the
 * save did not go through"). The model then writes prose and that prose is
 * published verbatim. An instruction is not an enforcement: on a refused,
 * unknown or receipt-less write the layer could still tell a user
 * "That's saved." — measured and pinned in
 * `__tests__/unbacked-change-claim.test.ts` as an observe-only floor.
 *
 * ⛔ WHY THIS IS NOT BUILT ON THE CLAIM DETECTORS. `detectUnbackedChangeClaim`
 * is pattern-based and its own docblock says a zero means "no pattern matched",
 * never "the reply was honest" — the known-missed set includes plain VALUE
 * claims ("The budget is now set to £50k."), which is exactly what this layer
 * produces. A guard built on those patterns would inherit the blind spot and
 * would be a telemetry floor wearing a guarantee's clothes. This reads the
 * STRUCTURED OUTCOME instead: what the writer returned, not what the prose
 * looks like. It cannot be defeated by phrasing because it never reads phrasing.
 *
 * ⚠ `unknown` IS NOT `refused`, AND COLLAPSING THEM IS ITS OWN LIE. "It did not
 * save" and "I cannot tell whether it saved" are different claims, and the
 * second is the honest one when a write was dispatched and the answer was lost.
 * Telling a user nothing changed, when a change may well have landed, sends
 * them to re-enter work that is already in the model.
 */
import type { ReplacementRefusalCode, ReplacementTurnTrace } from './turn-trace.js';

/** The turn's write, as the turn can PROVE it — never as the prose describes it. */
export type WriteTruthfulness =
  | { readonly kind: 'no_write' }
  | { readonly kind: 'committed'; readonly receiptId: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unknown' }
  /**
   * At least one write COMMITTED and at least one other did not — the turn
   * holds a real receipt AND a refusal. `residual` describes the OTHER writes,
   * never the committed one.
   */
  | { readonly kind: 'mixed'; readonly receiptId: string; readonly residual: 'refused' | 'unknown' };

/**
 * ⭐⭐ EVERY REFUSAL CODE IS CLASSIFIED, AND THE COMPILER ENFORCES THAT.
 *
 * This was two `Set`s of string literals and FOUR OF THE NINE codes were in
 * neither — `proposal_not_waiting`, `quote_not_from_message`,
 * `acceptance_names_other_number` and `second_write_this_turn` all fell
 * through to the default. Because `Record<ReplacementRefusalCode, …>` requires
 * every union member, a new refusal code now fails the BUILD until someone
 * decides what it means for the user's data — which is the decision that was
 * silently skipped four times.
 *
 * `not_written` — nothing reached the store, so the model is unchanged.
 * `may_have_written` — it was dispatched and the answer was lost; asserting
 * either direction would be a fabrication.
 */
const REFUSAL_CLASS: Record<ReplacementRefusalCode, 'not_written' | 'may_have_written'> = {
  // ── Pre-dispatch: refused before the turn's write was ever reserved, so
  //    `write_attempted` is still false when the turn ends. Nothing left.
  proposal_not_waiting: 'not_written',
  quote_not_from_message: 'not_written',
  acceptance_names_other_number: 'not_written',
  second_write_this_turn: 'not_written',
  // ── Reserved, then stopped at the durability barrier. Nothing left either.
  no_checkpoint: 'not_written',
  checkpoint_refused: 'not_written',
  // ── Dispatched. Only these can leave the model in a state we cannot name.
  write_failed: 'not_written',
  write_outcome_unknown: 'may_have_written',
  // `no_receipt` belongs here, not above: the writer said done and handed back
  // nothing citable, so the change may well exist.
  no_receipt: 'may_have_written',
};

/**
 * An unrecognised code is neither — it is a code from a future version of the
 * writer, and it lands on the weaker reading. See the default note below.
 */
function classOf(code: string): 'not_written' | 'may_have_written' | 'unrecognised' {
  return (REFUSAL_CLASS as Record<string, 'not_written' | 'may_have_written' | undefined>)[code] ?? 'unrecognised';
}

/**
 * ⚠ THE DEFAULT IS `unknown`, DELIBERATELY. A write was attempted, no receipt
 * came back, and no code we recognise fired — that is precisely the state in
 * which asserting either direction is a fabrication. Any new refusal code
 * therefore lands here until someone classifies it, which fails toward "I
 * cannot tell you" rather than toward a confident sentence.
 */
export function writeTruthfulnessOf(
  trace: Pick<ReplacementTurnTrace, 'write_attempted' | 'write_committed' | 'receipt_id' | 'refusals'>,
): WriteTruthfulness {
  // ⛔⛔ A RECEIPT DOES NOT SHORT-CIRCUIT THIS. The committed test used to run
  // FIRST and return, so `refusals` was never read on a turn holding a
  // receipt: a turn that saved change A while change B was refused reported
  // `committed`, the prose passed through untouched, and "Done — I have made
  // those changes." was published about BOTH. That is the worst shape in this
  // module — a TRUE receipt used as evidence for a FALSE claim, with a citable
  // id attached to it. The codes are therefore classified BEFORE any verdict.
  const classes = trace.refusals.map((c) => classOf(c));
  // An unrecognised code reads as `may_have_written`: it is the weaker claim,
  // and a code this build has never seen cannot be asserted to have changed
  // nothing. Same direction as the default below.
  const mayHaveWritten = classes.some((c) => c === 'may_have_written' || c === 'unrecognised');
  const definitelyNotWritten = classes.some((c) => c === 'not_written');
  const refusedSomething = classes.length > 0;
  const receiptId =
    trace.write_committed && trace.receipt_id !== null && trace.receipt_id.trim() !== ''
      ? trace.receipt_id
      : null;

  if (receiptId !== null) {
    // ⚠ THE WEAKER RESIDUAL WINS. With both a definite refusal and an unknown
    // in the same turn, the reply may NOT say the others failed — it does not
    // know that. Same reason the module's default is `unknown`: "it did not
    // save" and "I cannot tell whether it saved" are different claims.
    if (mayHaveWritten) return { kind: 'mixed', receiptId, residual: 'unknown' };
    if (definitelyNotWritten) return { kind: 'mixed', receiptId, residual: 'refused' };
    // An UNRECOGNISED code beside a receipt is still a mixed turn. Falling back
    // to `committed` here would re-open the exact hole above for every refusal
    // code added after today, which is the failure mode this module's default
    // exists to prevent.
    if (refusedSomething) return { kind: 'mixed', receiptId, residual: 'unknown' };
    return { kind: 'committed', receiptId };
  }

  // ⛔⛔ A PRE-DISPATCH REFUSAL IS NOT `no_write`, AND TREATING IT AS ONE LEFT
  // THE REPLY ENTIRELY UNCONSTRAINED. `writeAttempted()` is reserved at the
  // point of COMMITMENT, so every guard refusing earlier ends the turn with
  // `write_attempted === false`. Those turns returned `no_write`, whose prose
  // is null, so "Done — I have made that change." published verbatim on a turn
  // where the user's "yes" never reached the writer.
  //
  // ⚠ The discriminator is whether the turn REFUSED something, not whether it
  // dispatched. An ordinary conversational turn refuses nothing and must stay
  // untouched — constraining it would put a save-failure sentence on a turn
  // where the user never asked for a change.
  if (!trace.write_attempted && !refusedSomething) return { kind: 'no_write' };
  if (mayHaveWritten) return { kind: 'unknown' };
  if (definitelyNotWritten) return { kind: 'refused' };
  return { kind: 'unknown' };
}

/**
 * The sentence a user reads when the turn cannot stand behind a save.
 *
 * ⚠ REPLACES rather than edits. Editing means finding the claim, which means
 * pattern matching, which is the blind spot this module exists to avoid. On a
 * turn whose write did not demonstrably succeed, the outcome IS the answer.
 *
 * ⚠ The wording is deliberately plain and carries no writer-internal reason —
 * a failure string from the store is not user copy and can leak identifiers.
 * Product voice is Paul's call; the GUARANTEE is that these bytes, and not the
 * model's, are what ship.
 */
export function proseForWriteOutcome(outcome: WriteTruthfulness): string | null {
  switch (outcome.kind) {
    case 'no_write':
    case 'committed':
      return null;
    case 'refused':
      return (
        'I have not made that change — the save did not go through, so nothing in your model ' +
        'has changed. Ask me again and I will retry it.'
      );
    case 'unknown':
      return (
        'I sent that change and did not get confirmation back, so I cannot tell you whether it ' +
        'saved. I have not recorded it as made — please reload before you rely on it.'
      );
    case 'mixed':
      // Names BOTH halves. Reporting only the failure would be as false as
      // reporting only the success: the user has a part-changed model and
      // needs to know that before deciding what to redo.
      return outcome.residual === 'refused'
        ? 'I saved part of that, but not all of it — one change went through and another did not, ' +
            'so your model has only part of what you asked for. Ask me again and I will retry the rest.'
        : 'I saved part of that. I sent the rest and did not get confirmation back, so I cannot tell ' +
            'you whether it saved — please reload before you rely on it.';
  }
}

/**
 * The enforcement point. Returns the bytes the user is permitted to read.
 * `null` from {@link proseForWriteOutcome} means the turn can stand behind
 * whatever it said, so the model's prose passes through untouched.
 */
export function constrainProseToWriteOutcome(
  assistantText: string,
  outcome: WriteTruthfulness,
): string {
  return proseForWriteOutcome(outcome) ?? assistantText;
}
