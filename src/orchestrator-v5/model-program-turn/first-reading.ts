/**
 * WHAT THE FIRST REPLY SAYS OLUMI USED, INFERRED AND LEFT OUT (Paul's definition of done): three lists read off the saved
 * model's own records, by their fields only (author, quote, status, measure_by, the left_out family), never from what any
 * words mean. No model call.
 *  · used: every item of theirs that quotes their words, except a figure its own status says nothing uses (not_applicable,
 *    unsupported), which is left out with its basis;
 *  · inferred: every record of Olumi's own, by its kind: its figures (an estimate, a reading of a stated date, or a size not
 *    known yet, never called an estimate), the measures it suggested, its links, risks and options, and its notes
 *    (assumptions, conditions, claims, evidence, disagreements);
 *  · left out: every left_out record, with its why.
 * In none of the three: a fixed part of the model's structure, Olumi's workings (its worked-out quantities, definitions and
 * running totals, and a figure of its own that nothing uses), and an item of theirs with no words yet (an asked figure: the
 * reply's questions).
 */
import { type CanonicalModelT, type QuantityStatusT } from '../model-program/canonical.js';
import { linkTargets, withUsedDirections } from '../model-program/links.js';

export type ReadingFamily = 'goals' | 'measures' | 'limits' | 'preferences' | 'options' | 'risks' | 'links' | 'relations' | 'claims' | 'evidence'
  | 'assumptions' | 'dissent' | 'conditions' | 'quantities' | 'left_out';
export interface ReadingItem {
  readonly family: ReadingFamily;
  /** The record's id (a link: its relation's id and position), for identity only: never said. */
  readonly id: string;
  readonly label: string;
  readonly status?: QuantityStatusT;
  /** A condition's own kind (prerequisite or challenge). */
  readonly kind?: string;
  /** A size not known yet: the direction the model uses, and the names of what it moves. */
  readonly direction?: 'raises' | 'lowers';
  readonly moves?: readonly string[];
  /** A suggested measure's aim, in their words. */
  readonly aim?: string;
  /** Why it is left out: the record's own words. */
  readonly why?: string | null;
}
export interface FirstReading { readonly used: readonly ReadingItem[]; readonly inferred: readonly ReadingItem[]; readonly leftOut: readonly ReadingItem[] }

type Attributed = { readonly id: string; readonly author: string; readonly quote: string | null };
const theirs = (r: Attributed) => r.author === 'person' && typeof r.quote === 'string' && r.quote.trim() !== '';
const UNUSED: ReadonlySet<QuantityStatusT> = new Set(['not_applicable', 'unsupported']);
/** Olumi's own figures: in hand (an estimate, or a reading of a stated date), or a size it cannot give yet. */
const OLUMI_FIGURES: ReadonlySet<QuantityStatusT> = new Set(['known', 'estimated', 'unknown']);

