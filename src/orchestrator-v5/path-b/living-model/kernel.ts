/**
 * THIN CORE KERNEL (20 Oct 2026): the ONE deterministic rule on the AI's living model, plus id formatting. PURE.
 *  · ATTRIBUTION ONLY. A user or party item keeps its source when its quote is found verbatim in the person's verified
 *    words; otherwise it is `unverified`, never Olumi's (a missing quote does not make Olumi the author). A quote that is
 *    found proves only who said it, not that the figure, sign or certainty follows from it: those stay with the model.
 *  · IDS. A living-model id is the node id it compiles to, so it is made canonical (`CANONICAL_ID_REGEX`) and unique, and
 *    every reference to it is rewritten with it. Formatting, not meaning.
 */
import type { LivingModelT, LivingSourceT } from '../../../schemas/living-model.js';

export interface Relabelled { readonly id: string; readonly was: LivingSourceT }
export interface Kernelled { readonly model: LivingModelT; readonly relabelled: readonly Relabelled[] }

/** Whitespace, case and typographic quote marks never decide whether words are the person's own. */
const plain = (s: string): string => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

function canonicalIds(model: LivingModelT): LivingModelT {
  const seen = new Set<string>();
  const map = new Map<string, string>();
  const canon = (raw: string): string => {
    const known = map.get(raw);
    if (known !== undefined) return known;
    const base = raw.toLowerCase().replace(/[^a-z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
    let id = base;
    for (let n = 2; seen.has(id); n += 1) id = `${base}_${n}`;
    seen.add(id);
    map.set(raw, id);
    return id;
  };
  for (const item of [...model.aims, ...model.options, ...model.factors, ...model.links]) canon(item.id);
  const ref = (raw: string): string => map.get(raw) ?? raw;
  return {
    aims: model.aims.map((a) => ({ ...a, id: ref(a.id) })),
    factors: model.factors.map((f) => ({ ...f, id: ref(f.id) })),
    options: model.options.map((o) => ({ ...o, id: ref(o.id), settings: o.settings.map((s) => ({ ...s, factor_id: ref(s.factor_id) })) })),
    links: model.links.map((l) => ({ ...l, id: ref(l.id), from: ref(l.from), to: ref(l.to) })),
    conditions: model.conditions.map((c) => ({ ...c, applies_to: c.applies_to.map(ref) })),
    views: model.views,
    history: model.history.map((h) => ({ ...h, id: ref(h.id) })),
  };
}

export function applyKernel(model: LivingModelT, verifiedWords: readonly string[]): Kernelled {
  const words = verifiedWords.map(plain).filter((w) => w.length > 0);
  const relabelled: Relabelled[] = [];
  const attribute = <T extends { source: LivingSourceT; quote: string | null }>(id: string, item: T): T => {
    if (item.source !== 'user' && item.source !== 'party') return item;
    const quote = item.quote === null ? '' : plain(item.quote);
    if (quote.length > 0 && words.some((w) => w.includes(quote))) return item;
    relabelled.push({ id, was: item.source });
    return { ...item, source: 'unverified' };
  };
  const m = canonicalIds(model);
  return {
    model: {
      ...m,
      aims: m.aims.map((a) => attribute(a.id, a)),
      factors: m.factors.map((f) => attribute(f.id, f)),
      options: m.options.map((o) => ({ ...attribute(o.id, o), settings: o.settings.map((s) => attribute(`${o.id}:${s.factor_id}`, s)) })),
      links: m.links.map((l) => attribute(l.id, l)),
      conditions: m.conditions.map((c, i) => attribute(`condition_${i + 1}`, c)),
    },
    relabelled,
  };
}
