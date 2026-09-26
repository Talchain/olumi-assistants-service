/**
 * ⭐ AX1 — WHEN THE ANALYSIS CANNOT RANK A PRICE × VOLUME GOAL, THE ARITHMETIC STILL ANSWERS (DL #70 5850280205:
 * "Paul's brief on the served build never gets an answer … When C46 withholds, the Agent still answers with exact
 * arithmetic on the stated or approved figures"; RED = DL's joined run `f-20260926T201724Z` 05-F8-run).
 *
 * C46 withholds a leader when the goal is a PRODUCT the engine adds up (`nonlinearIdentityForAgent`: the goal's own
 * `nonlinear_identity` carrier, e.g. MRR = Pro plan price × Pro paying subscribers). That identity is exact arithmetic,
 * so on the model's own figures it answers two questions the user asked without any ranking:
 *   · at each option's price, how many of today's subscribers must stay for the goal to be no lower than today;
 *   · how many subscribers each price needs to reach the goal's target.
 *
 * ⛔ NOT A RANKING AND NOT THE ENGINE'S. Nothing here says which option leads or what churn will do; every figure is one
 * the model holds, with whose it is (the user's, or Olumi's — adopted or not) said beside it, and the identity itself is
 * said as Olumi's reading unless the brief stated it. Pure: no network, no store; `null` whenever any input is missing,
 * inexact or in another unit — never an approximate answer.
 */
import { nonlinearIdentityForAgent } from './admit-model.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { deriveEmittedGoalDirection } from '../goal-target/goal-direction.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';

type Node = {
  id: string; kind?: string; label?: string;
  observed_state?: { value?: unknown; raw_value?: unknown; cap?: unknown; unit?: unknown; source?: unknown } | null;
  interventions?: Record<string, unknown>;
  goal_threshold_raw?: unknown; goal_threshold_unit?: unknown; goal_threshold_frame?: unknown;
  nonlinear_identity?: { stated_in_brief?: unknown } | null;
};

export type FigureBy = 'user' | 'approved' | 'olumi';

export interface BreakEvenOption {
  readonly option: string;
  readonly price: number;
  readonly price_by: FigureBy;
  /** Above today's price: the fewest subscribers for the goal to be no lower than today. */
  readonly keep_at_least?: number;
  /** Below today's price: the fewest subscribers for the goal to be no lower than today (more than today). */
  readonly need_at_least?: number;
}

export interface BreakEven {
  readonly goal: string;
  readonly price_factor: string;
  readonly volume_factor: string;
  readonly unit: string;
  readonly identity_stated_in_brief: boolean;
  readonly baseline_price: number;
  readonly baseline_price_by: FigureBy;
  readonly baseline_volume: number;
  readonly baseline_volume_by: FigureBy;
  readonly baseline_goal: number;
  readonly options: readonly BreakEvenOption[];
  /** The goal's target and, per price, the subscribers it needs (only when the target is in the price's own unit). */
  readonly target?: { readonly value: number; readonly needs: readonly { readonly price: number; readonly volume: number }[] };
}

/**
 * Whose figure it is, by the estate's ONE authorship rule (`classifyValueSource`) — never a second table here.
 * `user_ratified` (an estimate the user confirmed or approved as an assumption) is NOT the user's figure and is said
 * as approved; anything the rule cannot attribute (a repair, an unknown stamp) makes the whole answer `null`.
 */
const byOf = (source: unknown): FigureBy | null => {
  const provenance = classifyValueSource(source);
  if (provenance === 'user_stated') return 'user';
  if (provenance === 'user_ratified') return 'approved';
  if (provenance === 'ai_drafted') return 'olumi';
  return null;
};

/** A stored figure in the user's units, exactly: `raw_value`, or the model value on its range when that is exact. */
function exactRaw(stored: { value?: unknown; raw_value?: unknown } | null | undefined, cap: number | undefined): number | null {
  if (typeof stored?.raw_value === 'number' && Number.isFinite(stored.raw_value)) return stored.raw_value;
  if (typeof stored?.value !== 'number' || cap === undefined) return null;
  const raw = stored.value * cap;
  const cents = Math.round(raw * 100) / 100;
  return Math.abs(raw - cents) <= 1e-9 ? cents : null;
}

