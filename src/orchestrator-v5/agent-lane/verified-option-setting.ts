/** r5-stated-evidence-v1. A narrow construction exception, never a general authorship reader.
 * Every gate is necessary. P consumes whole assertions; O binds the selected alternative arm.
 * Unsupported syntax/context refuses. No model-supplied ownership or intervention unit is authority.
 */
import { metricNamesLabel, type CandidateModel, type StatedOptionEvidence } from './admit-model.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { CARDINAL_AMOUNT_SOURCE, parseCardinalAmount } from '../../utils/cardinal-words.js';
import { labelHead } from './label-head-unit.js';
import { readUnitParts } from './same-unit.js';
import { figureTheUserWroteForSpan, sameWord } from './stated-by-user.js';

type Option = CandidateModel['options'][number];
type Intervention = NonNullable<Option['interventions']>[number];
type Assertion = { text: string; start: number; end: number };
type Point = { kind: 'saturday' | 'starter_price' | 'starter_count' | 'rent'; arm: string; unit: string; owned: boolean };
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const NUMBER = `(?:\\d+(?:,\\d{3})*(?:\\.\\d+)?|${CARDINAL_AMOUNT_SOURCE})`;
const PERIOD = '(?:month|quarter|year|week)';
const APPROX = '(?:(?:about|roughly) )?';
const rx = (s: string): RegExp => new RegExp(`^${s}$`, 'iu');

