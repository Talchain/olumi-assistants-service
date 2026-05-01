/**
 * V5 Phase 2.5 Defect A — Part 1 regression suite.
 *
 * Covers the graph-reload + typed-recovery hardening of the edit_graph
 * pre-Sonnet dispatch in `src/orchestrator/route-v2.ts`. Five focused
 * cases plus the standing routing-contract invariant assertion.
 *
 * SCOPE LIMITATION (read this before adding cases):
 *   Part 1 does NOT solve referential resolution. An explicit edit
 *   ("add opportunity cost as a risk") routes correctly here as long as a
 *   graph is present (on the request OR reloadable from persistence).
 *   A referential edit ("let's add this") still misroutes when the regex
 *   gate matches but the system has no referent for "this" — that is
 *   Part 2's job (structured `recent_assistant_suggestions` in the L1
 *   context pack), tracked separately and gated on a pipeline-alignment
 *   decision (PA-3 / `v5_coaching_state` table). Cases that look like
 *   referential resolution belong in the Part 2 test file when it lands.
 *
 * ROUTING CONTRACT (asserted across all five cases):
 *   When edit intent is detected (positive regex matches AND negative
 *   regex does not), the route MUST produce exactly one of:
 *     1. Edit mutation dispatched (`dispatchEditGraph` called).
 *     2. Clarification response (Part 2 — not exercised here).
 *     3. Typed recovery response (200 + composeDirectAnswerResponse +
 *        `v5.edit_graph.graph_state_unavailable` telemetry).
 *   The response MUST NEVER fall through to TurnExecutor and end up
 *   routed by Sonnet to `explain_from_structure` or an unflagged
 *   `direct_answer`. Detection is via the trio of telemetry events
 *   `v5.edit_graph.graph_state_{present,reloaded,unavailable}` plus
 *   `dispatchEditGraph` invocation, which together cover the three
 *   permitted outcomes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const loadGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return true;
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

// Capture telemetry events emitted during each test, plus the
// `v5.response.finalised` log lines (used by the routing-contract
// invariant to detect TurnExecutor fallthrough on edit-intent turns).
const telemetryEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
const logInfoCalls: Array<Record<string, unknown>> = [];
vi.mock('../../../src/utils/telemetry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/utils/telemetry.js')>();
  return {
    ...original,
    emit: (name: string, payload: Record<string, unknown>) => {
      telemetryEvents.push({ name, payload });
      return original.emit(name as never, payload as never);
    },
    log: new Proxy(original.log, {
      get(target, prop, receiver) {
        if (prop === 'info') {
          return (obj: unknown, msg?: string) => {
            if (typeof obj === 'object' && obj !== null) {
              logInfoCalls.push(obj as Record<string, unknown>);
            }
            return Reflect.get(target, 'info', receiver).call(target, obj, msg);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';

const VALID_GRAPH_STATE = {
  nodes: [
    { id: 'opt-1', kind: 'option', label: 'Option A' },
    { id: 'fac-1', kind: 'factor', label: 'Cost' },
  ],
  edges: [{ from: 'fac-1', to: 'opt-1' }],
};

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Applied edit — graph now has 2 nodes and 1 edges.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-111111111100',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'Add a new risk factor',
    turn_class: 'propose',
    source: 'composer',
    ...overrides,
  };
}

function emittedNames(): string[] {
  return telemetryEvents.map((e) => e.name);
}

function findEvent(name: string): Record<string, unknown> | undefined {
  return telemetryEvents.find((e) => e.name === name)?.payload;
}

/**
 * Routing-contract invariant. For any turn where edit intent was detected,
 * the route MUST produce **exactly one** of the three permitted outcomes:
 *   (1) edit_graph dispatched (`dispatchEditGraph` called),
 *   (2) clarification response (Part 2 — never observed in this suite),
 *   (3) typed recovery (`v5.edit_graph.graph_state_unavailable` emitted).
 *
 * Two stronger assertions over the brief's text:
 *   - **Exactly one**, not "at least one". A future regression that fired
 *     both a recovery AND a dispatch call (e.g. a missing `return`) would
 *     slip past `dispatchCalled || recoveryEmitted`.
 *   - **No `exit_path: 'turn_executor'`** on the `v5.response.finalised`
 *     log line. This is the canonical signal of the silent-fallthrough bug
 *     this fix exists to prevent. If a turn with detected edit intent ever
 *     finalises via the TurnExecutor exit path, the contract is violated
 *     even if other telemetry looks correct.
 */
function assertRoutingContractHonoured(): void {
  const dispatchCalled = dispatchEditGraphMock.mock.calls.length > 0;
  const clarificationFired = false; // Part 2 — never produced by Part 1 code paths.
  const recoveryEmitted = emittedNames().includes('v5.edit_graph.graph_state_unavailable');
  const outcomeCount = [dispatchCalled, clarificationFired, recoveryEmitted].filter(Boolean).length;
  if (outcomeCount !== 1) {
    throw new Error(
      `Routing contract violated: expected exactly one of (dispatch, clarification, typed recovery), got ${outcomeCount}. ` +
        `dispatchCalled=${dispatchCalled} clarificationFired=${clarificationFired} recoveryEmitted=${recoveryEmitted}. ` +
        `Telemetry: ${JSON.stringify(emittedNames())}`,
    );
  }
  const finaliseEvent = logInfoCalls.find((c) => c.event === 'v5.response.finalised');
  if (finaliseEvent && finaliseEvent.exit_path === 'turn_executor') {
    throw new Error(
      `Routing contract violated: edit intent finalised via turn_executor exit path. ` +
        `Finalise event: ${JSON.stringify(finaliseEvent)}`,
    );
  }
}

