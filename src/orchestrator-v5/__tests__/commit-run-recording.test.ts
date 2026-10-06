/**
 * S1-C: real commitDirectAnswer → real appendCheckedGraphWrite; doubles only
 * at persistence boundaries. Captures, projections, cold analysis read, and
 * cold graph route are real. No model, network, or function-under-test mock.
 * RED at 54afd737: commit settles while deferred capture writes are pending;
 * no v5.run_recording.completed typed log and no cold run_recording marker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RunAnalysisHandlerFactSchema, type RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import type { StoreBriefAndProvenanceWrite } from '../brief-provenance/store-adapter.js';
import type { CreateDecisionRecordWrite, DecisionRecordWriteOutcome } from '../decision-records/store-adapter.js';

const boundary = vi.hoisted(() => ({
  store: null as SessionStore | null,
  brief: vi.fn<(write: StoreBriefAndProvenanceWrite) => Promise<boolean>>(),
  decision: vi.fn<(write: CreateDecisionRecordWrite) => Promise<DecisionRecordWriteOutcome>>(),
  briefStore: vi.fn(), decisionStore: vi.fn(),
}));
vi.mock('../session/index.js', () => ({ getSessionStore: () => boundary.store }));
vi.mock('../brief-provenance/index.js', () => ({
  getBriefProvenanceStore: () => { boundary.briefStore(); return { storeBriefAndProvenance: boundary.brief }; },
}));
vi.mock('../decision-records/index.js', () => ({
  getDecisionRecordStore: () => { boundary.decisionStore(); return { createRecord: boundary.decision }; },
}));

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SupabaseSessionStore } from '../session/supabase-store.js';
import { SessionLRUCache } from '../session/cache.js';
import { buildBriefProvenanceWrite } from '../brief-provenance/capture.js';
import { buildDecisionRecordWrite } from '../decision-records/capture.js';
import { RUN_RECORDING_BUDGET_MS } from '../run-recording.js';
import { runWithProviderPolicy } from '../../adapters/llm/provider-policy.js';
import { deriveDecisionContextGraphHash } from '../build-turn-context.js';
import { readScenarioAnalysis } from '../../routes/scenario-graph-analysis-read.js';
import scenarioGraphRoute from '../../routes/assist.v1.scenario-graph.js';
import { _resetConfigCache } from '../../config/index.js';
import { log } from '../../utils/telemetry.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPUTED = '2026-10-06T10:00:00.000Z';
const GRAPH = {
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Choose' },
    { id: 'goal', kind: 'goal', label: 'Growth', goal_threshold: 0.7 },
    { id: 'factor', kind: 'factor', label: 'Reach' },
    { id: 'option-a', kind: 'option', label: 'Option A', interventions: { factor: 1 } },
    { id: 'option-b', kind: 'option', label: 'Option B', interventions: { factor: 0 } },
  ],
  edges: [
    ['decision', 'option-a'], ['decision', 'option-b'], ['option-a', 'factor'],
    ['option-b', 'factor'], ['factor', 'goal'],
  ].map(([from, to]) => ({ from, to, strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
  goal_node_id: 'goal',
};
function fact(): RunAnalysisHandlerFact {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, graph_hash_at_run: deriveDecisionContextGraphHash(GRAPH), computed_at: COMPUTED,
      leading_option_id: 'option-a', summary: 'Option A leads on this model.',
      win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: {
        analysis_status: 'computed', response_hash: 'sha256:run-response',
        decision_brief: { seed: 123, headline: 'Option A leads.' },
        option_comparison: [{ option_id: 'option-a', option_label: 'Option A', win_probability: 0.65 }],
      },
    },
  });
}

/** JSON bytes survive creating a completely new store/cache (the cold reload). */
let turns: SessionTurnWrite[];
let briefRow: StoreBriefAndProvenanceWrite | null;
let records: CreateDecisionRecordWrite[];
let owner: string | null;
let readFails: boolean;
let readCalls: Array<{ table: string; filters: Record<string, unknown> }>;
function freshStore(): SessionStore {
  const persistedFacts = turns.flatMap(t => t.handler_facts);
  const store = createNoopSessionStore({ facts: structuredClone(persistedFacts), loadGraphResult: structuredClone(GRAPH) });
  store.append = vi.fn(async (write: SessionTurnWrite) => {
    turns.push(JSON.parse(JSON.stringify(write)) as SessionTurnWrite);
    return { id: 'persisted-run-turn' };
  });
  store.getScenarioOwner = async () => owner;
  store.readExistingScenario = async () => ({ userId: owner, graph: structuredClone(GRAPH), briefText: null, analysisInvalidatedAt: null });
  store.readAnalysisInvalidatedAt = async () => null;
  // Exercise the REAL scoped Supabase reader, including its table/id filters.
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: (_columns: string) => chain,
        eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
        async maybeSingle() {
          readCalls.push({ table, filters });
          if (readFails) return { data: null, error: { message: 'read unavailable' } };
          if (table === 'scenarios') return { error: null, data: {
            id: SCENARIO, user_id: owner, brief: briefRow?.brief ?? null,
            analysis_provenance: briefRow === null ? null : {
              graph_hash: briefRow.graph_hash, seed_used: briefRow.seed_used, response_hash: briefRow.response_hash,
            },
          } };
          const rec = records.find(r => r.scenario_id === filters.scenario_id && r.record_id === filters.id);
          return { error: null, data: rec === undefined ? null : { id: rec.record_id, scenario_id: rec.scenario_id } };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  const adapter = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 2 }), { defaultReadLimit: 20 });
  store.readRunRecordingRows = adapter.readRunRecordingRows.bind(adapter);
  return store;
}
const response = () => composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'Analysis completed.', stage: 'analyse' });
const metadata = (facts: RunAnalysisHandlerFact[]) => ({
  scenario_id: SCENARIO, turn_id: TURN, turn_class: 'handler' as const, handler_id: 'run_analysis' as const,
  request_hash: 'sha256:run-request', llm_calls_used: 0, duration_ms: 42, handler_facts: facts,
});
function commit(facts = [fact()], answer = response()) {
  return runWithProviderPolicy({ allowed: new Set(['openai']), route: 's1-c-row', calls: [], truncated: false },
    () => commitDirectAnswer(answer, metadata(facts), boundary.store!));
}
async function cold() {
  boundary.store = freshStore();
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph: structuredClone(GRAPH), requestId: 's1-c-cold', analysisInvalidatedAt: null });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_REQUIRE_USER_JWT', 'false');
  _resetConfigCache();
  turns = []; briefRow = null; records = []; owner = OWNER; readFails = false; readCalls = [];
  boundary.store = freshStore();
  boundary.brief.mockImplementation(async write => { briefRow = structuredClone(write); return true; });
  boundary.decision.mockImplementation(async write => {
    records.push(structuredClone(write)); return { record_id: write.record_id, event_id: write.event_id, deduped: false };
  });
  warn = vi.spyOn(log, 'warn');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); _resetConfigCache(); });

