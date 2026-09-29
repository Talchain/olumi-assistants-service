/**
 * COLLAB U-S0 — rounds service (seam pinned by contracts.ts:79).
 *
 * mintRound / closeRound / ownerPreview. All three are OWNER-ONLY, and the
 * owner check is the FIRST thing each does — before any store read, so a
 * refusal cannot leave a partial write or reveal that something exists.
 *
 * ── ROADMAP 2.910: THE VERSION ANCHOR MUST BE EXPLICIT ────────────────────
 * A round pins the graph it was asked about, so a reveal weeks later still says
 * what the panel actually saw. It pins it by calling `createModelVersion`
 * EXPLICITLY at mint and using the RETURNED id.
 *
 * It must NEVER read `scenarios.current_model_version_id`. That pointer is
 * nullable and, measured, FROZEN — `model_versions` has had no mints since
 * 27 Jul because nothing on the everyday path creates one. A round pinned to it
 * would pin NULL and the reveal would have no ground to stand on. The N-suite
 * poisons that pointer and asserts it is never consulted; that assertion is the
 * whole content of 2.910.
 */

import {
  refuse,
  type CollabActor,
  type CollabRound,
  type CollabStore,
  type OpenPacketLikePreview,
  type PacketTarget,
} from './types.js';

/**
 * Owner-only, checked BEFORE any store call.
 *
 * ⚠ Ordering is load-bearing: a participant actor must not be able to learn
 * that a round exists by observing whether the refusal came before or after a
 * lookup, and must not leave a round event behind on the way out.
 */
function requireOwnerActor(actor: CollabActor, what: string): { user_id: string } {
  if (actor.kind === 'owner') return { user_id: actor.user_id };
  if (actor.kind === 'service') return { user_id: 'service' };
  refuse('collab_owner_only', `${what} is owner-only.`);
}

/** Copy a target manifest through an explicit projection. */
function projectTargets(manifest: readonly PacketTarget[]): PacketTarget[] {
  return manifest.map((t) => ({
    target: { kind: t.target.kind, id: t.target.id },
    label: t.label,
    description: t.description ?? null,
    unit: t.unit ?? null,
  }));
}

/**
 * Mint a round: pin an immutable graph version, record the targets, open it.
 *
 * Guest scenarios are refused. That is not an arbitrary restriction — a round
 * asserts "these people were asked about THIS model at THIS version", and a
 * guest scenario has no owner to attribute the asking to and cannot mint a
 * version at all (`create_model_version` answers MV001). The refusal here and
 * MV001 downstream are two INDEPENDENT controls on the same rule.
 */
export async function mintRound(
  store: CollabStore,
  args: {
    scenario_id: string;
    actor: CollabActor;
    target_manifest: PacketTarget[];
    context_note: string | null;
  },
): Promise<CollabRound> {
  const owner = requireOwnerActor(args.actor, 'Minting a round');

  const targets = projectTargets(args.target_manifest ?? []);
  if (targets.length === 0) {
    refuse('collab_payload_invalid', 'A round needs at least one target to ask about.');
  }

  const scenarioOwner = await store.getScenarioOwnerUserId(args.scenario_id);
  if (scenarioOwner === null) {
    refuse(
      'collab_guest_scenario',
      'This scenario has no owner. Sign in and claim it before inviting a panel.',
    );
  }
  if (args.actor.kind === 'owner' && scenarioOwner !== owner.user_id) {
    refuse('collab_owner_only', 'Only the scenario owner can open a round on it.');
  }

  // ROADMAP 2.910 — EXPLICIT mint. The returned id IS the pin. The everyday
  // pointer is deliberately not consulted (see the module header).
  const { model_version_id } = await store.createModelVersion({
    scenario_id: args.scenario_id,
    provenance: 'elicitation_round_mint',
  });

  const nowIso = new Date().toISOString();
  const round: CollabRound = {
    round_id: crypto.randomUUID(),
    scenario_id: args.scenario_id,
    graph_version_ref: model_version_id,
    target_manifest: targets,
    context_note: args.context_note ?? null,
    status: 'open',
    created_by: scenarioOwner,
    created_at: nowIso,
  };

  await store.insertRound(round);
  await store.appendRoundEvent({
    round_id: round.round_id,
    transition: 'open',
    actor: owner.user_id,
    created_at: nowIso,
  });

  return round;
}

