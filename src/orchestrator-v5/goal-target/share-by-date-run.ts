/** S2a Run-only frame attestation and per-option mathematical licence input. */
import { draftedTeamPartOf, eventShareCarrierOf, isEventShareForecast, unresolvedEventOptionIds } from './event-by-date-model.js';
import { goalDeadlineFromRecord, shareByDateGoalOf, soleGoalOf, statedTeamShareOf } from './goal-kind.js';
import { sayDate, timeBetween, todayInLondon } from './deadline-date.js';
import { capacityRatioScale, exactChance, extrasOf, gate, MAX_RANGED_PARTS, rangedPartCount, type ExtraShare, type ShareGate, type ShareParts } from './event-by-date-share.js';
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
  if (typeof extra.capacity_ratio === 'number') {
    // AIE 6175233964: an uncertain start, a ramp or a random ratio has no supported joint law here, so it fails closed.
    if (extra.lead_low !== extra.lead_high) {
      return "Not shown. This option's start is given as a range, and this forecast can't yet work out a capacity change with an uncertain start. Say when it would take full effect.";
    }
    // PL 6135017311 item 3: the ratio is compiled from the saved figures; an unreadable one, or one that slows the team, fails closed.
    if (Array.isArray(extra.ratio_source_owner_unknown) && extra.ratio_source_owner_unknown.length > 0) {
      const names = (extra.ratio_source_owner_unknown as unknown[]).map((l) => `‘${String(l)}’`).join(' and ');
      return `Not shown. This option's effect is worked out from ${names}, and the model doesn't record whether that figure is yours or `
        + `Olumi's estimate. Confirm or edit ${names} to show this option's chance.`;
    }
    if (extra.ratio_source_unreadable === true) {
      return "Not shown. This option's effect is worked out from the model's capacity figures, and one of them is missing or unreadable now.";
    }
    if (Number.isFinite(extra.capacity_ratio) && extra.capacity_ratio < 1) {
      return `Not shown. With the model's current figures this option lowers the team's capacity (to ${Math.round(extra.capacity_ratio * 100)}% of today), `
        + "and this deadline forecast doesn't yet model an option that slows the team down.";
    }
    // A capacity-ratio carrier (L3): sized only from today's team time; until then, no chance rests on it.
    return Number.isFinite(extra.capacity_ratio) && extra.capacity_ratio >= 1 && extra.ratio_sizing?.rule === 'marginal_normal' ? null
      : "Not shown yet. This option's effect is worked out from today's team time to finish, which the model doesn't hold yet.";
  }
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
  // One mechanism per option (DL ruling): a capacity-ratio part stands alone.
  const ratioParts = active.filter(n => typeof n?.observed_state?.extra_share_by_date?.capacity_ratio === 'number');
  if (ratioParts.length > 0) {
    if (ratioParts.length !== 1 || active.length !== 1) return null;
    // The window's scale k for this fixed ratio and its start (AIE 6175233964); null (an uncertain start) shows no chance.
    const c = ratioParts[0]!.observed_state.extra_share_by_date;
    const k = capacityRatioScale(c.capacity_ratio, timeBetween(c.reference_date, share.deadline, 'months'), c.lead_low, c.lead_high);
    return k === null ? null : { team, ratio: k };
  }
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
  if (parts.ratio !== undefined) {
    const ratioWords = capacityRatioWords(activePartsOf(graph as Rec, share, optionId)?.[0]);
    return `using ${[team, ratioWords].filter(w => w !== '').join(', and ')}`;
  }
  if (parts.extra === undefined) return team === '' ? '' : `using ${team}`;
  const extras = extrasOf(parts);
  const lead = (x: ExtraShare): string => x.leadLow === x.leadHigh ? months(x.leadLow) : `${months(x.leadLow)}–${months(x.leadHigh)}`;
  const deliverable = deliverableOf(share);
  const yours = hiringTimesLabel(activePartsOf(graph as Rec, share, optionId) ?? [], deliverable);
  const hires = yours !== '' ? yours : extras.length === 1
    ? `Olumi’s estimates of hiring time (${lead(extras[0]!)} months) and of the additional progress from the hires (${months(extras[0]!.monthlyShare * 100)}% of ${deliverable} per month)`
    : `Olumi’s estimates of hiring times (${extras.map(lead).join(' months, then ')} months) and of the additional progress from the hires (${months(extras.reduce((t, x) => t + x.monthlyShare * 100, 0))}% of ${deliverable} per month, split equally between the two starts)`;
  return `using ${team === '' ? '' : `${team}, and `}${hires}`;
}

