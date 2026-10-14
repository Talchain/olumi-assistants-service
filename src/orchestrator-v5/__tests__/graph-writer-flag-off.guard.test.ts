/**
 * #2870's durable flag-OFF contract: no revision RPC, wire argument or SELECT,
 * and no new combined state reader on graph-only doors. No snapshot or seed.
 * Provider/remote database and route-dispatch ports are fake; direct dispatch,
 * commit, floor, route reload/finaliser and the public store are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTurnFence } from '../session/turn-fence.js';
import type { SessionTurnWrite } from '../session/store.js';
import Fastify, { type FastifyRequest } from 'fastify';
import type { DraftGraphResult } from '../../orchestrator/tools/draft-graph.js';
import type { EditGraphResult } from '../../orchestrator/tools/edit-graph.js';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const ports = vi.hoisted(() => ({ draft: vi.fn(), edit: vi.fn(), store: vi.fn(), routeDispatch: vi.fn() }));
vi.mock('../../orchestrator/tools/draft-graph.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../orchestrator/tools/draft-graph.js')>(),
  handleDraftGraph: ports.draft,
}));
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

import * as storeModule from '../session/supabase-store.js';
import { SessionLRUCache } from '../session/cache.js';
import { _resetConfigCache } from '../../config/index.js';
import { setTestSink } from '../../utils/telemetry.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { computeGraphIdentityHash } from '../context/graph-identity.js';
import { dispatchDraftGraph } from '../handlers/draft-graph-dispatch.js';
import { dispatchEditGraph } from '../handlers/edit-graph-dispatch.js';
import { dispatchSystemEvent, dispatchOptionLevelsBatch, commitOptionLevelsInProcess, holdAddRiskInProcess, holdAddFactorInProcess, commitLimitEditInProcess, commitLimitAddInProcess, commitOptionStatusInProcess } from '../system-events/dispatch.js';
import { createApplyOperations, modelRevisionOf } from '../apply-operations.js';
import registerRoute from '../../routes/assist.v1.scenario-graph-register.js';

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

function message(message = 'Rename Price to Price (revised)') {
  return { kind: 'message' as const, scenario_id: SCENARIO, turn_id: TURN,
    stage: 'analyse' as const, message, turn_class: 'frame' as const, source: 'composer' as const };
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


import { ceeOrchestratorRouteV2 } from '../../orchestrator/route-v2.js';
import { USER_EDIT_SOURCE } from '../../orchestrator/canonicalise-value-ops.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { commitOlumiOptionAdoptionInProcess } from '../system-events/olumi-option-adoption.js';
import { executeOptionInterventionBatch, executeOptionInterventionEdit } from '../system-events/option-intervention-edit.js';

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
const FLAG_OFF_FORBIDDEN_STATE_READERS = ['loadGraphAndBriefText'] as const;
const FLAG_OFF_FORBIDDEN_RPCS = ['append_turn_atomic_v6', 'append_turn_atomic_v4r'] as const;

let versionsEnabledForRow = true;
function expectLegacyAppend(h: ReturnType<typeof harness>, door = 'rollback') {
  const appends = h.rpcCalls.filter(call => call.name.startsWith('append_turn_atomic_') && call.args.p_graph != null);
  expect(appends.length, door).toBeGreaterThan(0);
  for (const call of appends) expect(versionsEnabledForRow ? ['append_turn_atomic_v5']
    : ['append_turn_atomic_v4', 'append_turn_atomic_v3', 'append_turn_atomic_v2'], door).toContain(call.name);
}

type Harness = ReturnType<typeof harness>;
function assertFlagOff(h: Harness, door: string, forbidStateReaders: boolean): void {
  expect(storeModule.useAppendV6(), door).toBe(false);
  if (h.rpcCalls.some(call => call.name.startsWith('append_turn_atomic_') && call.args.p_graph != null)) expectLegacyAppend(h, door);
  expect(Object.keys(h.methodCounts()).length, `${door}: consumer recorder reached`).toBeGreaterThan(0);
  expect(h.rpcCalls.filter(call => FLAG_OFF_FORBIDDEN_RPCS.some(name => name === call.name)).map(call => call.name), `${door}: forbidden revision RPC`).toEqual([]);
  expect(h.rpcCalls.filter(call => Object.hasOwn(call.args, 'p_expected_revision')), `${door}: revision argument`).toEqual([]);
  expect(h.selects.filter(read => read.table === 'scenarios' && (/\brevision\b/.test(read.columns) || read.columns.split(',').some(column => column.trim() === '*'))), `${door}: revision SELECT`).toEqual([]);
  const calls = h.methodCounts();
  if (door.startsWith('edit') || door.startsWith('route-v2')) {
    expect(calls.loadGraphAndBriefText, `${door}: existing combined reader reached`).toBeGreaterThan(0);
  }
  if (door.startsWith('route-v2')) expect(calls.loadGraph, `${door}: reload reached`).toBeGreaterThan(0);
  if (forbidStateReaders) {
    expect(FLAG_OFF_FORBIDDEN_STATE_READERS.filter(name => (calls[name] ?? 0) !== 0), `${door}: forbidden state reader`).toEqual([]);
    expect(calls.loadGraph, `${door}: canonical graph-only read reached`).toBeGreaterThan(0);
  }
}

describe.each([true, false])('graph writer rollback flag-OFF contract (model versions=%s)', versionsEnabled => {
  beforeEach(() => {
    versionsEnabledForRow = versionsEnabled;
    vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', String(versionsEnabled));
    _resetConfigCache();
  });
  it('keeps the PR-owned revision calls absent across every door family', async () => {
    // draft
    await (async () => {
    const h = harness();
    ports.draft.mockResolvedValue({ blocks: [], assistantText: 'Draft output available.', latencyMs: 1,
      strengthenItems: [], coachingSummary: null, coachingWideningLog: null,
      coachingBiasSignals: null, draftWarnings: [], graphOutput: baseGraph(),
    } satisfies DraftGraphResult);
    const result = await dispatchDraftGraph({ payload: message('Compare raising the price to £59 with holding £49.'),
      requestId: 'flag-off-draft', request: { headers: {} } as FastifyRequest });
    expect(result.commitPerformed).toBe(true);
    expectLegacyAppend(h);
    assertFlagOff(h, 'draft', false);
    })();
    // edit — mismatched ingress
    await (async () => {
    const h = harness();
    const client = GraphStateIngressSchema.parse(baseGraph());
    const price = client.nodes.find(n => n.id === 'fac_price')!;
    price.observed_state = { value: 0.2 };
    const server = GraphStateIngressSchema.parse(h.tables.scenarios![0]!.graph);
    expect(computeGraphIdentityHash(client)?.value).not.toBe(computeGraphIdentityHash(server)?.value);
    const edited = structuredClone(client);
    edited.nodes.find(n => n.id === 'fac_price')!.label = 'Price (revised)';
    ports.edit.mockResolvedValue({ blocks: [], assistantText: 'Renamed Price.', latencyMs: 1,
      appliedGraph: edited as unknown as EditGraphResult['appliedGraph'], wasRejected: false,
      appliedChanges: { summary: 'Renamed Price.', changes: [{ label: 'Price', description: 'Renamed.', element_ref: 'fac_price' }], rerun_recommended: false },
      operations: [{ op: 'update_node', path: 'fac_price', value: { label: 'Price (revised)' } }],
      operation_meta: [{ impact: 'low', rationale: '' }],
    } as EditGraphResult);
    const result = await dispatchEditGraph({ payload: message(), requestId: 'flag-off-edit',
      request: { headers: {} } as FastifyRequest, graphState: client, analysisState: null });
    expect(result.commitPerformed).toBe(true);
    expect(ports.edit).toHaveBeenCalledTimes(1);
    expectLegacyAppend(h);
    assertFlagOff(h, 'edit — mismatched ingress', false);
    })();
    // edit — brief read recovery
    await (async () => {
    const h = harness({ failGraphReadAt: 1 });
    const client = GraphStateIngressSchema.parse(baseGraph());
    const edited = structuredClone(client);
    edited.nodes.find(n => n.id === 'fac_price')!.label = 'Price (revised)';
    ports.edit.mockResolvedValue({ blocks: [], assistantText: 'Renamed Price.', latencyMs: 1,
      appliedGraph: edited as unknown as EditGraphResult['appliedGraph'], wasRejected: false,
      appliedChanges: { summary: 'Renamed Price.', changes: [{ label: 'Price', description: 'Renamed.', element_ref: 'fac_price' }], rerun_recommended: false },
      operations: [{ op: 'update_node', path: 'fac_price', value: { label: 'Price (revised)' } }],
      operation_meta: [{ impact: 'low', rationale: '' }],
    } as EditGraphResult);
    const result = await dispatchEditGraph({ payload: message(), requestId: 'flag-off-edit-read-recovery',
      request: { headers: {} } as FastifyRequest, graphState: client, analysisState: null });
    expect(h.graphReadFailures).toBe(1);
    expect(result.commitPerformed).toBe(true);
    expect(ports.edit).toHaveBeenCalledTimes(1);
    expectLegacyAppend(h);
    assertFlagOff(h, 'edit — brief read recovery', false);
    })();
    // system event — factor value
    await (async () => {
    const h = harness();
    const payload = { kind: 'system_event', scenario_id: SCENARIO, turn_id: TURN,
      stage: 'analyse', event: { kind: 'factor_value_edit', target_id: 'fac_price', value: 0.7, field: 'value' },
    } as SystemEventTurnPayload;
    const result = await dispatchSystemEvent({ payload, requestId: 'flag-off-system' });
    expect(result.commitPerformed).toBe(true);
    expectLegacyAppend(h);
    assertFlagOff(h, 'system event — factor value', true);
    })();
    // register
    await (async () => {
    const h = harness();
    const imported = baseGraph();
    imported.nodes.find(n => n.id === 'fac_price')!.observed_state!.value = 0.65;
    const app = Fastify();
    await registerRoute(app);
    try {
      const result = await app.inject({ method: 'POST',
        url: `/assist/v1/scenarios/${SCENARIO}/graph/register`,
        payload: { graph: imported, operation_id: TURN } });
      expect(result.statusCode, result.body).toBe(200);
      expectLegacyAppend(h);
      assertFlagOff(h, 'register', true);
    } finally { ports.routeDispatch.mockReset(); await app.close(); }
    })();
    // replacement apply
    await (async () => {
    const h = harness();
    const apply = createApplyOperations({ scenarioId: SCENARIO, requestId: 'flag-off-apply', store: h.store });
    const result = await apply({ proposalId: 'flag-off-proposal', idempotencyKey: TURN,
      modelRevision: modelRevisionOf(baseGraph())!, reconcile: true,
      operations: [{ kind: 'set_option_effect', summary: 'Raise the price intervention on the increase option',
        detail: { operations: [{ op: 'update_node', path: '/nodes/opt_raise/data/interventions/fac_price',
          value: { value: 0.65 }, old_value: null, impact: 'moderate',
          rationale: 'The user confirmed the price intervention.' }] } }],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expectLegacyAppend(h);
    assertFlagOff(h, 'replacement apply', true);
    })();

    // Every system-event graph writer, including the shared factor/range read.
    const hash = computeAnalysisAffectingGraphHash(baseGraph() as never)!;
    const events = [
      { kind: 'factor_value_edit', target_id: 'fac_price', value: 0.55 },
      { kind: 'prior_range_edit', target_id: 'fac_price', range_min: 0.4, range_max: 0.6, distribution: 'uniform' },
      { kind: 'edge_strength_edit', from: 'fac_price', to: 'goal_revenue', magnitude: 0.7,
        direction_intent: 'preserve', expected: { mean: 0.5, effect_direction: 'positive' }, intent: 'set' },
      { kind: 'structural_delete', removed_node_ids: ['opt_raise'], removed_edges: [], base_graph_hash: hash },
      { kind: 'structural_rename', node_id: 'fac_price', label: 'Price revised', expected_label: 'Price', base_graph_hash: hash },
      { kind: 'structural_add', node_id: 'fac_new', node_kind: 'factor', label: 'New factor', base_graph_hash: hash },
      { kind: 'structural_add_edge', from: 'opt_hold', to: 'goal_revenue', magnitude: 0.4, effect_direction: 'positive', base_graph_hash: hash },
      { kind: 'option_intervention_edit', option_id: 'opt_raise', factor_id: 'fac_price', value: 0.65, base_graph_hash: hash },
      { kind: 'goal_target_edit', goal_node_id: 'goal_revenue', constraint_type: 'at_least', raw_value: 100, unit: '£', base_graph_hash: hash },
      { kind: 'option_status_edit', option_node_id: 'opt_raise', expected_status: 'feasible', status: 'removed', base_graph_hash: hash },
    ];
    for (const event of events) {
      vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'shadow');
      vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'enforce');
      _resetConfigCache();
      const h = harness();
      const result = await dispatchSystemEvent({ payload: { kind: 'system_event', scenario_id: SCENARIO,
        turn_id: TURN, stage: 'analyse', event } as SystemEventTurnPayload, requestId: `flag-off-${event.kind}` });
      assertFlagOff(h, `system event — ${event.kind}`, true);
      expect(result.commitPerformed, `${event.kind}: successful append`).toBe(true);
      expectLegacyAppend(h, event.kind);
    }
    vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'off');
    vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'off');
    _resetConfigCache();

    await (async () => {
      const h = harness();
      const result = await executeOptionInterventionBatch({ scenarioId: SCENARIO, turnId: TURN,
        requestId: 'flag-off-intervention-batch', stage: 'analyse', requestHash: 'sha256:closed-set',
        freshness: 'none', hasExistingAnalysis: false, expectedGraphHash: hash,
        targets: [{ optionId: 'opt_raise', factorId: 'fac_price', modelValue: 0.65 }],
      }, h.store);
      assertFlagOff(h, 'intervention batch', true);
      expect(result.kind, JSON.stringify(result)).toBe('committed');
    })();
    await (async () => {
      const h = harness();
      const graph = baseGraph();
      const option = graph.nodes.find(node => node.id === 'opt_raise')!;
      option.proposed_by = 'olumi';
      h.tables.scenarios![0]!.graph = projectGraphForPersistence(graph);
      const canonical = h.tables.scenarios![0]!.graph as typeof graph;
      const result = await commitOlumiOptionAdoptionInProcess({ scenario_id: SCENARIO, turn_id: TURN,
        base_graph_hash: computeAnalysisAffectingGraphHash(canonical as never)!,
        expected_graph_identity_hash: computeGraphIdentityHash(canonical)!.value,
        option_id: 'opt_raise', expected_label: 'Raise price', expected_interventions: option.interventions!,
      }, 'flag-off-adoption');
      assertFlagOff(h, 'option adoption', true);
      expect(result.status, JSON.stringify(result)).toBe('committed');
    })();


    await (async () => {
      const h = harness();
      const result = await executeOptionInterventionEdit({ scenarioId: SCENARIO, turnId: TURN,
        requestId: 'flag-off-intervention-single', stage: 'analyse', requestHash: 'sha256:closed-set',
        freshness: 'none', hasExistingAnalysis: false, expectedGraphHash: hash,
        optionId: 'opt_raise', factorId: 'fac_price', modelValue: 0.65,
      }, h.store);
      assertFlagOff(h, 'intervention single', true);
      expect(result.kind, JSON.stringify(result)).toBe('committed');
    })();
    await (async () => {
      const h = harness();
      const result = await dispatchOptionLevelsBatch({ scenario_id: SCENARIO, turn_id: TURN, stage: 'analyse', requestHash: 'sha256:closed-set' },
        { targets: [{ optionId: 'opt_raise', factorId: 'fac_price', modelValue: 0.65 }], base_graph_hash: hash }, 'flag-off-levels-batch');
      assertFlagOff(h, 'option levels batch', true);
      expect(result.commitPerformed, JSON.stringify(result)).toBe(true);
    })();
    await (async () => {
      const h = harness();
      const result = await commitOptionLevelsInProcess({ scenario_id: SCENARIO, turn_id: TURN, base_graph_hash: hash,
        links: [], levels: [{ option_id: 'opt_raise', factor_id: 'fac_price', value: 0.65, author: 'user_specified' }],
      }, 'flag-off-levels-inprocess');
      assertFlagOff(h, 'option levels in process', true);
      expect(result.status, JSON.stringify(result)).toBe('committed');
    })();
    await (async () => {
      const h = harness();
      const result = await commitOptionStatusInProcess({ scenario_id: SCENARIO, turn_id: TURN,
        option_node_id: 'opt_raise', expected_status: 'feasible', status: 'removed', base_graph_hash: hash }, 'flag-off-status-inprocess');
      assertFlagOff(h, 'option status in process', true);
      expect(result.status, JSON.stringify(result)).toBe('written');
    })();
    await (async () => {
      vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
      _resetConfigCache();
      const h = harness();
      const result = await holdAddRiskInProcess({ scenario_id: SCENARIO, turn_id: TURN, base_graph_hash: hash,
        risk: { id: 'risk_cost', label: 'Cost overrun' },
        links: [{ from_id: 'fac_price', effect_direction: 'positive' }, { to_id: 'goal_revenue', effect_direction: 'negative' }],
      }, 'flag-off-risk-hold');
      assertFlagOff(h, 'hold risk', true);
      expect(result.status, JSON.stringify(result)).toBe('held');
    })();
    await (async () => {
      const h = harness();
      const graph = GraphV3.parse({ ...baseGraph(), nodes: [...baseGraph().nodes, { id: 'out_demand', kind: 'outcome', label: 'Demand' }],
        edges: [...baseGraph().edges, { from: 'out_demand', to: 'goal_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] });
      h.tables.scenarios![0]!.graph = projectGraphForPersistence(graph);
      const result = await holdAddFactorInProcess({ scenario_id: SCENARIO, turn_id: TURN,
        base_graph_hash: computeAnalysisAffectingGraphHash(h.tables.scenarios![0]!.graph as never)!,
        factors: [{ id: 'fac_staff', label: 'Staff', link: { to_id: 'out_demand', effect_direction: 'positive' },
          observed_state: { value: 0.5, source: USER_EDIT_SOURCE } }],
      }, 'flag-off-factor-hold');
      assertFlagOff(h, 'hold factor', true);
      expect(result.status, JSON.stringify(result)).toBe('held');
    })();
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
    _resetConfigCache();
    for (const add of [false, true]) {
      const h = harness();
      const graph = GraphV3.parse({ ...baseGraph(), nodes: baseGraph().nodes.map(node => node.id === 'fac_price'
        ? { ...node, quantity_frame: 'level', observed_state: { ...node.observed_state, unit: '£' } } : node),
        ...(!add ? { goal_constraints: [{ constraint_id: 'price_limit', node_id: 'fac_price', operator: '<=', value: 0.55,
          unit: '£', value_frame: 'level', provenance: 'explicit', label: 'Price' }] } : {}),
      });
      h.tables.scenarios![0]!.graph = projectGraphForPersistence(graph);
      const input = { scenario_id: SCENARIO, turn_id: TURN, node_id: 'fac_price', operator: '<=' as const, raw_value: 0.6,
        base_graph_hash: computeAnalysisAffectingGraphHash(h.tables.scenarios![0]!.graph as never)! };
      const result = add ? await commitLimitAddInProcess({ ...input, unit: '£', source_quote: 'Price at most £0.60', value_frame: 'level' }, 'flag-off-limit-add')
        : await commitLimitEditInProcess(input, 'flag-off-limit-edit');
      assertFlagOff(h, `limit ${add ? 'add' : 'edit'}`, true);
      expect(result.status, JSON.stringify(result)).toBe('committed');
    }

    for (const failRead of [false, true]) {
      ports.edit.mockClear();
      const h = harness(failRead ? { failGraphReadAt: 1 } : {});
      ports.routeDispatch.mockReset();
      // As in the relocated route witness, the dispatcher is a port; reload/finaliser/store remain real.
      ports.routeDispatch.mockImplementation(async (args: { graphState: unknown }) => {
        await h.store.append({ scenario_id: SCENARIO, turn_id: TURN, turn_class: 'direct_answer',
          handler_id: null, request_hash: 'route-reload-closed-set', response_emitted: true, llm_calls_used: 0, duration_ms: 1, handler_facts: [],
          graph: args.graphState, expectedGraphIdentityHash: null, expectedGraphAnalysisHash: null,
          ...(versionsEnabled ? { modelVersion: { mutation_id: TURN, graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64),
            hash_algorithm: 'sha256', identity_projection_version: 'identity.v1', identity_normaliser_version: '1', graph_schema_version: 'graph_v3',
            actor_kind: 'unknown', authored_by: null, creation_kind: 'committed_mutation', source_turn_id: TURN } } : {}),
        });
        return { response: { response_version: 2, assistant_text: 'Applied edit.', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse' }, commitPerformed: true };
      });
      const edited = GraphStateIngressSchema.parse(baseGraph());
      edited.nodes.find(n => n.id === 'fac_price')!.label = 'Price (revised)';
      ports.edit.mockResolvedValue({ blocks: [], assistantText: 'Renamed Price.', latencyMs: 1,
        appliedGraph: edited as unknown as EditGraphResult['appliedGraph'], wasRejected: false,
        appliedChanges: { summary: 'Renamed Price.', changes: [{ label: 'Price', description: 'Renamed.', element_ref: 'fac_price' }], rerun_recommended: false },
        operations: [{ op: 'update_node', path: 'fac_price', value: { label: 'Price (revised)' } }],
        operation_meta: [{ impact: 'low', rationale: '' }],
      } as EditGraphResult);
      const app = Fastify();
      await ceeOrchestratorRouteV2(app);
      try {
        const result = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: { ...message('Add opportunity cost of founder time as a risk'), turn_class: 'propose' } });
        expect(result.statusCode, result.body).toBe(200);
        expect(ports.routeDispatch).toHaveBeenCalledTimes(failRead ? 0 : 1);
        if (failRead) expect(h.graphReadFailures).toBe(1);
        else expectLegacyAppend(h);
        assertFlagOff(h, `route-v2 reload — ${failRead ? 'read failure' : 'success'}`, false);
      } finally { ports.routeDispatch.mockReset(); await app.close(); }
    }
  }, 120_000);
});


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
