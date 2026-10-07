/** A fail-closed construction exception for an option setting in the user's own sentence.
 * Quotes are located by CEE; model offsets and ownership assertions are never authority.
 */
import { metricNamesLabel, type CandidateModel } from './admit-model.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { parseCardinalAmount } from '../../utils/cardinal-words.js';
import { labelHead } from './label-head-unit.js';
import { readUnitParts, statedTailParts, labelStandsForCountUnit, singular } from './same-unit.js';
import { figureTheUserWroteForSpan } from './stated-by-user.js';

type Option = CandidateModel['options'][number];
type Intervention = NonNullable<Option['interventions']>[number];
type Assertion = { text: string; start: number; end: number };

/** Linear normalization, also used for uniqueness. Paragraphs are retained separately in raw text. */
function canonical(text: string): string {
  const out: string[] = []; let space = false;
  for (const c of text.normalize('NFKC')) {
    if (/\s/u.test(c)) { space = out.length > 0; continue; }
    if (space) out.push(' ');
    out.push(c); space = false;
  }
  return out.join('');
}
function assertions(brief: string): Assertion[] {
  return [...brief.matchAll(/[^\n]+?(?:[.!?](?=\s|$)|$|(?=\n))/gu)].map(m => ({
    text: canonical(m[0]), start: m.index!, end: m.index! + m[0].length,
  })).filter(a => a.text !== '');
}
function exactEvidence(brief: string, quote: unknown, sentences: Assertion[]): Assertion | null {
  if (typeof quote !== 'string') return null;
  const q = canonical(quote); const text = canonical(brief);
  if (q === '' || text.indexOf(q) < 0 || text.indexOf(q) !== text.lastIndexOf(q)) return null;
  const located = sentences.filter(a => a.text === q);
  return located.length === 1 ? located[0]! : null;
}
/** Refuse enclosing quotes and source headings. No document-name exceptions. */
function directContext(brief: string, a: Assertion): boolean {
  const context = brief.slice(0, a.end);
  if (/["“”«»]|(?:^|[\s:(])['‘]|['’](?=$|[\s.!?,;:])/mu.test(context)) return false;
  return context.split('\n').every(line => {
    const s = line.trim();
    return !s.endsWith(':') && !/^\[(?:Page|Paragraph) [0-9]{1,12}\]/u.test(s);
  });
}
const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]{1,64}/gu) ?? [];
const sameName = (a: string, b: string): boolean => singular(a) === singular(b);
const GRAMMAR = new Set(['a', 'an', 'the', 'our', 'we', 'to', 'for', 'on', 'at', 'in', 'per', 'each', 'every',
  'of', 'as', 'option', 'options', 'open', 'opening', 'run', 'launch', 'introduce', 'keep', 'extend', 'hire',
  'cut', 'set', 'month', 'monthly', 'week', 'weekly', 'year', 'yearly', 'quarter']);
const ACTIONS = new Set(['open', 'run', 'staff', 'hire', 'launch', 'introduce', 'set', 'cut', 'keep', 'extend',
  'expand', 'reduce', 'increase', 'switch', 'adopt', 'use', 'operate', 'fund', 'allocate', 'invest', 'retain']);
const NOT_POINT = new Set(['not', 'cannot', 'no', 'least', 'most', 'minimum', 'maximum', 'min', 'max', 'fewer',
  'more', 'exceeding', 'upwards', 'many', 'between', 'than', 'add', 'additional', 'extra', 'by', 'ignore']);
