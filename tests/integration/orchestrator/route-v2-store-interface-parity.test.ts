/**
 * Addendum 11: count every method at the route's consumer store interface.
 * The complete call-count snapshots are seeded only by this same harness in a
 * git archive of origin/staging. No inherited consumer calls are excluded,
 * including the finaliser's combined context reader.
 *
 * Like Addendum 7's route rows, the dispatcher is a port; both readers and the
 * append implementation are the real public SupabaseSessionStore.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { _resetConfigCache } from '../../../src/config/index.js';
import * as sessionStoreModule from '../../../src/orchestrator-v5/session/supabase-store.js';
import { SupabaseSessionStore } from '../../../src/orchestrator-v5/session/supabase-store.js';
import type { SessionTurnWrite } from '../../../src/orchestrator-v5/session/store.js';

const ports = vi.hoisted(() => ({ getStore: vi.fn(), dispatch: vi.fn() }));

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: ports.dispatch,
}));
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: ports.getStore,
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test', model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }], stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test', model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }], stop_reason: 'end_turn',
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
vi.mock('../../../src/config/index.js', async importOriginal => {
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

const telemetryEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
vi.mock('../../../src/utils/telemetry.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../../src/utils/telemetry.js')>();
  return {
    ...original,
    emit: (name: string, payload: Record<string, unknown>) => {
      telemetryEvents.push({ name, payload });
      return original.emit(name as never, payload as never);
    },
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

function payload(): Record<string, unknown> {
  return {
    kind: 'message', turn_id: '11111111-1111-4111-8111-111111111100',
    scenario_id: SCENARIO_ID, stage: 'analyse',
    message: 'Add opportunity cost of founder time as a risk',
    turn_class: 'propose', source: 'composer',
  };
}

function setFlagOff(): void {
  // This exact harness also runs on staging, which has no v6 test seam.
  (sessionStoreModule as Partial<typeof sessionStoreModule>).__setUseAppendV6ForTest?.(false);
}

function recordStoreMethods<T extends object>(target: T) {
  const calls: Record<string, number> = {};
  const store = new Proxy(target, {
    get(storeTarget, key) {
      const value = Reflect.get(storeTarget, key, storeTarget);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const method = String(key);
        calls[method] = (calls[method] ?? 0) + 1;
        // Observe consumers, preserving the actual store's internal delegation.
        return Reflect.apply(value, storeTarget, args);
      };
    },
  });
  return { store, calls };
}

describe('Addendum 11 flag OFF — route-v2 store-interface parity', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    setFlagOff();
    ports.getStore.mockReset();
    ports.dispatch.mockReset();
    telemetryEvents.length = 0;
    vi.stubEnv('OLUMI_ENV', 'staging');
    vi.stubEnv('CEE_REQUIRE_USER_JWT', 'false');
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
    vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'off');
    vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'off');
    vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
    _resetConfigCache();
  });
  afterEach(() => {
    setFlagOff();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  it.each(['success', 'read_failure'] as const)('%s — staging_method_counts', async (caseName) => {
    const reads: Array<{ table: string; columns: string }> = [];
    const mutationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const modelVersion = {
      mutation_id: mutationId,
      graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64),
      hash_algorithm: 'sha256', identity_projection_version: 'identity.v1',
      identity_normaliser_version: '1', graph_schema_version: 'graph_v3',
      actor_kind: 'unknown' as const, authored_by: null,
      creation_kind: 'committed_mutation' as const, source_turn_id: payload().turn_id as string,
    };
    const receipt = {
      ...modelVersion, version_id: versionId, version_number: 1,
      source_version_id: null, parent_version_id: null, root_version_id: versionId,
      undo_version_id: null, graph: VALID_GRAPH_STATE,
      event_id: `model_version_created_mutation_${mutationId}`,
    };
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: { turn_row_id: 'parity-turn-row', model_version_receipt: receipt }, error: null,
    }));
    const client = {
      rpc,
      from: (table: string) => {
        let columns: string | null = null;
        const query = {
          select(value: string) {
            columns = value;
            reads.push({ table, columns: value });
            return query;
          },
          eq: () => query, limit: () => query, update: () => query,
          not: () => query, is: () => query,
          maybeSingle: async () => caseName === 'read_failure'
            ? { data: null, error: { code: 'XX000', message: 'staging parity read failed' } }
            : { data: { graph: VALID_GRAPH_STATE, brief_text: null, revision: 'invalid' }, error: null },
          then(resolve: (value: { data: unknown[] | null; error: null }) => unknown) {
            return Promise.resolve({ data: columns === 'request_hash' ? [] : null, error: null }).then(resolve);
          },
        };
        return query;
      },
    };
    const publicStore = new SupabaseSessionStore(client as never, { invalidateAll: vi.fn() } as never, {
      defaultReadLimit: 20, graphCasRpc: 'enforce',
    });
    const observed = recordStoreMethods({
      claimTurnFence: async () => ({ scenarioId: SCENARIO_ID, turnId: payload().turn_id, generation: 1 }),
      append: (write: SessionTurnWrite) => publicStore.append(write),
      readRecent: async () => [],
      readFactsFor: async () => [],
      invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
      invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
      ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
      storeDraftGraph: async () => undefined,
      loadGraph: (scenarioId: string) => publicStore.loadGraph(scenarioId),
      loadGraphAndBriefText: (scenarioId: string) => publicStore.loadGraphAndBriefText(scenarioId),
    });
    ports.getStore.mockReturnValue(observed.store);
    ports.dispatch.mockImplementation(async (args: { graphState: unknown }) => {
      const write: SessionTurnWrite = {
        scenario_id: SCENARIO_ID, turn_id: payload().turn_id as string,
        turn_class: 'direct_answer', handler_id: null, request_hash: 'route-reload-parity',
        response_emitted: true, llm_calls_used: 0, duration_ms: 1, handler_facts: [],
        graph: args.graphState, expectedGraphIdentityHash: null, expectedGraphAnalysisHash: null,
        modelVersion,
      };
      await observed.store.append(write);
      return {
        response: {
          response_version: 2 as const,
          assistant_text: 'Applied edit — graph now has 2 nodes and 1 edges.',
          blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse' as const,
        },
        commitPerformed: true,
      };
    });

    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payload() });
    expect((sessionStoreModule as Partial<typeof sessionStoreModule>).useAppendV6?.() ?? false).toBe(false);
    expect(res.statusCode, res.body).toBe(200);
    expect(reads.filter(read => read.table === 'scenarios')).toEqual([
      { table: 'scenarios', columns: 'graph, brief_text' },
      { table: 'scenarios', columns: 'graph, brief_text' },
    ]);
    expect(ports.dispatch).toHaveBeenCalledTimes(caseName === 'success' ? 1 : 0);
    expect(rpc).toHaveBeenCalledTimes(caseName === 'success' ? 1 : 0);
    if (caseName === 'success') {
      expect(rpc.mock.calls[0]?.[0]).toBe('append_turn_atomic_v5');
      expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_expected_revision');
    }
    expect(telemetryEvents.some(event => event.name === 'v5.edit_graph.graph_state_unavailable'))
      .toBe(caseName === 'read_failure');

    expect(Object.keys(observed.calls).length).toBeGreaterThan(0);
    expect(observed.calls).toMatchSnapshot();
  });
});
