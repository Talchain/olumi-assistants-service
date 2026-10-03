import { identityConflictsWithScope, nodesOf } from './goal-scope.js';
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
import { deriveEmittedGoalDirection, heldComparatorSense, readHeldGoalComparator } from '../goal-target/goal-direction.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import { totalUnitOfPerUnitPrice } from '../../cee/provenance/stated-amounts.js';
import { sayGoalChange } from './limit-frame.js';

type Node = {
  id: string; kind?: string; label?: string;
  observed_state?: { value?: unknown; raw_value?: unknown; cap?: unknown; unit?: unknown; source?: unknown } | null;
  interventions?: Record<string, unknown>;
  goal_threshold_raw?: unknown; goal_threshold_unit?: unknown; goal_threshold_frame?: unknown;
  nonlinear_identity?: { stated_in_brief?: unknown } | null;
};

export type FigureBy = 'user' | 'approved' | 'olumi';

export interface BreakEvenOption {
  /** The option's label, as the paragraph says it (its id when it has none). */
  readonly option: string;
  /** A5 (DL #70 5855437928): the graph option's id — labels collide and get renamed; ids do not. */
  readonly option_id: string;
  readonly price: number;
  readonly price_by: FigureBy;
  /** Above today's price: the fewest subscribers for the goal to be no lower than today. */
  readonly keep_at_least?: number;
  /** Below today's price: the fewest subscribers for the goal to be no lower than today (more than today). */
  readonly need_at_least?: number;
}

/**
 * The wire's `_agent.break_even`. Each named thing carries its LABEL (what the paragraph says) and, beside it, its
 * graph ID (A5, DL #70 5855437928) — a reader that needs to find the node must use the id, never the label.
 */
export interface BreakEven {
  readonly goal: string;
  readonly goal_id: string;
  readonly price_factor: string;
  readonly price_factor_id: string;
  readonly volume_factor: string;
  readonly volume_factor_id: string;
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

/**
 * `evaluated` (C46 × R3-4, Canonical criterion 1): the carriers the selected run's engine evaluated, as the graph read
 * carries them (`analysis_identity_evaluated_node_ids`). A product the engine computed is not one it "adds up", so no
 * arithmetic stands in for it. Omitted ⇒ today's reading, byte for byte.
 */
export function breakEvenFor(graph: unknown, evaluated?: ReadonlySet<string>): BreakEven | null {
  if (nodesOf(graph).some(n => n.kind === 'goal' && identityConflictsWithScope(n))) return null;
  const finding = nonlinearIdentityForAgent(graph, true, evaluated);
  if (finding === null || finding.outcome_id !== finding.goal_id || finding.factor_ids.length !== 2) return null;
  // MG B2 (#2051 5850436075): "stays at least that" and "needs N" are a floor's words; a goal to REDUCE reads them
  // backwards (for a cap, N at £p is the most allowed). The estate's one direction authority decides; no answer otherwise.
  // R1 S1: a held ceiling is silent here whether or not the wire can prove it a level (the words would read backwards).
  if (heldComparatorSense(readHeldGoalComparator(graph, finding.goal_id)) === 'minimise'
    || deriveEmittedGoalDirection(graph, finding.goal_id) === 'minimise') return null;
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
      option: o.label ?? o.id, option_id: o.id, price: p, price_by: by,
      ...(p > p0 ? { keep_at_least: least } : p < p0 ? { need_at_least: least } : {}),
    });
  }
  if (rows.length === 0) return null;
  const targetValue = goal.goal_threshold_raw;
  const targetUnit = typeof goal.goal_threshold_unit === 'string' ? goal.goal_threshold_unit.trim() : '';
  const prices = [...new Set([...rows.map((r) => r.price), p0])].sort((x, y) => y - x);
  return {
    goal: goal.label ?? goal.id, goal_id: goal.id,
    price_factor: price!.label ?? priceId, price_factor_id: priceId,
    volume_factor: volume!.label ?? volumeId, volume_factor_id: volumeId, unit,
    identity_stated_in_brief: goal.nonlinear_identity?.stated_in_brief === true,
    baseline_price: p0, baseline_price_by: p0By, baseline_volume: v0, baseline_volume_by: v0By, baseline_goal: baselineGoal,
    options: rows,
    // MG B1: only a LEVEL target is an amount to reach; a delta ("grow MRR by £5k") is not, and an absent frame is not
    // assumed to be one.
    // A target is a TOTAL, so it is compared with the total's unit: a per-subscriber price ("GBP/subscriber/month") still
    // meets a "GBP/month" target (served `263dbd5`: the £20,000 line was silently missing).
    ...(goal.goal_threshold_frame === 'level' && typeof targetValue === 'number' && targetValue > 0
      && targetUnit.toLowerCase() === totalUnitOfPerUnitPrice(unit).toLowerCase()
      ? { target: { value: targetValue, needs: prices.map((p) => ({ price: p, volume: Math.ceil(targetValue / p - 1e-9) })) } }
      : {}),
  };
}

