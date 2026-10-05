/** BUILD rows: synthetic sentence shapes, compiled through the existing replay; no drafter/provider calls. */
import { existsSync, readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../grammar.js';
import { replayRecordSet, type ReplaySuccess } from '../replay.js';
import { mergeSentenceLinks } from '../sentence-links.js';
import {
  buildSentenceInventory, buildSentencePassBaseSchema, parseSentencePassOutput, SENTENCE_PASS_INSTRUCTION,
  strictSentencePassSchema, type SentencePassRecord,
} from '../sentence-pass.js';

const GOAL = 'Reach at least 100 attendees.';
const STREET = 'run a street stall';
const HALL = 'run a hall stall';
const EFFECT = 'The hall stall would bring 45 new attendees, between 20 and 70.';
const BRIEF = `${GOAL} We can ${STREET} or ${HALL}. ${EFFECT}`;
const inventory = buildSentenceInventory(BRIEF);
const S = (fragment: string) => inventory.sentences.find(s => s.text.includes(fragment))!.id;
const F = (literal: string) => inventory.figures.find(f => f.literal === literal)!.id;

function main(): DraftRecordSet {
  return {
    stated_items: [
      { kind: 'goal', source_quote: GOAL, value: 100, value_literal: '100', unit: 'attendees', unit_literals: ['attendees'],
        quantity: 0, role: 'target', direction: 'floor', direction_literal: 'at least' },
      { kind: 'option', source_quote: STREET },
      { kind: 'option', source_quote: HALL },
      { kind: 'change_quantity', source_quote: EFFECT, quantity: 3, quantity_label: 'new attendees',
        unit: 'attendees', unit_literals: ['attendees'], value_scale: 'raw_count' },
    ],
    claims: [
      { claim_kind: 'factor', label: 'New attendees', quantity: 3 },
      { claim_kind: 'causal_link', label: 'New attendees contribute to attendance', from_claim: 0, to_stated: 0, effect: 'positive' },
    ],
  };
}

function pass(): SentencePassRecord[] {
  return [
    { sentence: S('would bring'), role: 'context', figure: F('45'), value: 45, value_literal: '45',
      unit: 'attendees', unit_literals: ['attendees'], quantity_of: F('45'), kind: 'change_quantity', quantity_label: 'new attendees' },
    { sentence: S('would bring'), role: 'option_effect', unit: 'attendees', unit_literals: ['attendees'], option_effect: {
      option_sentence: S('We can'), option_literal: HALL, quantity_figure: F('45'), setting: 'change_by', value: 45, value_literal: '45',
      range: { low: 20, high: 70, low_literal: '20', high_literal: '70', meaning: 'min_max' },
    } },
  ];
}

async function compile(records: DraftRecordSet): Promise<ReplaySuccess> {
  const c = await replayRecordSet(records, { brief: BRIEF });
  if (!c.ok) throw new Error(`compile refused: ${c.reason} ${c.detail}`);
  return c;
}
async function merged(records = pass()) {
  const input = main();
  const before = await compile(input);
  const merge = mergeSentenceLinks({ brief: BRIEF, main: input, inventory, pass: records,
    facts: { dropped: before.projection.dropped, dispositions: before.projection.stated_dispositions ?? [] } });
  return { merge, after: await compile(merge.records) };
}
function raw(c: ReplaySuccess, quote: string) {
  const option = c.projection.graph.nodes.find(n => n.kind === 'option' && n.provenance?.source_quote === quote)!;
  const quantity = c.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 3)!;
  return (option.data as { raw_interventions?: Record<string, number> } | undefined)?.raw_interventions?.[quantity.id];
}

