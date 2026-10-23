/**
 * ANSWERING AN ASK (spike S1; phase 0 lesson 4): the person's answer to one ask is ONE edit that fills exactly ONE quantity.
 * The quantity becomes the person's known figure, in their words, approved by them (they typed it); what it replaced is kept
 * in `history`, so a correction never loses what it replaced. Nothing else in the model changes, so re-compiling shows
 * exactly which goals that answer unlocked.
 */
import type { CanonicalModelT } from './canonical.js';
import { inlineQuantityId } from './compile.js';

export type Answer = { value: number; low?: null; high?: null } | { value?: number | null; low: number; high: number };
export type FillResult = { ok: true; model: CanonicalModelT } | { ok: false; reason: string };

export function fillQuantity(model: CanonicalModelT, quantityId: string, answer: Answer, quote: string): FillResult {
  const i = model.quantities.findIndex((q) => q.id === quantityId);
  if (i < 0) return fillInline(model, quantityId, answer, quote);
  const old = model.quantities[i];
  if (old.status === 'derived') return { ok: false, reason: `"${old.label}" is worked out by its relation; answer one of its inputs.` };
  if (quote.trim() === '') return { ok: false, reason: 'An answer needs the person\'s own words.' };
  const low = answer.low ?? null;
  const high = answer.high ?? null;
  const value = answer.value ?? null;
  if (low !== null && high !== null && low > high) return { ok: false, reason: `The low end ${low} is above the high end ${high}.` };
  if (value === null && (low === null || high === null)) return { ok: false, reason: 'An answer needs a figure, or both ends of a range.' };
  const filled = { ...old, value, low, high, status: 'known' as const, author: 'person' as const, party: null, quote, question: null, basis: null, approval: 'approved' as const };
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
    sets[si] = { ...old, value, low, high, question: null, author: 'person', quote };
    const options = [...model.options];
    options[oi] = { ...o, sets };
    return { ok: true, model: { ...model, options, history: [...model.history, { id: o.id, change: 'superseded', old: JSON.stringify(o), quote, author_id: null }] } };
  }
  return { ok: false, reason: `"${quantityId}" is not a quantity in the model.` };
}
