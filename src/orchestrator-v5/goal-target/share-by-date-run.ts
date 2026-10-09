/** S2a Run-only frame attestation and per-option mathematical licence input. */
import { draftedTeamPartOf, eventShareCarrierOf, isEventShareForecast, unresolvedEventOptionIds } from './event-by-date-model.js';
import { goalDeadlineFromRecord, shareByDateGoalOf, soleGoalOf, statedTeamShareOf } from './goal-kind.js';
import { timeBetween, todayInLondon } from './deadline-date.js';
import { gate, type ShareGate, type ShareParts } from './event-by-date-share.js';
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

export function sharePartsForOption(graph: unknown, optionId: string): ShareParts | null {
  if (shareChanceInputFailure(graph, optionId) !== null) return null;
  if (unresolvedEventOptionIds(graph).includes(optionId)) return null;
  const share = shareByDateGoalForChanceOf(graph);
  if (share === null) return null;
  const g = graph as Rec;
  const teamNode = g.nodes.find((n: Rec) => n.id === share.team_part_id);
  const team = statedTeamShareOf(teamNode, share.deadline, share.goal.goal_threshold_unit as string)!;
  const option = g.nodes.find((n: Rec) => n.id === optionId && n.kind === 'option');
  if (option === undefined) return null;
  const active = share.parts.filter(p => {
    const v = option.interventions[p.from];
    return p.from !== share.team_part_id && (typeof v === 'number' ? v : v?.value) === 1;
  });
  if (active.length > 1) return null;
  if (active.length === 0) return { team };
  const c = g.nodes.find((n: Rec) => n.id === active[0]!.from).observed_state.extra_share_by_date;
  return { team, extra: { monthlyShare: c.monthly_share / 100,
    D: timeBetween(c.reference_date, share.deadline, 'months'), leadLow: c.lead_low, leadHigh: c.lead_high } };
}

/** Null means unsupported parts, never permission to display a point. */
export function shareGateForOption(graph: unknown, optionId: string, displayedPoint?: number,
  rounding: GoalChanceDisplayRounding = 'whole'): ShareGate | null {
  const share = shareByDateGoalForChanceOf(graph), parts = sharePartsForOption(graph, optionId);
  if (share === null || parts === null) return null;
  return gate(parts, share.threshold_raw / 100, displayedPoint, rounding);
}

/** Per-option words: only the active capacity contributes an Olumi estimate. */
export function shareOptionEstimateWords(graph: unknown, optionId: string): string {
  const share = shareByDateGoalForChanceOf(graph), parts = sharePartsForOption(graph, optionId);
  if (share === null || parts?.extra === undefined) return '';
  const extra = parts.extra, number = (n: number): string => n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const lead = extra.leadLow === extra.leadHigh ? number(extra.leadLow) : `${number(extra.leadLow)}–${number(extra.leadHigh)}`;
  const deliverable = String(share.goal.goal_threshold_unit).replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, '');
  return `using Olumi's estimates of hiring time (${lead} months) and the new team's pace (${number(extra.monthlyShare * 100)}% of ${deliverable} a month)`;
}
