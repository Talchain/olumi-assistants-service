/**
 * CEILING (self-authored), harness ONLY. No served import points here.
 * Transcribe typed pass records using the existing S/F inventory, then let
 * buildModelFromRecords -> replayRecordSet and its existing validators decide.
 * No numeric/unit parser, main-item alignment, claim rewriting or extra compile.
 * The fixture-only extensions express figureless options/quantities from text;
 * they are not a proposed served schema or a measured LLM capability.
 */
import type { DraftRecordSet, DraftStatedItem, DraftValueRange } from '../../src/cee/draft/records/grammar.js';
import { createHash } from 'node:crypto';
import { buildSentenceInventory, parseSentencePassOutput, type SentencePassRecord } from '../../src/cee/draft/records/sentence-pass.js';
import type { CallStructuredModel } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';

type Ref = number | 'unresolved' | { sentence: number; literal: string };
export type CeilingRecord = Omit<SentencePassRecord, 'role' | 'quantity_of' | 'relationship'> & {
  role: SentencePassRecord['role'] | 'option' | 'constraint';
  source_literal?: string;
  is_baseline?: boolean;
  range?: DraftValueRange;
  horizon_figure?: number;
  quantity_of?: Ref;
  relationship?: Omit<NonNullable<SentencePassRecord['relationship']>, 'from_figure' | 'to_figure'> & {
    from_figure: Ref; to_figure: Ref;
  };
};

/** Reuse the pass parser for every original field; extensions carry text/ids only. */
export function parseCeilingPass(text: string): CeilingRecord[] {
  // The existing strict wire makes optional fields explicit nulls.
  const raw = JSON.parse(text, (_key, value) => value === null ? undefined : value) as { records: CeilingRecord[] };
  if (!Array.isArray(raw.records)) throw new Error('ceiling_pass_not_a_record_set');
  const ref = (r: Ref | undefined): unknown => {
    if (r === undefined || r === null || typeof r === 'number' || r === 'unresolved') return r;
    if (typeof r !== 'object' || !Number.isInteger(r.sentence) || typeof r.literal !== 'string' || r.literal.length === 0)
      throw new Error('ceiling_quantity_ref_invalid');
    return 'unresolved';
  };
  const base = raw.records.map(r => {
    const { source_literal, is_baseline, range, horizon_figure, ...b } = r;
    if (source_literal !== undefined && (typeof source_literal !== 'string' || source_literal.length === 0)) throw new Error('ceiling_source_literal_invalid');
    if (is_baseline !== undefined && typeof is_baseline !== 'boolean') throw new Error('ceiling_baseline_invalid');
    if (horizon_figure !== undefined && !Number.isInteger(horizon_figure)) throw new Error('ceiling_horizon_invalid');
    return { ...b, role: b.role === 'option' || b.role === 'constraint' ? 'context' : b.role,
      ...(b.quantity_of !== undefined ? { quantity_of: ref(b.quantity_of) } : {}),
      ...(b.relationship !== undefined ? { relationship: { ...b.relationship,
        from_figure: ref(b.relationship.from_figure), to_figure: ref(b.relationship.to_figure) } } : {}) };
  });
  const parsed = parseSentencePassOutput(JSON.stringify({ records: base }));
  if (!parsed.ok) throw new Error(parsed.reason);
  return raw.records.map((r, i) => ({ ...parsed.records[i]!, role: r.role,
    ...(r.source_literal !== undefined ? { source_literal: r.source_literal } : {}),
    ...(r.is_baseline !== undefined ? { is_baseline: r.is_baseline } : {}),
    ...(r.range !== undefined ? { range: r.range } : {}),
    ...(r.horizon_figure !== undefined ? { horizon_figure: r.horizon_figure } : {}),
    ...(r.quantity_of !== undefined && r.quantity_of !== null ? { quantity_of: r.quantity_of } : {}),
    ...(r.relationship !== undefined && r.relationship !== null ? { relationship: r.relationship } : {}) }));
}

