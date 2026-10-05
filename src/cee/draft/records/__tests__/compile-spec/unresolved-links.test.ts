/**
 * FIX (a): THE v-next LINKING FIELDS ARE REQUIRED, WITH A TYPED 'unresolved'.
 *
 * The live 3×3 (a6617c31) failed because the strict schema let the drafter leave its linking fields null — goal
 * direction 15/15, goal unit 9/15, goal baseline_ref 8/15, figure quantity 22/64, cause relationship 25/58 — and null
 * was the easy path. These rows run the REAL `buildModelFromRecords` with the model text stubbed to an authored STRICT
 * WIRE (validated against the schema the request sends), so each one exercises: strict schema → omitOptionalRecordNulls
 * → seam decode → projector → receipt → open questions.
 */
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { buildModelFromRecords, buildStrictDraftRecordsSchema, omitOptionalRecordNulls } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { strictRecordsWire } from '../../../../../orchestrator-v5/agent-lane/__tests__/records-wire-fixture.js';
import { buildDraftRecordsSchema, buildVNextDraftRecordsSchema, DRAFT_RECORD_STATED_KINDS, type DraftRecordSet } from '../../grammar.js';
import { decodeUnresolvedLinks, projectDraftRecords } from '../../seam.js';
import { V_NEXT_DRAFT_RECORDS_INSTRUCTION } from '../../instruction-vnext.js';
import { BRIEF, sealedRecordsVNext, sealedRecordsVNextLinked } from './sealed-fixture-vnext.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
type Json = Record<string, any>;
const validate = new Ajv({ strict: false, allErrors: true }).compile(buildStrictDraftRecordsSchema());

/** The served constructor, offline: the model text is `text`; the register body is captured. */
async function construct(text: string) {
  let body: Json | undefined;
  const result: Json = await buildModelFromRecords(SCENARIO, BRIEF,
    async (path, b) => { if (path.endsWith('/register')) { body = b as Json; return { status: 200, json: { model_version: 1 } }; } return { status: 200, json: { graph: { nodes: [], edges: [] } } }; },
    async () => ({ text, status: 'completed' }));
  return { result, body };
}
/** The linked sealed ideal as the provider must emit it, with one link replaced by the typed escape. */
function wireWith(index: number, field: string): Json {
  const wire = structuredClone(strictRecordsWire(sealedRecordsVNextLinked())) as Json;
  wire.stated_items[index][field] = 'unresolved';
  return wire;
}
const variants = (): Json[] => ((buildStrictDraftRecordsSchema() as Json).properties.stated_items.items.anyOf as Json[]);
const variantOf = (kind: string): Json => variants().find(v => v.properties.kind.enum.includes(kind))!;
const acceptsNull = (node: Json): boolean => node.type === 'null' || (node.anyOf ?? []).some((b: Json) => b.type === 'null');
const acceptsUnresolved = (node: Json): boolean => (node.enum ?? []).includes('unresolved') || (node.anyOf ?? []).some((b: Json) => (b.enum ?? []).includes('unresolved'));

/**
 * The brief's six links, HAND-WRITTEN (never derived from `DRAFT_RECORD_REQUIRED_LINKS`, so a field dropped from the
 * implementation REDs here instead of silently dropping its row). One stated item per owning kind, from the sealed
 * ideal: the goal (6), a figure (1, "400 customers"), a cause (10).
 */
const OWNED: Record<string, readonly string[]> = { goal: ['direction', 'direction_literal', 'unit', 'baseline_ref'], figure: ['quantity'], cause: ['relationship'] };
const OWNER_INDEX: Record<string, number> = { goal: 6, figure: 1, cause: 10 };
const ROWS = Object.entries(OWNED).flatMap(([kind, fields]) => fields.map(field => ({ kind, field, index: OWNER_INDEX[kind]! })));
/** The question words each field asks for (completion.ts UNRESOLVED_LINK_ASKS), bound per field. */
const ASK_WORDS: Record<string, string> = {
  direction: 'whether it is a floor (at least) or a ceiling (at most)',
  direction_literal: 'whether it is a floor (at least) or a ceiling (at most)',
  unit: 'the unit it is measured in', baseline_ref: 'its current level', quantity: 'which quantity it measures',
  relationship: 'which quantities it links, and by how much',
};

