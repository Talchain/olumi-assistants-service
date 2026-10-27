/**
 * THE ONE POSTIMAGE VALIDATOR (simplify v1, A1–A3): every change to a saved program is a WHOLE updated canonical model
 * (the AI's changes from the person's message, merged by id onto the saved model; or a typed card edit's, built from its
 * exact target and value), and every one is
 * checked here, exactly, before it can be proposed or saved:
 *  · schema: it is a canonical model;
 *  · preservation by (family, id): every saved record is present in its own family; a removal is only one listed
 *    explicitly; an id is never moved to another family, never duplicated, and a removed id is never used again;
 *  · authorship and provenance are the AI's alone (S1 strip, Paul 26 Oct): no quote check (A2, A2b), so an item is shown as
 *    its author says; the card shows whose it is and in whose words, and only the person's press accepts it;
 *  · the card shows every change: the field-level diff is derived ONCE, to the leaves (each changed path, saved →
 *    proposed; a list of another length compared entry by entry, an added or removed entry or item field by field) and
 *    drives the card: every changed path is said in plain words on its change's before and after, or, when it has no
 *    plain rendering or reads the same on both sides, the proposal is refused;
 *  · compile: it compiles (the caller's `withNewRun` evaluates it).
 * Host-owned, never the AI's: approval, approved_by and author_id (an item on an approved card is accepted by its approver,
 * and who said it is unchanged: C6), and the history (each change and removal appended, with who said it and who approved it).
 */
import { ProposalChangeSchema, type ProposalChange } from '../agent-lane/proposal.js';
import { readingGroups } from './reading-groups.js';
import { CanonicalModel, HOST_OWNED_FIELDS, type CanonicalModelT } from '../model-program/canonical.js';
import { norm } from '../model-program/compile.js';
import { linkTargets } from '../model-program/links.js';

type Rec = Record<string, unknown>;
type Family = Exclude<keyof CanonicalModelT, 'version' | 'question' | 'period' | 'history'>;
const FAMILIES: readonly (readonly [Family, ProposalChange['kind']])[] = [
  ['quantities', 'quantity'], ['relations', 'relation'], ['goals', 'goal'], ['limits', 'record'], ['preferences', 'record'], ['options', 'option'],
  ['risks', 'risk'], ['claims', 'record'], ['evidence', 'record'], ['assumptions', 'record'], ['dissent', 'record'], ['conditions', 'record'], ['left_out', 'left_out'],
];

/** A row's family in the projection's own vocabulary (`project.ts` ItemFamily): the record notes keep their family's name. */
const ROW_FAMILY: Readonly<Record<Family, NonNullable<ProposalChange['family']>>> = {
  quantities: 'quantity', relations: 'relation', goals: 'goal', limits: 'limit', preferences: 'preference', options: 'option', risks: 'risk',
  claims: 'claims', evidence: 'evidence', assumptions: 'assumptions', dissent: 'dissent', conditions: 'conditions', left_out: 'left_out',
};

/** Set by the host, never taken from a proposed model. */
const HOST_FIELDS: ReadonlySet<string> = new Set(HOST_OWNED_FIELDS);
/**
 * How a changed field is said on the card: the fields of an item that read together are ONE group (a figure's value, range
 * and unit; a goal's measure; its window), said as one plain phrase from the item itself. Every field a change can touch
 * belongs to a group here, per family (lists by entry: `*`); a changed path in no group has no plain rendering, and a group
 * that reads the same before and after cannot show its change: either refuses the proposal. A group marked `#` is one per
 * list entry (a link, a setting).
 */
