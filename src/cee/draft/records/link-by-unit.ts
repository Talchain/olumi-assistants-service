/**
 * ⭐ FIX (b): THE DETERMINISTIC LINKING PASS BY UNIT — runs in the records compile BEFORE projection.
 *
 * The live 3×3 (5 Oct) left the v-next grammar's linking fields null (goal.baseline_ref 8/15, goal.unit 9/15,
 * figure.quantity 22/64, cause.relationship 25/58, goal.direction 15/15). A NULL link is resolved here ONLY by TYPED
 * UNIT (`sameUnit`, the one unit authority) and typed references (`quantity`, `baseline_ref`). Exactly one candidate
 * binds; zero or several becomes a TYPED ASK (a dropped row with an ask reason → an `asked` receipt row + an open
 * question), never a guess.
 *
 * ⛔ NEVER LABEL, TOKEN OR WORDING MATCHING. Nothing here reads `source_quote` or a claim `label`. The only text read
 * is a UNIT (through the unit readers) and, when the goal declares no unit at all, its own `value_literal` through the
 * existing amount reader (`findStatedAmounts`), which reads a currency or a percent and nothing else.
 *
 * ⛔ SCIENCE GUARD (Lead, 5 Oct), binding:
 *   1. Bind ONLY on a DIMENSIONED unit: currency, time, mass, or a NAMED count noun ("developers"). %, ratio, a bare
 *      count, dimensionless or "units" are shared by unrelated quantities, so "exactly one candidate" is luck there:
 *      always an ask (`unitIsDimensioned`).
 *   2. goal.direction is NEVER resolved by this pass: it is the user's objective, not a unit fact. A goal with a stated
 *      target and no direction is a typed ask.
 *   3. Every binding is recorded with `bound_by: 'unit_unique'` (or `'baseline_ref'` for a unit inherited through an
 *      existing typed reference). ⚠ That marker has NO carrier on the PLoT request today (`input_snapshot` is the
 *      `@talchain/schemas` RunInputSnapshot contract, which records no goal baseline and no binding marker), so it is
 *      returned to the caller only; see the build report for the smallest carrier.
 */
import { readCountRate, readMoney, sameUnit, singular, words } from '../../../orchestrator-v5/agent-lane/same-unit.js';
import { findStatedAmounts } from '../../provenance/stated-amounts.js';
import type { DraftRecordSet, DraftStatedItem } from './grammar.js';
import { classifyUnitScaleClass } from './unit-scale-class.js';

/** The typed asks this pass raises. Each lands on a stated index; none carries a value. */
export const UNIT_LINK_ASK_REASONS = [
  /** A goal with a stated target and no baseline_ref, and no single dimensioned same-unit baseline figure. */
  'goal_baseline_unlinked',
  /** A baseline figure that is one of SEVERAL same-unit candidates for a goal's baseline. */
  'goal_baseline_candidate_ambiguous',
  /** A baseline figure with no quantity identity and no single dimensioned same-unit quantity to bind to. */
  'figure_quantity_unlinked',
  /** A goal with a stated target and no direction (Science guard 2: never derived). */
  'goal_direction_unstated',
  /** A stated cause with no typed relationship: it stays unsized (no size invented). */
  'cause_relationship_unstated',
] as const;
export type UnitLinkAskReason = (typeof UNIT_LINK_ASK_REASONS)[number];
const ASK_REASONS: ReadonlySet<string> = new Set(UNIT_LINK_ASK_REASONS);
export function isUnitLinkAskReason(reason: unknown): reason is UnitLinkAskReason {
  return typeof reason === 'string' && ASK_REASONS.has(reason);
}

export interface UnitLinkBinding {
  readonly stated_index: number;
  readonly field: 'baseline_ref' | 'quantity' | 'unit';
  readonly bound_to: number | string;
  /** Science guard 3: the binding is Olumi's, the figure stays the user's. */
  readonly bound_by: 'unit_unique' | 'baseline_ref';
}
export interface UnitLinkAsk {
  readonly stated_index: number;
  readonly reason: UnitLinkAskReason;
  /** The candidate stated indices that were considered (several = ambiguous; none = zero). */
  readonly candidates: readonly number[];
}
export interface UnitLinkResult {
  readonly records: DraftRecordSet;
  readonly bindings: readonly UnitLinkBinding[];
  readonly asks: readonly UnitLinkAsk[];
  /** Science guard 1: binds a unit-unique reading would have made, refused because the unit is not dimensioned. */
  readonly generic_unit_refusals: number;
}

const TIME_UNITS = new Set(['second', 'minute', 'hour', 'day', 'week', 'month', 'year', 'quarter', 'fortnight']);
const MASS_UNITS = new Set(['g', 'gram', 'kg', 'kilogram', 'tonne', 'ton', 'lb', 'mg']);
/** Count "nouns" that name no particular thing: shared by unrelated quantities, so never a binding key. */
const GENERIC_NOUNS = new Set(['unit', 'count', 'item', 'number', 'ratio', 'percent', 'percentage', 'point', 'score',
  'index', 'level', 'rate', 'x', 'time', 'value', 'amount', 'quantity', 'total', 'thing', 'pp', 'bp', 'bps', 'basis']);

