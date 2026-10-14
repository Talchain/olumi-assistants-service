/**
 * ⭐ S2 THE USER'S OWN OCCURRENCE FOR A RISK (DL 21:15Z 14 Oct). No card could record a user's own figure for how likely a risk is:
 * "I'd say there's about a 30% chance it slips before launch" was never `user_stated`, so every journey with a human-stated risk
 * stayed blocked (hiring's code quality, capacity's specialist shortfall). This is S2's ONE statement contract
 * (`verifyStatements`) with the subject {risk node, occurrence, window}:
 *  - the quote is a WHOLE statement of the user's own verified typed words (inside the verifier), and states exactly ONE
 *    chance in percent: a figure or a range, never a bound, never negated. A percent is a CHANCE only where the words say so
 *    ("chance", "likely", "odds"), and never a share of something: Paul's marketing brief "I can't spend more than 25% of my
 *    time on this, and I'm not that experienced with marketing" is his time, never a 25% chance for his experience risk;
 *  - the chance is GOVERNED by this risk: the statement names no other part of the model (another risk, a factor, an option,
 *    the goal), and it names this risk, or this is the one risk in the model whose occurrence is asked;
 *  - the window is the goal's held window (`riskOccurrenceSubject`); a statement giving another time span is refused, never
 *    rescaled; with no window the risk is not eligible and the caller refuses with the reason.
 * What it returns is Olumi's reading of the user's words. The card quotes them and only the user's press records the block.
 * Pure.
 */
import type { EventRiskV1T } from '../../schemas/event-risk.js';
import { wholeStatementIn } from '../goal-target/input-claim-context.js';
import { factorTheUserNamed } from './stated-by-user.js';
import { verifyStatements, type StatementTexts, type UserStatement } from './user-statements.js';
import { RISK_OCCURRENCE_QUANTITY, riskOccurrenceSubject, userOccurrenceBlock } from './risk-occurrence.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

const NUM = String.raw`(?<![\d.,])(\d{1,3}(?:\.\d+)?)`;
const PCT = String.raw`(?:\s?%|\s?per\s?cent\b)`;
const RANGES = [new RegExp(String.raw`\bbetween\s+${NUM}${PCT}?\s+and\s+${NUM}${PCT}`, 'giu'),
  new RegExp(String.raw`${NUM}${PCT}?\s*(?:-|–|—|\bto\b)\s*${NUM}${PCT}`, 'giu')];
const POINT = new RegExp(String.raw`${NUM}${PCT}`, 'giu');
/** Words that make a percent a likelihood, and a percent that is a share of something ("25% of my time"). */
const CHANCE_WORDS = /(?<![\p{L}])(?:chances?|likely|likelihood|probability|probable|odds)(?![\p{L}])/iu;
const SHARE_OF = new RegExp(String.raw`${NUM}${PCT}\s+of(?![\p{L}])`, 'iu');
/** The words state a likelihood: they say so, and no percent in them is a share of something. */
export const saysAChance = (quote: string): boolean => CHANCE_WORDS.test(quote) && !SHARE_OF.test(quote);

/** Every chance the words state in percent, each as its two ends (a single figure has both equal). */
export function percentReadingsIn(text: string): { readonly low: number; readonly high: number }[] {
  const out: { low: number; high: number }[] = [];
  let rest = text;
  for (const re of RANGES) {
    rest = rest.replace(re, (whole, a: string, b: string) => {
      const low = Number(a), high = Number(b);
      if (low < high) out.push({ low, high });
      return ' '.repeat(whole.length);
    });
  }
  for (const m of rest.matchAll(POINT)) out.push({ low: Number(m[1]), high: Number(m[1]) });
  return out;
}

const COUNT: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, eighteen: 18, 'twenty-four': 24 };
const DURATION = new RegExp(String.raw`(?<![\p{L}\p{N}])(\d+(?:\.\d+)?|${Object.keys(COUNT).join('|')})[\s-]+(day|week|month|quarter|year)s?(?![\p{L}])`, 'giu');
const NEXT = /(?<![\p{L}])(?:next|this|coming)\s+(day|week|month|quarter|year)(?![\p{L}])/giu;
const MONTHS: Readonly<Record<string, number>> = { day: Number.NaN, week: Number.NaN, month: 1, quarter: 3, year: 12 };

/** Every time span the words give, in months (a span in days or weeks is never a month count: NaN). */
export function durationMonthsIn(text: string): number[] {
  const spans = [...text.matchAll(DURATION)].map((m) => (Number(m[1]) || COUNT[m[1]!.toLowerCase()]!) * MONTHS[m[2]!.toLowerCase()]!);
  return [...spans, ...[...text.matchAll(NEXT)].map((m) => MONTHS[m[1]!.toLowerCase()]!)];
}

/** The model's named parts, each with a label (the decision's whole question is not a part). */
function partsOf(graph: unknown): { readonly id: string; readonly kind: unknown; readonly label: string }[] {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  return nodes.flatMap((n) => (typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim() !== '' && n.kind !== 'decision'
    ? [{ id: n.id, kind: n.kind, label: n.label }] : []));
}

/**
 * The chance in `quote` is about this risk: the words name no other part of the model, and they name this risk, or this is
 * the ONE risk whose occurrence the model asks (an eligible root with no level), so "it" can only be this one.
 */