/**
 * What a capacity-ratio chance rests on, after "using " (DL condition 3): the identity, as Olumi's reading unless the brief
 * states it, and each of the option's settings that is Olumi's proposal. Never calls Olumi's reading or setting the user's.
 */
/**
 * What a capacity-ratio chance rests on, each part attributed (AIE 6174736249 (d), 6175233964): the identity (the brief's, or
 * Olumi's reading), any factor Olumi worked out rather than the brief stated (with the assumption it rests on), Olumi's
 * proposed settings, and Olumi's provisional assumption that delivery pace changes in proportion to capacity from when the
 * change takes full effect.
 */
export function capacityRatioWords(part: Rec | undefined): string {
  const c = part?.observed_state?.extra_share_by_date, basis = c?.ratio_basis;
  if (!basis || !Array.isArray(basis.factors)) return '';
  const q = (label: unknown): string => `‘${String(label)}’`;
  const withUnit = (value: unknown, unit: unknown): string =>
    `${months(Number(value))}${typeof unit === 'string' && unit !== '' ? (unit.startsWith('%') ? unit : ` ${unit}`) : ''}`;
  const identity = `${q(basis.capacity)} = ${basis.factors.map((f: Rec) => q(f.label)).join(' × ')}`;
  const derived = basis.factors.flatMap((f: Rec) => f.derived !== null && typeof f.derived === 'object' ? [f.derived.split_with !== undefined
    ? `${q(f.label)} at ${withUnit(f.today, f.unit)} today, worked out on Olumi’s assumption that the time is split only between it and ${q(f.derived.split_with)}`
    : `${q(f.label)} at ${withUnit(f.today, f.unit)} today, worked out by Olumi from ${q(f.derived.from)}`]
    : f.estimated === true ? [`${q(f.label)} at ${withUnit(f.today, f.unit)} today, Olumi’s estimate`] : []);
  const reading = `${basis.identity_stated === true ? `your brief’s ${identity}` : `Olumi’s reading that ${identity}`}`
    + (derived.length === 0 ? '' : ` (with ${derived.join('; ')})`);
  const olumis = (Array.isArray(basis.settings) ? basis.settings : []).filter((x: Rec) => x.olumis === true)
    .map((x: Rec) => `${q(x.label)} at ${withUnit(x.value, x.unit)}`);
  const lead = typeof c.lead_low === 'number' && c.lead_low > 0 ? `from ${months(c.lead_low)} months in` : 'from now';
  const pace = `Olumi’s provisional assumption that delivery pace changes in proportion to ${q(basis.capacity)} ${lead}`;
  return [reading, ...(olumis.length === 0 ? [] : [`Olumi’s proposed setting of ${olumis.join(' and ')}`]), pace]
    .reduce((acc, w, i, all) => i === 0 ? w : `${acc}${i === all.length - 1 ? ', and ' : ', '}${w}`, '');
}

/** The options whose active part is a capacity-ratio carrier (one mechanism per option), in graph order. */
export function capacityRatioOptionIds(graph: unknown): string[] {
  const g = graph as Rec | null;
  if (g === null || typeof g !== 'object' || !Array.isArray(g.nodes)) return [];
  const ratioNodes = new Set(g.nodes.filter((n: Rec) => typeof n?.observed_state?.extra_share_by_date?.capacity_ratio === 'number').map((n: Rec) => n.id));
  return g.nodes.filter((n: Rec) => n.kind === 'option' && Object.entries(n.interventions ?? {})
    .some(([id, v]) => ratioNodes.has(id) && (typeof v === 'number' ? v : (v as Rec)?.value) === 1)).map((n: Rec) => n.id as string);
}

