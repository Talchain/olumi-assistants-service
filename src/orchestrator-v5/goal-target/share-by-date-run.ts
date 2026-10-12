/** S2a Run-only frame attestation and per-option mathematical licence input. */
import { draftedTeamPartOf, eventShareCarrierOf, isEventShareForecast, unresolvedEventOptionIds } from './event-by-date-model.js';
import { goalDeadlineFromRecord, shareByDateGoalOf, soleGoalOf, statedTeamShareOf } from './goal-kind.js';
import { timeBetween, todayInLondon } from './deadline-date.js';
import { extrasOf, gate, MAX_RANGED_PARTS, rangedPartCount, type ExtraShare, type ShareGate, type ShareParts } from './event-by-date-share.js';
import { figureOf, olumiStartBounds } from './hiring-times.js';
import type { GoalChanceDisplayRounding } from './goal-chance-display.js';

type Rec = Record<string, any>;

/** EXACT same reference and bytes for every other goal. Never writes persistence. */
export function withShareByDateFrame<G>(wireGraph: G, persistedGraph: unknown): G {
  const share = shareByDateGoalForChanceOf(persistedGraph);
  if (share === null) return wireGraph;
  const g = wireGraph as Rec;
  return { ...g, nodes: g.nodes.map((n: Rec) => n.id === share.goal.id
    ? { ...n, goal_threshold_frame: 'delta', goal_threshold: share.threshold_raw / 100 } : n) } as G;
}

/** A single estimate and a passed deadline cannot be sent for a chance calculation. */
export function shareChanceRunBlock(graph: unknown): { reason_code: 'team_time_range_required' | 'goal_deadline_passed'; words: string } | null {
  const g = graph as Rec | null;
  if (g === null || typeof g !== 'object' || !Array.isArray(g.nodes)) return null;
  const share = shareByDateGoalForChanceOf(graph);
  if (share === null && !isEventShareForecast(graph)) return null;
  const deadline = goalDeadlineFromRecord(graph, soleGoalOf(graph)?.id);
  if (deadline !== undefined && deadline <= todayInLondon(new Date())) {
    return { reason_code: 'goal_deadline_passed', words: 'Not shown. The deadline has passed. State a future deadline before rerunning.' };
  }
  const team = draftedTeamPartOf(graph)?.team
    ?? g.nodes.find((n: Rec) => n.id === share?.team_part_id);
  const stated = team?.observed_state?.stated_time
    ?? eventShareCarrierOf(graph)?.provenance?.share_by_date?.stated_time ?? team?.stated_time;
  if (stated?.quantity === 'months_to_finish' && (typeof stated.most_likely === 'number' && !(typeof stated.low === 'number' && stated.low > 0 && stated.high > stated.low)
    || (typeof stated.low === 'number' && stated.low === stated.high))) {
    return { reason_code: 'team_time_range_required',
      words: 'Not shown. Add the soonest and latest times with the team you have now; your most likely time is not a range.' };
  }
  return null;
}

/** Exact words for capacity metadata that cannot support the added option. */
function capacityInputFailure(extra: Rec): string | null {
  if (typeof extra.lead_low !== 'number' || typeof extra.lead_high !== 'number'
    || !Number.isFinite(extra.lead_low) || !Number.isFinite(extra.lead_high)
    || extra.lead_low < 0 || extra.lead_high < extra.lead_low) {
    return "Not shown. Olumi's hiring-time range is not usable. Give the soonest and latest hiring times, for example ‘3–5 months’.";
  }
  if (typeof extra.monthly_share !== 'number' || !Number.isFinite(extra.monthly_share)
    || extra.monthly_share < 0 || extra.monthly_share > 100) {
    return "Not shown. Olumi's estimate of the new team's pace is not usable. State a pace from 0% to 100% of the work a month.";
  }
  return null;
}

/** Unused invalid capacity metadata cannot erase the user's carry-on forecast.
 * Only metadata failing the named bounds is removed from this attestation copy;
 * the Run and persisted model retain every node, edge and option setting.
 */
