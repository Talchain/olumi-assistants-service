/**
 * COLLAB U-S0 — participant tokens (seam pinned by contracts.ts:78).
 *
 * A participant token is an ELICIT-ONLY capability on ONE NAMED ROUND. It
 * cannot mint, cannot close, cannot preview, cannot read a sibling, and cannot
 * reach the canonical graph. It is per-round, revocable, and stored HASHED.
 *
 * ── WHY TOKENS AND NOT SUPABASE ACCOUNTS FOR PARTICIPANTS ─────────────────
 * Blindness fails CLOSED under tokens and OPEN under accounts, and blindness is
 * the scientific mechanism of the whole feature. A token participant holds NO
 * Supabase identity and NO table grant at all — there is nothing for RLS to
 * hide, and absence is a property of the response shape, provable server-side.
 * The account path would need phase-aware logic inside every SELECT policy over
 * mutable round state, and ANY policy bug leaks a sibling's stance.
 *
 * ⚠ A token is a BEARER capability. A forwarded link means a forged answer
 * under the accepted PoC auth posture. Say so out loud rather than implying a
 * guarantee this does not make.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  refuse,
  type CollabActor,
  type CollabParticipant,
  type CollabStore,
} from './types.js';

/**
 * 256 bits of CSPRNG entropy, base64url — 43 characters, comfortably above the
 * ≥128-bit floor the contract sets. base64url so the value survives a URL
 * fragment without percent-encoding (the transport the UI half uses).
 */
const TOKEN_BYTES = 32;

export function generateParticipantToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Tokens are stored as a SHA-256 hex digest and never in the clear. There is no
 * "read the token back" path anywhere in this feature: a lost link is re-minted,
 * not recovered.
 */
export function hashParticipantToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time hex comparison. The lookup itself is by hash (so the DB does the
 * matching), but any place this module compares two digests must not leak
 * timing — cheap to do correctly, and a needless side channel otherwise.
 */
export function tokenHashesEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function requireOwnerOrService(actor: CollabActor, what: string): void {
  if (actor.kind === 'owner' || actor.kind === 'service') return;
  refuse('collab_owner_only', `${what} is owner-only.`);
}

/**
 * Mint a participant and its one-time token.
 *
 * Returns the RAW token exactly once, to the owner who minted it. Nothing
 * persists it: the caller hands it to the participant out of band and it is
 * unrecoverable thereafter.
 */
export async function mintParticipantToken(
  store: CollabStore,
  args: {
    round_id: string;
    scenario_id: string;
    display_name: string;
    supabase_user_id?: string | null;
    actor: CollabActor;
  },
): Promise<{ participant: CollabParticipant; token: string }> {
  requireOwnerOrService(args.actor, 'Minting a participant');

  const displayName = typeof args.display_name === 'string' ? args.display_name.trim() : '';
  if (displayName === '') {
    refuse('collab_payload_invalid', 'A participant needs a display name to attribute to.');
  }

  const token = generateParticipantToken();
  const nowIso = new Date().toISOString();
  const participant: CollabParticipant = {
    participant_id: crypto.randomUUID(),
    scenario_id: args.scenario_id,
    round_id: args.round_id,
    display_name: displayName,
    supabase_user_id: args.supabase_user_id ?? null,
    token_hash: hashParticipantToken(token),
    status: 'active',
    pseudonym: null,
    created_at: nowIso,
  };

  await store.insertParticipant(participant);
  // The lifecycle is append-only in both directions: the row records CURRENT
  // status as a read optimisation, the status events are the truth.
  await store.appendParticipantStatusEvent({
    participant_id: participant.participant_id,
    status: 'active',
    actor: args.actor.kind === 'owner' ? args.actor.user_id : 'service',
  });

  return { participant, token };
}

/**
 * Resolve a raw token to its participant, ON THE NAMED ROUND ONLY.
 *
 * The round scoping is in the STORE QUERY, not in a post-hoc comparison: a token
 * minted for round 1 is not merely rejected on round 2, it is never found there.
 *
 * ⚠ The revoked/invalid distinction exists at THIS grain only. The route grain
 * collapses both to one answer so the HTTP boundary is not an existence oracle.
 */
export async function verifyParticipantToken(
  store: CollabStore,
  args: { round_id: string; token: string },
): Promise<CollabParticipant> {
  const token = typeof args.token === 'string' ? args.token.trim() : '';
  if (token === '') {
    refuse('collab_token_invalid', 'No participant token supplied.');
  }

  const tokenHash = hashParticipantToken(token);

  const active = await store.findActiveParticipantByTokenHash(args.round_id, tokenHash);
  if (active !== null && tokenHashesEqual(active.token_hash, tokenHash)) {
    return active;
  }

  // Any-status lookup: distinguishes "revoked" from "never existed" for the
  // operator and for the service-grain tests. Never surfaced at the boundary.
  const anyStatus = await store.findParticipantByTokenHash(args.round_id, tokenHash);
  if (anyStatus !== null && anyStatus.status === 'revoked') {
    refuse('collab_token_revoked', 'That participant link has been revoked.');
  }

  refuse('collab_token_invalid', 'That participant token is not valid for this round.');
}

/**
 * Revoke a participant.
 *
 * Revocation is an APPENDED status event, never a row delete: the person's
 * contributions remain attributed and the reveal stays honest about who was in
 * the room. Erasure is a different operation with a different shape — see
 * `redaction.ts` (R-1/R-2), which detaches the NAME and retains the CONTENT.
 */
export async function revokeParticipant(
  store: CollabStore,
  args: { participant_id: string; actor: CollabActor },
): Promise<void> {
  requireOwnerOrService(args.actor, 'Revoking a participant');

  await store.appendParticipantStatusEvent({
    participant_id: args.participant_id,
    status: 'revoked',
    actor: args.actor.kind === 'owner' ? args.actor.user_id : 'service',
  });
}
