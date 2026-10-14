/**
 * ⭐ E5 (Paul's manual test, 12 Oct 2026): the hiring times the user states for each option, read from their own words and
 * written into the option's EXISTING capacity carriers (`observed_state.extra_share_by_date`, passthrough at every schema).
 * "Two developers, one within 2 months and another a month or so later" is TWO parts (a second switch factor with its own
 * carrier, the construction's own per-part shape), summed by the chance, never averaged into one start.
 *
 * r2 (AIE 6122268035 science, 6122431786 text; PL 6122371497/6122519782; DL rulings (a)–(c) and the CUT):
 * - each part keeps the user's statement (`statement: {quote, form}`) beside its modelled timing;
 * - each figure records its ROLE (stated | olumi_estimate | derived) and an observed-state-shaped stamp that the shared
 *   origin reader classifies (`valueAuthorshipOf`'s mapping, `authorshipOf`: the user's stated figure is 'user_override' → yours; a figure Olumi
 *   supplied, accepted by the card press, is 'user_assumption' + confirm → olumi_accepted). Origin and role are separate;
 *   a missing or mismatched record is UNKNOWN, never Olumi's;
 * - every figure that is not the user's stated bound is labelled, even when its number equals the user's.
 * Rules: "at least N": soonest N (stated), latest Olumi's estimate; "within N": latest N (stated), soonest Olumi's estimate;
 * "in N" / "N–M": stated; "about N" / "N or so": derived (its exact figure is Olumi's disclosed reading, AIE 6122738619); "another M later": derived from
 * the previous start, only when that start is one figure. Anything else is refused, never guessed: a ranged start before
 * "another M later" (the coupled law is DEFERRED, DL (c): the two starts would be one draw), an "at least N" beyond Olumi's
 * latest or a "within N" below Olumi's soonest (DL CUT). The pace stays Olumi's estimate, split equally across the starts.
 */
import { capacityRatioScale, extraShareMoments } from './event-by-date-share.js';
import { timeBetween } from './deadline-date.js';
import { withEventShareDate } from './event-by-date-model.js';
import { goalDeadlineFromRecord } from './goal-kind.js';
import { quoteSpansIn } from '../agent-lane/stated-by-user.js';
import { isAcceptedOlumiEstimate, observedValueAuthorship } from '../../cee/transforms/provenance-display.js';
import { isDeepStrictEqual } from 'node:util';
import type { EffectLead } from './effect-lead.js';
import type { UserStatement } from '../agent-lane/user-statements.js';

type Rec = Record<string, any>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export type HiringForm =
  | { readonly kind: 'at_least'; readonly months: number } | { readonly kind: 'within'; readonly months: number }
  | { readonly kind: 'about'; readonly months: number } | { readonly kind: 'after_previous'; readonly months: number }
  | { readonly kind: 'range'; readonly low: number; readonly high: number };
export type FigureRole = 'stated' | 'olumi_estimate' | 'derived';
/** One stored figure: its number, its role, and the stamp the shared origin reader reads (`valueAuthorshipOf`). */
export interface Figure {
  readonly value: number;
  readonly role: FigureRole;
  readonly source: 'user_override' | 'user_assumption';
  readonly reviewed_by_user?: { readonly intent: 'confirm' };
  /** The user's words this figure is read from (a stated or derived figure). */
  readonly quote?: string;
}
export interface Statement {
  readonly quote: string;
  readonly form: HiringForm['kind'];
  readonly source?: 'user_stated' | 'model_proposed';
  /** Complete verified words retain their original subject and qualifications, separate from the new pairing. */
  readonly original_source?: { readonly text: string; readonly authored_by: 'user_stated' };
  readonly pairing?: { readonly option_id: string; readonly authored_by: 'model_proposed' };
  /**
   * S2 (DL 22:14Z): the user's WHOLE verified sentence holding `quote` (`hiring-start-statement.ts`). `quote` and `form` stay
   * Olumi's reading of which part of it is this start.
   */
  readonly user_statement?: UserStatement;
}
export interface PlannedPart { readonly statement: Statement; readonly lead_low: Figure; readonly lead_high: Figure; readonly monthly_share: Figure }
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
/**
 * ⭐ S2 THE LEAD BEFORE A CAPACITY CHANGE IS FULL (DL boundary ruling 21:43Z 14 Oct): an option whose one capacity part is a
 * RATIO carrier (HIRING's `capacity_ratio`, the window's scale k) takes the user's start + onboarding as ONE lead L
 * (`effect-lead.ts`), written onto that carrier beside its ratio; k is then recomputed by the event model's own materialiser.
 */
