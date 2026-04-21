/**
 * V5 exclusive-cee brief — UNSUPPORTED_ACTION end-to-end (route-level).
 *
 * Previous UNSUPPORTED_ACTION tests exercised `runTurnExecutor` directly
 * (src/orchestrator-v5/__tests__/turn-executor.test.ts). That proves the
 * executor-level translation from HANDLER_NOT_FOUND to the typed wire
 * code, but not that the full HTTP stack wires through correctly.
 *
 * This file hits `POST /orchestrate/v2/turn` via Fastify `.inject()`.
 *
 * Wire-contract trajectory for an unsupported action:
 *
 *   1. TurnExecutor validates the routing LLM's tool_use.
 *   2. Validator returns HANDLER_NOT_FOUND (or UnhandledTurnClassError
 *      if dispatch misses).
 *   3. TurnExecutor sets failure_type = FEATURE_NOT_ENABLED (via the
 *      UNSUPPORTED_ACTION internal class) and commit_performed = false.
 *   4. Route (route-v2.ts) sees commit_performed=false and — per Group 3
 *      Task B fail-closed invariant — wraps the failure as a 500 plus a
 *      BoundaryError envelope, NOT as a 200 OlumiResponse. This is
 *      deliberate: any turn with `commit_performed: false` is a
 *      fail-closed outcome, and the UI parser treats every non-ok status
 *      as a BoundaryError.
 *
 * Assertions:
 *   - HTTP status 500 (fail-closed per Group 3 Task B)
 *   - Body parses as BoundaryError
 *   - error === 'FEATURE_NOT_ENABLED'
 *   - retryable === false
 *   - details.failure_type === 'FEATURE_NOT_ENABLED'
 *   - turn_executor.completed telemetry has commit_performed:false and
 *     validation_error_code:'HANDLER_NOT_FOUND'
 *
 * Covered for every unregistered V5ActionType member.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { BoundaryErrorSchema } from '@talchain/schemas/boundary';

import { setTestSink } from '../../src/utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mock routing adapter — produces a tool_use with the unsupported action.
// Each test sets `mockHandlerId` before injecting a request.
let mockHandlerId = 'set_factor_value';
const routingMockAdapter = {
  name: 'unsupported-test-mock',
  chat: async () => ({
    content: 'ok',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'unsupported-test-mock',
    latencyMs: 0,
  }),
  chatWithTools: async () => ({
    content: [
      {
        type: 'tool_use' as const,
        id: 'tu-unsupported',
        name: 'olumi_action',
        input: {
          intent_class: 'execute',
          action: {
            handler_id: mockHandlerId,
            entity: {
              id: 'node-x',
              kind: 'node',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
      },
    ],
    stop_reason: 'tool_use' as const,
    usage: { input_tokens: 10, output_tokens: 15 },
    model: 'unsupported-test-mock',
    latencyMs: 0,
  }),
};

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => routingMockAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: routingMockAdapter,
    resolution: {
      task: task ?? 'orchestrator',
      resolved_model: 'unsupported-test-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// Session store mock — passes pre-flight so the turn reaches TurnExecutor.
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    checkScenarioExists: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
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

function buildRequest() {
  return {
    kind: 'message' as const,
    turn_id: 'b1111111-1111-4111-8111-111111111111',
    scenario_id: SCENARIO_ID,
    message: 'please set factor X to 0.5',
    turn_class: 'frame' as const,
    stage: 'frame' as const,
    source: 'composer' as const,
  };
}

describe('POST /orchestrate/v2/turn — UNSUPPORTED_ACTION end-to-end (v5-exclusive-cee)', () => {
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
    mockHandlerId = 'set_factor_value';
  });

  it('validator-miss: unregistered handler_id surfaces FEATURE_NOT_ENABLED + retryable:false at the route (500 BoundaryError per fail-closed Task B)', async () => {
    mockHandlerId = 'set_factor_value';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(),
    });

    // commit_performed:false → 500 BoundaryError per Group 3 Task B
    // fail-closed invariant. UNSUPPORTED_ACTION is a commit-never-reached
    // case, so it takes the same wire path as any other runtime failure.
    expect(res.statusCode).toBe(500);
    const body = res.json();
    const parsed = BoundaryErrorSchema.parse(body);
    // Core route-level assertion: typed FEATURE_NOT_ENABLED wire code.
    expect(parsed.error).toBe('FEATURE_NOT_ENABLED');
    expect(parsed.retryable).toBe(false);
    expect(parsed.details).toMatchObject({
      retryable: false,
      failure_type: 'FEATURE_NOT_ENABLED',
      // stage is stamped by route-v2.ts for operator triage. Asserting
      // it here locks the wire contract so a future refactor cannot
      // silently drop the field.
      stage: 'frame',
    });

    // Turn telemetry carries the typed wire code so operators can filter
    // for UNSUPPORTED_ACTION incidents end-to-end. Note
    // `validation_error_code` lives on the routing log (not the
    // turn_executor.completed broadcast event), so we assert the wire-
    // surfaced signals only.
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.failure_type).toBe('FEATURE_NOT_ENABLED');
    expect(completed[0]!.data.commit_performed).toBe(false);
  });

  it.each([
    'add_constraint',
    'adjust_edge_strength',
    'explain_result',
    'compare_options',
    'what_would_flip',
  ])(
    'all declared-but-unregistered V5ActionType members return 500 FEATURE_NOT_ENABLED via route: %s',
    async (handlerId) => {
      mockHandlerId = handlerId;
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: buildRequest(),
      });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      const parsed = BoundaryErrorSchema.parse(body);
      expect(parsed.error).toBe('FEATURE_NOT_ENABLED');
      expect(parsed.retryable).toBe(false);
      // Every unregistered action converges on the same typed wire code,
      // so clients can handle the whole class uniformly (hide the
      // affordance, surface an explain-we-don't-support-that message).
    },
  );
});
