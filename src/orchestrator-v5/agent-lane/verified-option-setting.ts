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
function sameFrame(text: string, span: { start: number; end: number }, unit: unknown, amount?: StatedAmount): boolean {
  const literal = amount ?? findStatedAmounts(text).find(n => n.index === span.start);
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
function currentLevelRole(text: string): boolean {
  return !FOREIGN_LEVEL.test(text) && !currentLevelWords(text).some(w => BOUNDS.has(w)
    || ['goal', 'target', 'limit', 'plan', 'forecast', 'estimate', 'estimated', 'or', 'but', 'if'].includes(w));
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
    const countNamesFactor = parts?.kind === 'count' && name.length > 0
      && name.join(' ') === adjacent.join(' ') && parts.noun?.length === 1
      && sameName(parts.noun[0]!, labelHead(currentQuantityLabel(factor.label)) ?? '');
    const others = rivals.filter(r => !incompatibleFactorFrame(r, factor, text, amount)).map(r => r.label);
    const tail = statedTailParts(text, amount);
    const written = amount.kind === 'plain' && !/[0-9]/u.test(amount.matchedText)
      ? { ...amount, kind: tail?.kind === 'percent' ? 'percent' as const : 'words' as const } : amount;
    const span = figureTheUserWroteForSpan(amount.magnitude, unitNamesFactor || countNamesFactor ? null : factor.unit, text,
      { target, others, strict: true, requireNamed: true, at: amount.index, writtenAmounts: [written] });
    return span === null || !sameFrame(text, span, factor.unit, amount) ? [] : [span];
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
    if (!ownsFactorLevel(a.text.slice(0, span.start), factor)
      || !currentLevelRole(a.text)) return false;
    return safeNeighbours(brief, a, sentences, a.text.slice(span.start, span.end), value, true, text => {
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
    }, text => differentGoalBound(model, factor, text));
  } catch (err) {
    log.warn({ event: 'agent_lane.stated_level_unverifiable', err: err instanceof Error ? err.message : String(err) },
      'agent-lane: a stated factor level could not be verified on a malformed draft; credit is withheld');
    return false;
  }
}