export interface PlannedLead {
  readonly option_id: string;
  readonly label: string;
  /** The ratio carrier's node, and its carrier exactly as offered (a change to it supersedes the card). */
  readonly part_id: string;
  readonly expected: unknown;
  readonly lead: EffectLead;
  readonly quotes: readonly string[];
}
export interface ApprovedHiringTimes {
  readonly goal_id: string;
  readonly deadline: string;
  readonly reference_date: string;
  readonly options: readonly PlannedOption[];
  readonly leads?: readonly PlannedLead[];
}

/** The option's ONE capacity part when it is a ratio carrier (`capacity_ratio`), or `undefined`. */
export function ratioPartOf(graph: unknown, optionId: string, goalId: string): Rec | undefined {
  const parts = capacityPartsOf(graph, optionId, goalId);
  return parts.length === 1 && typeof parts[0]!.observed_state.extra_share_by_date.capacity_ratio === 'number' ? parts[0] : undefined;
}
const leadFieldsOf = (lead: EffectLead): Rec => JSON.parse(JSON.stringify({ lead_low: lead.lead_low, lead_high: lead.lead_high,
  lead_statements: lead.lead_statements, lead_reading: lead.lead_reading }));

export const MAX_STARTS_PER_OPTION = 2;

const NUMBER_WORDS: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUM = '(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const months = (s: string): number => NUMBER_WORDS[s] ?? Number(s);
/** Words that make a stated time approximate; the exact figure Olumi models from it is then disclosed as its reading. */
const APPROXIMATE = /\b(?:about|around|roughly|approximately|or so|or thereabouts)\b|~/;

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

/**
 * The quote is the user's own words, in this message OR an earlier one (E2's source-bound path: the conversation the host
 * retains), matched as whole words by the shared `quoteSpansIn`; the sentence holding it names the option (a label word,
 * not "hire" or a number word), so one option's time is never offered for another.
 */
const GENERIC = new Set(['hire', 'hiring', 'hired', 'the', 'and', 'add', 'adds', 'more', 'new', 'extra', 'capacity', 'option', 'with', 'for', 'get',
  ...Object.keys(NUMBER_WORDS)]);
const stem = (w: string): string => w.replace(/(?:es|s)$/, '');
export function quoteStatedFor(texts: { readonly now?: string | null; readonly conversation?: string | null }, quote: string,
  optionLabel: string): 'ok' | 'not_stated' | 'not_for_option' {
  const q = plainWords(quote);
  if (q === '') return 'not_stated';
  const named = (plainWords(optionLabel).match(/\p{L}+/gu) ?? []).filter(w => w.length >= 3 && !GENERIC.has(w)).map(stem);
  let found = false;
  for (const raw of [texts.now, texts.conversation]) {
    const text = typeof raw === 'string' ? plainWords(raw) : '';
    for (const at of quoteSpansIn(text, q)) {
      found = true;
      const start = Math.max(text.lastIndexOf('. ', at), text.lastIndexOf('? ', at), text.lastIndexOf('! ', at)) + 1;
      const ends = ['. ', '? ', '! '].map(e => text.indexOf(e, at + q.length)).filter(i => i >= 0);
      const words = new Set((text.slice(start, ends.length === 0 ? text.length : Math.min(...ends)).match(/\p{L}+/gu) ?? []).map(stem));
      if (named.some(w => words.has(w))) return 'ok';
    }
  }
  return found ? 'not_for_option' : 'not_stated';
}

/**
 * The statements the option's held parts were approved from, when every figure of that part still reads with a known origin
 * (AIE 6122738619 R6: "retain the unchanged timings and their sources"). A held statement is a verified human statement
 * already bound to this option, so re-quoting it for the complete card needs no fresh typed authority — never a quote for
 * a timing Olumi estimated (a construction part has no statement).
 */
