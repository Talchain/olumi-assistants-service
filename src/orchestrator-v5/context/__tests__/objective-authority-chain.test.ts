import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { createPLoTClient } from '../../../orchestrator/plot-client.js';
import { compactAnalysis } from '../../../orchestrator/context/analysis-compact.js';
import { readObjectiveRecommendation } from '../../../orchestrator/context/objective-recommendation.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { buildAnalysisFromPriorFacts } from '../analysis-fallback.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import type { CoachingStatePack } from '../canonical-analysis-state.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { buildAnalysisResultHeadline } from '../../coaching/analysis-result-headline.js';
import { enrichRunAnalysisWithDecisionReview, selectWinner } from '../../coaching/decision-review-enricher.js';
import * as review from '../../../cee/decision-review/invoke.js';
import { projectRunFact } from '../../coaching/compare-runs.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { _resetConfigCache } from '../../../config/index.js';
import { objectiveRankingFixture, withheldObjectiveRankingFixture } from '../../../../tests/fixtures/plot/objective-ranking.js';

const scenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payload = makeMessagePayload({ scenario_id: scenarioId, message: 'Explain this comparison', stage: 'analyse' });
const graph = {
  nodes: [{ id: 'g', kind: 'goal', label: 'Value', goal_direction: 'maximise' }], edges: [],
  goal_constraints: [{ constraint_id: 'budget', node_id: 'cost', operator: '<=', value: 2500,
    label: 'Budget', unit: 'GBP', provenance: 'explicit' }],
};
const fresh: CoachingStatePack = { analysis_present: true, freshness: 'fresh', readiness_status: null,
  rerun_required: false, usable_for_prose: true, usable_for_chips: true, blocked: false, actionable_blocker_count: 0 };

async function adapterToStoredFact(response: Record<string, unknown>) {
  vi.stubEnv('PLOT_BASE_URL', 'http://objective-fixture.test');
  _resetConfigCache();
  const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchSpy);
  const client = createPLoTClient();
  expect(client).not.toBeNull();
  const handler = createRunAnalysisHandler({ plotClient: client!, scenarioReader: async () => ({
    graph, rawPersistedGraph: graph, goal_node_id: 'g',
    options: ['expensive', 'affordable'].map((id) => ({ id, option_id: id, label: id, interventions: { factor: 1 } })),
  }) });
  const outcome = await handler({ payload, requestId: 'objective-fixture', orientationText: '',
    signal: new AbortController().signal,
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: scenarioId, request_id: 'objective-fixture',
      budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null },
  } as unknown as HandlerInvocation);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const stored = RunAnalysisHandlerFactSchema.parse(JSON.parse(JSON.stringify(outcome.handler_facts[0])));
  expect(stored.result.enrichment).toEqual(response);
  return { stored, outcome };
}

function coldPack(fact: HandlerFact, coachingContext = fresh) {
  const summary = buildAnalysisFromPriorFacts([fact], [
    { id: 'expensive', label: 'Expensive' }, { id: 'affordable', label: 'Affordable' },
  ]);
  const pack = assembleContextPack({ payload, priorTurns: [], priorFacts: [fact], analysis: summary,
    coachingContext, modelFacingClaimSafety: { status: 'permitted' } });
  return { summary, pack, prompt: buildUserMessage(pack, payload.message) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); _resetConfigCache(); });

