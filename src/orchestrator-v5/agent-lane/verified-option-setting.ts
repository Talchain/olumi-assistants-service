/** A fail-closed construction exception for an option setting in the user's own sentence.
 * Quotes are located by CEE; model offsets and ownership assertions are never authority.
 */
import { metricNamesLabel, type CandidateModel } from './admit-model.js';
import { findStatedAmounts, type StatedAmount } from '../../cee/provenance/stated-amounts.js';
import { parseCardinalAmount } from '../../utils/cardinal-words.js';
import { labelHead } from './label-head-unit.js';
import { readUnitParts, statedTailParts, labelStandsForCountUnit, singular } from './same-unit.js';
import { findLinkEffectAmounts } from './link-effect-figures.js';
import { figureTheUserWroteForSpan, isChangeWord } from './stated-by-user.js';
import { periodAdverb, periodNoun } from '../../utils/unit-alphabet.js';
import { STATE_VERBS as STATE_MARKERS } from '../../cee/signals/brief-signals.js';
import { occurrenceRoleOf } from '../../cee/factor-extraction/goal-label-target.js';
import { log } from '../../utils/telemetry.js';

type Option = CandidateModel['options'][number];
type Intervention = NonNullable<Option['interventions']>[number];
type Factor = CandidateModel['factors'][number];
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
/** Refuse source headings. No document-name exceptions. Quotations are read on the bound figure (`insideQuotation`). */
function directContext(brief: string, a: Assertion): boolean {
  return brief.slice(0, a.end).split('\n').every(line => {
    const s = line.trim();
    return !s.endsWith(':') && !/^\[(?:Page|Paragraph) [0-9]{1,12}\]/u.test(s);
  });
}
/**
 * Recovery Batch B, V1 (DL #94; AIE 6120633627: scope the check to the bound claim, not every earlier quoted label).
 * A quotation refuses credit only when the credited figure itself lies inside it, so a quoted option label earlier in
 * the brief ("labelled exactly "Keep current staffing"") no longer blocks every later figure. Regions are read on the
 * whole normalised brief, so a quotation opened in an earlier sentence still encloses the figure. Fail closed: an
 * unclosed double quote, or an opening single quote never closed, runs to the end of the brief. A lone closing single
 * quote is an apostrophe ("our developers' time") and opens nothing.
 */