export function heldStatementsOf(parts: readonly unknown[]): string[] {
  return parts.flatMap((n) => {
    const st = rec(n) ? n.observed_state?.extra_share_by_date?.statement : undefined;
    const known = (['lead_low', 'lead_high', 'monthly_share'] as const).every(b => heldFigureOf(n, b)?.role !== 'unknown');
    return rec(st) && typeof st.quote === 'string' && st.quote !== '' && known ? [st.quote] : [];
  });
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

const stated = (value: number, quote: string): Figure => ({ value, role: 'stated', source: 'user_override', quote });
const olumiFigure = (value: number, role: Exclude<FigureRole, 'stated'>, quote?: string): Figure =>
  ({ value, role, source: 'user_assumption', reviewed_by_user: { intent: 'confirm' }, ...(quote === undefined ? {} : { quote }) });

/** DL CUT: one refusal for every form Olumi cannot model as quoted; R16 stays its own (the deferred coupled law). */
export type PlanRefusal = { readonly refusal: 'hiring_timings_unusable' | 'relative_to_range' | 'too_many_starts' | 'fewer_starts_than_held'; readonly quote?: string }
  | { readonly refusal: 'hiring_bound_conflict'; readonly quote: string; readonly bound: 'lower' | 'upper'; readonly value: number; readonly source: 'user_stated' | 'model_proposed' };

/** The option's planned parts from the user's starts and Olumi's estimate; the pace split equally. */
export function planStarts(quotes: readonly string[], estimate: PlannedOption['olumi_estimate'], heldParts: number, readings?: readonly { months?: unknown; stated: boolean; original_source?: Statement['original_source']; pairing?: Statement['pairing']; held?: Pick<PlannedPart, 'statement' | 'lead_low' | 'lead_high'>; user_statement?: UserStatement }[]):
  { readonly parts: PlannedPart[] } | PlanRefusal {
  if (quotes.length === 0 || quotes.length > MAX_STARTS_PER_OPTION) return { refusal: 'too_many_starts' };
  if (quotes.length < heldParts) return { refusal: 'fewer_starts_than_held' };
  const pace = (v: number): Figure => olumiFigure(v, 'olumi_estimate');
  const share = estimate.monthly_share / quotes.length;
  const parts: PlannedPart[] = [];
  for (const [i, quote] of quotes.entries()) {
    if (quote.trim() === '') return { refusal: 'hiring_timings_unusable', quote };
    const reading = readings?.[i];
    const typed = reading?.months;
    if (typed === undefined && reading?.held !== undefined) {
      const held = reading.held;
      if (![held.lead_low.value, held.lead_high.value].every(v => Number.isFinite(v) && v >= 0 && v <= 60)
        || held.lead_low.value > held.lead_high.value) return { refusal: 'hiring_timings_unusable', quote };
      parts.push({ ...held, monthly_share: pace(share) });
      continue;
    }
    if (typed !== undefined && (typeof typed !== 'number' || !Number.isFinite(typed) || typed < 0 || typed > 60)) return { refusal: 'hiring_timings_unusable', quote };
    const parsed = readHiringStart(quote);
    // A proposed interpretation cannot erase a stated inequality, even with different typed months.
    const matches = parsed?.kind === 'at_least' || parsed?.kind === 'within' || typed === undefined
      || (parsed !== null && 'months' in parsed && parsed.months === typed);
    const form: HiringForm | null = typed === undefined || matches ? parsed : { kind: 'about', months: typed as number };
    const own = reading?.stated !== false && matches;

    if (form === null) return { refusal: 'hiring_timings_unusable', quote };
    let low: Figure, high: Figure;
    if (form.kind === 'after_previous') {
      const prev = parts[i - 1];
      if (prev === undefined) return { refusal: 'hiring_timings_unusable', quote };
      // ⛔ "another M later" is the SAME draw as the start before it (AIE 6122268035). Only a start fixed to one figure can
      // anchor it while the coupled law is deferred (DL (c)): a ranged one would be summed as an independent part.
      if (prev.lead_low.value !== prev.lead_high.value) return { refusal: 'relative_to_range', quote };
      low = olumiFigure(prev.lead_low.value + form.months, 'derived', quote);
      high = olumiFigure(prev.lead_high.value + form.months, 'derived', quote);
    } else if (form.kind === 'at_least') {
      if (form.months > estimate.lead_high) return { refusal: 'hiring_bound_conflict', quote: reading?.original_source?.text ?? quote, bound: 'lower', value: form.months, source: reading?.original_source || own ? 'user_stated' : 'model_proposed' };
      low = stated(form.months, quote); high = olumiFigure(estimate.lead_high, 'olumi_estimate');
    } else if (form.kind === 'within') {
      if (form.months < estimate.lead_low) return { refusal: 'hiring_bound_conflict', quote: reading?.original_source?.text ?? quote, bound: 'upper', value: form.months, source: reading?.original_source || own ? 'user_stated' : 'model_proposed' };
      low = olumiFigure(estimate.lead_low, 'olumi_estimate'); high = stated(form.months, quote);
    } else if (form.kind === 'about' && APPROXIMATE.test(plainWords(quote))) {
      // AIE 6122738619: the exact figure modelled from "about N" is Olumi's disclosed choice, never a human-stated endpoint.
      low = olumiFigure(form.months, 'derived', quote); high = olumiFigure(form.months, 'derived', quote);
    } else if (form.kind === 'about') {
      low = stated(form.months, quote); high = stated(form.months, quote);
    } else {
      low = stated(form.low, quote); high = stated(form.high, quote);
    }
    if (!own) {
      low = olumiFigure(low.value, 'olumi_estimate');
      high = olumiFigure(high.value, 'olumi_estimate');
    }
    parts.push({ statement: { quote, form: form.kind, ...(reading?.original_source && reading.pairing
      ? { source: 'user_stated' as const, original_source: reading.original_source, pairing: reading.pairing }
      : !own ? { source: 'model_proposed' as const } : {}),
      ...(reading?.user_statement !== undefined ? { user_statement: reading.user_statement } : {}) }, lead_low: low, lead_high: high, monthly_share: pace(share) });
  }
  return { parts };
}

/** Olumi's own estimate for the option: the first part's recorded estimate, else its carrier as the construction wrote it. */
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

/** The carrier a planned part becomes; numbers are the computation's, `figures` say whose each one is and why. */
function carrierOf(prior: Rec, part: PlannedPart, a: ApprovedHiringTimes, estimate: PlannedOption['olumi_estimate']): Rec {
  return { ...prior, monthly_share: part.monthly_share.value, lead_low: part.lead_low.value, lead_high: part.lead_high.value,
    deadline: a.deadline, reference_date: a.reference_date, statement: { ...part.statement },
    figures: { lead_low: { ...part.lead_low }, lead_high: { ...part.lead_high }, monthly_share: { ...part.monthly_share } },
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
      const { figures: _f, olumi_estimate: _e, statement: _s, ...base } = first.observed_state.extra_share_by_date;
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
  for (const l of a.leads ?? []) {
    const node = out.nodes.find((n: Rec) => n.id === l.part_id);
    if (node === undefined || !rec(node.observed_state?.extra_share_by_date)) continue;
    node.observed_state.extra_share_by_date = { ...node.observed_state.extra_share_by_date, ...leadFieldsOf(l.lead) };
  }
  return withEventShareDate(out, a.deadline, a.reference_date);
}

/** Key order is not kept by the store (jsonb), so each field is compared, never the serialised bytes. */
function sameRecord(held: unknown, f: Statement | Figure): boolean {
  return isDeepStrictEqual(held, JSON.parse(JSON.stringify(f)));
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
  }) && (a.leads ?? []).every((l) => {
    const part = ratioPartOf(graph, l.option_id, a.goal_id);
    return part?.id === l.part_id && isDeepStrictEqual(part.observed_state.extra_share_by_date, l.expected);
  });
}

