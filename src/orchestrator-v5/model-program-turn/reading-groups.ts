/**
 * WHAT THE FIRST REPLY COUNTS (alpha G13; Paul 26 Oct: the itemised lists were "all too long"). Each record on the reading
 * card is in one group, read off its own fields only (author, quote, status, measure_by, its family), never from what its
 * words mean:
 *  · used: theirs, in their words (a figure whose own status says nothing uses it is left out instead);
 *  · inferred: it holds something Olumi added, for them to check (Olumi's record, a link Olumi drew, a measure Olumi
 *    suggested for their aim, an estimate, a reading of a date they gave, or a size not known yet);
 *  · left_out: a left-out note, or a figure of theirs the model cannot use;
 *  · other: the model's structure, Olumi's workings (worked-out figures, definitions, running totals) and a figure still to
 *    be given (the reply's questions ask for those).
 * The reply's counts and the card's groups are this ONE map, so tapping a count shows exactly that many rows.
 */
import { type CanonicalModelT, type QuantityStatusT } from '../model-program/canonical.js';

export type ReadingGroup = 'used' | 'inferred' | 'left_out' | 'other';

type Attributed = { readonly author: string; readonly quote: string | null };
const theirs = (r: Attributed) => r.author === 'person' && typeof r.quote === 'string' && r.quote.trim() !== '';
const UNUSED: ReadonlySet<QuantityStatusT> = new Set(['not_applicable', 'unsupported']);
/** Olumi's own figures: in hand (an estimate, or a reading of a stated date), or a size it cannot give yet. */
const OLUMI_FIGURES: ReadonlySet<QuantityStatusT> = new Set(['known', 'estimated', 'unknown']);

/** Every record's group, by its id (ids are unique across the model's families). */
export function readingGroups(model: CanonicalModelT): ReadonlyMap<string, ReadingGroup> {
  const groups = new Map<string, ReadingGroup>();
  const own = (r: Attributed): ReadingGroup => (theirs(r) ? 'used' : r.author === 'olumi' ? 'inferred' : 'other');
  for (const x of model.left_out) groups.set(x.id, 'left_out');
  for (const g of model.goals) groups.set(g.id, g.measure?.measure_by === 'olumi' ? 'inferred' : own(g));
  for (const x of [...model.limits, ...model.preferences, ...model.options, ...model.risks, ...model.claims, ...model.evidence,
    ...model.assumptions, ...model.dissent, ...model.conditions]) groups.set(x.id, own(x));
  // An effect's links each have an author: one of Olumi's makes the row Olumi's to check. A definition or a running total is
  // theirs when they stated it, and otherwise Olumi's working.
  for (const r of model.relations) {
    groups.set(r.id, r.form === 'effect' && r.terms.some((t) => t.author === 'olumi') ? 'inferred'
      : (r.form === 'effect' && r.terms.some(theirs)) || theirs(r) ? 'used' : 'other');
  }
  for (const q of model.quantities) {
    groups.set(q.id, theirs(q) ? (UNUSED.has(q.status) ? 'left_out' : 'used') : q.author === 'olumi' && OLUMI_FIGURES.has(q.status) ? 'inferred' : 'other');
  }
  return groups;
}

/** The first reply's one line: how many records are theirs, Olumi's to check, and left out. None of any: no line. */
export function readingLine(groups: ReadonlyMap<string, ReadingGroup>): string | null {
  const count = (g: ReadingGroup) => [...groups.values()].filter((x) => x === g).length;
  const used = count('used'), mine = count('inferred'), out = count('left_out');
  const parts = [
    ...(used > 0 ? [`used ${used} ${used === 1 ? 'thing' : 'things'} from your brief`] : []),
    ...(mine > 0 ? [`added ${mine} of my own for you to check`] : []),
    ...(out > 0 ? [`left ${out} out of the calculation`] : []),
  ];
  if (parts.length === 0) return null;
  return `I ${parts.length === 1 ? parts[0] : parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts[0]}, ${parts[1]}, and ${parts[2]}`}.`;
}
