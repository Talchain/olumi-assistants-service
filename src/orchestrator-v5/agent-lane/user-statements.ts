/**
 * ⭐ S2 — ONE USER-STATED-QUANTITY CONTRACT (RCA-PAUL-TEST-1617Z Symptom 2; AIE #94 6173489813). Paul (scenario c1494f4d,
 * 14 Oct) gave today's team time as "At least 7 months", then "8 months" when Olumi asked for the likely upper end. The
 * one-quote low/high door could hold neither: a bound had no form, two messages had no shape, and a lone figure got
 * Olumi's 6–10, below his own minimum. Nothing was saved and the Run stayed closed.
 *
 * A statement is ONE verified quote of the user's own typed words, with Olumi's reading of it (its form, figure, qualifier,
 * negation and conditions) kept beside the words. The reading is shown on the card and adopted only by the user's press;
 * approval never makes the reading human-authored. Statements about the same quantity under the same conditions combine
 * only by their ends: a bound is never turned into a point, and Olumi adds no spread beside a user's bound. Pure.
 */
import { wholeStatementIn } from '../goal-target/input-claim-context.js';
import { plainQuoteWords, verbatimSourceLine } from './quote-confirmation.js';

/**
 * `describes`: qualitative words about the quantity ("I'm not that experienced with marketing"), with no figure of the user's.
 * `holds_in_window`: the user's own FORECAST that a condition will still hold during the goal's period ("Yes, I'll still be new
 * to it then"), given only as their answer to Olumi's question about that period: never read from "holds now" (AIE 6178729504).
 */
export type StatementForm = 'point' | 'range' | 'lower_bound' | 'upper_bound' | 'holds_now' | 'holds_in_window' | 'describes';
export const STATEMENT_FORMS: readonly StatementForm[] = ['point', 'range', 'lower_bound', 'upper_bound', 'holds_now', 'holds_in_window', 'describes'];
/** The figure-free forms: no number of the user's to check. */
const FIGURE_FREE: ReadonlySet<StatementForm> = new Set(['holds_now', 'holds_in_window', 'describes']);

/** What a quantity a statement is about: set by the tool that verifies it, never by the Agent's words. */
export interface StatementSubject {
  readonly quantity: string;
  readonly node_id?: string;
  readonly option_id?: string;
}

export interface UserStatement {
  readonly speaker: 'user';
  /** The user's words, verbatim, as the Agent quoted them. */
  readonly quote: string;
  /** The complete line of the user's typed words that holds the quote. */
  readonly source: string;
  readonly subject: StatementSubject;
  readonly form: StatementForm;
  /** The figure(s) the quote states, in `unit`: a point holds both ends equal; a lower bound only `low`; an upper bound only `high`. */
  readonly low?: number;
  readonly high?: number;
  readonly unit?: string;
  readonly reference?: string;
  readonly period?: string;
  /** Words that qualify the figure ("likely", "about", "low confidence"), verbatim; `qualifier_in_quote` says whether the user typed them. */
  readonly qualifier?: string;
  readonly qualifier_in_quote?: boolean;
  readonly negated?: true;
  readonly conditions?: string;
  /** The question Olumi asked that this statement answers ("the likely upper end"), in Olumi's words: context, never the user's. */
  readonly answering?: string;
  /** The form and figure are Olumi's reading of the words until the user's press adopts it. */
  readonly reading: 'olumi';
}

/** One statement as the Agent passes it. */
export interface StatementArgs {
  readonly quote?: unknown;
  readonly form?: unknown;
  readonly value?: unknown;
  readonly low?: unknown;
  readonly high?: unknown;
  readonly qualifier?: unknown;
  readonly negated?: unknown;
  readonly conditions?: unknown;
  readonly answering?: unknown;
}

export interface StatementTexts {
  /** The user's words typed this turn. */
  readonly now?: string | null;
  /** The user's verified earlier messages. */
  readonly conversation?: string | null;
  /** Retained words whose origin is not verified (reseeded history): never a source. */
  readonly unverified?: string | null;
}

export interface StatementRules {
  readonly subject: StatementSubject;
  readonly unit: string;
  readonly forms: readonly StatementForm[];
  readonly reference?: string;
  readonly period?: string;
  /** The figures the quote states, in `unit`, each as its two ends (a single figure has both equal). */
  readonly figuresIn: (quote: string) => readonly { readonly low: number; readonly high: number }[];
  /** Whether the Agent's figure is the stated one (the server keeps the stated one, never the Agent's rendering). */
  readonly sameFigure?: (quote: string, given: number, stated: number) => boolean;
  /** A stated 0 is a figure of this field ("no budget", "0% now"), never refused as missing (PROMPT sys2; a level or target). */
  readonly allowsZero?: boolean;
}

