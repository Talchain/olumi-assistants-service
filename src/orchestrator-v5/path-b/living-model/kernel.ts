/**
 * THIN CORE KERNEL (20 Oct 2026): the ONE deterministic rule on the AI's living model, plus id formatting. PURE.
 *  · ATTRIBUTION ONLY. A user or party item keeps its source when its quote is found verbatim in the person's verified
 *    words; otherwise it is `unverified`, never Olumi's (a missing quote does not make Olumi the author). A quote that is
 *    found proves only who said it, not that the figure, sign or certainty follows from it: those stay with the model.
 *    An item carried over from the SAVED model UNCHANGED (same id, same content, same attribution) keeps it: it was checked
 *    when it was saved, and words that have since left the conversation window never downgrade it. A changed item is new.
 *  · PER-FIGURE AUTHORSHIP (21 Oct, buddy SIMPLER). Olumi's estimate (`estimate_by: 'olumi'`) is only of a WHOLLY missing
 *    figure: on a saved item whose figure the source gave, it is dropped and the given figure kept, never replaced or mixed.
 *    Adding only an estimate to a saved, unchanged item keeps that item's attribution: the item is unchanged, the figure is
 *    labelled Olumi's on its own. A new or otherwise changed item is checked as before.
 *  · IDS. A living-model id is the node id it compiles to, so it is made canonical (`CANONICAL_ID_REGEX`) and unique, and
 *    every reference to it is rewritten with it. Formatting, not meaning.
 */
import type { LivingModelT, LivingSourceT } from '../../../schemas/living-model.js';
import { stable } from './diff.js';

export interface Relabelled { readonly id: string; readonly was: LivingSourceT }
export interface Kernelled { readonly model: LivingModelT; readonly relabelled: readonly Relabelled[] }

/** Whitespace, case and typographic quote marks never decide whether words are the person's own. */
export const plain = (s: string): string => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/** The kernel's own canonical ids (idempotent): a pass that matches items to the saved model before the kernel uses these. */
export function canonicalIds(model: LivingModelT): LivingModelT {
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
  for (const item of [...model.aims, ...model.options, ...model.factors, ...model.links, ...model.risks]) canon(item.id);
  const ref = (raw: string): string => map.get(raw) ?? raw;
  const defined = <T extends { defined_as?: { op: 'sum' | 'product'; of: string[]; subtract?: string[] | null } | null }>(x: T): T => {
    if (!x.defined_as) return x;
    const { subtract, ...definition } = x.defined_as;
    return { ...x, defined_as: { ...definition, of: definition.of.map(ref),
      ...(subtract == null ? {} : { subtract: subtract.map(ref) }) } };
  };
  return {
    aims: model.aims.map((a) => defined({ ...a, id: ref(a.id) })),
    factors: model.factors.map((f) => defined({ ...f, id: ref(f.id), ...(f.accumulation == null ? {} : { accumulation: { ...f.accumulation,
      stock_today: ref(f.accumulation.stock_today), loss_rate_per_month: ref(f.accumulation.loss_rate_per_month),
      inflow_per_month: ref(f.accumulation.inflow_per_month) } }) })),
    options: model.options.map((o) => ({ ...o, id: ref(o.id), settings: o.settings.map((s) => ({ ...s, factor_id: ref(s.factor_id) })),
      ...(o.developed_from ? { developed_from: ref(o.developed_from) } : {}) })),
    links: model.links.map((l) => ({ ...l, id: ref(l.id), from: ref(l.from), to: ref(l.to) })),
    risks: model.risks.map((r) => ({ ...r, id: ref(r.id), mitigations: r.mitigations.map((m) => ({ ...m, factor_id: ref(m.factor_id) })) })),
    conditions: model.conditions.map((c) => ({ ...c, applies_to: c.applies_to.map(ref) })),
    views: model.views,
    history: model.history.map((h) => ({ ...h, id: ref(h.id) })),
  };
}

type Attributed = { source: LivingSourceT; party: string | null; quote: string | null };
/** An item's identity and its WHOLE content, attribution included (key order never counts). */
/** An item's attribution, as the kernel names it: never the host's own `said_in` mark, which the AI can neither set nor clear (Codex r1 on #3661). */
const attributionKey = (id: string, item: Attributed): string => {
  const { said_in: _host, ...rest } = item as Attributed & { said_in?: unknown };
  return `${id}\u0000${stable(rest)}`;
};

