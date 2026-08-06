/**
 * ROADMAP 2.655 — WHAT THE USER IS TOLD WHEN THE STRUCTURAL-EDIT TOOL DECLINES.
 *
 * ── THE WITNESSED DEFECT (walk 2.634, 2026-08-07) ──────────────────────────
 * The canonical compound edit — three options, each linked to the goal, each
 * with its own risk factor — received the pre-split dead end verbatim:
 *
 *   "I tried to make that change, but it would require 6 node operations and 6
 *    edge operations - more than is safe in a single edit (limit: 4 node ops,
 *    8 edge ops). Consider breaking this into smaller steps ..."
 *
 * ── THE MECHANISM, WHICH IS THE WHOLE POINT OF THIS MODULE ────────────────
 * #829's splitter is real and it works. But it runs inside a SECOND
 * composition: a fresh model call plus a grounding validator. When that second
 * composition declined, `tryStructuralEditTool` returned `null` — and on this
 * path `null` means "the rulebook's own answer stands". The rulebook's own
 * answer, after a budget refusal, IS the dead end. So a feature built to
 * abolish that sentence silently reinstated it on every decline but one.
 *
 * Exactly one class (`BATCH_CAP_EXCEEDED`) had replacement copy. Six-plus
 * others — mode not live, model unreadable, base divergence, call failed, no
 * tool call, each grounding-rejection code — did not. This module gives every
 * class an answer, and the dispatcher's type signature makes it impossible to
 * add a decline without choosing one.
 *
 * ── WHY THE CLASSES ARE COARSER THAN THE EXIT POINTS ──────────────────────
 * There are more exits than there are honest things to say. A user does not
 * benefit from distinguishing "the persisted read threw" from "the persisted
 * read returned something unparseable" — in both cases the true sentence is
 * "I could not read your model". The classes below are the DISTINCT SENTENCES,
 * and the dispatcher maps exits onto them. Three of them are genuinely
 * different and must not be collapsed further:
 *
 *   · I could not READ your model        (nothing was attempted)
 *   · I could not WORK OUT the change    (something was attempted, and failed)
 *   · the change is TOO LARGE to split   (it was worked out, and it is too big)
 *
 * Collapsing those would put the user's next action wrong: the first is worth
 * retrying unchanged, the second is worth rephrasing, the third never is.
 *
 * ── ⚠ WHY THIS FILE IS NOT CALLED `…-decline-copy.ts` ─────────────────────
 * It was, and CI refused it. The required job's shadow-copy guard globs
 * `*-copy.ts` to catch files like `foo-copy.ts` left behind by a duplication,
 * and a module whose subject IS user-facing copy is indistinguishable from one
 * under that glob. The guard's own comment says it uses "delimited patterns to
 * avoid false positives (e.g. `deepcopy.ts` is legitimate)" — but a hyphen is
 * not a delimiter in a hyphenated filename, so the false-positive class it
 * meant to exclude is still open. Renaming here was the cheap fix; the guard
 * is worth narrowing separately, and this note exists so the next person who
 * reaches for the obvious name knows why it is not taken.
 *
 * ── COPY CONSTRAINTS (inherited from the sibling disclosure module) ───────
 * British English; no em dashes; no ids, op tokens, counts or internal caps; no
 * success claim (`SUCCESS_CLAIM_PATTERNS`); no denial of change
 * (`FORBIDDEN_USER_FACING_PHRASES`). Every sentence names what happened AND a
 * first step the user can actually take — the walk's complaint was not only the
 * leaked numbers but that the only "next step" offered was to go and do the
 * decomposition themselves.
 */

import {
  STRUCTURAL_EDIT_TOO_LARGE_TEXT,
  STRUCTURAL_EDIT_TOO_LARGE_ACTIONS,
} from './structural-edit-split-disclosure.js';

/**
 * The distinct answers a declined structural edit can honestly give.
 *
 * ⚠ EXHAUSTIVE BY CONSTRUCTION. {@link STRUCTURAL_EDIT_DECLINE_COPY} is a
 * `Record` over this union, so adding a member without copy fails the build
 * rather than falling through to silence.
 */