export type StatementsVerdict =
  | { readonly kind: 'verified'; readonly statements: readonly UserStatement[] }
  | { readonly kind: 'refused'; readonly refusal: 'statement_not_found' | 'origin_unknown' | 'statement_malformed' | 'figure_not_in_quote' | 'different_conditions'; readonly detail: string };

const MAX_STATEMENTS = 6;
const trimmed = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() !== '' && v.trim().length <= max ? v.trim() : undefined;
const figure = (v: unknown, zero = false): number | undefined => (typeof v === 'number' && Number.isFinite(v) && (v > 0 || (zero && v === 0)) ? v : undefined);

export type StatementVerdict =
  | { readonly kind: 'verified'; readonly statement: UserStatement }
  | Extract<StatementsVerdict, { kind: 'refused' }>;

/**
 * ⭐ ONE statement, verified or refused on its own (SYSTEM 1's door and SYSTEM 2's construction map, PROMPT sys2 §2): a quote
 * must stand as a WHOLE statement in the user's own verified words, and its figure must be one the quote states.
 */
export function verifyStatement(given: StatementArgs | null | undefined, texts: StatementTexts, rules: StatementRules): StatementVerdict {
  const malformed = (detail: string): StatementVerdict => ({ kind: 'refused', refusal: 'statement_malformed', detail });
  const same = rules.sameFigure ?? ((_q: string, a: number, b: number) => a === b);
  const quote = trimmed(given?.quote, 400);
  const form = STATEMENT_FORMS.find((f) => f === given?.form && rules.forms.includes(f));
  if (quote === undefined || form === undefined) {
    return malformed(`Each statement needs the user's exact words (quote) and one form of: ${rules.forms.join(', ')}. Nothing was prepared.`);
  }
  // T2A5's one quote check (`wholeStatementIn`): a WHOLE statement of a verified message, this one or an earlier one.
  const whole = (t: string | null | undefined): boolean => typeof t === 'string' && wholeStatementIn(t, quote);
  if (!whole(texts.now) && !whole(texts.conversation)) {
    return whole(texts.unverified)
      ? { kind: 'refused', refusal: 'origin_unknown', detail: `The words “${quote}” are retained, but their origin is not verified, so nothing was prepared. Ask the user to confirm that figure in their own words.` }
      : { kind: 'refused', refusal: 'statement_not_found', detail: `“${quote}” is not a whole statement in the user's own messages, so nothing was prepared. Quote their complete statement, verbatim, from any of their messages.` };
  }
  const source = verbatimSourceLine({ now: texts.now, conversation: texts.conversation }, quote) ?? quote;
  const qualifier = trimmed(given?.qualifier, 80);
  const conditions = trimmed(given?.conditions, 160);
  // The ask's own words, whole: a cohort option's forecast ask (both questions, its label twice) runs past 500 characters, and a
  // longer cap's silent drop lost the binding the writer re-checks (M4-cohort).
  const answering = trimmed(given?.answering, 1000);
  const negated = given?.negated === true;
  const base = { speaker: 'user' as const, quote, source, subject: rules.subject, form, unit: rules.unit,
    ...(rules.reference !== undefined ? { reference: rules.reference } : {}), ...(rules.period !== undefined ? { period: rules.period } : {}),
    ...(qualifier !== undefined ? { qualifier, qualifier_in_quote: plainQuoteWords(quote).toLowerCase().includes(plainQuoteWords(qualifier).toLowerCase()) } : {}),
    ...(negated ? { negated: true as const } : {}), ...(conditions !== undefined ? { conditions } : {}),
    ...(answering !== undefined ? { answering } : {}), reading: 'olumi' as const };
  // No figure of the user's to check: a condition that holds now, or words that describe the quantity (never a number of theirs).
  if (FIGURE_FREE.has(form)) return { kind: 'verified', statement: base };
  const stated = rules.figuresIn(quote);
  if (form === 'range') {
    const low = figure(given?.low, rules.allowsZero), high = figure(given?.high, rules.allowsZero);
    if (low === undefined || high === undefined || !(low < high)) return malformed(`A range needs low below high, as “${quote}” states them. Nothing was prepared.`);
    const read = stated.find((r) => r.low < r.high && same(quote, low, r.low) && same(quote, high, r.high));
    if (read === undefined) return { kind: 'refused', refusal: 'figure_not_in_quote', detail: `“${quote}” does not state ${low}–${high} ${rules.unit}. Quote the words that state it. Nothing was prepared.` };
    return { kind: 'verified', statement: { ...base, low: read.low, high: read.high } };
  }
  // A negative is a figure only where the quote's own words state it as one (`figuresIn`: a net loss, S4); never the Agent's sign.
  const signed = typeof given?.value === 'number' && given.value < 0 && stated.some((r) => r.low === given.value && r.high === given.value)
    ? given.value : undefined;
  const value = figure(given?.value, rules.allowsZero) ?? signed;
  if (value === undefined) return malformed(`A ${form.replace('_', ' ')} needs the one figure “${quote}” states, as value. Nothing was prepared.`);
  const end = stated.flatMap((r) => (r.low === r.high ? [r.low] : [r.low, r.high])).find((s) => same(quote, value, s));
  if (end === undefined) return { kind: 'refused', refusal: 'figure_not_in_quote', detail: `“${quote}” does not state ${value} ${rules.unit}. Quote the words that state it. Nothing was prepared.` };
  return { kind: 'verified', statement: { ...base, ...(form === 'point' ? { low: end, high: end } : form === 'lower_bound' ? { low: end } : { high: end }) } };
}

