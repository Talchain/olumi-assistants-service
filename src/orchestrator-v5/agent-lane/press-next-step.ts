/**
 * ⭐ COACH, DON'T REFUSE (Paul 13 Oct 21:1xZ; DL coaching-on-press): a withheld Run press ends in ONE executable next step
 * aimed at its ACTUAL blocker. "If the PoC and the AI can't do what we need it to for any reason, it is either honest about
 * it or, if it can do it, asks the user to provide the information or take the actions needed."
 *
 * Each blocker is typed by its own producer from that producer's facts (never by reading words):
 *   - missing input            → ask for exactly that input, only where the answer unlocks the Run's next stage
 *                                (`targetBlockerOf`, `chanceGoalBlockerOf`, `jointBlockerOf`); a gap that survives the
 *                                answer travels beside the ask (`also_unbuilt`), so an answer is never promised to unlock it;
 *   - missing implementation   → say plainly that Olumi can't calculate it yet, ONLY where no writer, card or input can
 *                                unlock it (PL #94 6135017311); never imply an answer unlocks it;
 *   - an existing card/control → that card or control is the step (`confirm`);
 *   - stale                    → `staleResultLine`'s own words, only while they carry "run it again" (a Run that may not
 *                                run is held by another blocker, which owns the step);
 *   - run again                → the producer's own line already says so (`jointWithheldLine`).
 * A cause the producer cannot type (an input might or might not unlock it) yields NO step: none is invented.
 * A write conflict (409) and a refused permission (403) return before any reply is composed, so no step here can reach them:
 * they are a separate dependency on the error body and the UI, with `retry_safe` kept as it is.
 *
 * Not a composer: the existing consumers place the ONE step (the action bar's priority slot, and composeReplyShape's
 * `ownsNextStep` obligation once the reply block can carry it). Words marked AIE_TEXT_PENDING wait for the AIE.
 */

export type PressBlocker =
  | { readonly kind: 'missing_input'; readonly ask: string; readonly also_unbuilt?: string }
  | { readonly kind: 'missing_implementation'; readonly what: string }
  /** `goal_target`: the goal's own target control (the approved target write holds the stated comparator on the goal). */
  | { readonly kind: 'confirm'; readonly by: 'identity_card' | 'confirm_reading' | 'goal_target' }
  | { readonly kind: 'run_again'; readonly why: 'precision_missing' | 'not_returned' }
  | { readonly kind: 'stale'; readonly say: string };

/** AIE_TEXT_PENDING: the honest limit for missing implementation (drafted 13 Oct, sent to the AIE via the DL). */
export const AIE_TEXT_PENDING_CANNOT_CALCULATE_YET = (what: string): string =>
  `Olumi can't calculate ${what} yet. That is a limit of Olumi, not a gap in your model, so answering a question won't change it.`;

/**
 * The ONE step when several blockers stand: a stale result first (typed only while it can be run again, so it never
 * hides an executable step behind a line with none; nothing else is about the current model), then a
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
 * One step, one owner (DL), bound to the step's own identity (Codex buddy r1 on the coaching diff): only an owner of THIS
 * step suppresses it, never an unrelated offer (a research press does not own a missing starting value).
 *   - `guidedRunFinding`: the scoped guided finding (RT `guidedRunFinding`) is itself the Run's input step with its presses,
 *     so it owns an input or implementation step (which it outranks), never a stale result, a repeat Run or a card;
 *   - `said`: the exact lines the reply already carries (the host asks, a typed card's question, the stale line), so the
 *     same ask or stale line is never said twice;
 *   - `pressed`: the presses already offered that take this step (a card's own press; `run` for the Run control).
 */
export type OwnedPress = Extract<PressBlocker, { kind: 'confirm' }>['by'] | 'run';

export interface NextStepOwners {
  readonly guidedRunFinding: boolean;
  readonly said: readonly string[];
  readonly pressed: readonly OwnedPress[];
}

export function unownedNextStep(step: PressBlocker | null, owners: NextStepOwners): PressBlocker | null {
  if (step === null) return null;
  switch (step.kind) {
    case 'missing_input':
      return owners.guidedRunFinding || owners.said.includes(step.ask) ? null : step;
    case 'missing_implementation':
      return owners.guidedRunFinding ? null : step;
    case 'confirm':
      return owners.pressed.includes(step.by) ? null : step;
    case 'run_again':
      return owners.pressed.includes('run') ? null : step;
    case 'stale':
      return owners.said.includes(step.say) ? null : step;
  }
}
