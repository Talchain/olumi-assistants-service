/**
 * V5 TURN FENCE — is the INGRESS actually fenced?
 *
 * Everything the fence promises rests on the things this file pins, and all of
 * them are the kind of claim that normally lives in a comment:
 *
 *  1. `POST /orchestrate/v2/turn` — the single ingress every graph-writing lane
 *     reaches, including via `app.inject()` from the proxy and streamed routes —
 *     really does carry the fence preHandler (pinned by
 *     turn-fence-route-registration.test.ts). Without it, the store's
 *     `no_ingress_fence` branch would become the normal case and every graph
 *     write would proceed unfenced while all the fence's own unit tests stayed
 *     green.
 *
 *  2. The slot survives an `await`, and the handle ADMISSION sets on it is
 *     visible afterwards. This is the failure mode `streamed-turn-sse.ts:263-272`
 *     documents for the sibling AsyncLocalStorage context: an `async` hook, or a
 *     `run()` whose callback returns before the work, leaves the handler in a
 *     sibling async context with no store — and the symptom is silent (commits
 *     still succeed; only the fence disappears). A turn awaits for ~50 s before
 *     it commits, so "readable after an await" is the property that matters,
 *     not "readable synchronously".
 *
 *  3. 2.174 fix b — the hook itself performs NO claim. The claim belongs to
 *     `admitCurrentTurnFence`, which route-v2 calls only after `runPreFlight`
 *     succeeds; the route-level pins for "rejected requests are fence-neutral"
 *     live in tests/integration/turn-fence-admission.test.ts. Here we pin the
 *     admission mechanics: idempotence, the unclaimed-handle fail-closed
 *     binding on a null/throwing claim (#759, unchanged), and the store-double
 *     absence semantics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  turnFencePreHandler,
  admitCurrentTurnFence,
  readIngressTurnIdentity,
} from '../turn-fence-prehandler.js';
import {
  currentTurnFence,
  currentTurnFenceSlot,
} from '../../orchestrator-v5/session/turn-fence.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const TURN = 'turn-ingress-fence';

const claimTurnFence = vi.fn(async (scenarioId: string, turnId: string) => ({
  scenarioId,
  turnId,
  generation: 42,
}));

let storeHasClaim = true;
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => (storeHasClaim ? { claimTurnFence } : {}),
}));

let app: FastifyInstance;

beforeEach(async () => {
  claimTurnFence.mockClear();
  app = Fastify();
  // A stand-in for the turn route: same hook, same admission call, none of
  // the pipeline. What is under test is the hook + admission contract, not
  // the turn. The admission sits where route-v2 puts it — inside the
  // handler, after the point standing for "runPreFlight succeeded".
  app.post('/fenced', { preHandler: turnFencePreHandler }, async () => {
    const beforeAdmission = currentTurnFence();
    await admitCurrentTurnFence();
    const afterAdmission = currentTurnFence();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Promise.resolve();
    const afterAwait = currentTurnFence();
    return {
      beforeAdmission: beforeAdmission ?? null,
      afterAdmission: afterAdmission ?? null,
      after: afterAwait ?? null,
    };
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('the fence preHandler binds a slot the admitted handle rides on', () => {
  it('the hook claims NOTHING; admission claims once; the handle survives an await (the ~50s-later read)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fenced',
      payload: { scenario_id: SCENARIO, turn_id: TURN, message: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      beforeAdmission: unknown;
      afterAdmission: { generation: number } | null;
      after: { scenarioId: string; turnId: string; generation: number } | null;
    };
    // 2.174 fix b: before admission there is NO handle — and therefore no
    // claim, no generation, no fence row for a request that never passes
    // the gate.
    expect(body.beforeAdmission).toBeNull();
    expect(claimTurnFence).toHaveBeenCalledTimes(1);
    expect(claimTurnFence).toHaveBeenCalledWith(SCENARIO, TURN);
    expect(body.afterAdmission?.generation).toBe(42);
    // THE assertion: still readable after awaits.
    expect(body.after).toEqual({ scenarioId: SCENARIO, turnId: TURN, generation: 42 });
  });

  it('does not leak one request’s handle into another', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/fenced',
      payload: { scenario_id: SCENARIO, turn_id: 'turn-one' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/fenced',
      payload: { scenario_id: SCENARIO, turn_id: 'turn-two' },
    });
    expect((first.json() as { after: { turnId: string } }).after.turnId).toBe('turn-one');
    expect((second.json() as { after: { turnId: string } }).after.turnId).toBe('turn-two');
  });

  it('a body with no usable identity binds no slot, and the request still runs', async () => {
    const res = await app.inject({ method: 'POST', url: '/fenced', payload: { message: 'hi' } });
    expect(res.statusCode).toBe(200);
    expect(claimTurnFence).not.toHaveBeenCalled();
    expect((res.json() as { after: unknown }).after).toBeNull();
  });

  it('a claim that resolves null binds an UNCLAIMED handle, not NO handle (#759 A1)', async () => {
    // THE severe finding, preserved across the admission move. No handle
    // would mean the commit chokepoint's `no_ingress_fence` branch, which
    // ALLOWS the write; the unclaimed handle is what makes it refuse.
    claimTurnFence.mockResolvedValueOnce(null as never);
    const res = await app.inject({
      method: 'POST',
      url: '/fenced',
      payload: { scenario_id: SCENARIO, turn_id: TURN },
    });
    // Still a 200: a fence outage must not become a turn outage.
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      after: { scenarioId: string; turnId: string; generation: number | null } | null;
    };
    expect(body.after).toEqual({ scenarioId: SCENARIO, turnId: TURN, generation: null });
  });

  it('a claim that THROWS binds an unclaimed handle too', async () => {
    claimTurnFence.mockRejectedValueOnce(new Error('supabase down'));
    const res = await app.inject({
      method: 'POST',
      url: '/fenced',
      payload: { scenario_id: SCENARIO, turn_id: TURN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { after: { generation: number | null } | null };
    expect(body.after?.generation).toBeNull();
  });

  it('a store that CANNOT claim leaves the slot PENDING — no handle, no claim', async () => {
    // The store is a double (`claimTurnFence` absent). Admission is a no-op:
    // nothing to claim with, no handle bound. In production the claiming
    // store and the enforcing store are the same object, so a double that
    // lacks the claim never reaches the real enforcement either.
    const bare = Fastify();
    bare.post('/fenced', { preHandler: turnFencePreHandler }, async () => {
      await admitCurrentTurnFence();
      return {
        after: currentTurnFence() ?? null,
        slotBound: currentTurnFenceSlot() !== undefined,
      };
    });
    await bare.ready();
    storeHasClaim = false;
    try {
      const res = await bare.inject({
        method: 'POST',
        url: '/fenced',
        payload: { scenario_id: SCENARIO, turn_id: TURN },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { after: unknown }).after).toBeNull();
      expect((res.json() as { slotBound: boolean }).slotBound).toBe(true);
      expect(claimTurnFence).not.toHaveBeenCalled();
    } finally {
      storeHasClaim = true;
      await bare.close();
    }
  });

  it('admission is idempotent: a second call never double-claims', async () => {
    const bare = Fastify();
    bare.post('/fenced', { preHandler: turnFencePreHandler }, async () => {
      await admitCurrentTurnFence();
      await admitCurrentTurnFence();
      return { after: currentTurnFence() ?? null };
    });
    await bare.ready();
    try {
      const res = await bare.inject({
        method: 'POST',
        url: '/fenced',
        payload: { scenario_id: SCENARIO, turn_id: TURN },
      });
      expect(res.statusCode).toBe(200);
      expect(claimTurnFence).toHaveBeenCalledTimes(1);
      expect((res.json() as { after: { generation: number } }).after.generation).toBe(42);
    } finally {
      await bare.close();
    }
  });

  it('admission outside any fenced request is a safe no-op', async () => {
    await expect(admitCurrentTurnFence()).resolves.toBeUndefined();
    expect(claimTurnFence).not.toHaveBeenCalled();
  });
});

describe('readIngressTurnIdentity', () => {
  it('requires both ids as non-empty strings', () => {
    expect(readIngressTurnIdentity({ scenario_id: 's', turn_id: 't' })).toEqual({
      scenarioId: 's',
      turnId: 't',
    });
    expect(readIngressTurnIdentity({ scenario_id: 's' })).toBeNull();
    expect(readIngressTurnIdentity({ scenario_id: '', turn_id: 't' })).toBeNull();
    expect(readIngressTurnIdentity({ scenario_id: 's', turn_id: 7 })).toBeNull();
    expect(readIngressTurnIdentity(null)).toBeNull();
    expect(readIngressTurnIdentity('not an object')).toBeNull();
  });
});