const WORDS = ['author', 'party', 'quote'] as const;
const by = (group: string, ...paths: string[]) => Object.fromEntries(paths.map((p) => [p, group] as const));
const MEASURE = ['measure.quantity', 'measure.per', 'measure.cmp'];
const WHEN = ['measure.aggregation', 'measure.window.start', 'measure.window.periods', 'measure.window.origin_event', 'measure.window.origin_offset'];
const OWN = { ...by('author', 'author'), ...by('words', 'party', 'quote') };
export const GROUPS: Readonly<Record<Family, Readonly<Record<string, string>>>> = {
  quantities: { ...by('name', 'label'), ...by('figure', 'value', 'low', 'high', 'range_kind', 'unit', 'direction', 'floor', 'ceiling'), ...by('kind', 'kind'), ...by('status', 'status'),
    ...by('question', 'question'), ...by('basis', 'basis'), ...OWN },
  relations: { ...by('name', 'defines'), ...by('how', 'form', 'op', 'base', 'start', 'parts.*.id', 'parts.*.sign', 'parts.*.power', 'terms.*.driver', 'terms.*.coefficient', 'inflows.*', 'outflows.*'),
    ...by('link#', ...WORDS.map((k) => `terms.*.${k}`)), ...OWN },
  goals: { ...by('name', 'label'), ...by('measure', ...MEASURE, 'measure.target', 'measure.frame', 'measure.reference.kind', 'measure.reference.option', 'measure.reference.quantity'),
    ...by('when', ...WHEN), ...by('measure_by', 'measure.measure_by'), ...by('rests', 'measure.assumptions.*'), ...by('excludes', 'measure.exclusions.*'), ...by('question', 'question'), ...OWN },
  limits: { ...by('name', 'label'), ...by('measure', ...MEASURE, 'measure.bound'), ...by('when', ...WHEN), ...by('question', 'question'), ...OWN },
  preferences: { ...by('name', 'quantity'), ...by('direction', 'direction'), ...OWN },
  options: { ...by('name', 'label'), ...by('status', 'status'), ...by('variant', 'developed_from'),
    ...by('setting#', ...['quantity', 'to', 'value', 'low', 'high', 'range_kind', 'question', 'starts_after_periods', 'author', 'quote'].map((k) => `sets.*.${k}`)), ...OWN },
  risks: { ...by('name', 'label'), ...by('chance', 'occurrence'), ...by('effect', 'severity', 'effect_on', 'mode'), ...by('starts', 'starts_after_periods'), ...OWN },
  claims: { ...by('name', 'text'), ...by('about', 'concerns.*'), ...OWN },
  evidence: { ...by('name', 'text'), ...by('source', 'source'), ...by('bears', 'bears'), ...by('about', 'concerns.*'), ...OWN },
  assumptions: { ...by('name', 'text'), ...by('applied', 'applied'), ...by('about', 'concerns.*'), ...OWN },
  dissent: { ...by('name', 'holder'), ...by('position', 'position'), ...by('about', 'concerns.*'), ...OWN },
  conditions: { ...by('name', 'text'), ...by('kind', 'kind'), ...by('about', 'concerns.*'), ...OWN },
  left_out: { ...by('name', 'text'), ...by('why', 'why'), ...by('question', 'question'), ...by('about', 'concerns.*'), ...OWN },
};

export type PostimageResult =
  | { readonly ok: true; readonly model: CanonicalModelT; readonly changes: readonly ProposalChange[] }
  | { readonly ok: false; readonly code: 'schema' | 'duplicate_id' | 'moved_record' | 'omitted_record' | 'removal_not_applied' | 'unknown_removal' | 'recycled_id'
    | 'unverified_person_words' | 'unshown_change' | 'invalid_change_entry' | 'no_change'; readonly reason: string; readonly ids: readonly string[];
    /** Which words check refused it: their words anywhere, or this turn's (a figure of theirs that changes). */
    readonly check?: 'their_words' | 'this_turn' };

/** The person's words: the same words in the same order, in compile's one form (case, curly quotes, dashes, white space folded). */
export const verbatimIn = (quote: unknown, words: readonly string[]): boolean =>
  typeof quote === 'string' && norm(quote) !== '' && words.some((w) => norm(w).includes(norm(quote)));

const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
export const withoutHost = (v: unknown): unknown => (Array.isArray(v) ? v.map(withoutHost)
  : isRec(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !HOST_FIELDS.has(k)).map(([k, x]) => [k, withoutHost(x)])) : v);
