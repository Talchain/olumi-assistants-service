import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { HandlerFactSchema, type RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { _resetConfigCache } from '../../src/config/index.js';
import { GraphV3 } from '../../src/schemas/cee-v3.js';
import { dispatchSystemEvent, SYSTEM_EVENT_HANDLING } from '../../src/orchestrator-v5/system-events/dispatch.js';
import { commitDirectAnswer, computeRequestHash } from '../../src/orchestrator-v5/commit.js';
import { computeAnalysisAffectingGraphHash } from '../../src/orchestrator-v5/context/graph-hash.js';
import { computeExpectedGraphCasHashes } from '../../src/orchestrator-v5/context/graph-cas-conflict.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../src/orchestrator/tools/analysis-ready-helper.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../src/orchestrator-v5/build-turn-context.js';
import { createRunAnalysisHandler } from '../../src/orchestrator-v5/tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../src/orchestrator-v5/tools/registry.js';
import type { PLoTClient } from '../../src/orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../src/orchestrator/types.js';
import { projectGraphForPersistence } from '../../src/orchestrator-v5/persisted-graph-projection.js';
import { readScenarioAnalysis } from '../../src/routes/scenario-graph-analysis-read.js';
import { ANALYSIS_REREAD_TIMEOUT_MS } from '../../src/orchestrator-v5/session/analysis-read-deadline.js';
import { GraphStaleWriteError, type AtomicCommittedModelVersionReceipt, type SessionStore, type SessionTurnWrite } from '../../src/orchestrator-v5/session/store.js';
import * as rangeReferee from '../../src/orchestrator-v5/graph-management/referee.js';
import { applyPriorRangeEdit } from '../../src/orchestrator-v5/system-events/prior-range-edit.js';
import { TurnFenceRejectedError } from '../../src/orchestrator-v5/session/turn-fence.js';
import { createMockSessionStore, makeSessionTurnRow } from '../utils/mock-session-store.js';

const port = vi.hoisted(() => ({ store: null as SessionStore | null }));
vi.mock('../../src/orchestrator-v5/session/index.js', async original => ({
  ...await original<typeof import('../../src/orchestrator-v5/session/index.js')>(),
  getSessionStore: () => {
    if (port.store === null) throw new Error('test store not bound');
    return port.store;
  },
}));

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST = 'range-spine-exact-request';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const graphHash = (graph: unknown) => computeAnalysisAffectingGraphHash(graph as never);

function graphFixture() {
  return projectGraphForPersistence({
    ...GraphV3.parse({
      nodes: [
        { id: 'decision', kind: 'decision', label: 'Test coverage options' },
        { id: 'goal', kind: 'goal', label: 'Service', goal_threshold: 0.1 },
        { id: 'option', kind: 'option', label: 'Pilot', interventions: { factor: 0.7 } },
        { id: 'baseline', kind: 'option', label: 'Stay', is_baseline: true, interventions: { factor: 0.5 } },
        { id: 'factor', kind: 'factor', label: 'Coverage', observed_state: {
          value: 0.5, baseline: 0.4, raw_value: 50, cap: 100, unit: '%', source: 'user_override',
        }, prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.8,
          provenance: 'brief_extraction', retained_evidence: { citation: 'user-note' } }, retained_note: 'do not touch' },
        { id: 'other', kind: 'factor', category: 'external', label: 'Coverage', observed_state: { value: 0.6 },
          prior: { distribution: 'uniform', range_min: 0.1, range_max: 0.9 } },
      ],
      edges: [['decision', 'option'], ['decision', 'baseline'], ['option', 'factor'], ['baseline', 'factor'], ['factor', 'goal'], ['other', 'goal']]
        .map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
    }),
    options: [], goal_node_id: 'goal', retained_context: { qualitative_claim: 'Keep the dissent.' },
  });
}

