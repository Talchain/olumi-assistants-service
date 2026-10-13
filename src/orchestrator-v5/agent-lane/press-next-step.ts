/**
 * ⭐ COACH, DON'T REFUSE (Paul 13 Oct 21:1xZ; DL coaching-on-press): a withheld Run press ends in ONE executable next step
 * aimed at its ACTUAL blocker. "If the PoC and the AI can't do what we need it to for any reason, it is either honest about
 * it or, if it can do it, asks the user to provide the information or take the actions needed."
 *
 * Each blocker is typed by its own producer from that producer's facts (never by reading words):
 *   - missing input            → ask for exactly that input (`targetBlockerOf`, `chanceGoalBlockerOf`, `jointBlockerOf`);
 *   - missing implementation   → say plainly that Olumi can't calculate it yet; never imply an answer unlocks it;
 *   - an existing card/press   → that card owns the step (`confirm`);
 *   - stale                    → `staleResultLine`'s own words, whose "run it again" follows the Run control's verdict;
 *   - run again                → the producer's own line already says so (`jointWithheldLine`).
 * A write conflict (409) and a refused permission (403) return before any reply is composed, so no step here can reach them:
 * they are a separate dependency on the error body and the UI, with `retry_safe` kept as it is.
 *
 * Not a composer: the existing consumers place the ONE step (the action bar's priority slot, and composeReplyShape's
 * `ownsNextStep` obligation once the reply block can carry it). Words marked AIE_TEXT_PENDING wait for the AIE.
 */

export type PressBlocker =
  | { readonly kind: 'missing_input'; readonly ask: string; readonly also_unbuilt?: string }
  | { readonly kind: 'missing_implementation'; readonly what: string }
  | { readonly kind: 'confirm'; readonly by: 'identity_card' | 'confirm_reading' }
  | { readonly kind: 'run_again'; readonly why: 'precision_missing' | 'not_returned' }
  | { readonly kind: 'stale'; readonly say: string };

/** AIE_TEXT_PENDING: the honest limit for missing implementation (drafted 13 Oct, sent to the AIE via the DL). */
export const AIE_TEXT_PENDING_CANNOT_CALCULATE_YET = (what: string): string =>
  `Olumi can't calculate ${what} yet. That is a limit of Olumi, not a gap in your model, so answering a question won't change it.`;

/** AIE_TEXT_PENDING: the joint target's own starting value, which only the user can give (`olumi_base`). */
export const AIE_TEXT_PENDING_STARTING_VALUE_ASK = 'What is today’s starting value for the target that has none from you yet?';

/** AIE_TEXT_PENDING: with no option there is nothing to compare (`no_option`). */
export const AIE_TEXT_PENDING_OPTIONS_ASK = 'Which options are you weighing?';

/**
 * The ONE step when several blockers stand: a stale result first (nothing else is about the current model), then a
 * Run that must simply be repeated, then a card that already owns the step, then a missing input, then a missing
 * implementation. Stable for equal kinds: the first producer's blocker wins.
 */
const PRECEDENCE: readonly PressBlocker['kind'][] = ['stale', 'run_again', 'confirm', 'missing_input', 'missing_implementation'];

export function oneNextStep(blockers: readonly (PressBlocker | null | undefined)[]): PressBlocker | null {
  const present = blockers.filter((b): b is PressBlocker => b != null);
  for (const kind of PRECEDENCE) {
    const first = present.find((b) => b.kind === kind);
    if (first !== undefined) return first;
  }
  return null;
}

/**
 * One step, one owner (DL): where the reply already has an owner of its next step, the typed blocker yields and adds nothing.
 * The owners are the route's own facts: the scoped guided finding with its presses (`guidedRunFinding`), a typed card's own
 * question (`typedControlQuestions`), or a specific press already offered for this blocked Run (`offeredSpecific`).
 */
export interface NextStepOwners {
  readonly guidedRunFinding: boolean;
  readonly typedControlQuestion: boolean;
  readonly specificOffer: boolean;
}

export function unownedNextStep(step: PressBlocker | null, owners: NextStepOwners): PressBlocker | null {
  if (step === null) return null;
  return owners.guidedRunFinding || owners.typedControlQuestion || owners.specificOffer ? null : step;
}
