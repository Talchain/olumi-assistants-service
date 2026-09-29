/**
 * ⭐ AN OPTION THE BRIEF LISTS CARRIES THE BRIEF'S OWN WORDS FOR IT: `source_quote` (MG #72 5887699714; DL 5887755959;
 * AI Quality 5887822471).
 *
 * The Run names a leader only when every option the brief lists is bound to an analysed option by an EXACT saved quote
 * (`deriveIntakeOptionReconciliation`). Construction wrote none, so every brief that lists its options ("the options
 * are…", "deciding between…") ended in `identity_unverified`: "No option can be put forward from this result until that
 * correspondence is confirmed", and nothing the user could do confirmed it. Measured on served `fb15005`, 3/3.
 *
 * The drafter now copies the brief's words for each option (`brief_words`). A LABEL is never evidence (the
 * reconciliation's own rule): only the drafter's copied words locate the list item, and admission checks them. A quote is
 * written only when all of these hold, and otherwise nothing is written, which leaves today's honest withhold:
 *  · the words occur exactly once in the brief;
 *  · they overlap exactly one list item (`extractEnumeratedOptions`, the reconciliation's own reader), and one span holds
 *    the other, so a quote never straddles two items;
 *  · no other option's words land on the same item, and no other option shares the option's name;
 *  · no figure the option sets conflicts with one of the same kind the item writes (`figuresAgree`).
 * The quote written is the LIST ITEM's text, which is what the reconciliation compares. Pure.
 */
import { extractEnumeratedOptions } from '../../orchestrator/context/intake-option-reconciliation.js';
import { canonicalLabel, type CandidateModel } from './admit-model.js';
import { figureTheUserWrote } from './stated-by-user.js';
import { unitPhraseFamily } from './unit-conflict.js';
import { findStatedAmounts, type AmountKind } from '../../cee/provenance/stated-amounts.js';

interface Span { readonly text: string; readonly from: number; readonly to: number }

/**
 * ⛔ A QUOTE PROVES THE WORDS, NOT THE FIGURE (AIQ 5892228477; PR Review CHANGES_REQUIRED on #2299 @ 9d85b017). An option
 * whose figure CONFLICTS with the item is not that item's option: it sets a figure the item does not write, while the
 * item writes a figure of the same kind (money, a percentage, a plain number). An Olumi "Raise to £54" that copies "raise
 * Pro price to £59" would otherwise take the user's quote, lose `proposed_by: 'olumi'` and could lead as the user's
 * choice. A figure the item says nothing of the same kind about (Olumi's level on "shift batch jobs to spot instances")
 * is no conflict, nor is a name like "tier-1" beside a £ or % figure. An item writing TWO money or percentage figures
 * binds only as "<the option's quantity> from X to Y", to Y (`fromToBinds`); any other such item binds none. Named
 * residuals: a change typed as a delta, or any two-figure item not in that shape ("to £59 with a £54 setup credit"), is
 * not quoted (the Run withholds, as before this PR); two PLAIN numbers with no unit word after either ("hire 2 or 3")
 * still match the one the option sets.
 */
function figuresAgree(option: CandidateModel['options'][number], item: string): boolean {
  const written = findStatedAmounts(item);
  const kindOf = (unit: unknown): AmountKind => {
    const family = unitPhraseFamily(unit);
    return family === 'currency' ? 'currency' : family === 'percent' ? 'percent' : 'plain';
  };
  return (option.interventions ?? []).every((i) => {
    if (typeof i.value !== 'number' || !Number.isFinite(i.value)) return true;
    const kind = kindOf(i.unit);
    const sameKind = new Set(written.filter((a) => a.kind === kind).map((a) => a.magnitude));
    if (sameKind.size === 0) return true;
    // ⛔ PR Review CHANGES_REQUIRED on #2299 @ fcf35a8b and @ 43815390: an item that writes TWO money (or percentage)
    // figures cannot say by position alone which is the option's ("to £59 with a £54 setup credit"; "price Pro at £59
    // with a setup credit to £54"). It binds ONLY in the one shape that names the relationship: "<the option's quantity>
    // from X to Y" — exactly one from–to pair, no other figure of that kind, the intervention's own quantity named right
    // before "from" — and the option's figure is Y. Anything else binds none: no quote, the Run's honest withhold. A plain number
    // keeps its reading, which the word after it already binds ("3 months" is never 3 engineers).
    if (kind !== 'plain' && sameKind.size > 1) return fromToBinds(i, item, written.filter((a) => a.kind === kind));
    return figureTheUserWrote(i.value, i.unit, item);
  });
}

const singular = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter((w) => w !== '').map(singular);
const DETERMINERS: ReadonlySet<string> = new Set(['the', 'our', 'your', 'their', 'its', 'my', 'this']);

/**
 * The words before "from" name the option's OWN quantity: the quantity's head noun ("Pro plan price" → price) directly
 * before "from", qualified only by the quantity's own words, back to a determiner or the item's first word ("increase
 * our Pro plan price", "raise Pro price", "raise price"). "raise Basic price", "the setup credit", "the Pro setup price"
 * name another quantity and bind nothing.
 */
