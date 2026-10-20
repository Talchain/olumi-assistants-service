/**
 * THIN CORE DIFF (20 Oct 2026): what a proposed living model changes, item by item, so the person approves exactly what
 * changes and nothing else moves unseen. PURE. Items with ids (aims, options, factors, links) are matched by id; conditions,
 * views and history entries, which carry no id, are matched by their whole content.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';

export type LivingItemKind = 'aim' | 'option' | 'factor' | 'link' | 'condition' | 'view' | 'history';
export interface LivingChange {
  readonly kind: LivingItemKind;
  /** The item's id, or its position in the proposed (added) or saved (removed) list for an item without one. */
  readonly id: string;
  readonly change: 'add' | 'change' | 'remove';
  readonly before?: unknown;
  readonly after?: unknown;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function byId<T extends { id: string }>(kind: LivingItemKind, before: readonly T[], after: readonly T[]): LivingChange[] {
  const was = new Map(before.map((x) => [x.id, x]));
  const now = new Map(after.map((x) => [x.id, x]));
  const out: LivingChange[] = [];
  for (const x of after) {
    const old = was.get(x.id);
    if (old === undefined) out.push({ kind, id: x.id, change: 'add', after: x });
    else if (!same(old, x)) out.push({ kind, id: x.id, change: 'change', before: old, after: x });
  }
  for (const x of before) if (!now.has(x.id)) out.push({ kind, id: x.id, change: 'remove', before: x });
  return out;
}

function byContent(kind: LivingItemKind, before: readonly unknown[], after: readonly unknown[]): LivingChange[] {
  const key = (x: unknown) => JSON.stringify(x);
  const was = new Set(before.map(key));
  const now = new Set(after.map(key));
  return [
    ...after.flatMap((x, i) => (was.has(key(x)) ? [] : [{ kind, id: String(i), change: 'add' as const, after: x }])),
    ...before.flatMap((x, i) => (now.has(key(x)) ? [] : [{ kind, id: String(i), change: 'remove' as const, before: x }])),
  ];
}

/** Every item the proposed model adds, changes or removes against the saved one. Empty when nothing changes. */
export function diffLivingModels(before: LivingModelT, after: LivingModelT): LivingChange[] {
  return [
    ...byId('aim', before.aims, after.aims),
    ...byId('option', before.options, after.options),
    ...byId('factor', before.factors, after.factors),
    ...byId('link', before.links, after.links),
    ...byContent('condition', before.conditions, after.conditions),
    ...byContent('view', before.views, after.views),
    ...byContent('history', before.history, after.history),
  ];
}
