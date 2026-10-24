/**
 * THE ONE POSTIMAGE VALIDATOR (simplify v1, A1–A3): every change to a saved program is a WHOLE updated canonical model
 * (the AI's, from the person's message; or a typed card edit's, built from its exact target and value), and every one is
 * checked here, exactly, before it can be proposed or saved:
 *  · schema: it is a canonical model;
 *  · preservation by (family, id): every saved record is present in its own family; a removal is only one listed
 *    explicitly; an id is never moved to another family, never duplicated, and a removed id is never used again;
 *  · authorship: every added or changed item the person authors quotes their words (the same words in the same order;
 *    white space ignored), and a figure of theirs that
 *    changes quotes the words of THIS change. That is provenance (their words are there), never proof that the words
 *    entail the figure, unit or sign: the card is where the reading is reviewed;
 *  · the card shows every change: the field-level diff is derived ONCE, to the leaves (each changed path, saved →
 *    proposed; a list of another length compared entry by entry, an added or removed entry or item field by field) and
 *    drives the card: every changed path is said in plain words on its change's before and after, or, when it has no
 *    plain rendering or reads the same on both sides, the proposal is refused;
 *  · compile: it compiles (the caller's `withNewRun` evaluates it).
 * Host-owned, never the AI's: approval and author_id (an item on an approved card is accepted, its author unchanged), and
 * the history (each change and removal appended).
 */
import { ProposalChangeSchema, type ProposalChange } from '../agent-lane/proposal.js';
import { CanonicalModel, type CanonicalModelT } from '../model-program/canonical.js';

type Rec = Record<string, unknown>;
type Family = Exclude<keyof CanonicalModelT, 'version' | 'question' | 'period' | 'history'>;
const FAMILIES: readonly (readonly [Family, ProposalChange['kind']])[] = [
  ['quantities', 'quantity'], ['relations', 'relation'], ['goals', 'goal'], ['limits', 'record'], ['preferences', 'record'], ['options', 'option'],
  ['risks', 'risk'], ['claims', 'record'], ['evidence', 'record'], ['assumptions', 'record'], ['dissent', 'record'], ['conditions', 'record'], ['left_out', 'left_out'],
];

/** Set by the host, never taken from a proposed model. */
const HOST_FIELDS: ReadonlySet<string> = new Set(['approval', 'author_id']);
/** How a changed field is said on the card: its plain name (`{n}`: its position in a list) and how its value reads. */
type Say = 'q' | 'rec' | 'num' | 'amount' | 'text' | 'word' | 'who' | 'flag' | 'timing';
type Field = readonly [name: string, say: Say];
const WHO: Record<string, Field> = { author: ['whose', 'who'], party: ['from', 'text'], quote: ['their words', 'text'] };
const within = (prefix: string, name: string, fields: Record<string, Field>): Record<string, Field> =>
  Object.fromEntries(Object.entries(fields).map(([k, [nm, say]]) => [`${prefix}.${k}`, [`${name} ${nm}`, say] as const]));
const MEASURED: Record<string, Field> = { 'measure.quantity': ['measures', 'q'], 'measure.per': ['per', 'q'], 'measure.cmp': ['comparison', 'word'],
  'measure.aggregation': ['over the window', 'word'], 'measure.window.start': ['window opens after (periods)', 'num'],
  'measure.window.periods': ['deadline', 'q'], 'measure.window.origin_event': ['counted from', 'text'], 'measure.window.origin_offset': ['the event’s timing', 'q'] };