export function breakEvenFor(graph: unknown): BreakEven | null {
  const finding = nonlinearIdentityForAgent(graph, true);
  if (finding === null || finding.outcome_id !== finding.goal_id || finding.factor_ids.length !== 2) return null;
  // MG B2 (#2051 5850436075): "stays at least that" and "needs N" are a floor's words; a goal to REDUCE reads them
  // backwards (for a cap, N at £p is the most allowed). The estate's one direction authority decides; no answer otherwise.
  if (deriveEmittedGoalDirection(graph, finding.goal_id) === 'minimise') return null;
  const nodes = ((graph as { nodes?: unknown } | null)?.nodes ?? []) as Node[];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const goal = byId.get(finding.goal_id);
  const options = nodes.filter((n) => n.kind === 'option');
  // The price is the factor the options set; the volume is the other one.
  const [a, b] = finding.factor_ids as [string, string];
  const setBy = (f: string) => options.filter((o) => o.interventions !== undefined && f in o.interventions).length;
  const [priceId, volumeId] = setBy(a) > 0 && setBy(b) === 0 ? [a, b] : setBy(b) > 0 && setBy(a) === 0 ? [b, a] : [null, null];
  if (priceId === null || volumeId === null || goal === undefined) return null;
  const price = byId.get(priceId);
  const volume = byId.get(volumeId);
  const pos = price?.observed_state;
  const vos = volume?.observed_state;
  const cap = typeof pos?.cap === 'number' && pos.cap > 0 ? pos.cap : undefined;
  const p0 = exactRaw(pos, cap);
  const v0 = exactRaw(vos, undefined);
  const p0By = byOf(pos?.source);
  const v0By = byOf(vos?.source);
  const unit = typeof pos?.unit === 'string' ? pos.unit.trim() : '';
  if (p0 === null || v0 === null || p0By === null || v0By === null || !(p0 > 0) || !(v0 > 0) || unit === '') return null;
  // MG B3: the volume must be a COUNT with a stated unit — a rate (%, points, basis points) times a price is no revenue.
  const volumeUnit = typeof vos?.unit === 'string' ? vos.unit.trim() : '';
  if (volumeUnit === '' || classifyUnitScaleClass(volumeUnit) !== 'unknown') return null;
  const baselineGoal = p0 * v0;
  const rows: BreakEvenOption[] = [];
  for (const o of options) {
    const level = o.interventions?.[priceId];
    if (level === undefined) continue;
    const stored = (typeof level === 'number' ? { value: level } : level) as { value?: unknown; raw_value?: unknown; source?: unknown };
    const p = exactRaw(stored, cap);
    const by = byOf(stored.source);
    if (p === null || by === null || !(p > 0)) return null;
    const least = Math.ceil(baselineGoal / p - 1e-9);
    rows.push({
      option: o.label ?? o.id, price: p, price_by: by,
      ...(p > p0 ? { keep_at_least: least } : p < p0 ? { need_at_least: least } : {}),
    });
  }
  if (rows.length === 0) return null;
  const targetValue = goal.goal_threshold_raw;
  const targetUnit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit.trim() : '';
  const prices = [...new Set([...rows.map((r) => r.price), p0])].sort((x, y) => y - x);
  return {
    goal: goal.label ?? goal.id, price_factor: price!.label ?? priceId, volume_factor: volume!.label ?? volumeId, unit,
    identity_stated_in_brief: goal.nonlinear_identity?.stated_in_brief === true,
    baseline_price: p0, baseline_price_by: p0By, baseline_volume: v0, baseline_volume_by: v0By, baseline_goal: baselineGoal,
    options: rows,
    // MG B1: only a LEVEL target is an amount to reach; a delta ("grow MRR by £5k") is not, and an absent frame is not
    // assumed to be one.
    ...(goal.goal_threshold_frame === 'level' && typeof targetValue === 'number' && targetValue > 0 && targetUnit.toLowerCase() === unit.toLowerCase()
      ? { target: { value: targetValue, needs: prices.map((p) => ({ price: p, volume: Math.ceil(targetValue / p - 1e-9) })) } }
      : {}),
  };
}

const CURRENCY: Record<string, string> = { gbp: '£', usd: '$', eur: '€' };
/** A money figure in the price's unit ("GBP/month" → "£14,700/month"); otherwise the number and the unit. */
function money(n: number, unit: string): string {
  const m = /^(gbp|usd|eur)\s*(?:\/\s*(.+))?$/i.exec(unit);
  const digits = n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return m === null ? `${digits} ${unit}` : `${CURRENCY[m[1]!.toLowerCase()]}${digits}${m[2] !== undefined ? `/${m[2]}` : ''}`;
}
const whose = (by: FigureBy): string => (by === 'user' ? '' : by === 'approved' ? ' (an assumption you approved)' : ' (Olumi’s estimate)');
const count = (n: number): string => n.toLocaleString('en-GB');

/** The one paragraph the user reads (draft wording; AI Experience owns the words, MG reviews the maths). */
export function breakEvenLine(be: BreakEven): string {
  // The factor's own label, as the model spells it ("Pro paying subscribers": the plan name keeps its capital).
  const vol = be.volume_factor;
  const reading = be.identity_stated_in_brief ? '' : ` (Olumi’s reading of your goal)`;
  const parts: string[] = [
    `The arithmetic still answers part of this. If ${be.goal} is ${be.price_factor} × ${be.volume_factor}${reading}: at `
    + `${money(be.baseline_price, be.unit)}${whose(be.baseline_price_by)} and ${count(be.baseline_volume)} ${vol}${whose(be.baseline_volume_by)}, `
    + `${be.goal} is ${money(be.baseline_goal, be.unit)} today.`,
  ];
  for (const r of be.options) {
    if (r.keep_at_least !== undefined) {
      parts.push(`At ${money(r.price, be.unit)}${whose(r.price_by)}, ${be.goal} stays at least that while ${count(r.keep_at_least)} or more `
        + `of the ${count(be.baseline_volume)} stay (a loss of at most ${count(be.baseline_volume - r.keep_at_least)}).`);
    } else if (r.need_at_least !== undefined) {
      parts.push(`At ${money(r.price, be.unit)}${whose(r.price_by)}, it needs ${count(r.need_at_least)} or more (a gain of at least `
        + `${count(r.need_at_least - be.baseline_volume)}).`);
    }
  }
  if (be.target !== undefined) {
    const needs = be.target.needs.map((x) => `${count(x.volume)} at ${money(x.price, be.unit)}`);
    const list = needs.length === 1 ? needs[0]! : `${needs.slice(0, -1).join(', ')} or ${needs[needs.length - 1]!}`;
    parts.push(`${money(be.target.value, be.unit)} needs ${list}.`);
  }
  parts.push('This is arithmetic on these figures, not the analysis ranking the options, and it says nothing about how many will stay.');
  return parts.join(' ');
}