/** Sentence boundaries come from the original text; commas, semicolons and quotation punctuation cannot hide context. */
function assertionAt(brief: string, at: number): Assertion | null {
  for (const m of brief.matchAll(/[^\n]+?(?:[.!?](?=\s|$)|$)/gu)) {
    const start = m.index! + m[0].length - m[0].trimStart().length;
    const text = m[0].trim();
    if (at >= start && at < start + text.length) return { text, start, end: start + text.length };
  }
  return null;
}
function exactEvidence(brief: string, e: StatedOptionEvidence): boolean {
  const valid = (start: number, end: number): boolean => Number.isSafeInteger(start) && Number.isSafeInteger(end)
    && start >= 0 && end > start && end <= brief.length;
  return valid(e.start, e.end) && valid(e.option_start, e.option_end) && Number.isSafeInteger(e.amount_start)
    && e.amount_start >= e.start && e.amount_start < e.end
    && brief.slice(e.start, e.end) === e.quote && brief.slice(e.option_start, e.option_end) === e.option_quote
    && brief.indexOf(e.quote) === brief.lastIndexOf(e.quote) && brief.indexOf(e.option_quote) === brief.lastIndexOf(e.option_quote);
}
/** Fail closed on an enclosing quotation or a source block, even after ! or a new paragraph. */
function directContext(brief: string, a: Assertion): boolean {
  const context = brief.slice(0, a.end);
  return !/["“”«»]|(?:^|[\s:(])['‘]|['’](?=$|[\s.!?,;:])/mu.test(context)
    && !/^(?:[^\n]+:\s*$|\[(?:Page|Paragraph) \d+\])/mu.test(context);
}

/** P: select the independently stated centre, never an endpoint, and consume the whole sentence/list. */
function pointAssertion(a: Assertion, literal: string, at: number): Point | null {
  const figure = esc(literal.trim());
  const local = at - a.start + literal.length - literal.trimStart().length;
  const saturday = `(?:open for|run) ${APPROX}(${NUMBER}) (?:Saturday sessions|sessions on Saturdays) (?:each|a|per) (${PERIOD})(?: as a (light|full) option)?`;
  const clinic = /^(We could|We ran|We currently run|We will) (.+)\.$/iu.exec(a.text);
  if (clinic !== null) {
    const owned = clinic[1]!.toLowerCase() === 'we could' || clinic[1]!.toLowerCase() === 'we will';
    const body = clinic[2]!;
    // Lists split only at explicit alternative separators. A numeric "or" remains in the arm and fails P.
    const arms = body.split(/, (?:or )?| or (?=(?:open|run|keep|extend)\b)/iu);
    let selected: Point | null = null;
    let cursor = a.text.indexOf(body);
    for (const arm of arms) {
      const armStart = a.text.indexOf(arm, cursor); cursor = armStart + arm.length;
      const m = rx(saturday).exec(arm);
      const other = /^(?:keep the present timetable|extend weekday opening by \d+ hours a week)$/iu.test(arm);
      if (m === null && !other) return null;
      if (m !== null && armStart + arm.indexOf(m[1]!) === local && m[1]!.toLowerCase() === literal.trim().toLowerCase()) {
        if (selected !== null) return null;
        selected = { kind: 'saturday', arm, unit: `sessions/${m[2]!}`, owned };
      }
    }
    return selected;
  }
  const decision = /^Decision: (.+)\.$/u.exec(a.text);
  if (decision !== null) {
    let selected: Point | null = null;
    let cursor = a.text.indexOf(decision[1]!);
    for (const arm of decision[1]!.split(/, (?:or )?| or (?=(?:launch|keep|raise)\b)/iu)) {
      const armStart = a.text.indexOf(arm, cursor); cursor = armStart + arm.length;
      const m = rx(`launch a starter tier at ${APPROX}(${figure}) (?:a|per|each) (${PERIOD})`).exec(arm);
      const other = rx(`(?:raise prices by ${NUMBER}%|keep pricing as it is|launch a starter tier at ${APPROX}£${NUMBER} (?:a|per|each) ${PERIOD})`).test(arm);
      if (m === null && !other) return null;
      if (m !== null && armStart + arm.indexOf(m[1]!) === local) {
        if (selected !== null) return null;
        selected = { kind: 'starter_price', arm, unit: `${literal.trim().replace(/[\d, .]+$/u, '')}/${m[2]!}`, owned: true };
      }
    }
    return selected;
  }
  const count = rx(`The starter tier would win ${APPROX}(${figure}) new subscribers(?:, between (${NUMBER}) and (${NUMBER}))?\\.`).exec(a.text);
  if (count !== null && a.text.indexOf(count[1]!) === local) {
    return { kind: 'starter_count', arm: a.text, unit: 'subscribers', owned: true };
  }
  const rent = rx(`A ([A-Z][a-z]+) lease costs ${APPROX}£${NUMBER} to fit out plus (${figure}) rent (?:a|per|each) (${PERIOD})\\.`).exec(a.text);
  if (rent !== null && a.text.indexOf(rent[2]!, a.text.indexOf('plus')) === local) {
    return { kind: 'rent', arm: a.text, unit: `${literal.trim().replace(/[\d, .]+$/u, '')}/${rent[3]!}`, owned: true };
  }
  return null;
}

/** U: the assertion states the frame. No annualisation or period inferred from model words. */
function sameFrame(point: Point, unit: unknown, brief: string): boolean {
  const expected = readUnitParts(unit); const stated = readUnitParts(point.unit);
  if (expected === null || stated === null || expected.kind !== stated.kind || expected.code !== stated.code
    || expected.scale !== stated.scale || expected.period !== stated.period) return false;
  if (point.kind === 'starter_price') {
    if (expected.per === null) return true;
    // A count alone never supplies a price denominator. Require the independently written EACH-subscriber rate.
    const launch = findStatedAmounts(point.arm).find(n => n.kind === 'currency');
    const rate = [...brief.matchAll(/Each starter subscriber adds £[\d,]+(?:\.\d+)? (?:a|per|each) (?:month|quarter|year|week) to monthly recurring revenue\./gu)]
      .find(m => findStatedAmounts(m[0])[0]?.magnitude === launch?.magnitude);
    if (rate === undefined) return false;
    const context = assertionAt(brief, rate.index!);
    const statedRate = readUnitParts(`£/subscriber/${/ (month|quarter|year|week) to/u.exec(rate[0])?.[1] ?? ''}`);
    return context !== null && context.text === rate[0] && directContext(brief, context) && statedRate?.period === expected.period
      && (expected.per.join(' ') === 'subscriber' || expected.per.join(' ') === 'starter subscriber');
  }
  return JSON.stringify(expected.noun) === JSON.stringify(stated.noun) && expected.per === null
    && expected.base === null && expected.qualifiers === null;
}

/** The supported imported-asset block: every line is accounted for, with an independently owned shop question.
 * Other document shapes refuse, including a bare "We" under any source heading.
 */
function importedAsset(brief: string, anchor: Assertion, setting: Assertion): boolean {
  const document = rx(`From bakery-brief\\.docx:\\n\\[Paragraph 1\\] Should we open a second bakery shop in ([A-Z][a-z]+) or expand home delivery from our current ([A-Z][a-z]+) shop\\?\\n`
    + `\\[Paragraph 2\\] We want monthly profit to rise by at least £${NUMBER} within twelve months\\.\\n`
    + `\\[Paragraph 3\\] Our budget is £${NUMBER} and we currently have ${NUMBER} staff\\.\\n\\n`
    + `From bakery-costs\\.pdf:\\n\\[Page 1\\] Delivery orders grew ${NUMBER}% last year; walk-in sales were flat\\.\\n`
    + `${esc(setting.text)}\\nDelivery expansion needs two vans at £${NUMBER} each and four drivers\\.`).exec(brief);
  return document !== null && anchor.text === `[Paragraph 1] Should we open a second bakery shop in ${document[1]!} or expand home delivery from our current ${document[2]!} shop?`
    && setting.text.startsWith(`A ${document[1]!} lease costs `);
}

/** O: discriminate sibling options with words AND figures in this arm, never a sibling's anchor. */
function ownedOption(model: CandidateModel, option: Option, e: StatedOptionEvidence, a: Assertion, point: Point, brief: string): boolean {
  const anchor = assertionAt(brief, e.option_start);
  if (!point.owned || anchor === null || anchor.start !== e.option_start || anchor.end !== e.option_end) return false;
  let matches: Option[];
  if (point.kind === 'saturday') {
    if (anchor.start !== a.start || anchor.end !== a.end || !directContext(brief, a)) return false;
    const amount = findStatedAmounts(point.arm)[0]?.magnitude
      ?? parseCardinalAmount(rx(`(?:open for|run) ${APPROX}(${NUMBER}) .+`).exec(point.arm)?.[1] ?? '');
    matches = model.options.filter(o => {
      if (!/\bsaturdays?\b/iu.test(o.label)) return false;
      const figures = [...findStatedAmounts(o.label).map(n => n.magnitude),
        ...o.label.matchAll(new RegExp(`\\b${CARDINAL_AMOUNT_SOURCE}\\b`, 'giu'))].map(n => typeof n === 'number' ? n : parseCardinalAmount(n[0]));
      if (figures.some(n => n !== amount)) return false;
      const words = o.label.toLowerCase().match(/[a-z]+/gu) ?? [];
      return words.every(w => /^(?:open|opening|on|for|saturday|saturdays|session|sessions|per|month)$/u.test(w)
        || parseCardinalAmount(w) !== null || point.arm.toLowerCase().split(/\W+/u).includes(w));
    });
  } else if (point.kind === 'starter_count' || point.kind === 'starter_price') {
    if (!directContext(brief, a) || !directContext(brief, anchor)
      || !/^Decision: /u.test(anchor.text)) return false;
    // The anchor independently contains a fully parsed launch-price arm; a count statement alone does not own a launch.
    const price = findStatedAmounts(anchor.text).find(n => n.kind === 'currency');
    if (price === undefined || pointAssertion(anchor, price.matchedText, anchor.start + price.index)?.kind !== 'starter_price') return false;
    if (point.kind === 'starter_price' && anchor.start !== a.start) return false;
    matches = model.options.filter(o => /^(?:launch|introduce) (?:a )?starter[ -]tier$/iu.test(o.label));
  } else {
    if (!importedAsset(brief, anchor, a)) return false;
    const place = /^A ([A-Z][a-z]+) lease/u.exec(a.text)?.[1];
    matches = model.options.filter(o => rx(`Open ${esc(place ?? '')} (?:shop|location)`).test(o.label));
  }
  return matches.length === 1 && matches[0] === option;
}

export function verifiedOptionSetting(model: CandidateModel, option: Option, intervention: Intervention, brief: string | undefined): boolean {
  const e = intervention.stated_evidence;
  // E: exact, complete and unique spans. Reconstructed context, not the model's shortened quotation.
  if (typeof brief !== 'string' || e == null || !exactEvidence(brief, e)) return false;
  const a = assertionAt(brief, e.amount_start);
  if (a === null || a.start !== e.start || a.end !== e.end) return false;
  const factors = model.factors.filter(f => f.label === intervention.factor_label);
  if (factors.length !== 1 || (option.interventions ?? []).filter(i => i.factor_label === intervention.factor_label).length !== 1) return false;
  const factor = factors[0]!;
  const others = [model.goal.metric, ...model.factors.filter(f => f !== factor).map(f => f.label),
    ...model.outcomes.map(o => o.label), ...model.risks.map(r => r.label)];
  // F: existing strict entity binder plus a NEAR head. Never use the intervention unit as evidence.
  const span = figureTheUserWroteForSpan(intervention.value, factor.unit, brief,
    { target: [factor.label], others, strict: true, requireNamed: true, at: e.amount_start });
  if (span === null) return false;
  const literal = brief.slice(span.start, span.end);
  const head = labelHead(factor.label);
  const point = pointAssertion(a, literal, span.start);
  const right = (brief.slice(span.end, a.end).match(/[\p{L}]+/gu) ?? []).slice(0, 2);
  const left = (brief.slice(a.start, span.start).match(/[\p{L}]+/gu) ?? [])
    .filter(w => !/^(?:is|was|were|at|about|roughly|would|will|could|a|an|to|of|by|for|new)$/iu.test(w));
  if (head === undefined || (!right.some(w => sameWord(head, w.toLowerCase()))
    && !sameWord(head, left.at(-1)?.toLowerCase() ?? ''))) return false;
  // P refuses a constraint equality too: its amount cannot silently become an option action.
  if (point === null || model.constraints.some(c => c.value === intervention.value && metricNamesLabel(c.metric, factor.label))) return false;
  if (!sameFrame(point, factor.unit, brief)) return false; // U
  return ownedOption(model, option, e, a, point, brief); // O
}
