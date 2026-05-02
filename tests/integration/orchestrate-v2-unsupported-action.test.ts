/**
 * V5 golden-path completion — unsupported-action graceful fallback (route-level).
 *
 * The previous contract wrapped the validator's HANDLER_NOT_FOUND as a 500
 * BoundaryError with wire code FEATURE_NOT_ENABLED. The UI parser treats
 * every non-ok status as a BoundaryError, so users saw "Something went
 * wrong" when they asked for a perfectly sensible action (add an option,
 * set a factor value) that this deployment hasn't implemented yet.
 *
 * The new contract: when routing proposes a handler that isn't registered,
 * the turn commits as a direct_answer and returns a 200 OlumiResponse with
 *   - contextual coaching text (pointing at the canvas / inspector / the
 *     next logical action)
 *   - a chip derived from the live registry
 *   - NO error block
 *   - NO BoundaryError envelope
 *
 * This is "guided not yet available", not an internal error. The
 * dispatch-level registry miss (handler_not_registered via
 * UnhandledTurnClassError) is still a 500 — it's an internal invariant
 * breach (validation registry and handler registry diverged), which
 * deserves an operator alert, not user-facing coaching.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { setTestSink } from '../../src/utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mock routing adapter — produces a tool_use with the unsupported action.
// Each test sets `mockHandlerId` before injecting a request.
let mockHandlerId = 'compare_options';
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
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
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
    message: 'what are the tradeoffs here',
    turn_class: 'frame' as const,
    stage: 'frame' as const,
    source: 'composer' as const,
  };
}

const FORBIDDEN_DEV_TERMS = /\b(feature|enabled|environment|handler_id|registry|session)\b/i;

describe('POST /orchestrate/v2/turn — unsupported-action graceful fallback', () => {
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
    mockHandlerId = 'compare_options';
  });

  it('validator miss: unregistered handler_id returns 200 OlumiResponse with coaching (not 500 BoundaryError)', async () => {
    mockHandlerId = 'compare_options';
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest(),
    });

    // Core wire-contract flip: 200 OlumiResponse, not 500 BoundaryError.
    // This is the whole point of the fix — users asking for a sensible but
    // not-yet-implemented action should see guided coaching, not an
    // internal-error envelope.
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const parsed = OlumiResponseSchema.parse(body);

    // No error block — the response body is a clean OlumiResponse. The UI
    // parser would otherwise render the "Something went wrong" fallback
    // regardless of status code if an error block were present with
    // FEATURE_NOT_ENABLED semantics.
    const errorBlocks = parsed.blocks.filter((b) => b.type === 'error');
    expect(errorBlocks).toHaveLength(0);

    // Coaching text must be present and non-empty.
    expect(parsed.assistant_text.length).toBeGreaterThan(0);

    // No developer-facing terminology. This is the §1b quality bar from
    // the CEE brief.
    expect(parsed.assistant_text).not.toMatch(FORBIDDEN_DEV_TERMS);

    // At least one chip to keep the user moving. run_analysis is the only
    // registered handler today, so it's the chip we surface.
    expect(parsed.suggested_actions.length).toBeGreaterThan(0);
    expect(parsed.suggested_actions[0]!.action_type).toBe('run_analysis');

    // Turn telemetry: commit_performed=true, failure_type=null. This is
    // a successful turn from the wire's POV — validator_error_code is
    // preserved on the routing log (not this telemetry) for post-hoc
    // debugging.
    const completed = events.filter((e) => e.event === 'turn_executor.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data.failure_type).toBeNull();
    expect(completed[0]!.data.commit_performed).toBe(true);
  });

  // V5 D1: set_factor_value, add_constraint, and adjust_edge_strength
  // are now registered. The remaining ids in this list stay
  // unregistered (add_option / edit_graph dispatch outside the
  // tool-use seam; explain_result is the deprecated singular alias;
  // compare_options is E1 brief scope).
  it.each([
    'add_option',
    'edit_graph',
    'explain_result',
    'compare_options',
  ])(
    'every unregistered handler_id routes to the 200 coaching fallback: %s',
    async (handlerId) => {
      mockHandlerId = handlerId;
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: buildRequest(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const parsed = OlumiResponseSchema.parse(body);
      expect(parsed.blocks.filter((b) => b.type === 'error')).toHaveLength(0);
      expect(parsed.assistant_text.length).toBeGreaterThan(0);
      expect(parsed.assistant_text).not.toMatch(FORBIDDEN_DEV_TERMS);
      expect(parsed.suggested_actions.length).toBeGreaterThan(0);
    },
  );
});
