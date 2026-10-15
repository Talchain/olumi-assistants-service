/**
 * ⭐ CONFIRM ON THE CARD, NOT REFUSE (DL 15 Oct 22:37Z; recovery PLAN-CONFIRM-NOT-REFUSE-20261015.md step 2). A meaning check
 * doubts Olumi's READING of what the user meant: a target dropped or replaced, a role, which goal, a sign, gross or net. It
 * no longer refuses. The proposal is made, and its card OPENS with the consequential change in plain words, so the user
 * confirms it with the press or says what they meant instead. Olumi proposes, the user authors: nothing is saved before that
 * press, and Olumi's reading stays Olumi's.
 *
 * Each gate keeps its own detection; only its outcome changes, from a refusal to a flag pushed here. HARD guards are never
 * flags: approval before any save, compare-and-set and readback, numbers only from the engine, origin labels, science scope,
 * structural validity, and the user's typed words never being chip text.
 *
 * Each later conversion adds ONE kind to `MeaningFlag` and its words to `FLAG_WORDS`, and pushes it at its gate.
 * Dependency-free on purpose: any gate may import it without adding an import edge to the lane.
 */
export type MeaningFlag =
  /**
   * A correction's revised draft does not keep the governing goal's target as saved: it drops it, or holds a different
   * figure. `from` and `to` are the card's own words for the saved and the revised goal target.
   */
  | { readonly kind: 'goal_target_change'; readonly from: string; readonly to: string };

/** The card's words per kind. ⚠ AIE wording pending (PLAN step 3); one sentence pair per kind, reused by every gate. */
const FLAG_WORDS: { readonly [K in MeaningFlag['kind']]: (flag: Extract<MeaningFlag, { kind: K }>) => string } = {
  goal_target_change: (flag) => `Check this change first: the goal’s target would change from ${flag.from} to ${flag.to}. `
    + 'Approve only if that is what you meant; otherwise say what the target should be.',
};

/** The card's words for one flag. */
export function meaningFlagWords(flag: MeaningFlag): string {
  return (FLAG_WORDS[flag.kind] as (f: MeaningFlag) => string)(flag);
}

/** The card with its flags first, each said once, before anything else on it. No flags → the card unchanged. */
export function cardWithMeaningFlags(card: string, flags: readonly MeaningFlag[]): string {
  const words = [...new Set(flags.map(meaningFlagWords))];
  return words.length === 0 ? card : `${words.join(' ')} ${card}`;
}

/** Appended to the offer's note for this turn's AI when its card carries a flag. ⚠ AIE sign-off pending (prompt text). */
export const MEANING_FLAG_NOTE = ' The card opens with a change Olumi could not confirm the user meant. Say that change first, in '
  + 'plain words, and ask the user to approve the card only if it is what they meant, or to say what it should be instead. '
  + 'Never say the earlier value was kept.';
