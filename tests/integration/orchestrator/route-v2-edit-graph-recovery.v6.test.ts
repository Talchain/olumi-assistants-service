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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import * as editGraphTool from '../../../src/orchestrator/tools/edit-graph.js';
import { _resetConfigCache } from '../../../src/config/index.js';
import { SupabaseSessionStore } from '../../../src/orchestrator-v5/session/supabase-store.js';
import * as sessionStoreModule from '../../../src/orchestrator-v5/session/supabase-store.js';
import { GraphStaleWriteError, type SessionTurnWrite } from '../../../src/orchestrator-v5/session/store.js';

// The OFF parity rows also run against an exported origin/staging tree, whose
// store has no v6 test seam. The explicit ON rows require the current seam.
function __setUseAppendV6ForTest(enabled: boolean): void {
  if ('__setUseAppendV6ForTest' in sessionStoreModule) {
    (sessionStoreModule as unknown as { __setUseAppendV6ForTest(value: boolean): void })
      .__setUseAppendV6ForTest(enabled);
  } else if (enabled) {
    throw new Error('The flag-ON row requires the current v6 store seam');
  }
}

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const claimTurnFenceMock = vi.fn();
const loadGraphMock = vi.fn();
const loadGraphAndBriefTextMock = vi.fn(async (_scenarioId: string): Promise<{
  graph: unknown | null; briefText: string | null; revision?: number;
}> => ({ graph: null, briefText: null, revision: 8 }));
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    ...(claimTurnFenceMock.getMockImplementation() !== undefined
      ? { claimTurnFence: claimTurnFenceMock } : {}),
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: loadGraphAndBriefTextMock,
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
// Collect the real dispatcher once; the existing route rows retain their mock.
const { dispatchEditGraph: dispatchRealEditGraph } = await vi.importActual<
  typeof import('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js')
>('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js');

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
 * Routing-contract invariant (C-EDIT-1). For any turn where edit intent
 * was detected, the route MUST produce **exactly one** of these
 * permitted outcomes:
 *   (1) edit_graph dispatched (`dispatchEditGraph` called) —
 *       finalises via `sendFinalised200(..., 'edit_graph', ...)`.
 *   (2) clarification response (Part 2 — never observed in this suite) —
 *       finalises via `sendFinalised200(..., 'edit_graph', ...)`.
 *   (3) typed recovery (`v5.edit_graph.graph_state_unavailable` emitted) —
 *       finalises via `sendFinalised200(..., 'edit_graph', ...)`.
 *   (4) typed BoundaryError 500 — dispatch failure / pipeline throw.
 *       NOT routed through `sendFinalised200`; uses
 *       `reply.code(500).send(boundaryError)` directly. Emits ZERO
 *       `v5.response.finalised` events. Still satisfies the contract:
 *       the failure is surfaced as a typed wire response, not a silent
 *       fallthrough.
 *
 * Stronger assertions than the brief's wording:
 *   - **Exactly one** outcome, not "at least one". A regression that
 *     fired both a recovery AND a dispatch call (e.g. a missing
 *     `return`) would slip past `dispatchCalled || recoveryEmitted`.
 *   - **No `exit_path: 'turn_executor'`** on any `v5.response.finalised`
 *     event. This is the canonical signal of the silent-fallthrough bug
 *     this fix exists to prevent. Inspect ALL events (not just the
 *     first via `find()`) — a missing-return after
 *     `sendEditGraphRecovery(...)` would emit two finalise events on
 *     the same request, edit_graph first then turn_executor; `find()`
 *     would short-circuit on the edit_graph match and miss the leak.
 *
 * Parameter `expectsFinalised200` discriminates outcomes (1)-(3) from
 * outcome (4). 200-emitting cases set true (default) and require
 * exactly one finalise event. Tests that exercise the typed-500 path
 * pass false: the helper then asserts ZERO finalise events (the 500
 * branch must never accidentally emit one), and skips the per-event
 * `exit_path` check (no events to inspect).
 */