/**
 * Science guard 1: a unit two unrelated quantities are unlikely to share. Currency (any period / denominator), time,
 * mass, or a count of a NAMED noun. Never %, a percent-family scale, a ratio, a bare count or "units".
 */
export function unitIsDimensioned(unit: unknown): boolean {
  if (typeof unit !== 'string' || unit.trim() === '') return false;
  if (classifyUnitScaleClass(unit) !== 'unknown') return false;
  if (readMoney(unit, '') !== null) return true;
  const ws = words(unit).map(singular);
  if (ws.length > 0 && ws.every((w) => TIME_UNITS.has(w))) return true;
  if (ws.length > 0 && ws.every((w) => MASS_UNITS.has(w))) return true;
  const count = readCountRate(unit);
  return count !== null && count.noun.length > 0 && !count.noun.some((w) => GENERIC_NOUNS.has(w));
}

/** The v-next wire (literal evidence); legacy span-shaped record sets are left to their own semantics. */
export function isVNextRecordSet(records: DraftRecordSet): boolean {
  return records.stated_items.some((i) => !i.legacy_evidence
    && (i.value_literal !== undefined || i.unit_literals !== undefined || i.relationship?.no_effect_literal !== undefined));
}

/** A unit read from a typed reference only: the item's own unit, else its quantity declaration's (one hop, consistent). */
function effectiveUnit(items: readonly DraftStatedItem[], index: number): string | undefined {
  const item = items[index];
  if (item === undefined) return undefined;
  if (typeof item.unit === 'string' && item.unit.trim() !== '') return item.unit;
  const q = item.quantity;
  if (q === undefined || q === index) return undefined;
  const declaration = items[q];
  if (declaration === undefined || (declaration.quantity !== undefined && declaration.quantity !== q)) return undefined;
  return typeof declaration.unit === 'string' && declaration.unit.trim() !== '' ? declaration.unit : undefined;
}

/** The goal's own value_literal read through the existing amount reader: a currency code or '%', never words. */
function valueLiteralUnit(item: DraftStatedItem): string | undefined {
  const amounts = findStatedAmounts(item.value_literal);
  if (amounts.length !== 1) return undefined;
  const a = amounts[0]!;
  if (a.kind === 'currency' && a.currencyCode !== undefined) return a.currencyCode;
  if (a.kind === 'percent') return '%';
  return undefined;
}

/** Every stated index some TYPED reference names as a quantity identity. */
function declaredQuantities(records: DraftRecordSet): Set<number> {
  const declared = new Set<number>();
  const add = (q: unknown): void => { if (typeof q === 'number' && records.stated_items[q] !== undefined) declared.add(q); };
  for (const item of records.stated_items) {
    add(item.quantity);
    if (item.relationship !== undefined) { add(item.relationship.from_quantity); add(item.relationship.to_quantity); }
  }
  for (const claim of records.claims) add(claim.quantity);
  return declared;
}

const isBaselineFigure = (item: DraftStatedItem | undefined): boolean => item?.kind === 'figure' && item.role === 'baseline';
const hasTarget = (item: DraftStatedItem): boolean => item.kind === 'goal' && item.value !== undefined;

/**
 * Resolve NULL links by typed unit only. The input is never mutated; the result is a copy with each binding applied
 * and the list of typed asks, in stated-index order. Idempotent: a record set with every link present is returned
 * byte-identical with no binding and no ask (the sealed ideal fixture).
 */
