/**
 * ⭐ S2 THE USER'S OWN OCCURRENCE FOR A RISK (DL 21:15Z 14 Oct; AIE AMEND 6179240850). No card could record a user's own figure for
 * how likely a risk is, so every journey with a human-stated risk stayed blocked. This is S2's ONE statement contract
 * (`verifyStatements`) with the subject {risk node, occurrence, window}, read by the ONE shared occurrence reader
 * (`readStatedEventRiskWithBindingSpan`, event_risk slice 2a: one probability with its likelihood cue, one stated window in its
 * clause), never another matcher:
 *  - the statement is a WHOLE statement of the user's own verified typed words;
 *  - its window is the user's own: it must state one, and it must be the goal's held window counted from today. "Before
 *    launch" states no window, and a same month count after a launch is a different window: neither is ever given the goal's;
 *  - the event is bound to THIS risk by the user's words (its clause names this risk and no other), by their current selection
 *    of it on the canvas, or by Olumi's preceding question about it. The one remaining unsized risk is never proof of "it";
 *  - a negated event, a condition, an option named in the clause, or a zero is not this card's reading: refused with its reason,
 *    their estimate kept as they said it.
 * What it returns is Olumi's reading of the user's words. The card quotes them and only the user's press records the block.
 * Pure.
 */
import type { EventRiskV1T } from '../../schemas/event-risk.js';
import { wholeStatementIn } from '../goal-target/input-claim-context.js';
import { isFactorNamedByUser, readStatedEventRiskWithBindingSpan } from '../routing/stated-event-risk.js';
import { verifyStatements, type StatementTexts, type UserStatement } from './user-statements.js';
import { RISK_OCCURRENCE_QUANTITY, riskOccurrenceAskWords, riskOccurrenceSubject, riskOccurrenceWindowFromToday } from './risk-occurrence.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What binds the event to a risk beside the user's words: their current canvas selection, and Olumi's preceding question. */
export interface OccurrenceContext {
  readonly selection?: { readonly element_ids: readonly string[]; readonly unresolved: string };
  readonly preceding_ask?: string;
}

const APPROXIMATE = /(?<![\p{L}])(?:about|around|roughly|approximately|maybe|perhaps)(?![\p{L}])/iu;
/** A statement that negates what it states, or states it under a condition: never read as stating it (shared with the timing door). */
export const NEGATED = /(?<![\p{L}])(?:not|never|no|won['’]t|wouldn['’]t|isn['’]t|doesn['’]t|don['’]t|can['’]t|cannot)(?![\p{L}])/iu;
export const CONDITIONAL = /(?<![\p{L}])(?:if|unless|assuming|provided|once)(?![\p{L}])/iu;

function partsOf(graph: unknown): { readonly id: string; readonly kind: unknown; readonly label: string }[] {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  return nodes.flatMap((n) => (typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim() !== '' && n.kind !== 'decision'
    ? [{ id: n.id, kind: n.kind, label: n.label }] : []));
}

/** The user's words name THIS risk's event: the clause, else their selection, else Olumi's preceding question about it. */
export function occurrenceBoundTo(graph: unknown, riskId: string, clause: string, context: OccurrenceContext = {}): 'bound' | 'another' | 'unbound' {
  const risks = partsOf(graph).filter((p) => p.kind === 'risk');
  if (!risks.some((r) => r.id === riskId)) return 'unbound';
  const named = risks.filter((r) => isFactorNamedByUser(r.label, clause));
  if (named.length > 1) return 'unbound';
  if (named.length === 1) return named[0]!.id === riskId ? 'bound' : 'another';
  const s = context.selection;
  if (s !== undefined && s.unresolved === 'none' && s.element_ids.length === 1) {
    if (s.element_ids[0] === riskId) return 'bound';
    if (risks.some((r) => r.id === s.element_ids[0])) return 'another';
  }
  const ask = context.preceding_ask;
  if (typeof ask === 'string') {
    const asked = risks.filter((r) => {
      const subject = riskOccurrenceSubject(graph, r.id);
      return subject.kind === 'eligible' && ask.includes(riskOccurrenceAskWords(r.label, subject.window_months));
    });
    if (asked.length === 1) return asked[0]!.id === riskId ? 'bound' : 'another';
  }
  return 'unbound';
}

export type OccurrenceStatementVerdict =
  | { readonly kind: 'verified'; readonly statement: UserStatement; readonly block: EventRiskV1T }
  | { readonly kind: 'refused'; readonly refusal: 'origin_unknown' | 'occurrence_not_stated' | 'occurrence_not_this_risk' | 'occurrence_other_window';
    readonly detail: string };

const windowSaid = (months: number): string => (months === 1 ? 'a month' : `${months} months`);

/**
 * The user's ONE whole statement of this risk's chance within the goal's window, verified and bound, with its block; or the
 * refusal, which keeps their estimate as they said it and names only the missing binding.
 */