function assertRoutingContractHonoured({
  expectsFinalised200 = true,
}: { expectsFinalised200?: boolean } = {}): void {
  const dispatchCalled = dispatchEditGraphMock.mock.calls.length > 0;
  const clarificationFired = false; // Part 2 — never produced by Part 1 code paths.
  const recoveryEmitted = emittedNames().includes('v5.edit_graph.graph_state_unavailable');
  const outcomeCount = [dispatchCalled, clarificationFired, recoveryEmitted].filter(Boolean).length;
  // For typed-500 cases the dispatcher IS called (the failure happens
  // downstream of dispatch); we still want exactly one outcome signal.
  // For pipeline-throws-pre-dispatch (no test covers this today), the
  // outcome count would be 0 and this assertion would catch a silent
  // fallthrough where the throw was swallowed.
  if (outcomeCount !== 1) {
    throw new Error(
      `Routing contract violated: expected exactly one of (dispatch, clarification, typed recovery), got ${outcomeCount}. ` +
        `dispatchCalled=${dispatchCalled} clarificationFired=${clarificationFired} recoveryEmitted=${recoveryEmitted}. ` +
        `Telemetry: ${JSON.stringify(emittedNames())}`,
    );
  }
  const finaliseEvents = logInfoCalls.filter((c) => c.event === 'v5.response.finalised');
  if (expectsFinalised200) {
    if (finaliseEvents.length !== 1) {
      throw new Error(
        `Routing contract violated: expected exactly one v5.response.finalised event, got ${finaliseEvents.length}. ` +
          `Events: ${JSON.stringify(finaliseEvents)}`,
      );
    }
    const turnExecutorLeak = finaliseEvents.find((c) => c.exit_path === 'turn_executor');
    if (turnExecutorLeak) {
      throw new Error(
        `Routing contract violated: edit intent finalised via turn_executor exit path. ` +
          `Finalise event: ${JSON.stringify(turnExecutorLeak)}`,
      );
    }
  } else {
    // Typed-500 outcome: the route must use `reply.code(500).send(...)`
    // directly, NOT `sendFinalised200`. Any finalise event here would
    // mean a 500 path accidentally went through the 200 finaliser —
    // a contract violation distinct from the turn_executor leak.
    if (finaliseEvents.length !== 0) {
      throw new Error(
        `Routing contract violated: typed-500 outcome should emit ZERO v5.response.finalised events, got ${finaliseEvents.length}. ` +
          `Events: ${JSON.stringify(finaliseEvents)}`,
      );
    }
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
    __setUseAppendV6ForTest(false);
    dispatchEditGraphMock.mockReset();
    appendMock.mockClear();
    loadGraphMock.mockReset();
    loadGraphAndBriefTextMock.mockReset();
    loadGraphAndBriefTextMock.mockResolvedValue({ graph: null, briefText: null, revision: 8 });
    telemetryEvents.length = 0;
    logInfoCalls.length = 0;
  });

  afterEach(() => __setUseAppendV6ForTest(false));

  // ─── Case 1 ────────────────────────────────────────────────────────────
  it('edit intent + graphState present on request → dispatches; emits graph_state_present', async () => {
    dispatchEditGraphMock.mockImplementationOnce(async () => {
      // The finaliser may read coaching context after dispatch. The edit
      // reload contract applies before the dispatcher is entered.
      expect(loadGraphMock).not.toHaveBeenCalled();
      expect(loadGraphAndBriefTextMock).not.toHaveBeenCalled();
      return makeEditGraphMockResult();
    });
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
    expect(dispatchEditGraphMock.mock.calls[0]?.[0]).not.toHaveProperty('persistedEditBase');
    expect(emittedNames()).toContain('v5.edit_graph.graph_state_present');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_reloaded');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_unavailable');
    assertRoutingContractHonoured();
  });

  // ─── Case 2 ────────────────────────────────────────────────────────────
  it('edit intent + graphState absent + persisted graph valid → reloads then dispatches', async () => {
    loadGraphMock.mockResolvedValueOnce(VALID_GRAPH_STATE);
    dispatchEditGraphMock.mockImplementationOnce(async (args) => {
      expect(loadGraphMock).toHaveBeenCalledTimes(1);
      expect(loadGraphAndBriefTextMock).not.toHaveBeenCalled();
      expect(args).not.toHaveProperty('persistedEditBase');
      return makeEditGraphMockResult();
    });
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
    // reloaded graph, not null. `extensions.graphState` is null on this
    // request, so without the reload code path the dispatcher would
    // either not be called or be called with `null`. A count-only
    // assertion would not catch a regression that called the dispatcher
    // with `null` or with `extensions.graphState`.
    //
    // Caveat on what `toEqual` proves here: `GraphStateIngressSchema`
    // uses Zod `.passthrough()`, so a successfully parsed graph is
    // structurally identical to the raw input. The structural-equality
    // check therefore does not by itself distinguish "raw persisted
    // object" from "post-validate parsed object" — they are equal under
    // `.passthrough()`. What this assertion DOES prove: the dispatcher
    // received the reloaded graph (not null, not a different value),
    // which is the load-bearing requirement of the reload contract.
    const dispatchArgs = dispatchEditGraphMock.mock.calls[0]?.[0];
    expect(dispatchArgs?.graphState).not.toBeNull();
    expect(dispatchArgs?.graphState).toEqual(VALID_GRAPH_STATE);
    expect(emittedNames()).toContain('v5.edit_graph.graph_state_reloaded');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_present');
    expect(emittedNames()).not.toContain('v5.edit_graph.graph_state_unavailable');
    assertRoutingContractHonoured();
  });

  it.each(['success', 'read_failure'] as const)(
    'flag OFF parity: route-v2 reload %s matches staging reads, RPC arguments and outcome',
    async (caseName) => {
      const reads: Array<{ table: string; columns: string }> = [];
      const sequence: string[] = [];
      const writes: SessionTurnWrite[] = [];
      const mutationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const modelVersion = {
        mutation_id: mutationId,
        graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64),
        hash_algorithm: 'sha256', identity_projection_version: 'identity.v1',
        identity_normaliser_version: '1', graph_schema_version: 'graph_v3',
        actor_kind: 'unknown' as const, authored_by: null,
        creation_kind: 'committed_mutation' as const, source_turn_id: payload({}).turn_id as string,
      };
      const receipt = {
        ...modelVersion, version_id: versionId, version_number: 1,
        source_version_id: null, parent_version_id: null, root_version_id: versionId,
        undo_version_id: null, graph: VALID_GRAPH_STATE,
        event_id: `model_version_created_mutation_${mutationId}`,
      };
      const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => {
        sequence.push('rpc');
        return { data: { turn_row_id: 'parity-turn-row', model_version_receipt: receipt }, error: null };
      });
      const client = {
        rpc,
        from: (table: string) => {
          let columns: string | null = null;
          const query = {
            select(value: string) {
              columns = value;
              reads.push({ table, columns: value });
              sequence.push(`read:${table}:${value}`);
              return query;
            },
            eq: () => query, limit: () => query, update: () => query,
            not: () => query, is: () => query,
            maybeSingle: async () => {
              if (caseName === 'read_failure') {
                return { data: null, error: { code: 'XX000', message: 'staging parity read failed' } };
              }
              // OFF must ignore a revision that the staging reader never selected.
              return { data: { graph: VALID_GRAPH_STATE, brief_text: null, revision: 'invalid' }, error: null };
            },
            then(resolve: (value: { data: unknown[] | null; error: null }) => unknown) {
              return Promise.resolve({ data: columns === 'request_hash' ? [] : null, error: null }).then(resolve);
            },
          };
          return query;
        },
      };
      const cache = { invalidateAll: vi.fn() };
      const publicStore = new SupabaseSessionStore(client as never, cache as never, {
        defaultReadLimit: 20, graphCasRpc: 'enforce',
      });
      claimTurnFenceMock.mockResolvedValue({
        scenarioId: SCENARIO_ID, turnId: payload({}).turn_id, generation: 1,
      });
      loadGraphMock.mockImplementation(async (scenarioId: string) => {
        sequence.push('loadGraph');
        return publicStore.loadGraph(scenarioId);
      });
      loadGraphAndBriefTextMock.mockImplementation(async (scenarioId: string) => {
        sequence.push('loadGraphAndBriefText');
        return publicStore.loadGraphAndBriefText(scenarioId);
      });
      dispatchEditGraphMock.mockImplementationOnce(async (args) => {
        sequence.push('dispatch');
        const write: SessionTurnWrite = {
          scenario_id: SCENARIO_ID, turn_id: payload({}).turn_id as string,
          turn_class: 'direct_answer', handler_id: null, request_hash: 'route-reload-parity',
          response_emitted: true, llm_calls_used: 0, duration_ms: 1, handler_facts: [],
          graph: args.graphState, expectedGraphIdentityHash: null, expectedGraphAnalysisHash: null,
          modelVersion,
        };
        writes.push(write);
        await publicStore.append(write);
        return makeEditGraphMockResult();
      });
      try {
        const res = await app.inject({
          method: 'POST', url: '/orchestrate/v2/turn',
          payload: payload({ message: 'Add opportunity cost of founder time as a risk' }),
        });
        // This snapshot is seeded only by the same harness against origin/staging.
        // It binds full arguments and ordered reads, rather than selected fields.
        expect({
          caseName, reads, sequence, rpc: rpc.mock.calls,
          loadGraphCalls: loadGraphMock.mock.calls,
          combinedReaderCalls: loadGraphAndBriefTextMock.mock.calls,
          dispatchedGraph: dispatchEditGraphMock.mock.calls[0]?.[0]?.graphState ?? null,
          hasPersistedEditBase: dispatchEditGraphMock.mock.calls[0]?.[0]?.persistedEditBase !== undefined,
          writes: writes.length, status: res.statusCode,
          recoveryReason: findEvent('v5.edit_graph.graph_state_unavailable')?.reason ?? null,
          graphReloaded: emittedNames().includes('v5.edit_graph.graph_state_reloaded'),
          invalidations: cache.invalidateAll.mock.calls,
        }).toMatchSnapshot();
        expect(res.statusCode).toBe(200);
        expect(reads.filter(read => read.table === 'scenarios')).toEqual([
          { table: 'scenarios', columns: 'graph, brief_text' }, // Strict edit reload.
          { table: 'scenarios', columns: 'graph, brief_text' }, // Finaliser context.
        ]);
        expect(loadGraphMock).toHaveBeenCalledTimes(1);
        expect(loadGraphAndBriefTextMock).toHaveBeenCalledTimes(1);
        expect(dispatchEditGraphMock).toHaveBeenCalledTimes(caseName === 'success' ? 1 : 0);
        expect(rpc).toHaveBeenCalledTimes(caseName === 'success' ? 1 : 0);
        if (caseName === 'success') {
          expect(rpc.mock.calls[0]?.[0]).toBe('append_turn_atomic_v5');
          expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_expected_revision');
        }
        assertRoutingContractHonoured();
      } finally {
        claimTurnFenceMock.mockReset();
      }
    },
  );

  describe('flag ON: revision-aware edit recovery', () => {
    beforeEach(() => __setUseAppendV6ForTest(true));
    afterEach(() => __setUseAppendV6ForTest(false));

    it('flag ON: server reload takes graph and revision from one combined read and threads that exact base', async () => {
      const base = { graph: VALID_GRAPH_STATE, briefText: null, revision: 8 };
      loadGraphAndBriefTextMock.mockResolvedValueOnce(base);
      loadGraphMock.mockResolvedValue({ nodes: [], edges: [] });
      dispatchEditGraphMock.mockImplementationOnce(async (args) => {
        // Assert at the edit boundary: later finaliser context reads are not
        // edit-authority reads and must not obscure this snapshot witness.
        expect(loadGraphAndBriefTextMock).toHaveBeenCalledTimes(1);
        expect(loadGraphAndBriefTextMock).toHaveBeenCalledWith(SCENARIO_ID);
        expect(loadGraphMock).not.toHaveBeenCalled();
        expect(args.graphState).toEqual(base.graph);
        expect(args.persistedEditBase).toBe(base);
        return makeEditGraphMockResult();
      });
      const res = await app.inject({
        method: 'POST', url: '/orchestrate/v2/turn',
        payload: payload({ message: 'Add opportunity cost of founder time as a risk' }),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
      const args = dispatchEditGraphMock.mock.calls[0]?.[0];
      expect(args.graphState).toEqual(base.graph);
      expect(args.persistedEditBase).toBe(base);
    });

    it('flag ON: empty server at revision 3, rival write at 4 → v6 OLRV1, HTTP 409 revision_conflict and no write', async () => {
      const clientGraph = {
        nodes: [
          { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
          { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 10 } },
        ],
        edges: [{
          from: 'fac_price', to: 'goal_revenue',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9, effect_direction: 'positive' as const,
        }],
        goal_node_id: 'goal_revenue',
      };
      const editedGraph = {
        ...clientGraph,
        nodes: clientGraph.nodes.map(node => node.id === 'fac_price'
          ? { ...node, observed_state: { value: 11 } } : node),
      };
      const rivalGraph = {
        ...clientGraph,
        nodes: clientGraph.nodes.map(node => node.id === 'fac_price'
          ? { ...node, observed_state: { value: 20 } } : node),
      };
      const persisted: { graph: unknown | null; revision: number } = { graph: null, revision: 3 };
      const combinedReads: Array<{ graph: unknown | null; briefText: null; revision: number }> = [];
      const successfulAppends: SessionTurnWrite[] = [];
      const cache = { invalidateAll: vi.fn() };
      let appendError: unknown;
      const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        expect(name).toBe('append_turn_atomic_v6');
        if (args.p_expected_revision !== persisted.revision) {
          return {
            data: null,
            error: {
              code: 'OLRV1', message: 'append_turn_atomic_v6: revision_conflict',
              details: JSON.stringify({
                reason: 'revision_conflict', expected: args.p_expected_revision, current: persisted.revision,
              }),
            },
          };
        }
        // A refreshed expectation would wrongly make this write succeed.
        persisted.graph = args.p_graph;
        persisted.revision += 1;
        return { data: { turn_row_id: 'unexpected-write', revision: persisted.revision }, error: null };
      });
      const publicStore = new SupabaseSessionStore({ rpc } as never, cache as never, {
        defaultReadLimit: 20, graphCasRpc: 'enforce',
      } as never);
      const editSpy = vi.spyOn(editGraphTool, 'handleEditGraph');
      vi.stubEnv('OLUMI_ENV', 'staging');
      vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
      vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'observe');
      vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'enforce');
      vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
      _resetConfigCache();

      try {
        claimTurnFenceMock.mockResolvedValue({
          scenarioId: SCENARIO_ID, turnId: payload({}).turn_id, generation: 1,
        });
        loadGraphMock.mockImplementation(async () => persisted.graph);
        loadGraphAndBriefTextMock.mockImplementation(async () => {
          const snapshot = { graph: persisted.graph, briefText: null, revision: persisted.revision };
          combinedReads.push(snapshot);
          return snapshot;
        });
        editSpy.mockImplementationOnce(async () => {
          expect(combinedReads[0]).toEqual({ graph: null, briefText: null, revision: 3 });
          // This rival save lands after the edit's empty graph/revision read.
          persisted.graph = rivalGraph;
          persisted.revision = 4;
          return {
            blocks: [], assistantText: 'Changed Price from 10 to 11.', latencyMs: 1,
            appliedGraph: editedGraph as unknown as NonNullable<
              Awaited<ReturnType<typeof editGraphTool.handleEditGraph>>['appliedGraph']
            >,
            wasRejected: false,
            appliedChanges: {
              summary: 'Changed Price from 10 to 11.',
              changes: [{ label: 'Price', description: 'Changed value.', element_ref: 'fac_price' }],
              rerun_recommended: false,
            },
            operations: [{ op: 'update_node', path: 'fac_price', value: { observed_state: { value: 11 } } }],
            operation_meta: [{ impact: 'low', rationale: '' }],
          };
        });
        dispatchEditGraphMock.mockImplementationOnce(dispatchRealEditGraph);
        appendMock.mockImplementationOnce(async (write: SessionTurnWrite) => {
          try {
            const outcome = await publicStore.append(write);
            successfulAppends.push(write);
            return outcome;
          } catch (err) {
            appendError = err;
            throw err;
          }
        });

        const res = await app.inject({
          method: 'POST', url: '/orchestrate/v2/turn',
          // Named free-form edit: no numeric quantity for the deterministic
          // value-update lane; the provider's semantic edit still versions.
          payload: payload({ message: 'Adjust the Price assumption', graph_state: clientGraph }),
        });

        expect(editSpy).toHaveBeenCalledTimes(1);
        expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
        expect(appendMock).toHaveBeenCalledTimes(1);
        const write = appendMock.mock.calls[0]![0] as SessionTurnWrite;
        expect(write).toMatchObject({
          expectedRevision: 3, expectedGraphIdentityHash: null, expectedGraphAnalysisHash: null,
          modelVersion: { creation_kind: 'committed_mutation', source_turn_id: payload({}).turn_id },
        });
        expect(write.modelVersion!.graph_identity_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(write.modelVersion!.analysis_affecting_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenCalledWith('append_turn_atomic_v6', expect.objectContaining({
          p_expected_revision: 3, p_expected_base_known: true,
          p_expected_graph_identity_hash: null,
        }));
        expect(appendError).toBeInstanceOf(GraphStaleWriteError);
        expect(appendError).toMatchObject({ conflict_category: 'revision_conflict', cause: { code: 'OLRV1' } });
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({ code: 'revision_conflict', expected: 3, current: 4 });
        expect(successfulAppends).toHaveLength(0);
        expect(persisted).toEqual({ graph: rivalGraph, revision: 4 });
        expect(cache.invalidateAll).not.toHaveBeenCalled();
        assertRoutingContractHonoured({ expectsFinalised200: false });
      } finally {
        editSpy.mockRestore();
        claimTurnFenceMock.mockReset();
        appendMock.mockReset();
        appendMock.mockResolvedValue({ id: 'mock-row-id' });
        vi.unstubAllEnvs();
        _resetConfigCache();
      }
    });
  });
});