/**
 * The host's own fields, set all the way down a record (C6, spec §3: authorship and acceptance are separate): its approval
 * and who approved it (`approved_by`: `by` once approved), and who SAID it (`author_id`), never the approver for being one:
 * `by` for a record of the person's in words they give in this change (`fresh`), else whoever said the same words in the
 * saved record (`prior`), else no one known. Olumi's own records, and structure, are said by no person.
 */
const hostSet = (v: unknown, approval: 'proposed' | 'approved', by: string | null, fresh: readonly string[] = [], prior?: unknown): unknown => {
  if (Array.isArray(v)) return v.map((x, i) => hostSet(x, approval, by, fresh, Array.isArray(prior) ? prior[i] : undefined));
  if (!isRec(v)) return v;
  const was: Rec = isRec(prior) ? prior : {};
  const saidBy = () => (v['author'] !== 'person' ? null : verbatimIn(v['quote'], fresh) ? by
    : WORDS.every((k) => (was[k] ?? null) === (v[k] ?? null)) ? (was['author_id'] ?? null) : null);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'approval' ? approval : k === 'approved_by' ? (approval === 'approved' ? by : null)
    : k === 'author_id' ? saidBy() : hostSet(x, approval, by, fresh, was[k])]));
};
/** On an approved card: accepted, by the approving person; who said each part as `hostSet` reads it against the saved record. */
const accepted = (v: unknown, by: string | null, fresh: readonly string[], prior: unknown): unknown => hostSet(v, 'approved', by, fresh, prior);
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
/** A copy of a record with one field (a dotted path, list entries by position) set to a value, or removed when undefined. */
const withPath = (r: Rec, path: string, value: unknown): Rec => {
  const copy = JSON.parse(JSON.stringify(r)) as Rec;
  const keys = path.split('.');
  let at: unknown = copy;
  for (const k of keys.slice(0, -1)) at = isRec(at) || Array.isArray(at) ? (at as Rec)[k] : undefined;
  if (isRec(at) || Array.isArray(at)) { if (value === undefined) delete (at as Rec)[keys.at(-1)!]; else (at as Rec)[keys.at(-1)!] = value; }
  return copy;
};
/** A record as the card compares it: without its id (the change's own) and what the host owns. */
const bare = (r: Rec | undefined): unknown => (r === undefined ? undefined : withoutHost(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id'))));
const idsOf = (m: CanonicalModelT, f: Family): string[] => (m[f] as readonly { id: string }[]).map((r) => r.id);

/**
 * Check `raw`, a whole proposed model, against the saved one. `removals`: the ids the person asked to remove, listed
 * explicitly; `words`: every word of theirs this change may quote (their earlier words and `fresh`, this change's own);
 * `approver`: who approves the card (its items' approved_by), and the person whose words `fresh` are (in every caller the
 * same person: the turn's own); null for a guest.
 */
export function validatePostimage(saved: CanonicalModelT, raw: unknown,
  opts: { readonly removals: readonly string[]; readonly words: readonly string[]; readonly fresh: readonly string[]; readonly approver?: string | null }): PostimageResult {
  const parsed = CanonicalModel.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'schema', reason: 'The proposed model is not in the model format.', ids: [] };
  // Both sides as written: the host clears no direction (B3 off the path, S1 strip), so a direction change is a change, shown.
  const base = saved;
  const post = parsed.data;
  const refuse = (code: Exclude<PostimageResult, { ok: true }>['code'], ids: readonly string[], reason: string, check?: 'their_words' | 'this_turn'): PostimageResult =>
    ({ ok: false, code, reason, ids, ...(check ? { check } : {}) });
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
  const unshown: string[] = [];
  const families = Object.fromEntries(FAMILIES.map(([family, kind]) => {
    const before = new Map((base[family] as readonly Rec[]).map((r) => [String(r['id']), r] as const));
    // Each changed group said in plain words, saved → proposed: a path in no group, or a group that reads the same, is refused.
    const said = (id: string, old: Rec | undefined, r: Rec | undefined) => {
      const diff = deltas(bare(old), bare(r));
      const groups = new Map<string, { readonly group: string; readonly at: number; readonly paths: string[] }>();
      const hidden: string[] = [];
      for (const d of diff) {
        const g = GROUPS[family][d.pattern];
        if (g === undefined) { hidden.push(d.path); continue; }
        const at = g.endsWith('#') ? d.at[0]! : -1;
        const key = `${g}${at}`;
        if (!groups.has(key)) groups.set(key, { group: g, at, paths: [] });
        groups.get(key)!.paths.push(d.path);
      }
      const order = Object.values(GROUPS[family]);
      const out = [...groups.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.at - b.at)
        .map((x) => ({ ...x, old: was.phrase(family, x.group, old ?? {}, x.at), now: now.phrase(family, x.group, r ?? {}, x.at) }));
      // A whole item's name and whose it is are the card's label and mark (its schema refuses an empty name), not its text.
      const whole = old === undefined || r === undefined;
      for (const x of out) if (x.old === x.now && !(whole && (x.group === 'name' || x.group === 'author'))) hidden.push(...x.paths);
      // Per field, never per group (Codex P1 ×2): each field, set back alone, must change its group's words, or it would ride
      // unseen beside another change: a link moved to a twin while a link is added, or a figure given where there was none
      // beside a timing the words say. A field that appears with its container is set back to empty, where empty is a state
      // the item can be in (a window's start appears with the window and has no empty); one that leaves with its container
      // (a deadline or a setting taken away) has nowhere to go back to. Either way the container's words say it.
      if (r !== undefined) for (const x of out) if (x.old !== x.now) for (const d of diff.filter((y) => x.paths.includes(y.path))) {
        const back = withPath(r, d.path, d.old ?? null);
        if (d.now === undefined || (d.old === undefined && (d.now === null || !CanonicalModel.shape[family].element.safeParse(back).success))) continue;
        if (now.phrase(family, x.group, back, x.at) === x.now) hidden.push(d.path);
      }
      if (hidden.length > 0) unshown.push(`${id} (${hidden.join(', ')})`);
      return out;
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
    // A whole item added or removed: its name is the card's label and whose it is (theirs or Olumi's) the card's mark, so
    // neither is said again; a fixed part of the model's structure is said.
    const onCard = (x: ReturnType<typeof said>[number], r: Rec) => x.group === 'name' || (x.group === 'author' && r['author'] !== 'structure');
    const phrase = (fields: ReturnType<typeof said>, side: 'old' | 'now', r: Rec, whole: boolean) =>
      [...new Set([...(family === 'options' && whole && Array.isArray(r['sets']) && r['sets'].length === 0 ? ['carries on as now'] : []),
        ...fields.filter((x) => !(whole && onCard(x, r))).map((x) => x[side])].filter((x) => x !== ''))].join(', ');
    // W3b: each row says its family, a fixed part of the structure as such, and a figure still to be given as asked.
    const entry = (id: string, action: ProposalChange['action'], fields: ReturnType<typeof said>, label: string, author: ProposalChange['author'], r: Rec): ProposalChange => ({ id, kind, action, label,
      before: action === 'add' ? null : phrase(fields, 'old', r, action === 'remove'),
      after: action === 'remove' ? null : action === 'add' && family === 'left_out' ? leftOut(r) : phrase(fields, 'now', r, action === 'add'), author,
      family: ROW_FAMILY[family], ...(r['author'] === 'structure' ? { structure: true as const } : {}),
      ...(family === 'quantities' && r['status'] === 'asked' ? { asked: true as const } : {}) });
    const records = (post[family] as readonly Rec[]).map((r) => {
      const old = before.get(String(r['id']));
      const fields = said(String(r['id']), old, r);
      // Unchanged but for what the host owns: the saved record, exactly.
      if (old !== undefined && fields.length === 0 && !unshown.some((u) => u.startsWith(`${String(r['id'])} (`))) return old;
      const record = accepted(r, opts.approver ?? null, opts.fresh, old) as Rec;
      changes.push(entry(String(r['id']), old === undefined ? 'add' : 'change', fields, now.title(family, record), authorOf(record), r));
      if (old !== undefined) history.push({ id: String(r['id']), change: 'superseded', old: JSON.stringify(old), quote: typeof r['quote'] === 'string' ? r['quote'] : null,
        author_id: typeof record['author_id'] === 'string' ? record['author_id'] : null, approved_by: opts.approver ?? null });
      return record;
    });
    for (const [id, old] of before) if (removals.has(id)) {
      changes.push(entry(id, 'remove', said(id, old, undefined), was.title(family, old), authorOf(old), old));
      history.push({ id, change: 'withdrawn', old: JSON.stringify(old), quote: null, author_id: null, approved_by: opts.approver ?? null });
    }
    return [family, records];
  })) as Pick<CanonicalModelT, Family>;
  if (unshown.length > 0) return refuse('unshown_change', unshown, `The card cannot show every change to ${unshown.join('; ')}; nothing is proposed.`);
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
 * approving person (approval, approved_by and author_id the host's; author, party and words untouched). The draft's words are
 * the brief, given this turn by that person, so a record of theirs in its words is said by them (C6).
 */
export function readingOf(model: CanonicalModelT, opts: { readonly words: readonly string[]; readonly approver: string | null }): PostimageResult {
  const empty = { ...model, ...Object.fromEntries(FAMILIES.map(([f]) => [f, []])) } as CanonicalModelT;
  const v = validatePostimage(empty, model, { removals: [], words: opts.words, fresh: opts.words, approver: opts.approver });
  if (!v.ok) return v;
  const rank = new Map(READING_ORDER.flatMap((f, i) => idsOf(model, f).map((id) => [id, i] as const)));
  const at = (id: string) => rank.get(id) ?? READING_ORDER.length;
  // Each row carries its group: the same map the first reply counts (alpha G13), so the two can never disagree.
  const groups = readingGroups(model, (quote) => verbatimIn(quote, opts.words));
  return { ...v, changes: [...v.changes].sort((a, b) => at(a.id) - at(b.id)).map((c) => ({ ...c, group: groups.get(c.id) ?? 'other' })) };
}

// ── The card's words, rendered from the data (no wording invented) ────────────────────────────────────────────────────
/** Each value of a field said in plain words: the one phrase table (never an operator or a code on the card). */
const CMP_WORDS: Record<string, string> = { '>=': 'at least', '<=': 'at most', '>': 'more than', '<': 'less than' };
const RANGE_WORDS: Record<string, string> = { bounds: 'firm ends', plausible: 'a plausible range' };
/** A link's direction, before the name of what it moves (Paul 24 Oct, "Arrow + words": "↓ lowers Churn"). */
const DIRECTION_WORDS: Record<string, string> = { raises: '↑ raises', lowers: '↓ lowers' };
const WHO_WORDS: Record<string, string> = { person: 'yours', olumi: 'Olumi’s', structure: 'a fixed part of the model’s structure' };
const AGG_WORDS: Record<string, string> = { end: 'by the end of', sum: 'in total over', mean: 'on average over', every: 'in every period of', max: 'at its highest over', min: 'at its lowest over' };
const AGG_ALONE: Record<string, string> = { end: '', sum: 'in total', mean: 'on average', every: 'in every period', max: 'at its highest', min: 'at its lowest' };
const of = (words: Readonly<Record<string, string>>, v: unknown): string => (typeof v === 'string' && words[v] !== undefined ? words[v]! : 'not given');
const n = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 6 });
const authorOf = (r: Rec): ProposalChange['author'] => (r['author'] === 'person' ? 'person' : 'olumi');

/** One model's words: an item's name on the card, and one value as a changed field says it. */
function wordsIn(m: CanonicalModelT) {
  const Q = new Map(m.quantities.map((q) => [q.id, q] as const));
  const label = (id: string) => Q.get(id)?.label ?? id;
  const named = (id: string) => {
    for (const [f] of FAMILIES) {
      const r = (m[f] as readonly Rec[]).find((x) => x['id'] === id);
      // A relation or a preference has no name of its own: it is said as the card titles it (what it works out, or is about).
      const l = r === undefined ? undefined : r['label'] ?? r['text'] ?? r['position'] ?? title(f, r);
      if (typeof l === 'string') return l;
    }
    return id;
  };
  /** A unit as words: a pure number has none, and "1/x" is "per x"; an identifier's underscores read as spaces ("tech_lead" → "tech lead"). */
  const unitOf = (u: unknown) => (u === '1' || u === '' || typeof u !== 'string' ? '' : ` ${u.replace(/^1\s*\/\s*/, 'per ').replace(/_/g, ' ')}`);
  /** A quantity as it is referred to: by name, with its value or range, or that it is asked or worked out. */
  const timed = (id: string) => {
    const q = Q.get(id);
    return q === undefined ? `"${id}"` : q.status === 'asked' ? `"${q.label}" (still to be given)` : q.status === 'derived' ? `"${q.label}"`
      : `"${q.label}" ${q.low !== null && q.high !== null ? `${n(q.low)}–${n(q.high)}${unitOf(q.unit)}` : q.value !== null ? `${n(q.value)}${unitOf(q.unit)}` : `(no figure yet${unitOf(q.unit)})`}`;
  };
  /** A target or bound an option sets to another figure: its name only, as the results say it (#3722); its figure is on its own item. */
  const bound = (id: string) => (m.options.some((o) => o.sets.some((s) => s.quantity === id)) ? `"${named(id)}"` : timed(id));
  const start = (t: number | string) => (typeof t === 'number' ? (t === 0 ? 'from the start' : `after ${t} ${m.period}s`) : `from ${timed(t)}`);
  const list = (ids: unknown) => (Array.isArray(ids) ? ids.map((id) => `"${named(String(id))}"`) : []);
  const and = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  /** A figure from its value, range, reading and unit, all together, and a link's direction on what it moves (issue 40). */
  const figure = (r: Rec) => {
    const u = unitOf(r['unit']), at = (k: string) => (typeof r[k] === 'number' ? `${n(r[k] as number)}${u}` : null);
    const bare = (k: string) => n(r[k] as number);
    // What it moves is said by name; a direction on a size no link has is said alone, so its change shows (B3 off the path).
    const moves = typeof r['direction'] === 'string' && typeof r['id'] === 'string' ? linkTargets(m, r['id']) : [];
    const sign = (said: string) => [said, ...(typeof r['direction'] === 'string' ? [`${of(DIRECTION_WORDS, r['direction'])}${moves.length > 0 ? ` ${and(moves.map(label))}` : ''}`] : [])].filter((x) => x !== '').join(', ');
    // alpha G2: what it can be is Olumi's reading, said as such, so a change to it shows.
    const can = [...(at('floor') !== null ? [`never below ${bare('floor')}`] : []), ...(at('ceiling') !== null ? [`never above ${bare('ceiling')}`] : [])];
    const reading = (typeof r['range_kind'] === 'string' ? ` (${of(RANGE_WORDS, r['range_kind'])})` : '') + (can.length > 0 ? ` (${can.join(', ')}: Olumi’s reading)` : '');
    if (at('low') !== null && at('high') !== null) return sign(`from ${bare('low')} to ${at('high')}${at('value') !== null ? `, most likely ${bare('value')}` : ''}${reading}`);
    const ends = [...(at('low') !== null ? [`no lower than ${at('low')}`] : []), ...(at('high') !== null ? [`no higher than ${at('high')}`] : [])].join(', ');
    // A worked-out figure has no figure of its own to give: only its unit.
    const none = r['status'] === 'derived' ? (u === '' ? '' : `in${u}`) : `no figure yet${u === '' ? '' : ` (in${u})`}`;
    return sign([at('value') ?? none, ...(ends === '' ? [] : [ends])].filter((x) => x !== '').join(', ') + reading);
  };
  /** Whose words an item is in: the person's own, or someone they report, by name. */
  const words = (r: Rec) => (typeof r['quote'] === 'string' ? `in ${typeof r['party'] === 'string' ? `${r['party']}’s` : 'your'} words "${r['quote']}"`
    : typeof r['party'] === 'string' ? `said by ${r['party']}` : 'not in your words');
  const measured = (r: Rec, say: (mm: Rec) => string) => (isRec(r['measure']) ? say(r['measure']) : 'no measure yet');
  const reference = (ref: unknown) => (!isRec(ref) || ref['kind'] === 'now' ? 'now' : ref['kind'] === 'option' ? `"${named(String(ref['option']))}"` : timed(String(ref['quantity'])));
  /** One group of an item's fields, said as one plain phrase from the item itself (`at`: its list entry, for `#`). */
  const phrase = (family: Family, group: string, r: Rec, at: number): string => {
    // The side of an add or a removal where the item does not exist: never the words of any value it could have.
    if (Object.keys(r).length === 0) return '(not there)';
    const q = (k: string) => (typeof r[k] === 'string' ? timed(r[k] as string) : 'nothing');
    switch (group) {
      case 'name': return family === 'relations' ? `for ${q('defines')}` : family === 'preferences' ? `about ${q('quantity')}` : family === 'dissent' ? `held by "${String(r['holder'] ?? '')}"`
        : family === 'quantities' || family === 'goals' || family === 'limits' || family === 'options' || family === 'risks' ? `named "${String(r['label'] ?? '')}"` : `worded "${String(r['text'] ?? '')}"`;
      case 'figure': return figure(r);
      case 'kind': return family === 'conditions' ? of({ prerequisite: 'a prerequisite', challenge: 'a challenge' }, r['kind']) : of({ fact: 'a fact', coefficient: 'a rate', derived: 'a result' }, r['kind']);
      case 'status': return family === 'options' ? of({ live: 'compared', ruled_out: 'ruled out, kept in view', removed: 'taken out of the comparison' }, r['status'])
        : of({ known: 'known', estimated: 'an estimate', asked: 'still to be given', derived: 'worked out from the model', unknown: 'not known yet', not_applicable: 'does not apply',
          unsupported: 'outside what the model can use' }, r['status']);
      case 'question': return typeof r['question'] === 'string' ? `Olumi asks "${r['question']}"` : 'no question';
      case 'basis': return typeof r['basis'] === 'string' ? `based on "${r['basis']}"` : 'no basis given';
      case 'author': return of(WHO_WORDS, r['author']);
      case 'words': return words(r);
      case 'how': {
        const parts = Array.isArray(r['parts']) ? (r['parts'] as Rec[]) : [];
        const terms = Array.isArray(r['terms']) ? (r['terms'] as Rec[]) : [];
        const each = (ids: unknown, verb: string) => (Array.isArray(ids) ? ids.map((id) => `, ${verb} ${timed(String(id))}`).join('') : '');
        if (r['form'] === 'effect') return `an effect on ${q('defines')}, starting from ${q('base')}${terms.map((t) => `, changes by ${timed(String(t['coefficient']))} for each ${timed(String(t['driver']))}`).join('')}`;
        if (r['form'] === 'stock') return `a running total of ${q('defines')}, starting at ${q('start')}${each(r['inflows'], 'adding')}${each(r['outflows'], 'taking away')}, each ${m.period}`;
        if (r['form'] !== 'definition') return 'no calculation';
        const said = parts.map((x, i) => (r['op'] === 'product'
          ? `${i === 0 ? (x['power'] === -1 ? 'one divided by ' : '') : x['power'] === -1 ? ' divided by ' : ' multiplied by '}${timed(String(x['id']))}`
          : `${i === 0 ? (x['sign'] === -1 ? 'less ' : '') : x['sign'] === -1 ? ', lowered by ' : ', raised by '}${timed(String(x['id']))}`)).join('');
        return `${q('defines')} is ${r['op'] === 'product' ? said : `the sum of ${said}`}`;
      }
      case 'link#': {
        // A link's own authorship is said where it is not the item's (the card's mark), and its words where it has them.
        const t = Array.isArray(r['terms']) ? (r['terms'] as Rec[])[at] : undefined;
        if (t === undefined) return `no link ${at + 1}`;
        const own = [...(t['author'] !== r['author'] ? [`is ${of(WHO_WORDS, t['author'])}`] : []), ...(typeof t['quote'] === 'string' || typeof t['party'] === 'string' ? [words(t)] : [])];
        return own.length === 0 ? '' : `link ${at + 1} ${own.join(', ')}`;
      }
      case 'measure': return measured(r, (mm) => {
        const frame = mm['frame'] === 'change_abs' ? `, as a change from ${reference(mm['reference'])}` : mm['frame'] === 'change_rel' ? `, as a relative change from ${reference(mm['reference'])}`
          : isRec(mm['reference']) ? `, compared with ${reference(mm['reference'])}` : '';
        return `${timed(String(mm['quantity']))}${typeof mm['per'] === 'string' ? ` per ${timed(mm['per'])}` : ''} ${of(CMP_WORDS, mm['cmp'])} ${bound(String(mm['target'] ?? mm['bound']))}${frame}`;
      });
      case 'when': return measured(r, (mm) => {
        const w = isRec(mm['window']) ? mm['window'] : null, agg = String(mm['aggregation']);
        if (w === null) return `${agg === 'end' ? '' : `${of(AGG_ALONE, agg)}, `}no deadline set`;
        return `${of(AGG_WORDS, agg)} ${timed(String(w['periods']))}${typeof w['start'] === 'number' && w['start'] > 0 ? `, starting after ${w['start']} ${m.period}s` : ''}`
          + `${typeof w['origin_event'] === 'string' ? `, counted from "${w['origin_event']}"` : ''}${typeof w['origin_offset'] === 'string' ? `, which is ${timed(w['origin_offset'])} from the start of this model` : ''}`;
      });
      case 'measure_by': return measured(r, (mm) => (mm['measure_by'] === 'olumi' ? 'Olumi’s suggested measure' : 'the measure you named'));
      case 'rests': return measured(r, (mm) => (list(mm['assumptions']).length > 0 ? `resting on ${and(list(mm['assumptions']))}` : 'resting on nothing stated'));
      case 'excludes': return measured(r, (mm) => (list(mm['exclusions']).length > 0 ? `leaving out ${and(list(mm['exclusions']))}` : 'leaving nothing out'));
      case 'direction': return of({ lower: 'lower is better', higher: 'higher is better' }, r['direction']);
      case 'variant': return typeof r['developed_from'] === 'string' ? `a variant of "${named(r['developed_from'])}"` : 'not a variant of another option';
      case 'setting#': {
        const x = Array.isArray(r['sets']) ? (r['sets'] as Rec[])[at] : undefined;
        if (x === undefined) return 'without this setting';
        const to = typeof x['to'] === 'string' ? timed(x['to']) : figure({ ...x, unit: Q.get(String(x['quantity']))?.unit });
        return `sets ${timed(String(x['quantity']))} to ${to} ${start(x['starts_after_periods'] as number | string)}${typeof x['question'] === 'string' ? `, Olumi asks "${x['question']}"` : ''}`
          + `${x['author'] === 'structure' ? ', as a switch' : x['author'] !== r['author'] ? `, as ${of(WHO_WORDS, x['author'])}` : ''}${x['quote'] === r['quote'] ? '' : typeof x['quote'] === 'string' ? `, in your words "${x['quote']}"` : ', not in your words'}`;
      }
      case 'chance': return `with a chance of ${q('occurrence')}`;
      case 'effect': return r['mode'] === 'multiply' ? `multiplying ${q('effect_on')} by ${q('severity')}` : `adding ${q('severity')} to ${q('effect_on')}`;
      case 'starts': return start(r['starts_after_periods'] as number | string);
      case 'about': return list(r['concerns']).length > 0 ? `about ${and(list(r['concerns']))}` : 'about nothing in particular';
      case 'source': return typeof r['source'] === 'string' ? `from "${r['source']}"` : 'no source given';
      case 'bears': return of({ supports: 'in support', challenges: 'as a challenge', informs: 'for information' }, r['bears']);
      case 'applied': return r['applied'] === true ? 'applied in the model' : 'not applied in the model';
      case 'position': return `who says "${String(r['position'] ?? '')}"`;
      case 'why': return `left out because "${String(r['why'] ?? '')}"`;
      default: return `${group} (no plain words)`;
    }
  };
  /** An item's name on the card. */
  const title = (family: Family, r: Rec): string => String(family === 'relations' ? label(String(r['defines'])) : family === 'preferences' ? label(String(r['quantity']))
    : r['label'] ?? r['text'] ?? r['holder']);
  return { title, phrase, named };
}