describe('BUILD sentence wire: explicit increment and option-bound effect', () => {
  it('roundtrips both shapes through the closed strict schema and null-omitting parser', () => {
    const schema = strictSentencePassSchema();
    const base = buildSentencePassBaseSchema() as { properties: { records: { items: { properties: Record<string, unknown> } } } };
    const nulls = Object.fromEntries(Object.keys(base.properties.records.items.properties).map(key => [key, null]));
    const answer = { records: pass().map(record => ({ ...nulls, ...record })) };
    const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
    expect(validate(answer), JSON.stringify(validate.errors)).toBe(true);
    expect(parseSentencePassOutput(JSON.stringify(answer))).toEqual({ ok: true, records: pass() });
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
      }
      Object.values(node).forEach(v => Array.isArray(v) ? v.forEach(walk) : walk(v));
    };
    walk(schema);
  });

  it('requires the nested option binding and rejects a stock kind or a second carrier', () => {
    const missingBinding = structuredClone(pass());
    delete (missingBinding[1]!.option_effect as Partial<NonNullable<SentencePassRecord['option_effect']>>).option_sentence;
    expect(parseSentencePassOutput(JSON.stringify({ records: missingBinding }))).toEqual({ ok: false, reason: 'sentence_pass_not_a_record_set' });
    expect(parseSentencePassOutput(JSON.stringify({ records: [{ ...pass()[0], kind: 'stock' }] })).ok).toBe(false);
    expect(parseSentencePassOutput(JSON.stringify({ records: [{ ...pass()[1], intervention_range: { low: 20, high: 70 } }] })).ok).toBe(false);
  });

  it('has one general instruction rule per field, with no numeric or brief example', () => {
    const fieldNames = ['sentence', 'kind', 'quantity_label', 'role', 'figure', 'value', 'value_literal', 'unit', 'unit_literals',
      'value_scale', 'quantity_of', 'direction', 'direction_literal', 'baseline_figure', 'setting', 'option_effect',
      'option_sentence', 'option_literal', 'quantity_figure', 'relationship', 'from_figure', 'to_figure', 'per_source_change',
      'per_source_literal', 'amount', 'amount_literal', 'range', 'no_effect_literal'];
    for (const field of fieldNames) expect(SENTENCE_PASS_INSTRUCTION.match(new RegExp(`^${field}:`, 'gm'))).toHaveLength(1);
    expect(SENTENCE_PASS_INSTRUCTION).not.toMatch(/\d/);
    expect(new Set([...SENTENCE_PASS_INSTRUCTION.matchAll(/"([^"]*)"/g)].map(m => m[1]))).toEqual(new Set(['unresolved']));
    const runs = (text: string) => {
      const words = text.toLowerCase().match(/[a-z£%]+/g) ?? [];
      return new Set(words.slice(0, Math.max(0, words.length - 3)).map((_, i) => words.slice(i, i + 4).join(' ')));
    };
    const d = '/Users/paulslee/Documents/GitHub/output/olumi-aie-eval-executor-20261003/drafting-extraction-20261004';
    const briefs = [`${d}/live-draws-20261004/sealed.txt`, `${d}/heldout-20261004/brief-1.txt`,
      `${d}/heldout-20261004/brief-2.txt`, `${d}/heldout-20261004/brief-3-a994c38a.txt`];
    const instructionRuns = runs(SENTENCE_PASS_INSTRUCTION);
    for (const brief of [BRIEF, ...briefs.filter(existsSync).map(file => readFileSync(file, 'utf8'))]) {
      expect([...runs(brief)].filter(run => instructionRuns.has(run))).toEqual([]);
    }
    expect([...runs(`${SENTENCE_PASS_INSTRUCTION} ${EFFECT}`)].filter(run => runs(EFFECT).has(run)).length).toBeGreaterThan(0);
  });
});

