/**
 * SENTENCE-PASS MERGE — rows (c) precedence, (d) adversarial, (f) determinism, (g) never-worse, and the DL/PL amend-2
 * binding rows (1: a cross-sentence cause; 3: a negated clause becomes typed no-effect), each with a contrast.
 * The brief here is SYNTHETIC (written for these rows, not a test brief). The merged set is always judged by the SAME
 * compile (`replayRecordSet`); a row never asserts what the merge "would" carry, only what the compile carried.
 */
import { describe, expect, it } from 'vitest';
import { replayDigest, replayRecordSet, type ReplaySuccess } from '../replay.js';
import { mergeSentenceLinks, neverWorse } from '../sentence-links.js';
import type { DraftRecordSet } from '../grammar.js';
import { F, S, SYN, inventory, synMain, synPass } from './fixtures/sentence-pass-syn.js';

async function compile(records: DraftRecordSet): Promise<ReplaySuccess> {
  const out = await replayRecordSet(records, { brief: SYN });
  if (!out.ok) throw new Error(`compile refused: ${out.reason} ${out.detail}`);
  return out;
}
async function merged(main = synMain(), pass = synPass()) {
  const compiled = await compile(main);
  const merge = mergeSentenceLinks({ brief: SYN, main, inventory, pass,
    facts: { dropped: compiled.projection.dropped, dispositions: compiled.projection.stated_dispositions ?? [] } });
  return { main: compiled, merge, after: await compile(merge.records) };
}
const disposition = (c: ReplaySuccess, index: number) => c.projection.stated_dispositions!.find((d) => d.stated_index === index)!;
const reasonsAt = (c: ReplaySuccess, index: number) => c.projection.dropped.filter((d) => (d as { stated_index?: number }).stated_index === index).map((d) => d.reason);
const statedEdge = (c: ReplaySuccess, quote: string) => (c.graph as { edges: Array<{ provenance?: { source_quote?: string; natural_effect?: unknown } }> })
  .edges.find((e) => e.provenance?.source_quote === quote);

describe('(c) precedence', () => {
  it('fills a typed-unresolved goal direction with the pass floor + its located comparator (in place)', async () => {
    const { main, merge, after } = await merged();
    expect(reasonsAt(main, 0)).toContain('link_unresolved');
    expect(merge.fills).toContainEqual(expect.objectContaining({ stated_index: 0, field: 'direction', mode: 'in_place' }));
    expect(merge.records.stated_items[0]).toMatchObject({ direction: 'floor', direction_literal: 'at least' });
    expect(reasonsAt(after, 0)).not.toContain('link_unresolved');
  });
  it('a compiled main link is NEVER overwritten: a carried item the pass disagrees with is a receipt only', async () => {
    const main = synMain();
    // The main typed the barista cause itself; it compiled and was carried.
    main.stated_items[5]!.relationship = { from_quantity: 2, to_quantity: 1, per_source_change: 1, per_source_literal: 'Each extra barista', amount: 450, amount_literal: '£450' };
    const pass = synPass();
    pass[1]!.relationship!.amount = 400; // the pass disagrees
    const { main: before, merge } = await merged(main, pass);
    expect(disposition(before, 5).disposition).toBe('carried');
    expect(merge.records.stated_items[5]!.relationship).toEqual(main.stated_items[5]!.relationship);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ stated_index: 5, reason: 'main_link_compiled' }));
  });
  it('a TYPED goal direction is never overwritten: the pass disagreeing is a receipt only', async () => {
    const main = synMain();
    Object.assign(main.stated_items[0]!, { direction: 'floor', direction_literal: 'at least' });
    const pass = synPass();
    pass[0] = { ...pass[0]!, direction: 'ceiling' };
    const { merge } = await merged(main, pass);
    expect(merge.records.stated_items[0]).toMatchObject({ direction: 'floor', direction_literal: 'at least' });
    expect(merge.refusals).toContainEqual(expect.objectContaining({ stated_index: 0, field: 'direction', reason: 'main_link_compiled' }));
  });
  it('an absent optional link (an option with no setting) is neither unresolved nor refused, so it is not filled', async () => {
    const main = synMain();
    delete main.stated_items[3]!.value; delete main.stated_items[3]!.value_literal; delete main.stated_items[3]!.quantity; delete main.stated_items[3]!.setting;
    const pass = [...synPass(), { sentence: S('We could hire'), role: 'option_setting' as const, figure: F('1'), value: 1, value_literal: '1', quantity_of: F('2'), setting: 'change_by' as const }];
    const { merge } = await merged(main, pass);
    expect(merge.records.stated_items[3]).toEqual(main.stated_items[3]);
  });
});