describe('fix (a) strict conformance', () => {
  it('pins the v-next strict grammar old → new; Anthropic and the unstrict v-next builder are byte-unchanged', () => {
    // Was bb80316bf26f949811519dfda149d78661e1b4d322f63f34ef22bf960238db21 (5402 bytes, the live 3×3's served schema).
    expect(sha(JSON.stringify(buildStrictDraftRecordsSchema()))).toBe('8f9cdd49ae03787c0aacdfc4b6b887450f8eb1e4715db1ef3bea58b8adff3ba3');
    expect(sha(JSON.stringify(buildDraftRecordsSchema()))).toBe('9509011c6d6a00b848fba53bf666adce0b0f0193f081d82be97195625449ea8b');
    expect(sha(JSON.stringify(buildVNextDraftRecordsSchema()))).toBe('a187e7ffcf162a0f0317f2cb3af74faee249f2cdd3641535a3d643bdf12c979c');
  });
  it('every object requires every property and forbids additional ones, in every kind variant', () => {
    let objects = 0;
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const s = node as Json;
      if (s.type === 'object') { objects += 1; expect(s.additionalProperties).toBe(false); expect(s.required).toEqual(Object.keys(s.properties)); }
      Object.values(s).forEach(walk);
    };
    walk(buildStrictDraftRecordsSchema());
    expect(objects).toBeGreaterThan(8); // positive control: the walk reaches the variants
  });
  it('one variant per owning kind plus one for the rest; together they cover every stated kind exactly once', () => {
    const kinds = variants().map(v => v.properties.kind.enum as string[]);
    expect(kinds).toEqual([['goal'], ['figure'], ['cause'], DRAFT_RECORD_STATED_KINDS.filter(k => !['goal', 'figure', 'cause'].includes(k))]);
    expect(kinds.flat().sort()).toEqual([...DRAFT_RECORD_STATED_KINDS].sort());
    const keys = variants().map(v => Object.keys(v.properties));
    for (const k of keys) expect(k).toEqual(keys[0]);
  });
  for (const { kind, field } of ROWS) {
    it(`${kind}.${field} is required and NON-NULL with the typed escape; the real type is kept`, () => {
      const node = variantOf(kind).properties[field];
      expect(acceptsNull(node)).toBe(false);
      expect(acceptsUnresolved(node)).toBe(true);
      const base = variantOf('option').properties[field];
      const real = (base.anyOf as Json[]).find(b => b.type !== 'null')!;
      if (Array.isArray(real.enum)) expect(node).toEqual({ ...real, enum: [...real.enum, 'unresolved'] });
      else expect(node).toEqual({ anyOf: [real, { type: 'string', enum: ['unresolved'] }] });
    });
  }
  it('CONTRAST every other field on every variant keeps the base nullable shape and has no escape', () => {
    const rest = variantOf('option').properties;
    for (const v of variants()) {
      const owned: readonly string[] = OWNED[v.properties.kind.enum[0]] ?? [];
      for (const [key, node] of Object.entries(v.properties as Json)) {
        if (key === 'kind' || owned.includes(key)) continue;
        expect(node, `${v.properties.kind.enum}.${key}`).toEqual(rest[key]);
        expect(acceptsUnresolved(node as Json), `${v.properties.kind.enum}.${key}`).toBe(false);
      }
    }
  });
  it('the provider schema refuses null on each required link and the escape on a non-owning kind', () => {
    const linked = strictRecordsWire(sealedRecordsVNextLinked()) as Json;
    expect(validate(linked), JSON.stringify(validate.errors)).toBe(true);
    for (const { field, index } of ROWS) {
      const nulled = structuredClone(linked); nulled.stated_items[index][field] = null;
      expect(validate(nulled), `${field} null`).toBe(false);
      expect(validate(wireWith(index, field)), `${field} unresolved`).toBe(true);
    }
    const option = structuredClone(linked); option.stated_items[3].quantity = 'unresolved';
    expect(validate(option)).toBe(false);
  });
});