function quotedRegions(text: string): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = [];
  let double: number | null = null; let single: number | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!; const before = text[i - 1]; const after = text[i + 1];
    if (/["“”«»]/u.test(c)) {
      if (double === null) double = i; else { regions.push({ start: double, end: i + 1 }); double = null; }
    } else if (c === '\'' || c === '‘' || c === '’') {
      const opens = c !== '’' && (before === undefined || /[\s:(“"«]/u.test(before)) && after !== undefined && !/\s/u.test(after);
      const closes = c !== '‘' && before !== undefined && !/\s/u.test(before) && (after === undefined || /[\s.!?,;:)”"»]/u.test(after));
      if (single === null && opens) single = i;
      else if (single !== null && closes) { regions.push({ start: single, end: i + 1 }); single = null; }
    }
  }
  if (double !== null) regions.push({ start: double, end: text.length });
  if (single !== null) regions.push({ start: single, end: text.length });
  return regions;
}
/** `span` is in the located sentence's own (normalised) text; exactEvidence found that sentence once in the brief. */
function insideQuotation(brief: string, a: Assertion, span: { start: number; end: number }): boolean {
  const whole = canonical(brief);
  const at = whole.indexOf(a.text);
  if (at < 0 || at !== whole.lastIndexOf(a.text)) return true;
  return quotedRegions(whole).some(r => r.start < at + span.end && at + span.start < r.end);
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
/**
 * Recovery Batch C, L1 (PL 6115488243): a count unit that names nothing of its own — "count", or "headcount" (a count of
 * heads) — counts whatever the written noun names. Its noun is then the FACTOR's own, read from the label written beside the
 * figure (the owned quantity anchor), never a synonym list. "FTE", "people" or "teams" name a measure or a thing of their
 * own and must be written as such.
 */
const COUNT_ITSELF = /^(?:head)?count$/u;
function countsItself(unit: unknown): boolean {
  const parts = readUnitParts(unit);
  return parts?.kind === 'count' && parts.noun?.length === 1 && COUNT_ITSELF.test(parts.noun[0]!)
    && parts.period === null && !parts.per?.length && !parts.base?.length && !parts.qualifiers?.length;
}
function sameFrame(text: string, span: { start: number; end: number }, unit: unknown, amount?: StatedAmount, nounFromLabel = false, implicitPer = false): boolean {
  const literal = amount ?? findStatedAmounts(text).find(n => n.index === span.start);
  const written = literal ?? { index: span.start, matchedText: text.slice(span.start, span.end), kind: 'words' };
  const stated = statedTailParts(text, written); const expected = readUnitParts(unit);
  if (stated === null || expected === null || stated.kind !== expected.kind || stated.code !== expected.code
    || stated.scale !== expected.scale || stated.period !== expected.period) return false;
  const same = (x: readonly string[] | null, y: readonly string[] | null): boolean =>
    JSON.stringify(x?.length ? x : null) === JSON.stringify(y?.length ? y : null);
  return (same(stated.per, expected.per) || (implicitPer && !stated.per?.length)) && same(stated.base, expected.base) && same(stated.qualifiers, expected.qualifiers)
    && (expected.noun === null || nounFromLabel || (expected.noun.length > 0
      && expected.noun.every(w => stated.noun?.some(x => sameName(x, w)))));
}
/** In the brief the second person can only be Olumi, so any "you"/"your"/"assistant" is an attribution (DL 7 Oct). */
const ATTRIBUTION = /\bOlumi\b|\byou(?:r|rs|rself|rselves)?\b|\bassistant\b/iu;
/** DL 7 Oct, precision over recall. In the credited paragraph: any attribution (the credited sentence included), a
 * repeated figure in any spelling ("the 4" / "four"), or a bound in the very next sentence ("At most.") refuses.
 * Olumi named in either of the two paragraphs above refuses. Third-party attribution without any of these signals
 * is ACCEPTED RESIDUAL (DL 7 Oct).
 */
function safeNeighbours(brief: string, a: Assertion, sentences: Assertion[], literal: string, value: number, compoundWords = false, distinctClaim?: (text: string) => boolean, distinctBound?: (text: string) => boolean): boolean {
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
    if (s === next && compoundWords && words(s.text).some(w => NOT_POINT.has(w) && !BOUNDS.has(w))
      && distinctBound?.(s.text) !== true) return false;
    if (s === next && (compoundWords ? currentLevelWords(s.text) : words(s.text)).some(w => BOUNDS.has(w))
      && distinctBound?.(s.text) !== true) return false;
    const separate = distinctClaim?.(s.text) === true;
    // The same figure in another spelling ("the 4" beside "four", "four" beside "4") is the same literal.
    if (!separate && words(s.text).some(w => figure(w) === value)) return false;
    if (!separate && compoundWords && findLinkEffectAmounts(s.text).some(n => n.magnitude === Math.abs(value))) return false;
    const text = s.text.toLowerCase();
    let at = text.indexOf(token);
    while (at >= 0) {
      const before = text[at - 1] ?? ''; const after = text[at + token.length] ?? '';
      if (!separate && !/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return false;
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
  if (span === null || insideQuotation(brief, a, span)) return false;
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

/** Remove only a terminal current/date qualifier; the quantity's scope words remain. */
function currentQuantityLabel(label: string): string {
  return label.replace(/\s+(?:today|now|currently)$/iu, '').replace(/\s+at\s+([\p{L}]+)\s+[0-9]+$/iu,
    (all, period: string) => periodNoun(period.toLowerCase()) === null ? all : '');
}
/** Whole quantity-name equality and full unit equality, never a shared token or a shared unit alone. */
function sameCurrentQuantity(model: CandidateModel, factor: Factor): boolean {
  const left = currentQuantityLabel(factor.label); const right = currentQuantityLabel(model.goal.metric);
  const noun = labelHead(left);
  const key = (label: string): string => words(label)
    .filter(w => !['a', 'an', 'the', 'for', 'of', 'in', 'at', 'per'].includes(w))
    .map(singular).sort().join(' ');
  const unit = readUnitParts(factor.unit); const goalUnit = readUnitParts(model.goal.unit);
  return noun !== undefined && sameName(noun, labelHead(right) ?? '') && key(left) === key(right)
    && unit !== null && goalUnit !== null && JSON.stringify(unit) === JSON.stringify(goalUnit);
}
/** A net CHANGE may store a sign not written as a minus. Its local direction must govern this typed amount. */
function signedCurrentFigure(factor: Factor, text: string, amount: StatedAmount): number | null {
  if (!words(factor.label).includes('net') || labelHead(factor.label) !== 'change') return amount.magnitude;
  const direction = /\b(work off|(?:have been )?losing|(?:have been )?gaining) a net $/iu.exec(text.slice(0, amount.index));
  if (direction === null) return null;
  return /gaining/iu.test(direction[1]!) ? amount.magnitude : -amount.magnitude;
}

/** Direct reporting, rather than hearing, guessing or planning somebody else's level. */
const STATE_VERBS = new Set(['have', 'has', 'is', 'are', 'work', 'works', 'complete', 'completes', 'run', 'runs',
  'process', 'processes', 'handle', 'handles', 'employ', 'employs', 'pay', 'pays', 'spend', 'spends', 'earn', 'earns',
  'receive', 'receives', 'charge', 'charges', 'produce', 'produces', 'collect', 'collects', 'see', 'stand', 'stands']);
const OWN_ORGANISATION = new Set(['clinic', 'team', 'company', 'organisation', 'organization', 'business',
  'city', 'scheme', 'library', 'service']);
// Possessive first person does not own a supplier's or rival's figure, or a reported assertion.
const FOREIGN_LEVEL = /\b(?:supplier|competitor|rival|council|they|their|says|claims|reports)\b|\baccording to\b/iu;
function ownsFactorLevel(before: string, factor: Factor): boolean {
  if (FOREIGN_LEVEL.test(before)) return false;
  const own = words(factor.label).concat(words(typeof factor.unit === 'string' ? factor.unit : ''));
  const names = (w: string): boolean => own.some(v => sameName(v, w));
  const body = (text: string): boolean => words(text).every(w => grammar(w) || w === 'off' || names(w));
  // The last explicit subject owns only its own predicate, not a later clause's different subject.
  const we = [...before.matchAll(/\bwe (?:currently |now |today )?(?:(could) )?(have been (?:losing|gaining)|[\p{L}]{1,64})\b/giu)].at(-1);
  if (we !== undefined) {
    const verb = we[2]!.toLowerCase();
    // The count of additional hires is an owned model input even in a prospective staffing sentence.
    const direct = we[1] === undefined ? STATE_VERBS.has(verb) || /^have been (?:losing|gaining)$/u.test(verb)
      : readUnitParts(factor.unit)?.kind === 'count' && own.some(w => w === 'additional' || w === 'extra' || w === 'hires' || w === 'hired')
        && ['bring', 'hire', 'add'].includes(verb);
    const tail = before.slice(we.index! + we[0].length);
    if (direct && body(tail)) return true;
    // An owned current report can coordinate another explicitly named current quantity.
    // A subordinate clause or a newly introduced subject cannot inherit that ownership.
    const coordinated = /, and (?:the )?(.+?) stands at $/iu.exec(tail);
    return direct && we.index === 0 && coordinated !== null && body(coordinated[1]!);
  }
  if (!/^Our /iu.test(before)) return false;
  const said = words(before);
  const quantity = words(currentQuantityLabel(factor.label));
  const namedAt = said.findIndex((_, i) => quantity.length > 0
    && quantity.every((w, j) => sameName(w, said[i + j] ?? '')));
  // A verb-shaped noun inside the independently named quantity is not its predicate.
  const verb = said.findIndex((w, i) => STATE_VERBS.has(w)
    && !(namedAt >= 0 && i >= namedAt && i < namedAt + quantity.length));
  return verb > 1 && said.slice(1, verb).every(w => grammar(w) || OWN_ORGANISATION.has(w) || names(w))
    && said.slice(verb + 1).every(w => grammar(w) || names(w));
}

/** Current roles use lexical tokens, not the parts of a quantity such as "check-up".
 * A historical period before the explicit subject scopes a current net rate, not an upper bound.
 */
function currentLevelWords(text: string): string[] {
  const local = text.replace(/^Over the (?:last|past) ([\p{L}]+) (?=we )/iu,
    (all, period: string) => periodNoun(period.toLowerCase()) === null ? all : '');
  return words(local.replace(/([\p{L}]+)-up\b/giu, '$1'));
}
/** A past anchor dates the claim ("6 months … from last Friday", "two years ago"): it does not attest today's level
 * (AIE 0825 §2, "current versus past"). The figure stays the user's unverified claim. "Over the last year we …" is a
 * historical period scoping a current rate and is stripped first (`currentLevelWords`). */
const PAST_ANCHOR = new Set(['last', 'previous', 'ago', 'yesterday']);
/** V2: the credited figure's own unit, written right after it, is the quantity, not an attribution: "processing 1,400
 * claims per week" reports no claim, while "The insurer claims: …" still does. */
function currentLevelRole(text: string, frame?: { span: { start: number; end: number }; unit: unknown }): boolean {
  let attributed = text;
  if (frame !== undefined) {
    const unitWords = words(typeof frame.unit === 'string' ? frame.unit : '');
    const tail = text.slice(frame.span.end).match(/^(?:[\s/]*[\p{L}]{1,64})*/u)?.[0] ?? '';
    const run = [...tail.matchAll(/[\p{L}]{1,64}/gu)];
    const stop = run.findIndex(m => !unitWords.some(u => sameName(u, m[0].toLowerCase())) && !grammar(m[0].toLowerCase()));
    const end = frame.span.end + (stop < 0 ? tail.length : run[stop]!.index!);
    attributed = text.slice(0, frame.span.start) + text.slice(end);
  }
  return !FOREIGN_LEVEL.test(attributed) && !currentLevelWords(text).some(w => BOUNDS.has(w) || PAST_ANCHOR.has(w)
    || ['goal', 'target', 'limit', 'plan', 'forecast', 'estimate', 'estimated', 'or', 'but', 'if'].includes(w));
}

/**
 * ⭐ Recovery Batch B, S4 V2 (AIE 0825 §2; #94 6122028727): POSITIVE ownership and currentness, with no verb list.
 * "Our existing team resolves 80 tickets per week" names its owner and says the level is current, yet `ownsFactorLevel`
 * reads only its finite STATE_VERBS, so Paul's 80 was withheld on every served capacity draft (9/9, 11–12 Oct). Here:
 *   - WHO: the figure's own clause (after any ':' or ';') opens on the first person ("we", "our");
 *   - between that owner and the figure stand only the factor's own words, frame grammar and the markers below, plus ONE
 *     word in the predicate slot just before the figure ("resolves", "processing"); any other word names another entity
 *     ("Our pub sales share" is not the taproom's) and a fronted frame ("In the imagined setup, our team…") refuses;
 *   - CURRENT, positively: a present-state marker of the shared readers in that clause, `cee/signals/brief-signals.ts`
 *     STATE_VERBS ("currently", "existing", "right now", "we're at" …) or the occurrence reader's present-state governor
 *     (`occurrenceRoleOf`: "is", "running at", "now" …), and that reader finds no aim, past or conditional governing it.
 * Quantity, unit and period stay `factorLevelSpans`'s; role words, quotation and neighbours stay the existing gates.
 */
const STATE_MARK = STATE_MARKERS.map(p => new RegExp(`(?<![\\p{L}\\p{N}'])${p.split(' ').join('\\s+')}(?![\\p{L}\\p{N}])`, 'iu'));
const STATE_WORDS = new Set(STATE_MARKERS.flatMap(p => words(p)));
const COPULA = new Set(['is', 'are', 'am', 're', 's']);
const plainQuotes = (text: string): string => text.replace(/[’‘]/gu, '\'');
function ownCurrentClause(text: string, span: { start: number; end: number }, factor: Factor): boolean {
  const plain = plainQuotes(text);
  const start = Math.max(plain.lastIndexOf(':', span.start), plain.lastIndexOf(';', span.start)) + 1;
  const tail = plain.slice(span.end).search(/[;:]/u);
  const clause = plain.slice(start, tail < 0 ? plain.length : span.end + tail);
  const lead = words(plain.slice(start, span.start));
  if (lead[0] !== 'we' && lead[0] !== 'our') return false;
  const own = [...words(factor.label), ...words(typeof factor.unit === 'string' ? factor.unit : '')];
  const body = lead.slice(1);
  // The predicate slot: the last word before the figure, past any copula, "at" or approximation ("is at about 80").
  let slot = body.length - 1;
  while (slot >= 0 && (CLAUSE.has(body[slot]!) || body[slot] === 'at' || COPULA.has(body[slot]!))) slot -= 1;
  const named = (w: string): boolean => grammar(w) || OWN_ORGANISATION.has(w) || CLAUSE.has(w) || STATE_WORDS.has(w)
    || COPULA.has(w) || own.some(v => sameName(v, w));
  // Every other word names the factor's own subject: "Our pub sales share" is not the taproom's (b5 rival entity).
  if (!body.every((w, i) => i === slot || named(w))) return false;
  // A regular past predicate ("resolved 80") is history, whatever marker the subject carries.
  const predicate = body[slot] ?? '';
  if (/ed$/u.test(predicate) && !STATE_WORDS.has(predicate)) return false;
  const role = occurrenceRoleOf(plain, span.start);
  return role !== 'aim' && role !== 'past' && role !== 'conditional'
    && (role === 'current' || STATE_MARK.some(r => r.test(clause)));
}
/** V2: "… defined as the existing 80 tickets per week …" — the credited figure once, in the factor's own frame and naming
 * nothing but the factor's own words ("1,500 other subscribers" is another quantity: typed-level-span RUN8), with a shared
 * present-state marker right before it and no aim, past or conditional governing it: the same current claim said again,
 * so it neither rivals nor qualifies the owned statement. */
function restatesLevel(text: string, factor: Factor, value: number): boolean {
  const plain = plainQuotes(text);
  const amounts = findLinkEffectAmounts(plain).filter(n => n.magnitude === Math.abs(value));
  if (amounts.length !== 1 || words(plain).filter(w => figure(w) === Math.abs(value)).length > 1) return false;
  const amount = amounts[0]!;
  const own = [...words(factor.label), ...words(typeof factor.unit === 'string' ? factor.unit : '')];
  if (!(statedTailParts(plain, amount)?.noun ?? []).every(w => own.some(v => sameName(v, w)))) return false;
  const role = occurrenceRoleOf(plain, amount.index);
  return role !== 'aim' && role !== 'past' && role !== 'conditional'
    && STATE_MARK.some(r => new RegExp(`${r.source}\\s+$`, 'iu').test(plain.slice(0, amount.index)))
    && sameFrame(plain, { start: amount.index, end: amount.index + amount.matchedText.length }, factor.unit, amount);
}
/** V2: "Keep current staffing adds no specialist." — every qualifier quantifies ANOTHER factor's own noun (the next word
 * names it) and nothing in the sentence names the credited factor: an independent claim, not a bound on this figure. */
function qualifiesOtherQuantity(model: CandidateModel, factor: Factor, text: string): boolean {
  const ws = words(text);
  const mine = [...words(factor.label), ...(readUnitParts(factor.unit)?.noun ?? [])].filter(w => !grammar(w));
  if (ws.some(w => mine.some(m => sameName(m, w)))) return false;
  const nouns = model.factors.filter(f => f !== factor)
    .flatMap(f => [...(readUnitParts(f.unit)?.noun ?? []), labelHead(f.label) ?? '']).filter(n => n !== '');
  const qualifiers = ws.flatMap((w, i) => NOT_POINT.has(w) ? [i] : []);
  return qualifiers.length > 0 && qualifiers.every(i => nouns.some(n => sameName(n, ws[i + 1] ?? '')));
}

/** Set aside a rival only on the located amount's complete typed frame, never on its name alone. */
function incompatibleFactorFrame(rival: { label: string; unit?: string | null; protected?: boolean }, factor: Factor,
  text: string, amount: StatedAmount): boolean {
  if (rival.protected || !currentLevelRole(rival.label)
    || !sameFrame(text, { start: amount.index, end: amount.index + amount.matchedText.length }, factor.unit, amount)) return false;
  const before = text.slice(0, amount.index);
  const horizon = /\s+at\s+([\p{L}]+)\s+([0-9]+)$/iu.exec(rival.label);
  if (horizon !== null && periodNoun(horizon[1]!.toLowerCase()) !== null && Number(horizon[2]) > 0
    && ownsFactorLevel(before, factor) && words(before).some(w => STATE_VERBS.has(w)) && currentLevelRole(text)) return true;
  const claim = statedTailParts(text, amount); const declared = readUnitParts(rival.unit);
  if (claim === null || declared === null) return false;
  if (claim.kind !== declared.kind || claim.code !== declared.code || claim.period !== declared.period) return true;
  if (claim.kind === 'count' && claim.noun?.length && declared.noun?.length
    && !sameName(claim.noun.at(-1)!, declared.noun.at(-1)!)) return true;
  // Scale changes are conversions, not proof of a different quantity. Missing denominators remain unknown.
  return claim.per !== null && declared.per !== null && claim.per.length > 0 && declared.per.length > 0
    && JSON.stringify(claim.per) !== JSON.stringify(declared.per);
}

/** Bind only the figure, quantity and complete frame; ownership and role remain separate gates. */
function factorLevelSpans(model: CandidateModel, factor: Factor, text: string, value = factor.baseline_value): { start: number; end: number }[] {
  const sameQuantity = sameCurrentQuantity(model, factor);
  const rivals = [...(sameQuantity ? [] : [{ label: model.goal.metric, unit: model.goal.unit, protected: true }]),
    ...model.factors.filter(f => f !== factor), ...model.outcomes, ...model.risks];
  const parts = readUnitParts(factor.unit);
  const unitNamesFactor = parts?.kind === 'count'
    && labelStandsForCountUnit(parts.noun?.join(' '), factor.label, factor.unit);
  const target = [sameQuantity ? currentQuantityLabel(factor.label) : factor.label, factor.label.replace(/\badditional\b/giu, 'extra')];
  const amounts = findLinkEffectAmounts(text).filter(n => signedCurrentFigure(factor, text, n) === value);
  // The stored sign stays intact. Only an explicitly directed, located amount supplies its magnitude.
  const matches = amounts.flatMap(amount => {
    // A qualified count in words must write the whole quantity label beside its amount, not just its head.
    const name = words(currentQuantityLabel(factor.label)).map(singular);
    const adjacent = words(text.slice(amount.index + amount.matchedText.length)).slice(0, name.length).map(singular);
    // L1: the whole quantity label written beside the figure IS the anchor; a count-itself unit takes its noun from it.
    const labelled = parts?.kind === 'count' && name.length > 0 && name.join(' ') === adjacent.join(' ') && parts.noun?.length === 1;
    const countNamesFactor = labelled && (sameName(parts!.noun![0]!, labelHead(currentQuantityLabel(factor.label)) ?? '') || countsItself(factor.unit));
    const nounFromLabel = labelled && countsItself(factor.unit);
    const others = rivals.filter(r => !incompatibleFactorFrame(r, factor, text, amount)).map(r => r.label);
    const tail = statedTailParts(text, amount);
    const written = amount.kind === 'plain' && !/[0-9]/u.test(amount.matchedText)
      ? { ...amount, kind: tail?.kind === 'percent' ? 'percent' as const : 'words' as const } : amount;
    const span = figureTheUserWroteForSpan(amount.magnitude, unitNamesFactor || countNamesFactor ? null : factor.unit, text,
      { target, others, strict: true, requireNamed: true, at: amount.index, writtenAmounts: [written] });
    return span === null || !sameFrame(text, span, factor.unit, amount, nounFromLabel) ? [] : [span];
  });
  return matches;
}

/** A change on an independently named flow does not qualify the owned stock's current point. */
function differentCurrentFlow(model: CandidateModel, factor: Factor, text: string): boolean {
  const current = readUnitParts(factor.unit);
  const qualifiers = words(text).filter(w => NOT_POINT.has(w));
  if (text.length > MAX_ASSERTION || !currentLevelRole(text) || current === null
    || current.kind !== 'count' || !current.noun?.length || current.period !== null
    || current.per !== null || qualifiers.length === 0 || !qualifiers.every(isChangeWord)) return false;
  const claims = model.factors.filter(other => {
    const flow = readUnitParts(other.unit);
    if (other === factor || flow === null || flow.period === null
      || JSON.stringify(current) !== JSON.stringify({ ...flow, period: null })
      || model.constraints.some(c => c.value === other.baseline_value && metricNamesLabel(c.metric, other.label))) return false;
    const spans = factorLevelSpans(model, other, text);
    if (spans.length !== 1) return false;
    const amount = findLinkEffectAmounts(text).find(a => a.index === spans[0]!.start);
    if (amount === undefined || !labelStandsForCountUnit(statedTailParts(text, amount)?.noun?.join(' '),
      words(other.label).filter(w => !grammar(w)).join(' '), other.unit)) return false;
    const before = words(text.slice(0, spans[0]!.start));
    const names = words(other.label).concat(words(typeof other.unit === 'string' ? other.unit : ''));
    // Every qualifier belongs before this independently bound amount, under the existing first-person subject.
    // Retractions, later qualifiers, unknown frames and new subjects cannot be detached from the credited stock.
    return before[0] === 'we' && before.filter(w => NOT_POINT.has(w)).length === qualifiers.length
      && before.every(w => grammar(w) || CLAUSE.has(w) || isChangeWord(w) || names.some(n => sameName(n, w)));
  });
  return claims.length === 1;
}

/** Independently typed flow changes and stock-goal bounds retain their own quantity/unit/period. */
function differentGoalBound(model: CandidateModel, factor: Factor, text: string): boolean {
  if (differentCurrentFlow(model, factor, text)) return true;
  const goal = readUnitParts(model.goal.unit); const current = readUnitParts(factor.unit);
  if (goal === null || current === null || (goal.kind !== 'count' && goal.kind !== 'currency')
    || goal.period !== null || current.period === null || goal.per !== null || current.per !== null
    || (goal.kind === 'count' && !goal.noun?.length)
    || JSON.stringify(goal) !== JSON.stringify({ ...current, period: null })) return false;
  const amounts = findLinkEffectAmounts(text);
  const targets = amounts.filter(a => a.magnitude === model.goal.value);
  if (targets.length !== 1) return false;
  const others = [...model.factors.filter(other => {
    if (sameCurrentQuantity(model, other)) return false;
    const unit = readUnitParts(other.unit);
    // Unknown or compatible frames stay rivals; an explicit period is not this stock's frame.
    return unit === null || (unit.kind === goal.kind && unit.period === goal.period);
  }).map(other => other.label), ...model.outcomes.map(o => o.label), ...model.risks.map(r => r.label)];
  const amount = targets[0]!;
  const span = { start: amount.index, end: amount.index + amount.matchedText.length };
  const written = statedTailParts(text, amount);
  if (written?.kind !== goal.kind || written.period !== goal.period) return false;
  const framed = sameFrame(text, span, model.goal.unit, amount);
  // Only already-read bound/cardinal/period grammar can replace an unwritten count unit ("within nine months").
  if (!framed && !written.noun?.every(w => grammar(w) || BOUNDS.has(w) || figure(w) !== null)) return false;
  // A written count noun is independently typed here; keep it available to the quantity-name reader.
  const unit = framed ? null : model.goal.unit;
  return figureTheUserWroteForSpan(amount.magnitude, unit, text,
    { target: [model.goal.metric], others, strict: true, requireNamed: true, at: amount.index,
      writtenAmounts: amounts }) !== null;
}

/**
 * ⭐ Recovery Batch C, L3 (SYS3 #94 6115410093; PL 6115488243): a drafter's quote is the user's (unverified) CLAIM about
 * this factor only when it writes THIS factor's figure in its quantity and complete typed frame — the same binding the
 * verifier starts from (`factorLevelSpans`: the figure, the factor's own quantity named beside it, unit/period/role), minus
 * ownership. A quote that merely contains the number ("more than 25% of my time" cited for an experience score of 25)
 * claims nothing about it. No new reader: the spans are the verifier's own.
 *
 * ⭐ Recovery Batch B, W (DL GO 12 Oct; AIE 0825 §2–§3): a literal human figure keeps its HUMAN ORIGIN where that binding
 * cannot attest its role. Given the brief, the drafter's quote must be one located sentence of it (`exactEvidence`) and
 * write THIS factor's figure in the factor's own typed frame (`sameFrame`: kind, noun, period, base), with the
 * denominator allowed implicit ("each additional specialist resolves about 20 tickets per week" for tickets per week per
 * specialist); a different written denominator still refuses. Origin only: a current level is `verifiedFactorLevel`'s.
 */
export function quoteBindsFactorFigure(model: CandidateModel, factor: Factor, brief?: string): boolean {
  try {
    const quote = factor.baseline_evidence?.quote;
    const value = factor.baseline_value;
    if (typeof quote !== 'string' || quote.length > MAX_ASSERTION || typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (factorLevelSpans(model, factor, quote, value).length > 0) return true;
    if (typeof brief !== 'string') return false;
    const a = exactEvidence(brief, quote, assertions(brief));
    return a !== null && a.text.length <= MAX_ASSERTION && findLinkEffectAmounts(a.text).some(amount => amount.magnitude === Math.abs(value)
      && sameFrame(a.text, { start: amount.index, end: amount.index + amount.matchedText.length }, factor.unit, amount, false, true));
  } catch {
    return false;
  }
}

/**
 * ⭐ Recovery Batch B, S4 V2 origin (DL ruling (b), 12 Oct; AIE 0825 §2: "do not reattribute a literal human number to an AI
 * estimate simply because role verification failed"): a literal human figure keeps its HUMAN ORIGIN when the drafter cites
 * nothing. Served capacity draft b33bf531 (11 Oct) drafted "Each additional specialist resolves about 20 tickets per week,
 * between 10 and 30" as `Specialist capacity` = 20, `ai_proposed`, no quote, so Paul's 20 was stored as Olumi's estimate.
 * CEE locates the receipt itself: a direct sentence of the brief names the factor (a word of its label) and writes THIS
 * figure in the factor's own typed frame (`sameFrame`, the denominator allowed implicit, as W), and the occurrence reader
 * does not read it as an aim or bound ("at least 100" is the target, never a supplied level). Quotation marks do not
 * disown a supplied figure (AIE 0825 §1). ORIGIN ONLY: the role stays unverified; a current level is `verifiedFactorLevel`'s.
 * #2942's receipt gate still holds wherever the brief writes no such figure: a drafter's claim alone never upgrades anything.
 */
export function briefWritesFactorFigure(factor: Factor, brief: string | undefined): boolean {
  try {
    return sentencesWritingFigure(factor, brief).length > 0;
  } catch {
    return false;
  }
}
/** The brief's direct sentences that write THIS factor's figure in its typed frame, naming it, not as an aim or bound. */
function sentencesWritingFigure(factor: Factor, brief: string | undefined): { text: string; amount: StatedAmount }[] {
  const value = factor.baseline_value;
  if (typeof brief !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) return [];
  const named = words(factor.label).filter(w => !grammar(w));
  return assertions(brief).filter(a => a.text.length <= MAX_ASSERTION && directContext(brief, a)
    && words(a.text).some(w => named.some(n => sameName(n, w)))).flatMap(a => findLinkEffectAmounts(a.text)
    .filter(amount => amount.magnitude === Math.abs(value)
      && occurrenceRoleOf(plainQuotes(a.text), amount.index) !== 'aim'
      && sameFrame(a.text, { start: amount.index, end: amount.index + amount.matchedText.length }, factor.unit, amount, false, true))
    .map(amount => ({ text: a.text, amount })));
}

/**
 * ⭐ Recovery Batch B, Row5 (DL 12 Oct): a RANGE the brief states for a factor, read at construction for L6's carrier
 * (`observed_state.range`). Paul's "Each additional specialist resolves about 20 tickets per week, between 10 and 30." was
 * admitted on 9 of 9 served drafts with the 20 and without the 10–30. A pair is "between X and Y", "X–Y" or "X to Y"; ends
 * written with their own unit must be in the factor's frame (bare ends take the figure's, so a range with no figure beside
 * it must write its unit).
 */
function statedRangePair(text: string, unit: unknown, figure?: StatedAmount): { low: number; high: number } | undefined {
  const ends = findLinkEffectAmounts(text).filter(a => a.index !== figure?.index);
  for (let i = 0; i + 1 < ends.length; i++) {
    const lo = ends[i]!, hi = ends[i + 1]!;
    const gap = text.slice(lo.index + lo.matchedText.length, hi.index);
    const paired = (/\bbetween\s+$/iu.test(text.slice(0, lo.index)) && /^\s+and\s+$/iu.test(gap)) || /^\s*(?:[-–—]|to)\s*$/iu.test(gap);
    if (!paired || !(lo.magnitude < hi.magnitude)) continue;
    const after = text.slice(hi.index + hi.matchedText.length).match(/^[^,;.!?)]*/u)?.[0] ?? '';
    const bare = !/[\p{L}%£$€]/u.test(after) && !/[%£$€]/u.test(hi.matchedText);
    if (bare ? figure === undefined : !sameFrame(text, { start: hi.index, end: hi.index + hi.matchedText.length }, unit, hi, false, true)) continue;
    return { low: lo.magnitude, high: hi.magnitude };
  }
  return undefined;
}
/**
 * The USER's own range for a figure they wrote: both ends in the ONE sentence that writes it (`sentencesWritingFigure`),
 * never a third party's sentence (`FOREIGN_LEVEL`). Stored only as L6's validator admits it (`isStatedLevelRange`: the
 * figure inside, the user's own sentence).
 */
export function briefStatedLevelRange(factor: Factor, brief: string | undefined): { low: number; high: number; quote: string } | undefined {
  try {
    for (const { text, amount } of sentencesWritingFigure(factor, brief)) {
      if (FOREIGN_LEVEL.test(text) || ATTRIBUTED_EVIDENCE.test(text)) continue;
      const pair = statedRangePair(text, factor.unit, amount);
      if (pair !== undefined) return { ...pair, quote: text };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
/** "Customer interviews suggest …": evidence the user reports from a source, not a figure of their own. */
const ATTRIBUTED_EVIDENCE = /\b(?:suggests?|interviews?|survey|surveys)\b/iu;
/**
 * Row5 RULING (DL 12 Oct 13:1xZ; AIE 0825 "retain the supplied claim and its uncertainty/source", 0418): a range a THIRD
 * PARTY states in the brief ("A supplier says a specialist can contribute 10–30 features per week; I have not verified
 * that claim.") is carried with its attribution — the sentence that names that party — role unverified: a label, never
 * withheld, never the user's range. The sentence must name the factor and write both ends with the factor's frame.
 */
export function briefAttributedLevelRange(factor: Factor, brief: string | undefined): { low: number; high: number; quote: string } | undefined {
  try {
    if (typeof brief !== 'string') return undefined;
    const attributed = (text: string): boolean => FOREIGN_LEVEL.test(text) || ATTRIBUTED_EVIDENCE.test(text);
    // A sentence that also writes the figure anchors bare ends ("… about 20 tickets per week, between 10 and 30").
    for (const { text, amount } of sentencesWritingFigure(factor, brief)) {
      const pair = attributed(text) ? statedRangePair(text, factor.unit, amount) : undefined;
      if (pair !== undefined) return { ...pair, quote: text };
    }
    const named = words(factor.label).filter(w => !grammar(w));
    for (const a of assertions(brief)) {
      if (a.text.length > MAX_ASSERTION || !directContext(brief, a) || !attributed(a.text)) continue;
      if (!words(a.text).some(w => named.some(n => sameName(n, w)))) continue;
      const pair = statedRangePair(a.text, factor.unit);
      if (pair !== undefined) return { ...pair, quote: a.text };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * ⭐ Recovery Batch B (DL 12 Oct 13:3xZ): the GOAL's stated current level, through V2's verification, positive
 * attestation only and no new parser. Admission wrote it as `brief_extraction` with no extractionType and no user-text
 * check, so C reads Paul's typed figure as unverified. Verified when BOTH hold:
 *   - ORIGIN: a direct sentence of the brief names the goal and writes this figure in the goal's typed frame, not as an
 *     aim or bound (`sentencesWritingFigure`, the origin rule's reader): "Total weekly support capacity is defined as the
 *     existing 80 tickets per week …";
 *   - ROLE: the same figure, in the goal's typed unit, is V2's VERIFIED current level of a factor of this model
 *     (`verifiedFactorLevel`): "Our existing team resolves 80 tickets per week."
 * Anything else stays exactly as written before. The typed-unit equality is defence in depth: V2's neighbour rule
 * already withholds a factor whose figure the goal's sentence writes as another quantity.
 */
export function verifiedGoalLevel(model: CandidateModel, brief: string | undefined): boolean {
  try {
    const goal = model.goal; const value = goal.baseline_value;
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const unit = readUnitParts(goal.unit);
    if (unit === null) return false;
    if (sentencesWritingFigure({ label: goal.metric, baseline_value: value, unit: goal.unit } as Factor, brief).length === 0) return false;
    return model.factors.some(f => f.baseline_value === value && JSON.stringify(readUnitParts(f.unit)) === JSON.stringify(unit)
      && verifiedFactorLevel(model, f, brief));
  } catch {
    return false;
  }
}

/** Read the authenticated current figure independently of the draft's proposed value.
 * Uses the existing amount, quantity, unit, role and neighbour readers; never chip/history text.
 * More than one authenticated value is unresolved, not permission to choose one.
 */
export function verifiedGoalLevelValue(model: CandidateModel, brief: string | undefined): number | null {
  if (typeof brief !== 'string' || readUnitParts(model.goal.unit) === null) return null;
  const sentences = assertions(brief);
  const values = new Set<number>();
  const others = [...model.factors, ...model.outcomes, ...model.risks].map(f => f.label)
    .filter(label => label !== model.goal.metric);
  for (const a of sentences) {
    if (a.text.length > MAX_ASSERTION || !directContext(brief, a)) continue;
    for (const amount of findLinkEffectAmounts(a.text)) {
      const span = figureTheUserWroteForSpan(amount.magnitude, model.goal.unit, a.text,
        { target: [model.goal.metric], others, strict: true, requireNamed: true, at: amount.index, writtenAmounts: [amount] });
      if (span === null || !sameFrame(a.text, span, model.goal.unit, amount)
        || insideQuotation(brief, a, span) || occurrenceRoleOf(a.text, span.start) !== 'current'
        || !currentLevelRole(a.text, { span, unit: model.goal.unit })
        || !safeNeighbours(brief, a, sentences, amount.matchedText, amount.magnitude, true, undefined, text => {
          const target = model.goal.value;
          if (typeof target !== 'number' || target === amount.magnitude) return false;
          const bound = figureTheUserWroteForSpan(target, model.goal.unit, text,
            { target: [model.goal.metric], others, strict: true, requireNamed: true });
          return bound !== null && occurrenceRoleOf(text, bound.start) === 'aim'
            && sameFrame(text, bound, model.goal.unit);
        })) continue;
      values.add(amount.magnitude);
    }
  }
  if (values.size === 1) return [...values][0]!;
  return null;
}

/** Same V2 factor attestation, with its located value exposed before admission chooses a baseline. */
export function verifiedFactorLevelValue(model: CandidateModel, factor: Factor, brief: string | undefined): Factor | null {
  if (typeof brief !== 'string') return null;
  const verified = new Map<number, Factor>();
  for (const a of assertions(brief)) {
    for (const amount of findLinkEffectAmounts(a.text)) {
      const value = signedCurrentFigure(factor, a.text, amount);
      if (value === null) continue;
      const candidate = { ...factor, baseline_value: value, baseline_evidence: { ...factor.baseline_evidence, quote: a.text } };
      const context = { ...model, factors: model.factors.map(f => f === factor ? candidate : f) };
      if (verifiedFactorLevel(context, candidate, brief)) verified.set(value, candidate);
    }
  }
  return verified.size === 1 ? [...verified.values()][0]! : null;
}

/** Construction-only current-level authority; a drafter's provenance and offsets never establish ownership. */
export function verifiedFactorLevel(model: CandidateModel, factor: Factor, brief: string | undefined): boolean {
  try {
    const value = factor.baseline_value;
    if (typeof brief !== 'string' || factor.baseline_evidence == null
      || typeof value !== 'number' || !Number.isFinite(value)) return false;
    const sentences = assertions(brief);
    const a = exactEvidence(brief, factor.baseline_evidence.quote, sentences);
    if (a === null || a.text.length > MAX_ASSERTION || !directContext(brief, a)) return false;
    if (model.factors.filter(f => f.label === factor.label).length !== 1) return false;
    // The sentence holding the goal target cannot also attest a current level, even for a differently named factor
    // (typed-level-span "refuses the sentence holding goal.value even without goal vocabulary" / B2 pin this: kept).
    if (typeof model.goal.value === 'number' && [...findLinkEffectAmounts(a.text).map(n => n.magnitude),
      ...words(a.text).flatMap(w => { const n = figure(w); return n === null ? [] : [n]; })].includes(model.goal.value)) return false;
    if (model.constraints.some(c => c.value === value && metricNamesLabel(c.metric, factor.label))) return false;
    const matches = factorLevelSpans(model, factor, a.text);
    if (matches.length !== 1) return false;
    const span = matches[0]!;
    if (insideQuotation(brief, a, span)) return false;
    if (!(ownsFactorLevel(a.text.slice(0, span.start), factor) || ownCurrentClause(a.text, span, factor))
      || !currentLevelRole(a.text, { span, unit: factor.unit })) return false;
    return safeNeighbours(brief, a, sentences, a.text.slice(span.start, span.end), value, true, text => {
      if (text.length <= MAX_ASSERTION && restatesLevel(text, factor, value)) return true;
      // An elliptical bound, correction, retraction or attributed sentence remains ambiguous.
      if (text.length > MAX_ASSERTION || !currentLevelRole(text) || words(text).some(w => NOT_POINT.has(w))) return false;
      const amounts = findLinkEffectAmounts(text);
      if (amounts.length !== 1 || amounts[0]!.magnitude !== Math.abs(value)) return false;
      const claims = model.factors.filter(other => {
        if (model.constraints.some(c => c.value === value && metricNamesLabel(c.metric, other.label))) return false;
        const spans = factorLevelSpans(model, other, text, value);
        return spans.length === 1 && ownsFactorLevel(text.slice(0, spans[0]!.start), other);
      });
      return claims.length === 1 && claims[0] !== factor
        && currentQuantityLabel(claims[0]!.label) !== currentQuantityLabel(factor.label)
        && readUnitParts(claims[0]!.unit) !== null
        && JSON.stringify(readUnitParts(claims[0]!.unit)) !== JSON.stringify(readUnitParts(factor.unit));
    }, text => differentGoalBound(model, factor, text) || qualifiesOtherQuantity(model, factor, text));
  } catch (err) {
    log.warn({ event: 'agent_lane.stated_level_unverifiable', err: err instanceof Error ? err.message : String(err) },
      'agent-lane: a stated factor level could not be verified on a malformed draft; credit is withheld');
    return false;
  }
}