type Event = SystemEventTurnPayload['event'];
const EDITS = [
  { kind: 'factor_value_edit', event: { kind: 'factor_value_edit', target_id: 'factor', value: 0.65, raw_value: 65, unit: '%' } as Event,
    factType: 'set_factor_value', assertEdit: (graph: ReturnType<typeof graphFixture>) => {
      expect(graph.nodes.find(n => n.id === 'factor')?.observed_state?.value).toBe(0.65);
    } },
  { kind: 'prior_range_edit', event: { kind: 'prior_range_edit', target_id: 'factor', range_min: 0.3, range_max: 0.9 } as Event,
    factType: 'prior_range_edit', assertEdit: (graph: ReturnType<typeof graphFixture>) => {
      expect(graph.nodes.find(n => n.id === 'factor')?.prior).toMatchObject({ distribution: 'uniform', range_min: 0.3, range_max: 0.9 });
    } },
] as const;
const rangeEvent = EDITS[1].event as Extract<Event, { kind: 'prior_range_edit' }>;
function payload(event: Event = rangeEvent, turnId = TURN): SystemEventTurnPayload {
  return { kind: 'system_event', scenario_id: SCENARIO, turn_id: turnId, stage: 'analyse', event };
}

/** Same serialized SessionStore pattern as option-intervention-transaction: only
 * JSON survives a fresh facade. Dispatch, adapters, referee, checked writer,
 * projection, receipt composition, and canonical reload are all real. */
function persistence(initial: unknown = graphFixture(), owned = false) {
  let graphJson = JSON.stringify(initial);
  const rows = new Map<string, { id: string; json: string; receipt?: AtomicCommittedModelVersionReceipt }>();
  const attempts: SessionTurnWrite[] = [];
  const state = { evidence: 'ok' as 'ok' | 'fail' | 'deadline', stale: false, fence: false, failGraphRead: false };
  const durableRows = () => [...rows.values()].map(row => clone(JSON.parse(row.json) as SessionTurnWrite));
  const durableGraph = () => JSON.parse(graphJson) as ReturnType<typeof graphFixture>;
  const timestamp = (index: number) => `2026-10-04T10:00:${String(index).padStart(2, '0')}.000Z`;
  const entries = () => [...rows.values()].reverse().flatMap((row, index) => {
    const write = JSON.parse(row.json) as SessionTurnWrite;
    return write.handler_facts.map((fact, factIndex) => ({ fact, fact_row_id: `${row.id}-fact-${factIndex}`,
      turn_id: row.id, fact_created_at: timestamp(rows.size - index) }));
  });
  const evidenceRead = async () => {
    if (state.evidence === 'fail') throw new Error('evidence unavailable');
    if (state.evidence === 'deadline') await new Promise<never>(() => {});
  };
  const fresh = (): SessionStore => createMockSessionStore({
    loadGraph: async scenarioId => {
      expect(scenarioId).toBe(SCENARIO);
      if (state.failGraphRead) throw new Error('canonical graph unavailable');
      return durableGraph();
    },
    loadGraphAndBriefText: async scenarioId => {
      expect(scenarioId).toBe(SCENARIO);
      if (state.failGraphRead) throw new Error('canonical graph unavailable');
      return { graph: durableGraph(), briefText: null };
    },
    readAnalysisInvalidatedAt: async () => null,
    readMostRecentPendingActions: async () => [],
    getScenarioOwner: async () => owned ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null,
    append: async write => {
      expect(write.scenario_id).toBe(SCENARIO);
      attempts.push(clone(write));
      const key = `${write.scenario_id}/${write.turn_id}`;
      const previous = rows.get(key);
      if (previous !== undefined) {
        const original = JSON.parse(previous.json) as SessionTurnWrite;
        return { id: previous.id, ...(previous.receipt ? { modelVersionReceipt: previous.receipt } : {}),
          ...(original.request_hash === write.request_hash ? { replayedPriorTurn: true as const } : { priorTurnConflict: true as const }) };
      }
      if (write.graph !== undefined) {
        if (state.stale) {
          const concurrent = durableGraph();
          concurrent.nodes.find(n => n.id === 'other')!.observed_state!.value = 0.72;
          graphJson = JSON.stringify(concurrent);
        }
        const cas = computeExpectedGraphCasHashes(durableGraph());
        if (write.expectedGraphIdentityHash !== cas.expectedGraphIdentityHash) {
          throw new GraphStaleWriteError('atomic CAS refused', { conflict_category: 'analysis_affecting_conflict' });
        }
        if (state.fence) throw new TurnFenceRejectedError('superseded', { verdict: 'superseded', generation: 1, maxGeneration: 2 });
      }
      const id = `dddddddd-dddd-4ddd-8ddd-${String(rows.size + 1).padStart(12, '0')}`;
      const receipt: AtomicCommittedModelVersionReceipt | undefined = owned && write.graph !== undefined ? {
        mutation_id: TURN, version_id: id, version_number: rows.size + 1,
        graph_identity_hash: write.modelVersion!.graph_identity_hash, analysis_affecting_hash: write.modelVersion!.analysis_affecting_hash, hash_algorithm: 'sha256',
        identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
        actor_kind: 'unknown', authored_by: null, creation_kind: 'committed_mutation', source_version_id: null,
        source_turn_id: write.turn_id, parent_version_id: null, root_version_id: null, undo_version_id: null,
        graph: clone(write.graph), event_id: `event-${write.turn_id}`,
      } : undefined;
      rows.set(key, { id, json: JSON.stringify(write), ...(receipt ? { receipt } : {}) });
      if (write.graph !== undefined) graphJson = JSON.stringify(write.graph);
      return { id, ...(receipt ? { modelVersionReceipt: receipt } : {}) };
    },
    readRecent: async (scenarioId, limit = 20) => {
      expect(scenarioId).toBe(SCENARIO);
      await evidenceRead();
      return [...rows.values()].reverse().slice(0, limit).map((row, index) => {
        const write = JSON.parse(row.json) as SessionTurnWrite;
        return makeSessionTurnRow({ id: row.id, scenario_id: write.scenario_id, turn_id: write.turn_id,
          turn_class: write.turn_class, handler_id: write.handler_id, request_hash: write.request_hash,
          created_at: timestamp(rows.size - index), llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms,
          assistant_message: write.assistantMessage ?? null });
      });
    },
    readFactsWithTurnFor: async ids => entries().filter(entry => ids.includes(entry.turn_id)),
    readScenarioRunAnalysisFactsFor: async scenarioId => {
      expect(scenarioId).toBe(SCENARIO);
      await evidenceRead();
      const facts = entries().filter(entry => entry.fact.fact_type === 'run_analysis');
      return { facts, total_count: facts.length };
    },
  });
  const bind = () => { port.store = fresh(); return port.store; };
  bind();
  return { state, attempts, durableRows, durableGraph, receipts: () => [...rows.values()].flatMap(row => row.receipt ? [clone(row.receipt)] : []), bind, moveGraph: (graph: unknown) => { graphJson = JSON.stringify(graph); } };
}