describe('fix (a) the sealed ideal, every link stated, is unchanged through the served constructor', () => {
  it('the linked wire decodes to the linked records and compiles to the SAME registered graph, receipt and questions', async () => {
    const wire = strictRecordsWire(sealedRecordsVNextLinked());
    expect(omitOptionalRecordNulls(wire)).toEqual(sealedRecordsVNextLinked());
    const linked = await construct(JSON.stringify(wire));
    const ideal = await construct(JSON.stringify(sealedRecordsVNext()));
    expect(linked.result.ok, JSON.stringify(linked.result)).toBe(true);
    expect(JSON.stringify(linked.body!.graph)).toBe(JSON.stringify(ideal.body!.graph));
    expect(linked.body!.stated_dispositions.map((d: Json) => [d.stated_index, d.disposition, d.reason]))
      .toEqual(ideal.body!.stated_dispositions.map((d: Json) => [d.stated_index, d.disposition, d.reason]));
    expect(linked.result.open_questions).toEqual(ideal.result.open_questions);
    expect(linked.result.not_represented.some((d: Json) => d.reason === 'link_unresolved')).toBe(false);
  });
  it('the real values still bind: the goal direction (floor + "at least"), baseline, unit, the figure and the cause', async () => {
    const { result, body } = await construct(JSON.stringify(strictRecordsWire(sealedRecordsVNextLinked())));
    expect(result.ok).toBe(true);
    const goal = body!.graph.nodes.find((n: Json) => n.kind === 'goal');
    expect(goal).toMatchObject({ goal_direction: '>=', goal_threshold_unit: '£/month', observed_state: { raw_value: 120000 } });
    const rows = body!.stated_dispositions as Json[];
    expect(rows.find(d => d.stated_index === 6)).toMatchObject({ disposition: 'carried' });
    expect(rows.find(d => d.stated_index === 10)).toMatchObject({ disposition: 'carried', location: { path: ['provenance', 'natural_effect'] } });
    expect(rows.find(d => d.stated_index === 1)?.disposition).not.toBe('asked');
  });
});

