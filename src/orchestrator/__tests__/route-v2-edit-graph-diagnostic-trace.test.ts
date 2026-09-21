/**
 * FULL-ROUTE wiring test (observability lane, S3-L6 / F-5) — the WIRE
 * `_diagnostic_trace.llm_calls` must carry the edit-lane LLM call on an
 * `edit_graph` turn.
 *
 * F-5 defect: an edit turn's minimal trace built its `llm_calls[]` only from
 * `V5TurnTimings` (the turn_executor shape the edit dispatch never captures),
 * so `_diagnostic_trace.llm_calls` was structurally `[]` on every edit turn
 * that demonstrably called the LLM — every edit-lane probe this week needed
 * Render logs instead of the wire.
 *
 * This drives `POST /orchestrate/v2/turn` end-to-end (real route-v2 +
 * `sendFinalised200` minimal-trace builder) with an edit-shaped message +
 * `graph_state` so the route dispatches to `dispatchEditGraph`, which is
 * mocked here to return a result carrying `editLlmCall` (the dispatch→result
 * link is proven separately in
 * `orchestrator-v5/handlers/__tests__/edit-graph-dispatch-diagnostic-trace.test.ts`).
 * The assertion is the WIRE: `_diagnostic_trace.exit_path === 'edit_graph'`
 * and `llm_calls[]` contains the edit call.
 *
 * MUTATION-CHECK: revert route-v2's `editLlmCall: eg.editLlmCall` threading
 * (either the `sendFinalised200` ctx pass or the `buildMinimalV5DiagnosticTrace`
 * spread), OR the builder's `populateCollectorFromEditTelemetry` call, and this
 * test goes RED (`llm_calls` collapses to `[]`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';

const EDIT_MODEL = 'claude-sonnet-4-6';
const EDIT_INPUT_TOKENS = 3100;
const EDIT_OUTPUT_TOKENS = 210;

// A permissive-but-valid graph_state so `isEditGraphShape` holds and the route
// dispatches to the (mocked) edit pipeline.
const GRAPH_STATE = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Launch now' },
    { id: 'goal-g', kind: 'goal', label: 'Grow revenue' },
    { id: 'fac-marketing', kind: 'factor', label: 'Marketing', observed_state: { value: 0.1, raw_value: 5, cap: 50 } },
  ],
  edges: [
    { from: 'fac-marketing', to: 'goal-g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};

// dispatchEditGraph is mocked as the trace-source: it returns the edit LLM call
// attribution the real dispatch now surfaces (proven in the dispatch suite).
const dispatchEditGraphMock = vi.fn(async () => ({
  response: {
    response_version: 2 as const,
    assistant_text: 'Edge strength increased.',
    blocks: [] as const,
    suggested_actions: [] as const,
    insights: [] as const,
    stage_indicator: 'analyse' as const,
  },
  commitPerformed: true,
  graph: null,
  editLlmCall: {
    provider: 'anthropic',
    model: EDIT_MODEL,
    input_tokens: EDIT_INPUT_TOKENS,
    output_tokens: EDIT_OUTPUT_TOKENS,
    latency_ms: 1450,
    stop_reason: 'end_turn',
    repair_attempts: 1,
  },
}));
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '88888888-8888-4888-8888-888888888888',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    // An edit-shaped free-text command → route-v2 edit heuristic dispatches to
    // dispatchEditGraph (same trigger pinned by route-v2-held-proposal-confirm).
    message: 'Add a risk for supplier delays affecting the launch',
    turn_class: 'decide',
    source: 'composer',
    graph_state: GRAPH_STATE,
    ...overrides,
  };
}

describe('POST /orchestrate/v2/turn — edit turn surfaces the edit-lane LLM call in _diagnostic_trace.llm_calls (S3-L6 / F-5)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
    vi.stubEnv('CEE_DIAGNOSTIC_TRACE_ENABLED', 'true');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });
  beforeEach(() => {
    appendMock.mockClear();
    dispatchEditGraphMock.mockClear();
  });

  it('flag ON: the wire _diagnostic_trace records the edit_graph LLM call (was always [] before the fix)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(),
    });

    expect(res.statusCode).toBe(200);
    // The edit dispatch was actually reached (not intercepted by another path).
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    const trace = body._diagnostic_trace as
      | { llm_calls: Array<Record<string, unknown>>; exit_path: string }
      | undefined;

    expect(trace).toBeDefined();
    expect(trace!.exit_path).toBe('edit_graph');

    // THE FIX: llm_calls carries the REAL edit call, not [].
    expect(Array.isArray(trace!.llm_calls)).toBe(true);
    const editCall = trace!.llm_calls.find((c) => c.role === 'edit_graph');
    expect(editCall).toBeDefined();
    expect(editCall!.provider).toBe('anthropic');
    expect(editCall!.model).toBe(EDIT_MODEL);
    expect(editCall!.input_tokens).toBe(EDIT_INPUT_TOKENS);
    expect(editCall!.output_tokens).toBe(EDIT_OUTPUT_TOKENS);
    expect(editCall!.stop_reason).toBe('end_turn');
    expect(typeof editCall!.latency_ms).toBe('number');
  });
});
