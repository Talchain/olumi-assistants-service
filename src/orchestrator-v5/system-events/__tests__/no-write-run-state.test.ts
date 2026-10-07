import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { OrchestratorTurnPayloadSchema, AnalysisStateV1Schema } from '@talchain/schemas/boundary';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { _resetConfigCache } from '../../../config/index.js';
import { getSessionStore, resetSessionStoreForTests } from '../../session/index.js';
import type { SupabaseSessionStore } from '../../session/supabase-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { dispatchSystemEvent } from '../dispatch.js';
import { finaliseV5Response } from '../../response-finaliser.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { deriveAnalysisFreshness } from '../../context/freshness.js';
import { ANALYSIS_REREAD_TIMEOUT_MS } from '../../session/analysis-read-deadline.js';

// One storage-port stub on a vitest spy; vi.restoreAllMocks in afterEach restores it.
type AnyFn = (...args: unknown[]) => unknown;
const stub = (target: object, name: string, impl: (...args: never[]) => unknown) =>
  vi.spyOn(target as Record<string, AnyFn>, name).mockImplementation(impl as AnyFn);

// Original captured bytes/keys. Only the store fact's envelope is synthetic:
// the capture exposes a result block, not the durable fact row.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/runstate/${name}.json`, import.meta.url), 'utf8'));
const read = fixture('prior-read').j;
const wire = fixture('refused-turn');
const payload = OrchestratorTurnPayloadSchema.parse(fixture('refused-request').request_body) as SystemEventTurnPayload;
const priorState = AnalysisStateV1Schema.parse(read.analysis_state);
const computedAt = priorState.run_state.kind === 'complete_current' ? priorState.run_state.computed_at : '';
const fact = RunAnalysisHandlerFactSchema.parse({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: payload.scenario_id, summary: read.analysis_result.summary,
    leading_option_id: read.analysis_result.leading_option_id,
    win_probabilities: read.analysis_result.win_probabilities,
    enrichment: read.analysis_result.enrichment,
    graph_hash_at_run: read.graph_hash, computed_at: computedAt },
});
const factRow = { fact, fact_row_id: '11111111-1111-4111-8111-111111111111', fact_created_at: computedAt };
let graph: unknown;
let writes: SessionTurnWrite[];
let store: SupabaseSessionStore;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'http://127.0.0.1:1',
    SUPABASE_SERVICE_ROLE_KEY: 'offline-fixture', CEE_V5_GRAPH_CAS_RPC: 'enforce' })) {
    savedEnv.set(key, process.env[key]); process.env[key] = value;
  }
  _resetConfigCache(); resetSessionStoreForTests();
  store = getSessionStore() as SupabaseSessionStore;
  graph = structuredClone(read.graph); writes = [];
  // Storage ports only; dispatcher, canonical adapter, commit, freshness and finaliser are real.
  // Any accidental network call fails the row instead of reaching a provider/database.
  stub(globalThis, 'fetch', async () => { assert.fail('offline rows prohibit network'); });
  stub(store, 'loadGraph', async () => graph);
  stub(store, 'loadGraphAndBriefText', async () => ({ graph, briefText: null }));
  stub(store, 'readMostRecentPendingActions', async () => []);
  stub(store, 'readAnalysisInvalidatedAt', async () => null);
  stub(store, 'readRecent', async () => []);
  stub(store, 'readFactsWithTurnFor', async () => []);
  stub(store, 'readScenarioRunAnalysisFactsFor', async () => ({ facts: [factRow], total_count: 1 }));
  stub(store, 'getScenarioOwner', async () => null);
  stub(store, 'append', async (write: SessionTurnWrite) => {
    writes.push(write);
    if (write.graph !== undefined && write.graph !== null) graph = write.graph;
    return { id: '22222222-2222-4222-8222-222222222222' };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks(); resetSessionStoreForTests();
  for (const [key, value] of savedEnv) value === undefined ? delete process.env[key] : process.env[key] = value;
  savedEnv.clear(); _resetConfigCache();
});

function selectionPayload(): SystemEventTurnPayload {
  return OrchestratorTurnPayloadSchema.parse({ ...payload, event: { kind: 'selection_change', selected: [] } }) as SystemEventTurnPayload;
}

async function run(input = payload) {
  const result = await runWithProviderPolicy({ allowed: new Set(['openai']), route: 'agent_v1_turn', calls: [], truncated: false },
    () => dispatchSystemEvent({ payload: input, requestId: 'offline-runstate' }));
  const response = finaliseV5Response(result.response, { scenarioId: input.scenario_id,
    graph: result.graph, freshness: result.freshness, analysisReady: result.analysisReady,
    mayNameLeadingOption: false });
  return { result, response, state: AnalysisStateV1Schema.parse(response.analysis_state) };
}

test('ROW 1 — captured refused inspector preset, no graph write: retain the prior Run state', async () => {
  assert.deepEqual(wire.analysis_state.run_state, { kind: 'unknown_degraded', cause: 'no_graph_this_turn' });
  assert.equal(computeAnalysisAffectingGraphHash(read.graph), wire.graph_hash);
  const { result, response, state } = await run();
  assert.equal(result.commitPerformed, true, 'must reach the refusal commit');
  assert.equal(response.assistant_text, wire.assistant_text, 'must reach the captured user-figure refusal');
  assert.equal(writes.length, 1);
  assert.ok(writes.every(w => w.graph == null && w.handler_facts.length === 0));
  assert.deepEqual(graph, read.graph);
  assert.equal(response.graph_hash, wire.graph_hash);
  assert.deepEqual(state.run_state, priorState.run_state);
  assert.notEqual(state.readiness.status, 'unknown');
});

