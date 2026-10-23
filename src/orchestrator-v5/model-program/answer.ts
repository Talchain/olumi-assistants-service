/**
 * ANSWERING AN ASK (spike S1; phase 0 lesson 4): the person's answer to one ask is ONE edit that fills exactly ONE quantity.
 * The quantity becomes the person's known figure, in their words, approved by them (they typed it); what it replaced is kept
 * in `history`, so a correction never loses what it replaced. Nothing else in the model changes, so re-compiling shows
 * exactly which goals that answer unlocked.
 */
import { APPROXIMATE_FIGURE, type CanonicalModelT } from './canonical.js';
import { inlineQuantityId } from './compile.js';

/** Words that give a figure as approximate ("about £2,000"). */
const APPROXIMATE_WORDS = /\b(about|around|roughly|approximately|approx|circa|nearly|almost)\b|~|≈/i;
/** The figures written in their words (thousands separators read; a sign is not read, so "5-8" is 5 and 8). */
const figuresIn = (words: string): number[] => (words.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
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
