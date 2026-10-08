import { shareGoalChanceWords } from './share-goal-chance-words.js';
/** Agent-only readers of the selected Run's licences. No inference from figures or prose. */
import { GOAL_HORIZON_NOT_TESTED } from '../agent-lane/decision-input-ask.js';
import {
  GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_WITHHELD_CODES,
  GOAL_FIGURES_USER_EFFECT_CLAMPED, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
  GOAL_FIGURES_SHARE_APPROXIMATION,
} from '../../orchestrator/context/option-result-source.js';
import { agentLicenceRecordOf, goalChanceDisplayFromLicence, goalChanceLicenceForAgent, isLicensedDriver } from './goal-chance-licence.js';
import { GOAL_CHANCE_RANGE } from './goal-chance-range.js';
import { goalChanceRangeRecordOf } from './goal-chance-range-record.js';
import { SHARE_BY_DATE_UNIT, isShareCalendarDate } from './goal-kind.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const id = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(id) && new Set(v).size === v.length;

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
  readonly stated_time?: {
    readonly estimate: string;
    readonly by_date?: string;
    readonly deliverable?: string;
    readonly chance_words?: string;
    readonly slow_time?: string;
    readonly fast_time?: string;
  };
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
  const r = goalChanceRangeRecordOf(records[0]);
  if (r === undefined) return undefined;
  const optionIds = r.option_ids, ranges = r.range_by_option;
  const horizons = warningsOf(result).filter((w) => w.code === GOAL_HORIZON_NOT_TESTED);
  if (r.horizon_line !== undefined && horizons.some((w) => w.message !== r.horizon_line)) return undefined;
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && id(n.id) && id(n.label)).map((n) => [n.id as string, n.label as string]));
  const out: Record<string, GoalChanceRangeDisplay> = {};
  for (const optionId of optionIds) {
    const v = ranges[optionId]!;
    // ⛔ S2 review r1 #1 (Codex AMEND #87 6028260969): the SCREEN's words (DGAI `goalChanceRangeLine`): 0 is "less than 1%",
    // 100 is "more than 99%", the high end drops its "about"; an unresolved link label drops the line, never a raw id.
    const fromLabel = labels.get(v.from);
    const toLabel = labels.get(v.to);
    if (fromLabel === undefined || toLabel === undefined) continue;
    const target = rec(r.target);
    const source = (Array.isArray(nodes) ? nodes : []).map(rec).find(n => n?.id === v.from);
    const stated = rec(rec(source?.observed_state)?.stated_time);
    const time = v.quantity === 'months_to_finish';
    const hasEstimate = stated !== undefined && stated.quantity === v.quantity && typeof stated.low === 'number' && Number.isFinite(stated.low)
      && typeof stated.high === 'number' && Number.isFinite(stated.high) && stated.high >= stated.low;
    const estimateUnit = time ? ' months' : typeof stated?.unit === 'string'
      ? `${stated.unit.startsWith('%') ? '' : ' '}${stated.unit}` : ' per month';
    const estimate = hasEstimate
      ? `${(stated.low as number).toLocaleString('en-GB')}–${(stated.high as number).toLocaleString('en-GB')}${estimateUnit}`
      : time ? 'time estimate' : 'pace estimate';
    Object.defineProperty(out, optionId, { enumerable: true, configurable: true, value: {
      range: `between ${rangeEnd(v.low_pct)} and ${rangeEnd(v.high_pct).replace(/^about /, '')}`,
      depends_on: { kind: v.kind, from_label: fromLabel, to_label: toLabel, among: v.among },
      ...(v.kind === 'stated_time' ? { stated_time: { estimate,
        ...(time && hasEstimate ? { slow_time: `${stated.high} months`, fast_time: `${stated.low} months` } : {}),
        ...(typeof target?.unit === 'string' && SHARE_BY_DATE_UNIT.test(target.unit)
          ? { deliverable: target.unit.replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, ''),
            ...(isShareCalendarDate(target.by_date) ? { chance_words: shareGoalChanceWords(
              target.unit.replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, ''), target.by_date) } : {}) } : {}),
        ...(isShareCalendarDate(target?.by_date) ? { by_date: target.by_date } : {}) } } : {}),
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
  return goalChanceWithholdWarningsForOption(result, optionId).length > 0;
}

function goalChanceWithholdWarningsForOption(result: unknown, optionId: string): Rec[] {
  return warningsOf(result).filter((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code)
    && (w.code === GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED || w.code === GOAL_FIGURES_USER_EFFECT_CLAMPED
      || !ids(w.option_ids) || w.option_ids.includes(optionId)));
}

export interface RecordedGoalChanceWithholdReason {
  readonly code: string;
  /** Stored producer wording only; null when the Run recorded no wording. */
  readonly message: string | null;
}

/** The point predicate's SAME scoped warnings, exposed without reconstructing their cause. */
export function goalChanceWithheldReasonsForAgent(result: unknown, optionId: string): RecordedGoalChanceWithholdReason[] {
  const reasons = goalChanceWithholdWarningsForOption(result, optionId).map(w => ({
    code: w.code as string, message: typeof w.message === 'string' ? w.message : null,
  }));
  // Some retained licences attest withholding without a cause. Preserve that
  // distinction from "none"; this marker explicitly claims no recorded cause.
  return reasons.length > 0 ? reasons : goalChanceLicenceForAgent(result)?.withheld_option_ids?.includes(optionId)
    ? [{ code: 'reason_not_recorded', message: null }] : [];
}

/**
 * Codex AMEND (#87 6028220756, DL accepted): a range exists BECAUSE its option's point figure was withheld for an unsized
 * path, and PR-S1 writes one only beside `GOAL_FIGURES_PLACEHOLDER_PATH` or `GOAL_FIGURES_TARGET_NOT_TESTABLE`. Those two
 * never bar the range; every other withhold (PLoT's run-wide pair, product not read, options identical, probability
 * unusable) still does, with the point predicate's own scope.
 */
const RANGE_COMPATIBLE_WITHHOLDS: ReadonlySet<string> = new Set([GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_SHARE_APPROXIMATION]);
export function goalChanceRangeBarredForAgent(result: unknown, optionId: string): boolean {
  return goalChanceWithholdWarningsForOption(result, optionId).some(w => !RANGE_COMPATIBLE_WITHHOLDS.has(w.code as string));
}

/** The licensed point chances actually shown; ranges and scoped withholds keep their existing entitlement. */
function pointDisplayForAgent(result: unknown, ranges: Record<string, GoalChanceRangeDisplay> | undefined,
  licence: Rec | undefined = agentLicenceRecordOf(result)): Record<string, string> {
  if (licence === undefined) return {};
  return Object.fromEntries(Object.entries(goalChanceDisplayFromLicence(licence) ?? {})
    .filter(([optionId]) => !goalChanceOptionWithheldForAgent(result, optionId) && !Object.hasOwn(ranges ?? {}, optionId)));
}

/** The screen's licensed drivers in option order; shared by its sentences and the estimate actions. */
export function goalChanceDriversForAgent(result: unknown, graph: unknown): { option_id: string; driver: Rec }[] {
  const licence = agentLicenceRecordOf(result);
  if (licence === undefined) return [];
  const display = pointDisplayForAgent(result, goalChanceRangeDisplayForAgent(result, graph), licence);
  const drivers = rec(licence.driver_by_option) ?? {};
  const absent = rec(licence.no_driver_by_option) ?? {};
  return (licence.option_ids as string[]).flatMap(optionId => {
    if (!Object.hasOwn(display, optionId) || !Object.hasOwn(drivers, optionId) || absent[optionId] !== undefined) return [];
    const d = rec(drivers[optionId]);
    return d !== undefined && isLicensedDriver(d) ? [{ option_id: optionId, driver: d }] : [];
  });
}

/** Screen's ruled driver sentences, from the selected Run's stored licence only; never from raw driver rows. */
export function goalChanceDriverDisplayForAgent(result: unknown, graph: unknown): Record<string, string> {
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && id(n.id) && id(n.label)).map((n) => [n.id as string, n.label as string]));
  const about = (v: unknown): string => v === 0 ? 'less than 1%' : v === 100 ? 'more than 99%' : `about ${v}%`;
  const asked = new Set<string>();
  const out: Record<string, string> = {};
  for (const { option_id: optionId, driver: d } of goalChanceDriversForAgent(result, graph)) {
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

/**
 * ⭐ THE HEADLINE'S "WHAT WOULD CHANGE IT" (#87 6 Oct ruling: chance + uncertainty + driver + what would change it; DL ruling
 * on #2840, 8 Oct; Science §(n).3). ONE line for the Run's face (COPY-SHAPE slot 2), naming only the licensed CHANCE driver
 * the screen's own "It rests most on …" sentence names, never the outcome-sensitivity leader and never a share of runs.
 * One unscoped clause ONLY when every option with a chance on screen (point or range) rests on the same driver; otherwise
 * one per option that has a driver, in licence order, and an option with no driver gets nothing (DL #2840 review P1-2).
 * `null` when no option's chance driver speaks (a withheld chance is silent).
 */
export function whatChangesFaceLine(result: unknown, graph: unknown): string | null {
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && id(n.id) && id(n.label)).map((n) => [n.id as string, n.label as string]));
  const speaks = goalChanceDriverDisplayForAgent(result, graph);
  const ranges = goalChanceRangeDisplayForAgent(result, graph);
  const shown = [...Object.keys(pointDisplayForAgent(result, ranges)), ...Object.keys(ranges ?? {})];
  const clauses: { option_id: string; key: string; clause: string }[] = [];
  for (const { option_id: optionId, driver: d } of goalChanceDriversForAgent(result, graph)) {
    if (!Object.hasOwn(speaks, optionId)) continue;
    if (d.kind === 'factor_value') {
      const label = labels.get(d.factor_id as string);
      if (label !== undefined) clauses.push({ option_id: optionId, key: `factor:${d.factor_id}`, clause: `the value of ‘${label}’` });
      continue;
    }
    const from = labels.get(d.from as string);
    const to = labels.get(d.to as string);
    if (from === undefined || to === undefined) continue;
    clauses.push(d.kind === 'link_strength'
      ? { option_id: optionId, key: `strength:${d.from}->${d.to}`, clause: `how strongly ‘${from}’ affects ‘${to}’` }
      : { option_id: optionId, key: `existence:${d.from}->${d.to}`, clause: `whether ‘${from}’ really affects ‘${to}’` });
  }
  if (clauses.length === 0) return null;
  if (clauses.every((c) => c.key === clauses[0].key) && shown.every((o) => clauses.some((c) => c.option_id === o))) {
    return `What would change it: ${clauses[0].clause}.`;
  }
  const optionLabel = (optionId: string): string => labels.get(optionId) ?? optionId;
  if (clauses.some((c) => !labels.has(c.option_id))) return null; // never an id in the user's words
  return `What would change it: ${clauses.map((c) => `for ‘${optionLabel(c.option_id)}’, ${c.clause}`).join('; ')}.`;
}

