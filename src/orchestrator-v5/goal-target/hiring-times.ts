/**
 * ⭐ E5 (Paul's manual test, 12 Oct 2026): the hiring times the user states for each option, read from their own words and
 * written into the option's EXISTING capacity carriers (`observed_state.extra_share_by_date`, passthrough at every schema).
 * "Two developers, one within 2 months and another a month or so later" is TWO parts (a second switch factor with its own
 * carrier, the construction's own per-part shape), summed by the chance, never averaged into one start.
 *
 * Each bound records whose figure it is (`figures.<bound> = {value, origin, quote}`); a bound the user did not give stays
 * Olumi's, labelled. `olumi_estimate` keeps the option's own estimate so a later statement is mapped against Olumi's figure,
 * never against an earlier answer. Rules (DL + AIE S8 rule set, 12 Oct):
 * - "at least N": soonest N (yours); latest Olumi's, refused when Olumi's latest is below N;
 * - "within N": latest N (yours); soonest min(Olumi's soonest, N) (Olumi's);
 * - "about N" / "in N" / "N or so": N to N (yours); "N–M": N to M (yours);
 * - "another M later": the previous start shifted by M, yours only where both figures are yours.
 * The pace stays Olumi's estimate, split equally across the option's starts.
 */
import { extraShareMoments } from './event-by-date-share.js';
import { timeBetween } from './deadline-date.js';
import { withEventShareDate } from './event-by-date-model.js';
import { goalDeadlineFromRecord } from './goal-kind.js';
import { isDeepStrictEqual } from 'node:util';

type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export type HiringForm =
  | { readonly kind: 'at_least'; readonly months: number } | { readonly kind: 'within'; readonly months: number }
  | { readonly kind: 'about'; readonly months: number } | { readonly kind: 'after_previous'; readonly months: number }
  | { readonly kind: 'range'; readonly low: number; readonly high: number };
export interface Figure { readonly value: number; readonly origin: 'user' | 'olumi'; readonly quote?: string }
export interface PlannedPart { readonly lead_low: Figure; readonly lead_high: Figure; readonly monthly_share: Figure }
export interface PlannedOption {
  readonly option_id: string;
  readonly label: string;
  /** The ids of the option's parts as offered, first to last; a new part's id is minted from the first. */
  readonly part_ids: readonly string[];
  /** The carriers the card was offered against: a change to any of them supersedes the card. */
  readonly expected: readonly unknown[];
  readonly olumi_estimate: { readonly lead_low: number; readonly lead_high: number; readonly monthly_share: number };
  readonly parts: readonly PlannedPart[];
  readonly quotes: readonly string[];
}
export interface ApprovedHiringTimes {
  readonly goal_id: string;
  readonly deadline: string;
  readonly reference_date: string;
  readonly options: readonly PlannedOption[];
}

export const MAX_STARTS_PER_OPTION = 2;

const NUMBER_WORDS: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUM = '(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const months = (s: string): number => NUMBER_WORDS[s] ?? Number(s);

