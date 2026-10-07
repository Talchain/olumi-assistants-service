/** Agent-only readers of the selected Run's licences. No inference from figures or prose. */
import { GOAL_HORIZON_NOT_TESTED } from '../agent-lane/decision-input-ask.js';
import {
  GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_WITHHELD_CODES,
  GOAL_FIGURES_USER_EFFECT_CLAMPED, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
  GOAL_FIGURES_SHARE_APPROXIMATION,
} from '../../orchestrator/context/option-result-source.js';
import { agentLicenceRecordOf, goalChanceDisplayForAgent, goalChanceLicenceForAgent, isLicensedDriver } from './goal-chance-licence.js';
import { GOAL_CHANCE_RANGE } from './goal-chance-range.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const id = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(id) && new Set(v).size === v.length;
const pct = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
const rounding = (v: unknown): boolean => v === 'whole' || v === 'nearest_5';

function warningsOf(result: unknown): Rec[] {
  const r = rec(result);
  return [rec(r?.enrichment)?.inference_warnings, r?.inference_warnings]
    .flatMap((v) => Array.isArray(v) ? v : []).map(rec).filter((v): v is Rec => v !== undefined);
}

/**
 * A Run served before #2625 carries no GOAL_CHANCE_LICENSED record at all: its chances keep the rules they were built
 * under (W3 leader rule on the saved-Run door; the run-wide withhold on the run door). ANY record by that code — even a
 * malformed or duplicated one — makes the Run licensed-era, so a broken licence fails closed instead of falling back.
 */
export function runHasGoalChanceLicenceRecord(result: unknown): boolean {
  return warningsOf(result).some((w) => w.code === 'GOAL_CHANCE_LICENSED');
}

export interface GoalChanceRangeDisplay {
  readonly range: string;
  readonly depends_on: {
    readonly kind: 'link_strength' | 'link_existence' | 'stated_time';
    readonly from_label: string;
    readonly to_label: string;
    readonly among: 'all' | 'unsized_links';
  };
}

const rangeEnd = (v: number): string => v === 0 ? 'less than 1%' : v === 100 ? 'more than 99%' : `about ${v}%`;

/** PR-S1's carrier (`GOAL_CHANCE_RANGE`), read by its code. Conflicting records fail closed. */
export function goalChanceRangeDisplayForAgent(result: unknown, graph: unknown): Record<string, GoalChanceRangeDisplay> | undefined {
  const records = warningsOf(result).filter((w) => w.code === GOAL_CHANCE_RANGE);
  if (records.length !== 1) return undefined;
  const r = records[0]!;
  const optionIds = r.option_ids;
  const ranges = rec(r.range_by_option);
  if (r.severity !== 'info' || !id(r.message) || !ids(optionIds) || ranges === undefined
    || Object.keys(ranges).length !== optionIds.length || !Object.keys(ranges).every((k) => optionIds.includes(k))
    || (r.horizon_untested !== undefined && r.horizon_untested !== true)
    || (r.horizon_line !== undefined && (r.horizon_untested !== true || !id(r.horizon_line)))) return undefined;
  const horizons = warningsOf(result).filter((w) => w.code === GOAL_HORIZON_NOT_TESTED);
  if (r.horizon_line !== undefined && horizons.some((w) => w.message !== r.horizon_line)) return undefined;
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && id(n.id) && id(n.label)).map((n) => [n.id as string, n.label as string]));
  const out: Record<string, GoalChanceRangeDisplay> = {};
  for (const optionId of optionIds) {
    const v = Object.hasOwn(ranges, optionId) ? rec(ranges[optionId]) : undefined;
    if (v === undefined || !pct(v.low_pct) || !pct(v.high_pct) || v.low_pct >= v.high_pct
      || !rounding(v.low_rounding) || !rounding(v.high_rounding)
      || (v.low_rounding === 'nearest_5' && v.low_pct % 5 !== 0) || (v.high_rounding === 'nearest_5' && v.high_pct % 5 !== 0)
      || (v.kind !== 'link_strength' && v.kind !== 'link_existence' && v.kind !== 'stated_time') || !id(v.from) || !id(v.to) || v.from === v.to
      || (v.among !== 'all' && v.among !== 'unsized_links')) return undefined;
    if (v.kind === 'stated_time' && (v.basis !== 'stated_time'
      || (v.quantity !== 'months_to_finish' && v.quantity !== 'share_per_month')
      || typeof v.low !== 'number' || typeof v.high !== 'number' || !Number.isFinite(v.low) || !Number.isFinite(v.high)
      || v.low < 0 || v.high > 1 || v.low > v.high
      || Math.round(v.low * 100) !== v.low_pct || Math.round(v.high * 100) !== v.high_pct)) return undefined;
    // ⛔ S2 review r1 #1 (Codex AMEND #87 6028260969): the SCREEN's words (DGAI `goalChanceRangeLine`): 0 is "less than 1%",
    // 100 is "more than 99%", the high end drops its "about"; an unresolved link label drops the line, never a raw id.
    const fromLabel = labels.get(v.from);
    const toLabel = labels.get(v.to);
    if (fromLabel === undefined || toLabel === undefined) continue;
    Object.defineProperty(out, optionId, { enumerable: true, configurable: true, value: {
      range: `between ${rangeEnd(v.low_pct)} and ${rangeEnd(v.high_pct).replace(/^about /, '')}`,
      depends_on: { kind: v.kind, from_label: fromLabel, to_label: toLabel, among: v.among },
    } });
  }
  return out;
}

