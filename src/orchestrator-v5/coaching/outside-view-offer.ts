/**
 * ⭐ THE OFFER — the user-visible half of proactive DSK-P-002.
 *
 * `outside-view-eligibility.ts` decides WHETHER to offer; this builds WHAT is
 * offered, and derives the two settled-state inputs that decision needs.
 *
 * ── WHY A CoachingBlock AND NOT AN ExerciseBlock ────────────────────────────
 * ⛔ `ExerciseBlock` is reserved for the CONFIRMED protocol and must stay that
 * way. Its `reference_class` field carries the base rate the user actually
 * stated, and `V5ExerciseBlock.tsx` renders it as recorded fact. Putting the
 * INVITATION ("what category is this?") in that field would render an
 * invitation as evidence — an offer wearing the clothes of a confirmed
 * measurement. So the pre-confirmation offer is a `CoachingBlock` carrying
 * `dsk_claim_provenance` (an offer with a citation) plus ordinary suggested
 * actions, and the confirmed path downstream is left exactly as it is.
 *
 * Both carriers already exist, are already contracted, and are already rendered
 * ungated (`V5CoachingBlock.tsx:396-408`). This adds no schema field, no wire
 * type and no UI.
 *
 * ⭐ `action_intent: 'run_outside_view'` is a contract member with ZERO
 * emitters in `src/` before this module. The vocabulary was declared and left
 * dark; nothing new had to be minted.
 *
 * ── THE TWO SETTLED STATES, AND WHAT THEY REST ON ───────────────────────────
 * ⚠ THERE IS NO CANONICAL RECORD OF EITHER. `createConfirmedReferenceClass`
 * has exactly one caller (`turn-executor.ts`) and, by its own module contract,
 * "does NOT write to the graph" — the effect is display plus session. So
 * `already_completed` cannot be read from canonical state, however much one
 * would prefer that. Both states are therefore derived from the DURABLE TURN
 * HISTORY, and bound to the product's OWN LITERAL replay messages rather than
 * to prose sentiment:
 *
 *   completed ⟸ a prior USER turn carries `REFERENCE_CLASS_CONFIRM_PREFIX`
 *               ("Record this base rate:"), which only this product's own
 *               confirm chip mints.
 *   declined  ⟸ a prior USER turn carries {@link OUTSIDE_VIEW_DECLINE_MESSAGE},
 *               which only this module's own decline chip mints.
 *
 * That is exact where a phrase-match would be a guess. ⛔ But it is scoped to
 * the loaded turn window: a decline is NOT guaranteed to survive beyond the
 * history the turn actually carries, and there is no typed decline ledger in the
 * estate to make it durable. Disclosed here rather than implied away. Durable
 * state is worth adding only if repeat prompting proves to be a real problem.
 */
import { CoachingBlockSchema } from '@talchain/schemas/boundary';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { REFERENCE_CLASS_CONFIRM_PREFIX } from '../belief-elicitation/reference-class-grammar.js';
import { deterministicBlockId } from '../compose/block-id.js';
import type { SessionTurnWithContent } from '../session/conversation-content.js';
import type { OutsideViewVerdict } from './outside-view-eligibility.js';

/**
 * The decline chip's replay message. It becomes the user's own next turn
 * verbatim, which is precisely what makes it a durable marker: the refusal is
 * recorded in the conversation in the user's voice, not in a hidden flag.
 */
export const OUTSIDE_VIEW_DECLINE_MESSAGE =
  'Not now — skip the outside view for this decision.';

/** The engage chip's replay message: the user asking for the exercise. */
export const OUTSIDE_VIEW_ENGAGE_MESSAGE =
  'Help me take the outside view on this decision.';

/**
 * Signal-id prefix. The session is appended so one session's offer dedupes
 * across re-emissions while two sessions never collide — the same keying
 * `reference-class-block.ts` uses for the confirmed exercise.
 */
export const OUTSIDE_VIEW_OFFER_SIGNAL_PREFIX = 'coaching:outside_view_offer';

