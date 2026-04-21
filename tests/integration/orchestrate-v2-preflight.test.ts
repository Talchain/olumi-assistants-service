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
    [SCENARIO_FOREIGN, false], // Simulates "not visible to this caller".
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
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {
    constructor(msg: string) { super(msg); this.name = 'SessionReadError'; }
  },
}));

// The LLM adapter mock must be permissive so the happy-path test doesn't
// bail out inside TurnExecutor after pre-flight passes.
vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
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

  it('rejects a cross-tenant / foreign scenario the same way, leaking no data', async () => {
    // The service-role client can read across tenants, so `checkScenarioExists`
    // would return TRUE for any existing row. A future RLS-scoped check would
    // return FALSE for a row owned by a different user. We simulate the
    // RLS-aware outcome: the scenario is absent from the caller's view.
    // The response body must not contain any scenario details beyond the id
    // the caller already supplied.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(SCENARIO_FOREIGN),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    BoundaryErrorSchema.parse(body);
    expect(body.error).toBe('INGRESS_CONTRACT_VIOLATION');
    expect(body.details.reason).toBe('scenario_not_found');
    expect(body.details.scenario_id).toBe(SCENARIO_FOREIGN);
    // Leak guard: no extra keys beyond the documented shape.
    expect(Object.keys(body.details).sort()).toEqual(['reason', 'scenario_id']);
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
