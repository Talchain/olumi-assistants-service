import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyGraph, legacyRun, AT, SCENARIO } from '../../context/__tests__/legacy-gap-projection.fixture.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { stampRunAnalysisProjection } from '../../context/analysis-projection-policy.js';
import { deriveAnalysisFreshness } from '../../context/freshness.js';
import { ANALYSIS_REREAD_TIMEOUT_MS } from '../../session/analysis-read-deadline.js';
import { turnReadCache, FRESH_READ } from '../../agent-lane/turn-read-cache.js';
import { runExplanationCurrentness } from '../../agent-lane/run-currentness.js';
import { runExplanationChip, runExplanationMatches, RUN_EXPLANATION_MESSAGE, RUN_EXPLANATION_UNAVAILABLE_TEXT } from '../../agent-lane/run-explanation.js';
import type { SessionStore } from '../../session/store.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { buildCanonicalCommittedGraphReceipt } from '../../compose/applied-graph-emit.js';

const GRAPH = legacyGraph('node', []);
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const TURN_ROW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FACT_ROW = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RUN = legacyRun('node', false, true);
RUN.result.graph_hash_at_run = HASH;
RUN.result.enrichment = stampRunAnalysisProjection(RUN.result.enrichment!);
const IDENTIFIED = { fact: RUN, fact_row_id: FACT_ROW, fact_created_at: AT };
const WITH_TURN = { ...IDENTIFIED, turn_id: TURN_ROW };
const VERSION = { version_number: 7, version_id: 'version-7', mutation_id: 'mutation-7', source_turn_id: 'turn-7' };
const ACK = { assistant_text: '', blocks: [], suggested_actions: [] };
let committed = false;
let writerKind: 'unchanged' | 'committed' = 'unchanged';
const writer = vi.fn(async (_input: unknown, _store?: unknown) => {
  if (writerKind === 'unchanged') return { kind: 'unchanged' };
  committed = true;
  return { kind: 'committed', graph: GRAPH, analysisGraphHash: HASH, persistedRowId: TURN_ROW,
    response: ACK, modelVersionReceipt: VERSION };
});
const riskGate = vi.fn((_input: unknown) => ({ kind: 'refused', reason: 'unverified' }));
const factorGate = vi.fn((_input: unknown) => ({ kind: 'refused', reason: 'unverified' }));
const store = {
  readExistingScenario: vi.fn(async (_sid: string) => ({ userId: null, graph: GRAPH, briefText: null })),
  loadGraph: vi.fn(async (_sid: string) => GRAPH),
  readMostRecentPendingActions: vi.fn(async (_sid: string) => []),
  readRecent: vi.fn(async (_sid: string) => [{ id: TURN_ROW, scenario_id: SCENARIO, turn_id: 'run-turn',
    turn_class: 'handler', handler_id: 'run_analysis', request_hash: 'hash', response_emitted: true,
    llm_calls_used: 0, duration_ms: 0, created_at: AT }]),
  readFactsWithTurnFor: vi.fn(async (_ids: readonly string[]) => [WITH_TURN]),
  readFactsFor: vi.fn(async (_ids: readonly string[]) => [RUN]),
  readScenarioRunAnalysisFactsFor: vi.fn(async (_sid: string, _limit: number) => ({ facts: [IDENTIFIED], total_count: 1 })),
  readAnalysisInvalidatedAt: vi.fn(async (_sid: string) => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../option-intervention-edit.js', async original => ({
  ...await original<Record<string, unknown>>(), executeOptionInterventionEdit: (...args: unknown[]) => writer(args[0], args[1]),
  executeOptionInterventionBatch: (...args: unknown[]) => writer(args[0], args[1]),
}));
vi.mock('../../handlers/add-risk-dispatch.js', () => ({ dispatchAddRiskTransaction: (...args: unknown[]) => riskGate(args[0]) }));
vi.mock('../../handlers/add-factor-dispatch.js', () => ({ dispatchAddFactorTransaction: (...args: unknown[]) => factorGate(args[0]) }));

import { dispatchOptionLevelsBatch, holdAddRiskInProcess, holdAddFactorInProcess } from '../dispatch.js';
import { loadScenarioAnalysisFactsForRead } from '../../build-turn-context.js';
import { readBackState } from '../../../routes/agent-v1-turn.js';