export function linkByUnit(input: DraftRecordSet): UnitLinkResult {
  const records = structuredClone(input);
  const items = records.stated_items;
  const bindings: UnitLinkBinding[] = [];
  const asks: UnitLinkAsk[] = [];
  let genericRefusals = 0;
  const ask = (stated_index: number, reason: UnitLinkAskReason, candidates: readonly number[] = []): void => {
    if (!asks.some((a) => a.stated_index === stated_index && a.reason === reason)) asks.push({ stated_index, reason, candidates });
  };

  // ── 1. goal.baseline_ref null → the ONE baseline figure whose unit is sameUnit with the goal's unit.
  items.forEach((goal, g) => {
    if (!hasTarget(goal) || goal.baseline_ref !== undefined) return;
    const unit = effectiveUnit(items, g) ?? valueLiteralUnit(goal);
    if (unit === undefined) { ask(g, 'goal_baseline_unlinked'); return; }
    const candidates = items.flatMap((f, i) => {
      if (i === g || !isBaselineFigure(f)) return [];
      const fu = effectiveUnit(items, i);
      return fu !== undefined && sameUnit(fu, unit) ? [i] : [];
    });
    if (!unitIsDimensioned(unit)) {
      if (candidates.length === 1) genericRefusals += 1;
      ask(g, 'goal_baseline_unlinked', candidates);
      if (candidates.length > 1) for (const c of candidates) ask(c, 'goal_baseline_candidate_ambiguous', candidates);
      return;
    }
    if (candidates.length === 1) {
      goal.baseline_ref = candidates[0]!;
      bindings.push({ stated_index: g, field: 'baseline_ref', bound_to: candidates[0]!, bound_by: 'unit_unique' });
      return;
    }
    ask(g, 'goal_baseline_unlinked', candidates);
    for (const c of candidates) ask(c, 'goal_baseline_candidate_ambiguous', candidates);
  });

  // ── 2. goal.unit null and baseline_ref resolved → inherit the baseline figure's unit (a typed reference).
  items.forEach((goal, g) => {
    if (goal.kind !== 'goal' || goal.baseline_ref === undefined || effectiveUnit(items, g) !== undefined) return;
    const baselineUnit = isBaselineFigure(items[goal.baseline_ref]) ? effectiveUnit(items, goal.baseline_ref) : undefined;
    if (baselineUnit === undefined) return;
    goal.unit = baselineUnit;
    const boundHere = bindings.some((b) => b.stated_index === g && b.field === 'baseline_ref');
    bindings.push({ stated_index: g, field: 'unit', bound_to: baselineUnit, bound_by: boundHere ? 'unit_unique' : 'baseline_ref' });
  });

  // ── 3. figure.quantity null, role baseline → the ONE goal or declared quantity sameUnit with it; else ask.
  // A figure some typed reference already names (a declared quantity, or a goal's baseline_ref) HAS an identity.
  const declared = declaredQuantities(records);
  const baselineOfAGoal = new Set(items.flatMap((i) => (i.kind === 'goal' && i.baseline_ref !== undefined ? [i.baseline_ref] : [])));
  items.forEach((figure, f) => {
    if (!isBaselineFigure(figure) || figure.quantity !== undefined || declared.has(f) || baselineOfAGoal.has(f)) return;
    const unit = effectiveUnit(items, f);
    if (unit === undefined) { ask(f, 'figure_quantity_unlinked'); return; }
    const identities = new Set<number>();
    items.forEach((goal, g) => {
      if (goal.kind !== 'goal') return;
      const gu = effectiveUnit(items, g);
      if (gu !== undefined && sameUnit(gu, unit)) identities.add(goal.quantity ?? g);
    });
    for (const d of declared) {
      const du = effectiveUnit(items, d);
      if (d !== f && du !== undefined && sameUnit(du, unit)) identities.add(items[d]!.quantity ?? d);
    }
    const candidates = [...identities].sort((a, b) => a - b);
    if (!unitIsDimensioned(unit)) {
      if (candidates.length === 1) genericRefusals += 1;
      ask(f, 'figure_quantity_unlinked', candidates);
      return;
    }
    if (candidates.length === 1) {
      figure.quantity = candidates[0]!;
      bindings.push({ stated_index: f, field: 'quantity', bound_to: candidates[0]!, bound_by: 'unit_unique' });
      return;
    }
    ask(f, 'figure_quantity_unlinked', candidates);
  });

  // ── 4. goal.direction null → NEVER derived (Science guard 2): a typed ask on a goal that states a target.
  items.forEach((goal, g) => { if (hasTarget(goal) && goal.direction === undefined) ask(g, 'goal_direction_unstated'); });

  // ── 5. cause.relationship null → stays unsized; a typed ask naming the cause. No size is invented.
  items.forEach((cause, c) => { if (cause.kind === 'cause' && cause.relationship === undefined) ask(c, 'cause_relationship_unstated'); });

  asks.sort((a, b) => a.stated_index - b.stated_index || UNIT_LINK_ASK_REASONS.indexOf(a.reason) - UNIT_LINK_ASK_REASONS.indexOf(b.reason));
  return { records: bindings.length === 0 ? input : records, bindings, asks, generic_unit_refusals: genericRefusals };
}

const QUESTION: Record<UnitLinkAskReason, (quote: string) => string> = {
  goal_baseline_unlinked: (q) => `"${q}" — what is today's level of this goal, in its own unit? No stated figure could be attached to it by unit alone.`,
  goal_baseline_candidate_ambiguous: (q) => `"${q}" — is this today's level of the goal? More than one stated figure has the goal's unit, so none was attached.`,
  figure_quantity_unlinked: (q) => `"${q}" — which quantity is this the current level of? It could not be attached by unit alone.`,
  goal_direction_unstated: (q) => `"${q}" — is this a level to reach or exceed, or one to stay at or below?`,
  cause_relationship_unstated: (q) => `"${q}" — how large is this effect? It is in the model without a size until you say.`,
};

/** The open question for each typed ask, from the dropped rows the projector carries (index order, deduplicated). */
export function unitLinkOpenQuestions(dropped: ReadonlyArray<{ readonly reason: string; readonly stated_index?: number; readonly label?: string }>): string[] {
  const out: string[] = [];
  for (const row of dropped) {
    if (!isUnitLinkAskReason(row.reason) || typeof row.label !== 'string') continue;
    const question = QUESTION[row.reason](row.label);
    if (!out.includes(question)) out.push(question);
  }
  return out;
}
