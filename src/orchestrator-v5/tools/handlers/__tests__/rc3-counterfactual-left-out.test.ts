/**
 * FIX-r1 item 3, RED first at 8fb1959: the actual what_would_flip card, not just the projection helper.
 * A no-value precondition currently makes buildCounterfactualModel return null; a valued one enters the ISL wire.
 * Both must use the same compute copy as Run. Author runs these rows and the full-graph counterfactual mutant.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CounterfactualClient, CounterfactualResult } from '../../../../adapters/isl/counterfactual-client.js';
import type { HandlerInvocation } from '../../registry.js';
import { createWhatWouldFlipHandler } from '../what-would-flip.js';

type Json = Record<string, any>;
const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RISK = 'risk_release_slips';
const ANSWER = 'For the runner-up to overtake the leader, the strongest driver would need to move materially given the current margin.';
const graph = (): Json => ({
  nodes: [
    { id: 'goal_fit', kind: 'goal', label: 'Goal fit', observed_state: { value: 0 } },
    { id: 'opt_1', kind: 'option', label: 'Option A' },
    { id: 'opt_2', kind: 'option', label: 'Option B' },
    { id: 'factor_capacity', kind: 'factor', label: 'Engineering capacity', observed_state: { value: 10, cap: 20, unit: 'engineers' } },
    { id: 'factor_cost', kind: 'factor', label: 'Hiring cost', observed_state: { value: 5 } },
  ],
  edges: [
    { from: 'factor_capacity', to: 'goal_fit', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'factor_cost', to: 'goal_fit', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
  ],
});
const success: CounterfactualResult = {
  ok: true,
  response: {
    scenario: { intervention: { factor_capacity: 20 }, outcome: 'goal_fit' },
    prediction: { point_estimate: 12, confidence_interval: { lower: 12, upper: 12 }, sensitivity_range: { optimistic: 14, pessimistic: 10, explanation: 'x' } },
    uncertainty: { overall: 'low', sources: [] }, robustness: { score: 'robust', critical_assumptions: [] },
    explanation: { summary: 's', reasoning: 'r', technical_basis: 't', assumptions: [] },
  } as never,
};
function invocation(g: Json): HandlerInvocation {
  return {
    context: {
      stage: 'decide', entity_registry: { option_ids: [], goal_id: 'goal_fit' }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'rc3-counterfactual', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [{ fact_type: 'run_analysis', fact_version: 1, noop: false,
        result: { scenario_id: SCENARIO, leading_option_id: 'opt_1', summary: 'done', enrichment: {} } }],
      scenarioBriefText: null, persistedGraph: null,
    },
    payload: { turn_id: 'rc3-counterfactual-turn', scenario_id: SCENARIO, message: 'what would change the outcome?', turn_class: 'decide', stage: 'decide' },
    requestId: 'rc3-counterfactual', signal: new AbortController().signal, orientationText: '',
    analysisReady: { options: [], goal_node_id: 'goal_fit', status: 'ready' },
    explanation: { answer_text: ANSWER, answer_text_valid: true },
    analysisProjection: { status: 'complete', leading_option: { label: 'Option A', probability: 0.6 }, runner_up: { label: 'Option B', probability: 0.3 },
      margin_pp: 30, robustness_band: 'fragile', top_drivers: [{ factor_label: 'Engineering capacity', sensitivity_value: 0.6 }], staleness_reason: null },
    analysisFreshness: { freshness: 'fresh', reason: 'graph_hash_match' }, graphForTurn: g,
    flipSummary: { overall_status: 'concrete', margin_supports_flip: true,
      entries: [{ factor_id: 'factor_capacity', factor_label: 'Engineering capacity', flip_value: 18 }] },
    rawRobustness: { level: 'fragile', near_tie_is_tie: false },
  } as unknown as HandlerInvocation;
}
async function whatWouldFlip(g: Json) {
  const before = JSON.stringify(g);
  const getCounterfactual = vi.fn<CounterfactualClient['getCounterfactual']>(async () => structuredClone(success));
  const outcome = await createWhatWouldFlipHandler({ counterfactualClient: { getCounterfactual } })(invocation(g));
  expect(JSON.stringify(g), 'counterfactual projection never mutates the canvas').toBe(before);
  return { outcome, getCounterfactual };
}

describe('RC3 FIX-r1 counterfactual compute exclusion', () => {
  it.each([undefined, 0.3])('rc3-counterfactual-left-out: risk value %s neither suppresses nor alters the actual card or ISL request', async (value) => {
    const plain = await whatWouldFlip(graph());
    expect(plain.getCounterfactual, 'positive control: this graph really maps').toHaveBeenCalledOnce();
    expect(plain.outcome.assistant_text).toContain('One further what-if worth exploring');
    const stamped = graph();
    stamped.nodes.push({ id: RISK, kind: 'risk', label: 'Release slips', ref: 'R1', relies_on: { option_id: 'opt_1' },
      ...(value === undefined ? {} : { observed_state: { value } }) });
    stamped.ref_high_water = { R: 1 };
    const leftOut = await whatWouldFlip(stamped);
    expect(leftOut.getCounterfactual, 'full-graph counterfactual mutant: no-value risk must not suppress the call').toHaveBeenCalledOnce();
    expect(leftOut.getCounterfactual.mock.calls[0]?.[0], 'full-graph mutant: a valued risk must not enter ISL').toEqual(plain.getCounterfactual.mock.calls[0]?.[0]);
    expect(JSON.stringify(leftOut.getCounterfactual.mock.calls[0]?.[0])).not.toContain(RISK);
    expect(leftOut.outcome).toEqual(plain.outcome);
  });

  it.each([undefined, { option_id: 'absent_option' }])('rc3-counterfactual-identity-control: unstamped or bad-option no-value risk remains unmappable (%j)', async (stamp) => {
    const g = graph();
    g.nodes.push({ id: RISK, kind: 'risk', label: 'Release slips', ...(stamp === undefined ? {} : { relies_on: stamp }) });
    const result = await whatWouldFlip(g);
    expect(result.getCounterfactual).not.toHaveBeenCalled();
    expect(result.outcome.assistant_text).toBe(ANSWER);
  });
});
