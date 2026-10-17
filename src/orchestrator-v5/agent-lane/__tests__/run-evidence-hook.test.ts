/**
 * ⭐ §9 HOOK FOR LANE B (BLOCKED-LEASE, outbox/LANE-B.md:19). The selected successful Run's own `run_id`, stored
 * `input_snapshot` and row occurrence reach `runFactsOf` as read-only `state.runEvidence`, through the graph read the
 * Agent already makes, under the same gate as the `analysis_result` they describe. Missing evidence stays absent.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { RUN_QUESTION_EVIDENCE_KEY } from '../../tools/handlers/run-input-snapshot.js';

const SERVED_FACT = JSON.parse(readFileSync(new URL('./fixtures/served-run-analysis-fact-for-binding.json', import.meta.url), 'utf8')) as { fact_type: string; result: Record<string, unknown> };
const SCENARIO = '9e5c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const GRAPH = {
  nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Price' }],
  edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }],
};
const SNAPSHOT = { snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: null, options: [], options_not_sent: [], factors: [], constraints: [], links: [] };

let runFact: unknown = null;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  readRecent: vi.fn(async () => (runFact === null ? [] : [{ id: 'row-run', turn_id: 't-run', turn_class: 'decide', created_at: '2026-09-24T10:00:00Z' }])),
  readFactsFor: vi.fn(async () => (runFact === null ? [] : [runFact])),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readMostRecentPendingActions: vi.fn(async () => []),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
const runFactsCalls: unknown[][] = [];
vi.mock('../run-facts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../run-facts.js')>();
  return { ...actual, runFactsOf: (...args: Parameters<typeof actual.runFactsOf>) => { runFactsCalls.push(args); return actual.runFactsOf(...args); } };
});

describe('§9: the selected Run’s own evidence reaches runFactsOf as state.runEvidence', () => {
  let hashOf: (g: unknown) => string | null;
  let read: (graph: unknown) => Promise<Record<string, unknown>>;
  let bind: typeof import('../../types/handler-fact.js').bindRunAnalysisOccurrence;
  beforeAll(async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    hashOf = (g) => computeAnalysisAffectingGraphHash(g as never) ?? null;
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    read = (graph) => readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'test' }) as never;
    ({ bindRunAnalysisOccurrence: bind } = await import('../../types/handler-fact.js'));
  }, 180_000);
  beforeEach(() => { runFact = null; runFactsCalls.length = 0; });

  const persist = (extra: Record<string, unknown>, graphAtRun: unknown = GRAPH) => {
    runFact = { ...SERVED_FACT, noop: false, result: { ...SERVED_FACT.result, scenario_id: SCENARIO, graph_hash_at_run: hashOf(graphAtRun), ...extra } };
    return runFact as never;
  };

  it('the read carries the selected fact’s run_id, stored input_snapshot and bound occurrence, beside its analysis_result', async () => {
    const fact = persist({ run_id: 'run-41', input_snapshot: SNAPSHOT });
    bind({ fact, fact_row_id: 'row-41', evaluated_scenario_revision: 41 } as never);
    const r = await read(GRAPH);
    expect(r.analysis_result, 'the control: the same fact is the served result').not.toBeNull();
    expect(r.analysis_run_evidence).toEqual({ run_id: 'run-41', input_snapshot: SNAPSHOT, occurrence: { fact_row_id: 'row-41', evaluated_scenario_revision: 41 } });
  });

  it('CONTRAST missing evidence stays absent: no snapshot and no occurrence → only the run_id; nothing → no key', async () => {
    persist({ run_id: 'run-42' });
    expect((await read(GRAPH)).analysis_run_evidence).toEqual({ run_id: 'run-42' });
    persist({});
    expect(Object.prototype.hasOwnProperty.call(await read(GRAPH), 'analysis_run_evidence')).toBe(false);
  });

  it('CONTRAST same gate as analysis_result: a Run on a different graph (not current) carries no evidence', async () => {
    persist({ run_id: 'run-43', input_snapshot: SNAPSHOT }, { ...GRAPH, nodes: [...GRAPH.nodes, { id: 'x', kind: 'factor', label: 'Churn' }] });
    const r = await read(GRAPH);
    expect(r.analysis_result).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(r, 'analysis_run_evidence')).toBe(false);
  });

  it('getCanonicalState passes the read’s evidence to runFactsOf as state.runEvidence (camelCase, as Lane B asked), never today’s graph', async () => {
    const fact = persist({ run_id: 'run-44', input_snapshot: SNAPSHOT });
    bind({ fact, fact_row_id: 'row-44', evaluated_scenario_revision: 44 } as never);
    const analysis = await read(GRAPH);
    const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
    const { ProposalStore } = await import('../proposal.js');
    const caps = createAgentCapabilities(async () => ({ status: 200, json: { graph: GRAPH, graph_hash: hashOf(GRAPH), ...analysis } }), new ProposalStore());
    const st = await caps.getCanonicalState({ scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' } as never);
    expect(st.ok).toBe(true);
    expect(st).toMatchObject({ run_facts: { question: { run_id: 'run-44', fact_row_id: 'row-44', evaluated_scenario_revision: 44 } } });
    expect(analysis.canonical_analysis_view).toMatchObject({ question: { run_id: 'run-44', fact_row_id: 'row-44', evaluated_scenario_revision: 44 } });
    expect(runFactsCalls.length, 'run facts were built from this read').toBeGreaterThan(0);
    const state = runFactsCalls.at(-1)![3] as { runEvidence?: unknown };
    expect(state.runEvidence).toEqual({ runId: 'run-44', inputSnapshot: SNAPSHOT, occurrence: { fact_row_id: 'row-44', evaluated_scenario_revision: 44 } });
    expect(runFactsCalls.at(-1)![1], 'the graph argument is unchanged').toBeDefined();
  });

  it('the same selected-Run read carries retained question evidence through getCanonicalState to the actual Run facts', async () => {
    const question = { run_id: 'run-question', evaluated_scenario_revision: 46, graph_hash_at_run: hashOf(GRAPH),
      sent_digest: SNAPSHOT.sent_digest, asked: null, calculated: null,
      dispatched_goal_threshold: null, dispatched_goal_baseline: null };
    const fact = persist({ run_id: 'run-question', input_snapshot: SNAPSHOT,
      enrichment: { ...(SERVED_FACT.result.enrichment as Record<string, unknown>), [RUN_QUESTION_EVIDENCE_KEY]: question } });
    bind({ fact, fact_row_id: 'row-question', evaluated_scenario_revision: 46 } as never);
    const analysis = await read(GRAPH);
    expect(analysis.analysis_run_evidence).toMatchObject({ evaluated_question: question,
      occurrence: { fact_row_id: 'row-question', evaluated_scenario_revision: 46 } });
    const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
    const { ProposalStore } = await import('../proposal.js');
    const caps = createAgentCapabilities(async () => ({ status: 200, json: { graph: GRAPH, graph_hash: hashOf(GRAPH), ...analysis } }), new ProposalStore());
    const state = await caps.getCanonicalState({ scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'question-hook' } as never);
    expect(state).toMatchObject({ ok: true, run_facts: { question: { run_id: 'run-question', evaluated_scenario_revision: 46,
      asked: null, calculated: null, omitted: expect.arrayContaining([
        { field: 'dispatched_goal_threshold', reason: 'not_dispatched' },
      ]) } } });
    expect((runFactsCalls.at(-1)![3] as { runEvidence: { evaluatedQuestion: unknown } }).runEvidence.evaluatedQuestion).toEqual(question);
  });

  it('CONTRAST a read without the key passes no runEvidence; malformed fields are dropped, not coerced', async () => {
    const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
    const { ProposalStore } = await import('../proposal.js');
    persist({ run_id: 'run-45' });
    const base = await read(GRAPH);
    for (const [wire, expected] of [
      [undefined, undefined],
      [{ run_id: '', input_snapshot: null, occurrence: { fact_row_id: 7, evaluated_scenario_revision: -1 } }, undefined],
      [{ run_id: 'run-45', occurrence: { evaluated_scenario_revision: 1.5 } }, { runId: 'run-45' }],
    ] as const) {
      runFactsCalls.length = 0;
      const json = { graph: GRAPH, graph_hash: hashOf(GRAPH), ...base, analysis_run_evidence: wire };
      const caps = createAgentCapabilities(async () => ({ status: 200, json }), new ProposalStore());
      await caps.getCanonicalState({ scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' } as never);
      const state = runFactsCalls.at(-1)![3] as Record<string, unknown>;
      if (expected === undefined) expect(Object.prototype.hasOwnProperty.call(state, 'runEvidence')).toBe(false);
      else expect(state.runEvidence).toEqual(expected);
    }
  });
});
