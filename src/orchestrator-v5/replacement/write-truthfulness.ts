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
import type { ReplacementTurnTrace } from './turn-trace.js';

/** The turn's write, as the turn can PROVE it — never as the prose describes it. */
export type WriteTruthfulness =
  | { readonly kind: 'no_write' }
  | { readonly kind: 'committed'; readonly receiptId: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unknown' };

/**
 * Refusal codes that mean the write DEFINITELY did not happen — the request
 * never left, or the writer answered with a failure. Nothing changed.
 */
const DEFINITELY_NOT_WRITTEN = new Set(['checkpoint_refused', 'no_checkpoint', 'write_failed']);

/**
 * Refusal codes that mean a write MAY have landed and we cannot prove it.
 * `no_receipt` belongs here, not above: the writer said done and handed back
 * nothing citable, so the change may well exist.
 */
const MAY_HAVE_WRITTEN = new Set(['write_outcome_unknown', 'no_receipt']);

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
  // A receipt IS the commit proof. Holding one, the reply may say so.
  if (trace.write_committed && trace.receipt_id !== null && trace.receipt_id.trim() !== '') {
    return { kind: 'committed', receiptId: trace.receipt_id };
  }
  if (!trace.write_attempted) return { kind: 'no_write' };
  const codes = new Set<string>(trace.refusals);
  for (const c of MAY_HAVE_WRITTEN) if (codes.has(c)) return { kind: 'unknown' };
  for (const c of DEFINITELY_NOT_WRITTEN) if (codes.has(c)) return { kind: 'refused' };
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