export function shareByDateGoalForChanceOf(graph: unknown): ReturnType<typeof shareByDateGoalOf> {
  const share = shareByDateGoalOf(graph);
  if (share !== null) return share;
  const g = graph as Rec | null;
  if (g === null || typeof g !== 'object' || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
  const invalid = new Set(g.nodes.filter((n: Rec) => n.observed_state?.extra_share_by_date
    && capacityInputFailure(n.observed_state.extra_share_by_date) !== null).map((n: Rec) => n.id));
  if (invalid.size === 0) return null;
  return shareByDateGoalOf({ ...g,
    nodes: g.nodes.filter((n: Rec) => !invalid.has(n.id)).map((n: Rec) => n.kind === 'option'
      ? { ...n, interventions: Object.fromEntries(Object.entries(n.interventions ?? {}).filter(([id]) => !invalid.has(id))) } : n),
    edges: g.edges.filter((e: Rec) => !invalid.has(e.from) && !invalid.has(e.to)),
  });
}

/** The failing input is scoped to the option that uses it; date/range failures are global. */
export function shareChanceInputFailure(graph: unknown, optionId?: string): string | null {
  const blocked = shareChanceRunBlock(graph);
  if (blocked !== null) return blocked.words;
  const g = graph as Rec | null;
  if (g === null || typeof g !== 'object' || !Array.isArray(g.nodes)) return null;
  if (shareByDateGoalForChanceOf(graph) === null && !isEventShareForecast(graph)) return null;
  if (optionId === undefined) return null;
  const option = g.nodes.find((n: Rec) => n.kind === 'option' && n.id === optionId);
  for (const node of g.nodes) {
    const setting = option?.interventions?.[node.id], active = (typeof setting === 'number' ? setting : setting?.value) === 1;
    const extra = node?.observed_state?.extra_share_by_date;
    if (active && extra !== undefined) {
      const failure = capacityInputFailure(extra);
      if (failure !== null) return failure;
    }
  }
  return null;
}

/** The capacity carriers an option switches on, in the order of the goal's parts; null when there is no such option. */
function activeCarriersOf(g: Rec, share: NonNullable<ReturnType<typeof shareByDateGoalOf>>, optionId: string): Rec[] | null {
  const option = g.nodes.find((n: Rec) => n.id === optionId && n.kind === 'option');
  if (option === undefined) return null;
  return share.parts.filter(p => {
    const v = option.interventions[p.from];
    return p.from !== share.team_part_id && (typeof v === 'number' ? v : v?.value) === 1;
  }).map(p => g.nodes.find((n: Rec) => n.id === p.from).observed_state.extra_share_by_date);
}

export function sharePartsForOption(graph: unknown, optionId: string): ShareParts | null {
  if (shareChanceInputFailure(graph, optionId) !== null) return null;
  if (unresolvedEventOptionIds(graph).includes(optionId)) return null;
  const share = shareByDateGoalForChanceOf(graph);
  if (share === null) return null;
  const g = graph as Rec;
  const teamNode = g.nodes.find((n: Rec) => n.id === share.team_part_id);
  const team = statedTeamShareOf(teamNode, share.deadline, share.goal.goal_threshold_unit as string)!;
  const carriers = activeCarriersOf(g, share, optionId);
  if (carriers === null) return null;
  if (carriers.length === 0) return { team };
  const extras = carriers.map(c => {
    return { monthlyShare: c.monthly_share / 100,
      D: timeBetween(c.reference_date, share.deadline, 'months'), leadLow: c.lead_low, leadHigh: c.lead_high };
  });
  // Each started part keeps its own start; parts are summed, never averaged into one start.
  if (rangedPartCount(extras) > MAX_RANGED_PARTS) return null;
  const [extra, ...furtherExtras] = extras;
  return furtherExtras.length === 0 ? { team, extra } : { team, extra, furtherExtras };
}

/** Null means unsupported parts, never permission to display a point. */
export function shareGateForOption(graph: unknown, optionId: string, displayedPoint?: number,
  rounding: GoalChanceDisplayRounding = 'whole'): ShareGate | null {
  const share = shareByDateGoalForChanceOf(graph), parts = sharePartsForOption(graph, optionId);
  if (share === null || parts === null) return null;
  return gate(parts, share.threshold_raw / 100, displayedPoint, rounding);
}

/**
 * Per-option words: only the active capacity contributes an Olumi estimate. E5: whose each start figure is — the user's
 * stated start (quoted) or Olumi's estimate — so the provisional chance never presents one as the other.
 */
export function shareOptionEstimateWords(graph: unknown, optionId: string): string {
  const share = shareByDateGoalForChanceOf(graph), parts = sharePartsForOption(graph, optionId);
  if (share === null || parts?.extra === undefined) return '';
  const extras = extrasOf(parts), number = (n: number): string => n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const lead = (x: ExtraShare): string => x.leadLow === x.leadHigh ? number(x.leadLow) : `${number(x.leadLow)}–${number(x.leadHigh)}`;
  const deliverable = String(share.goal.goal_threshold_unit).replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, '');
  const starts = (activeCarriersOf(graph as Rec, share, optionId) ?? []).map(c => ({ lead_low: figureOf(c, 'lead_low')!, lead_high: figureOf(c, 'lead_high')! }));
  const quotes = [...new Set(starts.flatMap(s => [s.lead_low, s.lead_high].flatMap(f => f.origin === 'user' ? [f.quote!] : [])))];
  const paces = extras.map(x => number(x.monthlyShare * 100)).join('% + ');
  if (quotes.length === 0) {
    if (extras.length === 1) return `using Olumi's estimates of hiring time (${lead(extras[0]!)} months) and the new team's pace (${paces}% of ${deliverable} a month)`;
    return `using Olumi's estimates of hiring times (${extras.map(lead).join(' months, then ')} months) and the new team's pace (${paces}% of ${deliverable} a month)`;
  }
  const olumiLead = starts.flatMap(olumiStartBounds).map(b => `, Olumi’s estimate of the ${b.kind} start (${number(b.value)} months)`).join('');
  return `using your hiring time${quotes.length === 1 ? '' : 's'} (${quotes.join(', then ')})${olumiLead}, and Olumi’s estimate of the new team’s pace (${paces}% of ${deliverable} a month)`;
}
