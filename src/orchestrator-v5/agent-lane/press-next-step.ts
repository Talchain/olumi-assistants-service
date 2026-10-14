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
 * Not a composer: the ONE step reaches the AI as CURRENT MODEL STATE `next_step_blocker` (`next-step-blocker.ts`, BYPASS1),
 * and the AIE's Q4 rule tells the AI to end its reply with it, in its own words.
 */

export type PressBlocker =
  /**
   * Ranked first, in this order: `objective_provisional`, the goal is Olumi's own provisional objective, so its purpose is
   * asked before any target (DL ruling on C1's check 3005); `goal_target_missing`, the user's goal has no target, so no other
   * answer can unlock a chance.
   */
  | { readonly kind: 'missing_input'; readonly ask: string; readonly also_unbuilt?: string; readonly cause?: 'objective_provisional' | 'goal_target_missing';
      /** The input can be proposed for the user to approve, by this tool (AIE Q4: "offer that actual step instead"). */
      readonly proposable_by?: { readonly tool: 'propose_assumptions'; readonly node_id: string; readonly field: 'occurrence_range'; readonly window_months: number }
        | { readonly tool: 'propose_assumptions'; readonly node_id: string; readonly field: 'starting_value' } }
  | { readonly kind: 'missing_implementation'; readonly what: string }
  | { readonly kind: 'confirm'; readonly by: 'identity_card' | 'confirm_reading' }
  | { readonly kind: 'run_again'; readonly why: 'precision_missing' | 'not_returned' }
  | { readonly kind: 'stale'; readonly say: string };

/**
 * The ONE step when several blockers stand: a stale result first (typed only while it can be run again, so it never
 * hides an executable step behind a line with none; nothing else is about the current model), then a
 * Run that must simply be repeated, then a card that already owns the step, then a missing input, then a missing
 * implementation. Stable for equal kinds: the first producer's blocker wins.
 */
const PRECEDENCE: readonly PressBlocker['kind'][] = ['stale', 'run_again', 'confirm', 'missing_input', 'missing_implementation'];

export function oneNextStep(blockers: readonly (PressBlocker | null | undefined)[]): PressBlocker | null {
  const present = blockers.filter((b): b is PressBlocker => b != null);
  // Paul's funding test (DL 00:21Z 14 Oct): a goal with no target outranks every other step, a stale result included; with
  // no target, neither a rerun nor a sizing answer can give a chance. T1H's host cells and chips use the same order (C1).
  // An objective that is only Olumi's provisional reading comes before its target: the purpose decides what a target is of.
  for (const cause of ['objective_provisional', 'goal_target_missing'] as const) {
    const root = present.find((b) => b.kind === 'missing_input' && b.cause === cause);
    if (root !== undefined) return root;
  }
  for (const kind of PRECEDENCE) {
    const first = present.find((b) => b.kind === kind);
    if (first !== undefined) return first;
  }
  return null;
}
