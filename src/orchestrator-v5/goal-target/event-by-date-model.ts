/** S2b: deterministic admission and date refresh for the forecast sum. No level on the goal. */
import type { CandidateModel, AdmittedModel } from '../agent-lane/admit-model.js';
import { goalDeadlineOf, isShareCalendarDate, soleGoalOf } from './goal-kind.js';
import { sayDate, timeBetween } from './deadline-date.js';
import { extraShareMoments, teamShareMoments } from './event-by-date-share.js';

type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Recognises the drafted (not yet analysable) team part by identity and definition. */
export function draftedTeamPartOf(graph: unknown): { goal: Rec; team: Rec; deliverable: string } | null {
  const goal = soleGoalOf(graph);
  if (!rec(graph) || !goal || goal.threshold_source !== 'definitional' || goal.goal_threshold_raw !== 100
    || goal.goal_threshold_cap !== 100 || goal.goal_threshold_frame !== 'level' || goal.goal_direction !== '>='
    || typeof goal.goal_threshold_unit !== 'string' || !goal.goal_threshold_unit.startsWith('% of ')) return null;
  const deliverable = goal.goal_threshold_unit.slice(5);
  const by = goalDeadlineOf(goal) === undefined ? 'the deadline' : sayDate(goalDeadlineOf(goal)!);
  if (goal.label !== `Share of ${deliverable} done by ${by}`) return null;
  const teams = graph.nodes.filter((n: Rec) => n.kind === 'factor' && n.label === `Share today's team finishes by ${by}`
    && (n.observed_state === undefined || n.observed_state.unit === goal.goal_threshold_unit) && graph.edges.some((e: Rec) => e.from === n.id && e.to === goal.id
      && e.provenance?.definitional === true && e.provenance?.natural_effect?.amount_unit === goal.goal_threshold_unit
      && e.strength?.mean === 1));
  return teams.length === 1 ? { goal, team: teams[0], deliverable } : null;
}

export function teamTimeAsk(graph: unknown): string | null {
  const part = draftedTeamPartOf(graph);
  return part !== null && goalDeadlineOf(part.goal) !== undefined && part.team.observed_state?.value === undefined
    ? `How long would ${part.deliverable} take with the team you have now?` : null;
}

