/**
 * 2.909 N-suite — ROUND LIFECYCLE (INV-G) + ROUND-MINT VERSIONING (2.910) —
 * RED pre-DDL by construction.
 *
 * No event lands on a closed round; close is owner-only (token-scope N-T4);
 * reveal is impossible while the round is open; guest scenarios cannot mint
 * (G1/MV001); the version anchor is an EXPLICIT create_model_version call at
 * mint, never the nullable everyday-path pointer (ROADMAP 2.910, measured:
 * model_versions frozen since 27 Jul — nothing on the live path mints).
 *
 * RED signature today (every test): "RED (pre-DDL): seam not implemented:
 * src/collab/rounds-service.ts" (elicitation-append / packet-read-model where named).
 */
import { describe, it, expect } from "vitest";
import {
  importSeam,
  expectRefusal,
  type RoundsServiceSeam,
  type ElicitationAppendSeam,
  type PacketReadModelSeam,
  seededOpenRoundStore,
  createFixtureStore,
  fixtureRound,
  fixtureParticipantA,
  fixtureTarget,
  SENTINELS,
  FIXTURE_ROUND_ID,
  FIXTURE_SCENARIO_ID,
  FIXTURE_TARGET_ID,
} from "./contracts.js";

const OWNER = { kind: "owner", user_id: SENTINELS.OWNER_USER_ID } as const;