const ABOUT: Record<string, Field> = { 'concerns.*': ['about {n}', 'rec'] };
/** Every field a change can touch, per family (lists by entry: `*`); a changed path not listed here has no plain rendering, and is refused. */
const FIELDS: Readonly<Record<Family, Readonly<Record<string, Field>>>> = {
  quantities: { label: ['name', 'text'], unit: ['unit', 'word'], kind: ['kind', 'word'], status: ['status', 'word'], question: ['question', 'text'], value: ['figure', 'amount'],
    low: ['low end', 'amount'], high: ['high end', 'amount'], range_kind: ['range reading', 'word'], basis: ['basis', 'text'], ...WHO },
  relations: { defines: ['works out', 'q'], form: ['form', 'word'], op: ['operation', 'word'], 'parts.*.id': ['part {n}', 'q'], 'parts.*.sign': ['part {n} sign', 'num'],
    'parts.*.power': ['part {n} power', 'num'], base: ['base', 'q'], 'terms.*.driver': ['link {n} driver', 'q'], 'terms.*.coefficient': ['link {n} size', 'q'],
    ...within('terms.*', 'link {n}', WHO), start: ['starts at', 'q'], 'inflows.*': ['inflow {n}', 'q'], 'outflows.*': ['outflow {n}', 'q'], ...WHO },
  goals: { label: ['name', 'text'], question: ['question', 'text'], ...MEASURED, 'measure.target': ['target', 'q'], 'measure.frame': ['frame', 'word'],
    'measure.reference.kind': ['reference', 'word'], 'measure.reference.option': ['reference option', 'rec'], 'measure.reference.quantity': ['reference figure', 'q'],
    'measure.measure_by': ['measure named by', 'word'], 'measure.assumptions.*': ['rests on {n}', 'rec'], 'measure.exclusions.*': ['leaves out {n}', 'rec'], ...WHO },
  limits: { label: ['name', 'text'], question: ['question', 'text'], ...MEASURED, 'measure.bound': ['limit', 'q'], ...WHO },
  preferences: { quantity: ['figure', 'q'], direction: ['direction', 'word'], ...WHO },
  options: { label: ['name', 'text'], status: ['status', 'word'], developed_from: ['a variant of', 'rec'],
    ...within('sets.*', 'setting {n}', { quantity: ['changes', 'q'], to: ['to', 'q'], value: ['figure', 'num'], low: ['low end', 'num'], high: ['high end', 'num'], range_kind: ['range reading', 'word'],
      question: ['question', 'text'], starts_after_periods: ['starts', 'timing'], author: ['whose', 'who'], quote: ['their words', 'text'] }), ...WHO },
  risks: { label: ['name', 'text'], occurrence: ['chance', 'q'], severity: ['size', 'q'], effect_on: ['affects', 'q'], mode: ['how', 'word'], starts_after_periods: ['starts', 'timing'], ...WHO },
  claims: { text: ['words', 'text'], ...ABOUT, ...WHO },
  evidence: { text: ['words', 'text'], source: ['source', 'text'], bears: ['bears', 'word'], ...ABOUT, ...WHO },
  assumptions: { text: ['words', 'text'], applied: ['applied', 'flag'], ...ABOUT, ...WHO },
  dissent: { holder: ['held by', 'text'], position: ['view', 'text'], ...ABOUT, ...WHO },
  conditions: { text: ['words', 'text'], kind: ['kind', 'word'], ...ABOUT, ...WHO },
  left_out: { text: ['words', 'text'], why: ['why', 'text'], question: ['question', 'text'], ...ABOUT, ...WHO },
};

export type PostimageResult =
  | { readonly ok: true; readonly model: CanonicalModelT; readonly changes: readonly ProposalChange[] }
  | { readonly ok: false; readonly code: 'schema' | 'duplicate_id' | 'moved_record' | 'omitted_record' | 'removal_not_applied' | 'unknown_removal' | 'recycled_id'
    | 'unverified_person_words' | 'unshown_change' | 'invalid_change_entry' | 'no_change'; readonly reason: string; readonly ids: readonly string[] };

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** The person's words: the same words in the same order, white space ignored (a quote across their line break is theirs). */
export const verbatimIn = (quote: unknown, words: readonly string[]): boolean =>
  typeof quote === 'string' && squash(quote) !== '' && words.some((w) => squash(w).includes(squash(quote)));

