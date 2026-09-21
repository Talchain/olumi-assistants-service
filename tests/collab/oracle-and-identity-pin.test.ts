/**
 * COLLAB U-S0 — the three holes the N-suite left open, found by independent
 * review. Each is a class the existing 27 specs pass over completely.
 *
 * ── B2: THE TWO 401 CASES THAT CAN ACTUALLY LEAK ──────────────────────────
 * `routes.token-boundary` covers missing, forged-on-a-real-round, and
 * well-formed-on-an-unknown-round. All three resolve to `collab_token_invalid`
 * at the SERVICE grain too — so they pass against a naive refusal-code→HTTP
 * mapper that simply echoes whatever code it was handed.
 *
 * The two cases where the service grain gives a DIFFERENT code are exactly the
 * two nobody tested: a REVOKED participant (`collab_token_revoked`) and a token
 * valid on another round (`collab_not_a_participant`). An echoing mapper emits
 * those verbatim and becomes a precise existence oracle: "this round exists and
 * you were on it" is a materially different fact from "no idea what you mean".
 *
 * ── B4: ATTRIBUTION IS PINNED ON WRITE AND UNPINNED ON READ ───────────────
 * `assembleOpenPacket(store, {round_id, participant_id})` takes the participant
 * as a plain argument. ONLY the route binds it to the verified token, and
 * nothing in the type system stops a future handler reading it from the query
 * string. One test closes the whole class.
 *
 * ⚠ TIMING, STATED RATHER THAN DEFENDED: a forged token costs two store lookups
 * and a revoked token costs two as well, but an unknown ROUND short-circuits
 * differently in the store. For a two-person PoC panel that residual timing
 * difference is accepted, not fixed.
 */
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import packetRoute from '../../src/routes/collab.v1.packet.js';
import { hashParticipantToken } from '../../src/collab/participant-tokens.js';
import {
  seededOpenRoundStore,
  fixtureParticipantA,
  fixtureRound,
  type FixtureCollabStore,
  FIXTURE_ROUND_ID,
  FIXTURE_SCENARIO_ID,
  SENTINELS,
  jsonContains,
} from './contracts.js';

const REAL_TOKEN = 'collab-nsuite-real-token-for-participant-a-000000';
const FORGED_TOKEN = 'f'.repeat(48);

async function appWith(store: FixtureCollabStore): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('collabStore', store);
  await app.register(packetRoute);
  await app.ready();
  return app;
}

/** A store whose participant A holds a REAL token we know the plaintext of. */
function storeWithRealToken(status: 'active' | 'revoked'): FixtureCollabStore {
  const store = seededOpenRoundStore();
  store.state.participants.set(
    SENTINELS.A_PARTICIPANT_ID,
    fixtureParticipantA({ token_hash: hashParticipantToken(REAL_TOKEN), status }),
  );
  return store;
}