/**
 * The symbol for an ISO code, DERIVED from the one currency vocabulary (`utils/currency-alphabet.ts`, ROADMAP 2.972) —
 * never a second list here (`currency-vocabulary.union.test.ts` forbids the mirror). The first symbol the map gives the
 * code wins; a code the map does not know is written as the unit itself.
 */
const symbolForCode = (code: string): string | undefined =>
  Object.entries(CURRENCY_SYMBOL_TO_CODE).find(([, c]) => c === code.toUpperCase())?.[0];

/**
 * A money figure in the price's unit ("GBP/month" → "£14,700/month"); otherwise the number and the unit. "GBP per month"
 * reads the same (served `0592c43`: the goal line said "20,000 GBP per month" beside the reply's own "£20k/month").
 */
function money(n: number, unit: string): string {
  const m = /^([A-Za-z]{3})\s*(?:(?:\/|\bper\s)\s*(.+))?$/i.exec(unit);
  const digits = n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const symbol = m === null ? undefined : symbolForCode(m[1]!);
  if (m === null || symbol === undefined) return `${digits} ${unit}`;
  // A lettered symbol reads with a space before the figure; a sign does not.
  // "seat per month" reads "seat/month": one separator, as the slash form writes it.
  return `${symbol}${/^[A-Za-z]+$/.test(symbol) ? ' ' : ''}${digits}${m[2] !== undefined ? `/${m[2].replace(/\s*\bper\s+/gi, '/')}` : ''}`;
}
const whose = (by: FigureBy): string => (by === 'user' ? '' : by === 'approved' ? ' (an assumption you approved)' : ' (Olumi’s estimate)');
/**
 * A count, said as a whole number (DL #72 5866480722; MG 5866456413): a re-derived estimate is stored as the exact
 * quotient (72,000 / 49 = 1,469.388…, so the identity holds exactly), and served run 3 said "1,469.388 Pro paying
 * subscribers" and "a loss of at most 248.388". A fractional count is said "about 1,469"; the stored level is untouched.
 */
const count = (n: number): string =>
  (Number.isInteger(n) ? n.toLocaleString('en-GB') : `about ${Math.round(n).toLocaleString('en-GB')}`);
/** "of the 1,300", or "of about 1,469" when the count is itself an estimate's quotient. */
const ofThe = (n: number): string => `of ${Number.isInteger(n) ? 'the ' : ''}${count(n)}`;

/** The one paragraph the user reads (draft wording; AI Experience owns the words, MG reviews the maths). */
export function breakEvenLine(be: BreakEven, opts: { readonly afterIdentityAsk?: boolean } = {}): string {
  // The factor's own label, as the model spells it ("Pro paying subscribers": the plan name keeps its capital).
  const vol = be.volume_factor;
  const reading = be.identity_stated_in_brief ? '' : ` (Olumi’s reading of your goal)`;
  // Prices are per unit; the goal and its target are totals, written without the per-unit denominator.
  const totalUnit = totalUnitOfPerUnitPrice(be.unit);
  const parts: string[] = [
    `${opts.afterIdentityAsk === true ? '' : 'The arithmetic still answers part of this. '}If ${be.goal} is ${be.price_factor} × ${be.volume_factor}${reading}: at `
    + `${money(be.baseline_price, be.unit)}${whose(be.baseline_price_by)} and ${count(be.baseline_volume)} ${vol}${whose(be.baseline_volume_by)}, `
    + `${be.goal} is ${money(be.baseline_goal, totalUnit)} today.`,
  ];
  for (const r of be.options) {
    if (r.keep_at_least !== undefined) {
      parts.push(`At ${money(r.price, be.unit)}${whose(r.price_by)}, ${be.goal} stays at least that while ${count(r.keep_at_least)} or more `
        + `${ofThe(be.baseline_volume)} stay (a loss of at most ${count(be.baseline_volume - r.keep_at_least)}).`);
    } else if (r.need_at_least !== undefined) {
      parts.push(`At ${money(r.price, be.unit)}${whose(r.price_by)}, it needs ${count(r.need_at_least)} or more (a gain of at least `
        + `${count(r.need_at_least - be.baseline_volume)}).`);
    }
  }
  if (be.target !== undefined) {
    const needs = be.target.needs.map((x) => `${count(x.volume)} at ${money(x.price, be.unit)}`);
    const list = needs.length === 1 ? needs[0]! : `${needs.slice(0, -1).join(', ')} or ${needs[needs.length - 1]!}`;
    parts.push(`${money(be.target.value, totalUnit)} needs ${list}.`);
  }
  parts.push('This is arithmetic on these figures, not the analysis ranking the options, and it says nothing about how many will stay.');
  return parts.join(' ');
}

