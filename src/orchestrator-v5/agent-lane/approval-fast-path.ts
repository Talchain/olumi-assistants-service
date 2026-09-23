/**
 * ⭐⭐ APPROVING AN OUTSTANDING PROPOSAL NEEDS NO MODEL CALL — this decides when.
 *
 * RC FAST-PATH DIRECTIVE: "Approve assumptions: deterministic authorisation/apply
 * → receipt → reread. ZERO model calls." MEASURED on the served build, an approve
 * turn costs ~29-38s across 3 tool hops and 4 provider calls — and EVERY ONE of
 * those four is the agent loop's own (`purpose: 'conversation'`). `authoriseChange`
 * itself contains no provider-call site in any of its dispatch legs. So the model
 * is being paid to read an id out of `get_canonical_state` and echo it back.
 *
 * ⛔ AND THIS IS A CORRECTNESS FIX BEFORE IT IS A LATENCY ONE. `proposal.ts:230-241`
 * records the measured harm on the deployed build: the user said "Yes, apply it",
 * the Agent called NO tools, and answered that the changes "have been proposed but
 * not approved or applied" — the approval EVAPORATED. That file calls it "the single
 * worst thing this loop can do, because the user believes the model changed and it
 * did not." A deterministic decision cannot evaporate an approval.
 *
 * ── WHY IT IS SAFE, WHICH IS THE ONLY INTERESTING PART ───────────────────────
 * A false positive here APPLIES A MUTATION THE USER DID NOT ASK FOR. So the
 * decision is a CONJUNCTION, and every arm must hold:
 *
 *   1. EXACTLY ONE proposal outstanding. With two, "yes" cannot name one — the
 *      same reasoning `approval-chips.ts:15-17` already uses to decide whether a
 *      chip may be offered at all. With zero there is nothing to authorise.
 *   2. The message is a RECOGNISED confirmation, by one of two routes:
 *      a. it is byte-identical to a message THIS PRODUCT EMITTED as an approval
 *         chip (`APPROVE_CHIP_MESSAGES`) — the user did not compose those words,
 *         the chip did, so an exact match cannot over-fire; or
 *      b. it matches the shared, anchored, live-witnessed free-text recognisers
 *         in `routing/deterministic-short-confirm.ts`.
 *
 * ⚠ MEASURED, NOT ASSUMED: the shared patterns match ONE of the four chips.
 * 'Yes, use those.' (the message for three of them, including
 * `propose_starting_point` — the chip on the measured journey) matches NEITHER.
 * That is why (2a) exists and why the set is derived from `approval-chips.ts`
 * rather than copied.
 *
 * ⛔ ANY doubt DEFERS TO THE LOOP. This function never authorises on a maybe and
 * never throws: an unrecognised message, two proposals, a missing id — all return
 * `defer`, and the turn proceeds exactly as it does today. The fast path can only
 * ever REMOVE calls from a turn it is certain about; it cannot break one it is not.
 */
import { APPROVE_CHIP_MESSAGES } from './approval-chips.js';
import {
  PROPOSAL_CONFIRM_PATTERN,
  SHORT_CONFIRM_PATTERN,
} from '../routing/deterministic-short-confirm.js';

/** One outstanding proposal, in the shape `ProposalStore.outstanding()` returns. */
export interface OutstandingProposal {
  readonly proposal_id: string;
  readonly public_label: string;
}

export interface ApprovalFastPathInput {
  /** The user's message, verbatim. */
  readonly message: string;
  /** `ProposalStore.outstanding(scenario_id, authenticated_user_id)`, newest first. */
  readonly outstanding: readonly OutstandingProposal[];
}

/**
 * Why the fast path declined. Recorded rather than collapsed to a boolean so the
 * turn can say WHICH arm failed — a fast path that silently declines is
 * indistinguishable from one that is not wired.
 */
export type ApprovalDeferReason =
  | 'no_outstanding_proposal'
  | 'multiple_outstanding_proposals'
  | 'message_not_a_confirmation'
  | 'empty_proposal_id';

export type ApprovalFastPathDecision =
  | { readonly kind: 'authorise'; readonly proposal_id: string; readonly matched: 'chip_message' | 'free_text' }
  | { readonly kind: 'defer'; readonly reason: ApprovalDeferReason };

/** Byte-identical to a message the product itself emitted as an approval chip. */
function isChipApproval(message: string): boolean {
  // Trimmed only. NOT lowercased and NOT punctuation-stripped: the product
  // emitted these exact bytes, so anything looser stops being an exact match and
  // starts being a second, undocumented recogniser.
  return APPROVE_CHIP_MESSAGES.has(message.trim());
}

/** Anchored free-text confirmation, via the shared witnessed recognisers. */
function isFreeTextApproval(message: string): boolean {
  return SHORT_CONFIRM_PATTERN.test(message) || PROPOSAL_CONFIRM_PATTERN.test(message);
}

/**
 * Decide whether this turn can authorise deterministically, with no model call.
 *
 * Pure. No I/O, no clock, no store access — the caller supplies both facts.
 */
export function decideApprovalFastPath(
  input: ApprovalFastPathInput,
): ApprovalFastPathDecision {
  const { message, outstanding } = input;

  // Arm 1 — exactly one, so "yes" is unambiguous.
  if (outstanding.length === 0) return { kind: 'defer', reason: 'no_outstanding_proposal' };
  if (outstanding.length > 1) {
    return { kind: 'defer', reason: 'multiple_outstanding_proposals' };
  }

  const only = outstanding[0];
  // A proposal without an id cannot be authorised, and fabricating one would be
  // far worse than deferring.
  if (typeof only?.proposal_id !== 'string' || only.proposal_id.length === 0) {
    return { kind: 'defer', reason: 'empty_proposal_id' };
  }

  // Arm 2 — a recognised confirmation. Chip first: it is the exact-match half.
  if (isChipApproval(message)) {
    return { kind: 'authorise', proposal_id: only.proposal_id, matched: 'chip_message' };
  }
  if (isFreeTextApproval(message)) {
    return { kind: 'authorise', proposal_id: only.proposal_id, matched: 'free_text' };
  }
  return { kind: 'defer', reason: 'message_not_a_confirmation' };
}
