import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { withGoalChanceLicence } from '../../../goal-target/goal-chance-licence.js';

type Json = Record<string, any>;
export const ILLUSTRATIVE = 'Illustrative calculation — uses untested Olumi assumptions.';
/**
 * Two small synthetic briefs share one shape (two levers, each an option's, each with an effect on a level goal), with
 * different subjects and units, built on the core path: living model → `mapLivingModel` → the stored postimage.
 * - `conditional`: the person's figure inside their range; the spread is Olumi's.
 * - `olumi`: Olumi's own estimate; its spread and its existence are Olumi's.
 * - `stated`: the person's full law (mean and SD) with the link stated, so nothing is Olumi's default.
 */
export function d3Run(subject: 'orders' | 'repairs', mode: 'conditional' | 'olumi' | 'stated' = 'conditional'): { graph: Json; result: Json; quotes: string[]; sent: Json } {
  const unit = `${subject} per week`;
  const levers = [['weekend', 'Weekend opening', 20, 10, 30], ['online', 'Online bookings', 25, 5, 45]] as const;
  const quotes = levers.map(([, label, v, low, high]) => `${label} could add about ${v} ${unit} (${low} to ${high}).`);
  const living: LivingModelT = {
    aims: [{ id: 'goal', text: `Weekly ${subject}`, status: 'current', defined_as: null, source: 'user', party: null, quote: `at least 150 ${unit}; today 120`,
      target: { quantity: unit, comparator: '>=', value: 150, low: null, high: null, unit, by_when: null, period_months: null, period_by: null, period_read_on: null, baseline: 'today', current: 120,
        current_source: null, current_unit: null, change_kind: null, source: null } }],
    options: levers.map(([id, label]) => ({ status: 'feasible' as const, id: `try_${id}`, label: `Try ${label}`, developed_from: null, source: 'user' as const,
      party: null, quote: `try ${label.toLowerCase()}`, settings: [{ factor_id: id, estimate_by: null, value: 1, low: null, high: null, unit: null, source: 'user' as const, party: null, quote: `try ${label.toLowerCase()}` }] })),
    factors: levers.map(([id, label]) => ({ kind: 'factor' as const, limit: null, id, label, estimate_by: null, value: 0, low: null, high: null, unit: null, defined_as: null,
      source: 'user' as const, party: null, quote: `no ${label.toLowerCase()} today` })),
    links: levers.map(([id, , v, low, high], i) => ({ id: `${id}_goal`, from: id, to: 'goal', source: mode === 'olumi' ? 'olumi' as const : 'user' as const, party: null,
      quote: mode === 'olumi' ? null : quotes[i]!,
      effect: mode === 'conditional' ? { form: 'range' as const, estimate_by: null, value: v, low, high, sd: null, unit, sign: '+' as const }
        : mode === 'olumi' ? { form: 'point' as const, estimate_by: null, value: v, low: null, high: null, sd: null, unit, sign: '+' as const }
          : { form: 'normal' as const, estimate_by: null, value: v, sd: (high - low) / 4, low: null, high: null, unit, sign: '+' as const } })),
    risks: [], conditions: [], views: [], history: [],
  };
  const { graph: mapped, withheld } = mapLivingModel(living);
  if (withheld.length > 0) throw new Error(`fixture must map whole: ${JSON.stringify(withheld)}`);
  const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped, living_model: living })) as Json;
  const goal = graph.nodes.find((n: Json) => n.kind === 'goal');
  const options = graph.nodes.filter((n: Json) => n.kind === 'option');
  const sent = { graph, goal_node_id: goal.id, options: options.map((o: Json) => ({ option_id: o.id, interventions: o.interventions })) };
  const envelope = { option_comparison: options.map((o: Json, i: number) => ({ option_id: o.id, option_label: o.label,
    probability_of_goal: i ? 0.2742 : 0.1295, outcome: { mean: i ? 145 : 140, std: 10 } })), inference_warnings: [] };
  const licensed = withGoalChanceLicence(envelope, graph, goal.id, undefined, undefined, graph, { sentRun: sent });
  return { graph, result: { type: 'analysis_result', summary: '', leading_option_id: null, enrichment: licensed }, quotes, sent };
}
