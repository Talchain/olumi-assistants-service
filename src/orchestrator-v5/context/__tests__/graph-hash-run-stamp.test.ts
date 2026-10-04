import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { ANALYSIS_PROJECTION_VERSION } from '../graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { deriveAnalysisFreshness } from '../freshness.js';
import { RUN_ANALYSIS_PROJECTION_KEY } from '../analysis-projection-policy.js';
import { toSafeTransportEnrichment } from '../../compose.js';

it.each(['absent', 'empty', 'questions', 'gapped'] as const)(
  'real run_analysis stamps every new Run and preserves provider/transport bytes: %s', async carrier => {
  const scenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const response = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url), 'utf8'));
  const untouchedResponse = structuredClone(response);
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [],
    ...(carrier === 'absent' ? {} : { options: [{ id: 'opt_a', label: 'A', status: 'ready',
      interventions: { fac_price: 1.2 },
      ...(carrier === 'questions' ? { user_questions: ['Could this assumption change?'] }
        : { unresolved_targets: carrier === 'gapped' ? ['unmapped effect'] : [], user_questions: [] }),
    }] }),
  };
  let providerCalls = 0;
  const handler = createRunAnalysisHandler({
    // Local deterministic double only: no network/provider/LLM calls.
    plotClient: { run: async () => { providerCalls++; return response; }, validatePatch: async () => ({}) } as unknown as PLoTClient,
    scenarioReader: async () => ({ graph, rawPersistedGraph: graph, goal_node_id: 'g', options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { fac_price: 0.9 } },
    ] }),
  });
  const invocation = {
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: scenarioId, request_id: 'stamp-local',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 'stamp-turn', scenario_id: scenarioId, message: 'run analysis', stage: 'analyse', turn_class: 'decide' }),
    requestId: 'stamp-local', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
  const outcome = await handler(invocation);
  expect(outcome.llm_calls_used).toBe(0);
  expect(providerCalls).toBe(1);
  const saved = RunAnalysisHandlerFactSchema.parse(JSON.parse(JSON.stringify(outcome.handler_facts[0])));
  expect(saved.result.enrichment?.[RUN_ANALYSIS_PROJECTION_KEY]).toBe(ANALYSIS_PROJECTION_VERSION);
  expect(saved.result.graph_hash_at_run).toBe(computeAnalysisAffectingGraphHash(graph));
  const envelope = { ...saved.result.enrichment };
  delete envelope[RUN_ANALYSIS_PROJECTION_KEY];
  expect(envelope).toEqual(response);
  expect(response).toEqual(untouchedResponse);
  expect(toSafeTransportEnrichment(saved.result.enrichment)).toEqual(toSafeTransportEnrichment(response));
  expect(JSON.stringify(toSafeTransportEnrichment(saved.result.enrichment)))
    .toBe(JSON.stringify(toSafeTransportEnrichment(response)));
  expect(deriveAnalysisFreshness([saved], computeAnalysisAffectingGraphHash(graph), undefined, { currentGraph: graph }).freshness).toBe('fresh');
});