/**
 * ⭐ THE ENGAGE CHIP NAMES THE METHOD; THE DECLINE CHIP MUST NOT.
 *
 * `tests/contract/coaching-chip-intent-completeness.guard.test.ts` classifies any
 * chip id CONTAINING a routed-intent token as a coaching-method chip and REDs if
 * the registry cannot resolve it. That guard caught a real defect here, not a
 * registration chore: the decline chip was first named
 * `chip_prompt_outside_view_decline`, and the only way to satisfy the registry
 * with that id is to map it to `outside_view` — which would make "Not now"
 * INVOKE the method it is refusing.
 *
 * So the engage chip is registered (`CHIP_ID_INTENT` → `outside_view`) and the
 * decline chip is renamed to say what it does. The decline never needed a routed
 * intent: it works by the MESSAGE it mints, which `deriveOutsideViewHistory`
 * matches. ⛔ Do not put a routed-intent token back in the decline id.
 */
export const OUTSIDE_VIEW_ENGAGE_CHIP_ID = 'chip_prompt_outside_view_engage';
export const OUTSIDE_VIEW_DECLINE_CHIP_ID = 'chip_prompt_skip_reference_class';
const SOURCE_HANDLER = 'outside_view_offer';
/** Coaching ranks sit below review cards; this is an offer, not a finding. */
const PRIORITY_RANK = 150;

export interface OutsideViewHistory {
  readonly confirmedReferenceClassPresent: boolean;
  readonly declineObservedInWindow: boolean;
  /**
   * The user has ALREADY taken the offer up in this window. Engaging starts the
   * protocol; re-offering it on the same breath is nagging, not method.
   */
  readonly engageObservedInWindow: boolean;
}

/**
 * Derive the settled states from durable history, by the product's own literals.
 *
 * Scoped to USER-authored text: the assistant mentioning the confirm phrase
 * inside its own copy must not read as the user having confirmed anything.
 *
 * ⛔⛔ THE CURRENT TURN COUNTS. It did not, and that was the first blocker of the
 * Canvas Completion lane's exact-head review: settled state was read from PRIOR
 * turns only, so the turn on which the user pressed "Not now" — and the turn on
 * which they pressed "Take the outside view" — could not see its own message,
 * and the offer was attached again to the very reply acknowledging it. Their
 * probes P1, P1b and P2 all reproduced it.
 *
 * `currentMessage` is therefore scanned alongside the window. It is the SAME
 * user-authored channel, arriving one turn earlier than the store can supply it.
 */
export function deriveOutsideViewHistory(
  priorTurns: readonly SessionTurnWithContent[],
  currentMessage?: string,
): OutsideViewHistory {
  let confirmed = false;
  let declined = false;
  let engaged = false;
  const consider = (message: unknown): void => {
    if (typeof message !== 'string' || message === '') return;
    const trimmed = message.trimStart().toLowerCase();
    if (trimmed.startsWith(REFERENCE_CLASS_CONFIRM_PREFIX.toLowerCase())) confirmed = true;
    if (message.includes(OUTSIDE_VIEW_DECLINE_MESSAGE)) declined = true;
    if (message.includes(OUTSIDE_VIEW_ENGAGE_MESSAGE)) engaged = true;
  };
  for (const turn of priorTurns) consider(turn.user_message);
  consider(currentMessage);
  return {
    confirmedReferenceClassPresent: confirmed,
    declineObservedInWindow: declined,
    engageObservedInWindow: engaged,
  };
}

/**
 * ⛔⛔ IS THERE ROOM FOR THE USER TO SAY NO?
 *
 * `chip-finalizer.ts` caps the `chip_prompt_` / `chip_action_` SUGGESTION family
 * and keeps the EARLIER chips. Blocks are not budgeted, so the card always
 * survives. The Canvas Completion lane's exact-head review measured both rows:
 * with 2 base suggestion chips "Not now" was trimmed, and with 3 both offer chips
 * were trimmed — while the card stayed. **The user was asked a question with no
 * way to decline it, and it returned on later turns anyway.**
 *
 * So the offer stands down entirely when no suggestion slot remains. Silence is
 * honest; an un-refusable prompt is not.
 *
 * ⚠ EXPORTED AND USED BY THE CALL SITE, deliberately. The same review found a
 * sibling PR whose mount spec RE-IMPLEMENTED the logic it claimed to pin, so no
 * mutation of the real path could reach it. One implementation, imported by both.
 * `SUGGESTION_BUDGET` is asserted against the real finaliser in the specs, not
 * trusted from this comment.
 */
export const SUGGESTION_BUDGET = 3;

const SUGGESTION_CHIP_PREFIXES = ['chip_prompt_', 'chip_action_'] as const;