/** Claims are retained verbatim, including their original references; no authority is manufactured here. */
export function statedFirstRecords(brief: string, main: DraftRecordSet, pass: readonly CeilingRecord[]): DraftRecordSet {
  const inventory = buildSentenceInventory(brief);
  const sentences = new Map(inventory.sentences.map(s => [s.id, s]));
  const figures = new Map(inventory.figures.map(f => [f.id, f]));
  // Raw wire items include the seam's top-level unresolved tokens; DraftStatedItem is post-seam.
  type WireItem = Pick<DraftStatedItem, 'kind' | 'source_quote'> & Record<string, unknown>;
  const items: WireItem[] = [];
  const indices = new Map<CeilingRecord, number>();
  const declarations = new Map<string, number | null>();
  const key = (r: Ref): string => typeof r === 'object' ? `S${r.sentence}:${r.literal}` : `F${r}`;
  const declare = (k: string, i: number): void => { declarations.set(k, declarations.has(k) ? null : i); };
  const quote = (r: CeilingRecord): string => {
    const s = sentences.get(r.sentence);
    if (s === undefined) throw new Error('ceiling_sentence_unknown');
    if (typeof r.figure === 'number' && figures.get(r.figure)?.sentence !== r.sentence) throw new Error('ceiling_figure_not_in_sentence');
    if (r.source_literal === undefined) return s.text;
    const at = s.text.indexOf(r.source_literal);
    if (at < 0 || at !== s.text.lastIndexOf(r.source_literal)) throw new Error('ceiling_source_literal_not_unique');
    return r.source_literal;
  };
  const identity = (r: Ref | undefined, seen = new Set<number>()): number | 'unresolved' => {
    if (r === undefined || r === 'unresolved') return 'unresolved';
    const at = declarations.get(key(r));
    if (typeof at !== 'number' || seen.has(at)) return 'unresolved';
    const own = pass[at];
    if (own?.quantity_of !== undefined && key(own.quantity_of) !== key(r)) {
      seen.add(at); return identity(own.quantity_of, seen);
    }
    return at;
  };
  // One stable pass-order index per typed record; declarations do not depend on main-call shapes.
  for (const r of pass) {
    const i = items.length; indices.set(r, i);
    const kind = r.role === 'goal' ? 'goal' : r.role === 'option' || r.role === 'option_setting' ? 'option'
      : r.role === 'cause' ? 'cause' : r.role === 'option_effect' ? 'option_effect'
        : r.role === 'constraint' ? 'constraint' : r.kind === 'change_quantity' ? 'change_quantity' : 'figure';
    const item: WireItem = { kind, source_quote: quote(r) };
    for (const field of ['quantity_label', 'value', 'value_literal', 'unit', 'unit_literals', 'value_scale', 'direction', 'direction_literal', 'setting', 'range', 'is_baseline'] as const) {
      if (r[field] !== undefined) item[field] = structuredClone(r[field]);
    }
    if (kind === 'change_quantity') { delete item.value; delete item.range; }
    if (r.role === 'figure') item.role = 'baseline';
    else if (r.role === 'context') item.role = 'context';
    else if (r.role === 'goal') item.role = 'target';
    items.push(item);
    if (r.role !== 'cause' && r.role !== 'option_effect') {
      if (typeof r.figure === 'number') declare(key(r.figure), i);
      if (r.source_literal !== undefined) declare(key({ sentence: r.sentence, literal: r.source_literal }), i);
    }
  }
  // An option naming an increment needs its own declaring change_quantity, as in the existing compile door.
  const optionQuantities = new Map<number, number>();
  for (const r of pass) {
    const i = indices.get(r)!;
    if (items[i]!.kind !== 'option' || r.kind !== 'change_quantity') continue;
    const q = items.length;
    const { value: _v, range: _range, setting: _setting, is_baseline: _baseline, ...declaration } = items[i]!;
    items.push({ ...declaration, kind: 'change_quantity', quantity: q, role: 'context' });
    optionQuantities.set(i, q);
  }
  const quantity = (r: Ref | undefined): number | 'unresolved' => {
    const i = identity(r); return typeof i === 'number' ? optionQuantities.get(i) ?? i : i;
  };
  for (const r of pass) {
    const i = indices.get(r)!, item = items[i]!;
    if (r.role !== 'cause' && r.role !== 'option_effect') {
      if (r.quantity_of !== undefined || typeof r.figure === 'number' || item.kind === 'change_quantity') {
        const q = quantity(r.quantity_of ?? (typeof r.figure === 'number' ? r.figure :
          r.source_literal === undefined ? 'unresolved' : { sentence: r.sentence, literal: r.source_literal }));
        // Use only the existing seam's supported top-level unresolved escape.
        if (typeof q === 'number' || item.kind === 'figure') item.quantity = q;
      }
      if (r.baseline_figure !== undefined) item.baseline_ref = declarations.get(key(r.baseline_figure)) ?? 'unresolved';
      if (r.horizon_figure !== undefined) {
        const h = declarations.get(key(r.horizon_figure));
        if (typeof h === 'number') item.horizon_ref = h;
      }
    }
    if (r.relationship !== undefined) {
      const { from_figure, to_figure, ...rest } = r.relationship;
      const from = quantity(from_figure), to = quantity(to_figure);
      item.relationship = typeof from === 'number' && typeof to === 'number'
        ? { ...structuredClone(rest), from_quantity: from, to_quantity: to } : 'unresolved' as never;
    }
    if (r.role === 'option_effect' && r.option_effect !== undefined) {
      const e = r.option_effect;
      const owners = pass.filter(p => (p.role === 'option' || p.role === 'option_setting') && p.sentence === e.option_sentence && p.source_literal === e.option_literal);
      const q = quantity(e.quantity_figure);
      if (owners.length === 1 && typeof q === 'number') item.option_effect = {
        option: indices.get(owners[0]!)!, quantity: q, [e.setting ?? 'change_by']: e.value,
        value_literal: e.value_literal, ...(e.range !== undefined ? { range: structuredClone(e.range) } : {}) };
    }
  }
  return { stated_items: items as unknown as DraftStatedItem[], claims: structuredClone(main.claims) };
}

