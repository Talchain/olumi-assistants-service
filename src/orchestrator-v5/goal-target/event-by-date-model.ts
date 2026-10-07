/** S2b: deterministic admission and date refresh for the forecast sum. No level on the goal. */
import { eventShareEndpointMatches } from './share-by-date-carrier.js';
import type { CandidateModel, AdmittedModel } from '../agent-lane/admit-model.js';
import { goalDeadlineOf, isShareCalendarDate, soleGoalOf } from './goal-kind.js';
import { sayDate, timeBetween } from './deadline-date.js';
import { extraShareMoments, teamShareMoments } from './event-by-date-share.js';

type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Brief-owned event/deadline scope; drafter flags never attest it. Bounded linear scans. */
export const EVENT_WORDS = /\b(?:launch(?:ed|ing)?|deliver(?:ed|y|ing)?|ship(?:ped|ping)?|finish(?:ed|ing)?|complet(?:e|ed|ion|ing)|go(?:es)?[ \t]{1,4}live|releas(?:e|ed|ing))\b/i;
export const EVENT_DEADLINE = /\b(?:deadlines?|on[ \t]{1,4}time|by[ \t]{1,4}(?:\d{1,4}\b|Q[1-4]\b|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|next|the|year|month|week)|within[ \t]{1,4}\d{1,3}[ \t]{1,4}(?:days?|weeks?|months?))\b/i;
export const QUANTITY_TARGET = /[£$€][ \t]{0,4}\d|\b\d[\d,.]{0,20}[ \t]{0,4}(?:%|(?!(?:days?|weeks?|months?|years?|developers?|people|leads?|January|February|March|April|May|June|July|August|September|October|November|December)\b)[a-z][a-z-]{0,40}\b)/i;
export function briefAttestsEventByDate(brief: unknown, goal?: CandidateModel['goal']): boolean {
  if (typeof brief !== 'string' || brief.length > 20000) return false;
  if (goal && (QUANTITY_TARGET.test(goal.metric)
    || (goal.value !== null && goal.value !== undefined))) return false;
  const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w && !['a', 'an', 'the'].includes(w));
  return brief.split(/[.!?;\n]/).some(sentence => {
    if (!EVENT_WORDS.test(sentence) || !EVENT_DEADLINE.test(sentence) || QUANTITY_TARGET.test(sentence)) return false;
    if (!goal) return true;
    const held = new Set(words(sentence)), deliverable = words(goal.deliverable ?? ''), metric = words(goal.metric);
    return deliverable.length > 0 && metric.length > 0 && [...deliverable, ...metric].every(w => held.has(w));
  });
}

/** Persisted provenance is passthrough at every graph boundary, unlike node labels. */
export function eventShareCarrierOf(graph: unknown): Rec | null {
  const goal = soleGoalOf(graph);
  if (!rec(graph) || !goal || !Array.isArray(graph.edges)) return null;
  const carriers = graph.edges.filter((e: Rec) => e.to === goal.id && eventShareEndpointMatches(e,
    graph.nodes?.find((n: Rec) => n.id === e.from), goal));
  return carriers.length === 1 ? carriers[0] : null;
}
export function isEventShareForecast(graph: unknown): boolean {
  const goal = soleGoalOf(graph);
  return !!goal && (eventShareCarrierOf(graph) !== null || (goal.threshold_source === 'definitional'
    && typeof goal.goal_threshold_unit === 'string' && goal.goal_threshold_unit.startsWith('% of ')));
}
export function missingEventCapacityOptionIds(graph: unknown): string[] {
  const ids = eventShareCarrierOf(graph)?.provenance?.share_by_date?.unresolved_option_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}
export const EVENT_START_GAP = "This doesn't yet model when new people start contributing, which decides a deadline. When would they start?";