/**
 * Read-back, and "already held" (AIE 243 R11): every approved option holds exactly its planned starts — the user's statement,
 * every figure's number, role and stamp, and the recomputed link strength — never the numbers alone.
 */
export function hiringTimesHeld(after: unknown, a: ApprovedHiringTimes): boolean {
  if (!rec(after) || !Array.isArray(after.edges)) return false;
  // A lead is held when its ratio carrier holds exactly the lead fields; where k is licensed, the link is sized by THAT k.
  const leadsHeld = (a.leads ?? []).every((l) => {
    const part = ratioPartOf(after, l.option_id, a.goal_id);
    const c = part?.observed_state.extra_share_by_date;
    if (part?.id !== l.part_id || !rec(c) || c.deadline !== a.deadline) return false;
    const fields = leadFieldsOf(l.lead);
    if (!Object.keys(fields).every((k) => isDeepStrictEqual(c[k], fields[k]))) return false;
    const H = typeof c.reference_date === 'string' ? timeBetween(c.reference_date, c.deadline, 'months') : NaN;
    const k = capacityRatioScale(c.capacity_ratio, H, l.lead.lead_low, l.lead.lead_high);
    const link = after.edges.find((e: Rec) => e.from === part.id && e.to === a.goal_id);
    return k === null ? link?.defaulted === true : !rec(c.ratio_sizing) || c.ratio_sizing.k === k;
  });
  return leadsHeld && a.options.every((o) => {
    const held = capacityPartsOf(after, o.option_id, a.goal_id);
    return held.length === o.parts.length && held.every((node, i) => {
      const c = node.observed_state.extra_share_by_date, p = o.parts[i]!;
      const link = after.edges.find((e: Rec) => e.from === node.id && e.to === a.goal_id);
      const D = typeof c.reference_date === 'string' && typeof c.deadline === 'string' ? timeBetween(c.reference_date, c.deadline, 'months') : NaN;
      if (!(D > 0) || c.deadline !== a.deadline || link?.defaulted === true) return false;
      const m = extraShareMoments(p.monthly_share.value / 100, D, p.lead_low.value, p.lead_high.value);
      return c.lead_low === p.lead_low.value && c.lead_high === p.lead_high.value && c.monthly_share === p.monthly_share.value
        && sameRecord(c.statement, p.statement) && rec(c.figures) && sameRecord(c.figures.lead_low, p.lead_low)
        && sameRecord(c.figures.lead_high, p.lead_high) && sameRecord(c.figures.monthly_share, p.monthly_share)
        && link?.strength?.mean === m.mean && link?.strength?.std === m.sd;
    });
  });
}

