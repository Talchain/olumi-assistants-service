import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

vi.mock('../../config/index.js', async (original) => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_target, key) => String(key) }),
}));
const store = vi.hoisted(() => ({
  readExistingScenario: vi.fn(), readRecent: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(),
  readScenarioRunAnalysisFactsFor: vi.fn(), readAnalysisInvalidatedAt: vi.fn(),
  readMostRecentPendingActions: vi.fn(),
}));
vi.mock('../../orchestrator-v5/session/index.js', async (original) => ({
  ...(await original<typeof import('../../orchestrator-v5/session/index.js')>()), getSessionStore: () => store,
}));
const hashInput = vi.hoisted(() => vi.fn());
vi.mock('../../orchestrator-v5/build-turn-context.js', async (original) => {
  const actual = await original<typeof import('../../orchestrator-v5/build-turn-context.js')>();
  return { ...actual, deriveDecisionContextGraphHash: (graph: unknown) => hashInput(graph) ?? actual.deriveDecisionContextGraphHash(graph) };
});

import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { buildAnalysisResultBlock } from '../../orchestrator-v5/compose.js';
import { goalChanceFactsForAgent } from '../../orchestrator-v5/goal-target/goal-chance-range-agent.js';
import { goalChanceCellFacesForAgent } from '../../orchestrator-v5/agent-lane/goal-chance-screen-lines.js';
import { buildAnalysisRefusalFact } from '../../orchestrator-v5/context/analysis-refusal-continuity.js';
import { deriveDecisionContextGraphHash } from '../../orchestrator-v5/build-turn-context.js';

type Json = Record<string, any>;
const fixture: Json = JSON.parse(readFileSync(new URL('./fixtures/canonical-view-b1.json', import.meta.url), 'utf8'));
const saved = fixture.j;
const SCENARIO = saved.scenario_id;
function capturedFact() {
  return RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: { scenario_id: SCENARIO, leading_option_id: saved.analysis_result.leading_option_id,
      summary: saved.analysis_result.summary, win_probabilities: saved.analysis_result.win_probabilities,
      enrichment: saved.analysis_result.enrichment, graph_hash_at_run: saved.current_read.computed_against_hash,
      computed_at: saved.analysis_state.run_state.computed_at, run_id: saved.current_read.run_id,
      goal_certainty: saved.analysis_goal_certainty } });
}
function serveFacts(facts: ReturnType<typeof capturedFact>[]) {
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: facts.map((fact, i) => ({
    fact, fact_row_id: `captured-${i}`, fact_created_at: fact.result.computed_at,
  })), total_count: facts.length });
}
let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  store.readExistingScenario.mockResolvedValue({ userId: null, graph: structuredClone(saved.graph), briefText: saved.brief_text, analysisInvalidatedAt: null, revision: 7 });
  store.readRecent.mockResolvedValue([]);
  store.readFactsFor.mockResolvedValue([]);
  store.readFactsWithTurnFor.mockResolvedValue([]);
  store.readMostRecentPendingActions.mockResolvedValue([]);
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
  serveFacts([capturedFact()]);
  app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
});
afterEach(async () => { await app.close(); });
async function read(): Promise<Json> {
  const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe('canonical view on the existing scenario read route', () => {
  it('DATA-PARITY: turn/read parity on a captured Run fact, with no altered captured numbers', async () => {
    const original = readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/cut9-prod-p1-2-7e3f8fb-readback-run1.json', import.meta.url));
    expect(createHash('sha256').update(original).digest('hex')).toBe(fixture._provenance.sha256);
    expect(saved).toEqual(JSON.parse(original.toString()).j);
    const fact = capturedFact();
    const before = JSON.stringify(fact);
    // The capture's old projection hash does not match this source's graph
    // projection. Isolate ONLY the current-hash input for this parity row;
    // retain the historical stamp and every captured figure unchanged. The
    // graph-edit row below uses the real current hash function throughout.
    expect(deriveDecisionContextGraphHash(saved.graph)).not.toBe(fact.result.graph_hash_at_run);
    hashInput.mockReturnValueOnce(fact.result.graph_hash_at_run);
    const response = await read();
    expect(response.analysis_state.run_state.kind).toBe('complete_current');
    const expected = goalChanceFactsForAgent(buildAnalysisResultBlock(fact), saved.graph, true);
    const view = response.canonical_analysis_view;
    expect(view).toBeDefined();
    expect(view.source).toBe('stored_run_facts');
    expect(view.staleness).toMatchObject({ stale: false, revision: 7, run_revision: null, basis: 'analysis_graph_hash_interim' });
    const faces = goalChanceCellFacesForAgent(buildAnalysisResultBlock(fact), saved.graph, true);
    expect(view.options.map((o: Json) => [o.option_id, o.cell])).toEqual(Object.entries(expected.goal_chance_display!).map(([option_id, display]) => [option_id, { kind: 'figure', display, face: faces.get(option_id) }]));
    expect(view.options.every((o: Json) => typeof o.cell.face === 'string' && o.cell.face.includes(o.cell.display))).toBe(true);
    expect(JSON.stringify(fact)).toBe(before);
    expect(store.readExistingScenario).toHaveBeenCalledExactlyOnceWith(SCENARIO);
  });

  it('DATA-EDIT: a graph edit after the Run exposes stale:true and preserves the existing result gate', async () => {
    const edited = structuredClone(saved.graph);
    const factor = edited.nodes.find((n: Json) => n.kind === 'factor' && typeof n.observed_state?.value === 'number');
    expect(factor).toBeDefined();
    factor.observed_state.value += 0.01;
    expect(deriveDecisionContextGraphHash(edited)).not.toBe(saved.current_read.computed_against_hash);
    store.readExistingScenario.mockResolvedValue({ userId: null, graph: edited, briefText: saved.brief_text, analysisInvalidatedAt: null, revision: 8 });
    const response = await read();
    expect(response.analysis_result).toBeNull();
    expect(response.current_read.figures).toEqual([]);
    expect(response.canonical_analysis_view.staleness).toMatchObject({ stale: true, revision: 8, run_revision: null });
    expect(response.canonical_analysis_view.options).toEqual([]);
    expect(response.canonical_analysis_view.run.graph_hash_at_run).toBe(saved.current_read.computed_against_hash);
  });

  it('DATA-REFUSAL-SELECTION: a newer refused attempt never replaces the saved Run', async () => {
    const fact = capturedFact();
    const refusal = buildAnalysisRefusalFact({ scenarioId: SCENARIO, graphHash: fact.result.graph_hash_at_run, reasonCode: 'analysis_not_ready', computedAt: '2026-10-08T12:00:00.000Z' });
    serveFacts([refusal, fact]);
    const response = await read();
    expect(response.canonical_analysis_view.run.run_id).toBe(fact.result.run_id);
    expect(response.canonical_analysis_view.run.computed_at).toBe(fact.result.computed_at);
    serveFacts([refusal]);
    const refused = await read();
    expect(refused.canonical_analysis_view.run).toBeNull();
    expect(refused.canonical_analysis_view.options).toEqual([]);
  });

  it('DATA-READ-FAILURE: failed fact reads keep the graph and expose unknown freshness', async () => {
    store.readScenarioRunAnalysisFactsFor.mockRejectedValue(new Error('Synthetic fact read unavailable'));
    const response = await read();
    expect(response.graph).toEqual(saved.graph);
    expect(response.canonical_analysis_view.staleness.stale).toBeNull();
    expect(response.canonical_analysis_view.options).toEqual([]);
  });
});
