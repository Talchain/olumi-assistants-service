/**
 * 2.909 N-suite — BLINDNESS (INV-A) — RED pre-DDL by construction.
 *
 * The Delphi core: a packet GET with participant token A can NEVER return
 * participant B's contribution pre-reveal — and the withholding must be the
 * QUERY SHAPE itself (the read model never even requests sibling rows), not a
 * filter flag over a fetched superset. G2 §3.3 items 1-4; trap 13 (every
 * absence assertion here has a demonstrated presence in the reveal shape);
 * trap 19 (assertions bind by participant IDENTITY, not value predicates).
 *
 * RED signature today (every test): "RED (pre-DDL): seam not implemented:
 * src/collab/packet-read-model.ts" (rounds-service for N-A4).
 */
import { describe, it, expect } from "vitest";
import {
  importSeam,
  type PacketReadModelSeam,
  type RoundsServiceSeam,
  seededOpenRoundStore,
  fixtureRound,
  SENTINELS,
  FIXTURE_ROUND_ID,
  OPEN_PACKET_ALLOWED_KEYS,
  jsonContains,
} from "./contracts.js";

describe("N-A blindness (INV-A): open packet withholds sibling contributions by construction", () => {
  it("N-A1: A's open packet carries none of B's contribution, no model value, no aggregate/count — and the reveal shape CAN carry all of them (positive control)", async () => {
    const seam = await importSeam<PacketReadModelSeam>("src/collab/packet-read-model.ts");
    const store = seededOpenRoundStore();

    const packet = await seam.assembleOpenPacket(store, {
      round_id: FIXTURE_ROUND_ID,
      participant_id: SENTINELS.A_PARTICIPANT_ID,
    });

    // B's contribution — bound to B by identity AND content sentinels.
    expect(jsonContains(packet, SENTINELS.B_VALUE_STR)).toBe(false);
    expect(jsonContains(packet, SENTINELS.B_EXPRESSION)).toBe(false);
    expect(jsonContains(packet, SENTINELS.B_PARTICIPANT_ID)).toBe(false);
    expect(jsonContains(packet, SENTINELS.B_DISPLAY_NAME)).toBe(false);
    expect(jsonContains(packet, SENTINELS.B_SUPABASE_USER_ID)).toBe(false);
    // The model's own value for the elicited target (anchor, G2 §3.3 item 2).
    expect(jsonContains(packet, SENTINELS.MODEL_VALUE_STR)).toBe(false);

    // POSITIVE CONTROL (trap 13): close the round; the reveal view for the SAME
    // store and the SAME scan function must SHOW every sentinel — proving the
    // scan can see a presence, so the absences above are non-vacuous.
    store.state.rounds.set(FIXTURE_ROUND_ID, fixtureRound({ status: "closed" }));
    const reveal = await seam.assembleRevealView(store, {
      round_id: FIXTURE_ROUND_ID,
      requested_by: { kind: "participant", participant_id: SENTINELS.A_PARTICIPANT_ID },
    });
    expect(jsonContains(reveal, SENTINELS.B_VALUE_STR)).toBe(true);
    expect(jsonContains(reveal, SENTINELS.B_EXPRESSION)).toBe(true);
    expect(jsonContains(reveal, SENTINELS.B_PARTICIPANT_ID)).toBe(true);
    expect(jsonContains(reveal, SENTINELS.MODEL_VALUE_STR)).toBe(true);
  });

  it("N-A2: the QUERY SHAPE is blind — open-packet assembly calls listOwnEvents(round, A) only, never listAllRoundEvents or getModelValuesAtVersion", async () => {
    const seam = await importSeam<PacketReadModelSeam>("src/collab/packet-read-model.ts");
    const store = seededOpenRoundStore();

    await seam.assembleOpenPacket(store, {
      round_id: FIXTURE_ROUND_ID,
      participant_id: SENTINELS.A_PARTICIPANT_ID,
    });

    // Identity-bound scoped read happened…
    expect(store.calls).toContain(
      `listOwnEvents:${FIXTURE_ROUND_ID}:${SENTINELS.A_PARTICIPANT_ID}`
    );
    // …and the unscoped reads NEVER did. This is "the query shape itself, not a
    // filter flag": an implementation that fetches everything and filters would
    // pass N-A1 and FAIL here.
    expect(store.calls.filter((c) => c.startsWith("listAllRoundEvents:"))).toEqual([]);
    expect(store.calls.filter((c) => c.startsWith("getModelValuesAtVersion:"))).toEqual([]);
    // And A's packet never queried any OTHER participant's events.
    const ownEventReads = store.calls.filter((c) => c.startsWith("listOwnEvents:"));
    expect(ownEventReads).toEqual([`listOwnEvents:${FIXTURE_ROUND_ID}:${SENTINELS.A_PARTICIPANT_ID}`]);
  });

  it("N-A3: the open packet's key set is EXACTLY the allowlist — the shape cannot grow a sibling channel silently", async () => {
    const seam = await importSeam<PacketReadModelSeam>("src/collab/packet-read-model.ts");
    const store = seededOpenRoundStore();

    const packet = await seam.assembleOpenPacket(store, {
      round_id: FIXTURE_ROUND_ID,
      participant_id: SENTINELS.A_PARTICIPANT_ID,
    });

    expect(Object.keys(packet).sort()).toEqual([...OPEN_PACKET_ALLOWED_KEYS].sort());
    // self is SELF only, and progress is own-completion only (blindness item 3).
    expect(packet.self.participant_id).toBe(SENTINELS.A_PARTICIPANT_ID);
    // No target row carries any value-bearing member (blindness item 2 by shape).
    for (const t of packet.targets) {
      expect(Object.keys(t).sort()).toEqual(["description", "label", "target", "unit"]);
    }
  });

  it("N-A4: the OWNER is not exempt pre-close — ownerPreview carries roster but no belief content (G2 §2.3, owner-as-panellist)", async () => {
    const rounds = await importSeam<RoundsServiceSeam>("src/collab/rounds-service.ts");
    const packetSeam = await importSeam<PacketReadModelSeam>("src/collab/packet-read-model.ts");
    const store = seededOpenRoundStore();

    const preview = await rounds.ownerPreview(store, {
      round_id: FIXTURE_ROUND_ID,
      actor: { kind: "owner", user_id: SENTINELS.OWNER_USER_ID },
    });

    // Roster is the owner's own data (they entered it) — visible.
    expect(preview.roster.map((r) => r.participant_id).sort()).toEqual(
      [SENTINELS.A_PARTICIPANT_ID, SENTINELS.B_PARTICIPANT_ID].sort()
    );
    // Belief CONTENT is not — the owner is a panellist too (anchoring).
    expect(jsonContains(preview, SENTINELS.B_VALUE_STR)).toBe(false);
    expect(jsonContains(preview, SENTINELS.B_EXPRESSION)).toBe(false);
    expect(jsonContains(preview, SENTINELS.MODEL_VALUE_STR)).toBe(false);

    // POSITIVE CONTROL: post-close the owner's reveal view shows the content.
    store.state.rounds.set(FIXTURE_ROUND_ID, fixtureRound({ status: "closed" }));
    const reveal = await packetSeam.assembleRevealView(store, {
      round_id: FIXTURE_ROUND_ID,
      requested_by: { kind: "owner", user_id: SENTINELS.OWNER_USER_ID },
    });
    expect(jsonContains(reveal, SENTINELS.B_VALUE_STR)).toBe(true);
    expect(jsonContains(reveal, SENTINELS.B_EXPRESSION)).toBe(true);
  });
});
