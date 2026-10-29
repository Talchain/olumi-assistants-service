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
 * and who said it is unchanged: C6), and the history (each change and removal appended, with who said it and who approved it;
 * a figure typed on the canvas as entered, D074).
 */
import { ProposalChangeSchema, type ProposalChange } from '../agent-lane/proposal.js';
import { foldedInto, readingGroups } from './reading-groups.js';
import { CanonicalModel, CMP_WORDS, FIGURE_STATUSES, HOST_OWNED_FIELDS, type CanonicalModelT } from '../model-program/canonical.js';
import { inlineQuantityId, norm } from '../model-program/compile.js';
import { linkTargets } from '../model-program/links.js';
import { unitWords } from '../model-program/present/display-words.js';
import { placeFigure } from '../agent-lane/say-figure.js';

type Rec = Record<string, unknown>;
type Family = Exclude<keyof CanonicalModelT, 'version' | 'question' | 'title' | 'period' | 'coaching_questions' | 'history'>;
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
    ...by('influence', 'from', 'to', 'direction'), ...by('confidence', 'confidence'), ...by('basis', 'basis'),
    ...by('link#', ...WORDS.map((k) => `terms.*.${k}`)), ...OWN },
  goals: { ...by('name', 'label'), ...by('measure', ...MEASURE, 'measure.target', 'measure.frame', 'measure.reference.kind', 'measure.reference.option', 'measure.reference.quantity'),
    ...by('when', ...WHEN), ...by('measure_by', 'measure.measure_by'), ...by('rests', 'measure.assumptions.*'), ...by('excludes', 'measure.exclusions.*'), ...by('question', 'question'), ...OWN },
  limits: { ...by('name', 'label'), ...by('measure', ...MEASURE, 'measure.bound'), ...by('when', ...WHEN), ...by('question', 'question'), ...OWN },
  preferences: { ...by('name', 'quantity'), ...by('direction', 'direction'), ...OWN },
  options: { ...by('name', 'label'), ...by('status', 'status'), ...by('carry_on', 'carry_on'), ...by('variant', 'developed_from'),
    ...by('setting#', ...['quantity', 'to', 'value', 'low', 'high', 'range_kind', 'question', 'starts_after_periods', 'author', 'quote'].map((k) => `sets.*.${k}`)), ...OWN },
  risks: { ...by('name', 'label'), ...by('chance', 'occurrence'), ...by('effect', 'severity', 'effect_on', 'mode', 'direction'), ...by('starts', 'starts_after_periods'), ...OWN },
  claims: { ...by('name', 'text'), ...by('about', 'concerns.*'), ...OWN },
  evidence: { ...by('name', 'text'), ...by('source', 'source'), ...by('bears', 'bears'), ...by('about', 'concerns.*'), ...OWN },
  assumptions: { ...by('name', 'text'), ...by('applied', 'applied'), ...by('about', 'concerns.*'), ...OWN },
  dissent: { ...by('name', 'holder'), ...by('position', 'position'), ...by('about', 'concerns.*'), ...OWN },
  conditions: { ...by('name', 'text'), ...by('kind', 'kind'), ...by('about', 'concerns.*'), ...OWN },
  left_out: { ...by('name', 'text'), ...by('why', 'why'), ...by('question', 'question'), ...by('about', 'concerns.*'), ...OWN },
};

