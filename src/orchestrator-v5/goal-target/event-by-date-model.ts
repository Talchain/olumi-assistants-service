/** S2b: deterministic admission and date refresh for the forecast sum. No level on the goal. */
import { eventShareEndpointMatches } from './share-by-date-carrier.js';
import type { CandidateModel, AdmittedModel } from '../agent-lane/admit-model.js';
import { goalDeadlineOf, isShareCalendarDate, soleGoalOf } from './goal-kind.js';
import { sayDate, timeBetween } from './deadline-date.js';
import { extraShareMoments, teamShareMoments } from './event-by-date-share.js';
import { readUnitParts } from '../agent-lane/same-unit.js';

type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Brief-owned event/deadline scope; drafter flags never attest it. Bounded linear scans. */
export const EVENT_WORDS = /\b(?:launch(?:ed|ing|es)?|deliver(?:ed|y|ing|s)?|ship(?:ped|ping|s)?|finish(?:ed|ing|es)?|complet(?:e|ed|ion|ing)|go(?:es)?[ \t]{1,4}live|releas(?:e|ed|ing|es))\b/i;
export const EVENT_DEADLINE = /\b(?:deadlines?|on[ \t-]{1,4}time|by[ \t]{1,4}(?:\d{1,4}(?:st|nd|rd|th)?\b|Q[1-4]\b|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|next|the|year|month|week)|within[ \t]{1,4}\d{1,3}[ \t]{1,4}(?:days?|weeks?|months?))\b/i;
const EVENT_VERB_ROOTS: Readonly<Record<string, string>> = {
  launch: 'launch', launching: 'launch', launched: 'launch', launches: 'launch',
  ship: 'ship', shipping: 'ship', shipped: 'ship', ships: 'ship',
  release: 'release', releasing: 'release', released: 'release', releases: 'release',
  deliver: 'deliver', delivering: 'deliver', delivered: 'deliver', delivers: 'deliver',
  finish: 'finish', finishing: 'finish', finished: 'finish', finishes: 'finish',
};
/** The candidate's quantity decides the class; numbers elsewhere in the brief do not. */
export function isQuantityGoalCandidate(goal: CandidateModel['goal']): boolean {
  return goal.value !== null || readUnitParts(goal.unit)?.kind === 'currency';
}
export function briefAttestsEventByDate(brief: unknown, goal?: CandidateModel['goal']): boolean {
  if (typeof brief !== 'string' || brief.length > 20000) return false;
  if (goal && isQuantityGoalCandidate(goal)) return false;
  const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter(w => w && !['a', 'an', 'the'].includes(w)).map(w => EVENT_VERB_ROOTS[w] ?? w);
  return brief.split(/[.!?;\n]/).some(sentence => {
    if (!EVENT_WORDS.test(sentence) || !EVENT_DEADLINE.test(sentence)) return false;
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
export function unresolvedEventOptionIds(graph: unknown): string[] {
  const carrier = eventShareCarrierOf(graph)?.provenance?.share_by_date;
  if (!carrier || !rec(graph) || !Array.isArray(graph.nodes)) return [];
  const ids = Array.isArray(carrier.unresolved_option_ids) ? carrier.unresolved_option_ids.filter((id: unknown): id is string => typeof id === 'string') : [];
  const known = Array.isArray(carrier.option_ids) ? carrier.option_ids : [];
  const added = graph.nodes.filter((n: Rec) => n.kind === 'option' && n.is_baseline !== true && typeof n.id === 'string'
    && !known.includes(n.id)
    && !Object.entries(n.interventions ?? {}).some(([target, v]) => rec(v) && v.value === 1
      && graph.nodes.some((factor: Rec) => factor.id === target && factor.observed_state?.extra_share_by_date)));
  return [...new Set([...ids, ...added.map((n: Rec) => n.id as string)])];
}
export function missingEventCapacityOptionIds(graph: unknown): string[] {
  const carrier = eventShareCarrierOf(graph)?.provenance?.share_by_date;
  if (!carrier || !rec(graph) || !Array.isArray(graph.nodes)) return [];
  const capacityIds = Array.isArray(carrier.capacity_option_ids) ? carrier.capacity_option_ids : [];
  return unresolvedEventOptionIds(graph).filter(id => capacityIds.includes(id)
    || optionAddsCapacity(graph.nodes.find((n: Rec) => n.id === id)?.label));
}
/** No start-time question for a scope-only alternative. A drafter capacity attests itself. */
export function optionAddsCapacity(label: unknown): boolean {
  return typeof label === 'string' && label.length <= 200
    && /\b(?:hir(?:e|ing)|recruit(?:ing|ment)?|staff(?:ing)?|developers?|contractors?|engineers?|capacity|headcount)\b/i.test(label);
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
  if (part === null || goalDeadlineOf(part.goal) === undefined || part.team.observed_state?.value !== undefined) return null;
  return Number.isFinite(eventShareCarrierOf(graph)?.provenance?.share_by_date?.stated_time?.most_likely)
    ? 'Roughly how long could it take at the soonest, and at the latest, with the team you have now?'
    : `How long would ${part.deliverable} take with the team you have now?`;
}

export function admitEventByDate(candidate: CandidateModel, brief = ''): AdmittedModel {
  const deliverable = candidate.goal.deliverable?.trim();
  if (!deliverable || deliverable.length > 100) throw new Error('event_deliverable_required');
  const unit = `% of ${deliverable}`;
  const loss: Rec[] = [];
  // Currency words/symbols use the shared unit reader, in any position. No amounts are parsed or masked.
  if (brief.split(/[\p{N}\p{P}\p{Z}\s]+/u).some(word => readUnitParts(word)?.kind === 'currency')) {
    loss.push({ field_path: 'brief.event_forecast_not_modelled', before: brief, after: null, severity: 'warn',
      reason: `The deadline chance forecasts completion of "${deliverable}". Money limits and factors kept in the model remain separate. Any other money objective in these brief words is not modelled by this forecast: "${brief}".` });
  }
  const unresolved: string[] = [];
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
      share_by_date: { role: 'team', team_id: 'event_team', goal_id: 'event_goal', deliverable,
        option_ids: candidate.options.map((_, i) => `event_option_${i + 1}`),
        capacity_option_ids: candidate.options.flatMap((o, i) => o.is_status_quo !== true && (o.added_capacity || optionAddsCapacity(o.label)) ? [`event_option_${i + 1}`] : []),
        unresolved_option_ids: unresolved },
      natural_effect: { amount: 1, amount_unit: unit, per_source_change: 1, per_source_change_unit: unit,
        strength_mean: 1, strength_mean_frame: 'edge_strength' } } }];
  const switches: string[] = [];
  candidate.options.forEach((o, i) => {
    const id = `event_option_${i + 1}`, capacity = o.added_capacity;
    nodes.push({ id, kind: 'option', label: o.label, provenance: o.provenance === 'explicit' ? 'from_brief' : 'ai_inferred',
      ...(o.is_status_quo === true ? { is_baseline: true } : {}), interventions: {} });
    edges.push({ from: 'event_decision', to: id, exists_probability: 1, strength: { mean: 1, std: 0.01 }, effect_direction: 'positive' });
    if (o.is_status_quo === true) return;
    if (!capacity) { unresolved.push(id); return; }
    const { monthly_share_pct, lead_months_low, lead_months_high } = capacity;
    if (![monthly_share_pct, lead_months_low, lead_months_high].every(Number.isFinite)
      || monthly_share_pct < 0 || monthly_share_pct > 100 || lead_months_low < 0 || lead_months_high < lead_months_low) {
      unresolved.push(id);
      const reason = !Number.isFinite(monthly_share_pct) || monthly_share_pct < 0 || monthly_share_pct > 100
        ? `Olumi's added-capacity pace for "${o.label}" is not used. Enter a pace between 0% and 100% of ${deliverable} a month.`
        : `Olumi's lead time for "${o.label}" is not used. Enter the soonest and latest start times in months, with the soonest first.`;
      loss.push({ field_path: `nodes[${id}].added_capacity`, before: capacity, after: null, reason, severity: 'warn' });
      return;
    }
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
  const model = { nodes, edges, goal_constraints: [], loss, withheld: [],
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
  const previous = goalDeadlineOf(goal);
  const defaultGoal = `Share of ${part.deliverable} done by ${previous === undefined ? 'the deadline' : sayDate(previous)}`;
  const defaultTeam = `Share today's team finishes by ${previous === undefined ? 'the deadline' : sayDate(previous)}`;
  goal.goal_horizon = { deadline };
  if (goal.label === defaultGoal) goal.label = `Share of ${part.deliverable} done by ${sayDate(deadline)}`;
  if (team.label === defaultTeam) team.label = `Share today's team finishes by ${sayDate(deadline)}`;
  const mostLikely = eventShareCarrierOf(out)?.provenance?.share_by_date?.stated_time;
  if (mostLikely?.quantity === 'months_to_finish') mostLikely.deadline = deadline;
  const stated = team.observed_state?.stated_time;
  if (stated?.quantity === 'months_to_finish' && Number.isFinite(stated.low) && Number.isFinite(stated.high)) {
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
