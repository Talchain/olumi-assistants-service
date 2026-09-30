import { deriveDecisionContextGraphHash } from '../../../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';

/** The DGAI autosave carrier from scenario-analysis-canonical-hash.test.ts,
 * alongside one unambiguous current-Run display name. The held option's
 * data.interventions is promoted for analysis; the wire CAS hash stays raw. */
export function repairedOptionNameRead() {
  const graph = {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise outcome', goal_threshold: 0.5 },
      { id: 'dec_1', kind: 'decision', label: 'Choose approach' },
      { id: 'fac_annual_cost', kind: 'factor', label: 'Annual cost', observed_state: { value: 0.6, raw_value: 90000, unit: '£', cap: 150000 } },
      { id: 'opt_hybrid', kind: 'option', label: 'Spend £110,000', interventions: { fac_annual_cost: { value: 0.8, source: 'user_specified' } } },
      { id: 'opt_status_quo', kind: 'option', label: 'Status quo', is_baseline: true,
        data: { interventions: { fac_annual_cost: { unit: '£', raw_value: 90000 } } } },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_hybrid', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_status_quo', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_hybrid', to: 'fac_annual_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_status_quo', to: 'fac_annual_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_annual_cost', to: 'goal_1', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  };
  const graphHash = computeAnalysisAffectingGraphHash(graph as never);
  const runHash = deriveDecisionContextGraphHash(graph);
  if (graphHash === null || runHash === null || graphHash === runHash) {
    throw new Error('Repaired-shape fixture must have distinct raw CAS and canonical Run hashes');
  }
  return { graph, graphHash, runHash,
    result: { type: 'analysis_result', computed_against_hash: runHash, leading_option_id: 'opt_hybrid', summary: 'Synthetic result',
      enrichment: { option_comparison: [{ option_id: 'opt_hybrid', option_label: 'Spend £110,000', outcome: { mean: 120000 } }] } },
    state: { run_state: { kind: 'complete_current', graph_hash_at_run: runHash, computed_at: '2026-09-30T09:00:00.000Z' },
      leader_claim: { permitted: true, separation: 'separated' } },
  };
}
