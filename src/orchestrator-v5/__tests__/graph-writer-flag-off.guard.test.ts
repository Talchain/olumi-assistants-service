/**
 * #2870's durable flag-OFF contract: no revision RPC, wire argument or SELECT,
 * and no new combined state reader on graph-only doors. No snapshot or seed.
 * Provider/remote database and route-dispatch ports are fake; direct dispatch,
 * commit, floor, route reload/finaliser and the public store are real.
 */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { SessionTurnWrite } from '../session/store.js';
import { runWithTurnFence } from '../session/turn-fence.js';

const ports = vi.hoisted(() => ({ draft: vi.fn(), edit: vi.fn(), store: vi.fn(), routeDispatch: vi.fn() }));

vi.mock('../../orchestrator/tools/edit-graph.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../orchestrator/tools/edit-graph.js')>(),
  handleEditGraph: ports.edit,
}));
vi.mock('../handlers/edit-graph-dispatch.js', async importOriginal => {
  const original = await importOriginal<typeof import('../handlers/edit-graph-dispatch.js')>();
  return { ...original, dispatchEditGraph: (...args: Parameters<typeof original.dispatchEditGraph>) =>
    ports.routeDispatch.getMockImplementation() ? ports.routeDispatch(...args) : original.dispatchEditGraph(...args) };
});
vi.mock('../session/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../session/index.js')>(), getSessionStore: ports.store,
}));
vi.mock('../../orchestrator/user-identity.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../orchestrator/user-identity.js')>(),
  resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../rolling-summary/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../rolling-summary/index.js')>(),
  getRollingSummaryStore: () => { throw new Error('Summary storage isolated'); },
}));
vi.mock('../../adapters/llm/router.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../adapters/llm/router.js')>(),
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }), chatWithTools: async () => ({ content: [{ type: 'text', text: 'text-only response' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) }),
  getAdapterWithResolution: () => ({ adapter: { name: 'test', model: 'test-model', chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }), chatWithTools: async () => ({ content: [{ type: 'text', text: 'text-only response' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) }, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' } }),
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

import { _resetConfigCache } from '../../config/index.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { setTestSink } from '../../utils/telemetry.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { SessionLRUCache } from '../session/cache.js';
import * as storeModule from '../session/supabase-store.js';



const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = '2026-10-08T13:00:00.000Z';
type Row = Record<string, unknown>;
type Select = { table: string; columns: string; options?: unknown };

function baseGraph() {
  return projectGraphForPersistence(GraphV3.parse({
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price',
        observed_state: { value: 0.49, source: 'brief_extraction' } },
      { id: 'opt_hold', kind: 'option', label: 'Hold price', is_baseline: true,
        interventions: { fac_price: { value: 0.49, source: 'brief_extraction',
          target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' } } } },
      { id: 'opt_raise', kind: 'option', label: 'Raise price',
        interventions: { fac_price: { value: 0.59, source: 'brief_extraction',
          target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' } } } },
    ],
    edges: [['opt_hold', 'fac_price'], ['opt_raise', 'fac_price'], ['fac_price', 'goal_revenue']]
      .map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1, effect_direction: 'positive' })),
    goal_node_id: 'goal_revenue',
  }));
}

/**
 * Only the remote Supabase boundary is fake. Selected columns are projected
 * exactly, table filters are honoured, and the append persists turn + graph +
 * facts atomically. No store method, commit or persisted-graph read is mocked.
 */
function harness(options: { failGraphReadAt?: number; missingV4?: boolean } = {}) {
  ports.edit.mockClear();
  ports.draft.mockClear();
  const tables: Record<string, Row[]> = {
    scenarios: [{ id: SCENARIO, user_id: null, graph: baseGraph(),
      brief_text: 'Compare holding £49 with raising the price to £59.',
      analysis_invalidated_at: null, revision: 7 }],
    v5_conversation_turns: [], v5_handler_facts: [], v5_turn_fence: [],
  };
  const selects: Select[] = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  let graphReads = 0;
  let graphReadFailures = 0;
  const client = {
    rpc: vi.fn(async (name: string, args: Row) => {
      rpcCalls.push({ name, args: structuredClone(args) });
      if (name === 'ensure_scenario_exists') return { data: null, error: null };
      if (name === 'v5_claim_turn_fence') return { data: 1, error: null };
      if (name === 'v5_evaluate_turn_fence') return { data: { claimed: true, stopped: false, generation: 3, max_generation: 3 }, error: null };
      if (options.missingV4 && name === 'append_turn_atomic_v4') return { data: null, error: { code: 'PGRST202' } };
      if (!name.startsWith('append_turn_atomic_')) throw new Error(`Unexpected RPC: ${name}`);
      tables.v5_conversation_turns!.push({
        id: ROW, scenario_id: args.p_scenario_id, user_id: null, turn_id: args.p_turn_id,
        turn_class: args.p_turn_class, handler_id: args.p_handler_id,
        request_hash: args.p_request_hash, response_emitted: args.p_response_emitted,
        llm_calls_used: args.p_llm_calls_used, duration_ms: args.p_duration_ms,
        created_at: NOW, user_message: args.p_user_message, assistant_message: args.p_assistant_message,
        pending_actions: args.p_pending_actions, coaching_state: args.p_coaching_state,
      });
      if (args.p_graph !== null) tables.scenarios![0]!.graph = structuredClone(args.p_graph);
      for (const [i, fact] of (args.p_handler_facts as Row[]).entries()) {
        tables.v5_handler_facts!.push({ ...structuredClone(fact),
          id: `fact-${i}`, scenario_id: SCENARIO, v5_conversation_turn_id: ROW, created_at: NOW });
      }
      return { data: name === 'append_turn_atomic_v5'
        ? { turn_row_id: ROW, model_version_receipt: null } : ROW, error: null };
    }),
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let columns = '*';
      let selectOptions: { count?: string; head?: boolean } | undefined;
      let limit = Infinity;
      let update: Row | null = null;
      const run = () => {
        if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
        if (table === 'scenarios' && columns.split(',').map(c => c.trim()).includes('graph')) {
          graphReads += 1;
          if (options.failGraphReadAt === graphReads) {
            graphReadFailures += 1;
            return { data: null, error: { code: 'PARITY_READ_FAILURE', message: 'initial brief read unavailable' } };
          }
        }
        const filtered = tables[table]!.filter(r => filters.every(f => f(r)));
        if (update) {
          for (const row of filtered) Object.assign(row, update);
          return { data: null, error: null };
        }
        const rows = filtered.slice(0, limit).map(r => columns === '*' ? structuredClone(r)
          : Object.fromEntries(columns.split(',').map(c => [c.trim(), structuredClone(r[c.trim()])])));
        return { data: selectOptions?.head ? null : rows, error: null,
          ...(selectOptions?.count ? { count: filtered.length } : {}) };
      };
      const chain = {
        select(value: string, opts?: typeof selectOptions) {
          columns = value; selectOptions = opts;
          selects.push({ table, columns: value, ...(opts === undefined ? {} : { options: opts }) });
          return chain;
        },
        eq(key: string, value: unknown) { filters.push(r => r[key] === value); return chain; },
        neq(key: string, value: unknown) { filters.push(r => r[key] !== value); return chain; },
        in(key: string, values: unknown[]) { filters.push(r => values.includes(r[key])); return chain; },
        not(key: string, op: string, value: unknown) {
          filters.push(r => op === 'is' ? r[key] != null
            : op === 'like' ? !String(r[key]).endsWith(String(value).replace(/^%/, ''))
              : r[key] !== value);
          return chain;
        },
        is(key: string, value: unknown) { filters.push(r => value === null ? r[key] == null : r[key] === value); return chain; },
        order() { return chain; },
        limit(value: number) { limit = value; return chain; },
        update(value: Row) { update = value; return chain; },
        abortSignal() { return chain; },
        maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve: (result: ReturnType<typeof run>) => unknown, reject?: (error: unknown) => unknown) {
          try { return Promise.resolve(resolve(run())); } catch (error) { return Promise.resolve(reject?.(error)); }
        },
      };
      return chain;
    },
  };
  const target = new storeModule.SupabaseSessionStore(client as never,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 }),
    { defaultReadLimit: 20, graphCasMode: 'off', graphCasRpc: 'enforce' });
  const methods: Record<string, number> = {};
  const store = new Proxy(target, {
    get(storeTarget, key) {
      const value = Reflect.get(storeTarget, key, storeTarget);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const method = String(key);
        methods[method] = (methods[method] ?? 0) + 1;
        // Record consumers; internal loadGraph delegation remains on the raw target.
        return Reflect.apply(value, storeTarget, args);
      };
    },
  });
  ports.store.mockReturnValue(store);
  return { client, store, methodCounts: () => ({ ...methods }), selects, rpcCalls, tables, get graphReadFailures() { return graphReadFailures; },
 };
}