export type StructuralEditDeclineClass =
  /** The batch was composed and no partition can rescue it. */
  | 'too_large_to_split'
  /** The persisted model could not be read, so nothing was ever attempted. */
  | 'model_unreadable'
  /** The composition could not run or did not come back. */
  | 'compose_unavailable'
  /** The model could not express the request against the graph as it stands. */
  | 'not_expressible'
  /** A batch came back and did not hold together against the persisted graph. */
  | 'compose_invalid'
  /** Structural editing is not available in this environment's posture. */
  | 'capability_unavailable';

export interface StructuralEditDeclineAnswer {
  readonly text: string;
  readonly actions: readonly {
    readonly label: string;
    readonly prompt: string;
    readonly role: 'facilitator' | 'challenger';
  }[];
}

/**
 * The smaller-ask chips, CONSUMED not copied (ROADMAP 2.621's lesson).
 *
 * They are apt for every class here because every class's first actionable step
 * is the same: ask for a part rather than the whole. Where a class has a better
 * first step than a smaller ask, the prose says so and these remain a valid
 * second option — a chip that always works is not a chip that always fits.
 */
const SMALLER_ASK_ACTIONS = STRUCTURAL_EDIT_TOO_LARGE_ACTIONS;

export const STRUCTURAL_EDIT_DECLINE_COPY: Readonly<
  Record<StructuralEditDeclineClass, StructuralEditDeclineAnswer>
> = {
  // Unchanged from #829 — the one class that already had an honest answer.
  too_large_to_split: {
    text: STRUCTURAL_EDIT_TOO_LARGE_TEXT,
    actions: SMALLER_ASK_ACTIONS,
  },

  // Nothing was attempted, so the copy must not imply a judgement was made
  // about the change itself. Retrying unchanged is the right first step.
  model_unreadable: {
    text:
      'I could not read your current model just then, so I have not put a ' +
      'change forward. Try asking me again in a moment. If it keeps happening, ' +
      'ask me for one part of the change at a time: the changes for a single ' +
      'option, for example.',
    actions: SMALLER_ASK_ACTIONS,
  },

  // Something was attempted and did not come back. Also worth retrying, but the
  // honest sentence is different: the failure was in working the change out,
  // not in reading the model.
  compose_unavailable: {
    text:
      'I could not work that change out just then, so I have not put anything ' +
      'forward. Try asking me again. If it keeps happening, ask me for one ' +
      'part of it at a time: the changes for a single option, for example.',
    actions: SMALLER_ASK_ACTIONS,
  },

  // The request could not be expressed against this graph. Retrying unchanged
  // will not help; naming the attachment point will.
  not_expressible: {
    text:
      'I could not see how to make that change against your model as it ' +
      'stands, so I have not put anything forward. Tell me which part of the ' +
      'model each piece should attach to, or ask me for one part of it at a ' +
      'time: the changes for a single option, for example.',
    actions: SMALLER_ASK_ACTIONS,
  },

  // A batch came back and failed the grounding validator. The user learns that
  // a version existed and did not stand up, which is true and is different from
  // "I could not work it out".
  compose_invalid: {
    text:
      'I worked out a version of that change and it did not hold together ' +
      'against your model, so I have not put it forward. Ask me for one part ' +
      'of it and I will propose that: the changes for a single option, for ' +
      'example.',
    actions: SMALLER_ASK_ACTIONS,
  },

  // The step-by-step path is switched off for this environment. Saying "here"
  // is the honest scope: it is not a property of the request.
  capability_unavailable: {
    text:
      'That is a bigger change than I can make in one piece here, and I cannot ' +
      'break it into steps for you at the moment. Ask me for one part of it ' +
      'and I will propose that: the changes for a single option, for example.',
    actions: SMALLER_ASK_ACTIONS,
  },
};

/** Every class, for callers that must prove they cover all of them. */
export const STRUCTURAL_EDIT_DECLINE_CLASSES = Object.keys(
  STRUCTURAL_EDIT_DECLINE_COPY,
) as readonly StructuralEditDeclineClass[];
