import { frozenCandidateGraph } from './frozen-candidate-graphs.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { withGoalChanceLicence } from '../../../goal-target/goal-chance-licence.js';

type Json = Record<string, any>;
export const ILLUSTRATIVE = 'Illustrative calculation — uses untested Olumi assumptions.';
/** Two small synthetic briefs share the conditional-point/range class, with different subjects and units. */
export function d3Run(subject: 'orders' | 'repairs', mode: 'conditional' | 'placeholder' | 'stated' = 'conditional'): { graph: Json; result: Json; loss: readonly Json[]; quotes: string[]; sent: Json } {
  const unit = `${subject} per week`, metric = `Weekly ${subject}`;
  const factors = ['Weekend opening', 'Online bookings'];
  const quotes = factors.map((f, i) => `${f} could add about ${i ? 25 : 20} ${unit} (${i ? '5 to 45' : '10 to 30'}).`);
  const candidate = {
    goal: { kind: null, deliverable: null, metric, operator: '>=', target_stated: true, value: 150, unit,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 120, baseline_provenance: 'explicit',
      baseline_origin: 'user', baseline_stance: 'stated_current', target_origin: 'user', target_stance: 'target',
      horizon_months: null, scope: null, quantity_frame: 'level', basis: null }, constraints: [],
    factors: factors.map(label => ({ label, origin: 'olumi', stance: 'estimate', role: 'controllable', baseline_known: true,
      baseline_value: 0, unit: '0/1', provenance: 'ai_proposed', plausible_max: 1 })),
    options: factors.map(label => ({ label: `Try ${label}`, provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: label, value: 1, value_kind: 'absolute', unit: '0/1', origin: 'olumi', stance: 'estimate', provenance: 'ai_proposed' }] })),
    links: factors.map((from, i) => ({ from, to: metric, direction: 'positive', origin: 'user', stance: 'estimate', provenance: 'explicit',
      effect_amount: mode === 'placeholder' ? null : i ? 25 : 20, effect_per_source_change: mode === 'placeholder' ? null : 1, effect_provenance: 'explicit', source_quote: quotes[i], definitional: false })),
    statements: factors.map((label, i) => ({ subject: { kind: 'link', label, to_label: metric, factor_label: null }, field: 'effect',
      speaker: 'user', stance: 'estimate', quote: quotes[i], form: 'range', value: i ? 25 : 20, low: i ? 5 : 10, high: i ? 45 : 30,
      unit, conditions: `If ${label} is introduced.`, qualifier: 'about' })),
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: 'How could we increase throughput?',
  };
  const converted = frozenCandidateGraph(candidate, { words: quotes.join(' '), recorded_at: '2026-10-20T04:00:00.000Z' });
  if ('refused' in converted) throw new Error(converted.refused);
  const graph = projectGraphForPersistence({ ...GraphV3.parse(converted.graph), options: [] }) as Json;
  if (mode === 'stated') for (const edge of graph.edges) {
    // Fully elicited coefficient, spread and existence; equal numbers do not make them defaults.
    if (edge.provenance) delete edge.provenance.uncertainty_defaults;
  }
  const goal = graph.nodes.find((n: Json) => n.kind === 'goal');
  const options = graph.nodes.filter((n: Json) => n.kind === 'option');
  const sent = { graph, goal_node_id: goal.id, options: options.map((o: Json) => ({ option_id: o.id, interventions: o.interventions })) };
  const envelope = { option_comparison: options.map((o: Json, i: number) => ({ option_id: o.id, option_label: o.label,
    probability_of_goal: i ? 0.2742 : 0.1295, outcome: { mean: i ? 145 : 140, std: 10 } })), inference_warnings: [] };
  const licensed = withGoalChanceLicence(envelope, graph, goal.id, undefined, undefined, graph, { sentRun: sent });
  return { graph, result: { type: 'analysis_result', summary: '', leading_option_id: null,
    enrichment: licensed }, loss: converted.loss, quotes, sent };
}
