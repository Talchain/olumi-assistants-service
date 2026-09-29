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

export interface Span { readonly text: string; readonly from: number; readonly to: number }

type Intervention = NonNullable<CandidateModel['options'][number]['interventions']>[number];
type Amount = ReturnType<typeof findStatedAmounts>[number];

const kindOf = (unit: unknown): AmountKind => {
  const family = unitPhraseFamily(unit);
  return family === 'currency' ? 'currency' : family === 'percent' ? 'percent' : 'plain';
};

/**
 * ⛔ A QUOTE PROVES THE WORDS, NOT THE FIGURE (AIQ 5892228477; PR Review CHANGES_REQUIRED on #2299 @ 9d85b017). An option
 * whose figure CONFLICTS with the item is not that item's option: it sets a figure the item does not write, while the
 * item writes a figure of the same kind (money, a percentage, a plain number). An Olumi "Raise to £54" that copies "raise
 * Pro price to £59" would otherwise take the user's quote, lose `proposed_by: 'olumi'` and could lead as the user's
 * choice. A figure the item says nothing of the same kind about (Olumi's level on "shift batch jobs to spot instances")
 * is no conflict, nor is a name like "tier-1" beside a £ or % figure. An item writing TWO or more money or percentage
 * figures speaks only through `multiFigureItemBinds`. Named residual: two PLAIN numbers with no unit word after either
 * ("hire 2 or 3") still match the one the option sets.
 */
function figuresAgree(option: CandidateModel['options'][number], item: string): boolean {
  const written = findStatedAmounts(item);
  return (option.interventions ?? []).every((i) => {
    if (typeof i.value !== 'number' || !Number.isFinite(i.value)) return true;
    const multi = multiFigureItemBinds(i, item);
    if (multi !== null) return multi;
    if (!written.some((a) => a.kind === kindOf(i.unit))) return true;
    return figureTheUserWrote(i.value, i.unit, item);
  });
}

const singular = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter((w) => w !== '').map(singular);
const DETERMINERS: ReadonlySet<string> = new Set(['the', 'our', 'your', 'their', 'its', 'my', 'this']);

/**
 * The item's OPENING words name the intervention's own quantity and nothing else: its words alone ("Pro price", "price
 * Pro"), or after one action word and at most one determiner ("raise Pro price", "increase the Pro plan price", "raise
 * price"). "raise Basic price", "reduce the setup credit", "cut the Pro setup price" and a bare "raise" name another
 * quantity, or none, and bind nothing.
 */
function opensOnTheQuantity(factorLabel: string, opening: string): boolean {
  const label = new Set(wordsOf(factorLabel).filter((w) => w.length >= 3));
  const ofLabel = (ws: readonly string[]): boolean => ws.length > 0 && ws.every((w) => label.has(w));
  const said = wordsOf(opening);
  if (ofLabel(said)) return true;
  const rest = said.slice(1);
  return ofLabel(DETERMINERS.has(rest[0] ?? '') ? rest.slice(1) : rest);
}

/**
 * ⭐ THE ONE BINDER OF A FIGURE TO AN OPTION'S ACTION IN A LISTED ITEM WRITING TWO OR MORE FIGURES OF ITS KIND (PR Review
 * CHANGES_REQUIRED on #2299 @ fcf35a8b and @ 43815390; AIQ 5895604637). Both readers of "is this the user's figure" go
 * through it: the quote (`figuresAgree`, here) and the Olumi mark (`olumiAddedOptionLabels`). A nearby "to" proves
 * nothing ("price Pro at £59 with a setup credit to £54": the £54 is the credit's). The item binds ONE figure, and only
 * through its OPENING action on the intervention's own quantity (`opensOnTheQuantity`):
 *  · "<quantity> to|at F …" → F, the item's first figure of the kind ("raise Pro price to £59 with a £54 setup credit",
 *    "price Pro at £59 with a setup credit to £54" → £59);
 *  · "<quantity> from X to Y …" → Y, never X ("increase the Pro plan price from £49 to £59" → £59).
 * The option's figure must be that one. Any other shape binds none: no quote, and the option stays Olumi's (the fail-safe
 * direction for both readers). Named under-claims: a change typed as a delta ("by £10 to £59"), a figure written before
 * its quantity ("a £59 Pro price"), an item opening on another quantity ("raise Basic price to £54 with Pro at £59").
 * Returns null when the item writes fewer than two distinct figures of the kind (the single-figure readings apply).
 */
export function multiFigureItemBinds(i: Intervention, item: string): boolean | null {
  if (typeof i.value !== 'number' || !Number.isFinite(i.value)) return null;
  const kind = kindOf(i.unit);
  if (kind === 'plain') return null;
  const sameKind = findStatedAmounts(item).filter((a) => a.kind === kind).sort((a, b) => a.index - b.index);
  if (new Set(sameKind.map((a) => a.magnitude)).size < 2) return null;
  const bound = openingActionFigure(String(i.factor_label ?? ''), item, sameKind);
  return bound !== null && figureTheUserWrote(i.value, i.unit, item.slice(bound.index, bound.index + bound.matchedText.length));
}

function openingActionFigure(factorLabel: string, item: string, sameKind: readonly Amount[]): Amount | null {
  const [first, second] = sameKind;
  if (first === undefined) return null;
  const before = item.slice(0, first.index);
  const from = /\bfrom\s*$/i.exec(before);
  if (from !== null) {
    const between = second === undefined ? '' : item.slice(first.index + first.matchedText.length, second.index);
    return second !== undefined && /^\s*to\s*$/i.test(between) && opensOnTheQuantity(factorLabel, before.slice(0, from.index)) ? second : null;
  }
  const prep = /\b(?:to|at)\s*$/i.exec(before);
  return prep !== null && opensOnTheQuantity(factorLabel, before.slice(0, prep.index)) ? first : null;
}

/** Each unique list item's span in the brief; an item written twice has no span (its quote could not be located). */
export function listedSpans(brief: string): readonly Span[] {
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