/** Every statement verified, or the first refusal (all or nothing, for a chat card); then one set of conditions only. */
export function verifyStatements(raw: unknown, texts: StatementTexts, rules: StatementRules): StatementsVerdict {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STATEMENTS) {
    return { kind: 'refused', refusal: 'statement_malformed', detail: `Give one to ${MAX_STATEMENTS} statements, each the user's exact words with your reading of them. Nothing was prepared.` };
  }
  const out: UserStatement[] = [];
  for (const given of raw as StatementArgs[]) {
    const v = verifyStatement(given, texts, rules);
    if (v.kind === 'refused') return v;
    out.push(v.statement);
  }
  const conditionsOf = (s: UserStatement): string => plainQuoteWords(s.conditions ?? '').toLowerCase();
  if (new Set(out.map(conditionsOf)).size > 1) {
    return { kind: 'refused', refusal: 'different_conditions', detail: 'These statements are about different conditions, so they cannot be combined into one figure. '
      + 'Propose only the statements about today\'s situation, or ask the user which conditions the model should use. Nothing was prepared.' };
  }
  return { kind: 'verified', statements: out };
}

export type CombinedEnds =
  /** Both ends are HARD ends the user gave ("at least 7", "no more than 9"): the user's own range. */
  | { readonly kind: 'range'; readonly low: number; readonly high: number }
  /** One figure and no end at all: the only case where a tool may add its own labelled spread. */
  | { readonly kind: 'point'; readonly value: number; readonly statement: UserStatement }
  /**
   * ⭐ AIE #94 6174707160: what the user said is kept AS STATED, but it is not two hard ends: a lone bound, or a qualified end
   * ("8 months as a likely upper end, not the latest possible time"). No end is chosen for them, no percentile is assumed and
   * no number is picked to open the Run; `needs` is the one hard end still missing, the next useful question.
   */
  | { readonly kind: 'held'; readonly needs: 'upper' | 'lower'; readonly hard_end?: { readonly end: 'lower' | 'upper'; readonly months: number } }
  | { readonly kind: 'conflict'; readonly detail: string };