function namedOption(model: CandidateModel, selected: Option, clause: string, value: number): boolean {
  const said = words(clause);
  const content = (o: Option): string[] => words(o.label).filter(w => !GRAMMAR.has(w)
    && parseCardinalAmount(w) === null && !/^[0-9]{1,64}$/u.test(w));
  const matches = model.options.filter(o => {
    const figures = [...findStatedAmounts(o.label).map(a => a.magnitude),
      ...words(o.label).flatMap(w => { const n = parseCardinalAmount(w); return n === null ? [] : [n]; })];
    if (figures.some(n => n !== value)) return false;
    const own = content(o);
    const distinctive = own.filter(w => !model.options.some(r => r !== o && content(r).some(x => sameName(x, w))));
    // All distinctive words must be in this clause; a shared word alone cannot select a sibling.
    const required = distinctive.length > 0 ? distinctive : own;
    return required.length > 0 && required.every(w => said.some(x => sameName(x, w)));
  });
  return matches.length === 1 && matches[0] === selected;
}
/** A positive ownership frame. History, current-state reporting, conditions and third-party claims abstain. */
function settingClause(a: Assertion, at: number): { text: string; start: number } | null {
  const lead = /^(?:We (?:could|will) |Our options are to |One option is to |Decision: )/iu.exec(a.text);
  // A labelled prospective assertion is also owned, e.g. "The premium plan would attract ...".
  const prospective = /^The (?:[\p{L}]{1,64} ){1,6}would [\p{L}]{1,64} /iu.exec(a.text);
  if (lead === null && prospective === null) return null;
  if (words(a.text).some(w => w === 'last' || w === 'previous')) return null;
  const bodyStart = lead?.[0].length ?? 0;
  const body = a.text.slice(bodyStart);
  let start = bodyStart;
  // Keep numeric alternatives in the clause so the point gate refuses them, rather than selecting an endpoint.
  for (const part of body.split(/, |; | or (?=[\p{L}])/iu)) {
    const end = start + part.length;
    if (at >= start && at < end) {
      const ws = words(part);
      const first = ws[0] === 'to' ? ws[1] : ws[0];
      if (!(prospective !== null && start === 0) && !ACTIONS.has(first ?? '')) return null;
      if (findStatedAmounts(part).length > 1) return null;
      if (ws.some(w => NOT_POINT.has(w)) || /[+/()]|[0-9][ \t]{0,4}(?:or|and|-)[ \t]{0,4}[0-9]/iu.test(part)) return null;
      // The complete local clause supplies the setting; a numeric alternative is never a point.
      if (ws.includes('or') || ws.includes('but') || ws.includes('if')) return null;
      return { text: part, start };
    }
    start = a.text.indexOf(part, start) + part.length;
    const next = a.text.slice(start).match(/^(?:, |; | or )/iu);
    start += next?.[0].length ?? 0;
  }
  return null;
}
function sameFrame(text: string, span: { start: number; end: number }, unit: unknown): boolean {
  const literal = findStatedAmounts(text).find(n => n.index === span.start);
  const written = literal ?? { index: span.start, matchedText: text.slice(span.start, span.end), kind: 'words' };
  const stated = statedTailParts(text, written); const expected = readUnitParts(unit);
  if (stated === null || expected === null || stated.kind !== expected.kind || stated.code !== expected.code
    || stated.scale !== expected.scale || stated.period !== expected.period) return false;
  const same = (x: readonly string[] | null, y: readonly string[] | null): boolean =>
    JSON.stringify(x?.length ? x : null) === JSON.stringify(y?.length ? y : null);
  return same(stated.per, expected.per) && same(stated.base, expected.base) && same(stated.qualifiers, expected.qualifiers)
    && (expected.noun === null || (expected.noun.length > 0
      && expected.noun.every(w => stated.noun?.some(x => sameName(x, w)))));
}
/** DL 7 Oct: a repeated literal (including "the 4") or Olumi attribution in a neighbour refuses.
 * Third-party attribution without either signal is ACCEPTED RESIDUAL (DL 7 Oct).
 */
function safeNeighbours(brief: string, a: Assertion, sentences: Assertion[], literal: string): boolean {
  const breaks = [...brief.matchAll(/\n[ \t]{0,4}\n/gu)].map(m => m.index!);
  const start = breaks.filter(n => n < a.start).at(-1) ?? -1;
  const end = breaks.find(n => n >= a.end) ?? brief.length;
  const token = canonical(literal).toLowerCase();
  return sentences.filter(s => s !== a && s.start > start && s.start < end).every(s => {
    if (/\bOlumi\b|\byou suggested\b|\byour (?:suggestion|last reply)\b/iu.test(s.text)) return false;
    const text = s.text.toLowerCase();
    let at = text.indexOf(token);
    while (at >= 0) {
      const before = text[at - 1] ?? ''; const after = text[at + token.length] ?? '';
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return false;
      at = text.indexOf(token, at + 1);
    }
    return true;
  });
}

export function verifiedOptionSetting(model: CandidateModel, option: Option, intervention: Intervention, brief: string | undefined): boolean {
  const e = intervention.stated_evidence;
  if (typeof brief !== 'string' || e == null) return false;
  const sentences = assertions(brief);
  // Only the unique normalized quote is model evidence. Every offset, including amount_start, is ignored.
  const a = exactEvidence(brief, e.quote, sentences);
  if (a === null || !directContext(brief, a)) return false;
  const factors = model.factors.filter(f => f.label === intervention.factor_label);
  if (factors.length !== 1 || (option.interventions ?? []).filter(i => i.factor_label === intervention.factor_label).length !== 1) return false;
  const factor = factors[0]!;
  const others = [model.goal.metric, ...model.factors.filter(f => f !== factor).map(f => f.label),
    ...model.outcomes.map(o => o.label), ...model.risks.map(r => r.label)];
  // Limit the entity reader to the located sentence, avoiding unrelated long source lines.
  // A count noun identical to the entire factor label names that factor itself (e.g. Engineers).
  // It must have no rival using that noun; this does not relax money or anonymous count binding.
  const unitNamesFactor = labelStandsForCountUnit(factor.unit, factor.label, factor.unit)
    && !others.some(label => words(label).some(w => words(factor.label).some(t => sameName(w, t))));
  const span = figureTheUserWroteForSpan(intervention.value, factor.unit, a.text,
    { target: [factor.label], others, ...(!unitNamesFactor ? { strict: true as const, requireNamed: true as const } : {}) });
  if (span === null) return false;
  const clause = settingClause(a, span.start);
  if (clause === null || !namedOption(model, option, clause.text, intervention.value)) return false;
  const head = labelHead(factor.label);
  const right = words(a.text.slice(span.end)).slice(0, 2);
  const left = words(a.text.slice(clause.start, span.start))
    .filter(w => !['is', 'was', 'were', 'at', 'about', 'roughly', 'would', 'will', 'could', 'a', 'an', 'to', 'of', 'for', 'new'].includes(w));
  if (head === undefined || (!right.some(w => sameName(head, w)) && !sameName(head, left.at(-1) ?? ''))) return false;
  if (model.constraints.some(c => c.value === intervention.value && metricNamesLabel(c.metric, factor.label))) return false;
  if (!sameFrame(a.text, span, factor.unit)) return false;
  return safeNeighbours(brief, a, sentences, a.text.slice(span.start, span.end));
}
