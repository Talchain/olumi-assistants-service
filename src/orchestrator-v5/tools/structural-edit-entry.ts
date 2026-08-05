/**
 * ROADMAP 2.474 (CEE leg) — ENTRY LOGIC for `propose_structural_edit`.
 *
 * "Rulebook first; if the rulebook does not CLAIM the utterance and the turn is
 * edit-shaped, the tool engages." This is the explicit second path that kills
 * the "four turns and nothing applies" dead-end — the one the 2.380 diagnosis
 * measured, where a user rephrases an edit three times and the deterministic
 * composer returns zero operations every time.
 *
 * ── AMENDMENT A9: WHAT COUNTS AS A "CLAIM" ─────────────────────────────────
 * A claim is the rulebook producing OPERATIONS — an op batch that goes on to
 * the gate, where it is applied or held. A regex match that ends in refusal,
 * in zero operations, or in a parameter failure is NOT a claim: the SAME turn
 * falls through to the tool. That is the load-bearing detail. A second path on
 * the NEXT turn is not a second path at all — it is the dead-end with an extra
 * step, because the user has to notice the failure and rephrase first.
 *
 * ── WHY THE PREDICATE IS SEPARATE FROM THE DISPATCHER ──────────────────────
 * The dispatcher is 3,000 lines with a commit region; this predicate is the
 * decision, and it is the thing that must be pinned by tests. Keeping it here,
 * pure, means the entry rule can be proved without standing up a turn.
 *
 * ── EDIT-SHAPED: DERIVED, NOT RE-STATED (trap 12) ──────────────────────────
 * "Edit-shaped" reuses the product's OWN regexes — the same two constants
 * route-v2 gates dispatch on. A second copy of that judgement here would drift
 * from the rulebook's, and the two would disagree about which turns are edits.
 * Note the direction the negative regex matters in: it names META-questions
 * ("explain this", "compare options"). Those are NOT edit-shaped, so the tool
 * must not engage on them either — a second path that mutates the graph on a
 * meta-question is worse than the dead-end it replaces.
 */

import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../orchestrator/routing/edit-graph-intent-regex.js';
import { detectStructuralRestructureIntent } from '../routing/structural-restructure-intent.js';

/** The rulebook outcome the entry decision reads. */
export interface RulebookOutcome {
  /** True when the deterministic composer refused the edit outright. */
  readonly wasRejected: boolean;
  /** The canonical operations it produced (absent / empty = produced none). */
  readonly operations?: readonly unknown[] | undefined;
}

/**
 * A9 — did the rulebook CLAIM this utterance?
 *
 * TRUE only when it produced at least one operation and did not refuse. Those
 * operations go to the gate, which applies or holds them: either way the
 * utterance is claimed and the tool must stay out of the turn (one entry seam
 * per turn — two composers racing for the same commit is the parity defect in
 * a different costume).
 *
 * FALSE for the three shapes the 2.380 dead-end is made of: a refusal, an
 * empty batch, and an absent batch. Note that `wasRejected` alone is not the
 * test — the measured dead-end returns `wasRejected: false` WITH zero
 * operations, so a predicate keyed on rejection would read "claimed" on the
 * exact turns this path exists to rescue.
 */
export function rulebookClaimedTurn(outcome: RulebookOutcome): boolean {
  if (outcome.wasRejected) return false;
  return (outcome.operations?.length ?? 0) > 0;
}

/**
 * Is this utterance edit-shaped? DERIVED from the rulebook's own two detectors,
 * combined exactly as route-v2 combines them for `editIntentDetected`: an edit
 * verb (vetoed by the meta-question regex), OR a structural-restructure intent.
 *
 * ⚠ CORRECTED PREMISE, measured at this tip. The design brief's headline
 * scenario — "give each option its own driver" — carries NO verb from
 * `EDIT_GRAPH_POSITIVE_REGEX` (no add/remove/change/update/set/…). Read as a
 * regex-only judgement, the tool's own entry gate would have refused the very
 * sentence it exists to serve. The rulebook already knew that, which is why
 * `detectStructuralRestructureIntent` exists as a SEPARATE edit-lane candidate;
 * deriving from both is what keeps the two judgements the same judgement rather
 * than two that agree by coincidence until one is edited.
 *
 * Note the asymmetry, which is the rulebook's and not an oversight here: the
 * negative regex vetoes the VERB branch only. The restructure detector carries
 * its own interrogative guard (a leading question word or a trailing question
 * mark is NO_MATCH), so a meta-question cannot enter through it either.
 */
export function isEditShapedUtterance(message: string): boolean {
  if (typeof message !== 'string' || message.trim().length === 0) return false;
  if (detectStructuralRestructureIntent(message).matched) return true;
  if (EDIT_GRAPH_NEGATIVE_REGEX.test(message)) return false;
  return EDIT_GRAPH_POSITIVE_REGEX.test(message);
}

export interface StructuralEditEntryInput {
  /** The user's raw message for this turn. */
  readonly message: string;
  /** The rulebook's result, read through {@link rulebookClaimedTurn}. */
  readonly rulebook: RulebookOutcome;
  /**
   * True when a grounding table could be built from the STRICT persisted graph
   * (A5a). False when it could not — and then the tool does NOT engage: an
   * honest "I can't read your model" beats a tool call grounded in nothing.
   */
  readonly groundingAvailable: boolean;
  /**
   * Guard against re-entry: true once the tool has already composed on this
   * turn. Reject-don't-repair means exactly one tool composition per turn —
   * never a loop that keeps re-asking a model that just produced an ungrounded
   * batch.
   */
  readonly alreadyEngaged?: boolean;
}

export type StructuralEditEntryDecision =
  | { readonly engage: true }
  | {
      readonly engage: false;
      readonly reason:
        | 'rulebook_claimed'
        | 'not_edit_shaped'
        | 'no_grounding'
        | 'already_engaged';
    };

/**
 * The entry decision. Order is deliberate and is itself the contract:
 * re-entry, then the rulebook's claim, then shape, then grounding. A claimed
 * turn is never re-examined for shape (the rulebook already owns it), and an
 * unreadable model never reaches the model at all.
 */
export function decideStructuralEditEntry(
  input: StructuralEditEntryInput,
): StructuralEditEntryDecision {
  if (input.alreadyEngaged === true) {
    return { engage: false, reason: 'already_engaged' };
  }
  if (rulebookClaimedTurn(input.rulebook)) {
    return { engage: false, reason: 'rulebook_claimed' };
  }
  if (!isEditShapedUtterance(input.message)) {
    return { engage: false, reason: 'not_edit_shaped' };
  }
  if (!input.groundingAvailable) {
    return { engage: false, reason: 'no_grounding' };
  }
  return { engage: true };
}