/** The ends the statements give, hard apart from qualified. A negated statement ("not 7 months") gives no end. */
export function combineStatementEnds(statements: readonly UserStatement[]): CombinedEnds {
  const used = statements.filter((s) => s.negated !== true && !FIGURE_FREE.has(s.form));
  const isLow = (s: UserStatement): boolean => (s.form === 'lower_bound' || s.form === 'range') && s.low !== undefined;
  const isHigh = (s: UserStatement): boolean => (s.form === 'upper_bound' || s.form === 'range') && s.high !== undefined;
  const hard = (s: UserStatement): boolean => s.qualifier === undefined;
  const distinct = (xs: readonly UserStatement[], end: 'low' | 'high'): number[] => [...new Set(xs.map((s) => s[end]!))];
  const two = (xs: number[], what: string): CombinedEnds | null => (xs.length > 1
    ? { kind: 'conflict', detail: `The user's words give two different ${what} (${xs.join(' and ')}). Ask which one holds.` } : null);
  const hardLows = distinct(used.filter((s) => isLow(s) && hard(s)), 'low'), softLows = distinct(used.filter((s) => isLow(s) && !hard(s)), 'low');
  const hardHighs = distinct(used.filter((s) => isHigh(s) && hard(s)), 'high'), softHighs = distinct(used.filter((s) => isHigh(s) && !hard(s)), 'high');
  const points = distinct(used.filter((s) => s.form === 'point' && s.low !== undefined), 'low');
  const clash = two(hardLows, 'lower ends') ?? two(hardHighs, 'upper ends') ?? two(softLows, 'likely lower ends') ?? two(softHighs, 'likely upper ends');
  if (clash !== null) return clash;
  const low = hardLows[0], high = hardHighs[0];
  if (low !== undefined && high !== undefined && !(low < high)) {
    return { kind: 'conflict', detail: `The user's lower end (${low}) is not below their upper end (${high}). Ask which one holds.` };
  }
  // Every other figure the user gave must sit inside their own hard ends.
  const outside = [...points, ...softLows, ...softHighs].find((p) => (low !== undefined && p < low) || (high !== undefined && p > high));
  if (outside !== undefined) return { kind: 'conflict', detail: `The user's figure ${outside} falls outside their own bound. Ask which one holds.` };
  if (low !== undefined && high !== undefined) return { kind: 'range', low, high };
  if (low !== undefined || high !== undefined || softLows.length > 0 || softHighs.length > 0) {
    return { kind: 'held', needs: high === undefined ? 'upper' : 'lower',
      ...(low !== undefined ? { hard_end: { end: 'lower' as const, months: low } } : high !== undefined ? { hard_end: { end: 'upper' as const, months: high } } : {}) };
  }
  if (points.length > 1) return { kind: 'conflict', detail: `The user's words give different figures (${points.join(' and ')}). Ask which one holds.` };
  if (points.length === 1) return { kind: 'point', value: points[0]!, statement: used.find((s) => s.form === 'point')! };
  return { kind: 'conflict', detail: 'None of these statements gives a figure. Quote the words that state one.' };
}

/**
 * A statement as stored (a card's operation, a carrier's `statements`), read back as the contract's type, or `undefined` if it is
 * not one. The ONE reader, so no caller double-casts stored bytes into a statement (the forbidden-boundary gate).
 */
export function userStatementOf(v: unknown): UserStatement | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const subject = r.subject !== null && typeof r.subject === 'object' && !Array.isArray(r.subject) ? r.subject as Record<string, unknown> : undefined;
  const form = STATEMENT_FORMS.find((f) => f === r.form);
  const optional = (k: string): string | undefined => (typeof r[k] === 'string' ? r[k] as string : undefined);
  const end = (k: string): number | undefined => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] as number : undefined);
  if (r.speaker !== 'user' || r.reading !== 'olumi' || typeof r.quote !== 'string' || typeof r.source !== 'string' || form === undefined
    || subject === undefined || typeof subject.quantity !== 'string') return undefined;
  const low = end('low'), high = end('high'), qualifier = optional('qualifier'), conditions = optional('conditions');
  return { speaker: 'user', quote: r.quote, source: r.source, form, reading: 'olumi',
    subject: { quantity: subject.quantity, ...(typeof subject.node_id === 'string' ? { node_id: subject.node_id } : {}),
      ...(typeof subject.option_id === 'string' ? { option_id: subject.option_id } : {}) },
    ...(low !== undefined ? { low } : {}), ...(high !== undefined ? { high } : {}),
    ...(optional('unit') !== undefined ? { unit: optional('unit') } : {}), ...(optional('reference') !== undefined ? { reference: optional('reference') } : {}),
    ...(optional('period') !== undefined ? { period: optional('period') } : {}),
    ...(qualifier !== undefined ? { qualifier, ...(typeof r.qualifier_in_quote === 'boolean' ? { qualifier_in_quote: r.qualifier_in_quote } : {}) } : {}),
    ...(r.negated === true ? { negated: true as const } : {}), ...(conditions !== undefined ? { conditions } : {}),
    ...(optional('answering') !== undefined ? { answering: optional('answering') } : {}) };
}

/** How a statement's reading reads on a card: "at least 7 months", "a likely upper end of 8 months". */
export function statementReadingWords(s: UserStatement, unit: string): string {
  const q = s.qualifier !== undefined ? `${s.qualifier} ` : '';
  if (s.form === 'lower_bound') return `a ${q}lower end of ${s.low} ${unit}`;
  if (s.form === 'upper_bound') return `a ${q}upper end of ${s.high} ${unit}`;
  if (s.form === 'range') return `a ${q}range of ${s.low}–${s.high} ${unit}`;
  if (s.form === 'point') return `${q}${s.low} ${unit}`;
  return s.form === 'describes' ? 'your description' : s.form === 'holds_in_window' ? 'your forecast that it holds during the period'
    : 'a condition that holds now';
}