/** The two Agent doors read the same per-option entitlement, independently of permission to name a leader. */
export function goalChanceFactsForAgent(result: unknown, graph: unknown, current: boolean): {
  goal_chance_licence?: ReturnType<typeof goalChanceLicenceForAgent>;
  goal_chance_display?: Record<string, string>;
  goal_chance_driver_display?: Record<string, string>;
  goal_chance_range_display?: Record<string, GoalChanceRangeDisplay>;
  goal_chance_words?: string;
  goal_horizon_line?: string;
} {
  if (!current) return {};
  const licence = goalChanceLicenceForAgent(result);
  const ranges = goalChanceRangeDisplayForAgent(result, graph);
  const rangeDisplay = Object.fromEntries(Object.entries(ranges ?? {})
    .filter(([optionId]) => !goalChanceRangeBarredForAgent(result, optionId)));
  const display = pointDisplayForAgent(result, ranges);
  const hasChance = Object.keys(display).length > 0;
  const target = rec(agentLicenceRecordOf(result)?.target);
  const shareWords = hasChance && typeof target?.unit === 'string' && SHARE_BY_DATE_UNIT.test(target.unit) && isShareCalendarDate(target.by_date)
    ? shareGoalChanceWords(target.unit.replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, ''), target.by_date) : undefined;
  const drivers = hasChance ? goalChanceDriverDisplayForAgent(result, graph) : {};
  const hasRange = Object.keys(rangeDisplay).length > 0;
  const horizon = warningsOf(result).filter((w) => w.code === GOAL_HORIZON_NOT_TESTED);
  const line = horizon.length === 1 && horizon[0]!.severity === 'info' && id(horizon[0]!.message) ? horizon[0]!.message : undefined;
  return {
    ...(hasChance ? { goal_chance_licence: licence, goal_chance_display: display } : {}),
    ...(shareWords !== undefined ? { goal_chance_words: shareWords } : {}),
    ...(Object.keys(drivers).length > 0 ? { goal_chance_driver_display: drivers } : {}),
    ...(hasRange ? { goal_chance_range_display: rangeDisplay } : {}),
    ...((hasChance || hasRange) && line !== undefined ? { goal_horizon_line: line } : {}),
  };
}
