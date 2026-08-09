/**
 * COLLAB U-S0 — packet read model (seam pinned by contracts.ts:80).
 *
 * THE BLINDNESS BOUNDARY. `assembleOpenPacket` is the single function standing
 * between a participant and everything they must not see before they answer.
 *
 * ── BLINDNESS IS A PROPERTY OF THE QUERY SHAPE ────────────────────────────
 * This function reaches for `listOwnEvents(round, self)` and NOTHING ELSE. It
 * never calls `listAllRoundEvents`, never calls `getModelValuesAtVersion`, and
 * never lists the roster. It therefore never HOLDS a sibling's answer, the
 * model's own number, or a response count — there is nothing in scope to leak,
 * and no filter that could be dropped in a refactor to start leaking it.
 *
 * An implementation that fetched everything and filtered would produce the same
 * output today and would be a DEFECT: one careless projection later it starts
 * emitting what it always had. The N-suite asserts the call log for exactly
 * this reason, and that assertion is not redundant with the content assertions.
 *
 * ── THE FOUR THINGS WITHHELD, AND WHY EACH IS AN ANCHOR ───────────────────
 * 1. Sibling contributions — the whole point of a blind round.
 * 2. The MODEL'S current value for the target. `PacketTarget` has no member for
 *    it, so this one is absence by construction rather than by omission.
 * 3. Sibling PROGRESS. "3 of 4 have answered" is social pressure, and "everyone
 *    else is done" changes what people write.
 * 4. The ROSTER. Knowing who else is in the room changes an answer before a
 *    single number is shared.
 *
 * ── AND THE ONE THING THE REVEAL MUST NOT DO ──────────────────────────────
 * `RevealView` has no mean, median, combined, recommended, winner or consensus
 * member at any nesting level, and a lone dissenter appears exactly like anyone
 * else. Disagreement is the SIGNAL. Averaging it away would destroy the only
 * thing the method produces.
 */

import {
  refuse,
  type CollabStore,
  type ElicitationEventRow,
  type OpenPacket,
  type RevealPerTargetRow,
  type RevealView,
  type CollabActor,
  type PacketTarget,
} from './types.js';

function projectTargets(manifest: readonly PacketTarget[]): PacketTarget[] {
  // EXPLICIT four-key projection. A DB row carrying extra columns — or a future
  // manifest field — cannot ride into a packet through a spread.
  return manifest.map((t) => ({
    target: { kind: t.target.kind, id: t.target.id },
    label: t.label,
    description: t.description ?? null,
    unit: t.unit ?? null,
  }));
}

/**
 * Assemble the blind packet for ONE participant.
 *
 * ⚠ Every read below is scoped to the caller. If you add a store call to this
 * function, you are changing the blindness boundary — the N-suite will go red,
 * and that red is correct until you can say why the new read cannot carry a
 * sibling's answer.
 */
export async function assembleOpenPacket(
  store: CollabStore,
  args: { round_id: string; participant_id: string },
): Promise<OpenPacket> {
  const round = await store.getRound(args.round_id);
  if (round === null) {
    refuse('collab_token_invalid', 'No open round for that token.');
  }
  if (round.status !== 'open') {
    refuse('collab_round_closed', 'That round is closed.');
  }

  const self = await store.getParticipant(args.participant_id);
  if (self === null || self.round_id !== args.round_id) {
    refuse('collab_not_a_participant', 'Not a participant on that round.');
  }
  if (self.status === 'revoked') {
    refuse('collab_token_revoked', 'That participant link has been revoked.');
  }

  // THE ONLY EVENT READ. Scoped to self, by identity, in the query itself.
  const ownEvents = await store.listOwnEvents(args.round_id, args.participant_id);
  const completed = new Set<string>();
  for (const e of ownEvents) {
    if (e.kind === 'belief_submitted' || e.kind === 'belief_revised' || e.kind === 'declined') {
      completed.add(e.target.id);
    }
  }

  // The key set here IS the contract. Six keys, no more.
  return {
    round_id: round.round_id,
    status: 'open',
    context_note: round.context_note,
    graph_version_ref: round.graph_version_ref,
    targets: projectTargets(round.target_manifest),
    self: {
      participant_id: self.participant_id,
      display_name: self.pseudonym ?? self.display_name,
      completed_target_ids: [...completed],
    },
  };
}