/** Mode off returns the identical call objects. Mode on captures the pass but suppresses the old merge. */
export function statedFirstCalls(enabled: boolean, brief: string, main: CallStructuredModel, sentencePass: CallStructuredModel) {
  if (!enabled) return { main, sentencePass, receipt: () => undefined };
  let pass: CeilingRecord[] | undefined;
  let receipt: Record<string, unknown> | undefined;
  return {
    sentencePass: (async req => {
      const out = await sentencePass(req);
      if (out.status !== 'incomplete' && out.text.length > 0) pass = parseCeilingPass(out.text);
      // Empty text is the existing builder's pass-absent arm: the original merge cannot run twice.
      return { ...out, text: '' };
    }) as CallStructuredModel,
    main: (async req => {
      const out = await main(req);
      if (out.status === 'incomplete' || out.text.length === 0 || pass === undefined) return out;
      const raw = JSON.parse(out.text) as DraftRecordSet;
      const records = statedFirstRecords(brief, raw, pass);
      const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
      receipt = { kind: 'CEILING (self-authored)', mode: 'stated-first', main_stated_dropped: raw.stated_items.length,
        pass_records: pass.length, stated_items: records.stated_items.length, claims_kept: records.claims.length,
        claims_byte_identical: JSON.stringify(records.claims) === JSON.stringify(raw.claims),
        original_records_sha256: digest(raw), pass_records_sha256: digest(pass), compiled_input_sha256: digest(records),
        claim_reference_namespace: 'retained original indices; not rebased' };
      return { ...out, text: JSON.stringify(records) };
    }) as CallStructuredModel,
    receipt: () => receipt,
  };
}