const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/**
 * Every attribution in a record (itself, an option's settings, a relation's terms) that names the person as its author and
 * states something: a figure of theirs that is only ASKED (no figure, no words yet) states nothing.
 */
const personAttributions = (v: unknown): Rec[] => (Array.isArray(v) ? v.flatMap(personAttributions)
  : isRec(v) ? [...(v['author'] === 'person' && 'quote' in v && !(v['status'] === 'asked' && v['quote'] === null) ? [v] : []), ...Object.values(v).flatMap(personAttributions)] : []);
const withoutHost = (v: unknown): unknown => (Array.isArray(v) ? v.map(withoutHost)
  : isRec(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !HOST_FIELDS.has(k)).map(([k, x]) => [k, withoutHost(x)])) : v);
/** The host's own fields, set all the way down a record: its approval, and who approved it. Who authored it is unchanged. */
const hostSet = (v: unknown, approval: 'proposed' | 'approved', by: string | null): unknown => (Array.isArray(v) ? v.map((x) => hostSet(x, approval, by))
  : isRec(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'approval' ? approval : k === 'author_id' ? by : hostSet(x, approval, by)])) : v);
/** On an approved card: accepted, by the approving person. */
const accepted = (v: unknown, by: string | null): unknown => hostSet(v, 'approved', by);
/** A first draft, as the host saves it: every record proposed and approved by no one, whatever the drafter wrote (step 2). */
export const asDrafted = (m: CanonicalModelT): CanonicalModelT =>
  ({ ...m, ...Object.fromEntries(FAMILIES.map(([f]) => [f, hostSet(m[f], 'proposed', null)])) }) as CanonicalModelT;
/** One changed field: its path (`*` for a position in a list), where in lists it sits, and its saved and proposed values. */
type Delta = { readonly path: string; readonly pattern: string; readonly at: readonly number[]; readonly old: unknown; readonly now: unknown };
/**
 * The field-level diff, derived once and losslessly, to the leaves: records key by key and lists entry by entry, whatever
 * their lengths (an entry, record or list on one side only is compared against an empty one, so each of its fields is a
 * change of its own). Absent and null both read as no value (two empty records).
 */