/** Real canonical snapshot → real Run handler → local transport fixture → real
 * fact commit. No provider, socket, database or network calls. */
async function recordRun(turnId: string, graph: unknown) {
  const readiness = buildCanonicalAnalysisReadyFromGraph(graph);
  expect(readiness?.status, JSON.stringify(readiness)).toBe('ready');
  const input = { kind: 'message' as const, scenario_id: SCENARIO, turn_id: turnId, stage: 'analyse' as const,
    message: 'run analysis', turn_class: 'decide' as const, source: 'composer' as const };
  const sent: Array<Record<string, unknown>> = [];
  const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;
  const handler = createRunAnalysisHandler({
    scenarioReader: id => loadScenarioSnapshotForRunAnalysis(id, REQUEST, port.store!),
    plotClient: {
      validatePatch: vi.fn().mockResolvedValue({}),
      run: vi.fn(async (body: Record<string, unknown>) => {
        sent.push(clone(body));
        const response = clone(happy);
        response.results = (body.options as Array<{ option_id: string; label: string }>).map((option, index) => ({
          option_id: option.option_id, option_label: option.label, win_probability: [0.6, 0.4][index] ?? 0,
          percentile_p10: 0.1, percentile_p90: 0.9,
        }));
        response.fact_objects = []; response.review_cards = [];
        return response;
      }),
    } as unknown as PLoTClient,
  });
  const invocation = {
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: 'goal' }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO, request_id: turnId,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null },
    payload: input, requestId: turnId, signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
  const outcome = await handler(invocation);
  expect(sent).toHaveLength(1);
  const sentGraph = sent[0]!.graph as ReturnType<typeof graphFixture>;
  expect(sentGraph.nodes.find(n => n.id === 'factor')!.prior).toEqual(
    (graph as ReturnType<typeof graphFixture>).nodes.find(n => n.id === 'factor')!.prior);
  const fact = outcome.handler_facts.find(fact => fact.fact_type === 'run_analysis') as RunAnalysisHandlerFact;
  expect(HandlerFactSchema.safeParse(fact).success).toBe(true);
  expect(fact.result.graph_hash_at_run).toBe(graphHash(graph));
  return commitDirectAnswer({ response_version: 2, assistant_text: '', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse' }, {
    scenario_id: SCENARIO, turn_id: turnId, turn_class: 'handler', handler_id: 'run_analysis',
    request_hash: computeRequestHash(input), handler_facts: outcome.handler_facts, llm_calls_used: 0, duration_ms: 0, coaching_state: null,
  });
}
async function coldRead(p: ReturnType<typeof persistence>) {
  p.bind();
  const graph = await port.store!.loadGraph(SCENARIO);
  return { graph, analysis: await readScenarioAnalysis({ scenarioId: SCENARIO, requestId: 'cold-read', graph }) };
}