export function outsideViewOfferFitsChipBudget(
  existingActions: ReadonlyArray<{ readonly id?: unknown }>,
): boolean {
  let used = 0;
  for (const a of existingActions) {
    const id = a.id;
    if (typeof id !== 'string') continue;
    if (SUGGESTION_CHIP_PREFIXES.some((p) => id.startsWith(p))) used += 1;
  }
  return used < SUGGESTION_BUDGET;
}

export interface OutsideViewOffer {
  readonly assistant_text: string;
  readonly suggested_actions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly message: string;
  }>;
  readonly blocks: OlumiResponse['blocks'];
}

/**
 * Build the offer for an `eligible` verdict. Returns `null` for every other
 * verdict — a caller cannot accidentally offer on `declined`.
 *
 * FAIL-CLOSED ON THE BLOCK: if the card fails schema validation the chips and
 * the question still go out, because the offer's substance is the question.
 * A dropped card costs the citation badge, never the intervention.
 */
export function buildOutsideViewOffer(
  verdict: OutsideViewVerdict,
  ctx: { readonly sessionId: string; readonly createdAt: string },
): OutsideViewOffer | null {
  if (verdict.eligibility !== 'eligible') return null;

  // The question is the PROTOCOL'S OWN authored first step, verbatim from the
  // bundle. Nothing here rewrites the science into house copy.
  const assistant_text = verdict.invitation;

  const signal_id = [
    OUTSIDE_VIEW_OFFER_SIGNAL_PREFIX,
    ctx.sessionId,
    verdict.protocol.protocol_id,
  ].join(':');

  const candidate = {
    // `block_id` is a UUID by contract — reuse the shared Phase-3 derivation
    // rather than minting a format of our own (it REFUSED a non-UUID id, which
    // is the schema doing its job).
    block_id: deterministicBlockId(signal_id),
    signal_id,
    created_at: ctx.createdAt,
    source_handler: SOURCE_HANDLER,
    freshness: 'fresh' as const,
    type: 'coaching' as const,
    // `assumption_check`, not `calibration_prompt`: that kind is owned by the
    // probability-calibration flow (`handlers/draft-calibration-blocks.ts`) and
    // means something else. This is grounded in DSK-P-002's own
    // `expected_outputs`, which include "adjusted assumptions if warranted".
    coaching_kind: 'assumption_check' as const,
    title: 'Compare this with similar decisions',
    body: assistant_text,
    // The offer is produced by a deterministic gate over the bundle, not by a
    // draft or a review pass. Naming it honestly matters for the audit trail.
    source: 'deterministic_signal' as const,
    // ⛔ EMPTY BY DESIGN. The offer is about the DECISION's reference class, not
    // about one element — and the measured predicate cannot tell which number
    // prompted it, so binding a target_ref would assert a link we cannot prove.
    target_refs: [],
    priority_rank: PRIORITY_RANK,
    action_intent: 'run_outside_view' as const,
    action_label: 'Take the outside view',
    action_prompt: OUTSIDE_VIEW_ENGAGE_MESSAGE,
    dsk_claim_provenance: verdict.claim,
  };

  const parsed = CoachingBlockSchema.safeParse(candidate);
  const blocks = (parsed.success ? [parsed.data] : []) as OlumiResponse['blocks'];

  return {
    assistant_text,
    // ⛔⛔ THE DECLINE COMES FIRST, AND THE ORDER IS LOAD-BEARING.
    // `chip-finalizer.ts` caps the `chip_prompt_` suggestion family and keeps the
    // EARLIER chips, so whichever of these two is second is the one dropped. The
    // Canvas Completion review measured the consequence: with the engage chip
    // first, "Not now" was trimmed and the user was shown a card they could not
    // decline. An offer whose refusal can be budgeted away is not an offer.
    suggested_actions: [
      {
        // ⭐ THE DECLINE IS A FIRST-CLASS CHIP, not an absence. Without it the
        // only way not to engage is silence, and silence is indistinguishable
        // from never having been asked — the exact gap that makes the bundle's
        // "already fired / already declined" negative conditions unenforceable.
        id: OUTSIDE_VIEW_DECLINE_CHIP_ID,
        label: 'Not now',
        message: OUTSIDE_VIEW_DECLINE_MESSAGE,
      },
      {
        id: OUTSIDE_VIEW_ENGAGE_CHIP_ID,
        label: 'Take the outside view',
        message: OUTSIDE_VIEW_ENGAGE_MESSAGE,
      },
    ],
    blocks,
  };
}