/**
 * ⭐ ANSWER FIRST (served witness `6ff7bc9`, #70 5851078813; rubric ChatGPT 5850676864 "answer/finding first"): the
 * paragraph goes right after the reply's FIRST paragraph — the model's own lead ("Not yet…", "No option can be put
 * forward…") — so the user reads the limitation in one line and then the arithmetic, before the bullets, the save line
 * and the parked questions. A reply with one paragraph gets it at the end.
 */
export function withBreakEvenAnswer(text: string, be: BreakEven, opts: { readonly afterIdentityAsk?: boolean } = {}): string {
  const cut = text.indexOf('\n\n');
  const para = breakEvenLine(be, opts);
  return cut < 0 ? `${text}\n\n${para}` : `${text.slice(0, cut)}\n\n${para}${text.slice(cut)}`;
}

/**
 * ⭐ F3 (DL #70 5851710093; final witness `f-20260927T013636Z/01`): the user's headline goal vanished from the first
 * reply — the target was not scored (`GOAL_THRESHOLD_NOT_CONVERTIBLE`: the goal carries no current value to measure it
 * against) and neither the model nor the arithmetic named it. ONE deterministic clause names it and why, from the typed
 * reason on the run's own brief and the goal's stored target. `null` whenever the reason is absent or the target is not
 * a stated amount — never a guess.
 */
export function goalNotCheckedLine(graph: unknown, analysisResult: unknown): string | null {
  const brief = (analysisResult as { enrichment?: { decision_brief?: { warning_codes?: unknown; warnings?: unknown } } } | null | undefined)
    ?.enrichment?.decision_brief;
  const codes = [
    ...(Array.isArray(brief?.warning_codes) ? brief.warning_codes : []),
    ...(Array.isArray(brief?.warnings) ? brief.warnings.map((w) => (w as { code?: unknown } | null)?.code) : []),
  ];
  if (!codes.includes('GOAL_THRESHOLD_NOT_CONVERTIBLE')) return null;
  const goal = (((graph as { nodes?: unknown } | null)?.nodes ?? []) as Node[]).find((n) => n.kind === 'goal');
  const raw = goal?.goal_threshold_raw;
  const unit = typeof goal?.goal_threshold_unit === 'string' ? goal.goal_threshold_unit.trim() : '';
  if (goal === undefined || typeof raw !== 'number' || !Number.isFinite(raw) || unit === '') return null;
  const label = goal.label ?? goal.id;
  // R&C B1 (#2071): ISL mints this code for seven reasons, and "no current figure" is only one of them. The cause is said
  // ONLY when the graph itself shows it — the goal carries no current figure at all; otherwise the target is named with
  // no cause.
  const os = goal.observed_state;
  const hasCurrent = [os?.value, os?.raw_value, (os as { baseline?: unknown } | null | undefined)?.baseline]
    .some((v) => typeof v === 'number' && Number.isFinite(v));
  // R1 S4-core: a target stated as a change from today is said as the change, never "-0.15 GBP per month".
  const change = sayGoalChange(goal.goal_threshold_frame, raw, unit, (v, u) => money(v, u ?? ''), (goal as { goal_direction?: unknown }).goal_direction);
  const target = change === undefined ? `target of ${money(raw, unit)}` : `target (${change})`;
  return hasCurrent
    ? `Your ${label} ${target} was not checked in this analysis.`
    : `Your ${label} ${target} is not checked yet: the model has no current ${label} figure to measure it against.`;
}
