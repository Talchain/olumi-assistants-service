/**
 * Addendum 11: outer store-interface method call-count parity.
 * Seed these snapshots only with this same harness on a git archive of
 * origin/staging. Count every consumer method, including inherited
 * brief/context combined reads, and compare the complete map exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import type { DraftGraphResult } from '../../src/orchestrator/tools/draft-graph.js';
import type { EditGraphResult } from '../../src/orchestrator/tools/edit-graph.js';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const ports = vi.hoisted(() => ({ draft: vi.fn(), edit: vi.fn(), store: vi.fn() }));
vi.mock('../../src/orchestrator/tools/draft-graph.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/orchestrator/tools/draft-graph.js')>(),
  handleDraftGraph: ports.draft,
}));
vi.mock('../../src/orchestrator/tools/edit-graph.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/orchestrator/tools/edit-graph.js')>(),
  handleEditGraph: ports.edit,
}));
vi.mock('../../src/orchestrator-v5/session/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>(), getSessionStore: ports.store,
}));
vi.mock('../../src/orchestrator/user-identity.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/orchestrator/user-identity.js')>(),
  resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../../src/orchestrator-v5/rolling-summary/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/orchestrator-v5/rolling-summary/index.js')>(),
  getRollingSummaryStore: () => { throw new Error('Summary storage isolated'); },
}));
vi.mock('../../src/adapters/llm/router.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/adapters/llm/router.js')>(),
  getAdapter: () => ({}),
  getAdapterWithResolution: () => { throw new Error('Unexpected provider call'); },
}));

import * as storeModule from '../../src/orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { _resetConfigCache } from '../../src/config/index.js';
import { setTestSink } from '../../src/utils/telemetry.js';
import { GraphV3 } from '../../src/schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../src/orchestrator-v5/boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeGraphIdentityHash } from '../../src/orchestrator-v5/context/graph-identity.js';
import { dispatchDraftGraph } from '../../src/orchestrator-v5/handlers/draft-graph-dispatch.js';
import { dispatchEditGraph } from '../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { dispatchSystemEvent } from '../../src/orchestrator-v5/system-events/dispatch.js';
import { createApplyOperations, modelRevisionOf } from '../../src/orchestrator-v5/apply-operations.js';
import registerRoute from '../../src/routes/assist.v1.scenario-graph-register.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = '2026-10-08T13:00:00.000Z';
const INTERFACE_FILES = [
  'scripts/parity-evidence/flag-off-store-interface-parity.evidence.ts',
  'scripts/parity-evidence/route-v2-store-interface-parity.evidence.ts',
] as const;
const INTERFACE_SUITES = [
  'Addendum 11 flag OFF — outer store-interface parity with origin/staging',
  'Addendum 11 flag OFF — route-v2 store-interface parity',
] as const;
// Independent Addendum 10 census: never derive this list from discovered tests.
const DOOR_CASES = [
  { name: 'Draft', file: 0, title: 'draft preserves staging RPC arguments, ordered reads and successful commit [staging_method_counts]' },
  { name: 'Edit — mismatched client identity', file: 0, title: 'edit mismatched client identity preserves staging RPC arguments, reads and success [staging_method_counts]' },
  { name: 'Edit — initial brief outage, later save recovery', file: 0, title: 'edit initial brief read outage then save recovery preserves staging arguments, reads and success [staging_method_counts]' },
  { name: 'Route-v2 reload — success', file: 1, title: 'success — staging_method_counts' },
  { name: 'Route-v2 reload — read failure', file: 1, title: 'read_failure — staging_method_counts' },
  { name: 'System event — factor value commit', file: 0, title: 'system event commit preserves staging RPC arguments, ordered reads and success [staging_method_counts]' },
  { name: 'Register', file: 0, title: 'register preserves staging RPC arguments, ordered reads and success [staging_method_counts]' },
  { name: 'Replacement Apply', file: 0, title: 'replacement apply preserves staging RPC arguments, ordered reads and verified success [staging_method_counts]' },
] as const;

function stagingSeeds(): string[] {
  return INTERFACE_FILES.map(file => {
    const snapshot = file.replace(/([^/]+)$/, '__snapshots__/$1.snap');
    return readFileSync(resolve(snapshot), 'utf8');
  });
}

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
function harness(options: { failGraphReadAt?: number; refuseAppend?: boolean } = {}) {
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
      if (!name.startsWith('append_turn_atomic_')) throw new Error(`Unexpected RPC: ${name}`);
      if (options.refuseAppend) return { data: null, error: { code: 'OLGC1', message: 'stale graph write' } };
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
        // Observe the consumer interface, preserving staging's internal
        // loadGraph -> loadGraphAndBriefText delegation on the raw target.
        return Reflect.apply(value, storeTarget, args);
      };
    },
  });
  ports.store.mockReturnValue(store);
  return { store, methodCounts: () => ({ ...methods }), selects, rpcCalls, tables, get graphReadFailures() { return graphReadFailures; },
    witness: (outcome: unknown) => ({ select_count: selects.length, selects, rpcCalls,
      outcome, durable_turn_count: tables.v5_conversation_turns!.length }) };
}

function message(message = 'Rename Price to Price (revised)') {
  return { kind: 'message' as const, scenario_id: SCENARIO, turn_id: TURN,
    stage: 'analyse' as const, message, turn_class: 'frame' as const, source: 'composer' as const };
}

beforeEach(() => {
  // The optional lookup lets this exact file run against origin/staging,
  // where the v6 seam does not exist and v5 is its sole versioned writer.
  (storeModule as Partial<typeof storeModule>).__setUseAppendV6ForTest?.(false);
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
  (storeModule as Partial<typeof storeModule>).__setUseAppendV6ForTest?.(false);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  _resetConfigCache();
  setTestSink(null);
});

function assertInterface(methodCounts: Record<string, number>): void {
  expect((storeModule as Partial<typeof storeModule>).useAppendV6?.() ?? false).toBe(false);
  expect(Object.keys(methodCounts).length).toBeGreaterThan(0);
  expect(methodCounts).toMatchSnapshot();
}

describe('Addendum 11 flag OFF — outer store-interface parity with origin/staging', () => {
  it('draft preserves staging RPC arguments, ordered reads and successful commit [staging_method_counts]', async () => {
    const h = harness();
    ports.draft.mockResolvedValue({ blocks: [], assistantText: 'Draft output available.', latencyMs: 1,
      strengthenItems: [], coachingSummary: null, coachingWideningLog: null,
      coachingBiasSignals: null, draftWarnings: [], graphOutput: baseGraph(),
    } satisfies DraftGraphResult);
    const result = await dispatchDraftGraph({ payload: message('Compare raising the price to £59 with holding £49.'),
      requestId: 'flag-off-draft', request: { headers: {} } as FastifyRequest });
    expect(result.commitPerformed).toBe(true);
    expect(h.rpcCalls.some(c => c.name === 'append_turn_atomic_v5')).toBe(true);
    assertInterface(h.methodCounts());
  });

  it('edit mismatched client identity preserves staging RPC arguments, reads and success [staging_method_counts]', async () => {
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
    expect(h.rpcCalls.some(c => c.name === 'append_turn_atomic_v5')).toBe(true);
    assertInterface(h.methodCounts());
  });

  it('edit initial brief read outage then save recovery preserves staging arguments, reads and success [staging_method_counts]', async () => {
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
    expect(h.rpcCalls.some(c => c.name === 'append_turn_atomic_v5')).toBe(true);
    assertInterface(h.methodCounts());
  });

  it('system event commit preserves staging RPC arguments, ordered reads and success [staging_method_counts]', async () => {
    const h = harness();
    const payload = { kind: 'system_event', scenario_id: SCENARIO, turn_id: TURN,
      stage: 'analyse', event: { kind: 'factor_value_edit', target_id: 'fac_price', value: 0.7, field: 'value' },
    } as SystemEventTurnPayload;
    const result = await dispatchSystemEvent({ payload, requestId: 'flag-off-system' });
    expect(result.commitPerformed).toBe(true);
    expect(h.rpcCalls.some(c => c.name === 'append_turn_atomic_v5')).toBe(true);
    assertInterface(h.methodCounts());
  });

  it('register preserves staging RPC arguments, ordered reads and success [staging_method_counts]', async () => {
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
      expect(h.rpcCalls.some(c => c.name === 'append_turn_atomic_v5')).toBe(true);
      assertInterface(h.methodCounts());
    } finally { await app.close(); }
  });

  it('replacement apply preserves staging RPC arguments, ordered reads and verified success [staging_method_counts]', async () => {
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
    expect(h.rpcCalls.some(c => c.name === 'append_turn_atomic_v5')).toBe(true);
    assertInterface(h.methodCounts());
  });

  it('Addendum 12 — staging seed SHA is 40 hex characters in both map headers', () => {
    const shas = stagingSeeds().map(seed => seed.match(/^\/\/ STAGING_SEED_SHA = '([^']+)'$/m)?.[1]);
    for (const sha of shas) expect(sha).toMatch(/^[a-f0-9]{40}$/);
    expect(shas[0]).toBe(shas[1]);
  });

  it('Addendum 12 — all eight named doors exist in recorded results and staging seed', () => {
    const seedKeys = stagingSeeds().map(seed =>
      Array.from(seed.matchAll(/^exports\[`(.+)`\] = `/gm), match => match[1]));
    for (const door of DOOR_CASES) {
      const key = `${INTERFACE_SUITES[door.file]} > ${door.title} 1`;
      expect(seedKeys[door.file].filter(candidate => candidate === key), `${door.name}: missing/duplicate staging seed`).toHaveLength(1);
    }
    expect(seedKeys.flat()).toHaveLength(DOOR_CASES.length);

    // Isolated workers cannot share a recorder. Collect fresh results from both
    // siblings; this filter runs only the eight doors, so the census cannot recurse.
    const evidenceRoot = resolve('.codex-out');
    mkdirSync(evidenceRoot, { recursive: true });
    const evidence = mkdtempSync(resolve(evidenceRoot, 'addendum-12-census-'));
    const report = resolve(evidence, 'results.json');
    expect(existsSync(report)).toBe(false);
    const args = ['pnpm', 'exec', 'vitest', 'run', '--config', 'scripts/parity-evidence/vitest.evidence.config.ts', ...INTERFACE_FILES,
      '--testNamePattern=staging_method_counts', '--reporter=default', '--reporter=json', `--outputFile=${report}`];
    const quote = (arg: string) => `'${arg.replace(/'/g, `'"'"'`)}'`;
    const gate = [process.execPath, '-e', "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"];
    const command = `${gate.map(quote).join(' ')} && ${args.map(quote).join(' ')}`;
    const child = spawnSync(command, { shell: true, encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, UPDATE_SNAPSHOT: 'none', TMPDIR: process.env.TMPDIR ?? evidence } });
    writeFileSync(resolve(evidence, 'run.log'), `${command}\n${child.stdout ?? ''}${child.stderr ?? ''}`);
    expect(existsSync(report), `fresh recorded results missing: ${child.error?.message ?? child.status}`).toBe(true);
    const results = JSON.parse(readFileSync(report, 'utf8')) as {
      testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; status: string }> }>;
    };
    expect(results.testResults.map(file => file.name).sort())
      .toEqual(INTERFACE_FILES.map(file => resolve(file)).sort());
    for (const door of DOOR_CASES) {
      const recorded = results.testResults
        .filter(file => file.name === resolve(INTERFACE_FILES[door.file]))
        .flatMap(file => file.assertionResults)
        .filter(row => row.fullName === `${INTERFACE_SUITES[door.file]} ${door.title}`);
      expect(recorded, `${door.name}: missing/duplicate recorded result`).toHaveLength(1);
      expect(recorded[0]?.status, `${door.name}: recorded door must pass`).toBe('passed');
    }
    expect(child.error).toBeUndefined();
    expect(child.status, `door run failed; see ${evidence}/run.log`).toBe(0);
  }, 120_000);
});