const deltas = (a: unknown, b: unknown, path = '', pattern = '', at: readonly number[] = []): Delta[] => {
  const join = (p: string, k: string) => (p === '' ? k : `${p}.${k}`);
  if ((isRec(a) || a == null) && (isRec(b) || b == null)) {
    const [x, y] = [(a ?? {}) as Rec, (b ?? {}) as Rec];
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => deltas(x[k], y[k], join(path, k), join(pattern, k), at));
  }
  if ((Array.isArray(a) || a == null) && (Array.isArray(b) || b == null)) {
    const [x, y] = [(a ?? []) as unknown[], (b ?? []) as unknown[]];
    return Array.from({ length: Math.max(x.length, y.length) }, (_, i) => deltas(x[i], y[i], join(path, String(i)), join(pattern, '*'), [...at, i])).flat();
  }
  return Object.is(a, b) ? [] : [{ path, pattern, at, old: a, now: b }];
};
/** A record as the card compares it: without its id (the change's own) and what the host owns. */
const bare = (r: Rec | undefined): unknown => (r === undefined ? undefined : withoutHost(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id'))));
const idsOf = (m: CanonicalModelT, f: Family): string[] => (m[f] as readonly { id: string }[]).map((r) => r.id);

/**
 * Check `raw`, a whole proposed model, against the saved one. `removals`: the ids the person asked to remove, listed
 * explicitly; `words`: every word of theirs this change may quote (their earlier words and `fresh`, this change's own);
 * `approver`: who approves the card (its items' author_id), null for a guest.
 */
export function validatePostimage(base: CanonicalModelT, raw: unknown,
  opts: { readonly removals: readonly string[]; readonly words: readonly string[]; readonly fresh: readonly string[]; readonly approver?: string | null }): PostimageResult {
  const parsed = CanonicalModel.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'schema', reason: 'The proposed model is not in the model format.', ids: [] };
  const post = parsed.data;
  const refuse = (code: Exclude<PostimageResult, { ok: true }>['code'], ids: readonly string[], reason: string): PostimageResult => ({ ok: false, code, reason, ids });
  // Preservation by (family, id), before anything is compared.
  const baseIn = new Map(FAMILIES.map(([f]) => [f, new Set(idsOf(base, f))] as const));
  const dup = FAMILIES.flatMap(([f]) => idsOf(post, f).filter((id, i, all) => all.indexOf(id) !== i));
  const fresh = FAMILIES.flatMap(([f]) => idsOf(post, f).filter((id) => !baseIn.get(f)!.has(id)).map((id) => [f, id] as const));
  const twice = fresh.map(([, id]) => id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dup.length + twice.length > 0) return refuse('duplicate_id', [...new Set([...dup, ...twice])], `The id ${[...new Set([...dup, ...twice])].join(', ')} is used twice; every item needs its own id.`);
  const moved = fresh.filter(([f, id]) => FAMILIES.some(([g]) => g !== f && baseIn.get(g)!.has(id))).map(([, id]) => id);
  if (moved.length > 0) return refuse('moved_record', moved, `${moved.join(', ')} is already a different kind of item; an item keeps its kind, and a new one needs a new id.`);
  const removals = new Set(opts.removals);
  const unknown = [...removals].filter((id) => !FAMILIES.some(([f]) => baseIn.get(f)!.has(id)));
  if (unknown.length > 0) return refuse('unknown_removal', unknown, `Nothing in the model has the id ${unknown.join(', ')} to remove.`);
  const omitted = FAMILIES.flatMap(([f]) => [...baseIn.get(f)!].filter((id) => !removals.has(id) && !idsOf(post, f).includes(id)));
  if (omitted.length > 0) return refuse('omitted_record', omitted, `The proposed model leaves out ${omitted.join(', ')} without a listed removal; nothing is removed unless the person asks.`);
  const kept = [...removals].filter((id) => FAMILIES.some(([f]) => baseIn.get(f)!.has(id) && idsOf(post, f).includes(id)));
  if (kept.length > 0) return refuse('removal_not_applied', kept, `The proposed model still has ${kept.join(', ')}, listed for removal.`);
  const withdrawn = new Set(base.history.filter((h) => h.change === 'withdrawn').map((h) => h.id));
  const recycled = fresh.map(([, id]) => id).filter((id) => withdrawn.has(id));
  if (recycled.length > 0) return refuse('recycled_id', recycled, `The id ${recycled.join(', ')} belonged to a removed item; a new item needs a new id.`);

  const changes: ProposalChange[] = [];
  const was = wordsIn(base);
  const now = wordsIn(post);
  const history = [...base.history];
  const unverified: string[] = [];
  const unshown: string[] = [];
  const families = Object.fromEntries(FAMILIES.map(([family, kind]) => {
    const before = new Map((base[family] as readonly Rec[]).map((r) => [String(r['id']), r] as const));
    // Each changed path said in plain words, saved → proposed; one with no rendering, or that reads the same, is refused.
    const said = (id: string, old: Rec | undefined, r: Rec | undefined) => {
      const diff = deltas(bare(old), bare(r));
      const out = diff.map((d) => {
        const f = FIELDS[family][d.pattern];
        return f === undefined ? null : { name: f[0].replace('{n}', String((d.at.at(-1) ?? 0) + 1)), old: was.say(f[1], d.old, old ?? {}), now: now.say(f[1], d.now, r ?? {}) };
      });
      const hidden = diff.filter((_, i) => out[i] === null || out[i]!.old === out[i]!.now).map((d) => d.path);
      if (hidden.length > 0) unshown.push(`${id} (${hidden.join(', ')})`);
      return out.filter((x) => x !== null);
    };
    // An added left-out item is its substance in plain words, starting with its why (the card reads "Leaves out ‘its words’
    // (after)"): then what Olumi asks, what it concerns and whose words it is in, each only when present: "Your words" only
    // for the person's own, a reported someone's by their name. Its words are the label and whose it is the author, so
    // neither is said twice; no field is hidden.
    const leftOut = (r: Rec) => [String(r['why']),
      ...(typeof r['question'] === 'string' ? [`Olumi asks: “${r['question']}”`] : []),
      ...(Array.isArray(r['concerns']) && r['concerns'].length > 0 ? [`It concerns ${(r['concerns'] as string[]).map(now.named).join(' and ')}`] : []),
      ...(typeof r['quote'] === 'string' ? [typeof r['party'] === 'string' ? `${r['party']}’s words: “${r['quote']}”` : `Your words: “${r['quote']}”`]
        : typeof r['party'] === 'string' ? [`From ${r['party']}`] : [])]
      .reduce((said, part) => `${said}${/[.!?]$/.test(said) ? ' ' : '. '}${part}`);
    const entry = (id: string, action: ProposalChange['action'], fields: ReturnType<typeof said>, label: string, author: ProposalChange['author'], r?: Rec): ProposalChange => ({ id, kind, action, label,
      before: action === 'add' ? null : fields.map((x) => `${x.name}: ${x.old}`).join('; '),
      after: action === 'remove' ? null : action === 'add' && family === 'left_out' ? leftOut(r!) : fields.map((x) => `${x.name}: ${x.now}`).join('; '), author });
    const records = (post[family] as readonly Rec[]).map((r) => {
      const old = before.get(String(r['id']));
      const fields = said(String(r['id']), old, r);
      // Unchanged but for what the host owns: the saved record, exactly.
      if (old !== undefined && fields.length === 0 && !unshown.some((u) => u.startsWith(`${String(r['id'])} (`))) return old;
      const refigured = family === 'quantities' && old !== undefined && r['author'] === 'person' && (['value', 'low', 'high'] as const).some((k) => old[k] !== r[k]);
      if (personAttributions(r).some((a) => !verbatimIn(a['quote'], opts.words)) || (refigured && !verbatimIn(r['quote'], opts.fresh))) unverified.push(String(r['id']));
      const record = accepted(r, opts.approver ?? null) as Rec;
      changes.push(entry(String(r['id']), old === undefined ? 'add' : 'change', fields, now.title(family, record), authorOf(record), r));
      if (old !== undefined) history.push({ id: String(r['id']), change: 'superseded', old: JSON.stringify(old), quote: typeof r['quote'] === 'string' ? r['quote'] : null, author_id: opts.approver ?? null });
      return record;
    });
    for (const [id, old] of before) if (removals.has(id)) {
      changes.push(entry(id, 'remove', said(id, old, undefined), was.title(family, old), authorOf(old)));
      history.push({ id, change: 'withdrawn', old: JSON.stringify(old), quote: null, author_id: opts.approver ?? null });
    }
    return [family, records];
  })) as Pick<CanonicalModelT, Family>;
  if (unshown.length > 0) return refuse('unshown_change', unshown, `The card cannot show every change to ${unshown.join('; ')}; nothing is proposed.`);
  if (unverified.length > 0) return refuse('unverified_person_words', unverified, `${unverified.join(', ')}: the person's items must quote their words exactly.`);
  for (const [key, label] of [['question', 'The question'], ['period', 'The time step']] as const) {
    if (base[key] !== post[key]) changes.push({ id: key, kind: 'record', action: 'change', label, before: base[key], after: post[key], author: 'olumi' });
  }
  if (changes.length === 0) return refuse('no_change', [], 'The proposed model is the saved one: nothing changes.');
  // Every entry as the card reads it (one contract): an entry the card could not show refuses the proposal, never drops.
  const invalid = changes.filter((c) => !ProposalChangeSchema.safeParse(c).success).map((c) => c.id);
  if (invalid.length > 0) return refuse('invalid_change_entry', invalid, `The card cannot show ${invalid.join(', ')} (an item needs a name); nothing is proposed.`);
  return { ok: true, model: { ...post, ...families, history }, changes };
}

/** The reading card's order: what they want and what they could do first, then the structure, then the figures. */
const READING_ORDER: readonly Family[] = ['goals', 'limits', 'options', 'left_out', 'relations', 'preferences', 'risks', 'claims', 'evidence', 'assumptions', 'dissent', 'conditions', 'quantities'];
/**
 * "CHECK WHAT I UNDERSTOOD" (step 2): a saved first draft as ONE card, every record an add against an empty model, through
 * the same validator and the same diff as every change, in the reading order. Its model is the draft accepted by the
 * approving person (approval and author_id the host's; author, party and words untouched).
 */
export function readingOf(model: CanonicalModelT, opts: { readonly words: readonly string[]; readonly approver: string | null }): PostimageResult {
  const empty = { ...model, ...Object.fromEntries(FAMILIES.map(([f]) => [f, []])) } as CanonicalModelT;
  const v = validatePostimage(empty, model, { removals: [], words: opts.words, fresh: [], approver: opts.approver });
  if (!v.ok) return v;
  const rank = new Map(READING_ORDER.flatMap((f, i) => idsOf(model, f).map((id) => [id, i] as const)));
  const at = (id: string) => rank.get(id) ?? READING_ORDER.length;
  return { ...v, changes: [...v.changes].sort((a, b) => at(a.id) - at(b.id)) };
}

// ── The card's words, rendered from the data (no wording invented) ────────────────────────────────────────────────────
const n = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 6 });
const authorOf = (r: Rec): ProposalChange['author'] => (r['author'] === 'person' ? 'person' : 'olumi');

