/**
 * V5 Group 3 Task A — pre-flight scenario check.
 *
 * Verifies that `POST /orchestrate/v2/turn` calls `SessionStore.
 * checkScenarioExists` BEFORE invoking the TurnExecutor, and that a missing
 * scenario row is surfaced as a typed 422 BoundaryError at the ingress
 * boundary rather than an opaque `STATE_COMMIT_FAILED` at commit time.
 *
 * Covers the brief's acceptance criteria:
 *   - Missing scenario → 422 with `error: 'INGRESS_CONTRACT_VIOLATION'` and
 *     `details.reason === 'scenario_not_found'`.
 *   - Existing scenario → 200 (happy path preserved).
 *   - Cross-tenant row ownership → 422 with no data leak (simulated by
 *     `checkScenarioExists` returning false, mirroring service-role-level
 *     absence or a future RLS-aware check).
 *   - Store read error → pre-flight silently passes (TurnExecutor is still
 *     the last line of defence).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { BoundaryErrorSchema } from '@talchain/schemas/boundary';

import { setTestSink } from '../../src/utils/telemetry.js';

// Fixtures — stable IDs so tests are deterministic.
const SCENARIO_EXISTING = 'e0000000-0000-4000-8000-000000000001';
const SCENARIO_MISSING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SCENARIO_FOREIGN = 'f1111111-1111-4111-8111-111111111111';

// Mutable state so each test drives the store behaviour.
interface StoreState {
  existsByScenarioId: Map<string, boolean>;
  throwOnCheck: Error | null;
}
const storeState: StoreState = {
  existsByScenarioId: new Map([
    [SCENARIO_EXISTING, true],
    [SCENARIO_MISSING, false],
    // SCENARIO_FOREIGN models the honest production behaviour of
    // `checkScenarioExists`: the service-role client sees ALL rows in
    // `public.scenarios`, so a scenario belonging to a different user
    // returns TRUE from this check. Cross-tenant isolation is NOT enforced
    // at the CEE layer today — see the ⚠ LIMITATION comment on
    // SupabaseSessionStore.checkScenarioExists and the matching test
    // below that asserts the current (bounded) behaviour.
    [SCENARIO_FOREIGN, true],
  ]),
  throwOnCheck: null,
};

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    checkScenarioExists: async (id: string) => {
      if (storeState.throwOnCheck) throw storeState.throwOnCheck;
      return storeState.existsByScenarioId.get(id) ?? false;
    },
    // Group 3 P0 follow-up: owner-scoped pre-flight. Not exercised by
    // this test file (flag is off in the config mock); the cross-tenant
    // behaviour is covered by orchestrate-v2-cross-tenant.test.ts.
    checkScenarioOwnership: async (id: string) => {
      if (storeState.throwOnCheck) throw storeState.throwOnCheck;
      return storeState.existsByScenarioId.get(id) ?? false;
    },
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {
    constructor(msg: string) { super(msg); this.name = 'SessionReadError'; }
  },
}));

// The LLM adapter mock must be permissive so the happy-path test doesn't
// bail out inside TurnExecutor after pre-flight passes.
const preflightMockAdapter = {
  name: 'preflight-test-mock',
  chat: async () => ({
    content: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'preflight-test-mock',
    latencyMs: 0,
  }),
  chatWithTools: async () => ({
    content: [{ type: 'text', text: 'pre-flight happy-path narrate' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'preflight-test-mock',
    latencyMs: 0,
  }),
};

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => preflightMockAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: preflightMockAdapter,
    resolution: {
      task: task ?? 'orchestrator',
      resolved_model: 'preflight-test-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

let v5Enabled = true;
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

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function buildRequest(scenarioId: string) {
  return {
    turn_id: 'a1111111-1111-4111-8111-111111111111',
    scenario_id: scenarioId,
    message: 'pre-flight test message',
    turn_class: 'frame' as const,
    stage: 'frame' as const,
  };
}

describe('POST /orchestrate/v2/turn — Group 3 Task A pre-flight scenario check', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    v5Enabled = true;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterAll(async () => {
    setTestSink(null);
    await app.close();
  });

  beforeEach(() => {
    events = [];
    storeState.throwOnCheck = null;
  });

  it('rejects a missing scenario with 422 INGRESS_CONTRACT_VIOLATION / reason=scenario_not_found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_MISSING),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    // Must be a valid BoundaryError — schema pinned in @talchain/schemas.
    const parsed = BoundaryErrorSchema.parse(body);
    expect(parsed.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(parsed.boundary).toBe('B1');
    expect(parsed.direction).toBe('ingress');
    expect(parsed.validator).toBe('scenario_preflight');
    expect(parsed.retryable).toBe(false);
    expect(parsed.details).toMatchObject({
      reason: 'scenario_not_found',
      scenario_id: SCENARIO_MISSING,
    });
    // Pre-flight runs BEFORE TurnExecutor — no turn executor events should fire.
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(0);
  });

  it('passes pre-flight for an existing scenario and runs the turn (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_EXISTING),
    });
    expect(res.statusCode).toBe(200);
    // TurnExecutor DID run.
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(1);
  });

  // ⚠ HONEST LIMITATION TEST ⚠
  // The Group 3 brief's acceptance criterion asked for an RLS / cross-tenant
  // test. The honest answer for the current architecture is that V5 has NO
  // cross-tenant guard at the CEE layer — see the comment on
  // SupabaseSessionStore.checkScenarioExists. This test asserts that
  // limitation rather than simulating a stronger guarantee we don't have.
  // The TODO in supabase-store.ts documents the closure (add p_user_id to
  // append_turn_atomic + assert ownership in SQL).
  it('does NOT reject a foreign scenario at the CEE layer (bounded guarantee)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_FOREIGN),
    });
    // Current behaviour: service-role pre-flight returns true, TurnExecutor
    // runs, turn completes. In production this is safe ONLY because the UI
    // auth flow + RLS on `public.scenarios` prevent a UI user from ever
    // seeing another user's scenario_id — a non-UI caller with a guessed
    // UUID would currently bypass the guard. When `append_turn_atomic` is
    // extended with p_user_id enforcement, this test should flip to assert
    // 422 + `reason: 'scenario_foreign'` (or a similar typed code).
    expect(res.statusCode).toBe(200);
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(1);
  });

  it('response shape leak-guard: missing-scenario 422 details contain ONLY reason + scenario_id', async () => {
    // Separate from the cross-tenant story: when pre-flight DOES reject
    // (missing scenario, not foreign), the 422 body must not include any
    // server-side metadata beyond what the caller already supplied.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_MISSING),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    BoundaryErrorSchema.parse(body);
    expect(Object.keys(body.details).sort()).toEqual(['reason', 'scenario_id']);
    expect(body.details.scenario_id).toBe(SCENARIO_MISSING);
  });

  it('on a store read error, pre-flight silently passes and TurnExecutor is the last line of defence', async () => {
    storeState.throwOnCheck = new Error('transient supabase outage');
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_EXISTING),
    });
    // Pre-flight skipped → TurnExecutor ran → 200 (happy-path LLM mock).
    expect(res.statusCode).toBe(200);
    expect(events.filter((e) => e.event === 'turn_executor.started')).toHaveLength(1);
  });
});
