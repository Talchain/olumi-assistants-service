import type { RunDeltaGoalChanceSide } from '@talchain/schemas/boundary';
import { GOAL_FIGURES_WITHHELD_CODES } from '../../orchestrator/context/option-result-source.js';
import { agentLicenceRecordOf } from './goal-chance-licence.js';
import { GOAL_CHANCE_RANGE } from './goal-chance-range.js';
import { goalChanceRangeRecordOf } from './goal-chance-range-record.js';
import { goalChanceRangeBarredForAgent, runHasGoalChanceLicenceRecord } from './goal-chance-range-agent.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const pct = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
const rounding = (v: unknown): v is 'whole' | 'nearest_5' => v === 'whole' || v === 'nearest_5';

/** Each Run keeps its own stored display licence; raw probabilities never re-license an older Run. */
export function goalChanceSideOf(result: unknown, optionId: string): RunDeltaGoalChanceSide {
  const licence = agentLicenceRecordOf(result);
  const shown = rec(licence?.pct_by_option)?.[optionId];
  if (pct(shown)) {
    const step = rec(licence?.display_rounding_by_option)?.[optionId];
    return { kind: 'point', pct: shown, rounding: rounding(step) ? step : 'whole' };
  }

  const r = rec(result);
  const warnings = [rec(r?.enrichment)?.inference_warnings, r?.inference_warnings]
    .flatMap((v) => Array.isArray(v) ? v : []).map(rec).filter((v): v is Rec => v !== undefined);
  const ranges = warnings.filter((w) => w.code === GOAL_CHANCE_RANGE);
  const record = ranges.length === 1 ? goalChanceRangeRecordOf(ranges[0]) : undefined;
  const range = record?.option_ids.includes(optionId) ? record.range_by_option[optionId] : undefined;
  if (range !== undefined && !goalChanceRangeBarredForAgent(result, optionId)) {
    return { kind: 'range', low_pct: range.low_pct, high_pct: range.high_pct,
      low_rounding: range.low_rounding, high_rounding: range.high_rounding };
  }

  return runHasGoalChanceLicenceRecord(result) || ranges.length > 0
    || warnings.some((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code))
    ? { kind: 'withheld' } : { kind: 'not_recorded' };
}
