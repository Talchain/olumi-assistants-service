/**
 * ⭐ THE SENTENCE-LEVEL TYPED LINK PASS: its deterministic inventory, its strict wire shape and its instruction
 * (design: output/model-construction-20261004/DESIGN-SENTENCE-PASS.md §1–§2; PL stop rule, DL-accepted 5 Oct).
 *
 * The pass sees the WHOLE brief plus an inventory of ids (binding condition 1): `S<j>` for every sentence and `F<i>`
 * for every figure the SAME collector the validators use locates (`findStatedAmounts`, as `boundLiteral` and
 * `locatedAmounts` do). The model picks ids; it never writes an offset. The compile maps each id back to its brief span
 * (`SentenceInventory`), and the existing validators decide everything the pass proposes (`sentence-links.ts`).
 *
 * Nothing here reads a label, parses a unit or supplies a value: the inventory enumerates spans, and the wire shape and
 * instruction only ask.
 */
import { segmentSentences } from '../../../orchestrator-v5/compose/defaulted-value-egress.js';
import { findStatedAmounts } from '../../provenance/stated-amounts.js';

export interface InventorySentence { readonly id: number; readonly start: number; readonly end: number; readonly text: string }
export interface InventoryFigure {
  readonly id: number;
  readonly sentence: number;
  /** Brief offsets of the collector's own matched text. */
  readonly start: number;
  readonly end: number;
  readonly literal: string;
}
export interface SentenceInventory { readonly sentences: readonly InventorySentence[]; readonly figures: readonly InventoryFigure[] }

/**
 * Every sentence (`segmentSentences`: it keeps its separators, so offsets are cumulative lengths) and every figure in
 * it (`findStatedAmounts` over the sentence's own bytes). Ids are 1-based, in brief order. Pure.
 */
export function buildSentenceInventory(brief: string): SentenceInventory {
  const sentences: InventorySentence[] = [];
  const figures: InventoryFigure[] = [];
  let offset = 0;
  for (const segment of segmentSentences(brief)) {
    const sentence: InventorySentence = { id: sentences.length + 1, start: offset, end: offset + segment.text.length, text: segment.text };
    sentences.push(sentence);
    for (const amount of findStatedAmounts(segment.text)) {
      const start = offset + amount.index;
      figures.push({ id: figures.length + 1, sentence: sentence.id, start, end: start + amount.matchedText.length, literal: amount.matchedText });
    }
    offset += segment.text.length + segment.sep.length;
  }
  return { sentences, figures };
}

/** A brief with no located figure makes no pass call (design §1: brief-3 "two developers" is a collector gap). */
export function sentencePassSelected(inventory: SentenceInventory): boolean {
  return inventory.figures.length > 0;
}

/** The pass's input: the whole brief, then the inventory of ids. Offsets are never shown; the model writes none. */
export function renderSentencePassInput(brief: string, inventory: SentenceInventory): string {
  const lines = ['BRIEF', brief, '', 'SENTENCES'];
  for (const s of inventory.sentences) lines.push(`S${s.id}: ${s.text}`);
  lines.push('', 'FIGURES');
  for (const f of inventory.figures) lines.push(`F${f.id}: ${JSON.stringify(f.literal)} in S${f.sentence}`);
  return lines.join('\n');
}
