/**
 * V5 Group 3 Task C — model resolution routing.
 *
 * Verifies that the V5 ORIENT LLM call (routeWithToolUse) resolves its
 * adapter via `getAdapterWithResolution('orchestrator', ...)` and records
 * exactly one model_resolutions entry per turn on the turn-debug store.
 *
 * Prior to Group 3 the same call site used `getAdapter('direct_answer_narrate')`
 * where `direct_answer_narrate` is NOT a member of the CeeTask union in
 * src/config/model-routing.ts, causing the router to short-circuit to
 * llm_model_fallback (observed as gpt-4o-mini on 20 April 2026 staging).
 *
 * Covers:
 *   - Happy-path: model_resolutions[0] has task='orchestrator',
 *     resolution_source is present, resolved_model is present.
 *   - REPAIR_ONCE loop records only one entry per turn (not one per LLM call).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../src/utils/telemetry.js';

const SCENARIO = 'c0000000-0000-4000-8000-000000000001';

// Mutable: lets a test flip the adapter to return a result that fails
// tool-schema validation on first call (forces REPAIR_ONCE).
let failFirstAttempt = false;
let firstAttemptCount = 0;

const resolutionMockAdapter = {
  name: 'task-c-mock',
  chat: async () => ({ content: '', usage: { input_tokens: 0, output_tokens: 0 }, model: 'task-c-mock', latencyMs: 0 }),
  chatWithTools: async () => {
    firstAttemptCount++;
    if (failFirstAttempt && firstAttemptCount === 1) {
      // Emit a tool_use block with a schema-invalid input so REPAIR_ONCE
      // fires. The tool_schema parser will reject this and the routing
      // code will issue one repair attempt.
      return {
        content: [{ type: 'tool_use', id: 'tu-bad', name: 'olumi_action', input: { nope: true } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'task-c-mock',
        latencyMs: 0,
      };
    }
    return {
      content: [{ type: 'text', text: 'hello from task c' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'task-c-mock',
      latencyMs: 0,
    };
  },
};

let lastResolutionTaskId: string | undefined;

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => resolutionMockAdapter,
  getAdapterWithResolution: (task?: string) => {
    lastResolutionTaskId = task;
    return {
      adapter: resolutionMockAdapter,
      // Make the resolution_source mimic what a store-overriden model would
      // produce, so we can assert the plumbing is wired end-to-end.
      resolution: {
        task,
        resolved_model: 'claude-sonnet-4-6',
        resolution_source: 'store_model_config' as const,
        provider: 'anthropic' as const,
      },
    };
  },
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

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
let turnDebugEnabled = true;
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
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'turnDebugEnabled') return turnDebugEnabled;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');
const { getTurnDebug, clearTurnDebugStore } = await import('../../src/orchestrator-v5/debug/turn-debug-store.js');

// Telemetry sink captures per-turn request_id so we can look up the
// turn-debug store entry (which is keyed by request_id, not the payload's
// user-facing turn_id).
let lastRequestId: string | undefined;

function buildRequest(turnId: string) {
  return {
    turn_id: turnId,
    scenario_id: SCENARIO,
    message: 'test message for task c resolution',
    turn_class: 'frame' as const,
    stage: 'frame' as const,
  };
}

describe('POST /orchestrate/v2/turn — Group 3 Task C model resolution', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    v5Enabled = true;
    turnDebugEnabled = true;
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    setTestSink((eventName, data) => {
      if (eventName === 'turn_executor.started') {
        lastRequestId = data.request_id as string;
      }
    });
  });

  afterAll(async () => {
    setTestSink(null);
    await app.close();
  });

  beforeEach(() => {
    clearTurnDebugStore();
    lastResolutionTaskId = undefined;
    lastRequestId = undefined;
    failFirstAttempt = false;
    firstAttemptCount = 0;
  });

  it('routes ORIENT through getAdapterWithResolution with task="orchestrator"', async () => {
    const turnId = 'c1111111-1111-4111-8111-111111111111';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(turnId),
    });
    expect(res.statusCode).toBe(200);
    // Critical Group 3 Task C assertion: the correct CeeTask is used.
    expect(lastResolutionTaskId).toBe('orchestrator');
  });

  it('records one model_resolutions entry per turn on turn-debug', async () => {
    const turnId = 'c2222222-2222-4222-8222-222222222222';
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(turnId),
    });
    expect(lastRequestId).toBeDefined();
    // turn-debug is keyed by the internal request_id, NOT the payload turn_id.
    const debug = getTurnDebug(lastRequestId!);
    expect(debug).toBeDefined();
    expect(debug).not.toBe('expired');
    if (debug && debug !== 'expired') {
      expect(debug.model_resolutions).toHaveLength(1);
      const r = debug.model_resolutions![0]!;
      expect(r.task).toBe('orchestrator');
      expect(r.resolved_model).toBe('claude-sonnet-4-6');
      expect(r.resolution_source).toBe('store_model_config');
      // Group 3 follow-up: provider is now included so operators can tell
      // anthropic gpt-routed from openai claude-routed in resolution logs.
      expect(r.provider).toBe('anthropic');
      expect(typeof r.timestamp).toBe('number');
    }
  });

  it('records only ONE resolution entry per turn even when REPAIR_ONCE fires', async () => {
    // Force the first chatWithTools call to return a schema-invalid tool_use.
    // The routing code's REPAIR_ONCE will issue a second call. The resolution
    // should still be recorded only once per turn (not once per LLM call).
    failFirstAttempt = true;
    const turnId = 'c3333333-3333-4333-8333-333333333333';
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(turnId),
    });
    // Sanity: REPAIR_ONCE DID fire (two chatWithTools calls were made).
    expect(firstAttemptCount).toBe(2);
    expect(lastRequestId).toBeDefined();
    const debug = getTurnDebug(lastRequestId!);
    if (debug && debug !== 'expired') {
      expect(debug.model_resolutions).toHaveLength(1);
    }
  });
});
