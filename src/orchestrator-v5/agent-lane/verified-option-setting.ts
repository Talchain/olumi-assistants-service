/** A fail-closed construction exception for an option setting in the user's own sentence.
 * Quotes are located by CEE; model offsets and ownership assertions are never authority.
 */
import { metricNamesLabel, type CandidateModel } from './admit-model.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { parseCardinalAmount } from '../../utils/cardinal-words.js';
import { labelHead } from './label-head-unit.js';
import { readUnitParts, statedTailParts, labelStandsForCountUnit, singular } from './same-unit.js';
import { figureTheUserWroteForSpan } from './stated-by-user.js';
import { periodAdverb, periodNoun } from '../../utils/unit-alphabet.js';
import { log } from '../../utils/telemetry.js';

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
const GRAMMAR_WORDS = new Set(['a', 'an', 'the', 'our', 'we', 'to', 'for', 'on', 'at', 'in', 'per', 'each', 'every',
  'of', 'as', 'option', 'options', 'open', 'opening', 'run', 'launch', 'introduce', 'keep', 'extend', 'hire', 'cut', 'set']);
/** Frame grammar. Period words come from the shared unit leaf (`utils/unit-alphabet.ts`), never a local list. */
const grammar = (w: string): boolean => GRAMMAR_WORDS.has(w) || periodNoun(w) !== null || periodAdverb(w) !== null;
const ACTIONS = new Set(['open', 'run', 'staff', 'hire', 'launch', 'introduce', 'set', 'cut', 'keep', 'extend',
  'expand', 'reduce', 'increase', 'switch', 'adopt', 'use', 'operate', 'fund', 'allocate', 'invest', 'retain']);
/** A bound on a figure ("up to", "at most", "under", "nearly", "a ceiling"). Checked on the clause itself, so a bound
 * refuses even when the drafter copied it into the option label; and in the next sentence ("At most.", DL 7 Oct). */
const BOUNDS = new Set(['least', 'most', 'minimum', 'maximum', 'min', 'max', 'fewer', 'more', 'exceeding', 'upwards',
  'up', 'under', 'over', 'below', 'above', 'nearly', 'almost', 'within', 'than', 'ceiling', 'cap', 'floor']);
const NOT_POINT = new Set([...BOUNDS, 'not', 'cannot', 'no', 'many', 'between', 'add', 'additional', 'extra', 'by',
  'ignore', 'another', 'further']);
/** Verbs that open a sibling option arm in the same sentence ("…, or provide remote consultations"). */
const ARMS = new Set([...ACTIONS, 'provide', 'offer', 'raise', 'lower', 'hold', 'stop', 'start', 'continue', 'maintain',
  'close', 'move', 'build', 'buy', 'lease', 'rent', 'delay', 'defer', 'do']);
