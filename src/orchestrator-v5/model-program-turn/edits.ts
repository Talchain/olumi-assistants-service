/**
 * EDITS TO A MODEL PROGRAM (alpha): the few canonical operations the core agent's propose_change and the canvas's in-card
 * figure edit map to. Each is one edit on the canonical model, kept in its history, and nothing else changes:
 *  · set_quantity: a figure or range of ONE input quantity (an answer to an ask, or a corrected figure), as the person's,
 *    in their words (S1 `fillQuantity`);
 *  · set_goal_target: the figure a goal aims at: set_quantity on the goal's own target quantity (a target shared with
 *    another goal or limit is first given its own quantity, so the other keeps its figure);
 *  · add_option: a new option the person named, each setting either another quantity or its own inline value;
 *  · rename_option: an option's name;
 *  · set_range_kind: how to read a range the person gave (firm bounds, or a rough span), the answer to that open question.
 * A quote must be the person's own words; the caller checks it against what they wrote (`quotedIn`).
 */
import { z } from 'zod-v4';
import type { CanonicalModelT } from '../model-program/canonical.js';
import { fillQuantity, setRangeKind, type Answer } from '../model-program/answer.js';

const figure = {
  value: z.number().nullable().describe('One figure in the quantity\'s unit, or null when giving a range.'),
  low: z.number().nullable().describe('The low end of a range in the quantity\'s unit, or null.'),
  high: z.number().nullable().describe('The high end of a range in the quantity\'s unit, or null.'),
  range_kind: z.enum(['bounds', 'plausible']).nullable().describe('For a range: bounds when the words fix hard ends, plausible for a rough span. Null otherwise.'),
};
const quote = z.string().describe('The person\'s exact words that state it, copied from what they wrote.');

export const ProgramOp = z.union([
  z.object({ op: z.enum(['set_quantity']), quantity_id: z.string().describe('The id of an input quantity (not a derived one), from read_canonical_context.'), ...figure, quote }).strict(),
  z.object({ op: z.enum(['set_goal_target']), goal_id: z.string(), ...figure, quote }).strict(),
  z.object({ op: z.enum(['add_option']), label: z.string().describe('The option\'s name as the person said it.'),
    sets: z.array(z.object({ quantity_id: z.string().describe('The input quantity this option changes.'), ...figure,
      from_period: z.number().int().describe('The period it takes effect from (0 = now).') }).strict()), quote }).strict(),
  z.object({ op: z.enum(['rename_option']), option_id: z.string(), label: z.string(), quote }).strict(),
  z.object({ op: z.enum(['set_range_kind']), quantity_id: z.string().describe('The quantity whose range the person is reading (an open question\'s quantity_id).'),
    range_kind: z.enum(['bounds', 'plausible']).describe('bounds: their ends are firm, it cannot fall outside; plausible: a rough span.'), quote }).strict(),
]);
export type ProgramOpT = z.infer<typeof ProgramOp>;
type Figure = { value: number | null; low: number | null; high: number | null; range_kind: 'bounds' | 'plausible' | null };

export type EditResult = { readonly ok: true; readonly model: CanonicalModelT } | { readonly ok: false; readonly reason: string };

const plain = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
/** Whether a quote is the person's own words: found in what they wrote. */
export const quotedIn = (q: string, words: readonly string[]): boolean => plain(q).length > 0 && words.some((w) => plain(w).includes(plain(q)));

const answerOf = (f: Figure): Answer | null => (f.low !== null && f.high !== null
  ? { value: f.value, low: f.low, high: f.high, ...(f.range_kind !== null ? { range_kind: f.range_kind } : {}) }
  : f.value !== null ? { value: f.value } : null);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(?=[0-9])/, 'o_') || 'option';

function setQuantity(model: CanonicalModelT, quantityId: string, f: Figure, words: string): EditResult {
  const a = answerOf(f);
  if (a === null) return { ok: false, reason: 'A figure needs a value, or both ends of a range.' };
  return fillQuantity(model, quantityId, a, words);
}