export function occurrenceGovernedBy(graph: unknown, riskId: string, quote: string): boolean {
  const parts = partsOf(graph);
  const risk = parts.find((p) => p.id === riskId);
  if (risk === undefined || risk.kind !== 'risk') return false;
  const names = (p: { label: string }): boolean => factorTheUserNamed(p.label, quote,
    { options: [], others: parts.map((x) => x.label).filter((l) => l !== p.label) });
  if (parts.some((p) => p.id !== riskId && names(p))) return false;
  if (names(risk)) return true;
  const asked = parts.filter((p) => p.kind === 'risk' && riskOccurrenceSubject(graph, p.id).kind === 'eligible');
  return asked.length === 1 && asked[0]!.id === riskId;
}

export type OccurrenceStatementVerdict =
  | { readonly kind: 'verified'; readonly statement: UserStatement; readonly block: EventRiskV1T }
  | { readonly kind: 'refused'; readonly refusal: 'origin_unknown' | 'occurrence_not_stated' | 'occurrence_not_this_risk' | 'occurrence_other_window';
    readonly detail: string };

/** The user's ONE statement of this risk's chance within the goal's window, verified and governed, with its block; or the refusal. */
export function verifyOccurrenceStatement(graph: unknown, risk: { readonly id: string; readonly label: string }, windowMonths: number,
  raw: unknown, texts: StatementTexts): OccurrenceStatementVerdict {
  const label = risk.label.trim();
  const notStated = (detail: string): OccurrenceStatementVerdict => ({ kind: 'refused', refusal: 'occurrence_not_stated', detail });
  if (!Array.isArray(raw) || raw.length !== 1) {
    return notStated(`Give the user's ONE complete statement of how likely ‘${label}’ is to happen, copied exactly, with the chance it states. Nothing was prepared.`);
  }
  const v = verifyStatements(raw, texts, { subject: { quantity: RISK_OCCURRENCE_QUANTITY, node_id: risk.id }, unit: '%', forms: ['point', 'range'],
    period: `${windowMonths} months`, figuresIn: percentReadingsIn });
  if (v.kind === 'refused') return v.refusal === 'origin_unknown' ? { kind: 'refused', refusal: 'origin_unknown', detail: v.detail } : notStated(v.detail);
  const s = v.statements[0]!;
  if (s.negated === true || percentReadingsIn(s.quote).length !== 1 || !saysAChance(s.quote)) {
    return notStated(`“${s.quote}” does not state one chance for ‘${label}’, so nothing was prepared. Ask the user how likely ‘${label}’ is; do not choose a figure for them.`);
  }
  if (!occurrenceGovernedBy(graph, risk.id, s.quote)) {
    return { kind: 'refused', refusal: 'occurrence_not_this_risk', detail: `“${s.quote}” is not clearly about ‘${label}’, so nothing was prepared. `
      + `Ask the user which risk their figure is for; do not ask them to repeat it.` };
  }
  if (durationMonthsIn(s.quote).some((m) => m !== windowMonths)) {
    const window = windowMonths === 1 ? 'a month' : `${windowMonths} months`;
    return { kind: 'refused', refusal: 'occurrence_other_window', detail: `“${s.quote}” gives a different time span from the goal’s window of ${window}, `
      + `and Olumi never rescales a chance, so nothing was prepared. Ask how likely ‘${label}’ is to happen at least once within ${window}.` };
  }
  const block = userOccurrenceBlock(s.low, s.high, windowMonths);
  return block === undefined ? notStated(`“${s.quote}” does not state a chance between 0 and 100% for ‘${label}’. Nothing was prepared.`)
    : { kind: 'verified', statement: s, block };
}

/** The user's complete statements in a typed message, each a whole statement of it. */
const statementsIn = (typed: string): string[] => typed.split(/(?<=[.!?;])\s+|\n+/u).map((s) => s.trim())
  .filter((s) => s !== '' && wholeStatementIn(typed, s));

/**
 * The card's arguments when THIS turn's typed words state ONE governed chance for ONE risk the model asks the occurrence of
 * (`verifyOccurrenceStatement` holds it): the route issues it when the Agent did not. Any doubt (two chances, two risks, no
 * window, another span) prepares nothing, and the ask stays as it is.
 */
export function typedOccurrenceArgs(graph: unknown, typed: string | null | undefined): { readonly assumptions: readonly Rec[] } | undefined {
  if (typeof typed !== 'string' || typed.trim() === '') return undefined;
  const found = partsOf(graph).filter((p) => p.kind === 'risk').flatMap((risk) => {
    const subject = riskOccurrenceSubject(graph, risk.id);
    if (subject.kind !== 'eligible') return [];
    return statementsIn(typed).flatMap((quote) => {
      const readings = percentReadingsIn(quote);
      if (readings.length !== 1 || !saysAChance(quote)) return [];
      const { low, high } = readings[0]!;
      const statement = low === high ? { quote, form: 'point', value: low } : { quote, form: 'range', low, high };
      const v = verifyOccurrenceStatement(graph, risk, subject.window_months, [statement], { now: typed });
      return v.kind === 'verified' ? [{ risk, statement, value: low }] : [];
    });
  });
  if (found.length !== 1) return undefined;
  const { risk, statement, value } = found[0]!;
  return { assumptions: [{ factor_label: risk.label, value, unit: '%', basis: '', user_stated: true, statements: [statement] }] };
}

/** The route issues the user's occurrence card only on a turn that changed, approved and offered nothing, with no card waiting. */
export function typedOccurrenceToIssue(p: {
  readonly toolCalls: readonly { readonly name: string }[];
  readonly mutated: boolean;
  readonly proposalOffered: boolean;
  readonly heldWaiting: boolean;
}): boolean {
  return !p.mutated && !p.proposalOffered && !p.heldWaiting && !p.toolCalls.some((c) => c.name === 'authorise_change');
}
