/**
 * Recognising an OPTION in prose, from the option labels on the reply's own
 * `draft_graph` (never from a list the author typed).
 *
 * Three ways a clause can name an option, in order of strictness:
 *   (a) the label, or the label with its leading verb and article removed
 *       ("Hire a Tech Lead" → "tech lead"; "Hire Two Developers" → "two developers");
 *   (b) every content token of that short form is present (reordered paraphrases:
 *       "£59 pilot at release" ↔ "Pilot £59 at Release"), when there are ≥ 2 tokens;
 *   (c) a figure token (£59, 4-day) that appears in exactly ONE option label.
 * Anything looser than that is not counted as a mention: a missed mention makes a
 * check PASS vacuously; a false mention makes it FAIL wrongly, which is worse.
 */
import { escapeRe, norm } from './text.js';

const LEADING_VERB = new Set([
  'hire', 'hiring', 'keep', 'keeping', 'raise', 'raising', 'pilot', 'piloting', 'maintain', 'maintaining', 'carry',
  'continue', 'continuing', 'launch', 'launching', 'build', 'building', 'buy', 'buying', 'adopt', 'adopting', 'use',
  'using', 'stay', 'staying', 'switch', 'switching', 'move', 'moving', 'expand', 'expanding', 'delay', 'delaying',
  'invest', 'investing', 'cut', 'cutting', 'increase', 'increasing', 'reduce', 'reducing', 'add', 'adding', 'bring',
  'bringing', 'introduce', 'introducing', 'offer', 'offering', 'partner', 'partnering', 'outsource', 'outsourcing',
  'stop', 'stopping', 'start', 'starting', 'phase', 'hold', 'holding', 'go', 'do', 'run', 'open', 'opening', 'enter',
  'entering', 'acquire', 'acquiring', 'sell', 'selling', 'replace', 'replacing', 'migrate', 'migrating',
]);
const ARTICLE = new Set(['a', 'an', 'the']);
const STOP = new Set([
  'a', 'an', 'the', 'and', 'plus', 'or', 'of', 'to', 'at', 'in', 'on', 'for', 'with', 'by', 'from', 'as', 'then', 'into',
  'per', '+', '&', '-', '–', '—',
]);

/** Content tokens, plural-folded ("developers" → "developer"), punctuation-free except £ $ € % and digits. */
export function tokensOf(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9£$€%\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter((t) => t !== '' && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

export interface OptionMatcher {
  readonly label: string;
  /** Normalised full label and short form(s), longest first. */
  readonly phrases: readonly string[];
  /** Content tokens of the short form. */
  readonly tokens: readonly string[];
  /** Figure tokens (contain a digit or currency sign) unique to this option among its siblings. */
  readonly distinctiveFigures: readonly string[];
}

function shortForm(label: string): string {
  const words = norm(label).split(' ');
  let i = 0;
  if (words.length > 1 && LEADING_VERB.has(words[0]!)) i = 1;
  if (words.length > i + 1 && ARTICLE.has(words[i]!)) i += 1;
  return words.slice(i).join(' ');
}

export function buildOptionMatchers(labels: readonly string[]): OptionMatcher[] {
  const uniq = [...new Set(labels.filter((l) => l.trim() !== ''))];
  const figuresOf = (l: string) => tokensOf(l).filter((t) => /[0-9£$€]/.test(t));
  return uniq.map((label) => {
    const full = norm(label);
    const short = shortForm(label);
    const phrases = [...new Set([full, short])].filter((p) => p.length > 2).sort((a, b) => b.length - a.length);
    const figures = figuresOf(label).filter((f) => uniq.filter((o) => figuresOf(o).includes(f)).length === 1);
    return { label, phrases, tokens: tokensOf(short), distinctiveFigures: figures };
  });
}

const phraseRe = (p: string) => new RegExp(`(?:^|[^a-z0-9£$€])${escapeRe(p)}(?:$|[^a-z0-9%])`, 'i');

/** The option labels a clause names (see the header for the three rules). */
export function optionsNamedIn(clause: string, matchers: readonly OptionMatcher[]): string[] {
  const n = norm(clause);
  const toks = new Set(tokensOf(clause));
  return matchers
    .filter(
      (m) =>
        m.phrases.some((p) => phraseRe(p).test(n)) ||
        (m.tokens.length >= 2 && m.tokens.every((t) => toks.has(t))) ||
        m.distinctiveFigures.some((f) => toks.has(f)),
    )
    .map((m) => m.label);
}

/** The clause with every option phrase replaced by a neutral marker, so a label's own words ("Tech LEAD") cannot fire a cue. */
export function maskOptions(clause: string, matchers: readonly OptionMatcher[], extraLabels: readonly string[] = []): string {
  let out = norm(clause);
  const phrases = [...matchers.flatMap((m) => m.phrases), ...extraLabels.map(norm)].sort((a, b) => b.length - a.length);
  for (const p of phrases) if (p.length > 2) out = out.split(p).join(' optx ');
  return out;
}
