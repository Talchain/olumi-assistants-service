/**
 * INV-F AT THE APPLY SEAM — verify a `factor_value_edit.applied_from` claim
 * against CEE's OWN collab store before any provenance is stamped.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────
 * Before 0.40.0 the only way for an owner to act on a colleague's revealed
 * estimate was to read the reveal, navigate away, find the factor and RETYPE
 * the number. That path writes `observed_state.source = 'user_override'`
 * (`set-factor-value.ts`, `USER_EDIT_SOURCE`) and `node.provenance = 'user_set'`,
 * which the UI renders as **"User edited"** — so acting on Grace's expertise
 * silently RELABELS IT AS THE OWNER'S OWN WORK. The blind round goes to real
 * trouble to prove `authored_by` is server-stamped and unforgeable (INV-F) and
 * the estate then threw that provenance away at the one moment it mattered.
 * This module is what lets the stamp tell the truth instead.
 *
 * ── WHY THE CLIENT'S NUMBER IS NEVER TRUSTED ──────────────────────────────
 * `applied_from` is an ATTRIBUTION CLAIM made by a client, and the contract
 * says so in as many words: "the wire never carries a provenance claim the
 * server could not verify for itself". A server that stamped whatever the
 * client claimed would reproduce the `append_turn_atomic_v4` defect class this
 * whole feature exists to pin — attribution decided by the caller. So:
 *
 *   · every binding below is checked against the STORE, never against the
 *     payload; and
 *   · the value that gets written is the one the SERVER holds, not the one the
 *     client sent. The client's number is checked (so a disagreement is LOUD)
 *     and then DISCARDED (so the write is sound even if the check had a hole).
 *
 * ── WHAT THIS MODULE DOES *NOT* CLAIM, STATED PLAINLY ─────────────────────
 * It does not verify that the caller is the scenario OWNER, and it must not be
 * read as doing so. User-JWT verification on `/orchestrate/v2/turn` is
 * flag-gated (`CEE_REQUIRE_USER_JWT`, default OFF, flip is Paul-gated —
 * `config/index.ts`), so a system-event turn does not reliably carry a verified
 * identity at this tip. Binding (a) is what makes that acceptable and it is
 * load-bearing: a claim may only draw on a round minted for THE SAME SCENARIO
 * the turn is already mutating. The apply therefore grants NO reach a caller
 * did not already have — anyone able to post a turn for scenario X could
 * already write any value to X's graph directly, with no attribution at all.
 * What the apply adds is a stamp, and the stamp is verified. When
 * `CEE_REQUIRE_USER_JWT` flips, this path becomes owner-gated for free via the
 * turn's own authorisation; no change here is needed. Do not add a second,
 * differently-scoped owner check inside this module — two authorities
 * answering near-identical questions is CLAUDE.md trap 21.
 */

import { foldLatestPerParticipant } from './packet-read-model.js';
import {
  refuse,
  type CollabStore,
  type RoundStatus,
} from './types.js';

/**
 * The client's attribution claim, structurally identical to the contract's
 * `RoundParticipantRefSchema` (ids only, `.strict()` — a display name is
 * refused at parse, which is the PII rule made structural rather than
 * remembered).
 */
export interface AppliedFromClaim {
  readonly round_id: string;
  readonly participant_id: string;
}

/**
 * What the server is willing to stamp, after checking. `value` is the SERVER's
 * number — read from the recorded belief, never copied from the request.
 */
export interface VerifiedAppliedValue {
  readonly value: number;
  readonly round_id: string;
  readonly participant_id: string;
}

/**
 * Round statuses from which an apply is permitted.
 *
 * DERIVED FROM THE REVEAL'S OWN GATE, not restated: `assembleRevealView`
 * refuses `'draft'` and `'open'` and admits everything else, and `RevealView`
 * types its status as exactly `Exclude<RoundStatus,'draft'|'open'>`. Applying
 * is downstream of revealing — you cannot apply a number you were never shown
 * — so the permitted set must be the reveal's set. Writing an independent list
 * here (e.g. `['closed']`) would be a second authority on the same question:
 * the day a round moves to `'adjudicating'` the reveal would still render the
 * row and its button, and the apply would refuse a value the product had just
 * offered. That is CLAUDE.md trap 21, and the user-visible symptom is a button
 * that does nothing.
 *
 * ⚠ The `closed → recorded` lifecycle write is DEFERRED (Paul, 13 Aug 2026), so
 * `'closed'` is the only status reachable today. `'adjudicating'` and
 * `'recorded'` are admitted here because the reveal admits them, NOT because
 * anything writes them — the vocabulary is pre-minted with no writer
 * (`types.ts` `RoundStatus`). This set is therefore correct-by-derivation now
 * and stays correct if the deferred transition later lands.
 */
const APPLYABLE_ROUND_STATUSES: ReadonlySet<RoundStatus> = new Set<RoundStatus>([
  'closed',
  'adjudicating',
  'recorded',
]);