/**
 * Close a round. After this, no elicitation event lands (INV-G) and the reveal
 * becomes possible — in that order, atomically from the caller's point of view.
 *
 * ── THE OWNER-PANELLIST ORDERING RULE (F-6) ───────────────────────────────
 * If the owner joined their own panel, they cannot close the round — and so
 * cannot reach the reveal — until they have submitted or explicitly declined.
 * Otherwise the owner could read everyone else's positions and then enter their
 * own, which is precisely the anchoring the blind round exists to prevent.
 *
 * ⚠ Enforced at CLOSE, not at reveal. A reveal-time-only gate would DEADLOCK:
 * reveal is already impossible while open, and a closed round refuses all
 * writes, so an owner who closed without submitting could never satisfy it. The
 * property that must survive any re-ruling: the owner cannot reach the reveal
 * without having submitted or declined first.
 */
export async function closeRound(
  store: CollabStore,
  args: { round_id: string; actor: CollabActor },
): Promise<void> {
  const owner = requireOwnerActor(args.actor, 'Closing a round');

  const round = await store.getRound(args.round_id);
  if (round === null) {
    // Deliberately the same code as a genuine non-owner: "not yours" and "no
    // such round" are indistinguishable to a caller, by design.
    refuse('collab_owner_only', 'No round you own with that id.');
  }
  if (args.actor.kind === 'owner' && round.created_by !== owner.user_id) {
    refuse('collab_owner_only', 'Only the scenario owner can close this round.');
  }
  if (round.status !== 'open') {
    refuse('collab_round_closed', 'That round is already closed.');
  }

  // F-6: is the closing owner ALSO on the panel? If so they must have answered.
  const roster = await store.listParticipants(args.round_id);
  const ownerPanellist = roster.find(
    (p) => p.supabase_user_id !== null && p.supabase_user_id === owner.user_id,
  );
  if (ownerPanellist !== undefined && ownerPanellist.status !== 'revoked') {
    // Scoped read: the ONLY question being asked is "has THIS participant
    // answered?" — so the query is their own events, not everyone's.
    const ownEvents = await store.listOwnEvents(args.round_id, ownerPanellist.participant_id);
    const hasAnswered = ownEvents.some(
      (e) =>
        e.kind === 'belief_submitted' || e.kind === 'belief_revised' || e.kind === 'declined',
    );
    if (!hasAnswered) {
      refuse(
        'collab_owner_unsubmitted',
        'You are on this panel. Enter or decline your own answer before closing — seeing the others first would anchor it.',
      );
    }
  }

  await store.appendRoundEvent({
    round_id: args.round_id,
    transition: 'closed',
    actor: owner.user_id,
    created_at: new Date().toISOString(),
  });
}

/**
 * The owner's pre-close view: who is on the panel and what they were asked.
 *
 * ⚠ NOT what anyone said. The owner entered the roster, so the roster is theirs
 * to see; the beliefs are not, because the owner is a panellist too and is not
 * exempt from anchoring. This is a SCIENTIFIC property of the method, not a
 * permission decision, which is why it holds even for the person who owns the
 * scenario and pays for the account.
 */
export async function ownerPreview(
  store: CollabStore,
  args: { round_id: string; actor: CollabActor },
): Promise<OpenPacketLikePreview> {
  const owner = requireOwnerActor(args.actor, 'Previewing a round');

  const round = await store.getRound(args.round_id);
  if (round === null) {
    refuse('collab_owner_only', 'No round you own with that id.');
  }
  if (args.actor.kind === 'owner' && round.created_by !== owner.user_id) {
    refuse('collab_owner_only', 'Only the scenario owner can preview this round.');
  }

  const roster = await store.listParticipants(args.round_id);

  return {
    round_id: round.round_id,
    status: round.status,
    targets: projectTargets(round.target_manifest),
    // EXPLICIT projection to exactly three fields. A spread would carry
    // token_hash and supabase_user_id into an owner-facing payload the moment
    // the row gains a column.
    roster: roster.map((p) => ({
      participant_id: p.participant_id,
      display_name: p.pseudonym ?? p.display_name,
      status: p.status,
    })),
  };
}
