import { describe, expect, it, vi } from 'vitest';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { buildAnalysisResultHeadlineParts } from '../../../coaching/analysis-result-headline.js';
import { boundRunLeaderClaim } from '../../../model-management/version-result-binding.js';

const scenario = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const invocation = { context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
  messages: [{ role: 'user', content: 'run analysis' }], session_id: scenario, request_id: 'headline-licence',
  budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
  payload: { turn_id: 'fresh', scenario_id: scenario, message: 'run analysis', turn_class: 'decide', stage: 'analyse' },
  requestId: 'headline-licence', signal: new AbortController().signal, orientationText: '' } as unknown as HandlerInvocation;
const link = (from: string, to: string) => ({ from, to, strength: { mean: 1, std: 0.1 }, exists_probability: 1,
  effect_direction: 'positive', provenance: { source: 'user_specified' } });
const graphFor = (label: string) => ({ goal_node_id: 'g', nodes: [
  { id: 'd', kind: 'decision', label: 'Explore' },
  { id: 'g', kind: 'goal', label, goal_threshold: 0.7 },
  { id: 'f', kind: 'factor', label: 'Effort', observed_state: { value: 0, raw_value: 0, source: 'user', extractionType: 'explicit' } },
  { id: 'a', kind: 'option', label: 'Plan A', interventions: { f: 1 } },
  { id: 'b', kind: 'option', label: 'Plan B', interventions: { f: 0 } },
], edges: [link('d', 'a'), link('d', 'b'), link('a', 'f'), link('b', 'f'), link('f', 'g')] });

describe('fresh Run headline consumes its own canonical licence', () => {
  it.each(['Revenue', 'Delivery capacity'].flatMap(label => [true, false].flatMap(separated =>
    [false, true].map(directional => ({ label, separated, directional })))))(
    '$label / licensed=$separated / directional=$directional: exact summary bytes and no borrowed permission', async ({ label, separated, directional }) => {
      const graph = graphFor(label);
      if (directional) {
        graph.nodes.find(n => n.id === 'g')!.label = `Increase ${label}`;
        graph.nodes.find(n => n.id === 'f')!.label = label;
        graph.nodes.find(n => n.id === 'a')!.interventions = { f: 0 };
        graph.nodes.find(n => n.id === 'b')!.interventions = { f: 1 };
      }
      const response = { analysis_status: 'completed', response_hash: 'own', meta: { seed_used: 42, n_samples: 1000, response_hash: 'own' },
        option_comparison: [{ option_id: 'a', option_label: 'Plan A', win_probability: 0.65 },
          { option_id: 'b', option_label: 'Plan B', win_probability: 0.35 }],
        ...(separated ? { robustness: { level: 'strong', near_tie: { is_tie: false } } } : {}) };
      const snapshot = { graph, rawPersistedGraph: graph, goal_node_id: 'g', options: graph.nodes.filter(n => n.kind === 'option') } as RunAnalysisScenarioSnapshot;
      const outcome = await createRunAnalysisHandler({ scenarioReader: async () => snapshot,
        plotClient: { run: vi.fn(async () => response) } as unknown as PLoTClient })(invocation);
      const fact = outcome.handler_facts[0];
      expect(fact.fact_type).toBe('run_analysis');
      if (fact.fact_type !== 'run_analysis') throw new Error('missing Run');
      const licence = boundRunLeaderClaim({ fact, identity: { scenario_id: scenario, run_id: fact.result.run_id!,
        graph_hash_at_run: fact.result.graph_hash_at_run!, computed_at: fact.result.computed_at! } }, { graph, scenario_id: scenario }).licence;
      expect(licence).toBe(separated ? 'permitted' : 'withheld');
      const expected = 'Ran analysis on your current scenario.' + (separated && directional
        ? ` “Plan A” was supported by the most runs without moving “${label}” the way your goal asks. Among the options that do, “Plan B” was supported by 35% of runs.` : '');
      expect(fact.result.summary).toBe(expected);
      expect(outcome.assistant_text).toBe(fact.result.summary);
      // Another Run's clean leader / unrelated £2m sentence cannot supply this Run's missing licence.
      const input = { enrichment: { ...response, decision_brief: { headline: 'Other plan leads at £2m.' } }, leading_option_id: 'a', status_kind: 'ok' as const };
      const licensed = buildAnalysisResultHeadlineParts(input);
      expect(buildAnalysisResultHeadlineParts(input, 'permitted')).toEqual(licensed);
      expect(buildAnalysisResultHeadlineParts(input, 'permitted_with_caveat')).toEqual(licensed);
      if (!separated) {
        const withheld = buildAnalysisResultHeadlineParts(input, 'withheld');
        expect(withheld.text).toBeNull();

      }
  });
});