/**
 * Fold the append-only log to the latest event per (participant, target).
 *
 * Append-only means a revision does not overwrite: BOTH rows survive, and the
 * pair is the record of what changed someone's mind. The reveal shows the
 * latest, and the counting unit is DISTINCT PARTICIPANTS — one person who
 * revised three times is one voice, not three.
 *
 * Ordering: `event_version` is the per-(participant,target) monotonic stamp set
 * at append time; log order breaks a tie. Wall-clock `created_at` is
 * deliberately NOT the ordering key — two appends inside the same millisecond
 * would be a coin toss, and this must be deterministic.
 */
function foldLatestPerParticipant(
  events: readonly ElicitationEventRow[],
  targetId: string,
): ElicitationEventRow[] {
  const latest = new Map<string, { row: ElicitationEventRow; index: number }>();
  events.forEach((row, index) => {
    if (row.target.id !== targetId) return;
    const held = latest.get(row.participant_id);
    if (
      held === undefined ||
      row.event_version > held.row.event_version ||
      (row.event_version === held.row.event_version && index > held.index)
    ) {
      latest.set(row.participant_id, { row, index });
    }
  });
  return [...latest.values()].map((v) => v.row);
}

/**
 * Assemble the post-close reveal: every position, attributed, side by side.
 *
 * ⚠ Refuses while the round is OPEN, for the owner and every participant alike
 * — ONE server-side gate, not a per-caller rule. A reveal that the owner could
 * peek at early is not a blind round.
 */
export async function assembleRevealView(
  store: CollabStore,
  args: { round_id: string; requested_by: CollabActor },
): Promise<RevealView> {
  const round = await store.getRound(args.round_id);
  if (round === null) {
    refuse('collab_token_invalid', 'No round for that token.');
  }
  if (round.status === 'open' || round.status === 'draft') {
    refuse(
      'collab_round_open',
      'This round is still open. Nobody sees the answers — including you — until it closes.',
    );
  }

  if (args.requested_by.kind === 'participant') {
    const self = await store.getParticipant(args.requested_by.participant_id);
    if (self === null || self.round_id !== args.round_id) {
      refuse('collab_not_a_participant', 'Not a participant on that round.');
    }
  }

  const events = await store.listAllRoundEvents(args.round_id);
  const roster = await store.listParticipants(args.round_id);
  // Display label resolves to the PSEUDONYM after redaction. That is the whole
  // R-1 mechanism at the read grain: the name detaches, the contribution stays.
  const labelById = new Map(
    roster.map((p) => [p.participant_id, p.pseudonym ?? p.display_name] as const),
  );

  const targets = projectTargets(round.target_manifest);
  const modelValues = await store.getModelValuesAtVersion(
    round.graph_version_ref,
    targets.map((t) => t.target.id),
  );

  return {
    round_id: round.round_id,
    // Narrowed by the `collab_round_open` guard above: 'draft' and 'open' are
    // already unreachable here, which is why this is a plain assignment rather
    // than a defensive re-check.
    status: round.status,
    graph_version_ref: round.graph_version_ref,
    per_target: targets.map((t) => ({
      target: { kind: t.target.kind, id: t.target.id },
      label: t.label,
      model_value_at_version: modelValues[t.target.id] ?? null,
      // EXPLICIT six-key projection per response. `supabase_user_id` and
      // `token_hash` live on the participant row and must never reach here;
      // a spread would carry both the first time this is refactored.
      responses: foldLatestPerParticipant(events, t.target.id).map(
        (row): RevealPerTargetRow => {
          // TWO DISTINCT ABSENCES, written out rather than collapsed into a
          // `?? null` fallback: a DECLINED event carries no belief at all, and
          // a belief may carry a null confidence because the person gave none.
          // Both render as "no number", but conflating them behind a fallback
          // is how a missing field quietly becomes a stated one — the defect
          // class the forbidden-pattern gate exists to stop growing.
          const belief = row.belief;
          return {
            participant_id: row.participant_id,
            display_label: labelById.get(row.participant_id) ?? 'Removed participant',
            value: belief === null ? null : belief.value,
            // The person's OWN WORDS, verbatim. This is what makes the reveal a
            // record of reasoning rather than a row of numbers.
            expression_raw: belief === null ? null : belief.expression_raw,
            confidence: belief === null ? null : belief.confidence,
            kind: row.kind,
          };
        },
      ),
    })),
  };
}
