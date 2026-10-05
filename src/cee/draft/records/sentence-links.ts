/**
 * ⭐ THE SENTENCE-PASS MERGE (design DESIGN-SENTENCE-PASS.md §3–§4; PL stop rule, DL-accepted 5 Oct; DL/PL amend 2).
 *
 * PURE. Input: the main call's record set exactly as it reached the seam, the main compile's own refusals and typed asks
 * (by stated index), the deterministic inventory, and the pass's typed records. Output: ONE merged record set (main
 * indices unchanged; appended items take new indices) and its receipts. The merged set is then compiled by the SAME
 * chain as the main one (`replayRecordSet` → seam → `locateRecordEvidence`/`boundLiteral` → `canonicalQuantityUnits`/
 * `unitEvidenceReason` → `statedEffectQuoteMatches`): the pass PROPOSES, the existing validators DECIDE. Nothing here
 * accepts a value; it only places the pass's typed fields where the design's precedence allows.
 *
 * PRECEDENCE (design §4, exactly):
 *   1. A main link that compiled is never changed. A pass that disagrees with it is a receipt only.
 *   2. The pass fills a link only when the main compile left it typed `unresolved` (`link_unresolved`) or refused it on
 *      that stated index for one of FILLABLE_REFUSALS. An absent optional link is neither, and is not filled.
 *   3. In place when every literal the fill carries locates in the main item's own quote; otherwise the item is
 *      requoted to its sentence's brief slice (same index, so nothing that names it moves).
 *   4. A relationship endpoint whose declaring figure has no main item gets the pass's own record for that figure
 *      appended (the projector's fix (d) then carries it).
 * ALIGNMENT (design §3): a pass figure F aligns to main item i only by span: i's located value literal span (else, for an
 * item with no value literal, its quote span) contains F's span; and `sameUnit` holds whenever the main quantity
 * declares a unit. Exactly one match, or the merge refuses. Quantity identity D(F) = main[i].quantity ?? i.
 * LABELS ARE NEVER READ. The only string operations are `indexOf` (unique) and `locateLiteral`.
 *
 * ⛔ Imports are deliberately narrow (row (e) asserts them): no amount or unit parser, no label reader.
 */
import { sameUnit } from '../../../orchestrator-v5/agent-lane/same-unit.js';
import { locateLiteral } from './quantity-evidence.js';
import { DRAFT_RECORD_UNRESOLVED, type DraftRecordSet, type DraftStatedItem, type DraftStatedRelationship } from './grammar.js';
import type { InventoryFigure, SentenceInventory, SentencePassRecord } from './sentence-pass.js';

/** The refusals on a stated index that the pass may fill (design §4, verbatim list). */
export const FILLABLE_REFUSALS: ReadonlySet<string> = new Set([
  'relationship_endpoint_missing', 'quantity_unit_undeclared', 'unit_not_evidenced', 'literal_value_mismatch', 'option_value_unbound', 'option_change_by_baseline_unknown',
]);

export interface MainCompileFacts {
  /** The main compile's refusals and typed asks with a stated index (`RecordProjection.dropped`). */
  readonly dropped: ReadonlyArray<{ readonly stated_index?: number; readonly reason: string; readonly unresolved_field?: string }>;
  /** The main compile's receipt (`RecordProjection.stated_dispositions`): which stated items it carried. */
  readonly dispositions: ReadonlyArray<{ readonly stated_index: number; readonly disposition: string }>;
}

export type SentenceLinkMode = 'in_place' | 'requoted' | 'appended';
export interface SentenceLinkFill {
  readonly stated_index: number;
  readonly field: string;
  readonly mode: SentenceLinkMode;
  readonly sentence: number;
  readonly figure?: number;
}
export type SentenceLinkRefusalReason =
  | 'sentence_unknown' | 'figure_unknown' | 'figure_not_in_sentence' | 'figure_record_ambiguous'
  | 'alignment_none' | 'alignment_ambiguous' | 'unit_mismatch' | 'main_quote_not_unique'
  | 'main_link_compiled' | 'main_link_not_fillable' | 'endpoint_unresolved' | 'endpoint_undeclared' | 'endpoint_is_option_without_item'
  | 'literal_not_in_sentence' | 'no_main_item' | 'option_binding_missing' | 'change_quantity_conflict';