function setGoalTarget(model: CanonicalModelT, goalId: string, f: Figure, words: string): EditResult {
  const g = model.goals.find((x) => x.id === goalId);
  if (g === undefined || g.measure === null) return { ok: false, reason: g === undefined ? `"${goalId}" is not a goal in the model.` : `"${g.label}" has no measure yet, so it has no target to set.` };
  const target = g.measure.target;
  const shared = model.goals.some((x) => x.id !== goalId && x.measure?.target === target) || model.limits.some((l) => l.measure?.bound === target);
  if (!shared) return setQuantity(model, target, f, words);
  const old = model.quantities.find((q) => q.id === target);
  if (old === undefined) return { ok: false, reason: `The target of "${g.label}" is not a quantity in the model.` };
  const own = `${goalId}_target`;
  const split: CanonicalModelT = { ...model, quantities: [...model.quantities, { ...old, id: own }],
    goals: model.goals.map((x) => (x.id === goalId ? { ...x, measure: { ...x.measure!, target: own } } : x)) };
  return setQuantity(split, own, f, words);
}

function addOption(model: CanonicalModelT, op: Extract<ProgramOpT, { op: 'add_option' }>): EditResult {
  if (op.label.trim() === '') return { ok: false, reason: 'A new option needs a name.' };
  if (model.options.some((o) => plain(o.label) === plain(op.label))) return { ok: false, reason: `There is already an option called "${op.label}".` };
  let id = slug(op.label);
  for (let n = 2; model.options.some((o) => o.id === id) || model.quantities.some((q) => q.id === id); n += 1) id = `${slug(op.label)}_${n}`;
  for (const s of op.sets) {
    const q = model.quantities.find((x) => x.id === s.quantity_id);
    if (q === undefined) return { ok: false, reason: `"${s.quantity_id}" is not a quantity in the model.` };
    if (q.status === 'derived') return { ok: false, reason: `"${q.label}" is worked out by its relation; an option sets one of its inputs.` };
    if (s.value === null && (s.low === null || s.high === null)) return { ok: false, reason: `The setting of "${q.label}" needs a figure, or both ends of a range.` };
  }
  const option: CanonicalModelT['options'][number] = { id, label: op.label, status: 'live', developed_from: null, author: 'person', party: null, quote: op.quote,
    approval: 'approved', author_id: null,
    sets: op.sets.map((s) => ({ quantity: s.quantity_id, to: null, value: s.value, low: s.low, high: s.high, range_kind: s.low !== null ? s.range_kind : null,
      question: null, from_period: s.from_period, author: 'person', quote: op.quote })) };
  return { ok: true, model: { ...model, options: [...model.options, option] } };
}

function renameOption(model: CanonicalModelT, op: Extract<ProgramOpT, { op: 'rename_option' }>): EditResult {
  const i = model.options.findIndex((o) => o.id === op.option_id);
  if (i < 0) return { ok: false, reason: `"${op.option_id}" is not an option in the model.` };
  if (op.label.trim() === '') return { ok: false, reason: 'An option needs a name.' };
  const old = model.options[i]!;
  const options = [...model.options];
  options[i] = { ...old, label: op.label };
  return { ok: true, model: { ...model, options, history: [...model.history, { id: old.id, change: 'superseded', old: JSON.stringify(old), quote: op.quote, author_id: null }] } };
}

/** Apply the operations in order; the first that cannot be applied refuses the whole change, with its reason. */
export function applyOps(model: CanonicalModelT, ops: readonly ProgramOpT[]): EditResult {
  let m = model;
  for (const op of ops) {
    const r = op.op === 'set_quantity' ? setQuantity(m, op.quantity_id, op, op.quote)
      : op.op === 'set_goal_target' ? setGoalTarget(m, op.goal_id, op, op.quote)
      : op.op === 'add_option' ? addOption(m, op) : op.op === 'rename_option' ? renameOption(m, op)
      // How to read a range they gave: the range, its words and its author stay as they were; the answer is kept in history.
      : setRangeKind(m, op.quantity_id, op.range_kind, op.quote);
    if (!r.ok) return r;
    m = r.model;
  }
  return { ok: true, model: m };
}