describe('S1-C post-append bounded capture through the real commit door', () => {
  it('RED: the turn is durable, but commit does not settle before BOTH captures complete', async () => {
    vi.useFakeTimers();
    const brief = deferred<boolean>(); const decision = deferred<DecisionRecordWriteOutcome>();
    boundary.brief.mockReturnValue(brief.promise); boundary.decision.mockReturnValue(decision.promise);
    let settled = false;
    const done = commit().then(r => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(0);
    expect(turns).toHaveLength(1);
    expect(boundary.brief).toHaveBeenCalledOnce(); expect(boundary.decision).toHaveBeenCalledOnce();
    expect(settled, 'RED at base: the fire-and-forget commit has already resolved').toBe(false);
    brief.resolve(true); await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
    const write = boundary.decision.mock.calls[0]![0];
    decision.resolve({ record_id: write.record_id, event_id: write.event_id, deduped: false });
    await done; expect(settled).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['brief', 'decision'] as const)('RED: %s rejection yields a typed outcome log while the turn succeeds', async which => {
    const failure = async () => { throw new Error('secondary persistence failed'); };
    if (which === 'brief') boundary.brief.mockImplementation(failure); else boundary.decision.mockImplementation(failure);
    const answer = response(); const result = await commit([fact()], answer);
    expect(result.response).toBe(answer); expect(turns).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'v5.run_recording.completed', scenario_id: SCENARIO, turn_id: TURN, turn_row_id: 'persisted-run-turn',
      [which === 'brief' ? 'brief_provenance' : 'decision_record']: { status: 'not_recorded', reason: 'write_failed' },
      [which === 'brief' ? 'decision_record' : 'brief_provenance']: { status: 'recorded' },
    }), expect.any(String));
  });

  it('RPC false is not recorded, without affecting the successful Run', async () => {
    boundary.brief.mockResolvedValue(false);
    await commit();
    expect(turns).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'v5.run_recording.completed', brief_provenance: { status: 'not_recorded', reason: 'no_row' },
    }), expect.any(String));
  });

  it('both hung captures consume ONE budget; a late rejection is handled', async () => {
    vi.useFakeTimers();
    const brief = deferred<boolean>(); const decision = deferred<DecisionRecordWriteOutcome>();
    boundary.brief.mockReturnValue(brief.promise); boundary.decision.mockReturnValue(decision.promise);
    let settled = false; const done = commit().then(r => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RUN_RECORDING_BUDGET_MS - 1); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await done;
    expect(turns).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'v5.run_recording.completed',
      brief_provenance: { status: 'not_recorded', reason: 'timeout' },
      decision_record: { status: 'not_recorded', reason: 'timeout' },
    }), expect.any(String));
    brief.reject(new Error('late')); decision.reject(new Error('late')); await vi.advanceTimersByTimeAsync(0);
  });

  it('GREEN: exact success payloads, response and durable Run fact are unchanged; reload omits marker', async () => {
    const run = fact(); const answer = response(); const result = await commit([run], answer);
    const brief = buildBriefProvenanceWrite(run, SCENARIO); const decision = buildDecisionRecordWrite(run, SCENARIO);
    expect(brief.kind).toBe('write'); expect(decision.kind).toBe('write');
    if (brief.kind !== 'write' || decision.kind !== 'write') throw new Error('fixture must qualify');
    expect(boundary.brief).toHaveBeenCalledOnce(); expect(boundary.brief).toHaveBeenCalledWith(brief.write);
    expect(boundary.decision).toHaveBeenCalledOnce(); expect(boundary.decision).toHaveBeenCalledWith(decision.write);
    expect(result.response).toBe(answer); expect(turns[0]!.handler_facts).toEqual([run]);
    const read = await cold(); expect(read.run_recording).toBeUndefined();
    expect(read.analysis_state).not.toBeNull();
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect(readCalls).toContainEqual({ table: 'decision_records', filters: { scenario_id: SCENARIO, id: decision.write.record_id } });
    expect(readCalls).toContainEqual({ table: 'scenarios', filters: { id: SCENARIO } });
  });

  it.each(['none', 'noop', 'refused'] as const)('GREEN: %s fact constructs neither capture store', async kind => {
    const run = fact();
    const facts = kind === 'none' ? [] : [{ ...run, noop: kind === 'noop', result: {
      ...run.result, enrichment: { ...run.result.enrichment, analysis_status: kind === 'refused' ? 'refused' : 'computed' },
    } }];
    await commit(facts); expect(turns).toHaveLength(1);
    expect(boundary.briefStore).not.toHaveBeenCalled(); expect(boundary.decisionStore).not.toHaveBeenCalled();
  });

  it('GREEN: incomplete inputs remain designed skips before store construction', async () => {
    const run = fact(); await commit([{ ...run, result: { ...run.result, leading_option_id: null, enrichment: {} } }]);
    expect(turns).toHaveLength(1);
    expect(boundary.briefStore).not.toHaveBeenCalled(); expect(boundary.decisionStore).not.toHaveBeenCalled();
  });

  it('GREEN: guest skips decision capture, keeps brief capture, and reload shows no failure', async () => {
    owner = null; await commit();
    expect(boundary.decisionStore).not.toHaveBeenCalled(); expect(boundary.brief).toHaveBeenCalledOnce();
    expect((await cold()).run_recording).toBeUndefined();
  });

  it('GREEN: failed append never starts either secondary write', async () => {
    boundary.store!.append = async () => { throw new Error('append failed'); };
    await expect(commit()).rejects.toThrow('append failed');
    expect(turns).toHaveLength(0); expect(boundary.briefStore).not.toHaveBeenCalled(); expect(boundary.decisionStore).not.toHaveBeenCalled();
  });

  it('GREEN: an outcome logger failure cannot fail the already committed turn', async () => {
    boundary.brief.mockRejectedValue(new Error('write failed')); warn.mockImplementation(() => { throw new Error('logger failed'); });
    await expect(commit()).resolves.toHaveProperty('response'); expect(turns).toHaveLength(1);
  });
});

