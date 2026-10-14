/** S2a Run-only frame attestation and per-option mathematical licence input. */
import { draftedTeamPartOf, eventShareCarrierOf, isEventShareForecast, unresolvedEventOptionIds } from './event-by-date-model.js';
import { goalDeadlineFromRecord, shareByDateGoalOf, soleGoalOf, statedTeamShareOf } from './goal-kind.js';
import { timeBetween, todayInLondon } from './deadline-date.js';
import { extrasOf, gate, MAX_RANGED_PARTS, rangedPartCount, type ExtraShare, type ShareGate, type ShareParts } from './event-by-date-share.js';
import { hiringTimesLabel } from './hiring-times.js';
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
    // AIE 6122738619's meaning (DL, 12 Oct): the hires' ADDITIONAL progress, never "the new team's pace" (the whole team).
    return "Not shown. Olumi's estimate of the additional progress from the hires is not usable. State it from 0% to 100% of the work per month.";
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

/** The capacity parts an option switches on, in the order of the goal's parts; null when there is no such option. */
function activePartsOf(g: Rec, share: NonNullable<ReturnType<typeof shareByDateGoalOf>>, optionId: string): Rec[] | null {
  const option = g.nodes.find((n: Rec) => n.id === optionId && n.kind === 'option');
  if (option === undefined) return null;
  return share.parts.filter(p => {
    const v = option.interventions[p.from];
    return p.from !== share.team_part_id && (typeof v === 'number' ? v : v?.value) === 1;
  }).map(p => g.nodes.find((n: Rec) => n.id === p.from));
}

/**
 * ⭐ E-TAIL (b), AIE 6130197656 §2, EXACT LABEL: said once beside the chances when a licensed option's hire link was limited to
 * the whole deliverable on Olumi's own pace (`extraShareLinkMoments`; the carrier's `link_limit`, Olumi's assumption).
 */
export const OLUMI_HIRE_LIMIT_NOTE = "Olumi's provisional modelling estimate limits typical extra progress from these hires to 100% of the launch. "
  + 'The bell-curve analysis can still simulate values outside that figure.';
/** True when any active hire part of these options rests on Olumi's limit (`link_limit.origin === 'olumi_assumption'`). */
export function hireLinkLimitedFor(graph: unknown, optionIds: readonly string[]): boolean {
  const share = shareByDateGoalForChanceOf(graph);
  if (share === null) return false;
  return optionIds.some(id => (activePartsOf(graph as Rec, share, id) ?? [])
    .some(n => n?.observed_state?.extra_share_by_date?.link_limit?.origin === 'olumi_assumption'));
}

export function sharePartsForOption(graph: unknown, optionId: string): ShareParts | null {
  if (shareChanceInputFailure(graph, optionId) !== null) return null;
  if (unresolvedEventOptionIds(graph).includes(optionId)) return null;
  const share = shareByDateGoalForChanceOf(graph);
  if (share === null) return null;
  const g = graph as Rec;
  const teamNode = g.nodes.find((n: Rec) => n.id === share.team_part_id);
  const team = statedTeamShareOf(teamNode, share.deadline, share.goal.goal_threshold_unit as string)!;
  const active = activePartsOf(g, share, optionId);
  if (active === null) return null;
  if (active.length === 0) return { team };
  const extras = active.map(n => {
    const c = n.observed_state.extra_share_by_date;
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
 * EBD E2: the team's time when its range is Olumi's assumption from the user's single forecast (`range_origin`), else null.
 * The ONE reader every sentence about that range uses, so none calls Olumi's range the user's (AIE 6122738619).
 */
export function olumiAssumedTeamRange(graph: unknown): { readonly forecast: number; readonly low: number; readonly high: number } | null {
  const share = shareByDateGoalForChanceOf(graph);
  const stated = share === null ? undefined : (graph as Rec).nodes.find((n: Rec) => n.id === share.team_part_id)?.observed_state?.stated_time;
  return stated?.range_origin === 'olumi_estimate' && [stated.forecast, stated.low, stated.high].every(v => typeof v === 'number' && Number.isFinite(v))
    ? { forecast: stated.forecast, low: stated.low, high: stated.high } : null;
}
const months = (n: number): string => n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
/**
 * The team part of the provisional chance attribution, after "using ". AIE 6125204695 (b1), verbatim: the engine's chance is a
 * bell-curve approximation built from the range's moments (`recovery/bB/ebd-law/DIAGNOSIS.md`), never "all times in the range
 * equally likely" (withdrawn for b1). The forecast and its words stay the user's; the range and the approximation are Olumi's.
 */
export function olumiAssumedRangeAttribution(t: { readonly forecast: number; readonly low: number; readonly high: number }): string {
  return `your ${months(t.forecast)}-month forecast and Olumi’s bell-curve approximation based on an assumed ${months(t.low)}–${months(t.high)}-month range`;
}
/**
 * AIE 6125204695 (b1), verbatim: the timing-range note. It describes the INPUT range, never a probability interval, and never
 * says the range covers a fixed fraction or "most runs" (the engine samples derived progress, not completion times).
 */
export function olumiAssumedRangeLine(t: { readonly forecast: number; readonly low: number; readonly high: number }): string {
  return `You gave ${months(t.forecast)} months. Olumi’s assumed ${months(t.low)}–${months(t.high)}-month range informs this approximate calculation; `
    + 'modelled outcomes can fall outside those time bounds.';
}

/**
 * Per-option words: the user's forecast with Olumi's assumed range on every option (EBD E2; `withoutTeam`: the range line,
 * which says that range in its own sentence), then the option's hiring timings (E5 r2): where a start carries the user's
 * own statement, the words quote it and say every assumption Olumi made from it (`hiringTimesLabel`); a construction-only
 * option keeps Olumi's own words (AIE 6122738619: the additional progress from the hires, never "the new team's pace").
 */
export function shareOptionEstimateWords(graph: unknown, optionId: string, opts: { readonly withoutTeam?: boolean } = {}): string {
  const share = shareByDateGoalForChanceOf(graph), parts = sharePartsForOption(graph, optionId);
  if (share === null || parts === null) return '';
  // EBD E2: a team time held as Olumi's assumption from the user's single forecast is attributed as that on every option.
  const assumed = opts.withoutTeam === true ? null : olumiAssumedTeamRange(graph);
  const team = assumed === null ? '' : olumiAssumedRangeAttribution(assumed);
  if (parts.extra === undefined) return team === '' ? '' : `using ${team}`;
  const extras = extrasOf(parts);
  const lead = (x: ExtraShare): string => x.leadLow === x.leadHigh ? months(x.leadLow) : `${months(x.leadLow)}–${months(x.leadHigh)}`;
  const deliverable = String(share.goal.goal_threshold_unit).replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, '');
  const yours = hiringTimesLabel(activePartsOf(graph as Rec, share, optionId) ?? [], deliverable);
  const hires = yours !== '' ? yours : extras.length === 1
    ? `Olumi’s estimates of hiring time (${lead(extras[0]!)} months) and of the additional progress from the hires (${months(extras[0]!.monthlyShare * 100)}% of ${deliverable} per month)`
    : `Olumi’s estimates of hiring times (${extras.map(lead).join(' months, then ')} months) and of the additional progress from the hires (${months(extras.reduce((t, x) => t + x.monthlyShare * 100, 0))}% of ${deliverable} per month, split equally between the two starts)`;
  return `using ${team === '' ? '' : `${team}, and `}${hires}`;
}
