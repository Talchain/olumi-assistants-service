/**
 * THE RELOAD CARRIES THE RUN'S OWN CONSTRAINT VERDICT STATE (R&C #70 5842182272;
 * contract #70 5842397050).
 *
 * The limit card must stay on `evaluated_infeasible` and stop on
 * `evaluated_feasible`. The Agent learns the analysis only through the graph
 * read, which shipped `analysis_state` + `analysis_result` — and neither carries
 * the fact's `constraint_verdict_state`, so the card could only guess it from
 * `withheld_reason` (parallel logic). `AnalysisStateV1` is `.strict()`, so the
 * carrier is an additive top-level key bound to the SAME fact as
 * `analysis_result`, under the SAME freshness gate.
 *
 *   evaluated_infeasible fresh → carried, identical to the canonical reader on THAT fact
 *   evaluated_feasible fresh   → carried
 *   interim enrichment stamp   → carried (the reader's own fallback ladder)
 *   no verdict recorded        → null ("not recorded", never a guess)
 *   stale (graph changed)      → ABSENT, exactly as `analysis_result` is
 */
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
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { readBackState } from '../agent-v1-turn.js';
import { CEE_CLAIM_SAFETY_ENRICHMENT_KEY, readConstraintVerdictStateFromResult } from '../../orchestrator/context/constraint-feasibility.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

const SCENARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GRAPH: GraphStateIngress = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const EDITED: GraphStateIngress = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.9 }], edges: [] };
const RUN_AT = '2026-09-26T02:00:00.000Z';

type Verdict = { kind: 'typed'; state: string } | { kind: 'stamp'; state: string } | { kind: 'none' };

function runFact(verdict: Verdict) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: RUN_AT, graph_hash_at_run: HASH,
      leading_option_id: 'option-a', summary: 'Option A leads on the current model.',
      win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
      ...(verdict.kind === 'typed'
        ? { constraint_verdict: { may_name_leading_option: verdict.state === 'evaluated_feasible', constraint_verdict_state: verdict.state } }
        : {}),
      enrichment: {
        analysis_status: 'completed',
        robustness: { level: 'strong', near_tie: { is_tie: false } },
        ...(verdict.kind === 'stamp'
          ? { [CEE_CLAIM_SAFETY_ENRICHMENT_KEY]: { may_name_leading_option: verdict.state === 'evaluated_feasible', constraint_verdict_state: verdict.state } }
          : {}),
      },
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
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('the reload carries the run\'s own constraint verdict state', () => {
  it('⭐ evaluated_infeasible on a current run is carried — identical to the canonical reader on THAT fact', async () => {
    const fact = runFact({ kind: 'typed', state: 'evaluated_infeasible' });
    const read = await reloadWith(fact, GRAPH, 'cvs-infeasible');
    expect(read.analysis_state?.run_state.kind, 'premise: a current run').toBe('complete_current');
    expect(read.analysis_result, 'premise: the block is delivered').not.toBeNull();
    expect(read.analysis_constraint_verdict_state).toBe('evaluated_infeasible');
    expect(read.analysis_constraint_verdict_state).toBe(readConstraintVerdictStateFromResult(fact.result));
  });

  it('evaluated_feasible on a current run is carried (the card stops)', async () => {
    const read = await reloadWith(runFact({ kind: 'typed', state: 'evaluated_feasible' }), GRAPH, 'cvs-feasible');
    expect(read.analysis_constraint_verdict_state).toBe('evaluated_feasible');
  });

  it('an interim enrichment stamp is read by the SAME reader ladder', async () => {
    const fact = runFact({ kind: 'stamp', state: 'evaluated_infeasible' });
    const read = await reloadWith(fact, GRAPH, 'cvs-stamp');
    expect(readConstraintVerdictStateFromResult(fact.result), 'premise: the stamp is readable').toBe('evaluated_infeasible');
    expect(read.analysis_constraint_verdict_state).toBe('evaluated_infeasible');
  });

  it('a run with no recorded verdict carries null — "not recorded", never a guessed state', async () => {
    const read = await reloadWith(runFact({ kind: 'none' }), GRAPH, 'cvs-none');
    expect(read.analysis_result).not.toBeNull();
    expect(read.analysis_constraint_verdict_state).toBeNull();
  });

  it('STALE: after an edit the key is ABSENT, exactly as analysis_result is — a verdict about a different graph is not carried', async () => {
    const read = await reloadWith(runFact({ kind: 'typed', state: 'evaluated_infeasible' }), EDITED, 'cvs-stale');
    expect(read.analysis_state?.run_state.kind, 'premise: the run is stale').toBe('complete_stale');
    expect(read.analysis_result).toBeNull();
    expect('analysis_constraint_verdict_state' in read).toBe(false);
  });
});

describe('the Agent lane\'s read-back carries it to the turn', () => {
  const dispatchWith = (json: Record<string, unknown>) =>
    vi.fn(async () => ({ status: 200, json: { graph: GRAPH, graph_hash: HASH, ...json } }));

  it('⭐ a carried state reaches readBackState as constraintVerdictState', async () => {
    const state = await readBackState(dispatchWith({ analysis_constraint_verdict_state: 'evaluated_infeasible' }) as never, SCENARIO);
    expect(state.constraintVerdictState).toBe('evaluated_infeasible');
  });

  it('null stays null; an absent key carries nothing; a junk value is not carried', async () => {
    expect((await readBackState(dispatchWith({ analysis_constraint_verdict_state: null }) as never, SCENARIO)).constraintVerdictState).toBeNull();
    expect((await readBackState(dispatchWith({}) as never, SCENARIO)).constraintVerdictState).toBeUndefined();
    expect((await readBackState(dispatchWith({ analysis_constraint_verdict_state: 42 }) as never, SCENARIO)).constraintVerdictState).toBeUndefined();
  });
});