describe("N-L round lifecycle (INV-G) + round-mint versioning (2.910)", () => {
  it("N-L1: NO elicitation event lands on a closed round — refused loud, store unchanged (a late belief would silently corrupt the reveal)", async () => {
    const append = await importSeam<ElicitationAppendSeam>("src/collab/elicitation-append.ts");
    const store = createFixtureStore({
      rounds: [fixtureRound({ status: "closed" })],
      participants: [fixtureParticipantA()],
      scenarioOwners: { [FIXTURE_SCENARIO_ID]: SENTINELS.OWNER_USER_ID },
    });

    await expectRefusal(
      append.appendParticipantEvent(store, {
        round_id: FIXTURE_ROUND_ID,
        participant: fixtureParticipantA(),
        payload: {
          kind: "belief_submitted",
          target: { kind: "factor", id: FIXTURE_TARGET_ID },
          belief: { value: 0.4, expression_raw: "fairly unlikely", confidence: 0.7 },
        },
      }),
      "collab_round_closed"
    );
    expect(store.state.events).toEqual([]);
    // Kind-agnostic: a post-close REVISION is refused identically.
    await expectRefusal(
      append.appendParticipantEvent(store, {
        round_id: FIXTURE_ROUND_ID,
        participant: fixtureParticipantA(),
        payload: {
          kind: "belief_revised",
          target: { kind: "factor", id: FIXTURE_TARGET_ID },
          belief: { value: 0.5, expression_raw: "even odds", confidence: 0.6 },
        },
      }),
      "collab_round_closed"
    );
    expect(store.state.events).toEqual([]);
  });

  it("N-L2: a REVOKED participant's append refuses collab_token_revoked even with a resolved participant object (append re-checks status)", async () => {
    const append = await importSeam<ElicitationAppendSeam>("src/collab/elicitation-append.ts");
    const revoked = fixtureParticipantA({ status: "revoked" });
    const store = createFixtureStore({
      rounds: [fixtureRound()],
      participants: [revoked],
      scenarioOwners: { [FIXTURE_SCENARIO_ID]: SENTINELS.OWNER_USER_ID },
    });

    await expectRefusal(
      append.appendParticipantEvent(store, {
        round_id: FIXTURE_ROUND_ID,
        participant: revoked,
        payload: {
          kind: "belief_submitted",
          target: { kind: "factor", id: FIXTURE_TARGET_ID },
          belief: { value: 0.4, expression_raw: "fairly unlikely", confidence: 0.7 },
        },
      }),
      "collab_token_revoked"
    );
    expect(store.state.events).toEqual([]);
  });

  it("N-L3: reveal is IMPOSSIBLE while the round is open — collab_round_open, for owner and participant alike (single server-side gate)", async () => {
    const seam = await importSeam<PacketReadModelSeam>("src/collab/packet-read-model.ts");
    const store = seededOpenRoundStore();

    await expectRefusal(
      seam.assembleRevealView(store, {
        round_id: FIXTURE_ROUND_ID,
        requested_by: { kind: "participant", participant_id: SENTINELS.A_PARTICIPANT_ID },
      }),
      "collab_round_open"
    );
    await expectRefusal(
      seam.assembleRevealView(store, { round_id: FIXTURE_ROUND_ID, requested_by: OWNER }),
      "collab_round_open"
    );
    // Positive control: the same call on a closed round resolves.
    store.state.rounds.set(FIXTURE_ROUND_ID, fixtureRound({ status: "closed" }));
    const reveal = await seam.assembleRevealView(store, {
      round_id: FIXTURE_ROUND_ID,
      requested_by: OWNER,
    });
    expect(reveal.round_id).toBe(FIXTURE_ROUND_ID);
  });

  it("N-L4: a GUEST scenario (owner NULL) cannot mint a round — collab_guest_scenario, no round created (G1; MV001 kinship)", async () => {
    const rounds = await importSeam<RoundsServiceSeam>("src/collab/rounds-service.ts");
    const store = createFixtureStore({
      scenarioOwners: { "guest-scenario-fixture": null },
    });

    await expectRefusal(
      rounds.mintRound(store, {
        scenario_id: "guest-scenario-fixture",
        actor: { kind: "owner", user_id: SENTINELS.OWNER_USER_ID },
        target_manifest: [fixtureTarget()],
        context_note: null,
      }),
      "collab_guest_scenario"
    );
    expect(store.state.rounds.size).toBe(0);
    expect(store.state.roundEvents).toEqual([]);
  });

  it("N-L5: round mint pins graph_version_ref via an EXPLICIT createModelVersion call with elicitation provenance — and NEVER reads the everyday-path pointer (2.910)", async () => {
    const rounds = await importSeam<RoundsServiceSeam>("src/collab/rounds-service.ts");
    const store = createFixtureStore({
      scenarioOwners: { [FIXTURE_SCENARIO_ID]: SENTINELS.OWNER_USER_ID },
      // Poison the everyday-path pointer: if the implementation reads it, the
      // ref will be this value and the assertions below bite.
      scenarioCurrentPointers: { [FIXTURE_SCENARIO_ID]: "POISON-everyday-pointer-DO-NOT-USE" },
    });

    const round = await rounds.mintRound(store, {
      scenario_id: FIXTURE_SCENARIO_ID,
      actor: { kind: "owner", user_id: SENTINELS.OWNER_USER_ID },
      target_manifest: [fixtureTarget()],
      context_note: "ctx",
    });

    // The explicit mint happened, with elicitation provenance…
    expect(store.calls).toContain(
      `createModelVersion:${FIXTURE_SCENARIO_ID}:elicitation_round_mint`
    );
    // …its returned id IS the pin…
    expect(round.graph_version_ref).toBe("mv-fixture-1");
    expect(round.graph_version_ref).not.toBe("POISON-everyday-pointer-DO-NOT-USE");
    // …and the nullable everyday-path pointer was never consulted.
    expect(
      store.calls.filter((c) => c.startsWith("getScenarioCurrentModelVersionPointer:"))
    ).toEqual([]);
  });

  it("N-L6 (F-6 flagged fork): close by an owner-panellist who neither submitted nor declined refuses collab_owner_unsubmitted (the anti-anchoring ordering has teeth at close)", async () => {
    const rounds = await importSeam<RoundsServiceSeam>("src/collab/rounds-service.ts");
    // Owner joined the panel: a participant row bound to the owner's user id.
    const ownerAsPanellist = fixtureParticipantA({
      participant_id: "owner-as-panellist-fixture",
      display_name: "Owner (self)",
      supabase_user_id: SENTINELS.OWNER_USER_ID,
    });
    const store = createFixtureStore({
      rounds: [fixtureRound()],
      participants: [ownerAsPanellist],
      scenarioOwners: { [FIXTURE_SCENARIO_ID]: SENTINELS.OWNER_USER_ID },
    });

    await expectRefusal(
      rounds.closeRound(store, { round_id: FIXTURE_ROUND_ID, actor: OWNER }),
      "collab_owner_unsubmitted"
    );
    expect((await store.getRound(FIXTURE_ROUND_ID))?.status).toBe("open");

    // Positive control: once the owner-panellist has DECLINED (recorded), close succeeds.
    store.state.events.push({
      event_id: "owner-decline-1",
      round_id: FIXTURE_ROUND_ID,
      participant_id: "owner-as-panellist-fixture",
      event_version: 1,
      kind: "declined",
      target: { kind: "factor", id: FIXTURE_TARGET_ID },
      belief: null,
      provenance: {
        authored_by: "owner-as-panellist-fixture",
        method: "elicited_nl",
        elicitation_version: "fixture-v1",
      },
      created_at: "2026-08-08T00:02:00.000Z",
    });
    await rounds.closeRound(store, { round_id: FIXTURE_ROUND_ID, actor: OWNER });
    expect((await store.getRound(FIXTURE_ROUND_ID))?.status).toBe("closed");
    expect(
      store.state.roundEvents.filter((e) => e.round_id === FIXTURE_ROUND_ID && e.transition === "closed")
    ).toHaveLength(1);
  });
});