/** The three lists, in the model's order (what they want and could do first, then its links, notes and figures). */
export function firstReadingOf(saved: CanonicalModelT): FirstReading {
  // Directions as the model uses them (the host's one reading): a sign on a link it does not use is never said.
  const m = withUsedDirections(saved);
  const name = (id: string) => m.quantities.find((q) => q.id === id)?.label ?? id.replace(/_/g, ' ');
  const used: ReadingItem[] = [];
  const inferred: ReadingItem[] = [];
  const leftOut: ReadingItem[] = m.left_out.map((x) => ({ family: 'left_out', id: x.id, label: x.text, why: x.why }));
  const add = (family: ReadingFamily, r: Attributed, label: string, more: Partial<ReadingItem> = {}) => {
    if (theirs(r)) used.push({ family, id: r.id, label, ...more });
    else if (r.author === 'olumi') inferred.push({ family, id: r.id, label, ...more });
  };
  for (const g of m.goals) {
    add('goals', g, g.label);
    if (g.measure?.measure_by === 'olumi') inferred.push({ family: 'measures', id: g.id, label: name(g.measure.quantity), aim: g.label });
  }
  for (const x of m.limits) add('limits', x, x.label);
  for (const x of m.preferences) add('preferences', x, name(x.quantity));
  for (const x of m.options) add('options', x, x.label);
  for (const x of m.risks) add('risks', x, x.label);
  // An effect's assertions are its links, each with its own author; a definition or a running total is theirs when they
  // stated it, and otherwise Olumi's working, in no list.
  for (const r of m.relations) {
    if (r.form === 'effect') r.terms.forEach((t, i) => add('links', { ...t, id: `${r.id}#${i}` }, `${name(t.driver)} → ${name(r.defines)}`));
    else if (theirs(r)) used.push({ family: 'relations', id: r.id, label: name(r.defines) });
  }
  for (const x of m.claims) add('claims', x, x.text);
  for (const x of m.evidence) add('evidence', x, x.text);
  for (const x of m.assumptions) add('assumptions', x, x.text);
  for (const x of m.dissent) add('dissent', x, `${x.holder}: ${x.position}`);
  for (const x of m.conditions) add('conditions', x, x.text, { kind: x.kind });
  for (const q of m.quantities) {
    if (theirs(q) && UNUSED.has(q.status)) leftOut.push({ family: 'quantities', id: q.id, label: q.label, status: q.status, why: q.basis });
    else if (theirs(q)) used.push({ family: 'quantities', id: q.id, label: q.label, status: q.status });
    else if (q.author === 'olumi' && OLUMI_FIGURES.has(q.status)) inferred.push({ family: 'quantities', id: q.id, label: q.label, status: q.status,
      ...(q.status === 'unknown' && q.direction !== null ? { direction: q.direction, moves: linkTargets(m, q.id).map(name) } : {}) });
  }
  return { used, inferred, leftOut };
}

// ── PLACEHOLDER WORDING (option A) on this unmerged branch: Paul chooses the reply's wording and layout. ─────────────────────
const bare = (s: string) => s.trim().replace(/[.!?]+$/, '');
const and = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const OWN: Partial<Record<ReadingFamily, string>> = { goals: 'an aim I added', limits: 'a limit I added', preferences: 'a wish I added', options: 'an option I added',
  links: 'a link I added', risks: 'a risk I added', claims: 'a claim I made', evidence: 'evidence I noted', assumptions: 'an assumption I made', dissent: 'a disagreement I noted' };
const unsized = (x: ReadingItem) => `not sized yet${x.direction !== undefined && (x.moves ?? []).length > 0 ? `; it ${x.direction} ${and(x.moves!.map((n) => `‘${bare(n)}’`))}` : ''}`;
const ownOf = (x: ReadingItem) => (x.family === 'quantities' ? (x.status === 'estimated' ? 'my estimate' : x.status === 'unknown' ? unsized(x) : 'my reading')
  : x.family === 'measures' ? `a measure I suggested for ‘${bare(x.aim ?? '')}’`
    : x.family === 'conditions' ? (x.kind === 'prerequisite' ? 'a prerequisite I noted' : 'a challenge I raised') : OWN[x.family] ?? 'mine');
/** Three labelled lines: each list's count and its first `top` items, in the model's order. */
export function firstReadingLines(r: FirstReading, top = 3): string {
  const list = (xs: readonly ReadingItem[], say: (x: ReadingItem) => string) => (xs.length === 0 ? 'nothing'
    : and([...xs.slice(0, top).map(say), ...(xs.length > top ? [`${xs.length - top} more`] : [])]));
  return [`Used from your brief (${r.used.length}): ${list(r.used, (x) => `‘${bare(x.label)}’`)}.`,
    `Inferred by me, for you to check (${r.inferred.length}): ${list(r.inferred, (x) => `‘${bare(x.label)}’ (${ownOf(x)})`)}.`,
    `Left out (${r.leftOut.length}): ${list(r.leftOut, (x) => `‘${bare(x.label)}’${typeof x.why === 'string' && x.why.trim() !== '' ? ` (${bare(x.why)})` : ''}`)}.`].join('\n');
}
