/**
 * V5 Group 3 P0 follow-up — cross-tenant enforcement.
 *
 * Proves end-to-end that when the `v5CrossTenantEnforcement` feature
 * flag is ON, V5 pre-flight uses the ownership-checked code path
 * (checkScenarioOwnership) and rejects foreign scenarios with 422 +
 * INGRESS_CONTRACT_VIOLATION + reason=scenario_not_found (uniform reason
 * so the server does not leak existence to a non-owner).
 *
 * Also proves that commit-time writes carry `caller_user_id` through to
 * the store's append (which switches to append_turn_atomic_v2 when the
 * field is present). The test uses a mock store that captures the write
 * payload; it does NOT exercise the real RPC — the Supabase-side
 * ownership enforcement is covered by the migration SQL itself and will
 * be validated in staging once Paul applies it.
 *
 * See supabase/migrations/20260422000000_v5_cross_tenant_enforcement.sql
 * for the SQL contract this test encodes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../src/utils/telemetry.js';
import { BoundaryErrorSchema } from '@talchain/schemas/boundary';

// Valid UUIDs — the auth hook validates the shape of X-Olumi-User-Id.
const CALLER_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCENARIO_OWNED = 'e0000000-0000-4000-8000-000000000001';
const SCENARIO_FOREIGN = 'e0000000-0000-4000-8000-000000000002';
const SCENARIO_MISSING = 'e0000000-0000-4000-8000-000000000003';

// Mutable store state that drives the mock's ownership answers.
interface StoreState {
  readonly ownershipMap: Map<string, string>; // scenario_id -> owner user_id
  appendCalls: Array<Record<string, unknown>>;
}
const storeState: StoreState = {
  ownershipMap: new Map([
    [SCENARIO_OWNED, CALLER_USER],
    [SCENARIO_FOREIGN, FOREIGN_USER],
    // SCENARIO_MISSING deliberately absent
  ]),
  appendCalls: [],
};

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      storeState.appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    // Not used in ownership mode.
    checkScenarioExists: async () => true,
    // The core of the enforced path: both missing and foreign-owner
    // scenarios return false. The route surfaces them with the same
    // `reason: 'scenario_not_found'` (leak guard).
    checkScenarioOwnership: async (scenarioId: string, callerUserId: string) => {
      const owner = storeState.ownershipMap.get(scenarioId);
      return owner !== undefined && owner === callerUserId;
    },
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Permissive LLM adapter so the happy path for an owned scenario reaches commit.
const ctMockAdapter = {
  name: 'cross-tenant-mock',
  chat: async () => ({
    content: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'cross-tenant-mock',
    latencyMs: 0,
  }),
  chatWithTools: async () => ({
    content: [{ type: 'text', text: 'ownership-path happy narrate' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'cross-tenant-mock',
    latencyMs: 0,
  }),
};
vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ctMockAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: ctMockAdapter,
    resolution: {
      task,
      resolved_model: 'cross-tenant-mock',
      resolution_source: 'task_default' as const,
      provider: 'openai' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// Config mock flips the two flags we need (V5 route registration +
// cross-tenant enforcement).
let v5Enabled = true;
let xtEnforcement = true;
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return v5Enabled;
              if (featProp === 'v5CrossTenantEnforcement') return xtEnforcement;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');

function buildRequest(scenarioId: string) {
  return {
    turn_id: 'aaaaaaaa-1111-4111-8111-111111111111',
    scenario_id: scenarioId,
    message: 'cross-tenant test message',
    turn_class: 'frame' as const,
    stage: 'frame' as const,
  };
}

describe('POST /orchestrate/v2/turn — Group 3 P0 follow-up cross-tenant enforcement', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    v5Enabled = true;
    xtEnforcement = true;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    setTestSink(() => {});
  });

  afterAll(async () => {
    setTestSink(null);
    await app.close();
  });

  beforeEach(() => {
    storeState.appendCalls.length = 0;
  });

  it('owned scenario: 200 + append_turn_atomic_v2 write includes caller_user_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      headers: { 'x-olumi-user-id': CALLER_USER },
      payload: buildRequest(SCENARIO_OWNED),
    });
    expect(res.statusCode).toBe(200);
    expect(storeState.appendCalls).toHaveLength(1);
    // Key ownership assertion: the caller's user_id is threaded all the
    // way through TurnExecutor → commit.ts → SessionStore.append. The
    // store-level mock then picks append_turn_atomic_v2 based on its
    // presence.
    expect(storeState.appendCalls[0]!.caller_user_id).toBe(CALLER_USER);
  });

  it('foreign scenario: 422 + scenario_not_found (no leak of foreign ownership)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      headers: { 'x-olumi-user-id': CALLER_USER },
      payload: buildRequest(SCENARIO_FOREIGN),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    const parsed = BoundaryErrorSchema.parse(body);
    expect(parsed.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(parsed.validator).toBe('scenario_preflight');
    // Leak guard: the response must NOT reveal that the scenario exists
    // under a different owner. Both missing and foreign surface with the
    // same `reason: 'scenario_not_found'`.
    expect(parsed.details).toMatchObject({
      reason: 'scenario_not_found',
      scenario_id: SCENARIO_FOREIGN,
    });
    expect(Object.keys(parsed.details).sort()).toEqual(['reason', 'scenario_id']);
    // TurnExecutor must not have run.
    expect(storeState.appendCalls).toHaveLength(0);
  });

  it('missing scenario (in ownership mode): 422 + same leak-proof shape as foreign', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      headers: { 'x-olumi-user-id': CALLER_USER },
      payload: buildRequest(SCENARIO_MISSING),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.details).toMatchObject({
      reason: 'scenario_not_found',
      scenario_id: SCENARIO_MISSING,
    });
  });

  it('enforcement flag ON but no X-Olumi-User-Id header: falls back to legacy existence check', async () => {
    // Auth header missing — the scaffold returns undefined, so the route
    // does NOT enter ownership mode. The turn proceeds via the legacy
    // checkScenarioExists path. This preserves staged rollout: a CEE
    // deployed with the flag on but without the UI-side auth header
    // does not break existing traffic.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_OWNED),
    });
    expect(res.statusCode).toBe(200);
    // Legacy path: commit does NOT thread caller_user_id.
    expect(storeState.appendCalls[0]!.caller_user_id).toBeUndefined();
  });

  it('X-Olumi-User-Id with a non-UUID value is ignored (auth hook shape guard)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      headers: { 'x-olumi-user-id': 'not-a-uuid' },
      payload: buildRequest(SCENARIO_OWNED),
    });
    // Shape guard rejects the header, callerUserId stays undefined, the
    // route falls back to the legacy path. Happy path because scenario
    // exists.
    expect(res.statusCode).toBe(200);
    expect(storeState.appendCalls[0]!.caller_user_id).toBeUndefined();
  });
});
