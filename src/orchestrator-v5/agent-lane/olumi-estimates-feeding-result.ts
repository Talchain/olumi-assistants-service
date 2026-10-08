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
  driverIds?: readonly string[];
}): OlumiEstimates {
  const values: Item[] = [];
  const links: Item[] = [];
  let accepted = 0;
  let placeholderLinks = 0;
  const factorIds = new Set<string>();
  const linkIds = new Set<string>();
  for (const f of input.goalPathFactors) {
    if (factorIds.has(f.factor_id)) continue;
    factorIds.add(f.factor_id);
    if (f.value_authorship === 'olumi_accepted') accepted += 1;
    if (f.value_authorship === 'olumi_estimate') {
      values.push({ kind: 'value', id: f.factor_id, label: f.label, goal_distance: f.goal_distance });
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
    ordered: driverRank.size > 0 && top.some(item => driverRank.has(item.id)), top,
  };
}

/** RC4's shared words. UNVERIFIED for AIQ: the zero-count sentence and item-list presentation. */
export function sayOlumiEstimates(e: OlumiEstimates): string[] {
  if (e.count === 0) return ["None of the figures behind this result are Olumi's estimates."];
  const kinds: string[] = [];
  if (e.values.length > 0) kinds.push(`${e.values.length} ${e.values.length === 1 ? 'value' : 'values'}`);
  if (e.links.length > 0) kinds.push(`${e.links.length} ${e.links.length === 1 ? 'link size' : 'link sizes'}`);
  const lines = [`Olumi supplied ${e.count} of the figures behind this result: ${kinds.join(' and ')}.`];
  if (e.count > 3) lines.push(`${e.count} in total; here are 3.`);
  if (e.top.length > 0) {
    lines.push(e.ordered ? (e.top.length === 1 ? 'The one that matters most:' : `The ${e.top.length} that matter most:`) : 'For example:');
    lines.push(...e.top.map(item => `${item.label} (${item.kind === 'value' ? 'value' : 'link size'})`));
  }
  if (e.accepted > 0) lines.push(`${e.accepted} you accepted from Olumi's suggestions.`);
  if (e.placeholderLinks > 0) lines.push(`${e.placeholderLinks} links have no size yet.`);
  return lines;
}

const NUMBER_WORDS = new Map([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
].map((word, index) => [word, index + 1] as const));
const COUNT_KINDS = new Set(['value', 'values', 'figure', 'figures', 'input', 'inputs', 'assumption', 'assumptions']);
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isWord = (code: number): boolean => isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
const isSpace = (code: number): boolean => (code >= 9 && code <= 13) || code === 32 || code === 160 || code === 0x2028 || code === 0x2029;

interface Token { readonly word: string; readonly start: number; readonly end: number }

function countOf(word: string): number | undefined {
  const named = NUMBER_WORDS.get(word);
  if (named !== undefined) return named;
  for (let i = 0; i < word.length; i += 1) if (!isDigit(word.charCodeAt(i))) return undefined;
  return Number(word);
}

/** One linear token scan: no regex repetitions or backtracking on arbitrary narrator text. */
function unsupportedCount(sentence: string, e: OlumiEstimates | null): boolean {
  const tokens: Token[] = [];
  let olumi = false;
  for (let i = 0; i < sentence.length;) {
    if (!isWord(sentence.charCodeAt(i))) { i += 1; continue; }
    const start = i;
    while (i < sentence.length && isWord(sentence.charCodeAt(i))) i += 1;
    const word = sentence.slice(start, i).toLowerCase();
    if (word === 'olumi') olumi = true;
    tokens.push({ word, start, end: i });
  }
  if (!olumi) return false;
  const spaced = (a: Token, b: Token): boolean => {
    if (a.end === b.start) return false;
    for (let i = a.end; i < b.start; i += 1) if (!isSpace(sentence.charCodeAt(i))) return false;
    return true;
  };
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i]!;
    const count = countOf(token.word);
    if (count === undefined) continue;
    // Do not treat a fragment of twenty-one, 9.0, or 1,000 as a standalone integer count.
    const before = sentence[token.start - 1];
    const after = sentence[token.end];
    if (before === '-' || ((before === '.' || before === ',') && isDigit(sentence.charCodeAt(token.start - 2)))) continue;
    if ((after === '.' || after === ',') && isDigit(sentence.charCodeAt(token.end + 1))) continue;
    let nounIndex = i + 1;
    let noun = tokens[nounIndex]!;
    if (!spaced(token, noun)) continue;
    if (noun.word === 'of') {
      const article = tokens[i + 2];
      const next = tokens[i + 3];
      if (article?.word !== 'the' || next === undefined || !spaced(noun, article) || !spaced(article, next)) continue;
      nounIndex += 2;
      noun = next;
    }
    if (noun.word === 'underlying') {
      const next = tokens[nounIndex + 1];
      if (next === undefined || !spaced(noun, next)) continue;
      noun = next;
    }
    if (COUNT_KINDS.has(noun.word) && (e === null || count !== e.count)) return true;
  }
  return false;
}

/** Remove unsupported count sentences before composing/serving the agent.interpret answer. */
export function narratorCountGuard(text: string, e: OlumiEstimates | null): { text: string; removed: string[] } {
  const removed: string[] = [];
  // Also preserves all whitespace and bytes of the common no-count case.
  if (!text.toLowerCase().includes('olumi')) return { text, removed };
  const kept: string[] = [];
  const append = (end: number): void => {
    const sentence = text.slice(start, end);
    if (unsupportedCount(sentence, e)) removed.push(sentence.trim());
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