test('CLASS CONTROL — selection acknowledgement retains no_graph_this_turn', async () => {
  const { result, state } = await run(selectionPayload());
  assert.equal(result.commitSkippedReason, 'client_only_event');
  assert.equal(writes.length, 0);
  assert.equal(result.graph, null);
  assert.equal(result.freshness, undefined);
  assert.equal(vi.mocked(store.loadGraph).mock.calls.length, 0);
  assert.deepEqual(state.run_state, { kind: 'unknown_degraded', cause: 'no_graph_this_turn' });
});

test('ROW 3 — genuine no graph before draft retains no_graph_this_turn', async () => {
  graph = null;
  const { state } = await run();
  assert.deepEqual(state.run_state, { kind: 'unknown_degraded', cause: 'no_graph_this_turn' });
  assert.ok(writes.every(w => w.graph == null));
});

test('ROW 4 — an actual graph-changing edit retains the writer stale verdict', async () => {
  // Remove only the user-figure gate so this control exercises the real writer.
  const changed = structuredClone(read.graph);
  const edge = changed.edges.find((e: { from: string; to: string }) => e.from === 'price_rise' && e.to === 'monthly_recurring_revenue');
  edge.provenance = { source: 'cee_hypothesis' };
  graph = changed;
  const { result, response, state } = await run();
  assert.equal(result.commitPerformed, true);
  assert.ok(writes.some(w => w.graph != null), 'must actually write a changed graph');
  assert.notEqual(response.graph_hash, read.graph_hash);
  assert.equal(result.freshness?.freshness, 'stale');
  assert.equal(state.run_state.kind, 'complete_stale');
  // Existing post-write derivation wins: this class repair adds no reread after it.
  assert.deepEqual(result.freshness, deriveAnalysisFreshness([fact], response.graph_hash ?? null, undefined,
    { currentGraph: graph, priorFactsReadOk: true, analysisInvalidatedAt: null }));
});

test('FAIL CLOSED — graph reread failure cannot manufacture current', async () => {
  let reads = 0;
  stub(store, 'loadGraph', async () => {
    if (++reads === 2) throw new Error('graph unavailable');
    return graph;
  });
  const { result, response, state } = await run();
  assert.equal(reads, 2, 'must fail the post-refusal reread');
  assert.equal(result.commitPerformed, true);
  assert.equal(response.assistant_text, wire.assistant_text);
  assert.equal(writes.length, 1);
  assert.ok(writes.every(w => w.graph == null && w.handler_facts.length === 0));
  assert.equal(result.freshness, undefined);
  assert.deepEqual(state.run_state, { kind: 'unknown_degraded', cause: 'no_graph_this_turn' });
});

test('FAIL CLOSED — a hung post-refusal graph reread returns degraded at the deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let reads = 0;
  let started!: () => void;
  const rereadStarted = new Promise<void>(resolve => { started = resolve; });
  stub(store, 'loadGraph', async () => {
    if (++reads === 2) {
      started();
      return new Promise<never>(() => {});
    }
    return graph;
  });
  let settled = false;
  const reply = run().then(value => { settled = true; return value; });
  await rereadStarted;
  assert.equal(writes.length, 1, 'deadline must cover only the observational reread');
  await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS - 1);
  assert.equal(settled, false);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(settled, true, 'reply must return within the shared reread deadline');
  const { result, response, state } = await reply;
  assert.equal(reads, 2);
  assert.equal(result.commitPerformed, true);
  assert.equal(result.freshness, undefined);
  assert.equal(response.assistant_text, wire.assistant_text);
  assert.equal(response.graph_hash, wire.graph_hash);
  assert.ok(writes.every(w => w.graph == null && w.handler_facts.length === 0));
  assert.deepEqual(state.run_state, { kind: 'unknown_degraded', cause: 'no_graph_this_turn' });
  assert.equal(vi.getTimerCount(), 0);
});

test('FAIL CLOSED — unreadable analysis history is store_unreadable, never current', async () => {
  stub(store, 'readScenarioRunAnalysisFactsFor', async () => { throw new Error('facts unavailable'); });
  const { state } = await run();
  assert.deepEqual(state.run_state, { kind: 'unknown_degraded', cause: 'store_unreadable' });
});

test('FAIL CLOSED — an unread restore marker cannot license current', async () => {
  stub(store, 'readAnalysisInvalidatedAt', async () => { throw new Error('marker unavailable'); });
  const { state } = await run();
  assert.deepEqual(state.run_state, { kind: 'unknown_degraded', cause: 'store_unreadable' });
});


test('CONTROL — a graph that exists with a complete empty fact history is never_run', async () => {
  stub(store, 'readScenarioRunAnalysisFactsFor', async () => ({ facts: [], total_count: 0 }));
  const { state } = await run();
  assert.equal(state.run_state.kind, 'never_run');
});

test('CONTROL — refusal over a changed saved graph stays stale', async () => {
  const changed = structuredClone(read.graph);
  changed.edges[0].strength.mean = 0.5;
  graph = changed;
  const { state } = await run();
  assert.equal(state.run_state.kind, 'complete_stale');
});

test('CONTROL — restoring matching graph bytes after the Run stays stale', async () => {
  stub(store, 'readAnalysisInvalidatedAt', async () => '2026-10-07T01:00:00.000Z');
  const { state } = await run();
  assert.equal(state.run_state.kind, 'complete_stale');
});