/**
 * Whose one figure stamp is, by the shared origin reader (DL (b): the stand-in until C's `provenanceOf`). This is
 * `valueAuthorshipOf`'s own mapping over `observedValueAuthorship` / `isAcceptedOlumiEstimate`; importing
 * `valueAuthorshipOf` itself would cycle (the guidance assembler imports the share-gate readers that import this module).
 * Parity with it, on every stamp this module writes, is pinned by `e5-hiring-times.test.ts`.
 */
export type Whose = 'yours' | 'olumi_estimate' | 'olumi_accepted' | 'unknown';
export function authorshipOf(stamp: unknown): Whose {
  if (isAcceptedOlumiEstimate(stamp)) return 'olumi_accepted';
  const a = observedValueAuthorship(stamp);
  return a === undefined || a.provenance === 'unverified_brief' ? 'unknown' : a.provenance === 'ai_inferred' ? 'olumi_estimate' : 'yours';
}

/** One figure as the model holds it: its number, whose it is by the shared reader, and its role. */
export interface HeldFigure {
  readonly value: number;
  readonly whose: Whose;
  readonly role: FigureRole | 'unknown';
  readonly quote?: string;
}
/**
 * Whose a carrier's figure is, read by the shared origin reader (DL (b): `valueAuthorshipOf` until C's `provenanceOf`).
 * A carrier the construction wrote (no `figures`, an Olumi-drafted part) is Olumi's estimate, as before E5. A carrier with
 * figures is read figure by figure; a missing record, or one whose number is not the carrier's, is UNKNOWN — never Olumi's.
 */
export function heldFigureOf(node: unknown, bound: 'lead_low' | 'lead_high' | 'monthly_share'): HeldFigure | null {
  const c = rec(node) && rec(node.observed_state) ? node.observed_state.extra_share_by_date : undefined;
  if (!rec(c) || typeof c[bound] !== 'number') return null;
  if (c.figures === undefined) {
    return (node as Rec).provenance === 'ai_inferred' ? { value: c[bound], whose: 'olumi_estimate', role: 'olumi_estimate' }
      : { value: c[bound], whose: 'unknown', role: 'unknown' };
  }
  const f = rec(c.figures) ? c.figures[bound] : undefined;
  const role: FigureRole | undefined = rec(f) && ['stated', 'olumi_estimate', 'derived'].includes(f.role) ? f.role : undefined;
  if (!rec(f) || f.value !== c[bound] || role === undefined) return { value: c[bound], whose: 'unknown', role: 'unknown' };
  const whose = authorshipOf(f);
  // A stated figure must read as the user's; anything else Olumi supplied. A stamp that says otherwise is unknown.
  const coherent = role === 'stated' ? whose === 'yours' : whose === 'olumi_accepted' || whose === 'olumi_estimate';
  return coherent ? { value: c[bound], whose, role, ...(typeof f.quote === 'string' && f.quote !== '' ? { quote: f.quote } : {}) }
    : { value: c[bound], whose: 'unknown', role: 'unknown' };
}

