import { readFileSync } from 'node:fs';
import { expect, vi } from 'vitest';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';

type R = Record<string, any>;
const idsOf = (g: R): string[] => g.nodes.filter((n: R) => n.kind === 'option').map((n: R) => n.id);
function carrier(g: R): R {
  const ids = idsOf(g);
  const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8'));
  happy.option_comparison = ids.map((id, i) => ({ option_id: id, option_label: g.nodes.find((n: R) => n.id === id).label, win_probability: i === 0 ? 0.8 : 0.1, probability_of_goal: 0.6, status: 'computed', outcome: { mean: 0.8 - i * 0.2, std: 0.05, p10: 0.5, p50: 0.6, p90: 0.9, n_samples: 10000, n_valid_samples: 10000, validity_ratio: 1, percentiles_source: 'samples' } }));
  happy.results = structuredClone(happy.option_comparison);
  happy.option_comparison_status = 'computed';
  happy.identity_evaluations = []; happy.inference_warnings = []; happy.fact_objects = []; happy.review_cards = [];
  happy.decision_brief = { options: structuredClone(happy.option_comparison), analysis_summary: { leading_option: ids[0], win_probability: 0.8 } };
  return happy;
}
export async function runP0Outcome(g: R, brief: string, body?: R) {
  const scenario = '714abc5c-4e82-4436-9454-eec6c8f68589';
  const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(g), briefText: brief })), loadGraph: vi.fn(async () => structuredClone(g)) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(scenario, 'r4-load', store as never);
  const plotRun = vi.fn(async () => structuredClone(body ?? carrier(g)));
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as never, scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: scenario, request_id: 'r4', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null }, payload: makeMessagePayload({ turn_id: 'r4', scenario_id: scenario, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never), requestId: 'r4', signal: new AbortController().signal, orientationText: '' } as never);
  expect(plotRun).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis')!;
  expect(fact).toBeDefined();
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return outcome;
}
export async function runP0Graph(g: R, brief: string, body?: R): Promise<R> {
  const outcome = await runP0Outcome(g, brief, body);
  return outcome.handler_facts.find(f => f.fact_type === 'run_analysis')!.result as R;
}