/**
 * Verify an `applied_from` claim and return the SERVER-owned value to apply.
 *
 * Throws a typed `CollabRefusal` on every failure — never returns a partial or
 * a repaired result, and never falls back to the client's number. The caller
 * turns the refusal into honest user-facing copy and writes nothing.
 *
 * The five bindings, each a different question, checked in this order so the
 * refusal names the FIRST thing that is actually wrong:
 *
 *   (a) the round belongs to the same scenario as the turn;
 *   (b) the participant belongs to that round;
 *   (c) the belief targets the exact factor being edited;
 *   (d) the round is in a state from which applying is permitted;
 *   (e) the applied value IS the server-recorded participant belief.
 */
export async function verifyAppliedFrom(
  store: CollabStore,
  args: {
    /** The scenario the turn is mutating — the anchor for binding (a). */
    readonly scenario_id: string;
    /** The node id the edit targets — the anchor for binding (c). */
    readonly target_id: string;
    /** The client's claim. Checked, never trusted. */
    readonly claim: AppliedFromClaim;
    /**
     * The model-scale number the client says it is applying. Used ONLY to
     * detect disagreement with the server's record; it is never written.
     */
    readonly claimed_value: number;
  },
): Promise<VerifiedAppliedValue> {
  const { scenario_id, target_id, claim, claimed_value } = args;

  const round = await store.getRound(claim.round_id);
  if (round === null) {
    // Same code as a genuine cross-scenario claim: "no such round" and "not
    // this scenario's round" are deliberately indistinguishable, so the
    // refusal cannot be used to probe which round ids exist.
    refuse(
      'collab_apply_scenario_mismatch',
      'That panel round is not on this decision.',
    );
  }

  // ── (a) the round belongs to THIS scenario ───────────────────────────────
  // The load-bearing scoping control (see the module header): it is what stops
  // a claim reaching a round on somebody else's decision, and it is checked
  // against the STORE's row, never against anything on the wire.
  if (round.scenario_id !== scenario_id) {
    refuse(
      'collab_apply_scenario_mismatch',
      'That panel round is not on this decision.',
    );
  }

  // ── (d) the round is in an applyable state ───────────────────────────────
  // Checked before the participant lookup so an owner who simply has not closed
  // the round yet is told THAT, rather than something about participants.
  if (!APPLYABLE_ROUND_STATUSES.has(round.status)) {
    refuse(
      'collab_apply_round_not_applyable',
      'That panel round has not closed yet, so there are no answers to use. ' +
        'Nobody sees the answers — including you — until it closes.',
    );
  }

  // ── (b) the participant belongs to that round ────────────────────────────
  const participant = await store.getParticipant(claim.participant_id);
  if (participant === null || participant.round_id !== claim.round_id) {
    refuse(
      'collab_not_a_participant',
      'That person is not on this panel round.',
    );
  }

  // ── (c) + (e) the belief targets THIS factor, and the value is the
  //             server's own record of what that person said ────────────────
  //
  // The fold is the REVEAL's fold, imported rather than reimplemented, so
  // "the latest answer" means exactly the same thing to the screen the owner
  // read and to the check that gates the write. `listAllRoundEvents` is the
  // sanctioned reveal-time read and the round is closed, so this is not a
  // blindness violation — INV-A constrains the OPEN packet.
  const events = await store.listAllRoundEvents(claim.round_id);
  const latestForTarget = foldLatestPerParticipant(events, target_id);
  const own = latestForTarget.find((row) => row.participant_id === claim.participant_id);

  // Bound by IDENTITY (participant_id + target_id), never by finding a row
  // whose value happens to equal the claim — a value predicate would happily
  // match a DIFFERENT participant who gave the same number, which is precisely
  // how an attribution stamp becomes a lie (CLAUDE.md trap 19).
  if (own === undefined || own.belief === null || own.belief.value === null) {
    // Covers all three distinct absences with one honest sentence: never asked,
    // explicitly declined, or answered without a number. The refusal does not
    // guess which, because the owner can see which on the reveal.
    refuse(
      'collab_apply_no_stated_value',
      'That person did not give a number for this factor, so there is nothing to apply.',
    );
  }

  const serverValue = own.belief.value;

  // ── (e) the client's claim must MATCH the server's record ────────────────
  // Exact equality on the IEEE double. Both sides originate from the same
  // stored number and JSON round-trips doubles exactly, so the UI can and must
  // echo back the value it was served rather than anything it rendered. A
  // tolerance here would be a place for a wrong number to hide; a mismatch is
  // a real event (a revision landed after the reveal was fetched, or the claim
  // is forged) and the honest answer to both is to refuse and re-read.
  if (!Object.is(serverValue, claimed_value)) {
    refuse(
      'collab_apply_value_mismatch',
      "That answer has changed since this page was loaded, so I haven't applied " +
        'anything. Reopen the panel results to see what they say now.',
    );
  }

  return {
    // The SERVER's number. Even though the equality check above has just proven
    // the two agree, returning `serverValue` rather than `claimed_value` is
    // deliberate: it means the written value comes from the store by
    // construction, so a future weakening of the comparison cannot turn into a
    // client-controlled write.
    value: serverValue,
    round_id: round.round_id,
    participant_id: participant.participant_id,
  };
}