beforeEach(() => {
  storeModule.__setUseAppendV6ForTest(false);
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_REQUIRE_USER_JWT', 'false');
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'off');
  vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'off');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
  vi.stubEnv('CEE_V6_DUAL_DRAFT_ENABLED', 'false');
  _resetConfigCache();
  setTestSink(() => undefined);
});
afterEach(() => {
  storeModule.__setUseAppendV6ForTest(false);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  _resetConfigCache();
  setTestSink(null);
});

vi.mock('../../config/index.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../config/index.js')>();
  return { ...original, config: new Proxy(original.config as object, {
    get(target, key) {
      if (key !== 'features') return Reflect.get(target, key);
      return new Proxy(Reflect.get(target, key) as object, {
        get(features, feature) { return feature === 'pipelineV4Enabled' ? false : Reflect.get(features, feature); },
      });
    },
  }) };
});

// Addenda 14/15: strict scenario-state helpers reach this consumer method; register/system/adoption/intervention/apply never call it.












describe('flag-OFF legacy unversioned RPC reachability', () => {
  it.each([
    { mode: 'off' as const, fenced: false, missingV4: false, rpcs: ['append_turn_atomic_v2'] },
    { mode: 'enforce' as const, fenced: false, missingV4: false, rpcs: ['append_turn_atomic_v3'] },
    { mode: 'enforce' as const, fenced: true, missingV4: false, rpcs: ['append_turn_atomic_v4'] },
    { mode: 'enforce' as const, fenced: true, missingV4: true, rpcs: ['append_turn_atomic_v4', 'append_turn_atomic_v3'] },
  ])('keeps $rpcs reachable without revision CAS', async ({ mode, fenced, missingV4, rpcs }) => {
    const h = harness({ missingV4 });
    const store = new storeModule.SupabaseSessionStore(h.client as never,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 }),
      { defaultReadLimit: 20, graphCasMode: 'off', graphCasRpc: mode });
    const write: SessionTurnWrite = { scenario_id: SCENARIO, turn_id: TURN, turn_class: 'direct_answer',
      handler_id: null, request_hash: 'rollback', response_emitted: true, llm_calls_used: 0,
      duration_ms: 1, handler_facts: [], graph: baseGraph() };
    const append = () => store.append(write);
    const result = fenced
      ? await runWithTurnFence({ scenarioId: SCENARIO, turnId: TURN, generation: 3 }, append)
      : await append();
    expect(result).toMatchObject({ id: ROW });
    expect(h.rpcCalls.filter(call => call.name.startsWith('append_turn_atomic_')).map(call => call.name)).toEqual(rpcs);
    expect(h.rpcCalls.every(call => !Object.hasOwn(call.args, 'p_expected_revision'))).toBe(true);
    expect(h.tables.v5_conversation_turns).toHaveLength(1);
  });
});
