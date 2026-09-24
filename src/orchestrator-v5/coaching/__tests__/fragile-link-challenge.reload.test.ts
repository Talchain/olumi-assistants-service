/**
 * (viii) A RELOAD CARRIES NO FRAGILE-LINK CARD.
 *
 * The card is a run-turn artefact: it exists only when a run completed in THIS
 * turn. The canonical read leg (`routes/scenario-graph-analysis-read.ts`) that
 * serves a reload returns the analysis and its state, and nothing else — so a
 * reload must not resurrect the card. Mocked store exactly like Track B's
 * producer-parity test.
 */
import { expect, test, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

const readFactsFor = vi.fn();
vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({ readRecent: async () => [{ id: 'row' }], readFactsFor, readAnalysisInvalidatedAt: async () => null }),
}));

import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { runTurnCoaching } from '../../agent-lane/analysis-coaching-pass-through.js';
import { loadRunTurnFixture } from './fragile-link-challenge-fixtures.js';

function blockTypesIn(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) blockTypesIn(v, into);
  } else if (value !== null && typeof value === 'object') {
    const type = (value as Record<string, unknown>).type;
    if (typeof type === 'string') into.push(type);
    for (const v of Object.values(value)) blockTypesIn(v, into);
  }
  return into;
}

test('(viii) reload: readScenarioAnalysis returns no coaching block, and a reload has no run this turn', async () => {
  const fixture = loadRunTurnFixture('B');
  const turn = fixture.turns.t2!;
  const scenarioId = fixture.scenario_id;
  const graph = { nodes: [{ id: 'goal', kind: 'goal', label: 'Goal', goal_threshold: 0.7 }], edges: [] };
  const hash = computeAnalysisAffectingGraphHash(graph as never)!;
  const computedAt = turn.analysis_state.run_state.computed_at;
  const fact = RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: scenarioId,
      computed_at: computedAt,
      graph_hash_at_run: hash,
      leading_option_id: 'option-a',
      summary: 'The model contains unresolved assumptions.',
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      // The served run's own robustness — a groundable fragile edge is present.
      enrichment: { analysis_status: 'completed', robustness: turn.analysis_result.enrichment.robustness },
    },
  });
  readFactsFor.mockResolvedValue([fact]);

  const read = await readScenarioAnalysis({ scenarioId, graph, requestId: 'fragile-link-reload' });

  // Contrast control: the read DOES carry the analysis, with the fragile edges.
  expect(read.analysis_result?.type).toBe('analysis_result');
  const readResult = read.analysis_result as unknown as { enrichment: { robustness: { fragile_edges: unknown[] } } };
  expect(readResult.enrichment.robustness.fragile_edges.length).toBe(turn.analysis_result.enrichment.robustness.fragile_edges.length);
  expect(blockTypesIn(read)).toContain('analysis_result');
  // Target: nothing in the read is a coaching block.
  expect(blockTypesIn(read)).not.toContain('coaching');

  const final = { scenarioId, graphHash: hash, analysisState: read.analysis_state, analysisResult: read.analysis_result };
  expect(runTurnCoaching(undefined, final)).toEqual({ blocks: [], eligibility: { eligible: false, reason: 'no_run_this_turn' } });

  // Contrast: the same readback beside a run captured THIS turn does yield the card.
  const withRun = runTurnCoaching(
    { scenario_id: scenarioId, status: 200, analysis_state: read.analysis_state, blocks: [read.analysis_result], trigger: 'explicit_run' },
    final,
  );
  expect(withRun.eligibility).toEqual({ eligible: true });
  expect(withRun.blocks).toHaveLength(1);
  expect(withRun.blocks[0]!.signal_id.startsWith('coach:fragile_link:')).toBe(true);
});
