/**
 * S1-D: REAL commitDirectAnswer -> appendCheckedGraphWrite -> serialised store
 * -> graph route -> live readBackState -> a fresh graph-route app on reload.
 * Only SessionStore is replaced. No readiness, commit, selector or route mock.
 * RED at 54afd737b: current_read.analysis_ready is undefined in the no-Run,
 * current-Run and ordinary-stale rows, but live.analysisReady is populated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import type { SessionStore, SessionTurnWrite } from '../../orchestrator-v5/session/store.js';
import { createNoopSessionStore } from '../../orchestrator-v5/session/__tests__/fixtures.js';
import { commitDirectAnswer } from '../../orchestrator-v5/commit.js';
import { composeDirectAnswerResponse } from '../../orchestrator-v5/compose.js';
import { computeExpectedGraphCasHashes } from '../../orchestrator-v5/context/graph-cas-conflict.js';
import { deriveDecisionContextGraphHash } from '../../orchestrator-v5/build-turn-context.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { buildRunInputSnapshot } from '../../orchestrator-v5/tools/handlers/run-input-snapshot.js';
import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { readBackState } from '../agent-v1-turn.js';

const boundary = vi.hoisted(() => ({ store: undefined as SessionStore | undefined }));
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>();
  return { ...actual, getSessionStore: () => {
    if (boundary.store === undefined) throw new Error('store not bound');
    return boundary.store;
  } };
});

const SCENARIO = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c';
const COMPUTED_AT = '2026-10-06T10:00:00.000Z';
const edge = (from: string, to: string) => ({ from, to,
  strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
const GRAPH = {
  goal_node_id: 'goal_growth',
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Revenue growth', goal_threshold: 0.8,
      goal_threshold_raw: 80000, goal_threshold_unit: 'GBP/month',
      observed_state: { value: 0.5, unit: 'GBP/month' } },
    { id: 'decision', kind: 'decision', label: 'Capacity approach' },
    { id: 'fac_market', kind: 'factor', label: 'Market demand', category: 'controllable',
      observed_state: { value: 0.5, cap: 1 }, provenance: 'user_set' },
    { id: 'opt_hire', kind: 'option', label: 'Hire', interventions: { fac_market: { value: 0.4, source: 'user_specified' } } },
    { id: 'opt_hold', kind: 'option', label: 'Hold', interventions: { fac_market: { value: 0.1, source: 'user_specified' } } },
  ],
  edges: [edge('decision', 'opt_hire'), edge('decision', 'opt_hold'),
    edge('opt_hire', 'fac_market'), edge('opt_hold', 'fac_market'), edge('fac_market', 'goal_growth')],
};

// JSON bytes survive new apps and reads. The fake's CAS is at the append
// boundary; every graph/fact arrives from the checked commit door.
function persistedStore() {
  let graph: unknown = null;
  const writes: SessionTurnWrite[] = [];
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const facts = () => writes.flatMap((w, wi) => w.handler_facts.map((fact, fi) => ({
    fact: copy(fact), fact_row_id: `fact-${wi}-${fi}`, fact_created_at: COMPUTED_AT,
  }))).reverse();
  const store: SessionStore = {
    ...createNoopSessionStore(),
    async append(write) {
      if (write.graph !== undefined) {
        expect(write.expectedGraphIdentityHash, 'CAS base must be the persisted identity').toBe(
          computeExpectedGraphCasHashes(graph).expectedGraphIdentityHash,
        );
        graph = copy(write.graph);
      }
      writes.push(copy(write));
      return { id: `row-${writes.length}` };
    },
    async loadGraph() { return copy(graph); },
    async loadGraphAndBriefText() { return { graph: copy(graph), briefText: 'Explore our growth assumptions.' }; },
    async readExistingScenario() { return { userId: null, graph: copy(graph),
      briefText: 'Explore our growth assumptions.', analysisInvalidatedAt: null }; },
    async getScenarioOwner() { return null; },
    async readScenarioRunAnalysisFactsFor() { return { facts: facts(), total_count: facts().length }; },
    async readFactsFor() { return facts().map((row) => row.fact); },
    async readFactsWithTurnFor() { return []; },
  };
  return { store, writes };
}

const apps: FastifyInstance[] = [];
async function app() {
  const instance = Fastify();
  await scenarioGraphRoute(instance);
  await instance.ready();
  apps.push(instance);
  return instance;
}
function dispatch(instance: FastifyInstance) {
  return async (path: string, body: unknown) => {
    const response = await instance.inject({ method: 'POST', url: path,
      payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    return { status: response.statusCode, json: response.json() as Record<string, unknown> };
  };
}
async function save(graph?: unknown, handlerFacts: HandlerFact[] = []) {
  const base = await boundary.store!.loadGraph(SCENARIO);
  return commitDirectAnswer(composeDirectAnswerResponse({
    answerKind: 'functional', assistant_text: 'Saved.', stage: 'frame',
  }), {
    scenario_id: SCENARIO, turn_id: `turn-${serial++}`, turn_class: 'direct_answer', handler_id: null,
    request_hash: `request-${serial}`, llm_calls_used: 0, duration_ms: 1,
    handler_facts: handlerFacts, graph, refBaseGraph: base,
    ...computeExpectedGraphCasHashes(base),
  }, boundary.store!);
}
let serial = 0;
beforeEach(() => { serial = 0; });
afterEach(async () => { await Promise.all(apps.splice(0).map((instance) => instance.close())); });

async function pair() {
  const live = await readBackState(dispatch(await app()), SCENARIO);
  const coldResponse = await dispatch(await app())(`/assist/v1/scenarios/${SCENARIO}/graph`, {});
  expect(coldResponse.status).toBe(200);
  const cold = coldResponse.json;
  const current = cold.current_read as { analysis_ready?: unknown; run_state: { kind: string } | null; figures: unknown[] };
  return { live, cold, current };
}

describe('S1-D same saved state, live/cold full readiness', () => {
  it.each(['never_run', 'complete_current', 'complete_stale', 'goal_unit_changed'] as const)('%s: full readiness survives a cold reload', async (kind) => {
    const persisted = persistedStore();
    boundary.store = persisted.store;
    await save(GRAPH);
    if (kind !== 'never_run') {
      const savedGraph = await persisted.store.loadGraph(SCENARIO);
      const hash = deriveDecisionContextGraphHash(savedGraph);
      expect(hash).not.toBeNull();
      const inputSnapshot = kind === 'goal_unit_changed' ? buildRunInputSnapshot({
        submittedOptions: [], rawObjectsPerOption: [], wirePerOption: [],
        heldFactorIdsByOptionId: new Map(), optionsNotSent: [],
        wireGraph: savedGraph, plotPayload: { goal_node_id: GRAPH.goal_node_id },
      }) : null;
      if (kind === 'goal_unit_changed') expect(inputSnapshot).not.toBeNull();
      // turn_id belongs to save()'s SessionTurnWrite, not the strict Run fact.
      await save(undefined, [RunAnalysisHandlerFactSchema.parse({
        fact_type: 'run_analysis', fact_version: 1, noop: false,
        result: { scenario_id: SCENARIO, leading_option_id: 'opt_hire', summary: 'A saved comparison.',
          graph_hash_at_run: hash, computed_at: COMPUTED_AT, win_probabilities: { opt_hire: 0.68, opt_hold: 0.32 },
          constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'unevaluated' },
          goal_certainty: [], option_participation: [],
          ...(inputSnapshot === null ? {} : { input_snapshot: inputSnapshot }),
          enrichment: { analysis_status: 'ok', robustness: { level: 'moderate', near_tie: false } },
        },
      })]);
      if (kind === 'complete_stale') {
        const base = await persisted.store.loadGraph(SCENARIO) as typeof GRAPH;
        await save({ ...base, nodes: base.nodes.map((node) => node.id === 'fac_market'
          ? { ...node, observed_state: { ...node.observed_state, value: 0.6 } } : node) });
      }
      if (kind === 'goal_unit_changed') {
        const base = await persisted.store.loadGraph(SCENARIO) as typeof GRAPH;
        await save({ ...base, nodes: base.nodes.map((node) => node.id === 'goal_growth'
          ? { ...node, goal_threshold_unit: 'USD/month', observed_state: { value: 0.5, unit: 'USD/month' } } : node) });
      }
    }
    const { live, cold, current } = await pair();
    expect(current.run_state?.kind).toBe(kind === 'goal_unit_changed' ? 'complete_stale' : kind);
    expect(live.analysisReady).toBeDefined();
    // RED at base: cold undefined vs live full canonical readiness.
    expect(current.analysis_ready).toEqual(live.analysisReady);
    const ready = current.analysis_ready as ReturnType<typeof buildCanonicalAnalysisReadyFromGraph>;
    const canonical = buildCanonicalAnalysisReadyFromGraph(await persisted.store.loadGraph(SCENARIO))!;
    expect(ready).toMatchObject(canonical);
    expect(ready?.goal_threshold_unit).toBe(canonical.goal_threshold_unit);
    expect(ready?.analysis_admission).toEqual(canonical.analysis_admission);
    expect(ready?.options).toHaveLength(2);
    if (kind === 'goal_unit_changed') {
      expect(ready).toMatchObject({ freshness: 'stale', freshness_reason: 'your goal’s unit changed', computed_at: COMPUTED_AT });
    }
    // GREEN at base: same edit token, graph/provenance, Run verdict and block.
    expect(live.graphHash).toBe(cold.graph_hash);
    expect(live.graph).toEqual(cold.graph);
    expect(live.analysisState).toEqual(cold.analysis_state);
    expect(live.analysisResult ?? null).toEqual(cold.analysis_result);
    expect(live.goalCertainty).toEqual(cold.analysis_goal_certainty);
    expect(live.optionParticipation).toEqual(cold.analysis_option_participation);
    expect(cold).not.toHaveProperty('analysis_ready');
    if (kind !== 'complete_current') {
      expect(cold.analysis_result).toBeNull();
      expect(current.figures).toEqual([]);
      expect(current).not.toHaveProperty('run_id');
      expect(current).not.toHaveProperty('delivered_record');
    }
    expect(persisted.writes.length).toBe(kind === 'never_run' ? 1 : kind === 'complete_current' ? 2 : 3);
  });

  it('CONTROL: the saved graph, edit token and provenance already survive cold reload', async () => {
    boundary.store = persistedStore().store;
    await save(GRAPH);
    const { live, cold } = await pair();
    expect(typeof cold.graph_hash).toBe('string');
    expect(live.graphHash).toBe(cold.graph_hash);
    expect(live.graph).toEqual(cold.graph);
    const graph = cold.graph as typeof GRAPH;
    expect(graph.nodes.find((node) => node.id === 'fac_market')?.provenance).toBe('user_set');
    expect(live.analysisState).toEqual(cold.analysis_state);
    expect(cold).not.toHaveProperty('analysis_ready');
  });

  it('blocked inputs: cold/live may_run stays false with the same questions and admission', async () => {
    boundary.store = persistedStore().store;
    await save({ ...GRAPH, nodes: GRAPH.nodes.map((node) => node.id === 'fac_market'
      ? { ...node, observed_state: undefined } : node) });
    const { live, current } = await pair();
    expect(current.analysis_ready).toEqual(live.analysisReady);
    expect(current.analysis_ready).toMatchObject({ may_run: false });
    const canonical = buildCanonicalAnalysisReadyFromGraph(await boundary.store.loadGraph(SCENARIO))!;
    expect(current.analysis_ready).toMatchObject(canonical);
    expect(canonical.blockers?.length).toBeGreaterThan(0);
  });

  it('CONTROL: no graph keeps analysis unanswered and cannot invent readiness or a Run', async () => {
    boundary.store = persistedStore().store;
    await save();
    const { live, cold, current } = await pair();
    expect(current.analysis_ready).toBeUndefined();
    expect(live.analysisReady).toBeUndefined();
    expect(current.run_state).toBeNull();
    expect(cold.analysis_result).toBeNull();
    expect(live.graphHash).toBeUndefined();
  });
});
