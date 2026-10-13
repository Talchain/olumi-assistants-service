import { it, expect } from 'vitest';
import packet from './fixtures/b2r-prompt-packet.json';
import uncertainty from './fixtures/b2r-uncertainty-packet.json';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { RUN_INTERPRETATION_VIEW_INSTRUCTION } from '../provisional-view.js';
import { risksTurnForReadback } from '../method-turn/widen-turn.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { withEstimateGoalPointsAtEgress } from '../goal-chance-estimate-egress.js';
import { licensedGoalChanceLinesForAgent } from '../goal-chance-screen-lines.js';

const graph = { nodes: [{ id: 'tech', kind: 'option', label: 'Hire a tech lead' },
  { id: 'goal', kind: 'goal', label: 'Productivity' }], edges: [] };
const licence = { code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['tech'], pct_by_option: { tech: 13 },
  goal_node_id: 'goal', goal_label: 'Productivity', option_labels_by_option: { tech: 'Hire a tech lead' },
  target: { comparator: 'at_least', value: 10, unit: '%' }, olumi_estimate_link_count: 0 };
const row = { option_id: 'tech', probability_of_goal: 0.1344,
  probability_of_goal_precision: uncertainty.actual_values.tech_lead.precision,
  probability_of_goal_drivers: { drivers: [uncertainty.actual_values.tech_lead.driver] } };
const run = { run_id: 'b2r-run', computed_against_hash: 'b2r-model',
  enrichment: { inference_warnings: [licence], option_comparison: [row] } };
const apply = (assistant_text: string, analysisResult: unknown = run) =>
  withEstimateGoalPointsAtEgress({ assistant_text }, { graph, analysisResult, current: true }).assistant_text;

it('ruling 1: union property, unrelated percentages stay while incorrect goal chances are caught', () => {
  for (const pct of [1, 12, 14, 25, 67]) {
    const unrelated = `Hire a tech lead: ${pct}% market share.`;
    expect(apply(unrelated)).toBe(unrelated);
    const wrong = `There is a ${pct}% chance that Hire a tech lead meets your goal.`;
    expect(apply(wrong)).toBe(licensedGoalChanceLinesForAgent(run, graph, true)[0]!.chance);
  }
});
it('ruling 2: non-goal sentences keep every byte for each unrelated predicate', () => {
  for (const predicate of ['supplier failure', 'a competitor launching first', 'market share', 'change']) {
    const text = `Hire a tech lead: about 42% ${predicate}.\t  `;
    expect(apply(text)).toBe(text);
  }
});
it('ruling 3: each positive estimate count keeps the existing producer attribution and is idempotent', () => {
  for (const counts of [{ olumi_estimate_link_count: 1 }, { olumi_estimate_value_count: 1 },
    { olumi_estimate_settings_by_option: { tech: 1 } }]) {
    const result = { ...run, enrichment: { ...run.enrichment, inference_warnings: [{ ...licence, ...counts }] } };
    const out = apply('Hire a tech lead has a 13% chance of meeting your goal.', result);
    expect(out).toBe(licensedGoalChanceLinesForAgent(result, graph, true)[0]!.chance);
    expect(apply(out, result)).toBe(out);
  }
});
it('ruling 6: assembled HOST replacement equals the AIE packet, once, including both permission rules', () => {
  const replacement = packet.remaining_exact_replacements[1]!;
  const start = HOST_TOOL_CONTRACT.indexOf(replacement.after!);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(HOST_TOOL_CONTRACT.slice(start, start + replacement.after!.length)).toBe(replacement.after);
  expect(HOST_TOOL_CONTRACT.split(replacement.after!).length - 1).toBe(1);
  expect(HOST_TOOL_CONTRACT.includes(replacement.before!)).toBe(false);
  expect(replacement.after!.split(packet.withheld_better_option_rule.exact_copy).length - 1).toBe(1);
  const clause = 'Include your provisional interpretation in the reply, labelled as your view of the current model rather than a computed result or a human fact. Preserve the supplied uncertainty, source and unresolved conditions.';
  expect(RUN_INTERPRETATION_VIEW_INSTRUCTION.split(clause).length - 1).toBe(1);
});
it('AIE equality: actual risks role preserves the exact tagged-array directive', () => {
  const assembled = risksTurnForReadback({ graph });
  expect(assembled.kind).toBe('run_risks');
  if (assembled.kind !== 'run_risks') throw new Error('risk role unavailable');
  const p18 = packet.remaining_exact_replacements[0]!;
  expect(assembled.directive.split('\n')[0]).toBe(p18.after_prefix + '<risk_suggestions>JSON array</risk_suggestions>' + p18.after_suffix);
  expect(assembled.directive.includes('The server writes every word the user sees.')).toBe(false);
});
it('AIE equality: actual provisional tool result detail is exactly P26', async () => {
  const capabilities = createAgentCapabilities(async () => { throw new Error('no dispatch'); }, new ProposalStore(),
    undefined, 'full', undefined, { readLeaderStanding: async () => ({ analysis_on_record: true, withheld: true, because: 'uncertainty' }) });
  const result = await capabilities.giveProvisionalView!({ scenario_id: 'b2r', authenticated_user_id: null, request_id: 'b2r' }, {
    view: 'Test the churn assumption.', reasoning: 'The model holds churn fixed.', confirm_step: 'Supply evidence about churn.' });
  expect(result.ok).toBe(true);
  expect(result.detail).toBe(packet.remaining_exact_replacements[2]!.after);
});