/**
 * S2 review r1 #4: the run-turn door must read the graph's labels whenever the chat could say a ruled sentence that names
 * nodes: a range record, or a licence that carries `driver_by_option` (else a Run whose leader may be named lost "It rests
 * most on …" while the screen said it).
 */
export function goalChanceNeedsGraphLabels(result: unknown): boolean {
  if (warningsOf(result).some((w) => w.code === GOAL_CHANCE_RANGE)) return true;
  const drivers = rec(agentLicenceRecordOf(result)?.driver_by_option);
  return drivers !== undefined && Object.keys(drivers).length > 0;
}

/** Scoped withholds remove only their own options; PLoT #416/#422 always withhold the whole Run. */
export function goalChanceOptionWithheldForAgent(result: unknown, optionId: string): boolean {
  return warningsOf(result).some((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code)
    && (w.code === GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED || w.code === GOAL_FIGURES_USER_EFFECT_CLAMPED
      || !ids(w.option_ids) || w.option_ids.includes(optionId)));
}

/**
 * Codex AMEND (#87 6028220756, DL accepted): a range exists BECAUSE its option's point figure was withheld for an unsized
 * path, and PR-S1 writes one only beside `GOAL_FIGURES_PLACEHOLDER_PATH` or `GOAL_FIGURES_TARGET_NOT_TESTABLE`. Those two
 * never bar the range; every other withhold (PLoT's run-wide pair, product not read, options identical, probability
 * unusable) still does, with the point predicate's own scope.
 */
const RANGE_COMPATIBLE_WITHHOLDS: ReadonlySet<string> = new Set([GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_SHARE_APPROXIMATION]);
export function goalChanceRangeBarredForAgent(result: unknown, optionId: string): boolean {
  return warningsOf(result).some((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code)
    && !RANGE_COMPATIBLE_WITHHOLDS.has(w.code)
    && (w.code === GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED || w.code === GOAL_FIGURES_USER_EFFECT_CLAMPED
      || !ids(w.option_ids) || w.option_ids.includes(optionId)));
}

/** The licensed point chances actually shown; ranges and scoped withholds keep their existing entitlement. */
function pointDisplayForAgent(result: unknown, ranges: Record<string, GoalChanceRangeDisplay> | undefined): Record<string, string> {
  const licence = goalChanceLicenceForAgent(result);
  const withheld = new Set(licence?.withheld_option_ids ?? []);
  return Object.fromEntries(Object.entries(goalChanceDisplayForAgent(result) ?? {})
    .filter(([optionId]) => licence?.option_ids.includes(optionId) && !withheld.has(optionId)
      && !goalChanceOptionWithheldForAgent(result, optionId) && !Object.hasOwn(ranges ?? {}, optionId)));
}