export function verifyOccurrenceStatement(graph: unknown, risk: { readonly id: string; readonly label: string }, windowMonths: number,
  raw: unknown, texts: StatementTexts, context: OccurrenceContext = {}): OccurrenceStatementVerdict {
  const label = risk.label.trim();
  const keep = 'Keep the user’s estimate exactly as they said it and do not ask them to repeat it.';
  const notStated = (detail: string): OccurrenceStatementVerdict => ({ kind: 'refused', refusal: 'occurrence_not_stated', detail });
  if (!Array.isArray(raw) || raw.length !== 1 || !isRec(raw[0]) || typeof raw[0].quote !== 'string') {
    return notStated(`Give the user's ONE complete statement of how likely ‘${label}’ is to happen, copied exactly. Nothing was prepared.`);
  }
  const quote = raw[0].quote.trim();
  const stated = readStatedEventRiskWithBindingSpan(quote);
  if (stated === undefined) {
    return { kind: 'refused', refusal: 'occurrence_other_window', detail: `“${quote}” does not state one chance over a stated time span that Olumi can read, `
      + `so nothing was prepared. ${keep} If it gives a chance, ask only which time span it covers, for example within ${windowSaid(windowMonths)} from today.` };
  }
  const clause = stated.clause_text;
  if (NEGATED.test(clause) || CONDITIONAL.test(clause) || partsOf(graph).some((p) => p.kind === 'option' && isFactorNamedByUser(p.label, clause))) {
    return notStated(`“${quote}” states a chance for a negated or conditional event, which this card cannot record as ‘${label}’ happening. Nothing was prepared. ${keep}`);
  }
  const { p_low: low, p_high: high } = stated.event_risk.occurrence;
  if (low === 0 && high === 0) {
    return notStated(`The user said a 0% chance (“${quote}”). Olumi cannot yet record a zero on this card, so nothing was prepared. ${keep} Do not replace it with another figure.`);
  }
  const bound = occurrenceBoundTo(graph, risk.id, clause, context);
  if (bound !== 'bound') {
    return { kind: 'refused', refusal: 'occurrence_not_this_risk', detail: `“${quote}” is not clearly about ‘${label}’, so nothing was prepared. ${keep} `
      + 'Ask only which risk their figure is for.' };
  }
  if (stated.event_risk.horizon.months !== windowMonths || !riskOccurrenceWindowFromToday(graph)) {
    return { kind: 'refused', refusal: 'occurrence_other_window', detail: `“${quote}” covers a different time span from the goal’s window of ${windowSaid(windowMonths)} `
      + `from today, and Olumi never rescales a chance, so nothing was prepared. ${keep} Ask only whether it holds within ${windowSaid(windowMonths)} from today.` };
  }
  const percent = (p: number): number => Number((p * 100).toFixed(6));
  const qualifier = APPROXIMATE.exec(clause)?.[0];
  const v = verifyStatements([low === high ? { quote, form: 'point', value: percent(low), ...(qualifier !== undefined ? { qualifier } : {}) }
    : { quote, form: 'range', low: percent(low), high: percent(high), ...(qualifier !== undefined ? { qualifier } : {}) }], texts,
  { subject: { quantity: RISK_OCCURRENCE_QUANTITY, node_id: risk.id }, unit: '%', forms: ['point', 'range'], period: `${windowMonths} months`,
    figuresIn: () => [{ low: percent(low), high: percent(high) }] });
  if (v.kind === 'refused') return v.refusal === 'origin_unknown' ? { kind: 'refused', refusal: 'origin_unknown', detail: v.detail } : notStated(v.detail);
  return { kind: 'verified', statement: v.statements[0]!, block: stated.event_risk };
}

/** The user's complete statements in a typed message, each a whole statement of it. */
const statementsIn = (typed: string): string[] => typed.split(/(?<=[.!?;])\s+|\n+/u).map((s) => s.trim())
  .filter((s) => s !== '' && wholeStatementIn(typed, s));

/**
 * The card's arguments when THIS turn's typed words state ONE bound chance for ONE risk the model asks the occurrence of
 * (`verifyOccurrenceStatement` holds it): the route issues it when the Agent did not. Any doubt prepares nothing.
 */
export function typedOccurrenceArgs(graph: unknown, typed: string | null | undefined, context: OccurrenceContext = {}):
  { readonly assumptions: readonly Rec[] } | undefined {
  if (typeof typed !== 'string' || typed.trim() === '') return undefined;
  const found = partsOf(graph).filter((p) => p.kind === 'risk').flatMap((risk) => {
    const subject = riskOccurrenceSubject(graph, risk.id);
    if (subject.kind !== 'eligible') return [];
    return statementsIn(typed).flatMap((quote) => {
      const v = verifyOccurrenceStatement(graph, risk, subject.window_months, [{ quote }], { now: typed }, context);
      return v.kind === 'verified' ? [{ risk, quote, value: v.statement.low ?? 0 }] : [];
    });
  });
  if (found.length !== 1) return undefined;
  const { risk, quote, value } = found[0]!;
  return { assumptions: [{ factor_label: risk.label, value, unit: '%', basis: '', user_stated: true, statements: [{ quote }] }] };
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

/** Olumi's last reply in this conversation (its question, if it asked one), from the session's held items. */
export function precedingAssistantText(items: readonly unknown[] | undefined): string | undefined {
  for (const raw of [...(items ?? [])].reverse()) {
    const i = raw as { role?: unknown; type?: unknown; content?: unknown } | null;
    if (i?.role !== 'assistant' && !(i?.type === 'message' && i.role === undefined)) continue;
    const text = typeof i.content === 'string' ? i.content : Array.isArray(i.content)
      ? i.content.map((p: { text?: unknown }) => (typeof p.text === 'string' ? p.text : '')).join('') : '';
    if (text.trim() !== '') return text;
  }
  return undefined;
}
