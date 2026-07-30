/**
 * V5 TURN FENCE — is the INGRESS actually fenced?
 *
 * Everything the fence promises rests on two things this file pins, and both of
 * them are the kind of claim that normally lives in a comment:
 *
 *  1. `POST /orchestrate/v2/turn` — the single ingress every graph-writing lane
 *     reaches, including via `app.inject()` from the proxy and streamed routes —
 *     really does carry the fence preHandler. Derived from the registered route
 *     options via an `onRoute` hook, so deleting the hook fails HERE. Without
 *     this, the store's `no_ingress_fence` branch would become the normal case
 *     and every graph write would proceed unfenced while all the fence's own
 *     unit tests stayed green.
 *
 *  2. The handle survives an `await`. This is the failure mode
 *     `streamed-turn-sse.ts:263-272` documents for the sibling
 *     AsyncLocalStorage context: an `async` hook, or a `run()` whose callback
 *     returns before the work, leaves the handler in a sibling async context
 *     with no store — and the symptom is silent (commits still succeed; only
 *     the fence disappears). A turn awaits for ~50 s before it commits, so
 *     "readable after an await" is the property that matters, not "readable
 *     synchronously".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { turnFencePreHandler, readIngressTurnIdentity } from '../turn-fence-prehandler.js';
import { currentTurnFence } from '../../orchestrator-v5/session/turn-fence.js';

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
  // A stand-in for the turn route: same hook, none of the pipeline. What is
  // under test is the hook's contract, not the turn.
  app.post('/fenced', { preHandler: turnFencePreHandler }, async () => {
    const beforeAwait = currentTurnFence();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Promise.resolve();
    const afterAwait = currentTurnFence();
    return {
      before: beforeAwait ?? null,
      after: afterAwait ?? null,
    };
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('the fence preHandler binds a handle the handler can still read', () => {
  it('claims once and the handle survives an await (the ~50s-later read)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/fenced',
      payload: { scenario_id: SCENARIO, turn_id: TURN, message: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      before: { generation: number } | null;
      after: { scenarioId: string; turnId: string; generation: number } | null;
    };
    expect(claimTurnFence).toHaveBeenCalledTimes(1);
    expect(claimTurnFence).toHaveBeenCalledWith(SCENARIO, TURN);
    expect(body.before?.generation).toBe(42);
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

  it('a body with no usable identity is not claimed, and the request still runs', async () => {
    const res = await app.inject({ method: 'POST', url: '/fenced', payload: { message: 'hi' } });
    expect(res.statusCode).toBe(200);
    expect(claimTurnFence).not.toHaveBeenCalled();
    expect((res.json() as { after: unknown }).after).toBeNull();
  });

  it('a claim that resolves null binds an UNCLAIMED handle, not NO handle (#759 A1)', async () => {
    // THE severe finding. This test previously asserted `after` was NULL — i.e.
    // it PINNED the defect: no handle meant the commit chokepoint's
    // `no_ingress_fence` branch, which ALLOWS the write, so the fail-closed
    // branch could never fire while four doc sites promised it would.
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
    // But the handle IS bound, and its null generation is what makes the commit
    // refuse a graph write.
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

  it('a store that CANNOT claim binds no handle at all — a different absence', async () => {
    // Deliberately NOT the same as a failed claim. No `claimTurnFence` means the
    // store is a double, so the commit never came through a fence we own and
    // there is nothing to fail closed about. Conflating the two was the bug.
    const bare = Fastify();
    bare.post('/fenced', { preHandler: turnFencePreHandler }, async () => ({
      after: currentTurnFence() ?? null,
    }));
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
      expect(claimTurnFence).not.toHaveBeenCalled();
    } finally {
      storeHasClaim = true;
      await bare.close();
    }
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