/**
 * DL condition 2 (ruling (A)): a ratio option's link is drawn beside the team part, not as the same draw, so a run-by-run
 * comparison with any other option is distorted (it would let the option lose to carrying on, impossible when r > 1). The
 * win share and leader are withheld; this says why, once. Each option's own chance stays: under the model's Normal
 * approximation it matches k × the team's share, for a fixed k (AIE 6175233964).
 */
export const CAPACITY_RATIO_COMPARISON_NOTE = 'Which option comes out ahead most often isn’t shown: an option worked out from the team’s own '
  + 'capacity can’t yet be compared run by run with the others. Each option’s chance is unaffected.';
/** PL L3: what a capacity-ratio chance leaves out, said once beside it. */
export const CAPACITY_RATIO_ASSUMPTION_NOTE = 'For an option worked out from the team’s own capacity, the chance leaves out any slowdown '
  + 'while the change beds in.';

/**
 * PL 6135017311 item 1 (bounds beat the tail): a capacity-ratio option whose BEST case (the team's soonest stated time, at
 * the window's scale k) still finishes short of the target cannot reach it in this model. The Normal approximation would
 * still give a small tail chance there; that figure is an artefact, so no chance is shown and the arithmetic is said.
 */
export function capacityRatioOutOfReach(graph: unknown, optionId: string): string | null {
  const share = shareByDateGoalForChanceOf(graph), parts = sharePartsForOption(graph, optionId);
  if (share === null || parts === null || parts.ratio === undefined || parts.team.quantity !== 'months_to_finish') return null;
  const threshold = share.threshold_raw / 100;
  let exact: number;
  try { exact = exactChance(parts, threshold); } catch { return null; }
  if (exact > 0) return null;
  const { D, low } = parts.team, k = parts.ratio;
  // ⛔ PL (14 Oct, wrong-author class): "your own soonest estimate" only for the user's OWN verified hard lower bound.
  // An Olumi endpoint (an assumed range, a lone-point convention) is never their minimum: no out-of-reach claim, and the
  // engine's approximate result stands with its own label.
  if (!humanHardLowerBound(graph, share.team_part_id, low)) return null;
  const part = activePartsOf(graph as Rec, share, optionId)?.[0];
  const lead = part?.observed_state?.extra_share_by_date?.lead_low;
  const deliverable = deliverableOf(share);
  const best = Math.floor(Math.min(1, (k * D) / low) * 100);
  const oneDp = (n: number): string => n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  const arithmetic = lead === 0
    ? ` (${months(low)} months of work at ${Math.round(k * 100)}% of today’s capacity is still about ${oneDp(low / k)} months, past the ${oneDp(D)} months to the deadline)`
    : '';
  return `No chance is shown for this option: on your own soonest estimate it can’t reach ${months(share.threshold_raw)}% of ${deliverable} `
    + `by ${sayDate(share.deadline)}. Even at ${months(low)} months, it gets about ${best}% done by then${arithmetic}.`;
}

/** The share goal's deliverable ("next feature launch" from "% of next feature launch"): one read of the goal's unit. */
function deliverableOf(share: { readonly goal: Rec }): string {
  return String(share.goal.goal_threshold_unit).replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, '');
}

/**
 * The user's own HARD lower bound on the team's time, verified (S2 `statements` on the team part's stated time): spoken by
 * the user, about months to finish, in months, a lower bound (or a range's lower end), unqualified, not negated, and equal
 * to the part's soonest time. Nothing else is their minimum.
 */
function humanHardLowerBound(graph: unknown, teamId: string, low: number): boolean {
  const g = graph as Rec | null;
  const statements = g?.nodes?.find((n: Rec) => n?.id === teamId)?.observed_state?.stated_time?.statements;
  return Array.isArray(statements) && statements.some((s: Rec) => s?.speaker === 'user' && s.subject?.quantity === 'months_to_finish'
    && s.unit === 'months' && (s.form === 'lower_bound' || s.form === 'range') && s.low === low
    && s.qualifier === undefined && s.negated !== true);
}
