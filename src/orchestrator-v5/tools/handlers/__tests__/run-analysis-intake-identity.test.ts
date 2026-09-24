import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// Synthetic PLoT response: deterministic transport control, no provider call.
const happyFixture = {
  meta: { seed_used: 42, n_samples: 1000, response_hash: 'identity-control' },
  response_hash: 'identity-control', analysis_status: 'computed',
  option_comparison: [
    { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
    { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
  ],
};
function makePlotClient(response: V2RunResponseEnvelope): PLoTClient {
  return { run: vi.fn(async () => response), validatePatch: vi.fn() } as unknown as PLoTClient;
}
function makeScenarioSnapshot(overrides: Partial<RunAnalysisScenarioSnapshot>): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Revenue' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Keep current pricing', interventions: { f: 0 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Raise prices', interventions: { f: 1 } },
    ],
    goal_node_id: 'g', ...overrides,
  };
}
function makeScenarioReader(snapshot: RunAnalysisScenarioSnapshot) {
  return async () => snapshot;
}
function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID,
      request_id: 'intake-control', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: { turn_id: 't1', scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' } as HandlerInvocation['payload'],
    requestId: 'intake-control', signal: new AbortController().signal, orientationText: '',
  };
}

// Synthetic transport controls for the reported pricing paraphrase. Only the
// positive cases add saved source quotes; the real capture carried none.
describe('run_analysis handler — source-bound intake identity', () => {
  const briefText = 'The options are keeping pricing as it is or raising prices.';
  const boundNodes = [
    { id: 'opt_a', kind: 'option', label: 'Keep current pricing', source_quote: 'keeping pricing as it is' },
    { id: 'opt_b', kind: 'option', label: 'Raise prices', source_quote: 'raising prices' },
  ];
  const churn = [{
    constraint_id: 'churn_max', node_id: 'churn', operator: '<=',
    value: 0.05, label: 'Customer churn', unit: 'fraction', provenance: 'explicit',
  }];

  async function run(rawPersistedGraph: Record<string, unknown>, brief = briefText) {
    const plotClient = makePlotClient(happyFixture as unknown as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(makeScenarioSnapshot({ briefText: brief, rawPersistedGraph })),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(fact.result.summary).toBe(outcome.assistant_text);
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text!)).toBe(true);
    expect(outcome.llm_calls_used).toBe(0);
    expect(plotClient.run).toHaveBeenCalledTimes(1);
    return { outcome, result: fact.result };
  }

  it('withholds and discloses unverified identity on the actual handler egress', async () => {
    const { outcome, result } = await run({ nodes: boundNodes.map(({ source_quote: _quote, ...node }) => node) });
    expect(result.constraint_verdict?.may_name_leading_option).toBe(false);
    expect(outcome.assistant_text).toContain('does not establish which options correspond');
    expect(outcome.assistant_text).not.toMatch(/candidate is missing|not in the model|Add it|scored highest/);
  });

  it('recovers explicit quotes dropped from snapshot.options by the same canonical IDs', async () => {
    const { outcome, result } = await run({ nodes: boundNodes });
    expect(result.constraint_verdict?.may_name_leading_option).toBe(true);
    expect(outcome.assistant_text).toContain('Option A scored highest');
    expect(outcome.assistant_text).not.toContain('does not establish');
  });

  it('still declares a proven omission after complete analysed-set binding', async () => {
    const { outcome, result } = await run({ nodes: boundNodes },
      'The options are keeping pricing as it is, raising prices, or introducing a premium tier.');
    expect(result.constraint_verdict?.may_name_leading_option).toBe(false);
    expect(outcome.assistant_text).toContain('“introducing a premium tier”');
    expect(outcome.assistant_text).toContain('candidate is missing');
  });

  it.each([false, true])('preserves the real unevaluated churn constraint with bound=%s', async (bound) => {
    const nodes = bound ? boundNodes : boundNodes.map(({ source_quote: _quote, ...node }) => node);
    const { outcome, result } = await run({ nodes, goal_constraints: churn });
    expect(result.constraint_verdict).toEqual({
      may_name_leading_option: false, constraint_verdict_state: 'unevaluated',
    });
    expect(outcome.assistant_text).toContain('Customer churn');
    expect(outcome.assistant_text).toContain('could not be checked');
    expect(outcome.assistant_text).not.toContain('scored highest');
    if (!bound) expect(outcome.assistant_text).toContain('does not establish which options correspond');
  });
});