// Execute the route's actual mismatch branch without starting a server/socket.
const route = ts.createSourceFile('route.ts', readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
let mismatch: ts.IfStatement | undefined;
function find(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(route).startsWith("fastPath === 'explain' && (runStillCurrent === false")) mismatch = node;
  ts.forEachChild(node, find);
}
find(route);
function narrationAfter(read: Awaited<ReturnType<typeof readBackState>>, explanationId: string) {
  expect(mismatch).toBeDefined();
  const code = ts.transpileModule(`let result = { assistant_text: 'Verified narration', items: [] }; let text = result.assistant_text;
    let fastPathView = { view: 'Verified view' }; let narrationStatus = 'ready';
    ${mismatch!.getText(route)}; return { result, text, fastPathView, narrationStatus };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('fastPath', 'runStillCurrent', 'runExplanationMatches', 'explanationId', 'scenarioId',
    'graphHash', 'analysisState', 'analysisResult', 'history', 'RUN_EXPLANATION_UNAVAILABLE_TEXT', 'RUN_EXPLANATION_MESSAGE', code)(
    'explain', undefined, runExplanationMatches, explanationId, SCENARIO, read.graphHash, read.analysisState,
    read.analysisResult, [], RUN_EXPLANATION_UNAVAILABLE_TEXT, RUN_EXPLANATION_MESSAGE) as {
      result: { assistant_text: string; items: unknown[] }; text: string; fastPathView: unknown; narrationStatus: string;
    };
}

const DEPENDENCIES = ['readRecent', 'readFactsWithTurnFor', 'readFactsFor', 'readScenarioRunAnalysisFactsFor', 'readAnalysisInvalidatedAt'] as const;
type Dependency = typeof DEPENDENCIES[number] | 'readExistingScenario';
function strand(dependency: Dependency, postCommit = false) {
  // Cover the legacy facts port independently of the production with-turn port.
  if (dependency === 'readFactsFor') store.readFactsWithTurnFor.mockResolvedValue([]);
  const method = store[dependency];
  const healthy = method.getMockImplementation()!;
  let rejectLate!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
  method.mockImplementation(((...args: never[]) => postCommit && !committed ? healthy(...args) : pending) as never);
  return rejectLate;
}
async function byDeadline<T>(promise: Promise<T>, deadline = ANALYSIS_REREAD_TIMEOUT_MS): Promise<T> {
  let settled = false;
  void promise.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(deadline - 1);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled, 'a dependency that never settles must not strand this member').toBe(true);
  return promise;
}
async function late(reject: (error: Error) => void) {
  reject(new Error('late dependency rejection after acknowledgement'));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
}
const PAYLOAD = { scenario_id: SCENARIO, turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', stage: 'frame' as const, requestHash: 'request-identity' };
const TARGET = { optionId: 'opt-a', factorId: 'factor', modelValue: 0.9 };
const BATCHES = [
  ['single', { targets: [TARGET], base_graph_hash: HASH }],
  ['compound', { targets: [TARGET], expectedLinks: [], values: [{ factorId: 'factor', value: 0.5 }], base_graph_hash: HASH }],
  ['links', { targets: [], linkStrengths: [{ from: 'factor', to: 'goal', magnitude: 0.7, intent: 'set',
    expected: { mean: 0.6, effect_direction: 'positive' }, band: 'moderate', adopted: false }], base_graph_hash: HASH }],
  ['link effect', { targets: [], linkEffect: { from: 'factor', to: 'goal',
    effect: { amount: 0.1, amount_unit: 'Growth', per_source_change: 0.1, per_source_change_unit: 'Investment' },
    quote: 'Investment increases growth', edge_token: 'factor-to-goal', reading_token: 'approved-effect-reading' }, base_graph_hash: HASH }],
  ['identity', { targets: [], identityConfirm: { outcome_id: 'goal', factor_ids: ['factor'],
    words: 'Growth follows investment', reading_token: 'approved-identity-reading' }, base_graph_hash: HASH }],
] as const satisfies readonly (readonly [string, Parameters<typeof dispatchOptionLevelsBatch>[1]])[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  committed = false; writerKind = 'unchanged';
  store.readExistingScenario.mockImplementation(async () => ({ userId: null, graph: GRAPH, briefText: null }));
  store.readRecent.mockImplementation(async () => [{ id: TURN_ROW, scenario_id: SCENARIO, turn_id: 'run-turn',
    turn_class: 'handler', handler_id: 'run_analysis', request_hash: 'hash', response_emitted: true,
    llm_calls_used: 0, duration_ms: 0, created_at: AT }]);
  store.readFactsWithTurnFor.mockImplementation(async () => [WITH_TURN]);
  store.readFactsFor.mockImplementation(async () => [RUN]);
  store.readScenarioRunAnalysisFactsFor.mockImplementation(async () => ({ facts: [IDENTIFIED], total_count: 1 }));
  store.readAnalysisInvalidatedAt.mockImplementation(async () => null);
});
afterEach(() => { vi.useRealTimers(); });

function assertIdentity() {
  expect(store.readRecent).toHaveBeenCalledWith(SCENARIO);
  expect(store.readScenarioRunAnalysisFactsFor).toHaveBeenCalledWith(SCENARIO, 21);
  expect(store.readAnalysisInvalidatedAt).toHaveBeenCalledWith(SCENARIO);
  expect(RUN.result).toMatchObject({ scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at: AT, run_id: 'legacy-original' });
}

describe('whole evidence reread deadlines at the real writer members', () => {
  for (const [name, batch] of BATCHES) {
    it(`healthy ${name}: complete reply bytes and selected Run are unchanged`, async () => {
      writerKind = 'committed';
      const reply = await dispatchOptionLevelsBatch(PAYLOAD, batch, 'healthy');
      const parsed = GraphV3.parse(GRAPH);
      const ready = buildCanonicalAnalysisReadyFromGraph(parsed);
      if (ready === undefined) throw new Error('healthy fixture has no readiness');
      // The pre-deadline dispatch's complete returned shape, using its existing pure authorities.
      const expected = {
        response: { ...ACK, graph_hash: HASH, draft_graph: buildCanonicalCommittedGraphReceipt(parsed, ready) },
        commitPerformed: true,
        committedVersion: { version: VERSION.version_number, version_id: VERSION.version_id,
          mutation_id: VERSION.mutation_id, source_turn_id: VERSION.source_turn_id },
        analysisReady: ready,
        freshness: deriveAnalysisFreshness([RUN], HASH, undefined, { priorFactsReadOk: true,
          analysisInvalidatedAt: null, currentGraph: GRAPH, priorFactsWithTurn: [WITH_TURN] }),
        graph: parsed,
      };
      expect(JSON.stringify(reply)).toBe(JSON.stringify(expected));
      expect(reply.freshness).toMatchObject({ freshness: 'fresh', graph_hash_at_run: HASH, computed_at: AT });
      expect(vi.getTimerCount()).toBe(0);
    });
    it.each(DEPENDENCIES)(`pre-write ${name}: pending %s resolves unknown within one deadline`, async dependency => {
      const reject = strand(dependency);
      const reply = await byDeadline(dispatchOptionLevelsBatch(PAYLOAD, batch, 'pre-write'));
      expect(writer).toHaveBeenCalledOnce();
      expect(writer.mock.calls[0]?.[0]).toMatchObject({ scenarioId: SCENARIO, freshness: 'unknown' });
      expect(reply).toMatchObject({ commitPerformed: false, commitSkippedReason: 'verified_no_op' });
      expect(reply.freshness?.freshness).not.toBe('fresh');
      assertIdentity(); await late(reject);
    });
    it.each(DEPENDENCIES)(`post-commit ${name}: pending %s retains exact receipt/acknowledgement within one deadline`, async dependency => {
      writerKind = 'committed';
      const reject = strand(dependency, true);
      const reply = await byDeadline(dispatchOptionLevelsBatch(PAYLOAD, batch, 'post-commit'));
      expect(reply).toMatchObject({ commitPerformed: true, committedVersion: { version: 7, version_id: VERSION.version_id,
        mutation_id: VERSION.mutation_id, source_turn_id: VERSION.source_turn_id },
      response: { ...ACK, graph_hash: HASH }, freshness: { freshness: 'unknown', reason: 'derivation_failed' } });
      expect(reply.response.draft_graph).toBeDefined();
      expect(reply.graph).toEqual(GraphV3.parse(GRAPH));
      expect(writer).toHaveBeenCalledOnce();
      assertIdentity(); await late(reject);
    });
  }
  for (const kind of ['risk', 'factor'] as const) {
    it.each(DEPENDENCIES)(`${kind} hold: pending %s resolves with unknown referee currency`, async dependency => {
      const reject = strand(dependency);
      const common = { scenario_id: SCENARIO, turn_id: PAYLOAD.turn_id, base_graph_hash: HASH };
      const read = kind === 'risk'
        ? holdAddRiskInProcess({ ...common, risk: { id: 'risk-id', label: 'Risk' }, links: [] }, 'risk-hold')
        : holdAddFactorInProcess({ ...common, factors: [{ id: 'factor-id', label: 'Factor', link: { to_id: 'goal', effect_direction: 'positive' }, observed_state: {} }] }, 'factor-hold');
      expect(await byDeadline<unknown>(read)).toEqual({ status: 'refused', reason: 'unverified' });
      const gate = kind === 'risk' ? riskGate : factorGate;
      expect(gate.mock.calls[0]?.[0]).toMatchObject({ scenarioId: SCENARIO, currentGraphHash: HASH, freshness: 'unknown' });
      expect(writer).not.toHaveBeenCalled();
      assertIdentity(); await late(reject);
    });
  }
});

// This dispatch keeps access BEFORE the real hot-window/durable/marker reads, as the graph route does.
async function graphDispatch() {
  await store.readExistingScenario(SCENARIO);
  const [read, marker] = await Promise.all([
    loadScenarioAnalysisFactsForRead(SCENARIO, 'narration'), store.readAnalysisInvalidatedAt(SCENARIO),
  ]);
  const fresh = deriveAnalysisFreshness(read.factSet.facts, HASH, undefined, { currentGraph: GRAPH,
    priorFactsReadOk: read.factSet.status === 'complete', analysisInvalidatedAt: marker, priorFactsWithTurn: read.priorFactsWithTurn });
  return { status: 200, json: { graph: GRAPH, graph_hash: HASH,
    analysis_state: { run_state: { kind: fresh.freshness === 'fresh' ? 'complete_current' : 'unknown_degraded', computed_at: fresh.computed_at } },
    ...(fresh.freshness === 'fresh' ? { analysis_result: { type: 'analysis_result', computed_against_hash: fresh.graph_hash_at_run } } : {}) } };
}

describe('after-narration canonical reread: real readback and mismatch branch', () => {
  it.each(['readExistingScenario', ...DEPENDENCIES] as const)('pending %s withholds the identity-bound narration at the deadline', async dependency => {
    const initial = await readBackState(graphDispatch, SCENARIO);
    const chip = runExplanationChip(SCENARIO, initial)!;
    expect(chip).not.toBeNull();
    expect(await runExplanationCurrentness(store as unknown as SessionStore, SCENARIO, null, chip.id, { graph: GRAPH, briefText: null })).toBeUndefined();
    const reject = strand(dependency);
    const cache = turnReadCache(graphDispatch, `/assist/v1/scenarios/${SCENARIO}/graph`);
    const read = await byDeadline(readBackState((path, _body) => cache.dispatch(path, FRESH_READ), SCENARIO));
    expect(runExplanationMatches(chip.id, SCENARIO, read)).toBe(false);
    expect(read.analysisState).toBeUndefined();
    expect(read.analysisResult).toBeUndefined();
    expect(narrationAfter(read, chip.id)).toMatchObject({ result: { assistant_text: RUN_EXPLANATION_UNAVAILABLE_TEXT },
      text: RUN_EXPLANATION_UNAVAILABLE_TEXT, fastPathView: null, narrationStatus: 'stale' });
    await late(reject);
  });
  it('healthy canonical readback stays byte-identical and keeps the same narration licence', async () => {
    const direct = await readBackState(graphDispatch, SCENARIO);
    const cache = turnReadCache(graphDispatch, `/assist/v1/scenarios/${SCENARIO}/graph`);
    const bounded = await readBackState((path, _body) => cache.dispatch(path, FRESH_READ), SCENARIO);
    expect(JSON.stringify(bounded)).toBe(JSON.stringify(direct));
    const chip = runExplanationChip(SCENARIO, direct)!;
    expect(narrationAfter(bounded, chip.id)).toMatchObject({ text: 'Verified narration', narrationStatus: 'ready' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