const MAX_ASSERTION = 1000;
/** Words a credited clause may hold besides the option's, the factor's and its unit's own words. */
const CLAUSE = new Set(['about', 'around', 'roughly', 'approximately', 'exactly', 'with', 'new']);
const figure = (w: string): number | null => /^[0-9]{1,12}$/u.test(w) ? Number(w) : parseCardinalAmount(w);
function namedOption(model: CandidateModel, selected: Option, clause: string, value: number): boolean {
  const said = words(clause);
  const content = (o: Option): string[] => words(o.label).filter(w => !grammar(w)
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
/** Every other clause of the sentence must be a sibling option arm: an arm verb that uniquely names ANOTHER option of
 * the model, with that option's own figure (if any). A qualifier ("at most", "or use that number as a ceiling"), an
 * elliptical or unbound alternative ("or 5", "or open for 5 sessions") or an attribution after the setting refuses.
 * Only a range that brackets the figure ("between 80 and 250") may directly follow it.
 */
function onlySiblingArms(model: CandidateModel, selected: Option, others: readonly { text: string; next: boolean }[], value: number): boolean {
  return others.every(({ text, next }) => {
    const ws = words(text);
    if (next && ws.length === 4 && ws[0] === 'between' && ws[2] === 'and') {
      const low = figure(ws[1]!), high = figure(ws[3]!);
      if (low !== null && high !== null && low < value && value < high) return true;
    }
    const arm = ws[0] === 'or' || ws[0] === 'and' || ws[0] === 'to' ? ws.slice(1) : ws;
    if (!ARMS.has(arm[0] ?? '')) return false;
    const figures = ws.flatMap(w => { const n = figure(w); return n === null ? [] : [n]; });
    // DL 7 Oct (iii): an arm that writes the credited figure ("instead of the 4", "treat 4 as a ceiling") refuses.
    if (figures.includes(value)) return false;
    return figures.length <= 1 && model.options.some(o => o !== selected && namedOption(model, o, text, figures[0] ?? Number.NaN));
  });
}
/** A positive ownership frame. History, current-state reporting, conditions and third-party claims abstain. */
function settingClause(a: Assertion, at: number): { text: string; start: number; frame: string[]; others: { text: string; next: boolean }[] } | null {
  const lead = /^(?:We (?:could|will) |Our options are to |One option is to |Decision: )/iu.exec(a.text);
  // A labelled prospective assertion is also owned, e.g. "The premium plan would attract ...".
  const prospective = /^The (?:[\p{L}]{1,64} ){1,6}would [\p{L}]{1,64} /iu.exec(a.text);
  if (lead === null && prospective === null) return null;
  if (words(a.text).some(w => w === 'last' || w === 'previous')) return null;
  const bodyStart = lead?.[0].length ?? 0;
  const body = a.text.slice(bodyStart);
  let start = bodyStart;
  let found: { text: string; start: number; frame: string[] } | null = null;
  const others: { text: string; next: boolean }[] = [];
  let before = 0;
  // Keep numeric alternatives in the clause so the point gate refuses them, rather than selecting an endpoint.
  for (const part of body.split(/, |; | or (?=[\p{L}])/iu)) {
    const end = start + part.length;
    if (found === null && at >= start && at < end) {
      const ws = words(part);
      const first = ws[0] === 'to' ? ws[1] : ws[0];
      if (!(prospective !== null && start === 0) && !ACTIONS.has(first ?? '')) return null;
      if (findStatedAmounts(part).length > 1) return null;
      if (ws.some(w => NOT_POINT.has(w)) || /[+/()]|[0-9][ \t]{0,4}(?:or|and|-)[ \t]{0,4}[0-9]/iu.test(part)) return null;
      // The complete local clause supplies the setting; a numeric alternative is never a point.
      if (ws.includes('or') || ws.includes('but') || ws.includes('if')) return null;
      found = { text: part, start, frame: prospective !== null && start === 0 ? ['would', ...words(prospective[0]).slice(-1)] : [first ?? ''] };
    } else if (part.trim() !== '') {
      // `next` marks only the clause directly after the setting (the one place a bracketing range may stand).
      others.push({ text: part, next: found !== null && others.length === before });
    }
    if (found === null) before = others.length;
    start = a.text.indexOf(part, start) + part.length;
    const next = a.text.slice(start).match(/^(?:, |; | or )/iu);
    start += next?.[0].length ?? 0;
  }
  return found === null ? null : { ...found, others };
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
/** In the brief the second person can only be Olumi, so any "you"/"your"/"assistant" is an attribution (DL 7 Oct). */
const ATTRIBUTION = /\bOlumi\b|\byou(?:r|rs|rself|rselves)?\b|\bassistant\b/iu;
/** DL 7 Oct, precision over recall. In the credited paragraph: any attribution (the credited sentence included), a
 * repeated figure in any spelling ("the 4" / "four"), or a bound in the very next sentence ("At most.") refuses.
 * Olumi named in either of the two paragraphs above refuses. Third-party attribution without any of these signals
 * is ACCEPTED RESIDUAL (DL 7 Oct).
 */
function safeNeighbours(brief: string, a: Assertion, sentences: Assertion[], literal: string, value: number): boolean {
  const breaks = [...brief.matchAll(/\n[ \t]{0,4}\n/gu)].map(m => m.index!);
  const above = breaks.filter(n => n < a.start);
  const start = above.at(-1) ?? -1;
  const end = breaks.find(n => n >= a.end) ?? brief.length;
  if (above.length > 0 && /\bOlumi\b/iu.test(brief.slice((above.at(-3) ?? -1) + 1, start))) return false;
  const token = canonical(literal).toLowerCase();
  const paragraph = sentences.filter(s => s.start > start && s.start < end);
  const next = paragraph.find(s => s.start >= a.end);
  return paragraph.every(s => {
    if (ATTRIBUTION.test(s.text)) return false;
    if (s === a) return true;
    if (s === next && words(s.text).some(w => BOUNDS.has(w))) return false;
    // The same figure in another spelling ("the 4" beside "four", "four" beside "4") is the same literal.
    if (words(s.text).some(w => figure(w) === value)) return false;
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

/** DL 7 Oct (v): schema-impossible drafter output (a missing array, a null label) refuses and logs; it never throws. */
export function verifiedOptionSetting(model: CandidateModel, option: Option, intervention: Intervention, brief: string | undefined): boolean {
  try {
    return verified(model, option, intervention, brief);
  } catch (err) {
    log.warn({ event: 'agent_lane.stated_setting_unverifiable', err: err instanceof Error ? err.message : String(err) },
      'agent-lane: a stated option setting could not be verified on a malformed draft; it stays Olumi\'s estimate');
    return false;
  }
}
function verified(model: CandidateModel, option: Option, intervention: Intervention, brief: string | undefined): boolean {
  const e = intervention.stated_evidence;
  if (typeof brief !== 'string' || e == null) return false;
  const sentences = assertions(brief);
  // Only the unique normalized quote is model evidence. Every offset, including amount_start, is ignored.
  const a = exactEvidence(brief, e.quote, sentences);
  // A stated option setting is one ordinary sentence. Longer runs are refused before any per-amount reader runs, so
  // the shared binder below never sees an unbounded sentence (r2 buddy P0: 1,112 clauses scaled 10x from 5k to 20k).
  if (a === null || a.text.length > MAX_ASSERTION || !directContext(brief, a)) return false;
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
  if (clause === null || !namedOption(model, option, clause.text, intervention.value)
    || !onlySiblingArms(model, option, clause.others, intervention.value)) return false;
  // Every word of the credited clause names the option, the factor or its unit, or is grammar of the frame: a bound
  // ("up to", "under"), a delta ("another"), a qualifier ("as a ceiling") or an attribution ("according to your
  // estimate") is outside that vocabulary and refuses. An allowlist, never a list of bad words.
  const vocab = [...words(option.label), ...words(factor.label), ...words(typeof factor.unit === 'string' ? factor.unit : ''), ...clause.frame];
  if (!words(clause.text).every(w => figure(w) !== null || grammar(w) || CLAUSE.has(w) || vocab.some(v => sameName(v, w)))) return false;
  const head = labelHead(factor.label);
  const right = words(a.text.slice(span.end)).slice(0, 2);
  const left = words(a.text.slice(clause.start, span.start))
    .filter(w => !['is', 'was', 'were', 'at', 'about', 'roughly', 'would', 'will', 'could', 'a', 'an', 'to', 'of', 'for', 'new'].includes(w));
  if (head === undefined || (!right.some(w => sameName(head, w)) && !sameName(head, left.at(-1) ?? ''))) return false;
  if (model.constraints.some(c => c.value === intervention.value && metricNamesLabel(c.metric, factor.label))) return false;
  if (!sameFrame(a.text, span, factor.unit)) return false;
  return safeNeighbours(brief, a, sentences, a.text.slice(span.start, span.end), intervention.value);
}