export interface SentenceLinkRefusal {
  readonly sentence: number;
  readonly role: string;
  readonly reason: SentenceLinkRefusalReason;
  readonly figure?: number;
  readonly stated_index?: number;
  readonly field?: string;
}
export interface SentenceLinkMerge {
  readonly records: DraftRecordSet;
  readonly fills: readonly SentenceLinkFill[];
  readonly refusals: readonly SentenceLinkRefusal[];
  readonly appended: number;
}

type Span = { start: number; end: number };
const within = (inner: Span, outer: Span): boolean => inner.start >= outer.start && inner.end <= outer.end;
const unresolvedToken = (value: unknown): boolean => value === DRAFT_RECORD_UNRESOLVED;

export function mergeSentenceLinks(input: {
  readonly brief: string;
  readonly main: DraftRecordSet;
  readonly facts: MainCompileFacts;
  readonly inventory: SentenceInventory;
  readonly pass: readonly SentencePassRecord[];
}): SentenceLinkMerge {
  const { brief, inventory, pass } = input;
  const records = structuredClone(input.main) as DraftRecordSet;
  const items = records.stated_items as Array<DraftStatedItem & Record<string, unknown>>;
  const mainCount = items.length;
  const fills: SentenceLinkFill[] = [];
  const refusals: SentenceLinkRefusal[] = [];

  // ── What the main compile left open, by stated index. ──
  const asked = new Map<number, Set<string>>();
  const refused = new Map<number, Set<string>>();
  for (const d of input.facts.dropped) {
    if (d.stated_index === undefined || d.stated_index < 0 || d.stated_index >= mainCount) continue;
    if (d.reason === 'link_unresolved' && d.unresolved_field !== undefined) {
      (asked.get(d.stated_index) ?? asked.set(d.stated_index, new Set()).get(d.stated_index)!).add(d.unresolved_field);
    } else if (FILLABLE_REFUSALS.has(d.reason)) {
      (refused.get(d.stated_index) ?? refused.set(d.stated_index, new Set()).get(d.stated_index)!).add(d.reason);
    }
  }
  const carried = new Set(input.facts.dispositions.filter((d) => d.disposition === 'carried').map((d) => d.stated_index));
  /**
   * A link is OPEN when the main compile asked it (typed `unresolved`: the compile's own statement that this link is
   * missing, carried item or not), or refused its item for a fillable reason and the link is not typed on it. A
   * relationship is the whole of a cause's link, so a refused cause's relationship is open. A carried item's typed links
   * are never open.
   */
  const open = (index: number, field: string): boolean => {
    if (index >= mainCount) return false;
    // The compile's own typed ask names the missing link, even on an item it carried (a goal carried without direction).
    if (asked.get(index)?.has(field) === true) return true;
    if (carried.has(index) || (refused.get(index)?.size ?? 0) === 0) return false;
    const value = items[index]![field];
    return field === 'relationship' || value === undefined || unresolvedToken(value);
  };

  // ── Spans of the main items (design §3): the unique quote occurrence, plus its located value literal. ──
  const quoteSpan = (index: number): Span | undefined => {
    const quote = items[index]?.source_quote;
    if (typeof quote !== 'string' || quote.length === 0) return undefined;
    const start = brief.indexOf(quote);
    if (start < 0 || start !== brief.lastIndexOf(quote)) return undefined;
    return { start, end: start + quote.length };
  };
  const valueSpan = (index: number): Span | undefined => {
    const item = items[index]!;
    const q = quoteSpan(index);
    if (q === undefined || typeof item.value_literal !== 'string') return undefined;
    const located = locateLiteral(item.source_quote, item.value_literal);
    return located.reason !== undefined ? undefined : { start: q.start + located.span.start, end: q.start + located.span.end };
  };
  /** The unit a main item's quantity declares (raw: the declaring item's own `unit`). */
  const declaringIndex = (index: number): number => {
    const q = items[index]?.quantity;
    return typeof q === 'number' && Number.isInteger(q) && q >= 0 && q < items.length ? q : index;
  };
  const declaredUnit = (index: number): string | undefined => {
    const unit = items[declaringIndex(index)]?.unit;
    return typeof unit === 'string' && !unresolvedToken(unit) ? unit : undefined;
  };

  const figureById = new Map(inventory.figures.map((f) => [f.id, f] as const));
  const sentenceById = new Map(inventory.sentences.map((s) => [s.id, s] as const));
  /** The pass's own record for each figure it typed (goal, figure, option setting or context). Two = ambiguous. */
  const recordByFigure = new Map<number, SentencePassRecord | null>();
  for (const r of pass) {
    if (r.role === 'cause' || r.role === 'option_effect' || typeof r.figure !== 'number') continue;
    recordByFigure.set(r.figure, recordByFigure.has(r.figure) ? null : r);
  }
  const refuse = (r: SentencePassRecord, reason: SentenceLinkRefusalReason, extra: Partial<SentenceLinkRefusal> = {}): void => {
    refusals.push({ sentence: r.sentence, role: r.role, reason, ...extra });
  };

  /** Align a pass figure to exactly one main item (design §3). `unit` is the pass's declared unit for it, if any. */
  const align = (figure: InventoryFigure, unit: string | undefined, kinds?: readonly string[]):
    { index: number } | { reason: SentenceLinkRefusalReason } => {
    const span = { start: figure.start, end: figure.end };
    let candidates: number[] = [];
    for (let i = 0; i < mainCount; i++) {
      if (kinds !== undefined && !kinds.includes(items[i]!.kind)) continue;
      const v = valueSpan(i);
      if (v !== undefined && within(span, v)) candidates.push(i);
    }
    if (candidates.length === 0) {
      // An item with no value literal (an untyped option or goal) aligns by its quote span alone.
      for (let i = 0; i < mainCount; i++) {
        if (kinds !== undefined && !kinds.includes(items[i]!.kind)) continue;
        if (typeof items[i]!.value_literal === 'string') continue;
        const q = quoteSpan(i);
        if (q !== undefined && within(span, q)) candidates.push(i);
      }
    }
    if (candidates.length === 0) return { reason: 'alignment_none' };
    if (unit !== undefined) {
      const declared = candidates.filter((i) => declaredUnit(i) !== undefined);
      const unitless = candidates.filter((i) => declaredUnit(i) === undefined);
      const matching = declared.filter((i) => sameUnit(declaredUnit(i), unit));
      if (declared.length > 0 && matching.length === 0 && unitless.length === 0) return { reason: 'unit_mismatch' };
      candidates = [...matching, ...unitless];
    }
    if (candidates.length !== 1) return { reason: 'alignment_ambiguous' };
    return { index: candidates[0]! };
  };

  /** Every literal locates exactly once in `text`. */
  const allLocate = (text: string, literals: ReadonlyArray<string | undefined>): boolean =>
    literals.every((literal) => literal === undefined || locateLiteral(text, literal).reason === undefined);

  /** The fill's mode for item `index`: in place, else requoted to the sentence slice, else refused. */
  const placement = (index: number, sentenceId: number, literals: ReadonlyArray<string | undefined>): SentenceLinkMode | undefined => {
    const item = items[index]!;
    if (allLocate(item.source_quote, literals)) return 'in_place';
    const sentence = sentenceById.get(sentenceId);
    if (sentence === undefined || !allLocate(sentence.text, literals)) return undefined;
    // The requoted item's OTHER literals must still locate in the new quote, or the requote would break them.
    const own = [item.value_literal, ...(item.unit_literals ?? []), item.direction_literal]
      .filter((l): l is string => typeof l === 'string' && !unresolvedToken(l));
    if (!allLocate(sentence.text, own)) return undefined;
    item.source_quote = sentence.text;
    return 'requoted';
  };

  /** Append the pass's own record for a figure no main item declares (design §4.2, missing declaring item). */
  const appended = new Map<number, number>();
  const appendFigure = (figure: InventoryFigure): number | SentenceLinkRefusalReason => {
    const prior = appended.get(figure.id);
    if (prior !== undefined) return prior;
    const own = recordByFigure.get(figure.id);
    if (own === null) return 'figure_record_ambiguous';
    if (own === undefined) return 'endpoint_undeclared';
    if (own.role === 'option_setting' || own.role === 'goal') return 'endpoint_is_option_without_item';
    const sentence = sentenceById.get(figure.sentence)!;
    const index = items.length;
    const item: DraftStatedItem = {
      kind: own.kind === 'change_quantity' ? 'change_quantity' : 'figure', source_quote: sentence.text, quantity: index,
      ...(own.quantity_label !== undefined ? { quantity_label: own.quantity_label } : {}),
      ...(own.value !== undefined ? { value: own.value } : {}),
      ...(own.value_literal !== undefined ? { value_literal: own.value_literal } : {}),
      ...(own.unit !== undefined ? { unit: own.unit } : {}),
      ...(own.unit_literals !== undefined ? { unit_literals: [...own.unit_literals] } : {}),
      ...(own.value_scale !== undefined ? { value_scale: own.value_scale } : {}),
      role: own.role === 'figure' ? 'baseline' : 'context',
    };
    items.push(item as DraftStatedItem & Record<string, unknown>);
    appended.set(figure.id, index);
    fills.push({ stated_index: index, field: 'figure', mode: 'appended', sentence: figure.sentence, figure: figure.id });
    return index;
  };

  /** The quantity identity of a declaring figure: D(F) = main[i].quantity ?? i, or an appended item. */
  const identity = (figureId: number | typeof DRAFT_RECORD_UNRESOLVED | undefined): number | SentenceLinkRefusalReason => {
    if (typeof figureId !== 'number') return 'endpoint_unresolved';
    if (appended.has(figureId)) return appended.get(figureId)!;
    const figure = figureById.get(figureId);
    if (figure === undefined) return 'figure_unknown';
    const own = recordByFigure.get(figureId);
    const aligned = align(figure, own?.unit ?? undefined);
    if ('index' in aligned) return declaringIndex(aligned.index);
    if (aligned.reason !== 'alignment_none') return aligned.reason;
    return appendFigure(figure);
  };

  // Explicit increment declarations are processed first, so every later link resolves the SAME quantity.
  // A refused option keeps its option node: its increment gets a separate declaring item and all typed aliases follow.
  for (const r of pass) {
    if (r.kind !== 'change_quantity' || typeof r.figure !== 'number') continue;
    const figure = figureById.get(r.figure), sentence = sentenceById.get(r.sentence);
    if (figure === undefined || sentence === undefined || figure.sentence !== r.sentence) { refuse(r, 'figure_not_in_sentence'); continue; }
    if (!r.quantity_label?.trim()) { refuse(r, 'change_quantity_conflict'); continue; }
    const at = align(figure, r.unit, r.role === 'option_setting' ? ['option'] : undefined);
    if (!('index' in at)) {
      if (at.reason === 'alignment_none') appendFigure(figure);
      else refuse(r, at.reason);
      continue;
    }
    const index = at.index, main = items[index]!;
    if (main.kind === 'option') {
      if (!open(index, 'quantity') && !input.facts.dropped.some(d => d.stated_index === index && d.reason === 'option_change_by_baseline_unknown')) {
        refuse(r, 'main_link_compiled', { stated_index: index }); continue;
      }
      const old = declaringIndex(index), q = items.length;
      items.push({ kind: 'change_quantity', source_quote: sentence.text, quantity: q, quantity_label: r.quantity_label,
        unit: r.unit ?? declaredUnit(index), unit_literals: r.unit_literals, value_literal: r.value_literal,
        value_scale: r.value_scale ?? items[old]?.value_scale } as DraftStatedItem & Record<string, unknown>);
      appended.set(figure.id, q);
      // This alias is changed only because its option setting did NOT compile.
      for (let i = 0; i < mainCount; i++) {
        const item = items[i]!;
        if (i !== old && item.quantity === old) item.quantity = q;
        if (typeof item.relationship === 'object' && item.relationship !== null) {
          if (item.relationship.from_quantity === old) item.relationship.from_quantity = q;
          if (item.relationship.to_quantity === old) item.relationship.to_quantity = q;
        }
      }
      for (const claim of records.claims) if (claim.quantity === old) claim.quantity = q;
      main.quantity = q;
      fills.push({ stated_index: q, field: 'change_quantity', mode: 'appended', sentence: r.sentence, figure: figure.id });
    } else if (main.kind === 'figure' && !carried.has(index)) {
      main.kind = 'change_quantity'; main.quantity_label = r.quantity_label;
      delete main.value; delete main.range; delete main.baseline;
      if (r.unit !== undefined) main.unit = r.unit;
      if (r.unit_literals !== undefined) main.unit_literals = [...r.unit_literals];
      if (r.value_literal !== undefined) main.value_literal = r.value_literal;
      // A context figure is evidence for the effect, never today's stock level.
      main.quantity = index;
      fills.push({ stated_index: index, field: 'change_quantity', mode: 'in_place', sentence: r.sentence, figure: figure.id });
    } else if (main.kind !== 'change_quantity') refuse(r, 'change_quantity_conflict', { stated_index: index });
  }

  for (const r of pass) {
    const sentence = sentenceById.get(r.sentence);
    if (sentence === undefined) { refuse(r, 'sentence_unknown'); continue; }

    if (r.role === 'option_effect') {
      const effect = r.option_effect;
      if (effect === undefined) { refuse(r, 'option_binding_missing'); continue; }
      const optionSentence = sentenceById.get(effect.option_sentence);
      const literal = optionSentence === undefined ? undefined : locateLiteral(optionSentence.text, effect.option_literal);
      if (optionSentence === undefined || literal?.reason !== undefined || literal?.span === undefined) { refuse(r, 'option_binding_missing'); continue; }
      const optionSpan = { start: optionSentence.start + literal.span.start, end: optionSentence.start + literal.span.end };
      const options = items.slice(0, mainCount).flatMap((item, i) => {
        const q = quoteSpan(i);
        return item.kind === 'option' && q !== undefined && within(q, optionSpan) ? [i] : [];
      });
      if (options.length !== 1) { refuse(r, 'option_binding_missing'); continue; }
      const quantity = identity(effect.quantity_figure);
      if (typeof quantity !== 'number') { refuse(r, quantity); continue; }
      if (!allLocate(sentence.text, [effect.value_literal, effect.range?.low_literal, effect.range?.high_literal, ...(r.unit_literals ?? [])])) {
        refuse(r, 'literal_not_in_sentence'); continue;
      }
      const existing = items.findIndex(item => item.kind === 'option_effect' && item.option_effect?.option === options[0] && item.option_effect?.quantity === quantity);
      if (existing >= 0) { refuse(r, 'main_link_compiled', { stated_index: existing }); continue; }
      const index = items.length;
      items.push({ kind: 'option_effect', source_quote: sentence.text, unit: r.unit, unit_literals: r.unit_literals,
        option_effect: { option: options[0]!, quantity, [effect.setting ?? 'change_by']: effect.value, value_literal: effect.value_literal,
          ...(effect.range !== undefined ? { range: { ...effect.range } } : {}) } } as DraftStatedItem & Record<string, unknown>);
      fills.push({ stated_index: index, field: 'option_effect', mode: 'appended', sentence: r.sentence });
      continue;
    }

    if (r.role === 'cause') {
      const rel = r.relationship;
      if (rel === undefined) continue;
      // The main cause in this sentence: exactly one cause item whose quote lies within the sentence's span.
      const causes: number[] = [];
      for (let i = 0; i < mainCount; i++) {
        if (items[i]!.kind !== 'cause') continue;
        const q = quoteSpan(i);
        if (q !== undefined && within(q, sentence)) causes.push(i);
      }
      if (causes.length === 0) { refuse(r, 'no_main_item'); continue; }
      if (causes.length > 1) { refuse(r, 'alignment_ambiguous'); continue; }
      const index = causes[0]!;
      const main = items[index]!;
      if (!open(index, 'relationship')) {
        refuse(r, carried.has(index) ? 'main_link_compiled' : 'main_link_not_fillable', { stated_index: index, field: 'relationship' });
        continue;
      }
      const from = identity(rel.from_figure);
      if (typeof from !== 'number') { refuse(r, from, { stated_index: index, field: 'relationship.from' }); continue; }
      const to = identity(rel.to_figure);
      if (typeof to !== 'number') { refuse(r, to, { stated_index: index, field: 'relationship.to' }); continue; }
      const literals = [rel.amount_literal, rel.per_source_literal, rel.range?.low_literal, rel.range?.high_literal, rel.no_effect_literal];
      const mode = placement(index, r.sentence, literals);
      if (mode === undefined) { refuse(r, 'literal_not_in_sentence', { stated_index: index, field: 'relationship' }); continue; }
      const relationship: DraftStatedRelationship = {
        from_quantity: from, to_quantity: to,
        ...(rel.amount !== undefined ? { amount: rel.amount } : {}),
        ...(rel.amount_literal !== undefined ? { amount_literal: rel.amount_literal } : {}),
        ...(rel.range !== undefined ? { range: { ...rel.range } } : {}),
        ...(rel.per_source_change !== undefined ? { per_source_change: rel.per_source_change } : {}),
        ...(rel.per_source_literal !== undefined ? { per_source_literal: rel.per_source_literal } : {}),
        ...(rel.no_effect_literal !== undefined ? { no_effect_literal: rel.no_effect_literal } : {}),
      };
      main.relationship = relationship;
      fills.push({ stated_index: index, field: 'relationship', mode, sentence: r.sentence });
      continue;
    }

    if (r.kind === 'change_quantity' && r.role !== 'option_setting') continue;
    if (typeof r.figure !== 'number') continue;
    const figure = figureById.get(r.figure);
    if (figure === undefined) { refuse(r, 'figure_unknown'); continue; }
    if (figure.sentence !== r.sentence) { refuse(r, 'figure_not_in_sentence', { figure: figure.id }); continue; }
    const kinds = r.role === 'goal' ? ['goal'] : r.role === 'option_setting' ? ['option'] : undefined;
    const aligned = align(figure, r.unit, kinds);
    if (!('index' in aligned)) {
      // A figure no main item states is appended only as an endpoint (design §4.2), never on its own.
      if (aligned.reason !== 'alignment_none') refuse(r, aligned.reason, { figure: figure.id });
      continue;
    }
    const index = aligned.index;
    const main = items[index]!;

    if (r.role === 'goal') {
      const direction = r.direction;
      if (open(index, 'direction') && open(index, 'direction_literal') && (direction === 'floor' || direction === 'ceiling')
        && typeof r.direction_literal === 'string' && !unresolvedToken(r.direction_literal)) {
        const mode = placement(index, r.sentence, [r.direction_literal]);
        if (mode === undefined) refuse(r, 'literal_not_in_sentence', { stated_index: index, field: 'direction' });
        else { main.direction = direction; main.direction_literal = r.direction_literal; fills.push({ stated_index: index, field: 'direction', mode, sentence: r.sentence, figure: figure.id }); }
      } else if (direction !== undefined && !unresolvedToken(direction) && main.direction !== undefined && main.direction !== direction && !unresolvedToken(main.direction)) {
        refuse(r, 'main_link_compiled', { stated_index: index, field: 'direction' });
      }
      if (open(index, 'unit') && typeof r.unit === 'string') {
        const declared = declaringIndex(index) === index ? undefined : declaredUnit(index);
        if (declared === undefined || sameUnit(declared, r.unit)) {
          main.unit = r.unit; fills.push({ stated_index: index, field: 'unit', mode: 'in_place', sentence: r.sentence, figure: figure.id });
        } else refuse(r, 'unit_mismatch', { stated_index: index, field: 'unit' });
      }
      if (open(index, 'baseline_ref') && typeof r.baseline_figure === 'number') {
        const b = figureById.get(r.baseline_figure);
        const own = recordByFigure.get(r.baseline_figure);
        const at = b === undefined ? undefined : align(b, own?.unit ?? r.unit);
        if (at !== undefined && 'index' in at && at.index !== index) {
          main.baseline_ref = at.index; fills.push({ stated_index: index, field: 'baseline_ref', mode: 'in_place', sentence: r.sentence, figure: r.baseline_figure });
        } else refuse(r, at !== undefined && !('index' in at) ? at.reason : 'alignment_none', { stated_index: index, field: 'baseline_ref' });
      }
      continue;
    }

    // A figure, context figure or option setting: its quantity link, its unit declaration and its value evidence.
    if (r.quantity_of !== undefined) {
      if (open(index, 'quantity')) {
        const q = r.quantity_of === figure.id ? index : identity(r.quantity_of);
        if (typeof q === 'number') { main.quantity = q; fills.push({ stated_index: index, field: 'quantity', mode: 'in_place', sentence: r.sentence, figure: figure.id }); }
        else refuse(r, q, { stated_index: index, field: 'quantity' });
      } else if (typeof main.quantity === 'number' && typeof r.quantity_of === 'number' && r.quantity_of !== figure.id) {
        const q = identity(r.quantity_of);
        if (typeof q === 'number' && q !== main.quantity) refuse(r, 'main_link_compiled', { stated_index: index, field: 'quantity' });
      }
    }
    const refusedHere = refused.get(index);
    if (refusedHere === undefined || refusedHere.size === 0 || carried.has(index)) continue;
    // A refused item takes the pass's typed evidence for the SAME figure (its value, unit and setting fields).
    const literals = [r.value_literal, ...(r.unit_literals ?? [])];
    const mode = placement(index, r.sentence, literals);
    if (mode === undefined) { refuse(r, 'literal_not_in_sentence', { stated_index: index, field: 'evidence' }); continue; }
    if (r.value !== undefined) {
      main.value = r.value;
      if (r.value_scale !== undefined) main.value_scale = r.value_scale;
    }
    if (r.value_literal !== undefined) main.value_literal = r.value_literal;
    if (r.unit_literals !== undefined) main.unit_literals = [...r.unit_literals];
    if (declaringIndex(index) === index) {
      if (r.unit !== undefined) main.unit = r.unit;
      if (r.value_scale !== undefined) main.value_scale = r.value_scale;
    }
    if (r.role === 'option_setting' && r.setting !== undefined) main.setting = r.setting;
    if (r.role === 'option_setting' && main.quantity === undefined && r.quantity_of === figure.id) main.quantity = index;
    fills.push({ stated_index: index, field: 'evidence', mode, sentence: r.sentence, figure: figure.id });
  }

  return { records, fills, refusals, appended: items.length - mainCount };
}

/**
 * ⭐ THE NEVER-WORSE GATE (design §4.4): the merged compile is served only if every stated item the main compile
 * CARRIED is still carried at the same index. Anything else serves the main compile, with a receipt.
 */
export function neverWorse(
  main: ReadonlyArray<{ readonly stated_index: number; readonly disposition: string }>,
  merged: ReadonlyArray<{ readonly stated_index: number; readonly disposition: string }>,
): { ok: true } | { ok: false; lost: number[] } {
  const after = new Map(merged.map((d) => [d.stated_index, d.disposition] as const));
  const lost = main.filter((d) => d.disposition === 'carried' && after.get(d.stated_index) !== 'carried').map((d) => d.stated_index);
  return lost.length === 0 ? { ok: true } : { ok: false, lost };
}