const figure = (x: number): string => x.toLocaleString('en-GB', { maximumFractionDigits: 2 });
const spanOf = (low: number, high: number): string => low === high ? figure(low) : `${figure(low)}–${figure(high)}`;
const listed = (items: readonly string[]): string => items.length <= 1 ? (items[0] ?? '')
  : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
type StartView = { readonly statement?: Statement; readonly low: HeldFigure; readonly high: HeldFigure; readonly pace: HeldFigure };

/** Every figure that is not the user's stated bound, said as what it is (DL CUT: four start items and the pace). */
function assumptionsOf(starts: readonly StartView[], deliverable: string): string[] {
  const items: string[] = [];
  for (const s of starts) {
    // DL A2i8 (B3, AIE fact 4): a zero-width start is disclosed as exact when Olumi proposed it, or when a user's one-sided
    // bound met Olumi's opposite end (one end stated, the other Olumi's) — never on Olumi's own plain point estimate, whose card
    // already reads as one figure.
    const boundCollapsed = (s.low.role === 'stated') !== (s.high.role === 'stated');
    if ((s.statement?.source === 'model_proposed' || s.statement?.pairing?.authored_by === 'model_proposed' || boundCollapsed)
      && s.low.value === s.high.value) {
      items.push(`an assumption that this start is exactly ${figure(s.low.value)} months from the reference date`);
    }
    const derived = s.low.role === 'derived' && s.high.role === 'derived';
    if (derived && s.statement?.form === 'after_previous') {
      const offset = readHiringStart(s.statement.quote);
      const m = offset?.kind === 'after_previous' ? offset.months : NaN;
      items.push(`the second start taken as ${figure(m)} month${m === 1 ? '' : 's'} after the first (Olumi’s reading of “${s.statement.quote}”)`);
      continue;
    }
    if (derived && s.statement?.form === 'about') {
      items.push(`“${s.statement.quote}” taken as ${figure(s.low.value)} months (Olumi’s reading)`);
      continue;
    }
    for (const [f, kind] of [[s.low, 'soonest'], [s.high, 'latest']] as const) {
      if (f.role === 'olumi_estimate') items.push(`Olumi’s estimate of the ${kind} start (${figure(f.value)} months)`);
      if (f.role === 'unknown' || f.role === 'derived') items.push(`a figure whose source could not be confirmed (${figure(f.value)} months)`);
    }
  }
  const total = starts.reduce((t, s) => t + s.pace.value, 0);
  if (starts.some(s => s.pace.role === 'unknown')) items.push(`a figure whose source could not be confirmed (${figure(total)}% of ${deliverable} per month)`);
  else items.push(`Olumi’s estimate of the additional progress from the hires (${figure(total)}% of ${deliverable} per month${starts.length === 2 ? ', split equally between the two starts' : ''})`);
  return items;
}

const viewOfPlanned = (p: PlannedPart): StartView => ({ statement: p.statement,
  low: { value: p.lead_low.value, whose: authorshipOf(p.lead_low), role: p.lead_low.role },
  high: { value: p.lead_high.value, whose: authorshipOf(p.lead_high), role: p.lead_high.role },
  pace: { value: p.monthly_share.value, whose: authorshipOf(p.monthly_share), role: p.monthly_share.role } });

/** The ONE card covering all proposed hiring timings (r2; DL/AIE ACK of SYS1-E5-STRINGS r2 pending). */
export function hiringTimesCard(a: ApprovedHiringTimes, deliverable: string): string {
  const lines = a.options.map((o) => {
    const views = o.parts.map(viewOfPlanned), said = o.parts.some(p => p.statement.pairing !== undefined)
      ? o.parts.map(p => p.statement.original_source && p.statement.pairing
        ? `Your words: “${p.statement.original_source.text}”. Olumi proposes using this timing for ‘${o.label}’; your message did not establish that pairing.`
        : `${p.statement.source === 'model_proposed' ? 'Olumi proposed' : 'you said'} “${p.statement.quote}”.`).join(' Then ')
      : o.parts.every(p => p.statement.source !== 'model_proposed') ? `you said “${o.quotes.join('”, then “')}”` : o.parts.map(p => `${p.statement.source === 'model_proposed' ? 'Olumi proposed' : 'you said'} “${p.statement.quote}”`).join(', then ');
    const timing = views.length === 1 ? `starts after ${spanOf(views[0]!.low.value, views[0]!.high.value)} months`
      : `one person after ${spanOf(views[0]!.low.value, views[0]!.high.value)} months and another after ${spanOf(views[1]!.low.value, views[1]!.high.value)} months`;
    return `‘${o.label}’: ${said}${o.parts.some(p => p.statement.pairing !== undefined) ? '' : '.'} Modelled timing: ${timing}, with ${listed(assumptionsOf(views, deliverable))}.`;
  });
  return `Use these hiring assumptions? ${lines.join(' ')}`;
}