export function admitEventByDate(candidate: CandidateModel): AdmittedModel {
  const deliverable = candidate.goal.deliverable?.trim();
  if (!deliverable || deliverable.length > 100) throw new Error('event_deliverable_required');
  const unit = `% of ${deliverable}`;
  const nodes: Rec[] = [
    { id: 'event_goal', kind: 'goal', label: `Share of ${deliverable} done by the deadline`, provenance: 'ai_inferred',
      threshold_source: 'definitional', goal_threshold: 1, goal_threshold_raw: 100, goal_threshold_cap: 100,
      goal_threshold_cap_provenance: 'metric_scale', goal_threshold_unit: unit, goal_threshold_frame: 'level', goal_direction: '>=' },
    { id: 'event_team', kind: 'factor', category: 'observable', label: "Share today's team finishes by the deadline",
      provenance: 'ai_inferred', scale_frame: 100,
      unit_reading: { unit, source: 'olumi_reading', source_quote: deliverable } },
    { id: 'event_decision', kind: 'decision', label: candidate.decision_question || candidate.goal.metric, provenance: 'ai_inferred' },
  ];
  const edges: Rec[] = [{ from: 'event_team', to: 'event_goal', exists_probability: 1,
    strength: { mean: 1, std: 0.01 }, effect_direction: 'positive', provenance: { source: 'cee_hypothesis', definitional: true,
      natural_effect: { amount: 1, amount_unit: unit, per_source_change: 1, per_source_change_unit: unit,
        strength_mean: 1, strength_mean_frame: 'edge_strength' } } }];
  const switches: string[] = [];
  candidate.options.forEach((o, i) => {
    const id = `event_option_${i + 1}`, capacity = o.added_capacity;
    nodes.push({ id, kind: 'option', label: o.label, provenance: o.provenance === 'explicit' ? 'from_brief' : 'ai_inferred',
      ...(o.is_status_quo === true ? { is_baseline: true } : {}), interventions: {} });
    edges.push({ from: 'event_decision', to: id, exists_probability: 1, strength: { mean: 1, std: 0.01 }, effect_direction: 'positive' });
    if (o.is_status_quo === true || !capacity) return;
    const { monthly_share_pct, lead_months_low, lead_months_high } = capacity;
    if (![monthly_share_pct, lead_months_low, lead_months_high].every(Number.isFinite)
      || monthly_share_pct < 0 || lead_months_low < 0 || lead_months_high < lead_months_low) throw new Error('invalid_capacity_estimate');
    const sw = `event_capacity_${i + 1}`;
    switches.push(sw);
    nodes.push({ id: sw, kind: 'factor', category: 'controllable', label: `${o.label} adds capacity`, provenance: 'ai_inferred',
      observed_state: { value: 0, source: 'cee_inference', extra_share_by_date: { monthly_share: monthly_share_pct,
        lead_low: lead_months_low, lead_high: lead_months_high, unit: `${unit} per month` } } });
    // Without a date the required edge fields stay explicitly defaulted, never an estimate of extra share.
    edges.push({ from: sw, to: 'event_goal', exists_probability: 1, effect_direction: 'positive',
      strength: { mean: 0.5, std: 0.125 }, defaulted: true,
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
    nodes.find(n => n.id === id)!.interventions[sw] = { value: 1 };
  });
  const options = nodes.filter(n => n.kind === 'option');
  for (const o of options) for (const sw of switches) {
    o.interventions[sw] ??= { value: 0 };
    edges.push({ from: o.id, to: sw, exists_probability: 1, strength: { mean: 1, std: 0.01 }, effect_direction: 'positive' });
  }
  return { nodes, edges, goal_constraints: [], loss: [], withheld: [],
    inference_classes: Object.fromEntries(nodes.map(n => [n.id, n.provenance === 'from_brief' ? 'brief_stated' : 'builder_inferred'])) } as unknown as AdmittedModel;
}

/** A held S1 date materialises only this definition's forecast carriers. Pure clone; all other graph fields survive. */
export function withEventShareDate(graph: unknown, deadline: string, reference: string): unknown {
  const part = draftedTeamPartOf(graph);
  if (part === null || !isShareCalendarDate(deadline) || !isShareCalendarDate(reference)
    || timeBetween(reference, deadline, 'months') <= 0) return graph;
  const out = structuredClone(graph) as Rec;
  const goal = out.nodes.find((n: Rec) => n.id === part.goal.id), team = out.nodes.find((n: Rec) => n.id === part.team.id);
  const D = timeBetween(reference, deadline, 'months'), unit = goal.goal_threshold_unit;
  goal.goal_horizon = { deadline };
  goal.label = `Share of ${part.deliverable} done by ${sayDate(deadline)}`;
  team.label = `Share today's team finishes by ${sayDate(deadline)}`;
  const stated = team.observed_state?.stated_time;
  if (stated?.quantity === 'months_to_finish') {
    const m = teamShareMoments(D, stated.low, stated.high);
    Object.assign(team.observed_state, { value: m.mean, std: m.sd, raw_value: m.mean * 100,
      stated_time: { ...stated, deadline, reference_date: reference } });
  }
  for (const edge of out.edges.filter((e: Rec) => e.to === goal.id && e.from !== team.id)) {
    const c = out.nodes.find((n: Rec) => n.id === edge.from)?.observed_state?.extra_share_by_date;
    if (!c) continue;
    Object.assign(c, { deadline, reference_date: reference });
    const m = extraShareMoments(c.monthly_share / 100, D, c.lead_low, c.lead_high);
    edge.strength = { mean: m.mean, std: m.sd };
    delete edge.defaulted;
    edge.provenance.natural_effect = { amount: m.mean * 100, amount_unit: unit, per_source_change: 1,
      per_source_change_unit: 'switch', strength_mean: m.mean, strength_mean_frame: 'edge_strength' };
  }
  return out;
}
