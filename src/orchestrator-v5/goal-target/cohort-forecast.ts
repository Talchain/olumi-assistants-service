/**
 * ⭐ AIE LAWS RULING, SAME COHORT (13 Oct) — marketing's two targets scored on ONE cohort (science PR-4; ISL #234, PLoT #450).
 *
 * "Conversion over 15% and 20 new customers within the first three months after launch". When the user says the new customers
 * come from the same people the conversion rate is measured on, both targets count ONE cohort: an option reaches E people over
 * the window, each converts with the cohort's propensity p ~ Beta (from the conversion's likely range, read as the middle half),
 * N ~ Binomial(E, p) people convert, and the realised rate is N / E on the SAME draw. ISL scores each target and their joint on
 * those draws (`options[].target_forecast` → `option_comparison[].target_forecast`); nothing is multiplied and no independence
 * is assumed. This file reads the option's stored forecast and builds that wire block; `goal-targets-joint.ts` licenses the
 * result. Pure, and imports nothing that imports it.
 *
 * ⛔ Never sent without the user's same-cohort answer, a likely range with low < high, a whole number of people, and EXACTLY the
 * two target rows that answer names (a percent rate and a whole-number count, both levels). Anything else: no block, and the
 * Run's coaching stays.
 */
import { NodeV3 } from '../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface CohortForecast {
  readonly people_reached: number;
  readonly conversion_middle_half_pct: readonly [number, number];
  readonly same_cohort: { readonly rate_target_node_id: string; readonly count_target_node_id: string; readonly stated_by: 'user' };
  readonly author: 'user' | 'olumi';
}

/** The option node's stored forecast, or `undefined` (absent or malformed: a malformed record is absence). */
export function readCohortForecast(node: unknown): CohortForecast | undefined {
  if (!isRec(node) || node.kind !== 'option') return undefined;
  const parsed = NodeV3.shape.cohort_forecast.safeParse(node.cohort_forecast);
  return parsed.success && parsed.data !== undefined ? parsed.data : undefined;
}

export type CohortQuantity = 'rate' | 'count';

export interface CohortTarget {
  readonly row: Rec & { readonly constraint_id: string; readonly node_id: string; readonly value: number };
  readonly quantity: CohortQuantity;
  /** What ISL compares, in its units: a rate as a fraction of the cohort, a count in people. */
  readonly threshold: number;
}

/**
 * The two target rows the forecast scores, bound by the user's same-cohort answer, or `undefined`. `targetRows` are the stored
 * rows marked as the goal's targets: there must be exactly two, and they must be the two that answer names.
 */
export function cohortTargetsOf(targetRows: readonly unknown[], f: CohortForecast): readonly [CohortTarget, CohortTarget] | undefined {
  const rows = targetRows.filter(isRec);
  if (rows.length !== 2 || rows.length !== targetRows.length) return undefined;
  const level = (r: Rec): boolean => r.value_frame === undefined || r.value_frame === 'level';
  const bound = (r: Rec | undefined): r is CohortTarget['row'] => r !== undefined && typeof r.constraint_id === 'string'
    && typeof r.node_id === 'string' && finite(r.value) && level(r);
  const rate = rows.find((r) => r.node_id === f.same_cohort.rate_target_node_id);
  const count = rows.find((r) => r.node_id === f.same_cohort.count_target_node_id);
  if (!bound(rate) || !bound(count) || rate === count) return undefined;
  // The rate is a percentage of the cohort; the count is whole people. Nothing else is read as either.
  if (typeof rate.unit !== 'string' || rate.unit.trim() !== '%' || rate.value < 0 || rate.value > 100) return undefined;
  if (!Number.isInteger(count.value) || count.value < 0) return undefined;
  return [{ row: rate, quantity: 'rate', threshold: rate.value / 100 }, { row: count, quantity: 'count', threshold: count.value }];
}

/** ISL `SameCohortTargetForecast`, as PLoT forwards it. */
export interface TargetForecastWire {
  readonly law: 'same_cohort_beta_binomial';
  readonly exposure: number;
  readonly rate_quartiles: readonly [number, number];
  readonly conditions: readonly { readonly constraint_id: string; readonly quantity: CohortQuantity; readonly threshold: number }[];
}

/** The quartiles ISL fits the propensity to: the middle half, as fractions. One conversion, used by the wire and the licence. */
export function rateQuartilesOf(f: CohortForecast): readonly [number, number] {
  return [f.conversion_middle_half_pct[0] / 100, f.conversion_middle_half_pct[1] / 100];
}

/** The option's wire block, or `undefined` when it holds no usable forecast for exactly these targets. */
export function targetForecastWireOf(optionNode: unknown, targetRows: readonly unknown[]): TargetForecastWire | undefined {
  const f = readCohortForecast(optionNode);
  if (f === undefined) return undefined;
  const targets = cohortTargetsOf(targetRows, f);
  if (targets === undefined) return undefined;
  return {
    law: 'same_cohort_beta_binomial',
    exposure: f.people_reached,
    rate_quartiles: rateQuartilesOf(f),
    conditions: targets.map((t) => ({ constraint_id: t.row.constraint_id, quantity: t.quantity, threshold: t.threshold })),
  };
}
