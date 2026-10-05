/**
 * SENTENCE PASS — rows (a) selection, (e) import graph, and the instruction's no-example rule
 * (design output/model-construction-20261004/DESIGN-SENTENCE-PASS.md §6). Held-out briefs are read from the eval
 * estate when present (LOCAL-ONLY rows: they are never copied into this repo); the sealed brief is the repo's own.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { BRIEF as SEALED } from './compile-spec/sealed-fixture.js';
import {
  buildSentenceInventory, parseSentencePassOutput, renderSentencePassInput, sentencePassSelected, SENTENCE_PASS_INSTRUCTION,
} from '../sentence-pass.js';
import { buildStrictSentencePassSchema } from '../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { strictForTheDrafter } from '../../../../orchestrator-v5/agent-lane/runtime/build-model.js';

const linksSource = readFileSync(new URL('../sentence-links.ts', import.meta.url), 'utf8');
const HELDOUT = '/Users/paulslee/Documents/GitHub/output/olumi-aie-eval-executor-20261003/drafting-extraction-20261004/heldout-20261004';
const heldout = (name: string): string | undefined => {
  const file = `${HELDOUT}/${name}`;
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
};
const LOCAL = { b1: heldout('brief-1.txt'), b2: heldout('brief-2.txt'), b3: heldout('brief-3-a994c38a.txt') };
const local = LOCAL.b1 !== undefined && LOCAL.b2 !== undefined && LOCAL.b3 !== undefined;

const counts = (brief: string) => {
  const inv = buildSentenceInventory(brief);
  return { sentences: inv.sentences.length, withFigure: new Set(inv.figures.map((f) => f.sentence)).size, selected: sentencePassSelected(inv) };
};

describe('(a) selection: segmentSentences x findStatedAmounts', () => {
  it('sealed: 10 sentences, 9 with a figure; "Keeping pricing as it is adds nothing." has none', () => {
    expect(counts(SEALED)).toEqual({ sentences: 10, withFigure: 9, selected: true });
    const inv = buildSentenceInventory(SEALED);
    const keep = inv.sentences.find((s) => s.text === 'Keeping pricing as it is adds nothing.');
    expect(keep).toBeDefined();
    expect(inv.figures.some((f) => f.sentence === keep!.id)).toBe(false);
  });
  it.skipIf(!local)('LOCAL-ONLY held-out: brief-1 11/8, brief-2 12/9, brief-3 1/0 (no call)', () => {
    expect(counts(LOCAL.b1!)).toEqual({ sentences: 11, withFigure: 8, selected: true });
    expect(counts(LOCAL.b2!)).toEqual({ sentences: 12, withFigure: 9, selected: true });
    expect(counts(LOCAL.b3!)).toEqual({ sentences: 1, withFigure: 0, selected: false });
  });
  it('offsets round-trip: every sentence and figure id maps back to its own brief bytes', () => {
    for (const brief of [SEALED, ...(local ? [LOCAL.b1!, LOCAL.b2!] : [])]) {
      const inv = buildSentenceInventory(brief);
      for (const s of inv.sentences) expect(brief.slice(s.start, s.end)).toBe(s.text);
      for (const f of inv.figures) {
        expect(brief.slice(f.start, f.end)).toBe(f.literal);
        const s = inv.sentences.find((x) => x.id === f.sentence)!;
        expect(f.start >= s.start && f.end <= s.end).toBe(true);
      }
      expect(inv.figures.map((f) => f.id)).toEqual(inv.figures.map((_, i) => i + 1));
    }
  });
  it('a decimal is one figure and never a sentence break; "B2B" is not a figure (contrast: a bare count is)', () => {
    const inv = buildSentenceInventory('We are a B2B shop with 3 staff. We charge £0.80 per cup. Sales are steady.');
    expect(inv.sentences.map((s) => s.text)).toEqual(['We are a B2B shop with 3 staff.', 'We charge £0.80 per cup.', 'Sales are steady.']);
    expect(inv.figures.map((f) => f.literal)).toEqual(['3', '£0.80']);
  });
  it('the input is the WHOLE brief plus the id inventory (binding condition 1), and never shows an offset', () => {
    const inv = buildSentenceInventory(SEALED);
    const text = renderSentencePassInput(SEALED, inv);
    expect(text.startsWith(`BRIEF\n${SEALED}\n`)).toBe(true);
    for (const s of inv.sentences) expect(text).toContain(`S${s.id}: ${s.text}`);
    for (const f of inv.figures) expect(text).toContain(`F${f.id}: ${JSON.stringify(f.literal)} in S${f.sentence}`);
    expect(text).not.toMatch(/\[\d+,\s*\d+\)/);
  });
});

describe('the strict wire and the instruction', () => {
  it('the schema is OpenAI-strict (every object closed, every key required) and parses a well-formed answer', () => {
    const schema = buildStrictSentencePassSchema();
    expect(strictForTheDrafter(schema)).toEqual(schema);
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      const s = node as Record<string, unknown>;
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect(s.required).toEqual(Object.keys(s.properties as object));
      }
      for (const value of Object.values(s)) { if (Array.isArray(value)) value.forEach(walk); else walk(value); }
    };
    walk(schema);
    const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
    const nulls = { kind: null, quantity_label: null, option_effect: null, figure: null, value: null, value_literal: null, unit: null, unit_literals: null, value_scale: null, quantity_of: null,
      direction: null, direction_literal: null, baseline_figure: null, setting: null, relationship: null };
    const answer = { records: [
      { ...nulls, sentence: 1, role: 'goal', figure: 2, direction: 'floor', direction_literal: 'at least', baseline_figure: 'unresolved' },
      { ...nulls, sentence: 2, role: 'cause', relationship: { from_figure: 3, to_figure: 'unresolved', amount: null, amount_literal: null,
        range: null, per_source_change: null, per_source_literal: null, no_effect_literal: 'will not change' } },
    ] };
    expect(validate(answer), JSON.stringify(validate.errors)).toBe(true);
    const parsed = parseSentencePassOutput(JSON.stringify(answer));
    expect(parsed).toEqual({ ok: true, records: [
      { sentence: 1, role: 'goal', figure: 2, direction: 'floor', direction_literal: 'at least', baseline_figure: 'unresolved' },
      { sentence: 2, role: 'cause', relationship: { from_figure: 3, to_figure: 'unresolved', no_effect_literal: 'will not change' } },
    ] });
    expect(parseSentencePassOutput('{"records":[{"sentence":1,"role":"verdict"}]}')).toEqual({ ok: false, reason: 'sentence_pass_not_a_record_set' });
    expect(parseSentencePassOutput('not json')).toEqual({ ok: false, reason: 'sentence_pass_unparsable' });
  });

  it('NO EXAMPLE from any test brief: no figure, no quoted text but the typed escape, no shared run of 4+ words', () => {
    const instruction = SENTENCE_PASS_INSTRUCTION;
    expect(instruction).not.toMatch(/\d/);
    expect([...instruction.matchAll(/"([^"]*)"/g)].map((m) => m[1])).toEqual(expect.arrayContaining(['unresolved']));
    expect(new Set([...instruction.matchAll(/"([^"]*)"/g)].map((m) => m[1]))).toEqual(new Set(['unresolved']));
    const words = (s: string) => s.toLowerCase().match(/[a-z£%]+/g) ?? [];
    const runs = (s: string, n: number) => { const w = words(s); return new Set(w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(' '))); };
    const ins = runs(instruction, 4);
    for (const brief of [SEALED, ...(local ? [LOCAL.b1!, LOCAL.b2!, LOCAL.b3!] : [])]) {
      const shared = [...runs(brief, 4)].filter((r) => ins.has(r));
      expect(shared, brief.slice(0, 40)).toEqual([]);
    }
  });

  it('contrast: the no-example probe sees a planted example (positive control)', () => {
    const planted = `${SENTENCE_PASS_INSTRUCTION} Each lost customer removes £300 a month.`;
    expect(planted).toMatch(/\d/);
    const w = SEALED.toLowerCase().match(/[a-z£%]+/g)!;
    expect(planted.toLowerCase()).toContain(w.slice(w.indexOf('lost') - 1, w.indexOf('lost') + 3).join(' '));
  });
});

describe('(e) import graph: the merge module reads no label and calls no unit or amount parser', () => {
  it('imports only sameUnit and locateLiteral as values (plus grammar constants and types)', () => {
    const imports = [...linksSource.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/gm)].map((m) => ({
      typeOnly: m[1] !== undefined, names: m[2]!.split(',').map((n: string) => n.trim()).filter(Boolean), from: m[3]! }));
    const values = imports.filter((i) => !i.typeOnly).flatMap((i) => i.names.filter((n: string) => !n.startsWith('type ')).map((n: string) => `${i.from}#${n}`));
    expect(values.sort()).toEqual([
      '../../../orchestrator-v5/agent-lane/same-unit.js#sameUnit',
      './grammar.js#DRAFT_RECORD_UNRESOLVED',
      './quantity-evidence.js#locateLiteral',
    ]);
    // Code only: the module's own comments name the validators it defers to.
    const code = linksSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/stated-amounts|findStatedAmounts|readUnit|readMoney|readCountRate|parseCardinal|unitEvidenceReason|boundLiteral/);
    expect(code).not.toMatch(/\.label\b|claims\s*\[/);
    // The typed increment declaration may rebind quantity aliases, never inspect a claim's content.
    expect(new Set([...code.matchAll(/\bclaim\.([a-zA-Z_]\w*)/g)].map(m => m[1]))).toEqual(new Set(['quantity']));
    expect(code).toMatch(/sameUnit\(/); // contrast: the probe sees a call it allows
  });
});
