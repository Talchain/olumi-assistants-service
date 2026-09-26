/**
 * THE RELOAD CARRIES THE RUN'S OWN LEADER-LIMIT RISKS (R&C #70 5843907129; AI Quality's plan 5842658396).
 *
 * `analysis_constraint_verdict_state` (#1958) says whether a limit was evaluated; it cannot say that the option
 * that comes out ahead is more likely than not to BREAK one. The transport block drops `constraint_results`, so
 * the Agent can never derive that from the readback block — only from the FACT, whose `enrichment` is the
 * verbatim PLoT body. The carrier is `readLeaderLimitRisksFromResult` (the one reader, #1960) over the SAME fact,
 * under the SAME freshness gate and the SAME delivered-block gate as the verdict state.
 *
 * Envelopes are the verbatim C50 capture (PLoT b09c0f2): U3b is producer-certified (`decision_grade: true`)
 * and scores the leader `opt_raise` at 0.981 on `gc_u3b`; each row changes the one field it names.
 *
 *   leader P 0.3, fresh          → one risk, identical to the canonical reader on THAT fact and THIS graph
 *   capture as served (P 0.981)  → [] ("read, nothing at risk"), never absent
 *   fact with no PLoT body       → null ("no body to read")
 *   the graph ratifies nothing   → [] (the ratified set is read off the hash-bound graph)
 *   stale                        → ABSENT, exactly as analysis_result is
 *   binding withholds the block  → ABSENT, exactly as analysis_result is
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => ({
    readRecent,
    readFactsFor,
    readFactsWithTurnFor,
    readScenarioRunAnalysisFactsFor,
    readAnalysisInvalidatedAt,
  }),
}));
const { binding } = vi.hoisted(() => ({ binding: { withhold: false } }));
vi.mock('../../orchestrator-v5/compose/analysis-state-v1.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../orchestrator-v5/compose/analysis-state-v1.js')>();
  return {
    ...actual,
    projectAnalysisBlocksForRunBinding: ((blocks, state) =>
      binding.withhold ? [] : actual.projectAnalysisBlocksForRunBinding(blocks, state)) as typeof actual.projectAnalysisBlocksForRunBinding,
  };
});
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { readLeaderLimitRisksFromResult, readRatifiedConstraints } from '../../orchestrator/context/constraint-feasibility.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

type Json = Record<string, any>;
const SCENARIO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LEADER = 'opt_raise';
const RUN_AT = '2026-09-26T06:00:00.000Z';
const CONSTRAINT = {
  constraint_id: 'gc_u3b', node_id: 'goal', operator: '<=', value: 250000,
  label: 'First-year cost at most £250k', source_quote: 'keep first-year cost under £250k',
};
const GRAPH = {
  nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }],
  edges: [],
  goal_constraints: [CONSTRAINT],
} as unknown as GraphStateIngress;
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const EDITED = { ...GRAPH, nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.9 }] } as unknown as GraphStateIngress;

const u3b = (): Json =>
  JSON.parse(readFileSync('tests/fixtures/cross-service/c50-level-demo/U3b.plot-response.json', 'utf8')) as Json;
const leaderAt = (p: number): Json => {
  const env = structuredClone(u3b());
  (env.option_comparison as Json[]).find((o) => o.option_id === LEADER)!.constraint_probabilities.gc_u3b = p;
  return env;
};

function runFact(enrichment: Json | null) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: RUN_AT, graph_hash_at_run: HASH,
      leading_option_id: LEADER, summary: 'Raise leads on the current model.',
      win_probabilities: { opt_raise: 0.7, opt_hold: 0.3 },
      ...(enrichment === null ? {} : { enrichment }),
    },
  });
}

async function reloadWith(fact: ReturnType<typeof runFact>, graph: GraphStateIngress, id: string) {
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [{ fact, fact_row_id: 'run-row', fact_created_at: RUN_AT }],
    total_count: 1,
  });
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]);
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: id });
}

beforeEach(() => {
  vi.clearAllMocks();
  binding.withhold = false;
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('the reload carries the run\'s own leader-limit risks', () => {
  it('PRECONDITION: the fixture parses with its body, and the capture is certified for the leader', () => {
    const fact = runFact(leaderAt(0.3));
    expect((fact.result as Json).enrichment?.constraint_results?.[0]?.scale_provenance?.decision_grade).toBe(true);
    expect(readRatifiedConstraints(GRAPH).map((c) => c.constraint_id)).toEqual(['gc_u3b']);
  });

  it('⭐ leader P 0.3 on a current run → the risk, identical to the canonical reader on THAT fact and THIS graph', async () => {
    const fact = runFact(leaderAt(0.3));
    const read = await reloadWith(fact, GRAPH, 'llr-at-risk');
    expect(read.analysis_state?.run_state.kind, 'premise: a current run').toBe('complete_current');
    expect(read.analysis_result, 'premise: the block is delivered').not.toBeNull();
    expect(read.analysis_leader_limit_risks).toEqual([
      { constraint_id: 'gc_u3b', label: 'First-year cost at most £250k', source_quote: 'keep first-year cost under £250k', probability: 0.3 },
    ]);
    expect(read.analysis_leader_limit_risks).toEqual(readLeaderLimitRisksFromResult(fact.result, readRatifiedConstraints(GRAPH)));
  });

  it('the capture as served (leader P 0.981) → [] — read, nothing at risk; never absent', async () => {
    const read = await reloadWith(runFact(u3b()), GRAPH, 'llr-safe');
    expect(read.analysis_result).not.toBeNull();
    expect(read.analysis_leader_limit_risks).toEqual([]);
  });

  it('a fact with no PLoT body → null ("no body to read"), never a guessed []', async () => {
    const read = await reloadWith(runFact(null), GRAPH, 'llr-no-body');
    expect(read.analysis_result).not.toBeNull();
    expect(read.analysis_leader_limit_risks).toBeNull();
  });

  it('the ratified set is read off the hash-bound graph: a graph that ratifies nothing → []', async () => {
    const bare = { ...GRAPH, goal_constraints: [] } as unknown as GraphStateIngress;
    const fact = RunAnalysisHandlerFactSchema.parse({
      ...runFact(leaderAt(0.3)),
      result: { ...(runFact(leaderAt(0.3)).result as Json), graph_hash_at_run: computeAnalysisAffectingGraphHash(bare) },
    });
    const read = await reloadWith(fact, bare, 'llr-no-ratified');
    expect(read.analysis_result, 'premise: still a current run').not.toBeNull();
    expect(read.analysis_leader_limit_risks).toEqual([]);
  });

  it('STALE: after an edit the key is ABSENT, exactly as analysis_result is', async () => {
    const read = await reloadWith(runFact(leaderAt(0.3)), EDITED, 'llr-stale');
    expect(read.analysis_state?.run_state.kind, 'premise: the run is stale').toBe('complete_stale');
    expect(read.analysis_result).toBeNull();
    expect('analysis_leader_limit_risks' in read).toBe(false);
  });

  it('a run-binding that withholds analysis_result withholds the risks too', async () => {
    binding.withhold = true;
    const read = await reloadWith(runFact(leaderAt(0.3)), GRAPH, 'llr-bound-withheld');
    expect(read.analysis_state?.run_state.kind, 'premise: the fact is fresh').toBe('complete_current');
    expect(read.analysis_result, 'premise: the binding withheld the block').toBeNull();
    expect('analysis_leader_limit_risks' in read).toBe(false);
  });
});
