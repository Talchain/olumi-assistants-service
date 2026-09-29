/**
 * 2.909 N-suite — TOKEN SCOPE — RED pre-DDL by construction.
 *
 * A participant token is elicit-only capability on the NAMED round: it cannot
 * act as owner, cannot mint/close rounds, is per-round, is revocable, and is
 * stored HASHED (G2 §2.2; unified plan §4 F2 bounded R-4 deviation; TA actor
 * set incl. token forgery/revocation).
 *
 * RED signature today (every test): "RED (pre-DDL): seam not implemented:
 * src/collab/participant-tokens.ts" (rounds-service for N-T4/N-T5).
 */
import { describe, it, expect } from "vitest";
import {
  importSeam,
  expectRefusal,
  type ParticipantTokensSeam,
  type RoundsServiceSeam,
  seededOpenRoundStore,
  fixtureRound,
  fixtureTarget,
  SENTINELS,
  FIXTURE_ROUND_ID,
  FIXTURE_SCENARIO_ID,
  jsonContains,
} from "./contracts.js";

const OWNER = { kind: "owner", user_id: SENTINELS.OWNER_USER_ID } as const;

describe("N-T token scope: elicit-only, per-round, revocable, hashed at rest", () => {
  it("N-T1: a minted token verifies (positive control); a forged token refuses collab_token_invalid", async () => {
    const seam = await importSeam<ParticipantTokensSeam>("src/collab/participant-tokens.ts");
    const store = seededOpenRoundStore();

    const minted = await seam.mintParticipantToken(store, {
      round_id: FIXTURE_ROUND_ID,
      scenario_id: FIXTURE_SCENARIO_ID,
      display_name: "Carla-Fixture",
      actor: OWNER,
    });
    // Positive control: the real token resolves to the minted participant.
    const resolved = await seam.verifyParticipantToken(store, {
      round_id: FIXTURE_ROUND_ID,
      token: minted.token,
    });
    expect(resolved.participant_id).toBe(minted.participant.participant_id);

    // Forgery: same length/shape class, wrong bytes.
    await expectRefusal(
      seam.verifyParticipantToken(store, {
        round_id: FIXTURE_ROUND_ID,
        token: "f".repeat(minted.token.length),
      }),
      "collab_token_invalid"
    );
  });

  it("N-T2: a revoked participant's token refuses collab_token_revoked and revocation is an APPENDED status event, not a row delete", async () => {
    const seam = await importSeam<ParticipantTokensSeam>("src/collab/participant-tokens.ts");
    const store = seededOpenRoundStore();

    const minted = await seam.mintParticipantToken(store, {
      round_id: FIXTURE_ROUND_ID,
      scenario_id: FIXTURE_SCENARIO_ID,
      display_name: "Carla-Fixture",
      actor: OWNER,
    });
    await seam.revokeParticipant(store, {
      participant_id: minted.participant.participant_id,
      actor: OWNER,
    });

    await expectRefusal(
      seam.verifyParticipantToken(store, { round_id: FIXTURE_ROUND_ID, token: minted.token }),
      "collab_token_revoked"
    );
    // Row retained (append-only lifecycle), status flipped via appended event.
    const row = await store.getParticipant(minted.participant.participant_id);
    expect(row).not.toBeNull();
    expect(row?.status).toBe("revoked");
    expect(
      store.calls.filter((c) =>
        c.startsWith(`appendParticipantStatusEvent:${minted.participant.participant_id}:revoked`)
      )
    ).toHaveLength(1);
  });

  it("N-T3: a token is PER-ROUND — A's round-1 token refuses against round-2", async () => {
    const seam = await importSeam<ParticipantTokensSeam>("src/collab/participant-tokens.ts");
    const store = seededOpenRoundStore();
    store.state.rounds.set(
      "round-two-fixture",
      fixtureRound({ round_id: "round-two-fixture" })
    );

    const minted = await seam.mintParticipantToken(store, {
      round_id: FIXTURE_ROUND_ID,
      scenario_id: FIXTURE_SCENARIO_ID,
      display_name: "Carla-Fixture",
      actor: OWNER,
    });
    // Positive control on its own round…
    const ok = await seam.verifyParticipantToken(store, {
      round_id: FIXTURE_ROUND_ID,
      token: minted.token,
    });
    expect(ok.participant_id).toBe(minted.participant.participant_id);
    // …and refusal on the sibling round.
    await expectRefusal(
      seam.verifyParticipantToken(store, { round_id: "round-two-fixture", token: minted.token }),
      "collab_token_invalid"
    );
  });

  it("N-T4: a participant actor cannot CLOSE a round — collab_owner_only, and no round transition is appended", async () => {
    const rounds = await importSeam<RoundsServiceSeam>("src/collab/rounds-service.ts");
    const store = seededOpenRoundStore();

    await expectRefusal(
      rounds.closeRound(store, {
        round_id: FIXTURE_ROUND_ID,
        actor: { kind: "participant", participant_id: SENTINELS.A_PARTICIPANT_ID },
      }),
      "collab_owner_only"
    );
    expect(store.state.roundEvents).toEqual([]);
    expect((await store.getRound(FIXTURE_ROUND_ID))?.status).toBe("open");
  });

  it("N-T5: a participant actor cannot MINT a round — collab_owner_only, and no round is created", async () => {
    const rounds = await importSeam<RoundsServiceSeam>("src/collab/rounds-service.ts");
    const store = seededOpenRoundStore();
    const roundCountBefore = store.state.rounds.size;

    await expectRefusal(
      rounds.mintRound(store, {
        scenario_id: FIXTURE_SCENARIO_ID,
        actor: { kind: "participant", participant_id: SENTINELS.A_PARTICIPANT_ID },
        target_manifest: [fixtureTarget()],
        context_note: null,
      }),
      "collab_owner_only"
    );
    expect(store.state.rounds.size).toBe(roundCountBefore);
  });

  it("N-T6: tokens are stored HASHED — the raw token appears nowhere in persisted state, and the hash is not the token", async () => {
    const seam = await importSeam<ParticipantTokensSeam>("src/collab/participant-tokens.ts");
    const store = seededOpenRoundStore();

    const minted = await seam.mintParticipantToken(store, {
      round_id: FIXTURE_ROUND_ID,
      scenario_id: FIXTURE_SCENARIO_ID,
      display_name: "Carla-Fixture",
      actor: OWNER,
    });

    // Unguessable: 128-bit ⇒ at least 32 hex chars (or longer encodings).
    expect(minted.token.length).toBeGreaterThanOrEqual(32);
    // Positive control for the scan: the participant row IS in the state we scan.
    expect(jsonContains(store.state.participants.get(minted.participant.participant_id), minted.participant.participant_id)).toBe(true);
    // The raw token is in NO persisted row (participants, events, rounds, audit).
    expect(jsonContains([...store.state.participants.values()], minted.token)).toBe(false);
    expect(jsonContains(store.state.events, minted.token)).toBe(false);
    expect(jsonContains([...store.state.rounds.values()], minted.token)).toBe(false);
    // And the stored hash differs from the token.
    const row = store.state.participants.get(minted.participant.participant_id);
    expect(row?.token_hash).toBeTruthy();
    expect(row?.token_hash).not.toBe(minted.token);
  });
});