/**
 * The provisional chance's words for an option's starts (r2), after the caller's "using ": the user's quotes, the modelled
 * timing, and every assumption. '' when no start carries the user's statement (the caller keeps Olumi's own words).
 */
export function hiringTimesLabel(nodes: readonly unknown[], deliverable: string): string {
  const views: StartView[] = [];
  for (const n of nodes) {
    const low = heldFigureOf(n, 'lead_low'), high = heldFigureOf(n, 'lead_high'), pace = heldFigureOf(n, 'monthly_share');
    if (low === null || high === null || pace === null) return '';
    const st = (n as Rec).observed_state.extra_share_by_date.statement;
    views.push({ ...(rec(st) && typeof st.quote === 'string' ? { statement: st as Statement } : {}), low, high, pace });
  }
  const quotes = views.flatMap(v => v.statement === undefined ? [] : [v.statement.quote]);
  if (quotes.length === 0) return '';
  const spans = views.map(v => spanOf(v.low.value, v.high.value)).join(' and ');
  if (views.some(v => v.statement?.original_source && v.statement.pairing)) {
    const sources = views.map(v => v.statement?.original_source
      ? `your words “${v.statement.original_source.text}”`
      : `${v.statement?.source === 'model_proposed' ? 'Olumi’s words' : 'your words'} “${v.statement?.quote ?? ''}”`).join(', then ');
    return `Olumi’s proposed timing for this option from ${sources}, as modelled: ${spans} months, with ${listed(assumptionsOf(views, deliverable))}`;
  }
  return `${views.some(v => v.statement?.source === 'model_proposed' || v.statement?.pairing?.authored_by === 'model_proposed') ? 'proposed' : 'your'} hiring time${quotes.length === 1 ? '' : 's'} (“${quotes.join('”, then “')}”) as modelled: ${spans} months, with ${listed(assumptionsOf(views, deliverable))}`;
}

/** How the model summary says whose each figure is (r2; DL/AIE ACK pending). */
export const HIRING_TIMES_USE = 'Each option’s hiring timings as the model holds them: the user’s own words, then each modelled figure with whose it is (yours, olumi_estimate, olumi_accepted or unknown) and its role (stated, olumi_estimate, derived or unknown). Call a figure the user’s only where whose is "yours" and role is "stated"; an estimated or derived figure is Olumi’s modelling even when it equals the user’s number; never call an unknown figure Olumi’s. Where a statement carries original_source and pairing, its complete words remain user-authored with their original subject and qualifications; pairing.authored_by records Olumi’s proposed use for the selected option, not a pairing the user originally stated.';

/** Every option's capacity parts as the model holds them: the statement, each start's figures and its pace, with whose and role. */
export function hiringTimesSummaryOf(graph: unknown, goalId: string): Record<string, unknown>[] {
  if (!rec(graph) || !Array.isArray(graph.nodes)) return [];
  return graph.nodes.filter((n: Rec) => n.kind === 'option' && typeof n.id === 'string').flatMap((o: Rec) => {
    const parts = capacityPartsOf(graph, o.id, goalId);
    if (parts.length === 0) return [];
    return [{ option_id: o.id, option: o.label, starts: parts.map((p) => {
      const st = p.observed_state.extra_share_by_date.statement;
      return { ...(rec(st) ? { statement: { ...st } } : {}),
        soonest_months: heldFigureOf(p, 'lead_low'), latest_months: heldFigureOf(p, 'lead_high'),
        pace_percent_per_month: heldFigureOf(p, 'monthly_share') };
    }) }];
  });
}