describe('POST /orchestrate/v2/turn — V5 Phase 2.5 Defect A Part 1 (graph reload + typed recovery)', () => {
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
    dispatchEditGraphMock.mockReset();
    appendMock.mockClear();
    loadGraphMock.mockReset();
    telemetryEvents.length = 0;
    logInfoCalls.length = 0;
  });

  // ─── Case 1 ────────────────────────────────────────────────────────────
  it('edit intent + graphState present on request → dispatches; emits graph_state_present', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Add opportunity cost of founder time as a risk',
        graph_state: VALID_GRAPH_STATE,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).toContain('v5.edit_graph.graph_state_present');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_reloaded');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_unavailable');
    assertRoutingContractHonoured();
  });

  // ─── Case 2 ────────────────────────────────────────────────────────────
  it('edit intent + graphState absent + persisted graph valid → reloads then dispatches', async () => {
    loadGraphMock.mockResolvedValueOnce(VALID_GRAPH_STATE);
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Add opportunity cost of founder time as a risk',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(loadGraphMock).toHaveBeenCalledWith(SCENARIO_ID);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    // The whole point of reload is that the dispatcher receives the
    // RELOADED graph (post-validate, with required fields), not null
    // and not the unparsed raw object. A future regression that fed
    // `extensions.graphState` (still null on this turn) or the raw
    // pre-validate `persisted` value to the dispatcher would slip past
    // a count-only assertion.
    const dispatchArgs = dispatchEditGraphMock.mock.calls[0]?.[0];
    expect(dispatchArgs?.graphState).toEqual(VALID_GRAPH_STATE);
    expect(emittedNames()).toContain('v5.edit_graph.graph_state_reloaded');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_present');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_unavailable');
    assertRoutingContractHonoured();
  });

  // ─── Case 3a ───────────────────────────────────────────────────────────
  it('edit intent + graphState absent + no persisted graph → typed recovery (no_persisted_graph)', async () => {
    loadGraphMock.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Add opportunity cost of founder time as a risk',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(loadGraphMock).toHaveBeenCalledWith(SCENARIO_ID);
    const recovery = findEvent('v5.edit_graph.graph_state_unavailable');
    expect(recovery).toBeDefined();
    expect(recovery!.reason).toBe('no_persisted_graph');
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain("couldn't access the current graph");
    assertRoutingContractHonoured();
  });

  // ─── Case 3b ───────────────────────────────────────────────────────────
  it('edit intent + graphState absent + persisted graph invalid → typed recovery (persisted_graph_invalid)', async () => {
    // Reloaded graph is missing required `nodes` / `edges` arrays — fails
    // GraphStateIngressSchema validation.
    loadGraphMock.mockResolvedValueOnce({ nodes: 'not-an-array', edges: null });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Add opportunity cost of founder time as a risk',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    const recovery = findEvent('v5.edit_graph.graph_state_unavailable');
    expect(recovery).toBeDefined();
    expect(recovery!.reason).toBe('persisted_graph_invalid');
    assertRoutingContractHonoured();
  });

  // ─── Case 4 ────────────────────────────────────────────────────────────
  it('no edit intent + graphState absent → unchanged behaviour (no recovery telemetry)', async () => {
    // `loadGraphMock` may be called by TurnExecutor's `build-turn-context`
    // when it fetches persisted graph for context assembly on fallthrough
    // turns. That is a separate, legitimate code path; we cannot assert
    // `not.toHaveBeenCalled` on the mock without false positives. Instead,
    // assert the absence of the edit-graph-specific recovery telemetry —
    // which is what proves our new edit-recovery branch did not engage.
    loadGraphMock.mockResolvedValue(VALID_GRAPH_STATE);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Tell me about the structure of this decision',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_present');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_reloaded');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_unavailable');
    // Falls through to TurnExecutor; in this minimal test setup the executor
    // returns 200 or 500 depending on adapter resolution. Either is acceptable
    // — the assertion is that the new edit-recovery code did not interfere.
    expect([200, 500]).toContain(res.statusCode);
  });

  // ─── Case 5 ────────────────────────────────────────────────────────────
  it('negative-regex match (e.g. "explain why...") + graphState absent → no recovery, no dispatch', async () => {
    // Same caveat as Case 4: TurnExecutor's context-build may invoke
    // loadGraph for its own purposes. The contract here is that the
    // edit-graph-specific recovery telemetry does not fire — meaning the
    // route correctly classified this as a non-edit (meta-question) turn
    // and did NOT invoke the recovery / dispatch paths.
    loadGraphMock.mockResolvedValue(VALID_GRAPH_STATE);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        // Contains "explain" (negative regex) AND "add" (positive regex).
        // Negative wins — this is a meta-question, not an edit command.
        message: 'Explain why we should add opportunity cost as a risk',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_present');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_reloaded');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_unavailable');
    expect([200, 500]).toContain(res.statusCode);
  });

  // ─── Case 6 (extra coverage — session store throws) ───────────────────
  it('edit intent + graphState absent + session store throws → typed recovery (session_store_failed)', async () => {
    loadGraphMock.mockRejectedValueOnce(new Error('supabase blew up'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Add opportunity cost of founder time as a risk',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    const recovery = findEvent('v5.edit_graph.graph_state_unavailable');
    expect(recovery).toBeDefined();
    expect(recovery!.reason).toBe('session_store_failed');
    assertRoutingContractHonoured();
  });
});