function namesTheQuantity(factorLabel: string, beforeFrom: string): boolean {
  const label = wordsOf(factorLabel).filter((w) => w.length >= 3);
  const said = wordsOf(beforeFrom);
  if (label.length === 0 || said.length === 0 || said[said.length - 1] !== label[label.length - 1]) return false;
  let k = said.length - 2;
  while (k >= 0 && label.includes(said[k]!)) k--;
  return k <= 0 || DETERMINERS.has(said[k]!);
}

/**
 * "<quantity> from X to Y" on an item writing two figures of the intervention's kind: the ONE relationship an item states
 * about its figures. Binds only when it is the item's only pair, the item writes no other figure of that kind, the words
 * before "from" name the intervention's own quantity (`namesTheQuantity`), and the intervention's figure is Y.
 */
function fromToBinds(
  i: NonNullable<CandidateModel['options'][number]['interventions']>[number],
  item: string,
  sameKind: readonly { readonly magnitude: number; readonly index: number; readonly matchedText: string }[],
): boolean {
  const pairs: [typeof sameKind[number], typeof sameKind[number]][] = [];
  for (const x of sameKind) {
    for (const y of sameKind) {
      if (y.index <= x.index) continue;
      if (/\bfrom\s*$/i.test(item.slice(0, x.index)) && /^\s*to\s*$/i.test(item.slice(x.index + x.matchedText.length, y.index))) pairs.push([x, y]);
    }
  }
  if (pairs.length !== 1) return false;
  const [x, y] = pairs[0]!;
  if (sameKind.some((a) => a !== x && a !== y)) return false;
  if (!namesTheQuantity(String(i.factor_label ?? ''), item.slice(0, x.index).replace(/\bfrom\s*$/i, ''))) return false;
  return figureTheUserWrote(i.value as number, i.unit, item.slice(y.index, y.index + y.matchedText.length));
}

/** Each unique list item's span in the brief; an item written twice has no span (its quote could not be located). */
function listedSpans(brief: string): readonly Span[] {
  return extractEnumeratedOptions(brief).flatMap((c) => {
    const at = brief.indexOf(c.text);
    return at >= 0 && brief.indexOf(c.text, at + 1) === -1 ? [{ text: c.text, from: at, to: at + c.text.length }] : [];
  });
}

/** Canonical option label → the list item its copied words bind to. Empty when the brief lists fewer than two. */
export function optionQuotes(candidate: CandidateModel, brief: string): ReadonlyMap<string, string> {
  const spans = listedSpans(brief);
  if (spans.length < 2) return new Map();
  const options = candidate.options ?? [];
  const names = new Map<string, number>();
  for (const o of options) names.set(canonicalLabel(o.label ?? ''), (names.get(canonicalLabel(o.label ?? '')) ?? 0) + 1);
  const bound: [string, string][] = [];
  for (const o of options) {
    const words = (o as { brief_words?: unknown }).brief_words;
    const name = canonicalLabel(o.label ?? '');
    if (typeof words !== 'string' || words.trim() === '' || name === '' || names.get(name) !== 1) continue;
    const at = brief.indexOf(words);
    if (at < 0 || brief.indexOf(words, at + 1) !== -1) continue;
    const end = at + words.length;
    const touched = spans.filter((s) => s.from < end && at < s.to);
    if (touched.length !== 1) continue;
    const s = touched[0]!;
    if (!((at >= s.from && end <= s.to) || (s.from >= at && s.to <= end))) continue;
    if (!figuresAgree(o, s.text)) continue;
    bound.push([name, s.text]);
  }
  // A list item two options claim binds neither: the reconciliation would withhold anyway, and so does this.
  const claims = new Map<string, number>();
  for (const [, text] of bound) claims.set(text, (claims.get(text) ?? 0) + 1);
  return new Map(bound.filter(([, text]) => claims.get(text) === 1));
}

/**
 * The admitted graph's nodes with `source_quote` on each option node whose copied words bind one list item. A node that
 * already carries a quote keeps it. The same array comes back when nothing binds.
 */
export function quoteListedOptions<N extends { readonly kind?: unknown; readonly label?: unknown; readonly source_quote?: unknown }>(
  nodes: readonly N[], candidate: CandidateModel, brief: string,
): readonly N[] {
  const quotes = optionQuotes(candidate, brief);
  if (quotes.size === 0) return nodes;
  const optionNodes = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind === 'option' && typeof n.label === 'string') optionNodes.set(canonicalLabel(n.label), (optionNodes.get(canonicalLabel(n.label)) ?? 0) + 1);
  }
  const quoteFor = (n: N): string | undefined => (n.kind === 'option' && typeof n.label === 'string' && n.source_quote === undefined
    && optionNodes.get(canonicalLabel(n.label)) === 1 ? quotes.get(canonicalLabel(n.label)) : undefined);
  if (!nodes.some((n) => quoteFor(n) !== undefined)) return nodes;
  return nodes.map((n) => {
    const q = quoteFor(n);
    return q === undefined ? n : { ...n, source_quote: q };
  });
}
