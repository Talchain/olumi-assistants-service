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
    if (l.link_sizing === 'olumi_estimate') {
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
  'estimate', 'estimates', 'number', 'numbers', 'link', 'links', 'size', 'sizes', 'strength', 'strengths',
]);
const FILLERS = new Set(['of', 'the', 'olumi', 's', 'its', 'their', 'own', 'underlying', 'estimated', 'starting', 'these', 'those']);
const CONJUNCTIONS = new Set(['and', 'but', 'while', 'whereas']);
const SUBJECTS = new Set(['olumi', 'you', 'we', 'i', 'they', 'he', 'she', 'it']);
const VERBS = new Set([
  'am', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'come', 'comes', 'came', 'give', 'gives', 'gave', 'feed', 'feeds', 'supply', 'supplies',
  'estimate', 'estimates', 'provide', 'provides', 'count', 'counts', 'belong', 'belongs',
  'choose', 'chooses', 'chose', 'think', 'thinks', 'thought', 'suggest', 'suggests',
]);
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isWord = (code: number): boolean => isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
const isSpace = (code: number): boolean => (code >= 9 && code <= 13) || code === 32 || code === 160 || code === 0x2028 || code === 0x2029;
const isVerb = (word: string): boolean => VERBS.has(word) || word.endsWith('ed');

interface Token { readonly word: string; readonly start: number; readonly end: number; readonly clause: number }

function isCount(word: string): boolean {
  if (NUMBER_WORDS.has(word) || TENS.has(word)) return true;
  const hyphen = word.indexOf('-');
  if (hyphen !== -1) return TENS.has(word.slice(0, hyphen)) && UNITS.has(word.slice(hyphen + 1));
  for (let i = 0; i < word.length; i += 1) if (!isDigit(word.charCodeAt(i))) return false;
  return word.length > 0;
}

/** One linear token scan: no regex repetitions or backtracking on arbitrary narrator text. */
function attributedCount(sentence: string): boolean {
  const tokens: Token[] = [];
  let clause = 0;
  for (let i = 0; i < sentence.length;) {
    if (!isWord(sentence.charCodeAt(i))) {
      if ([',', ';', ':', '—'].includes(sentence[i]!)
        && !(sentence[i] === ',' && isDigit(sentence.charCodeAt(i - 1)) && isDigit(sentence.charCodeAt(i + 1)))) clause += 1;
      i += 1;
      continue;
    }
    const start = i;
    while (i < sentence.length && isWord(sentence.charCodeAt(i))) i += 1;
    // Keep number compounds together, but retain the Olumi token in e.g. Olumi-generated.
    if (TENS.has(sentence.slice(start, i).toLowerCase())) {
      while (i < sentence.length && (isWord(sentence.charCodeAt(i))
        || (sentence[i] === '-' && isWord(sentence.charCodeAt(i + 1))))) i += 1;
    }
    const word = sentence.slice(start, i).toLowerCase();
    tokens.push({ word, start, end: i, clause });
  }
  const joined = (a: Token, b: Token): boolean => {
    if (a.clause !== b.clause) return false;
    if (a.end === b.start) return false;
    for (let i = a.end; i < b.start; i += 1) {
      const char = sentence[i];
      if (!isSpace(sentence.charCodeAt(i)) && char !== "'" && char !== '’') return false;
    }
    return true;
  };
  // Bounded lookahead distinguishes a new subject/predicate from a coordinated noun list.
  const startsClause = (i: number): boolean => {
    const first = tokens[i];
    const second = tokens[i + 1];
    if (first === undefined || second === undefined || !joined(first, second)) return false;
    if (SUBJECTS.has(first.word)) {
      // An explicit new subject plus its predicate need not use a closed verb vocabulary.
      if (second.word !== 's' && !CONJUNCTIONS.has(second.word)
        && !SUBJECTS.has(second.word) && !isCount(second.word)) return true;
      // Possessive subjects: "Olumi's estimate was useful" is also an independent clause.
      if (second.word === 's') {
        const noun = tokens[i + 2];
        const verb = tokens[i + 3];
        return noun !== undefined && verb !== undefined && joined(second, noun)
          && joined(noun, verb) && isVerb(verb.word);
      }
    }
    if (!isCount(first.word)) return false;
    let j = i + 1;
    for (let skipped = 0; skipped < 3 && FILLERS.has(tokens[j]?.word ?? ''); skipped += 1) j += 1;
    const noun = tokens[j];
    const verb = tokens[j + 1];
    return noun !== undefined && verb !== undefined && first.clause === noun.clause
      && COUNT_KINDS.has(noun.word) && joined(noun, verb) && isVerb(verb.word);
  };
  let currentClause = -1;
  let hasOlumi = false;
  let hasCount = false;
  let hasPredicate = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.clause !== currentClause
      || (CONJUNCTIONS.has(token.word) && hasPredicate && startsClause(i + 1))) {
      if (hasOlumi && hasCount) return true;
      currentClause = token.clause;
      hasOlumi = false;
      hasCount = false;
      hasPredicate = false;
    }
    if (token.word === 'olumi') hasOlumi = true;
    const previousToken = tokens[i - 1];
    if (isVerb(token.word) || (previousToken !== undefined && previousToken.clause === token.clause
      && SUBJECTS.has(previousToken.word) && token.word !== 's'
      && !CONJUNCTIONS.has(token.word) && !SUBJECTS.has(token.word) && !isCount(token.word))) hasPredicate = true;
    if (!isCount(token.word)) continue;
    // Decimal/grouped fragments are not standalone integer counts.
    const before = sentence[token.start - 1];
    const after = sentence[token.end];
    if (before === '-' || ((before === '.' || before === ',') && isDigit(sentence.charCodeAt(token.start - 2)))) continue;
    if ((after === '.' || after === ',') && isDigit(sentence.charCodeAt(token.end + 1))) continue;
    let previous = token;
    for (let j = i + 1, skipped = 0; j < tokens.length; j += 1) {
      const next = tokens[j]!;
      if (!joined(previous, next)) break;
      if (COUNT_KINDS.has(next.word)) { hasCount = true; break; }
      if (skipped === 3 || !FILLERS.has(next.word)) break;
      previous = next;
      skipped += 1;
    }
  }
  return hasOlumi && hasCount;
}

/** Science §(f): only the deterministic producer may state counts, even when narration matches N. */
export function narratorCountGuard(text: string, _e: OlumiEstimates | null): { text: string; removed: string[] } {
  const removed: string[] = [];
  // Also preserves all whitespace and bytes of the common no-count case.
  if (!text.toLowerCase().includes('olumi')) return { text, removed };
  const kept: string[] = [];
  const append = (end: number): void => {
    const sentence = text.slice(start, end);
    // Read a normalised copy (buddy r2): Markdown emphasis never hides a count ("**9** values"), and a grouped or
    // decimal figure is one count ("1,000 values"). The kept text is the original bytes.
    const plain = sentence.replace(/[*_`~]/g, '').replace(/(\d)[,.](?=\d)/g, '$1');
    if (attributedCount(plain)) removed.push(sentence.trim());
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