export function plainWords(t: string): string {
  return t.toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

/** One start time from the user's own words, in months; null when the words hold none or more than one reading. */
export function readHiringStart(quote: string): HiringForm | null {
  const q = plainWords(quote);
  const after = new RegExp(`\\b(?:another|then|the (?:other|second|next)|a second|one more)\\b.*?\\b${NUM} (?:more )?months?\\b(?: or so)? (?:later|after(?:wards)?)\\b`).exec(q);
  if (after) return { kind: 'after_previous', months: months(after[1]!) };
  const forms: HiringForm[] = [];
  const range = new RegExp(`\\b${NUM} ?(?:-|to) ?${NUM} months?\\b`).exec(q);
  if (range) forms.push({ kind: 'range', low: months(range[1]!), high: months(range[2]!) });
  const least = new RegExp(`\\b(?:at least|no (?:sooner|earlier) than|a minimum of|not before) ${NUM} months?\\b|\\b${NUM} ?(?:\\+|or more) months?\\b`).exec(q);
  if (least) forms.push({ kind: 'at_least', months: months((least[1] ?? least[2])!) });
  const within = new RegExp(`\\b(?:within|in under|under|less than|up to|no (?:more|longer) than|at most) ${NUM} months?\\b`).exec(q);
  if (within) forms.push({ kind: 'within', months: months(within[1]!) });
  if (forms.length === 0) {
    const about = new RegExp(`\\b${NUM} months?\\b`).exec(q);
    if (about && new RegExp(`\\b${NUM} months?\\b.*\\b${NUM} months?\\b`).test(q)) return null;
    if (about) forms.push({ kind: 'about', months: months(about[1]!) });
  }
  if (forms.length !== 1) return null;
  const f = forms[0]!;
  const ok = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 60;
  return f.kind === 'range' ? (ok(f.low) && ok(f.high) && f.high > f.low ? f : null) : ok(f.months) ? f : null;
}

/** The quote is the user's, in this message, as whole words; its sentence names the option (a label word, not "hire"). */
const GENERIC = new Set(['hire', 'hiring', 'hired', 'the', 'and', 'add', 'adds', 'more', 'new', 'extra', 'capacity', 'option', 'with', 'for', 'get',
  ...Object.keys(NUMBER_WORDS)]);
const stem = (w: string): string => w.replace(/(?:es|s)$/, '');
export function quoteStatedFor(message: string, quote: string, optionLabel: string): 'ok' | 'not_stated' | 'not_for_option' {
  const text = plainWords(message), q = plainWords(quote);
  if (q === '') return 'not_stated';
  const at = new RegExp(`(?:^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u').exec(text);
  if (at === null) return 'not_stated';
  const start = Math.max(text.lastIndexOf('. ', at.index), text.lastIndexOf('? ', at.index), text.lastIndexOf('! ', at.index)) + 1;
  const ends = ['. ', '? ', '! '].map(e => text.indexOf(e, at.index + at[0].length)).filter(i => i >= 0);
  const sentence = text.slice(start, ends.length === 0 ? text.length : Math.min(...ends));
  const words = new Set((sentence.match(/\p{L}+/gu) ?? []).map(stem));
  const named = (plainWords(optionLabel).match(/\p{L}+/gu) ?? []).filter(w => w.length >= 3 && !GENERIC.has(w)).map(stem);
  return named.some(w => words.has(w)) ? 'ok' : 'not_for_option';
}

/** The option's capacity parts, first to last (the order of their links into the goal). */
export function capacityPartsOf(graph: unknown, optionId: string, goalId: string): Rec[] {
  if (!rec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return [];
  const option = graph.nodes.find((n: Rec) => n.id === optionId && n.kind === 'option');
  if (!option || !rec(option.interventions)) return [];
  const on = (id: string): boolean => { const v = option.interventions[id]; return (rec(v) ? v.value : v) === 1; };
  return graph.edges.filter((e: Rec) => e.to === goalId).map((e: Rec) => graph.nodes.find((n: Rec) => n.id === e.from))
    .filter((n: Rec | undefined): n is Rec => n !== undefined && rec(n.observed_state?.extra_share_by_date) && on(n.id));
}

const olumi = (value: number): Figure => ({ value, origin: 'olumi' });
const yours = (value: number, quote: string): Figure => ({ value, origin: 'user', quote });

export type PlanRefusal = { readonly refusal: 'start_unreadable' | 'first_start_relative' | 'too_many_starts'
  | 'fewer_starts_than_held' | 'least_beyond_latest'; readonly quote?: string; readonly months?: number; readonly latest?: number };

/** The option's planned parts from the user's starts and Olumi's estimate; the pace split equally. */
export function planStarts(quotes: readonly string[], estimate: PlannedOption['olumi_estimate'], heldParts: number):
  { readonly parts: PlannedPart[] } | PlanRefusal {
  if (quotes.length === 0 || quotes.length > MAX_STARTS_PER_OPTION) return { refusal: 'too_many_starts' };
  if (quotes.length < heldParts) return { refusal: 'fewer_starts_than_held' };
  const pace = estimate.monthly_share / quotes.length;
  const parts: PlannedPart[] = [];
  for (const [i, quote] of quotes.entries()) {
    const form = readHiringStart(quote);
    if (form === null) return { refusal: 'start_unreadable', quote };
    let low: Figure, high: Figure;
    if (form.kind === 'after_previous') {
      const prev = parts[i - 1];
      if (prev === undefined) return { refusal: 'first_start_relative', quote };
      const shift = (f: Figure): Figure => f.origin === 'user' ? yours(f.value + form.months, quote) : olumi(f.value + form.months);
      low = shift(prev.lead_low); high = shift(prev.lead_high);
    } else if (form.kind === 'at_least') {
      if (estimate.lead_high < form.months) return { refusal: 'least_beyond_latest', quote, months: form.months, latest: estimate.lead_high };
      low = yours(form.months, quote); high = olumi(estimate.lead_high);
    } else if (form.kind === 'within') {
      low = olumi(Math.min(estimate.lead_low, form.months)); high = yours(form.months, quote);
    } else if (form.kind === 'about') {
      low = yours(form.months, quote); high = yours(form.months, quote);
    } else {
      low = yours(form.low, quote); high = yours(form.high, quote);
    }
    parts.push({ lead_low: low, lead_high: high, monthly_share: olumi(pace) });
  }
  return { parts };
}

/** Olumi's own estimate for the option: the first part's recorded estimate, else its carrier as Olumi wrote it. */
export function olumiEstimateOf(parts: readonly Rec[]): PlannedOption['olumi_estimate'] | null {
  const first = parts[0]?.observed_state?.extra_share_by_date;
  if (!rec(first)) return null;
  const e = rec(first.olumi_estimate) ? first.olumi_estimate : first;
  const total = rec(first.olumi_estimate) ? e.monthly_share
    : parts.reduce((s, p) => s + Number(p.observed_state.extra_share_by_date.monthly_share), 0);
  const est = { lead_low: Number(e.lead_low), lead_high: Number(e.lead_high), monthly_share: total };
  return Object.values(est).every(Number.isFinite) && est.lead_low >= 0 && est.lead_high >= est.lead_low
    && est.monthly_share >= 0 && est.monthly_share <= 100 ? est : null;
}

/** The carrier a planned part becomes; numbers are the computation's, `figures` say whose each one is. */
function carrierOf(prior: Rec, part: PlannedPart, a: ApprovedHiringTimes, estimate: PlannedOption['olumi_estimate']): Rec {
  return { ...prior, monthly_share: part.monthly_share.value, lead_low: part.lead_low.value, lead_high: part.lead_high.value,
    deadline: a.deadline, reference_date: a.reference_date,
    figures: { lead_low: part.lead_low, lead_high: part.lead_high, monthly_share: part.monthly_share },
    olumi_estimate: { ...estimate } };
}

export const secondStartId = (firstId: string, index: number): string => `${firstId}_start_${index + 1}`;

/**
 * Pure: the graph with each approved option's starts written into its carriers, a later start added as its own part
 * (switch factor, link into the goal, a link from every option, set only by its own option), then every part's link
 * strength recomputed by the event model's own date materialiser. Never touches another option's figures.
 */
export function withHiringTimes(graph: unknown, a: ApprovedHiringTimes): unknown {
  const out = structuredClone(graph) as Rec;
  const options = out.nodes.filter((n: Rec) => n.kind === 'option');
  for (const o of a.options) {
    const held = capacityPartsOf(out, o.option_id, a.goal_id);
    const first = held[0]!;
    o.parts.forEach((part, i) => {
      const node = held[i];
      if (node !== undefined) {
        node.observed_state.extra_share_by_date = carrierOf(node.observed_state.extra_share_by_date, part, a, o.olumi_estimate);
        return;
      }
      const id = secondStartId(first.id, i);
      // The construction's own part shape (`admitEventByDate`), never a copy of the first part's ids or references.
      const { figures: _f, olumi_estimate: _e, ...base } = first.observed_state.extra_share_by_date;
      out.nodes.push({ id, kind: 'factor', category: 'controllable', label: `${first.label} (start ${i + 1})`,
        ...(first.provenance === undefined ? {} : { provenance: first.provenance }),
        observed_state: { value: 0, source: 'cee_inference', extra_share_by_date: carrierOf(base, part, a, o.olumi_estimate) } });
      out.edges.push({ from: id, to: a.goal_id, exists_probability: 1, effect_direction: 'positive',
        strength: { mean: 0.5, std: 0.125 }, defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
      for (const opt of options) {
        opt.interventions = { ...(opt.interventions ?? {}), [id]: { value: opt.id === o.option_id ? 1 : 0 } };
        out.edges.push({ from: opt.id, to: id, exists_probability: 1, strength: { mean: 1, std: 0.01 }, effect_direction: 'positive' });
      }
    });
  }
  return withEventShareDate(out, a.deadline, a.reference_date);
}

/** Key order is not kept by the store (jsonb), so each field is compared, never the serialised bytes. */
function sameFigure(held: unknown, f: Figure): boolean {
  return rec(held) && held.value === f.value && held.origin === f.origin && held.quote === f.quote
    && Object.keys(held).length === Object.keys(f).length;
}

/**
 * The card's own precondition, scoped to its fields (DL: ONE field-scoped mechanism, `scoped_precondition_holds`): every
 * option still has the parts the card was offered against, with the same carriers, under the same deadline. The carriers
 * are outside the analysis hash, so a graph hash alone cannot see a change to them.
 */
export function hiringTimesStillApply(a: ApprovedHiringTimes, graph: unknown): boolean {
  return goalDeadlineFromRecord(graph, a.goal_id) === a.deadline && a.options.every((o) => {
    const held = capacityPartsOf(graph, o.option_id, a.goal_id);
    return held.length === o.part_ids.length
      && held.every((n, i) => n.id === o.part_ids[i] && isDeepStrictEqual(n.observed_state.extra_share_by_date, o.expected[i]));
  });
}

/** Read-back: every approved option holds exactly its planned starts, figures and recomputed link strengths. */
export function hiringTimesHeld(after: unknown, a: ApprovedHiringTimes): boolean {
  if (!rec(after) || !Array.isArray(after.edges)) return false;
  return a.options.every((o) => {
    const held = capacityPartsOf(after, o.option_id, a.goal_id);
    return held.length === o.parts.length && held.every((node, i) => {
      const c = node.observed_state.extra_share_by_date, p = o.parts[i]!;
      const link = after.edges.find((e: Rec) => e.from === node.id && e.to === a.goal_id);
      const D = typeof c.reference_date === 'string' && typeof c.deadline === 'string' ? timeBetween(c.reference_date, c.deadline, 'months') : NaN;
      if (!(D > 0) || c.deadline !== a.deadline || link?.defaulted === true) return false;
      const m = extraShareMoments(p.monthly_share.value / 100, D, p.lead_low.value, p.lead_high.value);
      return c.lead_low === p.lead_low.value && c.lead_high === p.lead_high.value && c.monthly_share === p.monthly_share.value
        && rec(c.figures) && sameFigure(c.figures.lead_low, p.lead_low) && sameFigure(c.figures.lead_high, p.lead_high)
        && sameFigure(c.figures.monthly_share, p.monthly_share)
        && link?.strength?.mean === m.mean && link?.strength?.std === m.sd;
    });
  });
}

/** Whose each figure is, for the summary and the provisional label: a stated figure only while it still holds the number. */
export function figureOf(carrier: unknown, bound: 'lead_low' | 'lead_high' | 'monthly_share'): Figure | null {
  if (!rec(carrier) || typeof carrier[bound] !== 'number') return null;
  const f = rec(carrier.figures) ? carrier.figures[bound] : undefined;
  return rec(f) && f.value === carrier[bound] && f.origin === 'user' && typeof f.quote === 'string' && f.quote !== ''
    ? { value: carrier[bound], origin: 'user', quote: f.quote } : { value: carrier[bound], origin: 'olumi' };
}

const figure = (x: number): string => x.toLocaleString('en-GB', { maximumFractionDigits: 2 });
const span = (p: PlannedPart): string => p.lead_low.value === p.lead_high.value ? figure(p.lead_low.value)
  : `${figure(p.lead_low.value)}–${figure(p.lead_high.value)}`;

/** Olumi's start figures said as Olumi's: only where one differs from the user's own figure for the same start. */
export function olumiStartBounds(p: Pick<PlannedPart, 'lead_low' | 'lead_high'>): { kind: 'soonest' | 'latest'; value: number }[] {
  const out: { kind: 'soonest' | 'latest'; value: number }[] = [];
  if (p.lead_low.origin === 'olumi' && !(p.lead_high.origin === 'user' && p.lead_high.value === p.lead_low.value)) out.push({ kind: 'soonest', value: p.lead_low.value });
  if (p.lead_high.origin === 'olumi' && !(p.lead_low.origin === 'user' && p.lead_low.value === p.lead_high.value)) out.push({ kind: 'latest', value: p.lead_high.value });
  return out;
}

/** The ONE card for every option's hiring times (DL ACK of SYS1-E5-STRINGS §2 pending). */
export function hiringTimesCard(a: ApprovedHiringTimes, deliverable: string): string {
  const lines = a.options.map((o) => {
    const said = `you said “${o.quotes.join('”, then “')}”`;
    const olumiNotes = o.parts.flatMap(olumiStartBounds).map(b => `; ${figure(b.value)} months is Olumi’s estimate of the ${b.kind} start`).join('');
    if (o.parts.length === 1) return `‘${o.label}’: starts after ${span(o.parts[0]!)} months (${said}${olumiNotes}).`;
    return `‘${o.label}’: one person after ${span(o.parts[0]!)} months and another after ${span(o.parts[1]!)} months (${said}${olumiNotes}); `
      + `Olumi’s estimate of its pace, ${figure(o.olumi_estimate.monthly_share)}% of ${deliverable} a month, is split equally between them.`;
  });
  return `Use your hiring times? ${lines.join(' ')}`;
}

/** How the model summary says whose each figure is (DL ACK of SYS1-E5-STRINGS §3 pending). */
export const HIRING_TIMES_USE = 'Each option’s start times and pace as the model holds them, with whose each figure is. Say a figure is the user’s only where whose is "yours"; never present Olumi’s estimates as theirs.';
const whose = (f: Figure | null): Record<string, unknown> | undefined => f === null ? undefined
  : { value: f.value, whose: f.origin === 'user' ? 'yours' : 'Olumi’s estimate', ...(f.quote === undefined ? {} : { quote: f.quote }) };

/** Every option's capacity parts as the model holds them: each start's soonest and latest months and its pace, with whose. */
export function hiringTimesSummaryOf(graph: unknown, goalId: string): Record<string, unknown>[] {
  if (!rec(graph) || !Array.isArray(graph.nodes)) return [];
  return graph.nodes.filter((n: Rec) => n.kind === 'option' && typeof n.id === 'string').flatMap((o: Rec) => {
    const parts = capacityPartsOf(graph, o.id, goalId);
    if (parts.length === 0) return [];
    return [{ option_id: o.id, option: o.label, starts: parts.map((p) => {
      const c = p.observed_state.extra_share_by_date;
      return { soonest_months: whose(figureOf(c, 'lead_low')), latest_months: whose(figureOf(c, 'lead_high')),
        pace_percent_a_month: whose(figureOf(c, 'monthly_share')) };
    }) }];
  });
}