/** One model's words: an item's name on the card, and one value as a changed field says it. */
function wordsIn(m: CanonicalModelT) {
  const Q = new Map(m.quantities.map((q) => [q.id, q] as const));
  const label = (id: string) => Q.get(id)?.label ?? id;
  const named = (id: string) => {
    for (const [f] of FAMILIES) {
      const r = (m[f] as readonly Rec[]).find((x) => x['id'] === id);
      const l = r?.['label'] ?? r?.['text'] ?? r?.['position'];
      if (typeof l === 'string') return l;
    }
    return id;
  };
  /** A quantity as it is referred to: by name, with its value or range and unit, or that it is asked or worked out. */
  const timed = (id: string) => {
    const q = Q.get(id);
    return q === undefined ? `"${id}"` : q.status === 'asked' ? `"${q.label}" (asked)` : q.status === 'derived' ? `"${q.label}"`
      : `"${q.label}" ${q.low !== null && q.high !== null ? `${n(q.low)}–${n(q.high)} ${q.unit}` : q.value !== null ? `${n(q.value)} ${q.unit}` : `(no figure, ${q.unit})`}`;
  };
  const start = (t: number | string) => (typeof t === 'number' ? (t === 0 ? 'from the start' : `after ${t} ${m.period}s`) : `from ${timed(t)}`);
  /** One value, as a changed field says it. */
  const say = (as: Say, v: unknown, r: Rec): string => {
    if (v === null || v === undefined) return 'none';
    switch (as) {
      case 'q': return timed(String(v));
      case 'rec': return `"${named(String(v))}"`;
      case 'num': return typeof v === 'number' ? n(v) : String(v);
      case 'amount': return typeof v === 'number' ? `${n(v)} ${String(r['unit'])}` : String(v);
      case 'text': return `"${String(v)}"`;
      case 'word': return String(v);
      case 'who': return v === 'person' ? 'theirs' : v === 'olumi' ? 'Olumi’s' : 'the model’s structure';
      case 'flag': return v === true ? 'yes' : 'no';
      case 'timing': return start(v as number | string);
    }
  };
  /** An item's name on the card. */
  const title = (family: Family, r: Rec): string => String(family === 'relations' ? label(String(r['defines'])) : family === 'preferences' ? label(String(r['quantity']))
    : r['label'] ?? r['text'] ?? r['holder']);
  return { title, say, named };
}