describe('S1-C durable reload disclosure', () => {
  it('RED: actual cold graph route serves not_recorded after provenance failure, with its Run intact', async () => {
    owner = null; boundary.brief.mockRejectedValue(new Error('brief write failed')); await commit();
    boundary.store = freshStore(); // New cache/store; no capture status survives in memory.
    const app = Fastify();
    try {
      await scenarioGraphRoute(app);
      const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json().run_recording).toMatchObject({
        status: 'not_recorded', graph_hash_at_run: fact().result.graph_hash_at_run, computed_at: COMPUTED,
        brief_provenance: { status: 'not_recorded' }, decision_record: { status: 'not_applicable', reason: 'guest' },
      });
      expect(res.json().graph).toEqual(GRAPH);
      expect(res.json().analysis_state.run_state.kind).toBe('complete_current');
      expect(res.json().analysis_result).not.toBeNull();
    } finally { await app.close(); }
  });

  it('RED: canonical cold reader discloses an absent automatic decision record', async () => {
    boundary.decision.mockRejectedValue(new Error('record write failed')); await commit();
    expect((await cold()).run_recording).toMatchObject({
      status: 'not_recorded', brief_provenance: { status: 'recorded' }, decision_record: { status: 'not_recorded' },
    });
  });

  it('a different Run\'s provenance and another scenario\'s record cannot satisfy this Run', async () => {
    await commit();
    briefRow = { ...briefRow!, response_hash: 'another-response' };
    records = records.map(r => ({ ...r, scenario_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));
    expect((await cold()).run_recording).toMatchObject({
      status: 'not_recorded', brief_provenance: { status: 'not_recorded' }, decision_record: { status: 'not_recorded' },
    });
  });

  it('read errors disclose unavailable, preserving the successful Run and graph read', async () => {
    await commit(); readFails = true;
    const read = await cold();
    expect(read.run_recording).toMatchObject({ status: 'unavailable',
      brief_provenance: { status: 'unavailable' }, decision_record: { status: 'unavailable' } });
    expect(read.analysis_state?.run_state.kind).toBe('complete_current'); expect(read.analysis_result).not.toBeNull();
  });

  it('a late successful capture clears the conservative missing marker on the next read', async () => {
    boundary.brief.mockResolvedValue(false); await commit();
    expect((await cold()).run_recording?.status).toBe('not_recorded');
    const built = buildBriefProvenanceWrite(fact(), SCENARIO);
    if (built.kind !== 'write') throw new Error('fixture must qualify');
    briefRow = structuredClone(built.write);
    expect((await cold()).run_recording).toBeUndefined();
  });
});
