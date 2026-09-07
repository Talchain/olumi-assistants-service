import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisStateV1Schema, OlumiResponseSchema } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({ readRecent, readFactsFor, readAnalysisInvalidatedAt }),
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { WITHHELD_RUN_IDENTITY_CONFLICT, WITHHELD_RUN_IDENTITY_UNCONFIRMED } from '../../orchestrator-v5/compose/analysis-state-v1.js';
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRAPH: GraphStateIngress = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
const CHANGED_GRAPH = { ...GRAPH, nodes: [{ ...GRAPH.nodes[0], goal_threshold: 0.8 }] } as GraphStateIngress;
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const FIRST = '2026-09-06T17:50:03.871Z';
const NEXT = '2026-09-06T17:50:11.035Z';

function fact(computed_at: string | undefined = FIRST, scenario_id = SCENARIO) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id, computed_at, graph_hash_at_run: HASH,
      leading_option_id: 'option-a', summary: 'Option A leads on the current model.',
      win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: { analysis_status: 'completed', robustness: { level: 'strong', near_tie: { is_tie: false } } },
    },
  });
}

async function read(graph: unknown = GRAPH) {
  const result = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'c2-restore-fixture' });
  expect(result.analysis_state).not.toBeNull();
  expect(AnalysisStateV1Schema.safeParse(result.analysis_state).success).toBe(true);
  if (result.analysis_result !== null) {
    expect(OlumiResponseSchema.safeParse({
      response_version: 2, assistant_text: '', stage_indicator: 'analyse',
      blocks: [result.analysis_result], suggested_actions: [], insights: [],
      analysis_state: result.analysis_state,
    }).success).toBe(true);
  }
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  readRecent.mockResolvedValue([{ id: 'turn-row' }]);
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('C2 binding through the actual persisted scenario read', () => {
  it('reloads an existing run with its original hash/time and same state on repeated reads', async () => {
    const saved = fact();
    readFactsFor.mockResolvedValue([saved]);
    const first = await read();
    expect(first.analysis_state?.run_state).toEqual({ kind: 'complete_current', computed_at: FIRST });
    expect(first.analysis_result).toMatchObject({ computed_against_hash: HASH, win_probabilities: { 'option-a': 0.65 } });
    expect(await read()).toEqual(first);
    expect(saved.result.computed_at).toBe(FIRST);
  });

  it('selects the new fact after a same-graph rerun', async () => {
    readFactsFor.mockResolvedValue([fact(FIRST), fact(NEXT)]);
    expect((await read()).analysis_state?.run_state).toEqual({ kind: 'complete_current', computed_at: NEXT });
  });

  it('keeps historical identity when a changed current model makes that run stale', async () => {
    const saved = fact();
    const original = JSON.stringify(saved);
    readFactsFor.mockResolvedValue([saved]);
    const changed = await read(CHANGED_GRAPH);
    expect(changed.analysis_state?.run_state).toEqual({ kind: 'complete_stale', computed_at: FIRST, cause: 'graph_changed' });
    expect(changed.analysis_state?.contradictions).toEqual([]);
    expect(changed.analysis_result).toBeNull();
    expect(JSON.stringify(saved)).toBe(original);
  });

  it('does not turn restore-to-the-old-graph into a new run', async () => {
    readFactsFor.mockResolvedValue([fact()]);
    readAnalysisInvalidatedAt.mockResolvedValue('2026-09-06T17:50:05.000Z');
    const restored = await read();
    expect(restored.analysis_state?.run_state).toEqual({ kind: 'complete_stale', computed_at: FIRST, cause: 'graph_changed' });
    expect(restored.analysis_result).toBeNull();
    readFactsFor.mockResolvedValue([fact(NEXT), fact()]);
    expect((await read()).analysis_state?.run_state).toEqual({ kind: 'complete_current', computed_at: NEXT });
  });

  it('does not adopt another scenario even with identical graph and timestamp', async () => {
    readFactsFor.mockResolvedValue([fact(FIRST, OTHER_SCENARIO)]);
    const result = await read();
    expect(result.analysis_state?.run_state.kind).toBe('unknown_degraded');
    expect(result.analysis_state?.leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_RUN_IDENTITY_CONFLICT });
    expect(result.analysis_result).toBeNull();
  });

  it('keeps available legacy figures when timestamp identity is unsupported', async () => {
    const legacy = fact('2026-09-06T17:50:03Z');
    readFactsFor.mockResolvedValue([legacy]);
    const result = await read();
    expect(result.analysis_state?.run_state.kind).toBe('unknown_degraded');
    expect(result.analysis_state?.leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_RUN_IDENTITY_UNCONFIRMED });
    expect(result.analysis_result).toMatchObject({ leading_option_id: null, win_probabilities: { 'option-a': 0.65 } });
    expect(legacy.result.leading_option_id).toBe('option-a');
  });

  it('keeps unreadable history distinct from a successful empty read', async () => {
    readFactsFor.mockRejectedValueOnce(new Error('fixture read failure'));
    expect((await read()).analysis_state?.run_state.kind).toBe('unknown_degraded');
    readFactsFor.mockResolvedValue([]);
    expect((await read()).analysis_state?.run_state.kind).toBe('never_run');
  });
});
