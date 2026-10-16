import type { GoalPathFactor, GoalPathLink } from './turn-context/guidance-signals.js';

/** An identified figure; the signal labels do not carry a displayable numeric amount. */
export interface Item {
  readonly kind: 'value' | 'link';
  readonly id: string;
  readonly label: string;
  readonly goal_distance: number;
}

export interface OlumiEstimates {
  readonly count: number;
  readonly values: Item[];
  readonly links: Item[];
  readonly accepted: number;
  readonly placeholderLinks: number;
  /** The caller supplies only this Run's licensed, measured driver/sensitivity order. */
  readonly ordered: boolean;
  readonly top: Item[];
}

/** RC4's one census: the inputs are already restricted to this result's goal paths. */
export function olumiEstimatesFeedingResult(input: {
  goalPathFactors: readonly GoalPathFactor[];
  goalPathLinks: readonly GoalPathLink[];
  /** Graph-bound reader of the real validatedDefinition predicate; keeps this census pure. */
  validatedDefinitionForLink?: (linkId: string) => string | undefined;
  /** Distinct, on-goal-path option settings; observed-state authorship cannot stand in for these. */
  optionSettings?: readonly {
    id: string;
    label: string;
    authorship: 'olumi_estimate' | 'olumi_accepted' | 'user' | 'placeholder' | string;
    goal_distance?: number;
  }[];
  /** This bound Run's global significance order across all supplied figure kinds. */
  driverIds?: readonly string[];
}): OlumiEstimates {
  const values: Item[] = [];
  const links: Item[] = [];
  let accepted = 0;
  let placeholderLinks = 0;
  const factorIds = new Set<string>();
  const settingIds = new Set<string>();
  const linkIds = new Set<string>();
  for (const f of input.goalPathFactors) {
    if (factorIds.has(f.factor_id)) continue;
    factorIds.add(f.factor_id);
    if (f.value_authorship === 'olumi_accepted') accepted += 1;
    if (f.value_authorship === 'olumi_estimate') {
      values.push({ kind: 'value', id: f.factor_id, label: f.label, goal_distance: f.goal_distance });
    }
  }
  for (const setting of input.optionSettings ?? []) {
    if (settingIds.has(setting.id)) continue;
    settingIds.add(setting.id);
    if (setting.authorship === 'olumi_accepted') accepted += 1;
    if (setting.authorship === 'olumi_estimate') {
      values.push({ kind: 'value', id: setting.id, label: setting.label, goal_distance: setting.goal_distance ?? 99 });
    }
  }
  for (const l of input.goalPathLinks) {
    if (linkIds.has(l.link_id)) continue;
    linkIds.add(l.link_id);
    // This is the existing signal producer's linkSizing(edge) result, never a second sizing rule.
    if (l.link_sizing === 'olumi_accepted') accepted += 1;
    if (l.link_sizing === 'placeholder') placeholderLinks += 1;
    if (l.link_sizing === 'olumi_estimate' && input.validatedDefinitionForLink?.(l.link_id) === undefined) {
      links.push({ kind: 'link', id: l.link_id, label: `${l.from_label} → ${l.to_label}`, goal_distance: l.goal_distance });
    }
  }
  const driverRank = new Map<string, number>();
  for (const id of input.driverIds ?? []) if (!driverRank.has(id)) driverRank.set(id, driverRank.size);
  // The existing nearest-to-goal rule: ascending distance, then stable ID order.
  const top = [...values, ...links].sort((a, b) =>
    (driverRank.get(a.id) ?? Infinity) - (driverRank.get(b.id) ?? Infinity)
    || a.goal_distance - b.goal_distance
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  ).slice(0, 3);
  return {
    count: values.length + links.length, values, links, accepted, placeholderLinks,
    ordered: top.length > 0 && top.every(item => driverRank.has(item.id)), top,
  };
}

/** RC4's shared words. UNVERIFIED for AIQ: the zero-count sentence and item-list presentation. */
export function sayOlumiEstimates(e: OlumiEstimates): string[] {
  const kinds: string[] = [];
  if (e.values.length > 0) kinds.push(`${e.values.length} ${e.values.length === 1 ? 'value' : 'values'}`);
  if (e.links.length > 0) kinds.push(`${e.links.length} ${e.links.length === 1 ? 'link size' : 'link sizes'}`);
  const lines = [e.count === 0
    ? "None of the figures behind this result are Olumi's estimates."
    : `Olumi supplied ${e.count} of the figures behind this result: ${kinds.join(' and ')}.`];
  if (e.count > 3) lines.push(`${e.count} in total; here are 3.`);
  if (e.top.length > 0) {
    lines.push(e.ordered ? (e.top.length === 1 ? 'The one that matters most:' : `The ${e.top.length} that matter most:`) : 'For example:');
    lines.push(...e.top.map(item => `${item.label} (${item.kind === 'value' ? 'value' : 'link size'})`));
  }
  if (e.accepted > 0) lines.push(`${e.accepted} you accepted from Olumi's suggestions.`);
  if (e.placeholderLinks > 0) lines.push(`${e.placeholderLinks} links have no size yet.`);
  return lines;
}