beforeEach(() => {
  vi.stubEnv('OLUMI_ENV', 'staging'); vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true'); _resetConfigCache();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); _resetConfigCache(); port.store = null; });

describe.each(EDITS)('mutation spine: $kind (one more row adds an edit class)', edit => {
  it.each([false, true])('exact event → one commit/receipt → STALE → offline rerun FRESH → cold identity (owned=%s)', async owned => {
    const p = persistence(graphFixture(), owned);
    const before = p.durableGraph();
    await recordRun('11111111-1111-4111-8111-111111111111', before);
    expect((await coldRead(p)).analysis.analysis_state?.run_state).toMatchObject({ kind: 'complete_current' });
    const input = payload(edit.event);
    expect(OrchestratorTurnPayloadSchema.safeParse(input).success).toBe(true);
    expect(SYSTEM_EVENT_HANDLING[edit.kind]).toBe('mutating');
    const result = await dispatchSystemEvent({ payload: input, requestId: REQUEST });
    expect(result.commitPerformed).toBe(true);
    const writes = p.durableRows().filter(row => row.turn_id === TURN);
    expect(writes).toHaveLength(1);
    expect(p.attempts.filter(row => row.turn_id === TURN)).toHaveLength(1);
    expect(writes[0]).toMatchObject({ scenario_id: SCENARIO, turn_id: TURN, request_hash: computeRequestHash(input), llm_calls_used: 0 });
    expect(writes[0]!.handler_facts).toHaveLength(1);
    expect(writes[0]!.handler_facts[0]!.fact_type).toBe(edit.factType);
    expect(HandlerFactSchema.safeParse(writes[0]!.handler_facts[0]).success).toBe(true);
    expect(writes[0]).toMatchObject(computeExpectedGraphCasHashes(before));
    const canonical = p.durableGraph();
    edit.assertEdit(canonical);
    expect(result.graph).toEqual(canonical);
    expect(result.response.draft_graph?.nodes).toEqual(GraphV3.parse(canonical).nodes);
    expect(result.response.graph_hash).toBe(graphHash(canonical));
    expect(graphHash(canonical)).not.toBe(graphHash(before));
    expect(result.freshness?.freshness).toBe('stale');
    if (owned) {
      expect(result.response.model_version_receipt).toMatchObject({ scenario_id: SCENARIO, source_turn_id: TURN });
      expect(p.receipts()).toHaveLength(1);
      expect(p.receipts()[0]!.graph).toEqual(canonical);
    }
    else expect(result.response.model_version_receipt).toBeUndefined();
    const cold = await coldRead(p);
    expect(cold.graph).toEqual(canonical);
    expect(cold.analysis.analysis_state?.run_state).toMatchObject({ kind: 'complete_stale' });
    await recordRun('22222222-2222-4222-8222-222222222222', canonical);
    const rerun = await coldRead(p);
    expect(rerun.graph).toEqual(canonical);
    expect(rerun.analysis.analysis_state?.run_state).toMatchObject({ kind: 'complete_current' });
    expect(p.durableRows().filter(row => row.turn_id === TURN)).toHaveLength(1);
  });

  it('stale CAS base refuses atomically without edit append or receipt', async () => {
    const p = persistence(); p.state.stale = true;
    const result = await dispatchSystemEvent({ payload: payload(edit.event), requestId: REQUEST });
    expect(result).toMatchObject({ commitPerformed: false, graph: null, graphConflict: { recovery_action: 'refresh_and_reconfirm' } });
    expect(p.durableRows()).toEqual([]);
    expect(result.response.model_version_receipt).toBeUndefined();
    const unchangedTarget = p.durableGraph().nodes.find(n => n.id === 'factor');
    expect(unchangedTarget).toEqual(graphFixture().nodes.find(n => n.id === 'factor'));
  });

  it('turn fence refusal writes no graph, fact, or receipt', async () => {
    const p = persistence(); p.state.fence = true;
    const result = await dispatchSystemEvent({ payload: payload(edit.event), requestId: REQUEST });
    expect(result).toMatchObject({ commitPerformed: false, graph: null, graphConflict: { recovery_action: 'refresh_and_reconfirm' } });
    expect(p.durableRows()).toEqual([]); expect(p.durableGraph()).toEqual(graphFixture());
  });

  it('replay after a later edit retains one occurrence and returns current canonical bytes', async () => {
    const p = persistence(undefined, true);
    const input = payload(edit.event);
    const first = await dispatchSystemEvent({ payload: input, requestId: REQUEST });
    const moved = graphFixture(); p.moveGraph(moved); p.bind();
    const replay = await dispatchSystemEvent({ payload: input, requestId: REQUEST });
    expect(p.durableRows()).toHaveLength(1);
    expect(p.durableRows()[0]!.request_hash).toBe(computeRequestHash(input));
    expect(replay.graph).toEqual(moved);
    expect(replay.response.graph_hash).toBe(graphHash(moved));
    expect(replay.response.model_version_receipt).toEqual(first.response.model_version_receipt);
    expect(replay.response.assistant_text).toContain('already');
  });

  it.each(['fail', 'deadline'] as const)('evidence %s cannot lose a committed write or claim FRESH', async failure => {
    const p = persistence(undefined, true); p.state.evidence = failure;
    if (failure === 'deadline') vi.useFakeTimers();
    const pending = dispatchSystemEvent({ payload: payload(edit.event), requestId: REQUEST });
    if (failure === 'deadline') await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS);
    const result = await pending;
    expect(result.commitPerformed).toBe(true); expect(p.durableRows()).toHaveLength(1);
    edit.assertEdit(p.durableGraph());
    expect(result.response.model_version_receipt).toMatchObject({ source_turn_id: TURN });
    expect(result.freshness).toMatchObject({ freshness: 'unknown', reason: 'derivation_failed' });
  });
});

describe('prior range hostile identities and field locality', () => {
  it.each([
    ['inverted', { range_min: 0.9, range_max: 0.3 }], ['NaN', { range_min: NaN }],
    ['infinity', { range_max: Infinity }], ['wrong unit', { unit: 'GBP' }],
    ['missing bound', { range_max: undefined }], ['scalar instead of pair', { range: 0.7, range_min: undefined, range_max: undefined }],
    ['array instead of numeric bound', { range_min: [0.3, 0.9] }],
    ['forged prior stamp', { prior: { source: 'user_set' } }],
  ])('malformed %s refuses exact event without writes', async (_name, fields) => {
    const p = persistence(); const before = p.durableGraph();
    const input = payload({ ...rangeEvent, ...fields } as Event);
    expect(OrchestratorTurnPayloadSchema.safeParse(input).success).toBe(false);
    const result = await dispatchSystemEvent({ payload: input, requestId: REQUEST });
    expect(result).toMatchObject({ commitPerformed: false, commitSkippedReason: 'refused_no_write', graph: null,
      refusal: { reason: 'invalid_range_event' } });
    expect(p.attempts).toEqual([]); expect(p.durableRows()).toEqual([]); expect(p.durableGraph()).toEqual(before);
  });

  it.each(['unknown', 'deleted', 'duplicate', 'whitespace target', 'whitespace canonical alias', 'non-factor'])('%s cannot bind to another factor', async identity => {
    const initial = clone(graphFixture());
    let target = 'factor';
    if (identity === 'unknown') target = 'absent';
    if (identity === 'deleted') initial.nodes = initial.nodes.filter(n => n.id !== 'factor');
    if (identity === 'duplicate') initial.nodes.push(clone(initial.nodes.find(n => n.id === 'factor')!));
    if (identity === 'whitespace target') target = ' factor ';
    if (identity === 'whitespace canonical alias') initial.nodes.push({ ...clone(initial.nodes.find(n => n.id === 'factor')!), id: ' factor ' });
    if (identity === 'non-factor') target = 'goal';
    const p = persistence(initial);
    const result = await dispatchSystemEvent({ payload: payload({ ...rangeEvent, target_id: target } as Event), requestId: REQUEST });
    expect(result).toMatchObject({ commitPerformed: false, commitSkippedReason: 'refused_no_write', graph: null });
    expect(result.refusal?.reason).toBe(identity === 'non-factor' ? 'target_not_factor'
      : identity === 'whitespace canonical alias' ? 'no_persisted_graph' : 'target_not_unique');
    expect(p.attempts).toEqual([]); expect(p.durableGraph()).toEqual(initial);
  });

  it('same canonical range is no append and leaves the Run FRESH on turn and cold reload', async () => {
    const p = persistence(); await recordRun('11111111-1111-4111-8111-111111111111', p.durableGraph());
    const before = p.durableGraph(); const count = p.attempts.length;
    const result = await dispatchSystemEvent({ payload: payload({ kind: 'prior_range_edit', target_id: 'factor', range_min: 0.2, range_max: 0.8 }), requestId: REQUEST });
    expect(result).toMatchObject({ commitPerformed: false, commitSkippedReason: 'verified_no_op' });
    expect(p.attempts).toHaveLength(count); expect(p.durableGraph()).toEqual(before);
    expect(result.freshness?.freshness).toBe('fresh'); expect(result.graph).toEqual(before);
    expect((await coldRead(p)).analysis.analysis_state?.run_state).toMatchObject({ kind: 'complete_current' });
  });

  it('immediate replay is a canonical no-op, with one original durable fact/receipt', async () => {
    const p = persistence(undefined, true);
    await dispatchSystemEvent({ payload: payload(), requestId: REQUEST });
    const firstRows = p.durableRows(); const before = p.durableGraph();
    const replay = await dispatchSystemEvent({ payload: payload(), requestId: REQUEST });
    expect(replay.commitSkippedReason).toBe('verified_no_op');
    expect(p.durableRows()).toEqual(firstRows); expect(p.attempts).toHaveLength(1);
    expect(p.receipts()).toHaveLength(1);
    expect(p.receipts()[0]!.source_turn_id).toBe(TURN);
    expect(replay.graph).toEqual(before);
  });

  it('only the range leaves change; point estimate and every other field are byte-identical', async () => {
    const p = persistence(); const before = p.durableGraph();
    const result = await dispatchSystemEvent({ payload: payload(), requestId: REQUEST });
    expect(result.commitPerformed).toBe(true);
    const after = p.durableGraph();
    const target = after.nodes.find(n => n.id === 'factor')!;
    expect(target.observed_state).toEqual(before.nodes.find(n => n.id === 'factor')!.observed_state);
    target.prior!.range_min = 0.2; target.prior!.range_max = 0.8;
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(p.durableRows()[0]!.handler_facts[0]).toMatchObject({ fact_type: 'prior_range_edit', result: {
      target_id: 'factor', range_min: 0.3, range_max: 0.9, distribution: null, provenance: 'user_set' } });
  });

  it.each(['inherit', 'explicit', 'absent prior', 'collapsed'] as const)('distribution %s uses stated/canonical authority without defaults', async mode => {
    const initial = clone(graphFixture()); const target = initial.nodes.find(n => n.id === 'factor')!;
    if (mode === 'absent prior') delete target.prior;
    else if (mode === 'inherit') target.prior!.distribution = 'normal';
    const p = persistence(initial);
    const event = { ...rangeEvent, ...(mode !== 'inherit' ? { distribution: 'uniform' } : {}),
      ...(mode === 'collapsed' ? { range_min: 0.5, range_max: 0.5 } : {}) };
    const result = await dispatchSystemEvent({ payload: payload(event), requestId: REQUEST });
    expect(result.commitPerformed).toBe(true);
    expect(p.durableGraph().nodes.find(n => n.id === 'factor')!.prior).toMatchObject({
      distribution: mode === 'inherit' ? 'normal' : 'uniform', range_min: event.range_min, range_max: event.range_max,
    });
    expect(p.durableRows()).toHaveLength(1);
  });

  it.each([
    ['wholly above', 0.6, 0.9], ['wholly below', 0.1, 0.4], ['collapsed off the point', 0.6, 0.6],
  ] as const)('RED: a range %s the factor\'s own value (0.5) is refused and nothing is written', async (_n, range_min, range_max) => {
    const p = persistence(); const before = p.durableGraph();
    const result = await dispatchSystemEvent({ payload: payload({ ...rangeEvent, range_min, range_max }), requestId: REQUEST });
    expect(result.commitPerformed).toBe(false);
    expect(p.durableGraph()).toEqual(before);
    expect(p.durableRows()).toHaveLength(0);
  });

  it('a distribution-only edit moves the analytical hash and preserves both bounds', async () => {
    const p = persistence(); const before = p.durableGraph();
    const result = await dispatchSystemEvent({ payload: payload({ kind: 'prior_range_edit', target_id: 'factor',
      range_min: 0.2, range_max: 0.8, distribution: 'normal' }), requestId: REQUEST });
    expect(result.commitPerformed).toBe(true);
    expect(p.durableGraph().nodes.find(n => n.id === 'factor')!.prior).toMatchObject({
      range_min: 0.2, range_max: 0.8, distribution: 'normal' });
    expect(result.response.graph_hash).not.toBe(graphHash(before));
  });

  it.each([[0.9, 1.1], [-0.5, -0.1]])('external prior moves to disjoint interval [%s, %s] without an invented point estimate', async (min, max) => {
    const initial = clone(graphFixture()); const target = initial.nodes.find(n => n.id === 'factor')!;
    target.category = 'external'; delete target.observed_state;
    const p = persistence(initial);
    const result = await dispatchSystemEvent({ payload: payload({ kind: 'prior_range_edit', target_id: 'factor',
      range_min: min, range_max: max }), requestId: REQUEST });
    expect(result.commitPerformed).toBe(true); expect(p.durableRows()).toHaveLength(1);
    const changed = p.durableGraph().nodes.find(n => n.id === 'factor')!;
    expect(changed.prior).toMatchObject({ range_min: min, range_max: max });
    expect(changed.observed_state).toBeUndefined();
    const restored = p.durableGraph(); restored.nodes.find(n => n.id === 'factor')!.prior = target.prior;
    expect(restored).toEqual(initial);
  });

  it('missing prior and unspecified distribution refuses rather than inventing uniform', async () => {
    const initial = clone(graphFixture()); delete initial.nodes.find(n => n.id === 'factor')!.prior;
    const p = persistence(initial);
    const result = await dispatchSystemEvent({ payload: payload(), requestId: REQUEST });
    expect(result).toMatchObject({ commitPerformed: false, refusal: { reason: 'distribution_required' } });
    expect(p.attempts).toEqual([]); expect(p.durableGraph()).toEqual(initial);
  });

  it('manual intent cannot bypass an existing referee refusal', async () => {
    const p = persistence(); const before = p.durableGraph();
    const real = rangeReferee.refereeMutationBatch;
    const referee = vi.spyOn(rangeReferee, 'refereeMutationBatch').mockImplementation((...args) =>
      real(...args).map(verdict => ({ ...verdict, verdict: 'held' as const })));
    const result = await dispatchSystemEvent({ payload: payload(), requestId: REQUEST });
    expect(referee).toHaveBeenCalledOnce();
    const [envelopes] = referee.mock.calls[0]!;
    expect(envelopes).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'update_node_field', identity: { scenario_id: SCENARIO, turn_id: TURN },
      provenance: { source: 'user_direct', evidence_pointer: `system_event:${TURN}` },
    })]));
    expect(result).toMatchObject({ commitPerformed: false, commitSkippedReason: 'refused_no_write' });
    expect(p.attempts).toEqual([]); expect(p.durableGraph()).toEqual(before);
  });

  it('candidate leaves its canonical input object and typed intent untouched', () => {
    const before = clone(graphFixture()); const pristine = clone(before); const input = payload();
    const fact = HandlerFactSchema.parse({ fact_type: 'prior_range_edit', fact_version: 1, noop: false,
      result: { target_id: 'factor', range_min: 0.3, range_max: 0.9, distribution: null, provenance: 'user_set' } });
    const result = applyPriorRangeEdit({ payload: input, event: rangeEvent as Extract<Event, { kind: 'prior_range_edit' }>,
      persistedGraph: before, baseGraphHash: graphHash(before), handlerFacts: [fact] });
    expect(result.kind).toBe('mutated');
    expect(before).toEqual(pristine); expect(input).toEqual(payload());
  });

  it('initial canonical graph read failure refuses before any append', async () => {
    const p = persistence(); p.state.failGraphRead = true;
    const result = await dispatchSystemEvent({ payload: payload(), requestId: REQUEST });
    expect(result.commitPerformed).toBe(false); expect(p.attempts).toEqual([]);
    expect(p.durableGraph()).toEqual(graphFixture());
  });
});
