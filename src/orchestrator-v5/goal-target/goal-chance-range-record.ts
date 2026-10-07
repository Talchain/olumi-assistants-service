/** Shared validation of stored range licences, for Agent and run_delta readers. */
import type { GoalChanceRange } from './goal-chance-range.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const id = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const pct = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
const rounding = (v: unknown): boolean => v === 'whole' || v === 'nearest_5';

/** Includes the stated-time basis, original quantity and exact endpoint agreement. */
function validRange(v: unknown): v is GoalChanceRange {
  const r = rec(v);
  if (r === undefined || !pct(r.low_pct) || !pct(r.high_pct) || r.low_pct >= r.high_pct
    || !rounding(r.low_rounding) || !rounding(r.high_rounding)
    || (r.low_rounding === 'nearest_5' && r.low_pct % 5 !== 0) || (r.high_rounding === 'nearest_5' && r.high_pct % 5 !== 0)
    || (r.kind !== 'link_strength' && r.kind !== 'link_existence' && r.kind !== 'stated_time')
    || !id(r.from) || !id(r.to) || r.from === r.to || (r.among !== 'all' && r.among !== 'unsized_links')) return false;
  const estimate = rec(r.stated_estimate);
  const validEstimate = estimate !== undefined && typeof estimate.low === 'number' && Number.isFinite(estimate.low)
    && typeof estimate.high === 'number' && Number.isFinite(estimate.high) && estimate.low >= 0 && estimate.high >= estimate.low
    && (r.quantity === 'months_to_finish' ? estimate.low > 0 && estimate.unit === 'months'
      : typeof estimate.unit === 'string' && estimate.unit.startsWith('% of ')
        && estimate.unit.endsWith(' per month') && estimate.unit.length > '% of  per month'.length);
  return r.kind !== 'stated_time' || (validEstimate && r.basis === 'stated_time'
    && (r.quantity === 'months_to_finish' || r.quantity === 'share_per_month')
    && typeof r.low === 'number' && typeof r.high === 'number' && Number.isFinite(r.low) && Number.isFinite(r.high)
    && r.low >= 0 && r.high <= 1 && r.low <= r.high
    && Math.round(r.low * 100) === r.low_pct && Math.round(r.high * 100) === r.high_pct);
}

export type GoalChanceRangeRecord = Rec & {
  option_ids: string[];
  range_by_option: Record<string, GoalChanceRange>;
  horizon_line?: string;
};

/** One bad entry invalidates the record at every figure-reading door. */
export function goalChanceRangeRecordOf(value: unknown): GoalChanceRangeRecord | undefined {
  const r = rec(value), ranges = rec(r?.range_by_option), ids = r?.option_ids;
  if (r === undefined || r.code !== 'GOAL_CHANCE_RANGE' || r.severity !== 'info' || !id(r.message)
    || !Array.isArray(ids) || ids.length === 0 || !ids.every(id) || new Set(ids).size !== ids.length
    || ranges === undefined || Object.keys(ranges).length !== ids.length || !Object.keys(ranges).every(k => ids.includes(k))
    || !Object.values(ranges).every(validRange)
    || (r.horizon_untested !== undefined && r.horizon_untested !== true)
    || (r.horizon_line !== undefined && (r.horizon_untested !== true || !id(r.horizon_line)))) return undefined;
  return r as GoalChanceRangeRecord;
}