const NUMBER_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'hundred', 'hundreds', 'dozen', 'dozens',
]);
const TENS = new Set(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']);
const UNITS = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']);
const COUNT_KINDS = new Set([
  'value', 'values', 'figure', 'figures', 'input', 'inputs', 'assumption', 'assumptions',
  'estimate', 'estimates', 'number', 'numbers', 'link', 'links', 'relationship', 'relationships',
  'size', 'sizes', 'strength', 'strengths',
]);
const FILLERS = new Set(['of', 'the', 'olumi', 's', 'its', 'their', 'own', 'underlying', 'estimated', 'starting', 'these', 'those']);
// TL 20:48: this closed definition belongs only to the one post-reply check.
const COUNT_CLAIM_PREDICATES = new Set(['supplied', 'estimated', 'provided', 'gave', 'fed']);
const CONJUNCTIONS = new Set(['and', 'but', 'while', 'whereas']);
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isWord = (code: number): boolean => isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
const isSpace = (code: number): boolean => (code >= 9 && code <= 13) || code === 32 || code === 160 || code === 0x2028 || code === 0x2029;

export interface EstimateCountRecord {
  readonly count?: number;
  readonly values?: number;
  readonly links?: number;
}
type CountKind = keyof EstimateCountRecord;
interface Token { readonly word: string; readonly start: number; readonly end: number; readonly clause: number }
interface CountClaim { readonly count: number; readonly kind: CountKind }

function countNumber(word: string): number | undefined {
  const small = [...NUMBER_WORDS].indexOf(word);
  if (small >= 0 && small < 19) return small + 1;
  const tens = [...TENS].indexOf(word);
  if (tens >= 0) return (tens + 2) * 10;
  const [ten, unit] = word.split('-');
  if (ten !== undefined && unit !== undefined && TENS.has(ten) && UNITS.has(unit)) {
    return ([...TENS].indexOf(ten) + 2) * 10 + [...UNITS].indexOf(unit) + 1;
  }
  if (!/^\d+(?:,\d{3})*(?:\.\d+)?$/.test(word)) return undefined;
  const n = Number(word.replaceAll(',', ''));
  return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? n : undefined;
}

/** Reuse the bounded count grammar, retaining the quantity instead of turning a pronoun into a deletion. */
function attributedCount(sentence: string, speakerIsOlumi = false): CountClaim[] {
  if (sentence.trimEnd().endsWith('?')) return [];
  const tokens: Token[] = [];
  let clause = 0;
  for (let i = 0; i < sentence.length;) {
    if (!isWord(sentence.charCodeAt(i))) {
      if ([',', ';', ':', '—'].includes(sentence[i]!)) clause += 1;
      i += 1;
      continue;
    }
    const start = i;
    while (i < sentence.length && (isWord(sentence.charCodeAt(i))
      || ((sentence[i] === ',' || sentence[i] === '.') && isDigit(sentence.charCodeAt(i - 1)) && isDigit(sentence.charCodeAt(i + 1))))) i += 1;
    if (TENS.has(sentence.slice(start, i).toLowerCase()) && sentence[i] === '-') {
      i += 1;
      while (i < sentence.length && isWord(sentence.charCodeAt(i))) i += 1;
    }
    tokens.push({ word: sentence.slice(start, i).toLowerCase(), start, end: i, clause });
  }
  const joined = (a: Token, b: Token): boolean => a.clause === b.clause && a.end !== b.start
    && [...sentence.slice(a.end, b.start)].every(char => isSpace(char.charCodeAt(0)) || char === "'" || char === '’');
  const kindOf = (word: string): CountKind => ['link', 'links', 'relationship', 'relationships', 'size', 'sizes', 'strength', 'strengths'].includes(word)
    ? 'links' : ['value', 'values', 'assumption', 'assumptions'].includes(word) ? 'values' : 'count';
  const objectAt = (i: number): { claim: CountClaim; end: number } | undefined => {
    const number = tokens[i];
    if (number === undefined) return undefined;
    let before = number.start - 1;
    while (before >= 0 && isSpace(sentence.charCodeAt(before))) before -= 1;
    if (before >= 0 && /\p{Sc}/u.test(sentence[before]!)) return undefined;
    const count = countNumber(number.word);
    if (count === undefined) return undefined;
    let previous = number;
    for (let j = i + 1, skipped = 0; j < tokens.length; j += 1) {
      const next = tokens[j]!;
      if (!joined(previous, next)) break;
      if (COUNT_KINDS.has(next.word)) return { claim: { count, kind: kindOf(next.word) },
        end: j + (['link', 'links'].includes(next.word) && ['size', 'sizes'].includes(tokens[j + 1]?.word ?? '') ? 2 : 1) };
      if (skipped === 3 || !FILLERS.has(next.word)) break;
      previous = next;
      skipped += 1;
    }
    return undefined;
  };
  const sourceIsOlumi = (word: string | undefined): boolean => word === 'olumi' || (speakerIsOlumi && word === 'i');
  const claims: CountClaim[] = [];
  // Unknown, quoted, reported, negated and requesting constructions establish no contradiction.
  if (tokens[0] === undefined || sentence.slice(0, tokens[0].start).trim() !== '') return claims;
  let at = 0;
  while (at < tokens.length) {
    const actor = tokens[at]!;
    let next = at + 1;
    let ours = sourceIsOlumi(actor.word);
    if (actor.word === 'olumi' && tokens[next]?.word === 's' && joined(actor, tokens[next]!)) {
      const noun = tokens[next + 1], number = tokens[next + 2];
      if (noun !== undefined && number !== undefined && COUNT_KINDS.has(noun.word)
        && sentence.slice(noun.end, number.start).trim() === ':') {
        const count = countNumber(number.word);
        if (count !== undefined) claims.push({ count, kind: kindOf(noun.word) });
        next += 3;
      } else break;
    } else if (ours || actor.word === 'you') {
      if (['have', 'has', 'had'].includes(tokens[next]?.word ?? '')) next += 1;
      const predicate = tokens[next];
      if (predicate === undefined || !COUNT_CLAIM_PREDICATES.has(predicate.word)
        || tokens.slice(at + 1, next + 1).some((token, i) => !joined(tokens[at + i]!, token))) break;
      const object = objectAt(next + 1);
      if (object === undefined) break;
      if (ours) claims.push(object.claim);
      next = object.end;
      while (tokens[next]?.word === 'and') {
        const extra = objectAt(next + 1);
        if (extra === undefined) break;
        if (ours) claims.push(extra.claim);
        next = extra.end;
      }
    } else {
      const object = objectAt(at);
      if (object === undefined) break;
      next = object.end;
      if (['is', 'are', 'was', 'were'].includes(tokens[next]?.word ?? '')) next += 1;
      if (!COUNT_CLAIM_PREDICATES.has(tokens[next]?.word ?? '') || tokens[next + 1]?.word !== 'by') break;
      ours = sourceIsOlumi(tokens[next + 2]?.word);
      if (!ours && tokens[next + 2]?.word !== 'you') break;
      if (ours) claims.push(object.claim);
      next += 3;
    }
    // Only another direct clause may follow; its unrecognised contents cannot become a claim by scanning ahead.
    const coordinated = CONJUNCTIONS.has(tokens[next]?.word ?? '');
    while (tokens[next] !== undefined && CONJUNCTIONS.has(tokens[next]!.word)) next += 1;
    if (tokens[next] === undefined || (!coordinated && tokens[next]!.clause === tokens[next - 1]!.clause)) break;
    at = next;
  }
  return claims;
}

/** The one post-reply count check: only a proved contradiction of the selected Run removes a sentence. */
export function narratorCountGuard(text: string, e: OlumiEstimates | EstimateCountRecord | null, speaker?: 'olumi'): { text: string; removed: string[] } {
  const removed: string[] = [];
  if (e === null) return { text, removed };
  const record: EstimateCountRecord = { count: e.count,
    values: typeof e.values === 'number' ? e.values : e.values?.length,
    links: typeof e.links === 'number' ? e.links : e.links?.length };
  // Also preserves all whitespace and bytes of the common no-count case.
  if (speaker !== 'olumi' && !text.toLowerCase().includes('olumi')) return { text, removed };
  const kept: string[] = [];
  const append = (end: number): void => {
    const sentence = text.slice(start, end);
    // Presentation cannot hide a claim; grouping and decimals retain their numeric value in the count lexer.
    // The kept text is always the original bytes.
    const plain = sentence.replace(/[*_`~]/g, '');
    if (attributedCount(plain, speaker === 'olumi').some(claim =>
      typeof record[claim.kind] === 'number' && claim.count !== record[claim.kind])) removed.push(sentence.trim());
    else kept.push(sentence);
    start = end;
  };
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== '.' && char !== '!' && char !== '?') continue;
    // A decimal point in a figure is not the end of its sentence.
    if (char === '.' && isDigit(text.charCodeAt(i - 1)) && isDigit(text.charCodeAt(i + 1))) continue;
    let end = i + 1;
    while (end < text.length && ['"', "'", '”', '’', ')', ']'].includes(text[end]!)) end += 1;
    append(end);
    i = end - 1;
  }
  if (start < text.length) append(text.length);
  return { text: removed.length === 0 ? text : kept.join('').trim(), removed };
}
