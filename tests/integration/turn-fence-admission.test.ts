/**
 * V5 TURN FENCE — CLAIM AFTER ADMISSION (ROADMAP 2.174 fix b; Codex round-2
 * P1, adjudicated real).
 *
 * THE DEFECT (proven RED here at `a1fb06bd`): the fence preHandler claimed a
 * generation from the RAW request body BEFORE auth/validation. A request that
 * B1 was about to 422 still advanced the scenario's generation — so a
 * malformed (or unauthorized, or wrong-tenant) request could SUPERSEDE a
 * legitimate in-flight turn: its ~50 s draft would evaluate `superseded` at
 * the commit and be refused, killed by a request the service itself rejected.
 * Anyone who can hit the ingress with a scenario UUID and garbage could fence
 * out real work.
 *
 * THE FIX: the preHandler binds a PENDING fence slot (no DB write); the claim
 * runs at ADMISSION — immediately after `runPreFlight` succeeds (auth 401 +
 * B1 422 + scenario upsert all precede it, one call site in route-v2). A
 * rejected request therefore never touches the fence: no row, no generation,
 * no supersession pressure.
 *
 * The two properties pinned here, SEPARATELY (a single "rejected requests
 * don't claim" test would stay green if the fence stopped claiming entirely —
 * which would unfence every write via the no-handle branch):
 *   1. a 422-bound request is FENCE-NEUTRAL (RED before the fix: it claimed);
 *   2. an ADMITTED request still claims exactly once, with the same identity
 *      the Stop tombstone uses (the P0 protection, unweakened).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const SCENARIO = 'c0000000-0000-4000-8000-000000000001';

const admissionAdapter = {
  name: 'admission-mock',
  chat: async () => ({
    content: '',
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'admission-mock',
    latencyMs: 0,
  }),
  chatWithTools: async () => ({
    content: [{ type: 'text', text: 'admission test narrate output' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'admission-mock',
    latencyMs: 0,
  }),
};

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => admissionAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: admissionAdapter,
    resolution: {
      task,
      resolved_model: 'admission-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// The spy the whole suite pivots on: every fence claim lands here.
const claimTurnFence = vi.fn(async (scenarioId: string, turnId: string) => ({
  scenarioId,
  turnId,
  generation: 7,
}));

vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () => createMockSessionStore({ claimTurnFence }),
    resetSessionStoreForTests: () => {},
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');

function validTurn(turnId: string) {
  return {
    kind: 'message' as const,
    turn_id: turnId,
    scenario_id: SCENARIO,
    message: 'admission test message',
    turn_class: 'frame' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
  };
}

describe('POST /orchestrate/v2/turn — the fence claims ADMITTED requests only', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    claimTurnFence.mockClear();
  });

  // ── THE PIN (proven RED at a1fb06bd: the claim fired before B1) ──────────
  it('a 422-bound request is FENCE-NEUTRAL: no claim, no generation advanced', async () => {
    // Carries a perfectly usable (scenario_id, turn_id) pair — the exact
    // shape the old prehandler claimed from — but B1 rejects it (`message`
    // is required for kind:"message").
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: 'c1111111-1111-4111-8111-111111111101',
        scenario_id: SCENARIO,
        turn_class: 'frame',
        stage: 'analyse',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(claimTurnFence).not.toHaveBeenCalled();
  });

  it('a request whose body fails even the extension parse is fence-neutral too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        ...validTurn('c1111111-1111-4111-8111-111111111102'),
        graph_state: 'not-an-object', // extension parse 422s before B1
      },
    });
    expect(res.statusCode).toBe(422);
    expect(claimTurnFence).not.toHaveBeenCalled();
  });

  // ── THE CONTROL (the P0 protection must not weaken) ──────────────────────
  it('an ADMITTED request claims exactly once, with the ingress identity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: validTurn('c1111111-1111-4111-8111-111111111103'),
    });
    expect(res.statusCode).toBe(200);
    expect(claimTurnFence).toHaveBeenCalledTimes(1);
    expect(claimTurnFence).toHaveBeenCalledWith(SCENARIO, 'c1111111-1111-4111-8111-111111111103');
  });

  it('two admitted turns claim independently (no slot reuse across requests)', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: validTurn('c1111111-1111-4111-8111-111111111104'),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: validTurn('c1111111-1111-4111-8111-111111111105'),
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(claimTurnFence).toHaveBeenCalledTimes(2);
    expect(claimTurnFence).toHaveBeenNthCalledWith(1, SCENARIO, 'c1111111-1111-4111-8111-111111111104');
    expect(claimTurnFence).toHaveBeenNthCalledWith(2, SCENARIO, 'c1111111-1111-4111-8111-111111111105');
  });
});
