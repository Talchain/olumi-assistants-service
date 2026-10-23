/**
 * ANSWERING AN ASK (spike S1; phase 0 lesson 4): the person's answer to one ask is ONE edit that fills exactly ONE quantity.
 * The quantity becomes the person's known figure, in their words, approved by them (they typed it); what it replaced is kept
 * in `history`, so a correction never loses what it replaced. Nothing else in the model changes, so re-compiling shows
 * exactly which goals that answer unlocked.
 */
import { APPROXIMATE_FIGURE, type CanonicalModelT } from './canonical.js';
import { inlineQuantityId } from './compile.js';
import { findStatedAmounts, readCurrencyUnitWithQualifiers } from '../../cee/provenance/stated-amounts.js';
import { unitWrittenAfter } from '../agent-lane/user-statements.js';
import { parseUnit } from './units.js';

/** Words that give a figure as approximate ("about £2,000"). */
const APPROXIMATE_WORDS = /\b(about|around|roughly|approximately|approx|circa|nearly|almost)\b|~|≈/i;
/** The figures written in their words (thousands separators read; a sign is not read, so "5-8" is 5 and 8). */
const figuresIn = (words: string): number[] => (words.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
/**
 * Whether their words write `x` AS a figure in `unit`, or of the quantity named `label` (Codex r2 #3709, the rule of
 * feedback_range_end_needs_unit): the unit or the name straight after it, by the verifier's own matcher (`unitWrittenAfter`: whole word, plural, "10%"), with the plural of a unit
 * noun ending in f or y ("loaf" → "loaves"); or, for money, the same currency on that amount ("£2,500"). A figure of another
 * quantity or unit in the same words ("within 4 weeks", "60 kg") is never this one.
 */
const writesAs = (words: string, x: number, unit: string, label?: string): boolean => {
  const currency = readCurrencyUnitWithQualifiers(unit);
  if (currency.kind === 'currency') return findStatedAmounts(words).some((a) => a.kind === 'currency' && a.currencyCode === currency.currencyCode && Math.abs(a.magnitude) === Math.abs(x));
  const noun = unit.split('/')[0]!.trim();
  return [noun, noun.replace(/fe?$/u, 'ves'), noun.replace(/([^aeiou])y$/u, '$1ies'), ...(label !== undefined ? [label] : [])].some((u) => unitWrittenAfter(words, x, u));
};
/** Whether their words state both ends of a range: a range they did not state is never theirs. */
const statesEnds = (words: string, low: number, high: number): boolean => {
  const f = figuresIn(words);
  const has = (x: number) => f.some((y) => Math.abs(y - Math.abs(x)) < 1e-9);
  return has(low) && has(high);
};

export type Answer = { value: number; low?: null; high?: null } | { value?: number | null; low: number; high: number; range_kind?: 'bounds' | 'plausible' };
export type FillResult = { ok: true; model: CanonicalModelT } | { ok: false; reason: string };

export function fillQuantity(model: CanonicalModelT, quantityId: string, answer: Answer, quote: string): FillResult {
  const i = model.quantities.findIndex((q) => q.id === quantityId);
  if (i < 0) return fillInline(model, quantityId, answer, quote);
  const old = model.quantities[i];
  if (old.status === 'derived') return { ok: false, reason: `"${old.label}" is worked out by its relation; answer one of its inputs.` };
  if (quote.trim() === '') return { ok: false, reason: 'An answer needs the person\'s own words.' };
  const value = answer.value ?? null;
  if (answer.low != null && answer.high != null && answer.low > answer.high) return { ok: false, reason: `The low end ${answer.low} is above the high end ${answer.high}.` };
  // A range is theirs only when their words state both ends; "about £2,000" is their figure, with no range read into it.
  const stated = answer.low != null && answer.high != null && statesEnds(quote, answer.low, answer.high);
  const low = stated ? answer.low! : null;
  const high = stated ? answer.high! : null;
  if (value === null && low === null) return { ok: false, reason: answer.low != null ? 'Their words do not state that range; ask for the figure or the range in their words.' : 'An answer needs a figure, or both ends of a range.' };
  const range_kind = 'range_kind' in answer && answer.range_kind ? answer.range_kind : null;
  const approximate = low === null && APPROXIMATE_WORDS.test(quote);
  const filled = { ...old, value, low, high, range_kind: low !== null ? range_kind : null, status: 'known' as const, author: 'person' as const, party: null, quote, question: null,
    basis: approximate ? APPROXIMATE_FIGURE : null, approval: 'approved' as const };
  const quantities = [...model.quantities];
  quantities[i] = filled;
  return { ok: true, model: { ...model, quantities, history: [...model.history, { id: quantityId, change: 'superseded', old: JSON.stringify(old), quote, author_id: null }] } };
}

/** An option's own inline value is asked under its compiled id (`inlineQuantityId`): the answer fills that one setting. */
function fillInline(model: CanonicalModelT, quantityId: string, answer: Answer, quote: string): FillResult {
  for (const [oi, o] of model.options.entries()) {
    const si = o.sets.findIndex((s) => s.to === null && inlineQuantityId(o.id, s.quantity) === quantityId);
    if (si < 0) continue;
    if (quote.trim() === '') return { ok: false, reason: 'An answer needs the person\'s own words.' };
    const low = answer.low ?? null;
    const high = answer.high ?? null;
    const value = answer.value ?? null;
    if (low !== null && high !== null && low > high) return { ok: false, reason: `The low end ${low} is above the high end ${high}.` };
    if (value === null && (low === null || high === null)) return { ok: false, reason: 'An answer needs a figure, or both ends of a range.' };
    const old = o.sets[si];
    const sets = [...o.sets];
    sets[si] = { ...old, value, low, high, range_kind: low !== null && 'range_kind' in answer && answer.range_kind ? answer.range_kind : null, question: null, author: 'person', quote };
    const options = [...model.options];
    options[oi] = { ...o, sets };
    return { ok: true, model: { ...model, options, history: [...model.history, { id: o.id, change: 'superseded', old: JSON.stringify(o), quote, author_id: null }] } };
  }
  return { ok: false, reason: `"${quantityId}" is not a quantity in the model.` };
}

/** The answer to an UNRESOLVED range reading (PL ruling B): the person says whether their range's ends are hard. One edit. */
export function setRangeKind(model: CanonicalModelT, quantityId: string, kind: 'bounds' | 'plausible', quote: string): FillResult {
  const i = model.quantities.findIndex((q) => q.id === quantityId);
  if (i < 0) return { ok: false, reason: `"${quantityId}" is not a quantity in the model.` };
  const old = model.quantities[i];
  if (old.low === null || old.high === null) return { ok: false, reason: `"${old.label}" has no range to read.` };
  const quantities = [...model.quantities];
  quantities[i] = { ...old, range_kind: kind };
  return { ok: true, model: { ...model, quantities, history: [...model.history, { id: quantityId, change: 'superseded', old: JSON.stringify(old), quote, author_id: null }] } };
}

/**
 * GIVING AN AIM ITS MEASURE (DL 23 Oct): the person's answer to "what does success mean, how do you measure it?" is ONE edit
 * on ONE goal with no measure yet, in their words: the quantity it is about (one already in the model, or a new one they
 * named, theirs), how it is compared, its target and its window. Nothing is inferred: a target or a deadline their words do
 * not state stays asked (the target an asked quantity; the window left for the compiler's "By when?"), and a figure is
 * theirs only when their words state it. A new measured quantity is theirs but nothing works it out yet, so the aim is
 * held, saying so, until the model says how the options change it.
 */
export type GoalMeasureAnswer = {
  readonly goal_id: string;
  readonly quantity: string | { readonly label: string; readonly unit: string };
  readonly cmp: '>=' | '>' | '<=' | '<';
  readonly frame: 'level' | 'change_abs' | 'change_rel' | null;
  readonly target: { readonly value: number | null; readonly low: number | null; readonly high: number | null; readonly range_kind: 'bounds' | 'plausible' | null } | null;
  readonly window: { readonly periods: number; readonly start: number } | null;
  readonly quote: string;
};
type Quantity = CanonicalModelT['quantities'][number];

export function defineGoalMeasure(model: CanonicalModelT, a: GoalMeasureAnswer): FillResult {
  const g = model.goals.find((x) => x.id === a.goal_id);
  if (g === undefined) return { ok: false, reason: `"${a.goal_id}" is not a goal in the model.` };
  if (g.measure !== null) return { ok: false, reason: `"${g.label}" already has a measure; change its target instead.` };
  if (a.quote.trim() === '') return { ok: false, reason: 'A measure needs the person\'s own words.' };
  const taken = new Set([...model.quantities.map((q) => q.id), ...model.goals.map((x) => x.id), ...model.limits.map((l) => l.id), ...model.options.map((o) => o.id)]);
  const fresh = (base: string) => { let id = base; for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`; taken.add(id); return id; };
  const theirs = (id: string, label: string, unit: string, f: Partial<Quantity>): Quantity => ({ id, label, unit, kind: 'fact', value: null, low: null, high: null,
    range_kind: null, status: 'known', question: null, basis: null, author: 'person', party: null, quote: a.quote, approval: 'approved', author_id: null, ...f });
  const added: Quantity[] = [];

  let measured: { id: string; label: string; unit: string };
  if (typeof a.quantity === 'string') {
    const q = model.quantities.find((x) => x.id === a.quantity);
    if (q === undefined) return { ok: false, reason: `"${a.quantity}" is not a quantity in the model.` };
    if (q.status === 'asked') return { ok: false, reason: `"${q.label}" is still a question: an aim measures a figure the model holds or works out, never the result asked for.` };
    measured = { id: q.id, label: q.label, unit: q.unit };
  } else {
    const label = a.quantity.label.trim();
    if (label === '' || !parseUnit(a.quantity.unit).ok) return { ok: false, reason: 'A new measure needs a name and a unit.' };
    measured = { id: fresh(label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(?=[0-9]|$)/, 'm_')), label, unit: a.quantity.unit };
    added.push(theirs(measured.id, label, measured.unit, { status: 'unknown', basis: 'You named this as how the aim is measured; nothing in the model works it out yet.' }));
  }

  const frame = a.frame ?? 'level';
  const targetId = fresh(`${g.id}_target`);
  const targetUnit = frame === 'change_rel' ? '%' : measured.unit;
  // Each figure is theirs only as written for its own quantity: the target in the target's unit, the deadline in periods.
  const stated = (x: number) => writesAs(a.quote, x, targetUnit, measured.label);
  const targetLabel = `Target for ${measured.label}`;
  const t = a.target;
  if (t === null) {
    added.push(theirs(targetId, targetLabel, targetUnit, { status: 'asked', quote: null, question: `What figure for "${measured.label}" would count as "${g.label}"?` }));
  } else if (t.low !== null && t.high !== null) {
    if (t.low > t.high) return { ok: false, reason: `The low end ${t.low} is above the high end ${t.high}.` };
    if (!stated(t.low) || !stated(t.high)) return { ok: false, reason: 'Their words do not state that target range; leave the target out and it is asked.' };
    added.push(theirs(targetId, targetLabel, targetUnit, { value: t.value !== null && stated(t.value) ? t.value : null, low: t.low, high: t.high, range_kind: t.range_kind }));
  } else if (t.value !== null) {
    if (!stated(t.value)) return { ok: false, reason: 'Their words do not state that target; leave the target out and it is asked.' };
    added.push(theirs(targetId, targetLabel, targetUnit, { value: t.value }));
  } else return { ok: false, reason: 'A target needs a figure, or both ends of a range; leave it out and it is asked.' };

  let window: NonNullable<CanonicalModelT['goals'][number]['measure']>['window'] = null;
  if (a.window !== null) {
    if (!writesAs(a.quote, a.window.periods, model.period)) return { ok: false, reason: `Their words do not state that deadline in ${model.period}s; leave the window out and "By when?" is asked.` };
    const periods = fresh(`${g.id}_window`);
    added.push(theirs(periods, `Time to meet ${g.label}`, model.period, { value: a.window.periods }));
    window = { origin_event: null, origin_offset: null, start: a.window.start, periods };
  }
  const measure = { quantity: measured.id, per: null, cmp: a.cmp, target: targetId, frame, reference: frame === 'level' ? null : { kind: 'now' as const, option: null, quantity: null },
    aggregation: 'end' as const, window, measure_by: 'person' as const, assumptions: [], exclusions: [] };
  return { ok: true, model: { ...model, quantities: [...model.quantities, ...added],
    goals: model.goals.map((x) => (x.id === g.id ? { ...g, measure, question: null, approval: 'approved' as const } : x)),
    history: [...model.history, { id: g.id, change: 'superseded', old: JSON.stringify(g), quote: a.quote, author_id: null }] } };
}