/** Screen's ruled driver sentences, from the selected Run's stored licence only; never from raw driver rows. */
export function goalChanceDriverDisplayForAgent(result: unknown, graph: unknown): Record<string, string> {
  const licence = agentLicenceRecordOf(result);
  if (licence === undefined) return {};
  const display = pointDisplayForAgent(result, goalChanceRangeDisplayForAgent(result, graph));
  const drivers = rec(licence.driver_by_option) ?? {};
  const absent = rec(licence.no_driver_by_option) ?? {};
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && id(n.id) && id(n.label)).map((n) => [n.id as string, n.label as string]));
  const about = (v: unknown): string => v === 0 ? 'less than 1%' : v === 100 ? 'more than 99%' : `about ${v}%`;
  const asked = new Set<string>();
  const out: Record<string, string> = {};
  for (const optionId of licence.option_ids as string[]) {
    if (!Object.hasOwn(display, optionId) || !Object.hasOwn(drivers, optionId) || absent[optionId] !== undefined) continue;
    const d = rec(drivers[optionId]);
    if (d === undefined || !isLicensedDriver(d)) continue;
    let line: string;
    let question: string | undefined;
    let key: string | undefined;
    if (d.kind === 'factor_value') {
      const label = labels.get(d.factor_id as string);
      if (label === undefined) continue;
      const cut = `${(d.cut_value as number).toLocaleString('en-GB')} ${typeof d.cut_unit === 'string' ? d.cut_unit : ''}`.trim();
      const falls = `if it is ${d.side === 'low' ? 'below' : 'above'} ${cut}, the chance falls to ${about(d.pct_if_side)}.`;
      line = d.authored_by === 'olumi'
        ? `It rests most on ‘${label}’, using a range Olumi assumed: ${falls}`
        : `It rests most on ‘${label}’: ${falls}`;
      if (d.authored_by === 'olumi') { key = `factor:${d.factor_id}`; question = ' Do you know it more precisely?'; }
    } else {
      const from = labels.get(d.from as string);
      const to = labels.get(d.to as string);
      if (from === undefined || to === undefined) continue;
      if (d.kind === 'link_strength') {
        if (d.authored_by === 'olumi') {
          line = `It rests most on Olumi’s own estimate of how strongly ‘${from}’ affects ‘${to}’: if that effect is ${d.strength} than Olumi assumed, the chance falls.`;
          question = ' Is that estimate right?';
        } else if (d.authored_by === 'user') {
          line = `It rests most on how strongly ‘${from}’ affects ‘${to}’, at the size you set: if that effect is ${d.strength} than that, the chance falls.`;
          question = ' How sure are you of that size?';
        } else {
          line = `It rests most on how strongly ‘${from}’ affects ‘${to}’: if that effect is ${d.strength} than this model assumes, the chance falls.`;
        }
        if (question !== undefined) key = `strength:${d.from}->${d.to}`;
      } else {
        if (d.authored_by !== 'olumi' || d.side !== 'absent') continue;
        if (d.user_stated_link === true) {
          line = `It rests most on your link from ‘${from}’ to ‘${to}’: Olumi’s model also allows that it does not hold, and in those runs the chance is ${about(d.pct_if_side)}.`;
        } else {
          line = `It rests most on Olumi’s own assumption that ‘${from}’ affects ‘${to}’: in the model runs without that link, the chance is ${about(d.pct_if_side)}.`;
          key = `existence:${d.from}->${d.to}`; question = ' Is that right?';
        }
      }
    }
    if (key !== undefined && !asked.has(key)) { line += question; asked.add(key); }
    Object.defineProperty(out, optionId, { enumerable: true, configurable: true, value: line });
  }
  return out;
}

/** The two Agent doors read the same per-option entitlement, independently of permission to name a leader. */
export function goalChanceFactsForAgent(result: unknown, graph: unknown, current: boolean): {
  goal_chance_licence?: ReturnType<typeof goalChanceLicenceForAgent>;
  goal_chance_display?: Record<string, string>;
  goal_chance_driver_display?: Record<string, string>;
  goal_chance_range_display?: Record<string, GoalChanceRangeDisplay>;
  goal_horizon_line?: string;
} {
  if (!current) return {};
  const licence = goalChanceLicenceForAgent(result);
  const ranges = goalChanceRangeDisplayForAgent(result, graph);
  const rangeDisplay = Object.fromEntries(Object.entries(ranges ?? {})
    .filter(([optionId]) => !goalChanceRangeBarredForAgent(result, optionId)));
  const display = pointDisplayForAgent(result, ranges);
  const hasChance = Object.keys(display).length > 0;
  const drivers = hasChance ? goalChanceDriverDisplayForAgent(result, graph) : {};
  const hasRange = Object.keys(rangeDisplay).length > 0;
  const horizon = warningsOf(result).filter((w) => w.code === GOAL_HORIZON_NOT_TESTED);
  const line = horizon.length === 1 && horizon[0]!.severity === 'info' && id(horizon[0]!.message) ? horizon[0]!.message : undefined;
  return {
    ...(hasChance ? { goal_chance_licence: licence, goal_chance_display: display } : {}),
    ...(Object.keys(drivers).length > 0 ? { goal_chance_driver_display: drivers } : {}),
    ...(hasRange ? { goal_chance_range_display: rangeDisplay } : {}),
    ...((hasChance || hasRange) && line !== undefined ? { goal_horizon_line: line } : {}),
  };
}