/** Recognises the drafted (not yet analysable) team part by identity and definition. */
export function draftedTeamPartOf(graph: unknown): { goal: Rec; team: Rec; deliverable: string } | null {
  const goal = soleGoalOf(graph);
  if (!rec(graph) || !goal || goal.threshold_source !== 'definitional' || goal.goal_threshold_raw !== 100
    || goal.goal_threshold_cap !== 100 || goal.goal_threshold_frame !== 'level' || goal.goal_direction !== '>='
    || typeof goal.goal_threshold_unit !== 'string' || !goal.goal_threshold_unit.startsWith('% of ')) return null;
  const deliverable = goal.goal_threshold_unit.slice(5);
  const carrier = eventShareCarrierOf(graph);
  if (carrier === null || carrier.provenance.share_by_date.deliverable !== deliverable) return null;
  const teams = graph.nodes.filter((n: Rec) => n.kind === 'factor' && n.id === carrier.from
    && (n.observed_state === undefined || n.observed_state.unit === goal.goal_threshold_unit)
    && carrier.provenance?.definitional === true && carrier.provenance?.natural_effect?.amount_unit === goal.goal_threshold_unit
    && carrier.strength?.mean === 1);
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
      share_by_date: { role: 'team', team_id: 'event_team', goal_id: 'event_goal', deliverable, unresolved_option_ids: candidate.options.flatMap((o, i) =>
        o.is_status_quo !== true && !o.added_capacity ? [`event_option_${i + 1}`] : []) },
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
  const model = { nodes, edges, goal_constraints: [], loss: [], withheld: [],
    inference_classes: Object.fromEntries(nodes.map(n => [n.id, n.provenance === 'from_brief' ? 'brief_stated' : 'builder_inferred'])) };
  // forbidden-exempt: deterministic admission builds the canonical share-by-date shape as plain records; every field is pinned by s-e-goals-s2b rows and S2a recognition
  return model as unknown as AdmittedModel;
}

/** A held S1 date materialises only this definition's forecast carriers. Pure clone; all other graph fields survive. */
export function withEventShareDate(graph: unknown, deadline: string, reference: string): unknown {
  const part = draftedTeamPartOf(graph);
  if (part === null || !isShareCalendarDate(deadline) || !isShareCalendarDate(reference)
    || timeBetween(reference, deadline, 'months') <= 0) return graph;
  const out = structuredClone(graph) as Rec;
  const goal = out.nodes.find((n: Rec) => n.id === part.goal.id), team = out.nodes.find((n: Rec) => n.id === part.team.id);
  const unit = goal.goal_threshold_unit;
  goal.goal_horizon = { deadline };
  goal.label = `Share of ${part.deliverable} done by ${sayDate(deadline)}`;
  team.label = `Share today's team finishes by ${sayDate(deadline)}`;
  const stated = team.observed_state?.stated_time;
  if (stated?.quantity === 'months_to_finish') {
    const estimateReference = stated.reference_date;
    const m = teamShareMoments(timeBetween(estimateReference, deadline, 'months'), stated.low, stated.high);
    Object.assign(team.observed_state, { value: m.mean, std: m.sd, raw_value: m.mean * 100,
      stated_time: { ...stated, deadline } });
  }
  for (const edge of out.edges.filter((e: Rec) => e.to === goal.id && e.from !== team.id)) {
    const c = out.nodes.find((n: Rec) => n.id === edge.from)?.observed_state?.extra_share_by_date;
    if (!c) continue;
    Object.assign(c, { deadline, reference_date: c.reference_date ?? reference });
    const m = extraShareMoments(c.monthly_share / 100, timeBetween(c.reference_date, deadline, 'months'), c.lead_low, c.lead_high);
    edge.strength = { mean: m.mean, std: m.sd };
    delete edge.defaulted;
    edge.provenance.natural_effect = { amount: m.mean * 100, amount_unit: unit, per_source_change: 1,
      per_source_change_unit: 'switch', strength_mean: m.mean, strength_mean_frame: 'edge_strength' };
  }
  return out;
}