describe('B2: the route grain is not an existence oracle, INCLUDING the two cases that differ at the service grain', () => {
  it('a REVOKED participant and a FORGED token are byte-identical at the boundary (status, code, message) — the service grain says collab_token_revoked, the boundary must not', async () => {
    const revokedStore = storeWithRealToken('revoked');
    const forgedStore = storeWithRealToken('active');

    const revokedApp = await appWith(revokedStore);
    const forgedApp = await appWith(forgedStore);
    try {
      const revoked = await revokedApp.inject({
        method: 'GET',
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}`,
        headers: { 'x-collab-participant-token': REAL_TOKEN },
      });
      const forged = await forgedApp.inject({
        method: 'GET',
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}`,
        headers: { 'x-collab-participant-token': FORGED_TOKEN },
      });

      // POSITIVE CONTROL: the real token on the ACTIVE store must SUCCEED, or
      // "everything 401s" would satisfy this test while the feature is broken.
      const ok = await forgedApp.inject({
        method: 'GET',
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}`,
        headers: { 'x-collab-participant-token': REAL_TOKEN },
      });
      expect(ok.statusCode).toBe(200);

      expect(revoked.statusCode).toBe(401);
      expect(forged.statusCode).toBe(401);
      const r = revoked.json() as Record<string, unknown>;
      const f = forged.json() as Record<string, unknown>;
      expect(r.code).toBe('collab_token_invalid');
      expect(r.code).toBe(f.code);
      expect(r.message).toBe(f.message);
      // The word 'revoked' must appear NOWHERE — that single word is the oracle.
      expect(JSON.stringify(r).toLowerCase()).not.toContain('revok');
      expect(jsonContains(r, SENTINELS.A_PARTICIPANT_ID)).toBe(false);
      expect(jsonContains(r, FIXTURE_ROUND_ID)).toBe(false);
    } finally {
      await revokedApp.close();
      await forgedApp.close();
    }
  });

  it('a token valid on ANOTHER round answers identically too — collab_not_a_participant never reaches the wire', async () => {
    const store = storeWithRealToken('active');
    // A second round exists; A's token belongs to the first.
    store.state.rounds.set('round-two-fixture', fixtureRound({ round_id: 'round-two-fixture' }));

    const app = await appWith(store);
    try {
      const crossRound = await app.inject({
        method: 'GET',
        url: '/collab/v1/packet/round-two-fixture',
        headers: { 'x-collab-participant-token': REAL_TOKEN },
      });
      const forged = await app.inject({
        method: 'GET',
        url: '/collab/v1/packet/round-two-fixture',
        headers: { 'x-collab-participant-token': FORGED_TOKEN },
      });

      expect(crossRound.statusCode).toBe(401);
      const c = crossRound.json() as Record<string, unknown>;
      const f = forged.json() as Record<string, unknown>;
      expect(c.code).toBe('collab_token_invalid');
      expect(c.code).toBe(f.code);
      expect(c.message).toBe(f.message);
      expect(JSON.stringify(c)).not.toContain('not_a_participant');
      // And it must not confirm that round two exists.
      expect(jsonContains(c, 'round-two-fixture')).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe('B4: the packet is bound to the TOKEN-resolved participant, never to a client-supplied identifier', () => {
  it("A's token plus a client-supplied B identifier still returns A's packet — query, body and header are all ignored", async () => {
    const store = storeWithRealToken('active');
    const app = await appWith(store);
    try {
      // Every channel a future handler might be tempted to read from, at once.
      const res = await app.inject({
        method: 'GET',
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}?participant_id=${SENTINELS.B_PARTICIPANT_ID}&self=${SENTINELS.B_PARTICIPANT_ID}`,
        headers: {
          'x-collab-participant-token': REAL_TOKEN,
          'x-participant-id': SENTINELS.B_PARTICIPANT_ID,
          'x-user-id': SENTINELS.OWNER_USER_ID,
        },
      });

      expect(res.statusCode).toBe(200);
      const packet = res.json() as { self: { participant_id: string } };
      // Bound by IDENTITY to the token holder, not to anything the caller said.
      expect(packet.self.participant_id).toBe(SENTINELS.A_PARTICIPANT_ID);
      // And B's contribution is still absent, which is the harm the substitution
      // would have caused: A asking for B's packet and getting B's answers.
      expect(jsonContains(packet, SENTINELS.B_PARTICIPANT_ID)).toBe(false);
      expect(jsonContains(packet, SENTINELS.B_VALUE_STR)).toBe(false);
      expect(jsonContains(packet, SENTINELS.B_EXPRESSION)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('the same substitution attempt on the EVENT POST is attributed to A, not to the supplied B', async () => {
    const store = storeWithRealToken('active');
    const app = await appWith(store);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}/events?participant_id=${SENTINELS.B_PARTICIPANT_ID}`,
        headers: { 'x-collab-participant-token': REAL_TOKEN },
        payload: {
          kind: 'belief_submitted',
          target: { kind: 'factor', id: 'factor-churn-risk' },
          belief: { value: 0.42, expression_raw: 'about two in five', confidence: 0.6 },
        },
      });

      expect(res.statusCode).toBe(201);
      const receipt = res.json() as { authored_by: string };
      expect(receipt.authored_by).toBe(SENTINELS.A_PARTICIPANT_ID);
      expect(receipt.authored_by).not.toBe(SENTINELS.B_PARTICIPANT_ID);
      expect(receipt.authored_by).not.toBe(SENTINELS.OWNER_USER_ID);

      // And what PERSISTED agrees — not merely what was returned.
      const persisted = store.state.events.filter(
        (e) => e.belief?.expression_raw === 'about two in five',
      );
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.participant_id).toBe(SENTINELS.A_PARTICIPANT_ID);
      expect(persisted[0]?.provenance.authored_by).toBe(SENTINELS.A_PARTICIPANT_ID);
    } finally {
      await app.close();
    }
  });
});

describe('scope: clarification_requested is refused in this slice rather than silently accepted', () => {
  it('a clarification_requested event is refused 422 — an accepted-but-unsurfaced kind would be a row nobody ever sees', async () => {
    const store = storeWithRealToken('active');
    const app = await appWith(store);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}/events`,
        headers: { 'x-collab-participant-token': REAL_TOKEN },
        payload: {
          kind: 'clarification_requested',
          target: { kind: 'factor', id: 'factor-churn-risk' },
          belief: null,
        },
      });
      expect(res.statusCode).toBe(422);
      expect(store.state.events.filter((e) => e.kind === 'clarification_requested')).toEqual([]);

      // POSITIVE CONTROL: `declined` — the kind this slice DOES support, and
      // F-6's mechanism — is accepted through the identical path. Without this,
      // "422 on a belief-less event" would satisfy the assertion above.
      const declined = await app.inject({
        method: 'POST',
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}/events`,
        headers: { 'x-collab-participant-token': REAL_TOKEN },
        payload: {
          kind: 'declined',
          target: { kind: 'factor', id: 'factor-churn-risk' },
          belief: null,
        },
      });
      expect(declined.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });
});

describe('the scenario id never reaches a participant surface', () => {
  it('the open packet carries no scenario_id — a participant holds a round capability, not a scenario one', async () => {
    const store = storeWithRealToken('active');
    const app = await appWith(store);
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}`,
        headers: { 'x-collab-participant-token': REAL_TOKEN },
      });
      expect(res.statusCode).toBe(200);
      // POSITIVE CONTROL: the scenario id IS in the store being read from, so
      // this absence is about the projection, not about an empty fixture.
      expect(jsonContains([...store.state.rounds.values()], FIXTURE_SCENARIO_ID)).toBe(true);
      expect(jsonContains(res.json(), FIXTURE_SCENARIO_ID)).toBe(false);
    } finally {
      await app.close();
    }
  });
});