describe('objective authority through the actual CEE HTTP adapter and cold prompt path', () => {
  it('keeps the permitted affordable ID and its .2 share, never raw argmax or a raw gap', async () => {
    const wire = objectiveRankingFixture();
    const { stored } = await adapterToStoredFact(wire);
    expect(stored.result.leading_option_id).toBe('affordable');
    expect(stored.result.win_probabilities).toEqual({ expensive: 0.8, affordable: 0.2 });
    expect(stored.result.constraint_verdict?.may_name_leading_option).toBe(true);
    const { summary, pack, prompt } = coldPack(stored);
    expect(summary?.objective_ranking).toEqual(wire.objective_ranking);
    expect(summary?.winner).toMatchObject({ option_id: 'affordable', win_probability: 0.2 });
    expect(summary?.margin).toBeNull();
    expect(projectRunFact(stored)?.leader_option_id).toBe('affordable');
    expect(pack.analysis?.leading_option).toMatchObject({ label: 'Affordable', probability: 0.2 });
    expect(pack.analysis?.runner_up).toBeNull();
    expect(pack.analysis?.margin_pp).toBeNull();
    expect(pack.display_analysis?.leading_option?.label).toBe('Affordable');
    expect(prompt).toContain('Affordable');
    expect(prompt).not.toMatch(/60 percentage points|"runner_up"|"margin"/);
  });

  it.each(['withheld', 'absent', 'withheld_with_legacy_shares'] as const)('%s never permits a current leader', async (kind) => {
    const wire: Record<string, unknown> = kind === 'withheld' ? withheldObjectiveRankingFixture() : objectiveRankingFixture();
    if (kind === 'absent') delete wire.objective_ranking;
    if (kind === 'withheld_with_legacy_shares') wire.objective_ranking = withheldObjectiveRankingFixture().objective_ranking;
    const { stored, outcome } = await adapterToStoredFact(wire);
    expect(stored.result.leading_option_id).toBeNull();
    expect(stored.result.constraint_verdict?.may_name_leading_option).toBe(false);
    const { summary, pack, prompt } = coldPack(stored);
    expect(summary?.winner.option_id ?? '').toBe('');
    expect(pack.analysis?.leading_option ?? null).toBeNull();
    expect(pack.display_analysis?.leading_option).toBeUndefined();
    expect(pack.display_analysis?.options).toBeUndefined();
    expect(projectRunFact(stored)?.leader_option_id ?? null).toBeNull();
    expect(prompt).not.toMatch(/"leading_option"|"runner_up"|"margin"/);
    expect(outcome.assistant_text).not.toMatch(/came out ahead|currently leads/);
    expect(buildAnalysisResultHeadline({ enrichment: wire, leading_option_id: 'affordable', status_kind: 'ok' })).toBeNull();
  });

  it('keeps a historical ID as stored data but never converts it into a recommendation', () => {
    const historical = { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
      scenario_id: scenarioId, leading_option_id: 'expensive', win_probabilities: { expensive: 0.8, affordable: 0.2 }, summary: 'Earlier run',
    } } as HandlerFact;
    const { summary, prompt } = coldPack(historical);
    expect(summary?.options).toHaveLength(2);
    expect(summary?.winner.option_id).toBe('');
    expect(historical.result.leading_option_id).toBe('expensive');
    expect(prompt).not.toContain('"leading_option"');
  });

  it('withholds current recommendation on stale or missing freshness despite valid objective truth', async () => {
    const { stored } = await adapterToStoredFact(objectiveRankingFixture());
    expect(coldPack(stored, { ...fresh, freshness: 'stale' }).prompt).not.toContain('"leading_option"');
    const summary = buildAnalysisFromPriorFacts([stored]);
    const pack = assembleContextPack({ payload, priorTurns: [], analysis: summary, modelFacingClaimSafety: { status: 'permitted' } });
    expect(buildUserMessage(pack, payload.message)).not.toContain('"leading_option"');
  });

  it('uses the producer ID for Decision Review and supplies no invented runner-up or margin', async () => {
    const { stored } = await adapterToStoredFact(objectiveRankingFixture());
    const invoke = vi.spyOn(review, 'invokeDecisionReview').mockRejectedValue(new Error('capture only'));
    await enrichRunAnalysisWithDecisionReview({ handlerFacts: [stored], requestId: 'capture', scenarioId,
      signal: new AbortController().signal, brief: 'Compare the alternatives within the budget.' });
    expect(invoke).toHaveBeenCalledTimes(1);
    const input = invoke.mock.calls[0][0];
    expect(input.winner).toMatchObject({ id: 'affordable', win_probability: 0.2 });
    expect(input.runner_up).toBeNull();
    expect(input._meta?.margin).toBeNull();
  });
});

describe('structural authority rejection', () => {
  it.each(['duplicate_row', 'duplicate_rank', 'missing_row', 'label_only', 'share_mismatch', 'missing_id', 'tie_without_recommendation'])('%s cannot license a recommendation', (kind) => {
    const wire = objectiveRankingFixture();
    if (kind === 'duplicate_row') wire.option_comparison.push({ ...wire.option_comparison[1] });
    if (kind === 'duplicate_rank') wire.objective_ranking.ranked_options[1].option_id = 'expensive';
    if (kind === 'missing_row') wire.option_comparison.pop();
    if (kind === 'label_only') wire.robustness.recommended_option_id = 'Affordable';
    if (kind === 'share_mismatch') wire.option_comparison[1].win_probability = 0.3;
    if (kind === 'missing_id') wire.option_comparison[1].option_id = '';
    if (kind === 'tie_without_recommendation') {
      wire.objective_ranking.ranked_options = [
        { option_id: 'affordable', rank: 1, win_probability: 0.5 }, { option_id: 'expensive', rank: 1, win_probability: 0.5 },
      ];
      wire.option_comparison.forEach((row) => { row.win_probability = 0.5; });
      wire.robustness.recommended_option_id = '';
    }
    expect(readObjectiveRecommendation(wire)).toBeNull();
    expect(compactAnalysis(wire as V2RunResponseEnvelope)?.winner.option_id).toBe('');
    expect(buildAnalysisResultHeadline({ enrichment: wire, leading_option_id: 'affordable', status_kind: 'ok' })).toBeNull();
  });

  it('null and duplicate selection never falls back to argmax', () => {
    const rows = objectiveRankingFixture().option_comparison;
    expect(selectWinner(rows, null)).toBeNull();
    expect(selectWinner([...rows, rows[1]], 'affordable')).toBeNull();
    expect(selectWinner(rows, 'Affordable')).toBeNull();
  });
});
