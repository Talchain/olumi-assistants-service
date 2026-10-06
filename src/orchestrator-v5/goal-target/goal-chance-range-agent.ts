/** Agent-only readers of the selected Run's licences. No inference from figures or prose. */
import { GOAL_HORIZON_NOT_TESTED } from '../agent-lane/decision-input-ask.js';
import {
  GOAL_FIGURES_WITHHELD_CODES, GOAL_FIGURES_USER_EFFECT_CLAMPED, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
} from '../../orchestrator/context/option-result-source.js';
import { goalChanceDisplayForAgent, goalChanceLicenceForAgent } from './goal-chance-licence.js';
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

export interface GoalChanceRangeDisplay {
  readonly range: string;
  readonly depends_on: {
    readonly kind: 'link_strength' | 'link_existence';
    readonly from_label: string;
    readonly to_label: string;
    readonly among: 'all' | 'unsized_links';
  };
}

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
      || (v.kind !== 'link_strength' && v.kind !== 'link_existence') || !id(v.from) || !id(v.to) || v.from === v.to
      || (v.among !== 'all' && v.among !== 'unsized_links')) return undefined;
    Object.defineProperty(out, optionId, { enumerable: true, configurable: true, value: {
      range: `between about ${v.low_pct}% and ${v.high_pct}%`,
      depends_on: { kind: v.kind, from_label: labels.get(v.from) ?? v.from, to_label: labels.get(v.to) ?? v.to, among: v.among },
    } });
  }
  return out;
}

/** Scoped withholds remove only their own options; PLoT #416/#422 always withhold the whole Run. */
export function goalChanceOptionWithheldForAgent(result: unknown, optionId: string): boolean {
  return warningsOf(result).some((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code)
    && (w.code === GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED || w.code === GOAL_FIGURES_USER_EFFECT_CLAMPED
      || !ids(w.option_ids) || w.option_ids.includes(optionId)));
}

/** The two Agent doors read the same per-option entitlement, independently of permission to name a leader. */
export function goalChanceFactsForAgent(result: unknown, graph: unknown, current: boolean): {
  goal_chance_licence?: ReturnType<typeof goalChanceLicenceForAgent>;
  goal_chance_display?: Record<string, string>;
  goal_chance_range_display?: Record<string, GoalChanceRangeDisplay>;
  goal_horizon_line?: string;
} {
  if (!current) return {};
  const licence = goalChanceLicenceForAgent(result);
  const ranges = goalChanceRangeDisplayForAgent(result, graph);
  const rangeDisplay = Object.fromEntries(Object.entries(ranges ?? {})
    .filter(([optionId]) => !goalChanceOptionWithheldForAgent(result, optionId)));
  const withheld = new Set(licence?.withheld_option_ids ?? []);
  const display = Object.fromEntries(Object.entries(goalChanceDisplayForAgent(result) ?? {})
    .filter(([optionId]) => licence?.option_ids.includes(optionId) && !withheld.has(optionId)
      && !goalChanceOptionWithheldForAgent(result, optionId) && !Object.hasOwn(ranges ?? {}, optionId)));
  const hasChance = Object.keys(display).length > 0;
  const hasRange = Object.keys(rangeDisplay).length > 0;
  const horizon = warningsOf(result).filter((w) => w.code === GOAL_HORIZON_NOT_TESTED);
  const line = horizon.length === 1 && horizon[0]!.severity === 'info' && id(horizon[0]!.message) ? horizon[0]!.message : undefined;
  return {
    ...(hasChance ? { goal_chance_licence: licence, goal_chance_display: display } : {}),
    ...(hasRange ? { goal_chance_range_display: rangeDisplay } : {}),
    ...((hasChance || hasRange) && line !== undefined ? { goal_horizon_line: line } : {}),
  };
}