/** Every attribution the saved model holds, keyed by item id, as the kernel names them. */
function savedAttributions(saved: LivingModelT): Set<string> {
  return new Set([
    ...saved.aims.map((a) => attributionKey(a.id, a)),
    ...saved.factors.map((f) => attributionKey(f.id, f)),
    ...saved.options.flatMap((o) => [attributionKey(o.id, optionItself(o)), ...o.settings.map((x) => attributionKey(`${o.id}:${x.factor_id}`, x))]),
    ...saved.links.map((l) => attributionKey(l.id, l)),
    ...saved.risks.flatMap((r) => [attributionKey(r.id, r), ...r.mitigations.map((x) => attributionKey(`${r.id}:${x.factor_id}`, x))]),
    ...saved.conditions.map((c) => attributionKey(`condition:${c.text}`, c)),
    ...saved.factors.flatMap(f => f.accumulation == null ? [] : [attributionKey(`${f.id}:accumulation`, f.accumulation)]),
    ...[...saved.aims, ...saved.factors].flatMap((x) => (x.defined_as ? [attributionKey(`${x.id}:defined_as`, x.defined_as)] : [])),
  ]);
}

type Fig = Record<string, any>;
const given = (b: { value?: number | null; low: number | null; high: number | null }): boolean => [b.value, b.low, b.high].some((v) => v != null);
/** Each figure's own keys: a link's size is its form, spread and sign too. */
const FIGURE = ['estimate_by', 'value', 'low', 'high', 'unit'] as const;
const EFFECT = [...FIGURE, 'form', 'sd', 'sign'] as const;
const OCCURRENCE = ['estimate_by', 'low', 'high'] as const;
/**
 * The figure as its source gave it (Codex r1 on #3603). Olumi's estimate never replaces or mixes with a figure the source gave:
 * the WHOLE saved figure is kept. And Olumi's label never leaves a figure that did not change: a later draft cannot make
 * Olumi's figure the person's by dropping the label.
 */
function guarded<T extends Fig>(next: T, before: Fig | undefined, keys: readonly string[]): T {
  if (before === undefined) return next;
  if (next.estimate_by === 'olumi' && before.estimate_by !== 'olumi' && given(before as { low: number | null; high: number | null })) {
    return { ...next, ...Object.fromEntries(keys.map((k) => [k, before[k] ?? null])) };
  }
  const unchanged = keys.every((k) => k === 'estimate_by' || (next[k] ?? null) === (before[k] ?? null));
  return before.estimate_by === 'olumi' && next.estimate_by !== 'olumi' && unchanged ? { ...next, estimate_by: 'olumi' } : next;
}
/** An option's own attribution is its words, not its settings: each setting carries its own (as a figure does). */
const optionItself = <T extends { settings: unknown }>({ settings: _settings, ...rest }: T): Omit<T, 'settings'> => rest;
/** The item with its Olumi-estimated figures put back as saved: equal to the saved item when ONLY an estimate was added. */
function withoutEstimates(item: Record<string, any>, before: Record<string, any> | undefined): Record<string, any> | undefined {
  if (before === undefined) return undefined;
  let changed = false;
  const out: Record<string, any> = { ...item };
  const restore = (key: 'figure' | 'effect' | 'occurrence') => {
    const now = key === 'figure' ? item : item[key];
    const was = key === 'figure' ? before : before[key];
    // Olumi's estimate where the source gave none, or a revision of Olumi's own earlier estimate: never the item's words.
    if (now?.estimate_by !== 'olumi' || was === undefined || (given(was) && was.estimate_by !== 'olumi')) return;
    changed = true;
    const back = { estimate_by: was.estimate_by ?? null, value: was.value ?? null, low: was.low, high: was.high, unit: was.unit ?? null };
    if (key === 'figure') Object.assign(out, back);
    else if (key === 'effect') out.effect = { ...item.effect, ...back, form: was.form, sd: was.sd };
    else out.occurrence = { ...item.occurrence, estimate_by: was.estimate_by ?? null, low: was.low, high: was.high };
  };
  if ('value' in item) restore('figure');
  if (item.effect !== undefined) restore('effect');
  if (item.occurrence !== undefined) {
    restore('occurrence');
    if (item.horizon_by === 'olumi' && (before.horizon_months === null || before.horizon_by === 'olumi')) { changed = true; out.horizon_months = before.horizon_months; out.horizon_by = before.horizon_by ?? null; }
  }
  return changed ? out : undefined;
}

