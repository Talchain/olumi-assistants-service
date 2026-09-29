/**
 * 2.909 N-suite — ATTRIBUTION INTEGRITY (INV-F) + APPEND-ONLY (INV-C at read
 * grain) + FAIL-LOUD (INV-D) — RED pre-DDL by construction.
 *
 * THE DEFECT CLASS THIS PINS (collab-readiness-2026-08-08 dim-1 finding):
 * `append_turn_atomic_v4` stamps the SCENARIO OWNER's user_id on EVERY
 * persisted write — the RPC takes no acting-user parameter, so a participant's
 * contribution would be attributed to the owner. The elicitation append path
 * must NEVER reproduce that: every event's provenance.authored_by is the
 * token-resolved participant, server-stamped, and the wire may not carry a
 * provenance claim the server could stamp itself (dispatch.ts rule, G2 §4.2).
 *
 * RED signature today (every test): "RED (pre-DDL): seam not implemented:
 * src/collab/elicitation-append.ts" (packet-read-model for N-P4's fold check).
 */
import { describe, it, expect } from "vitest";
import {
  importSeam,
  expectRefusal,
  type ElicitationAppendSeam,
  type PacketReadModelSeam,
  seededOpenRoundStore,
  fixtureRound,
  fixtureParticipantA,
  SENTINELS,
  FIXTURE_ROUND_ID,
  FIXTURE_TARGET_ID,
  type NewElicitationEventPayload,
} from "./contracts.js";

function beliefPayload(value: number, expr: string): NewElicitationEventPayload {
  return {
    kind: "belief_submitted",
    target: { kind: "factor", id: FIXTURE_TARGET_ID },
    belief: { value, expression_raw: expr, confidence: 0.7 },
  };
}

describe("N-P attribution (INV-F) / append-only (INV-C) / fail-loud (INV-D)", () => {
  it("N-P1: a participant's event is authored_by THAT participant — never the scenario owner's id (the append_turn_atomic_v4 defect class)", async () => {
    const append = await importSeam<ElicitationAppendSeam>("src/collab/elicitation-append.ts");
    const store = seededOpenRoundStore();

    const row = await append.appendParticipantEvent(store, {
      round_id: FIXTURE_ROUND_ID,
      participant: fixtureParticipantA(),
      payload: beliefPayload(0.35, "somewhat unlikely"),
    });

    // Identity-bound (trap 19): the exact participant id, not any predicate.
    expect(row.provenance.authored_by).toBe(SENTINELS.A_PARTICIPANT_ID);
    expect(row.provenance.authored_by).not.toBe(SENTINELS.OWNER_USER_ID);
    expect(row.participant_id).toBe(SENTINELS.A_PARTICIPANT_ID);
    // And what was PERSISTED says the same (not just the returned object).
    const persisted = store.state.events.filter((e) => e.event_id === row.event_id);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.provenance.authored_by).toBe(SENTINELS.A_PARTICIPANT_ID);
    expect(JSON.stringify(persisted[0]?.provenance)).not.toContain(SENTINELS.OWNER_USER_ID);
  });

  it("N-P2: the wire may not carry provenance — a payload smuggling authored_by/provenance is refused collab_payload_invalid, nothing persisted", async () => {
    const append = await importSeam<ElicitationAppendSeam>("src/collab/elicitation-append.ts");
    const store = seededOpenRoundStore();
    const eventsBefore = store.state.events.length;

    const smuggled = {
      ...beliefPayload(0.35, "somewhat unlikely"),
      provenance: { authored_by: SENTINELS.OWNER_USER_ID },
    } as unknown as NewElicitationEventPayload;

    await expectRefusal(
      append.appendParticipantEvent(store, {
        round_id: FIXTURE_ROUND_ID,
        participant: fixtureParticipantA(),
        payload: smuggled,
      }),
      "collab_payload_invalid"
    );
    expect(store.state.events).toHaveLength(eventsBefore);

    const smuggledTopLevel = {
      ...beliefPayload(0.35, "somewhat unlikely"),
      authored_by: SENTINELS.OWNER_USER_ID,
    } as unknown as NewElicitationEventPayload;
    await expectRefusal(
      append.appendParticipantEvent(store, {
        round_id: FIXTURE_ROUND_ID,
        participant: fixtureParticipantA(),
        payload: smuggledTopLevel,
      }),
      "collab_payload_invalid"
    );
    expect(store.state.events).toHaveLength(eventsBefore);
  });

  it("N-P3: contract validation is fail-loud BEFORE commit — a belief_submitted with no belief refuses collab_payload_invalid, never a silent ack (INV-D)", async () => {
    const append = await importSeam<ElicitationAppendSeam>("src/collab/elicitation-append.ts");
    const store = seededOpenRoundStore();
    const eventsBefore = store.state.events.length;

    const missingBelief = {
      kind: "belief_submitted",
      target: { kind: "factor", id: FIXTURE_TARGET_ID },
      belief: null,
    } as NewElicitationEventPayload;

    await expectRefusal(
      append.appendParticipantEvent(store, {
        round_id: FIXTURE_ROUND_ID,
        participant: fixtureParticipantA(),
        payload: missingBelief,
      }),
      "collab_payload_invalid"
    );
    expect(store.state.events).toHaveLength(eventsBefore);
  });

  it("N-P4: revision APPENDS, never rewrites — both rows retained, reveal folds to latest-per-participant (INV-C read model)", async () => {
    const append = await importSeam<ElicitationAppendSeam>("src/collab/elicitation-append.ts");
    const packetSeam = await importSeam<PacketReadModelSeam>("src/collab/packet-read-model.ts");
    const store = seededOpenRoundStore();
    const aEventsBefore = store.state.events.filter(
      (e) => e.participant_id === SENTINELS.A_PARTICIPANT_ID
    ).length;

    await append.appendParticipantEvent(store, {
      round_id: FIXTURE_ROUND_ID,
      participant: fixtureParticipantA(),
      payload: beliefPayload(0.35, "somewhat unlikely"),
    });
    await append.appendParticipantEvent(store, {
      round_id: FIXTURE_ROUND_ID,
      participant: fixtureParticipantA(),
      payload: {
        kind: "belief_revised",
        target: { kind: "factor", id: FIXTURE_TARGET_ID },
        belief: { value: 0.55, expression_raw: "a bit better than even", confidence: 0.6 },
      },
    });

    // Append-only: BOTH rows exist.
    const aEvents = store.state.events.filter(
      (e) => e.participant_id === SENTINELS.A_PARTICIPANT_ID
    );
    expect(aEvents).toHaveLength(aEventsBefore + 2);

    // Reveal folds to the latest per participant per target.
    store.state.rounds.set(FIXTURE_ROUND_ID, fixtureRound({ status: "closed" }));
    const reveal = await packetSeam.assembleRevealView(store, {
      round_id: FIXTURE_ROUND_ID,
      requested_by: { kind: "owner", user_id: SENTINELS.OWNER_USER_ID },
    });
    const target = reveal.per_target.find((t) => t.target.id === FIXTURE_TARGET_ID);
    const aRows = (target?.responses ?? []).filter(
      (r) => r.participant_id === SENTINELS.A_PARTICIPANT_ID
    );
    expect(aRows).toHaveLength(1); // latest-per-participant fold, counting unit = distinct participants
    expect(aRows[0]?.value).toBe(0.55);
    expect(aRows[0]?.kind).toBe("belief_revised");
  });
});