describe('BINDING 1: a cross-sentence cause (its endpoints are declared in another sentence)', () => {
  it('the barista cause (S4) links the S1 barista and takings quantities by figure id; the compile mints the stated effect', async () => {
    const { main, merge, after } = await merged();
    expect(reasonsAt(main, 5)).toContain('link_unresolved');
    expect(merge.records.stated_items[5]!.relationship).toMatchObject({ from_quantity: 2, to_quantity: 1, amount: 450, per_source_change: 1 });
    expect(disposition(after, 5).disposition).toBe('carried');
    expect(JSON.stringify(after.graph)).toContain('"amount":450');
  });
  it('contrast: the same cause with its source endpoint "unresolved" is refused by the merge and stays a typed ask', async () => {
    const pass = synPass();
    pass[1]!.relationship!.from_figure = 'unresolved';
    const { merge, after } = await merged(synMain(), pass);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ stated_index: 5, reason: 'endpoint_unresolved' }));
    expect(reasonsAt(after, 5)).toContain('link_unresolved');
    expect(JSON.stringify(after.graph)).not.toContain('"amount":450');
  });
});

describe('BINDING 3: a negated clause is carried as typed no-effect, never a positive link', () => {
  it('"will not change" becomes relationship.no_effect_literal with no amount and no range; the compile draws no edge', async () => {
    const { merge, after } = await merged();
    expect(merge.records.stated_items[6]!.relationship).toEqual({ from_quantity: expect.any(Number), to_quantity: 1, no_effect_literal: 'will not change' });
    expect(disposition(after, 6).disposition).not.toBe('carried');
    expect(reasonsAt(after, 6).length).toBeGreaterThan(0);
    expect(statedEdge(after, 'Changing the price of a cup will not change the cups we sell.')).toBeUndefined();
  });
  it('contrast: the same clause typed with an amount is not a no-effect (the compile refuses the contradiction)', async () => {
    const pass = synPass();
    pass[2]!.relationship = { ...pass[2]!.relationship!, amount: 10 };
    const { merge, after } = await merged(synMain(), pass);
    expect(merge.records.stated_items[6]!.relationship).toMatchObject({ no_effect_literal: 'will not change', amount: 10 });
    expect(reasonsAt(after, 6)).toContain('no_effect_with_amount');
  });
});

describe('(d) adversarial: the existing validators refuse what the pass gets wrong', () => {
  it('a literal from another sentence cannot be placed (not in the main quote, not in its own sentence)', async () => {
    const pass = synPass();
    pass[1]!.relationship!.amount_literal = '£7,500';
    const { merge, after } = await merged(synMain(), pass);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ stated_index: 5, reason: 'literal_not_in_sentence' }));
    expect(reasonsAt(after, 5)).toContain('link_unresolved');
  });
  it('a wrong unit never aligns to a main quantity that declares another unit', async () => {
    const pass = synPass();
    pass[0] = { ...pass[0]!, unit: '£/month' };
    const { merge } = await merged(synMain(), pass);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ reason: 'unit_mismatch' }));
    expect(merge.fills.some((f) => f.stated_index === 0)).toBe(false);
  });
  it('a wrong figure id (a figure of another sentence) is refused before any alignment', async () => {
    const pass = synPass();
    pass[0] = { ...pass[0]!, figure: F('£450') };
    const { merge } = await merged(synMain(), pass);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ reason: 'figure_not_in_sentence' }));
  });
  it('a mistyped amount reaches the compile and the compile refuses it (literal_value_mismatch), no stated edge', async () => {
    const pass = synPass();
    pass[1]!.relationship!.amount = 45;
    const { merge, after } = await merged(synMain(), pass);
    expect(merge.fills).toContainEqual(expect.objectContaining({ stated_index: 5, field: 'relationship' }));
    expect(reasonsAt(after, 5)).toContain('literal_value_mismatch');
    expect(disposition(after, 5).disposition).not.toBe('carried');
  });
});

describe('(f) determinism and control', () => {
  it('the merged compile is byte-identical on repeat', async () => {
    const a = await merged(); const b = await merged();
    expect(JSON.stringify(a.merge)).toBe(JSON.stringify(b.merge));
    expect(replayDigest(a.after)).toBe(replayDigest(b.after));
  });
  it('an empty pass changes nothing: the merged set IS the main set and compiles to the same digest', async () => {
    const { main, merge, after } = await merged(synMain(), []);
    expect(merge.fills).toEqual([]);
    expect(merge.records).toEqual(synMain());
    expect(replayDigest(after)).toBe(replayDigest(main));
  });
});

describe('(g) never-worse gate', () => {
  it('passes when every carried index stays carried; refuses, naming the index, when one is lost', () => {
    const main = [{ stated_index: 0, disposition: 'carried' }, { stated_index: 1, disposition: 'asked' }];
    expect(neverWorse(main, [{ stated_index: 0, disposition: 'carried' }, { stated_index: 1, disposition: 'carried' }])).toEqual({ ok: true });
    expect(neverWorse(main, [{ stated_index: 0, disposition: 'rejected' }, { stated_index: 1, disposition: 'carried' }])).toEqual({ ok: false, lost: [0] });
    expect(neverWorse(main, [])).toEqual({ ok: false, lost: [0] });
  });
  it('on the synthetic brief the merge loses nothing the main carried', async () => {
    const { main, after } = await merged();
    expect(neverWorse(main.projection.stated_dispositions!, after.projection.stated_dispositions!)).toEqual({ ok: true });
  });
});
