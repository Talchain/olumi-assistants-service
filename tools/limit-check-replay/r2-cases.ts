import { readFileSync } from 'node:fs';
import { limitChecksForAgent } from '../../src/orchestrator-v5/agent-lane/limit-checks.js';
import { savedRunContextFacts } from '../../src/orchestrator-v5/agent-lane/saved-run-context-facts.js';

export type Rec = Record<string, any>;
export const goalId = 'monthly_recurring_revenue';
export const riskId = 'customers_lost_from_price_rise';
export const checkedSentence = '‘monthly recurring revenue’ was checked against the figures in your model.';
export const captured = (): Rec => JSON.parse(readFileSync(new URL('./fixtures/read-after-run1-1791348363696.json', import.meta.url), 'utf8')).j;
export const evaluations = (s: Rec) => s.analysis_identity_evaluated_node_ids.map((node_id: string) => ({ node_id, evaluated: true }));
export const edge = (s: Rec, from: string, to: string): Rec => s.graph.edges.find((e: Rec) => e.from === from && e.to === to);
export const checks = (s: Rec, attested = true) => limitChecksForAgent(s.graph, s.analysis_limit_verdicts,
  attested ? new Set<string>(s.analysis_identity_evaluated_node_ids) : undefined)!;
export const savedFacts = (s: Rec, attested = true): Rec => savedRunContextFacts(s.scenario_id, {
  graph_hash: s.graph_hash, analysis_state: s.analysis_state, analysis_result: s.analysis_result, raw: s.graph,
  limit_verdicts: s.analysis_limit_verdicts,
  ...(attested ? { identity_evaluated: new Set<string>(s.analysis_identity_evaluated_node_ids) } : {}),
}, { leader_may_be_named: false });

export function differentCostCap(s: Rec): void {
  s.graph.nodes.push({ id: 'cost', kind: 'factor', label: 'Cost', unit: '£', observed_state: { value: 0, source: 'user_stated', unit: '£' } });
  s.graph.edges.push({ from: 'existing_price_rise', to: 'cost', strength: { mean: 1 }, provenance: { magnitude: 'user_stated',
    natural_effect: { amount: 2, amount_unit: 'customers', strength_mean: 1 } } });
  s.graph.goal_constraints.push({ node_id: 'cost', constraint_id: 'cost-cap', value: 100, operator: '<=', value_frame: 'level', unit: '£' });
  s.analysis_limit_verdicts.per_limit.push({ constraint_id: 'cost-cap', state: 'scored' });
}

/** Replay the real runAnalysis carrier with captured responses; every dispatch stays local. */
export async function runCarrier(s: Rec, attested = true): Promise<Rec> {
  const { createAgentCapabilities } = await import('../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js');
  const { ProposalStore } = await import('../../src/orchestrator-v5/agent-lane/proposal.js');
  const capabilities = createAgentCapabilities(async path => {
    if (path.endsWith('/graph')) {
      const { analysis_identity_evaluated_node_ids, ...read } = s;
      return { status: 200, json: { ...read, ...(attested ? { analysis_identity_evaluated_node_ids } : {}) } };
    }
    if (path === '/orchestrate/v2/turn') return { status: 200, json: {
      assistant_text: '', analysis_state: s.analysis_state, analysis_ready: s.analysis_ready, blocks: [s.analysis_result],
    } };
    throw new Error(`Unexpected local replay dispatch: ${path}`);
  }, new ProposalStore());
  return capabilities.runAnalysis({ scenario_id: s.scenario_id, authenticated_user_id: null, request_id: 'lim1-r2-replay' }, { reason: 'Run it.' });
}