export function applyKernel(model: LivingModelT, verifiedWords: readonly string[], saved?: LivingModelT,
  /** The scenario's brief, when known: a figure stated in the person's own words that it does not hold was said in the conversation. */
  brief?: string | null): Kernelled {
  const words = verifiedWords.map(plain).filter((w) => w.length > 0);
  const kept = saved === undefined ? new Set<string>() : savedAttributions(saved);
  const savedItem = new Map<string, Record<string, any>>(saved === undefined ? [] : [
    ...saved.factors.map((f) => [f.id, f] as const), ...saved.links.map((l) => [l.id, l] as const), ...saved.risks.map((r) => [r.id, r] as const),
    ...saved.options.flatMap((o) => o.settings.map((x) => [`${o.id}:${x.factor_id}`, x] as const)),
  ]);
  const keptCurrent = (id: string, current: number | null): boolean => {
    const t = saved?.aims.find((a) => a.id === id)?.target;
    return t?.current_source === 'user' && t.current === current;
  };
  // ⭐ WHERE THE PERSON SAID IT (DL 22 Oct, Lenses' step 3: an approved chat correction was saved as the brief's figure). The
  // thin-core plan's authorship rule (20 Oct): a label, never a gate, and never figure-matching. An item of the person's (never
  // Olumi's estimate) whose quote is found VERBATIM in one of their chat messages, and not in the brief, was said in the chat;
  // the label stays with its unchanged quote once the words leave the verified window (host-verified when it was made). It
  // says "these are the person's words", not that the figure is proven. Host-set, never the AI's; an unknown brief, or a first
  // draft, says nothing (null): the brief's, as before.
  const briefWords = typeof brief === 'string' ? plain(brief) : null;
  const savedChat = new Set((saved?.factors ?? []).flatMap((f) => (f.said_in === 'chat' && f.quote !== null ? [`${f.id}\u0000${plain(f.quote)}`] : [])));
  const saidIn = (id: string, f: Omit<LivingModelT['factors'][number], 'said_in'>): 'chat' | null => {
    if (briefWords === null || f.source !== 'user' || f.estimate_by !== null || f.quote === null) return null;
    const q = plain(f.quote);
    return q.length > 0 && !briefWords.includes(q) && (words.some((w) => w.includes(q)) || savedChat.has(`${id}\u0000${q}`)) ? 'chat' : null;
  };
  const relabelled: Relabelled[] = [];
  const attribute = <T extends Attributed>(id: string, item: T): T => {
    if (item.source !== 'user' && item.source !== 'party') return item;
    if (kept.has(attributionKey(id, item))) return item;
    const bare = withoutEstimates(item, savedItem.get(id));
    if (bare !== undefined && kept.has(attributionKey(id, bare as T))) return item;
    const quote = item.quote === null ? '' : plain(item.quote);
    if (quote.length > 0 && words.some((w) => w.includes(quote))) return item;
    relabelled.push({ id, was: item.source });
    return { ...item, source: 'unverified' };
  };
  // A definition carries its own attribution: the person's words for the quantity are not their words for what it is.
  const defined = <T extends { id: string; defined_as: (Attributed & { op: 'sum' | 'product'; of: string[] }) | null }>(x: T): T =>
    (x.defined_as ? { ...x, defined_as: attribute(`${x.id}:defined_as`, x.defined_as) } : x);
  const m = canonicalIds(model);
  return {
    model: {
      ...m,
      aims: m.aims.map((a) => {
        const out = defined(attribute(a.id, a));
        // Today's level set by the person on the canvas: theirs only while it is the saved one, unchanged.
        if (out.target?.current_source === 'user' && !keptCurrent(a.id, out.target.current)) {
          relabelled.push({ id: `${a.id}:current`, was: 'user' });
          return { ...out, target: { ...out.target, current_source: null } };
        }
        return out;
      }),
      // What the AI sent for `said_in` is dropped; the key is written only when the host reads 'chat', so an unmarked factor stays
      // byte for byte what it was.
      factors: m.factors.map((f) => {
        const { said_in: _sent, ...raw } = defined(attribute(f.id, guarded(f, savedItem.get(f.id), FIGURE)));
        const out = raw.accumulation == null ? raw : { ...raw, accumulation: attribute(`${f.id}:accumulation`, raw.accumulation) };
        return saidIn(f.id, out) === 'chat' ? { ...out, said_in: 'chat' as const } : out;
      }),
      options: m.options.map((o) => ({ ...attribute(o.id, optionItself(o)),
        settings: o.settings.map((s) => attribute(`${o.id}:${s.factor_id}`, guarded(s, savedItem.get(`${o.id}:${s.factor_id}`), FIGURE))) })),
      links: m.links.map((l) => attribute(l.id, { ...l, effect: guarded(l.effect, savedItem.get(l.id)?.effect, EFFECT) })),
      // A mitigation carries its own attribution, as an option's setting does: the person's risk is not their reduction.
      risks: m.risks.map((r) => {
        // A chance or window the source gave is never replaced by Olumi's (the chance is owned FOR its window); Olumi's stays Olumi's.
        const before = savedItem.get(r.id);
        const occurrence = guarded(r.occurrence, before?.occurrence, OCCURRENCE);
        const window = r.horizon_by === 'olumi' && before !== undefined && before.horizon_by !== 'olumi' && before.horizon_months !== null
          ? { horizon_months: before.horizon_months, horizon_by: before.horizon_by ?? null }
          : before?.horizon_by === 'olumi' && r.horizon_by !== 'olumi' && r.horizon_months === before.horizon_months ? { horizon_by: 'olumi' as const } : {};
        const g = { ...r, occurrence, ...window };
        return { ...attribute(r.id, g), mitigations: r.mitigations.map((x) => attribute(`${r.id}:${x.factor_id}`, x)) };
      }),
      conditions: m.conditions.map((c) => attribute(`condition:${c.text}`, c)),
    },
    relabelled,
  };
}