describe('BUILD cross-sentence option effect merge and replay', () => {
  it('binds the precise option quote span and compiles its value and raw range', async () => {
    const { merge, after } = await merged();
    expect(merge.records.stated_items.find(item => item.kind === 'option_effect')).toMatchObject({
      source_quote: EFFECT, option_effect: { option: 2, quantity: 3, change_by: 45,
        range: { low: 20, high: 70, meaning: 'min_max' } },
    });
    expect(raw(after, HALL)).toBe(45);
    expect(raw(after, STREET)).toBeUndefined();
    const quantity = after.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 3)!;
    expect(quantity.label).toBe('new attendees');
    expect(quantity.body).toBe('a change from today, so today = 0');
    expect(quantity.observed_state?.raw_value).toBe(0);
    const option = after.projection.graph.nodes.find(n => n.provenance?.source_quote === HALL)!;
    expect((option.data as { intervention_details?: Record<string, unknown> } | undefined)?.intervention_details?.[quantity.id]).toMatchObject({
      raw_value: 45, change_by: 45, unit: 'attendees', source: 'brief_extraction',
      range: { low: 20, high: 70, meaning: 'min_max', source: 'brief_extraction', source_quote: EFFECT },
    });
    const control = await merged(pass().slice(0, 1));
    expect(after.projection.graph.edges.map(e => [e.from, e.to]).sort()).toEqual(control.after.projection.graph.edges.map(e => [e.from, e.to]).sort());
    expect(after.projection.graph.edges.filter(e => e.from === after.projection.graph.nodes.find(n => n.provenance?.source_quote === HALL)!.id)).toEqual([]);
  });

  it('compiles change_by as a shift from the typed increment\'s zero today', async () => {
    const records = pass();
    records[1]!.option_effect!.setting = 'change_by';
    const { merge, after } = await merged(records);
    expect(merge.records.stated_items.find(item => item.kind === 'option_effect')?.option_effect).toMatchObject({ option: 2, quantity: 3, change_by: 45 });
    expect(raw(after, HALL)).toBe(45);
    const quantity = after.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 3)!;
    const option = after.projection.graph.nodes.find(n => n.provenance?.source_quote === HALL)!;
    expect((option.data as { intervention_details?: Record<string, unknown> } | undefined)?.intervention_details?.[quantity.id]).toMatchObject({
      raw_value: 45, change_by: 45, range: { low: 20, high: 70, meaning: 'min_max' },
    });
  });

  it('defaults a typed effect to change_by when the setting is omitted', async () => {
    const records = pass();
    delete records[1]!.option_effect!.setting;
    expect(parseSentencePassOutput(JSON.stringify({ records })).ok).toBe(true);
    const { merge, after } = await merged(records);
    expect(merge.records.stated_items.find(item => item.kind === 'option_effect')?.option_effect).toMatchObject({ option: 2, quantity: 3, change_by: 45 });
    const quantity = after.projection.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 3)!;
    const option = after.projection.graph.nodes.find(n => n.provenance?.source_quote === HALL)!;
    expect((option.data as { intervention_details?: Record<string, unknown> } | undefined)?.intervention_details?.[quantity.id]).toMatchObject({ raw_value: 45, change_by: 45 });
  });

  it('leaves no intervention when the option binding is omitted', async () => {
    const records = pass();
    delete records[1]!.option_effect;
    const { merge, after } = await merged(records);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ role: 'option_effect', reason: 'option_binding_missing' }));
    expect(merge.fills.some(fill => fill.field === 'option_effect')).toBe(false);
    expect(raw(after, HALL)).toBeUndefined();
    expect(raw(after, STREET)).toBeUndefined();
  });

  it('keeps an unresolved quantity as a refusal rather than borrowing another figure', async () => {
    const records = pass();
    records[1]!.option_effect!.quantity_figure = 'unresolved';
    const { merge, after } = await merged(records);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ reason: 'endpoint_unresolved' }));
    expect(raw(after, HALL)).toBeUndefined();
  });

  it.each([
    ['both options in one quote span', `${STREET} or ${HALL}`, S('We can')],
    ['a label-sized fragment outside the option quote span', 'hall stall', S('We can')],
    ['an option literal assigned to the effect sentence', HALL, S('would bring')],
  ])('refuses %s', async (_name, literal, sentence) => {
    const records = pass();
    records[1]!.option_effect!.option_literal = literal;
    records[1]!.option_effect!.option_sentence = sentence;
    const { merge, after } = await merged(records);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ reason: 'option_binding_missing' }));
    expect(raw(after, HALL)).toBeUndefined();
    expect(raw(after, STREET)).toBeUndefined();
  });

  it('uses the existing quote validator when a located literal carries the wrong number', async () => {
    const records = pass();
    records[1]!.option_effect!.value = 46;
    const { merge, after } = await merged(records);
    expect(merge.fills).toContainEqual(expect.objectContaining({ field: 'option_effect' }));
    expect(raw(after, HALL)).toBeUndefined();
    expect(after.projection.dropped).toContainEqual(expect.objectContaining({ reason: 'option_effect_invalid' }));
  });
});