describe("fix (a) each required link's 'unresolved' is a TYPED ASK — never a guess, never a silent drop", () => {
  for (const { kind, field, index } of ROWS) {
    it(`${kind}.${field} 'unresolved' → a link_unresolved row, an asked receipt and an open question naming the item`, async () => {
      const wire = wireWith(index, field);
      expect(validate(wire), JSON.stringify(validate.errors)).toBe(true);
      const quote = sealedRecordsVNextLinked().stated_items[index]!.source_quote;
      const { result, body } = await construct(JSON.stringify(wire));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      // The disclosure, typed and bound to the item's index and the field.
      expect(result.not_represented).toContainEqual(expect.objectContaining({ stated_index: index, reason: 'link_unresolved', unresolved_field: field, label: quote }));
      // The clarification row: the receipt asks about THIS item, and its decoded item names the field.
      const row = (body!.stated_dispositions as Json[]).find(d => d.stated_index === index)!;
      expect(row).toMatchObject({ disposition: 'asked', reason: 'link_unresolved', stated_item: { source_quote: quote, unresolved: [field] } });
      expect(row.stated_item).not.toHaveProperty(field);
      // The open question names the item by its own words and asks for the field.
      const questions = (result.open_questions as string[]).filter(q => q.includes(`"${quote}"`));
      expect(questions).toHaveLength(1);
      expect(questions[0]).toContain(ASK_WORDS[field]);
      // Never a value: the token reaches no stored byte.
      expect(JSON.stringify(body!.graph)).not.toContain('unresolved');
    });
  }
  it('goal direction: "floor" + literal binds >=; "unresolved" leaves goal_direction unset and asks', async () => {
    const bound = await construct(JSON.stringify(strictRecordsWire(sealedRecordsVNextLinked())));
    expect(bound.body!.graph.nodes.find((n: Json) => n.kind === 'goal').goal_direction).toBe('>=');
    for (const field of ['direction', 'direction_literal']) {
      const asked = await construct(JSON.stringify(wireWith(6, field)));
      expect(asked.body!.graph.nodes.find((n: Json) => n.kind === 'goal').goal_direction, field).toBeUndefined();
    }
  });
  it('goal baseline_ref "unresolved" stores no baseline (base: 120000 from its reference)', async () => {
    const { body } = await construct(JSON.stringify(wireWith(6, 'baseline_ref')));
    const goal = body!.graph.nodes.find((n: Json) => n.kind === 'goal');
    expect(goal.observed_state?.raw_value).toBeUndefined();
  });
  it('cause relationship "unresolved" carries no natural effect for that cause', async () => {
    const { body } = await construct(JSON.stringify(wireWith(10, 'relationship')));
    const quote = sealedRecordsVNextLinked().stated_items[10]!.source_quote;
    expect((body!.graph.edges as Json[]).some(e => e.provenance?.source_quote === quote && e.provenance?.natural_effect !== undefined)).toBe(false);
  });
  it('several links on one item: one question naming each, direction words once', async () => {
    const wire = wireWith(6, 'direction'); wire.stated_items[6].direction_literal = 'unresolved'; wire.stated_items[6].baseline_ref = 'unresolved';
    const { result } = await construct(JSON.stringify(wire));
    const quote = sealedRecordsVNextLinked().stated_items[6]!.source_quote;
    expect(result.not_represented.filter((d: Json) => d.reason === 'link_unresolved').map((d: Json) => d.unresolved_field)).toEqual(['direction', 'direction_literal', 'baseline_ref']);
    const questions = (result.open_questions as string[]).filter(q => q.includes(`"${quote}"`));
    expect(questions).toHaveLength(1);
    expect(questions[0]!.split(ASK_WORDS.direction!)).toHaveLength(2);
    expect(questions[0]).toContain(ASK_WORDS.baseline_ref);
  });
});

describe('fix (a) the seam decode is kind-scoped and pure', () => {
  it('decodes only on the owning kind and never mutates its input', () => {
    const raw = omitOptionalRecordNulls(wireWith(6, 'unit')) as Json;
    const before = JSON.stringify(raw);
    const decoded = decodeUnresolvedLinks(raw) as Json;
    expect(JSON.stringify(raw)).toBe(before);
    expect(decoded.stated_items[6]).toMatchObject({ unresolved: ['unit'] });
    expect(decoded.stated_items[6]).not.toHaveProperty('unit');
    const plain = sealedRecordsVNextLinked();
    expect(decodeUnresolvedLinks(plain)).toBe(plain);
  });
  it('CONTRAST the token on a non-owning kind is not an ask: an option quantity "unresolved" is refused as before', () => {
    const records = sealedRecordsVNextLinked() as unknown as Json; records.stated_items[3].quantity = 'unresolved';
    const seam = projectDraftRecords(records as DraftRecordSet, BRIEF);
    expect(seam).toMatchObject({ ok: false, reason: 'not_a_record_set' });
  });
});

describe('fix (a) instruction: one general line, generic, and the goal direction rule', () => {
  it('states the escape and the per-field set rules without a domain example', () => {
    const flat = V_NEXT_DRAFT_RECORDS_INSTRUCTION.replace(/\s+/g, ' ');
    expect(flat).toContain('A link you cannot state from the brief is "unresolved", never left empty.');
    expect(flat).toContain('The goal item types direction: "floor" when the user wants the quantity at or above the value, "ceiling" when at or below.');
    expect(flat).toContain('Every figure sets quantity');
    expect(flat).toContain('Every cause sets relationship');
    expect(flat).toContain('sets baseline_ref to the quoted baseline item of the same quantity');
  });
});
