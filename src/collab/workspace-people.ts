/**
 * COLLAB — THE WORKSPACE ROSTER. Who has been on a panel in this scenario, and
 * the check that lets a NEW round reuse one of them.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * `participant_id` is minted per round, so before this the record could not
 * express "the same Grace answered both times". That is not a tidiness problem:
 * a team's reasoning is a thing that moves, and the most interesting object in
 * a panel is a person who CHANGED THEIR MIND between rounds — which is
 * unrepresentable if each round invents a new stranger. Durable identity is
 * what makes provenance, attribution and disagreement survive past one round.
 *
 * ── ⚠ THE ONE RULE THAT MATTERS: MERGING IS THE OWNER'S CLAIM, NEVER OURS ──
 * Nothing in this module infers that two participant rows are the same person.
 * Not by display name, not by normalised display name, not by edit distance,
 * not by "obviously it is the same Grace". The owner selects an existing person
 * and we honour it; otherwise a fresh person is minted.
 *
 * This is the inverse failure the feature must not ship. A name-based merge
 * SILENTLY REATTRIBUTES one person's stated position to another — two
 * colleagues called Sam, or one name reused for two people across six months —
 * and the resulting record is not merely wrong, it is confidently wrong about
 * what a named human believes, with no signal that anything happened. Against
 * that, the cost of refusing to guess is that an owner occasionally has to pick
 * from a list. That trade is not close.
 *
 * The asymmetry is worth naming because it decides the design: failing to link
 * two rows UNDER-CLAIMS ("we cannot tell these are the same person"), which is
 * honest and recoverable — the owner can link them next time. Wrongly linking
 * them OVER-CLAIMS, is invisible, and corrupts the reasoning record. Every
 * default here leans to the under-claiming side.
 */

import {
  refuse,
  resolvePersonId,
  type CollabActor,
  type CollabParticipant,
  type CollabStore,
  type WorkspacePerson,
} from './types.js';

/**
 * Owner-only, checked BEFORE any store read — same ordering rule as
 * `rounds-service.ts`: a refusal must not disclose that a scenario exists.
 */
function requireOwnerActor(actor: CollabActor, what: string): { user_id: string } {
  if (actor.kind === 'owner') return { user_id: actor.user_id };
  if (actor.kind === 'service') return { user_id: 'service' };
  refuse('collab_owner_only', `${what} is owner-only.`);
}

async function requireScenarioOwner(
  store: CollabStore,
  scenario_id: string,
  actor: CollabActor,
  what: string,
): Promise<void> {
  const owner = requireOwnerActor(actor, what);

  const scenarioOwner = await store.getScenarioOwnerUserId(scenario_id);
  if (scenarioOwner === null) {
    refuse(
      'collab_guest_scenario',
      'This scenario has no owner. Sign in and claim it before inviting a panel.',
    );
  }
  if (actor.kind === 'owner' && scenarioOwner !== owner.user_id) {
    // Deliberately the same code and shape as "no such scenario": an
    // authenticated caller must not become an existence oracle over other
    // people's scenarios by reading which refusal comes back.
    refuse('collab_owner_only', 'No scenario you own with that id.');
  }
}

/**
 * A participant row still carries a live identity.
 *
 * ⚠ A REDACTED ROW IS EXCLUDED FROM THE ROSTER, and that is the whole R-1
 * mechanism reaching this surface. `collab_redact_participant` nulls
 * `person_id`, so an erased person has no durable identity to reuse — offering
 * them in a picker would re-attach the name the erasure detached, and doing it
 * from a list the owner is about to type a real name into is the worst possible
 * place for it. Their past contributions stay in the reveal under their
 * pseudonym; they simply cannot be invited again AS that person.
 */
function hasLiveIdentity(p: CollabParticipant): boolean {
  const pseudonym = p.pseudonym;
  const redacted = typeof pseudonym === 'string' && pseudonym.trim() !== '';
  return !redacted && typeof p.person_id === 'string' && p.person_id.trim() !== '';
}

/**
 * The workspace roster: one entry per distinct person, newest label wins.
 *
 * ⚠ `round_count` counts DISTINCT ROUNDS, not participant rows. They are the
 * same number today (one row per person per round) and would diverge silently
 * the moment anything mints twice on one round — a count that quietly means
 * something other than its name is how "3 rounds" becomes a number nobody can
 * reproduce.
 */
export async function listWorkspacePeople(
  store: CollabStore,
  args: { scenario_id: string; actor: CollabActor },
): Promise<WorkspacePerson[]> {
  await requireScenarioOwner(store, args.scenario_id, args.actor, 'Listing panel members');

  const rows = await store.listScenarioParticipants(args.scenario_id);

  const byPerson = new Map<string, { rounds: Set<string>; label: string; lastSeen: string }>();

  for (const row of rows) {
    if (!hasLiveIdentity(row)) continue;

    const personId = resolvePersonId(row);
    const label = row.pseudonym ?? row.display_name;
    const existing = byPerson.get(personId);

    if (existing === undefined) {
      byPerson.set(personId, {
        rounds: new Set([row.round_id]),
        label,
        lastSeen: row.created_at,
      });
      continue;
    }

    existing.rounds.add(row.round_id);
    // Newest row supplies the label: the owner may have corrected a spelling,
    // and the correction should be what they see next time. Compared as ISO
    // strings, which sort lexicographically iff they are same-offset — they are,
    // every writer uses `new Date().toISOString()` (UTC, fixed width).
    if (row.created_at > existing.lastSeen) {
      existing.lastSeen = row.created_at;
      existing.label = label;
    }
  }

  return [...byPerson.entries()]
    .map(([person_id, v]) => ({
      person_id,
      display_name: v.label,
      round_count: v.rounds.size,
      last_seen_at: v.lastSeen,
    }))
    .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : a.last_seen_at > b.last_seen_at ? -1 : 0));
}

/**
 * Validate an owner's claim that a new panel member IS an existing person.
 *
 * ⚠ THE SCENARIO SCOPE IS THE SECURITY BOUNDARY, NOT A TIDINESS CHECK. Without
 * it an owner could paste any person id — including one harvested from another
 * scenario's reveal — and graft their own panellist onto a stranger's identity,
 * making a future reader believe that person answered here. The check is a
 * lookup within THIS scenario's rows, so an id from elsewhere is not merely
 * rejected, it is never found.
 *
 * Returns the person id to stamp. Refuses rather than silently minting a fresh
 * person, because a claim that turns quietly into a different claim is how
 * attribution rots: the owner would believe they had linked the rows.
 */
export async function resolveClaimedPersonId(
  store: CollabStore,
  args: { scenario_id: string; claimed_person_id: string | null | undefined },
): Promise<string | null> {
  const claimed =
    typeof args.claimed_person_id === 'string' ? args.claimed_person_id.trim() : '';
  // No claim is the ordinary case: a brand-new person. The caller mints.
  if (claimed === '') return null;

  const rows = await store.listScenarioParticipants(args.scenario_id);
  const match = rows.find((row) => hasLiveIdentity(row) && resolvePersonId(row) === claimed);

  if (match === undefined) {
    refuse(
      'collab_payload_invalid',
      'That panel member is not someone who has been on a round in this scenario.',
    );
  }

  return claimed;
}