export type PostimageResult =
  | { readonly ok: true; readonly model: CanonicalModelT; readonly changes: readonly ProposalChange[] }
  | { readonly ok: false; readonly code: 'schema' | 'duplicate_id' | 'moved_record' | 'omitted_record' | 'removal_not_applied' | 'unknown_removal' | 'recycled_id' | 'figure_removed'
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
/** Per-item approval (D4): the listed records accepted by the approving person (`approved_by`); a tick says no new words, so who
 *  said each record stays as saved; every other record exactly as saved. */
export const withApproved = (m: CanonicalModelT, ids: ReadonlySet<string>, by: string | null): CanonicalModelT =>
  ({ ...m, ...Object.fromEntries(FAMILIES.map(([f]) => [f, (m[f] as readonly Rec[]).map((r) => (ids.has(String(r['id'])) ? accepted(r, by, [], r) : r))])) }) as CanonicalModelT;
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
 * A FIGURE THEY GAVE IS NEVER REMOVED (Paul 28 Oct, blocking; ALPHA plan item 3, his added change). Box 3's European simplify:
 * the agent listed his 400 customers, 8 % churn and £500k budget for removal as "a representation change", and a listed
 * removal was trusted, so they became notes and left the calculation. Their quantity with a figure in hand changes, or is
 * marked not applicable, on their word (its history keeps what it was); a removal listing it is refused, whoever lists it.
 * The ids in `ids` that are such figures in `saved`.
 */
export function theirFiguresIn(saved: CanonicalModelT, ids: readonly string[]): string[] {
  return ids.filter((id) => saved.quantities.some((q) => q.id === id && q.author === 'person' && FIGURE_STATUSES.has(q.status)));
}
/** The refusal's words, back to the agent, which proposes the change again keeping them. */
export function keepTheirFigures(saved: CanonicalModelT, ids: readonly string[]): string {
  const names = ids.map((id) => `‘${saved.quantities.find((q) => q.id === id)?.label ?? id}’`).join(', ');
  return `${names} ${ids.length > 1 ? 'are figures' : 'is a figure'} they gave: an update keeps a figure of theirs, changing it or marking it not applicable only on their word, and never removes it. Propose the change again without removing ${ids.length > 1 ? 'them' : 'it'}.`;
}

/**
 * Check `raw`, a whole proposed model, against the saved one. `removals`: the ids this change proposes to remove, listed
 * explicitly for the person to review on its card; `words`: every word of theirs this change may quote (their earlier words and `fresh`, this change's own);
 * `approver`: who approves the card (its items' approved_by), and the person whose words `fresh` are (in every caller the
 * same person: the turn's own); null for a guest. `entered`: only on a figure typed on the canvas (`applyCanvasFigure`), the id
 * of the one record whose figure the person typed, so its history entry says so (D074, C6).
 */
export function validatePostimage(saved: CanonicalModelT, raw: unknown,
  opts: { readonly removals: readonly string[]; readonly words: readonly string[]; readonly fresh: readonly string[]; readonly approver?: string | null;
    readonly entered?: string }): PostimageResult {
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
  const theirs = theirFiguresIn(base, [...removals]);
  if (theirs.length > 0) return refuse('figure_removed', theirs, keepTheirFigures(base, theirs));
  const omitted = FAMILIES.flatMap(([f]) => [...baseIn.get(f)!].filter((id) => !removals.has(id) && !idsOf(post, f).includes(id)));
  if (omitted.length > 0) return refuse('omitted_record', omitted, `The proposed model leaves out ${omitted.join(', ')} without a listed removal; nothing is removed unless the change lists it for their review.`);
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
      ...(typeof r['quote'] === 'string' ? [typeof r['party'] === 'string' ? `From ${r['party']}, in your words: “${r['quote']}”` : `Your words: “${r['quote']}”`]
        : typeof r['party'] === 'string' ? [`From ${r['party']}`] : [])]
      .reduce((said, part) => `${said}${/[.!?]$/.test(said) ? ' ' : '. '}${part}`);
    // A whole item added or removed: its name is the card's label and whose it is (theirs or Olumi's) the card's mark, so
    // neither is said again; a fixed part of the model's structure is said. W8 (c7.3, "a fact, known"): a whole figure is
    // not tagged with its kind, nor with a status its figure already says (a figure in hand, worked out, still to be given
    // or not known yet: "no figure yet"); a compared option is not called "compared". A CHANGE of kind or status is still said.
    const SAID_BY_FIGURE: ReadonlySet<unknown> = new Set(['known', 'derived', 'asked', 'unknown']);
    // An unmeasured factor (unit null) has no figure to say its status, so its status is said (Box 1a).
    const onCard = (x: ReturnType<typeof said>[number], r: Rec) => x.group === 'name' || (x.group === 'author' && r['author'] !== 'structure')
      || (family === 'quantities' && (x.group === 'kind' || (x.group === 'status' && SAID_BY_FIGURE.has(r['status']) && r['unit'] !== null)))
      || (family === 'options' && x.group === 'status' && r['status'] === 'live');
    const phrase = (fields: ReturnType<typeof said>, side: 'old' | 'now', r: Rec, whole: boolean) =>
      [...new Set(fields.filter((x) => !(whole && onCard(x, r))).map((x) => x[side]).filter((x) => x !== ''))].join(', ');
    // W8 run 4 (c7.1, said once: "→ worded" the row's own heading; a risk named in their words, then "in your words" the same
    // words): the row's label is the item's name as it now stands, so the side that ends there does not say it again. A changed
    // name keeps its old words on the before side ("(was: named …)" when nothing else changed); words that are the label are
    // said as theirs without being quoted twice. Words only: the validator's per-group checks above are untouched.
    const unrepeated = (fields: ReturnType<typeof said>, side: 'old' | 'now', r: Rec, label: string, renamed: boolean) => fields.map((x) =>
      renamed && x.group === 'name' && (x[side] === `named "${label}"` || x[side] === `worded "${label}"`) ? { ...x, [side]: '' }
        : x.group === 'words' && r['quote'] === label && x[side].endsWith(` "${label}"`) ? { ...x, [side]: x[side].slice(0, -(label.length + 3)) } : x);
    // W3b: each row says its family, a fixed part of the structure as such, and a figure still to be given as asked.
    const entry = (id: string, action: ProposalChange['action'], fields: ReturnType<typeof said>, label: string, author: ProposalChange['author'], r: Rec): ProposalChange => {
      const after = action === 'change' ? phrase(unrepeated(fields, 'now', r, label, true), 'now', r, false) : null;
      return { id, kind, action, label,
        before: action === 'add' ? null : phrase(action === 'remove' ? unrepeated(fields, 'old', r, label, false) : fields, 'old', r, action === 'remove'),
        after: action === 'remove' ? null : action === 'add' && family === 'left_out' ? leftOut(r) : action === 'add' ? phrase(unrepeated(fields, 'now', r, label, false), 'now', r, true)
          : after === '' ? null : after, author,
        family: ROW_FAMILY[family], ...(r['author'] === 'structure' ? { structure: true as const } : {}),
        ...(family === 'quantities' && r['status'] === 'asked' ? { asked: true as const } : {}) };
    };
    const records = (post[family] as readonly Rec[]).map((r) => {
      const old = before.get(String(r['id']));
      const fields = said(String(r['id']), old, r);
      // Unchanged but for what the host owns: the saved record, exactly.
      if (old !== undefined && fields.length === 0 && !unshown.some((u) => u.startsWith(`${String(r['id'])} (`))) return old;
      const record = accepted(r, opts.approver ?? null, opts.fresh, old) as Rec;
      changes.push(entry(String(r['id']), old === undefined ? 'add' : 'change', fields, now.title(family, record), authorOf(record), r));
      // D074 (C6): the figure the person typed on the canvas (`entered`) is recorded as entered, on an existing record (the record
      // it replaced in `old`) and on a goal's target that edit split off (`old` "null": it replaced none). Every other change to a
      // saved record is superseded, and any other added record has no entry, as before.
      const entered = opts.entered !== undefined && String(r['id']) === opts.entered;
      if (old !== undefined || entered) history.push({ id: String(r['id']), change: entered ? 'entered' : 'superseded', old: JSON.stringify(old ?? null),
        quote: typeof r['quote'] === 'string' ? r['quote'] : null, author_id: typeof record['author_id'] === 'string' ? record['author_id'] : null, approved_by: opts.approver ?? null });
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
  // Box 2 (Paul Q1/Q2, 28 Oct): Olumi's questions, refreshed or cleared by an update, are ONE entry with both lists in full, in
  // their order; none reads "No questions", never null (null reads as an add or a removal).
  const asked = (qs: readonly string[]) => (qs.length === 0 ? 'No questions' : qs.map((x, i) => `${i + 1}. ${x}`).join('\n'));
  if (JSON.stringify(base.coaching_questions) !== JSON.stringify(post.coaching_questions)) {
    changes.push({ id: 'coaching_questions', kind: 'record', action: 'change', label: 'Olumi’s questions for you',
      before: asked(base.coaching_questions), after: asked(post.coaching_questions), author: 'olumi' });
  }
  if (changes.length === 0) return refuse('no_change', [], 'The proposed model is the saved one: nothing changes.');
  // W8 (c7.1, c7.7: "Total weekly support capacity" on two lines; "Add one specialist: Additional specialists" under "Add one
  // specialist"): a figure added with the row that says it is ONE line. A worked-out figure's unit and reading join its
  // relation's line; an option's own setting is said, figure and all, on the option's line. Only where both are added on this
  // card (`foldedInto`, the same map the first reply counts), so a later change to the figure alone still has its own line.
  const fold = foldedInto(post);
  const adds = new Map(changes.filter((c) => c.action === 'add').map((c) => [c.id, c] as const));
  const onOwnLine = (c: ProposalChange) => c.action !== 'add' || !adds.has(fold.get(c.id) ?? '');
  const shownChanges = changes.filter(onOwnLine).map((c) => {
    const joined = c.action === 'add' && c.kind === 'relation' ? changes.filter((x) => !onOwnLine(x) && fold.get(x.id) === c.id && (x.after ?? '') !== '') : [];
    return joined.length === 0 ? c : { ...c, after: [c.after, ...joined.map((x) => x.after)].filter((x) => x !== null && x !== '').join(', ') };
  });
  // Every entry as the card reads it (one contract): an entry the card could not show refuses the proposal, never drops.
  const invalid = [...new Set([...changes, ...shownChanges].filter((c) => !ProposalChangeSchema.safeParse(c).success).map((c) => c.id))];
  if (invalid.length > 0) return refuse('invalid_change_entry', invalid, `The card cannot show ${invalid.join(', ')} (an item needs a name); nothing is proposed.`);
  return { ok: true, model: { ...post, ...families, history }, changes: shownChanges };
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
/** Each value of a field said in plain words: the one phrase table (never an operator or a code on the card); a
 *  comparison's words are the model's own table (`CMP_WORDS`), shared with the canvas's limit cards. */
const RANGE_WORDS: Record<string, string> = { bounds: 'firm ends', plausible: 'a plausible range' };
/** A link's direction, before the name of what it moves (Paul 24 Oct, "Arrow + words": "↓ lowers Churn"). */
const DIRECTION_WORDS: Record<string, string> = { raises: '↑ raises', lowers: '↓ lowers' };
/** A link in words (Box 1a): its verb between what moves and what it moves, and what follows when no way is settled. */
const INFLUENCE_WORDS: Record<string, readonly [string, string]> = { up: ['↑ raises', ''], down: ['↓ lowers', ''], unknown: ['affects', ', in a direction not known yet'],
  conditional: ['affects', ', depending on conditions'], disputed: ['affects', ', in a disputed direction'] };
const CONFIDENCE_WORDS: Record<string, string> = { likely: 'judged likely', unsure: 'judged unsure', unknown: 'how sure is not known' };
/** A risk's direction on what it acts on, if it happens. */
const RISK_WAY: Record<string, string> = { up: '↑ raising it', down: '↓ lowering it', unknown: 'in a direction not known yet' };
const WHO_WORDS: Record<string, string> = { person: 'yours', olumi: 'Olumi’s', structure: 'part of how the model is set up' };
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
  /** W8 (c7.3, "ticket/week/specialist"): a figure with its unit as a person writes it ("80 tickets per week", "£20 per
   *  customer per month", "5%"), and a range's ends with the unit said once ("10 to 30 tickets per specialist per week"). */
  const withUnit = (x: number, u: unknown) => placeFigure(n(x), unitWords(u, x));
  const between = (lo: number, hi: number, u: unknown, sep = ' to ') => {
    const [pre = '', post = ''] = placeFigure('#', unitWords(u)).split('#');
    return `${pre}${n(lo)}${post.startsWith('%') ? '%' : ''}${sep}${withUnit(hi, u)}`;
  };
  /** A quantity as it is referred to: by name, with its value or range, or that it is asked; its unit alone is on its own line. */
  const timed = (id: string) => {
    const q = Q.get(id);
    return q === undefined ? `"${id}"` : q.status === 'asked' ? `"${q.label}" (still to be given)` : q.status === 'derived' ? `"${q.label}"`
      : `"${q.label}" ${q.low !== null && q.high !== null ? between(q.low, q.high, q.unit, '–') : q.value !== null ? withUnit(q.value, q.unit) : '(no figure yet)'}`;
  };
  /** An item by name only: what a calculation is worked out from (each figure is on its own line, W8 c7.7); a figure that
   *  shares its name with another is told apart by its figure, so a link moved between the two still shows. */
  const nm = (id: unknown) => {
    const q = Q.get(String(id));
    return q !== undefined && m.quantities.some((x) => x.id !== q.id && x.label === q.label) ? timed(q.id) : `"${named(String(id))}"`;
  };
  /** A target or bound an option sets to another figure: its name only, as the results say it (#3722); its figure is on its own item. */
  const bound = (id: string) => (m.options.some((o) => o.sets.some((s) => s.quantity === id)) ? `"${named(id)}"` : timed(id));
  const start = (t: number | string) => (typeof t === 'number' ? (t === 0 ? 'from the start' : `after ${t} ${m.period}s`) : `from ${timed(t)}`);
  const list = (ids: unknown) => (Array.isArray(ids) ? ids.map((id) => `"${named(String(id))}"`) : []);
  const and = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  /** A figure from its value, range, reading and unit, all together, and a link's direction on what it moves (issue 40). */
  const figure = (r: Rec) => {
    // The unit alone, as a person writes it: "tickets per week", "£ per oven", "%".
    const u = placeFigure('', unitWords(r['unit'])).trim(), at = (k: string) => (typeof r[k] === 'number' ? withUnit(r[k] as number, r['unit']) : null);
    const bare = (k: string) => n(r[k] as number);
    // What it moves is said by name; a direction on a size no link has is said alone, so its change shows (B3 off the path).
    const moves = typeof r['direction'] === 'string' && typeof r['id'] === 'string' ? linkTargets(m, r['id']) : [];
    const sign = (said: string) => [said, ...(typeof r['direction'] === 'string' ? [`${of(DIRECTION_WORDS, r['direction'])}${moves.length > 0 ? ` ${and(moves.map(label))}` : ''}`] : [])].filter((x) => x !== '').join(', ');
    // alpha G2: what it can be is Olumi's reading, said as such, so a change to it shows.
    const can = [...(at('floor') !== null ? [`never below ${bare('floor')}`] : []), ...(at('ceiling') !== null ? [`never above ${bare('ceiling')}`] : [])];
    const reading = (typeof r['range_kind'] === 'string' ? ` (${of(RANGE_WORDS, r['range_kind'])})` : '') + (can.length > 0 ? ` (${can.join(', ')}: Olumi’s reading)` : '');
    // Box 1a: an unmeasured factor (unit null) is said as such, never as a figure of no unit.
    const unmeasured = r['unit'] === null ? ', not measured' : '';
    if (at('low') !== null && at('high') !== null) return sign(`from ${between(r['low'] as number, r['high'] as number, r['unit'])}${at('value') !== null ? `, most likely ${bare('value')}` : ''}${unmeasured}${reading}`);
    const ends = [...(at('low') !== null ? [`no lower than ${at('low')}`] : []), ...(at('high') !== null ? [`no higher than ${at('high')}`] : [])].join(', ');
    // A worked-out figure has no figure of its own to give: only its unit.
    // W8 run 4 (c7.3, "no figure yet (in per week)"): a unit that is itself a rate is said as one ("per week").
    const inU = u.startsWith('per ') ? u : `in ${u}`;
    const none = unmeasured !== '' ? '' : r['status'] === 'derived' ? (u === '' ? '' : inU) : `no figure yet${u === '' ? '' : ` (${inU})`}`;
    return sign(([at('value') ?? none, ...(ends === '' ? [] : [ends]), ...(unmeasured === '' ? [] : ['not measured'])].filter((x) => x !== '').join(', ') + reading).trim());
  };
  /** Whose words an item is in: the person's own, or someone they report, by name. */
  // W8 faithful (dev H03, R3/R5: "in CFO’s words" over the person's own sentence about the CFO): a quote is always the person's
  // own words (C6 checks it against what they wrote); a party is whom they report, named first ("from our supplier").
  const words = (r: Rec) => (typeof r['quote'] === 'string' ? `${typeof r['party'] === 'string' ? `from ${r['party']}, ` : ''}in your words "${r['quote']}"`
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
      case 'status': return family === 'options' ? of({ live: 'in the comparison', ruled_out: 'ruled out, kept in view', removed: 'taken out of the comparison' }, r['status'])
        : of({ known: 'known', estimated: 'an estimate', asked: 'still to be given', derived: 'worked out from the model', unknown: 'not known yet', not_applicable: 'does not apply',
          unsupported: 'outside what the model can use' }, r['status']) + (family === 'quantities' && r['unit'] === null ? ', not measured' : '');
      case 'question': return typeof r['question'] === 'string' ? `Olumi asks "${r['question']}"` : 'no question';
      case 'basis': return typeof r['basis'] === 'string' ? `based on "${r['basis']}"` : 'no basis given';
      case 'author': return of(WHO_WORDS, r['author']);
      case 'words': return words(r);
      case 'how': {
        // W8 (c7.7, "X is Y 0 multiplied by Z"): how it is worked out, in one short sentence, by name only: what it works out
        // is the line's own name, and each figure it uses is on that figure's line.
        const parts = Array.isArray(r['parts']) ? (r['parts'] as Rec[]) : [];
        const terms = Array.isArray(r['terms']) ? (r['terms'] as Rec[]) : [];
        const ids = (v: unknown) => (Array.isArray(v) ? v.map(nm) : []);
        if (r['form'] === 'influence') return ''; // a link in words is said by what it joins (`influence`), never worked out
        if (r['form'] === 'effect') return `starts from ${nm(r['base'])}${terms.map((t, i) => `${i === 0 ? ' and changes' : ', and'} by ${nm(t['coefficient'])} for each ${nm(t['driver'])}`).join('')}`;
        if (r['form'] === 'stock') {
          const moves = [...(ids(r['inflows']).length > 0 ? [`adds ${and(ids(r['inflows']))}`] : []), ...(ids(r['outflows']).length > 0 ? [`takes away ${and(ids(r['outflows']))}`] : [])];
          return `a running total that starts at ${nm(r['start'])}${moves.length > 0 ? ` and ${moves.join(' and ')} each ${m.period}` : ''}`;
        }
        if (r['form'] !== 'definition') return 'no calculation';
        const said = parts.map((x, i) => (r['op'] === 'product'
          ? `${i === 0 ? (x['power'] === -1 ? 'one divided by ' : '') : x['power'] === -1 ? ' divided by ' : ' multiplied by '}${nm(x['id'])}`
          : `${i === 0 ? (x['sign'] === -1 ? 'minus ' : '') : x['sign'] === -1 ? ' minus ' : ' plus '}${nm(x['id'])}`)).join('');
        return `worked out as ${said}`;
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
        if (w === null) return agg === 'end' ? '' : of(AGG_ALONE, agg);
        return `${of(AGG_WORDS, agg)} ${timed(String(w['periods']))}${typeof w['start'] === 'number' && w['start'] > 0 ? `, starting after ${w['start']} ${m.period}s` : ''}`
          + `${typeof w['origin_event'] === 'string' ? `, counted from "${w['origin_event']}"` : ''}${typeof w['origin_offset'] === 'string' ? `, which is ${timed(w['origin_offset'])} from the start of this model` : ''}`;
      });
      case 'measure_by': return measured(r, (mm) => (mm['measure_by'] === 'olumi' ? 'Olumi’s suggested measure' : 'the measure you named'));
      case 'rests': return measured(r, (mm) => (list(mm['assumptions']).length > 0 ? `resting on ${and(list(mm['assumptions']))}` : 'resting on nothing stated'));
      case 'excludes': return measured(r, (mm) => (list(mm['exclusions']).length > 0 ? `leaving out ${and(list(mm['exclusions']))}` : 'leaving nothing out'));
      case 'direction': return of({ lower: 'lower is better', higher: 'higher is better' }, r['direction']);
      case 'variant': return typeof r['developed_from'] === 'string' ? `a variant of "${named(r['developed_from'])}"` : 'not a variant of another option';
      case 'setting#': {
        // W8 (c7.7, "compared, sets X 0 to Option: X 1"): what the option changes, said once: the figure it sets, by name, to
        // the figure this option gives it (its own setting, said here rather than by that setting's own name), or to the
        // figure it is set from; an on/off switch is set to yes or no.
        const x = Array.isArray(r['sets']) ? (r['sets'] as Rec[])[at] : undefined;
        if (x === undefined) return 'without this setting';
        const target = Q.get(String(x['quantity']));
        const own = typeof x['to'] === 'string' && x['to'] === inlineQuantityId(String(r['id']), String(x['quantity'])) ? Q.get(x['to']) : undefined;
        const given: Rec | undefined = own ?? (typeof x['to'] === 'string' ? undefined : { ...x, unit: target?.unit });
        const point = given !== undefined && given['low'] == null && given['high'] == null && (given['value'] === 0 || given['value'] === 1) ? given['value'] : undefined;
        const onOff = point !== undefined && target !== undefined && unitWords(target.unit) === '' && (target.value === 0 || target.value === 1)
          && (target.ceiling === 1 || target.author === 'structure');
        // W8 run 3 (qualitative, no reading card: unshown_change on `sets.0.to`; 3 of 9 saved first drafts): an own setting
        // with no figure is said with its status, in the quantity row's own words (an asked one keeps its row and asks there,
        // `foldedInto`). Said as "no figure yet", it read the same as a figure given on this line, so `to` could not be shown.
        const open = own !== undefined && own['value'] == null && own['low'] == null && own['high'] == null
          ? ({ asked: 'a figure still to be given', unknown: 'a figure not known yet', not_applicable: 'no figure, as it does not apply',
            unsupported: 'no figure the model can use' } as Record<string, string>)[String(own['status'])] : undefined;
        const to = onOff ? (point === 1 ? 'yes' : 'no') : open !== undefined ? figure(own!).replace(/^no figure yet/, open)
          : given !== undefined ? figure(given) : timed(String(x['to']));
        return `sets ${nm(x['quantity'])} to ${to} ${start(x['starts_after_periods'] as number | string)}${typeof x['question'] === 'string' ? `, Olumi asks "${x['question']}"` : ''}`
          + `${x['author'] === 'structure' ? `, as ${WHO_WORDS['structure']}` : x['author'] !== r['author'] ? `, as ${of(WHO_WORDS, x['author'])}` : ''}`
          + `${x['quote'] === r['quote'] ? '' : typeof x['quote'] === 'string' ? `, in your words "${x['quote']}"` : x['author'] === 'structure' ? '' : ', not in your words'}`;
      }
      // Box 1a: a link in words, by what it joins, which way and how sure; and a risk no one can size, or one on an aim, a
      // limit or an option, with what is not known yet and its own direction (a sized risk's sign is its severity's).
      case 'influence': {
        const [verb, tail] = INFLUENCE_WORDS[String(r['direction'])] ?? ['affects', ''];
        return `${nm(r['from'])} ${verb} ${nm(r['to'])}${tail}`;
      }
      case 'confidence': return of(CONFIDENCE_WORDS, r['confidence']);
      case 'carry_on': return r['carry_on'] === true ? 'carries on as now' : '';
      case 'chance': return typeof r['occurrence'] === 'string' ? `with a chance of ${q('occurrence')}` : 'with a chance not known yet';
      case 'effect': {
        const on = Q.has(String(r['effect_on'])) ? q('effect_on') : nm(r['effect_on']);
        const size = typeof r['severity'] === 'string' ? q('severity') : 'a size not known yet';
        const how = r['mode'] === 'multiply' ? `multiplying ${on} by ${size}` : r['mode'] === 'add' ? `adding ${size} to ${on}` : `affecting ${on}, by ${size}`;
        const sized = typeof r['occurrence'] === 'string' && typeof r['severity'] === 'string' && typeof r['mode'] === 'string' && Q.has(String(r['effect_on']));
        const way = r['direction'] === 'unknown' && sized ? '' : RISK_WAY[String(r['direction'])] ?? '';
        return [...(typeof r['occurrence'] === 'string' ? [] : ['with a chance not known yet']), how, way].filter((x) => x !== '').join(', ');
      }
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
  const title = (family: Family, r: Rec): string => String(family === 'relations' ? (r['form'] === 'influence' ? `${named(String(r['from']))} → ${named(String(r['to']))}` : label(String(r['defines'])))
    : family === 'preferences' ? label(String(r['quantity'])) : r['label'] ?? r['text'] ?? r['holder']);
  return { title, phrase, named };
}
