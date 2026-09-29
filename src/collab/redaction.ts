/**
 * COLLAB U-S0 — R-1/R-2 participant redaction (seam pinned by contracts.ts:82).
 *
 * ── WHAT ERASURE MEANS HERE, AND WHY IT IS NOT A DELETE ───────────────────
 * R-1 option (ii), pseudonymise-on-erasure: DETACH THE NAME, RETAIN THE
 * CONTENT. A panel member who asks to be erased stops being named; their
 * contribution stays in the record, because deleting it would silently rewrite
 * what the panel actually thought — the reveal would show a different set of
 * positions than the one the team reasoned about, with no trace that anything
 * had changed. Two harms are being traded here and only one of them is the
 * person's to waive: their identity is theirs, the shared reasoning record is
 * the team's.
 *
 * R-2: the redaction is NARROW (one participant), SERVICE-ROLE ONLY,
 * AUDIT-LOGGED, and IDEMPOTENT. It is the single sanctioned exception to
 * append-only, and it is deliberately the only one.
 *
 * ── THE AUDIT ROW DOES NOT CARRY THE NAME ─────────────────────────────────
 * "Audit-logged" is read as logging THAT / WHO / WHEN — never as preserving the
 * PII the routine exists to detach. An audit table holding every redacted name
 * would be a re-identification index built by the erasure feature itself.
 *
 * ── SCOPE: THE SHAPE IS BUILT, THE OPERATION IS NOT SURFACED ──────────────
 * This seam and its DB routine exist and are tested. There is deliberately NO
 * owner-facing UI and no route that reaches them in this slice — erasure is a
 * real obligation with a real workflow (who may ask, who verifies, what the
 * person is told) and that workflow is not part of "two people contribute
 * privately and reveal". It is invoked out of band by an operator until then.
 */

import { randomBytes } from 'node:crypto';

import { refuse, type CollabActor, type CollabStore } from './types.js';

/**
 * A pseudonym that cannot be reversed from any payload it appears in.
 *
 * ⚠ NOT derived from the display name, the participant id, or the Supabase user
 * id — no hash, no truncation, no initials. Anything derived from the identity
 * is a re-identification key for anyone holding a candidate list, which for a
 * two-person panel is a list of two.
 */
export function generatePseudonym(): string {
  return `Participant ${randomBytes(4).toString('hex')}`;
}

/**
 * Detach one participant's name.
 *
 * IDEMPOTENT: a second call is a non-destructive no-op returning the SAME
 * pseudonym, with no second audit row and no touch to the events. That matters
 * because erasure requests get retried, and a routine that minted a fresh
 * pseudonym each time would fragment one person's history into several
 * apparent people — the opposite of what was asked for.
 */
export async function redactParticipantIdentity(
  store: CollabStore,
  args: { participant_id: string; requested_by: CollabActor },
): Promise<{ pseudonym: string; already_redacted: boolean }> {
  if (args.requested_by.kind === 'participant') {
    // A participant token is elicit-only. Erasure is an operator action.
    refuse('collab_owner_only', 'Redaction is not a participant capability.');
  }

  const participant = await store.getParticipant(args.participant_id);
  if (participant === null) {
    refuse('collab_not_a_participant', 'No such participant.');
  }

  // Already redacted: return the existing pseudonym untouched.
  if (participant.pseudonym !== null && participant.pseudonym !== '') {
    return { pseudonym: participant.pseudonym, already_redacted: true };
  }

  const pseudonym = generatePseudonym();

  await store.redactParticipantDisplayName(args.participant_id, pseudonym);
  await store.appendRedactionAuditRow({
    participant_id: args.participant_id,
    // WHO asked, as a role label — never the redacted name, and never a value
    // that could be joined back to it.
    requested_by: args.requested_by.kind === 'owner' ? args.requested_by.user_id : 'service',
    created_at: new Date().toISOString(),
  });

  return { pseudonym, already_redacted: false };
}
