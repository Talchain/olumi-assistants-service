/**
 * ⭐ SYSTEM 2 step 1: the ONE construction source map (DL re-plan 14 Oct). The drafter is asked, once, for `statements[]`, and the
 * host verifies each against the brief with the one statement verifier; nothing reads the map yet (step 2 moves admission onto it).
 * The corpus is not the author's: Paul's served brief and the drafter's recorded answer to it (`served-c1494f4d.json`, `_source`),
 * through the real `buildModelFromBrief`. Whether the drafter fills `statements` well is AI behaviour, measured on the served raws.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATEMENTS_INSTRUCTION, buildModelFromBrief } from '../runtime/build-model.js';
import { sourceMapOf, subjectKey } from '../construction-source-map.js';

type Rec = Record<string, any>;
/** The AIE's exact paragraph (#94 6180604131), copied from the comment: the text is bound by identity, never retyped. */
const AIE_TEXT = readFileSync('tests/fixtures/sys2/aie-statements-6180604131.txt', 'utf8');
/** The served capacity brief (`_source`): "between 10 and 30" is a stated range only a clause check can attest. */
const CAPACITY = JSON.parse(readFileSync('tests/fixtures/drafter-text-3/served-capacity-brief.json', 'utf8')) as { brief: string };
const SERVED = JSON.parse(readFileSync('tests/fixtures/drafter-capacity-chain/served-c1494f4d.json', 'utf8')) as { brief: string; draft: Rec };
const sid = '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e';
const LEGACY = 'We have an urgent launch date in the next six months, but our development team is spending, on average, 25% of their time on fixing legacy code.';
const legacyLevel = (over: Rec = {}): Rec => ({ quote: LEGACY, subject: { kind: 'factor', label: 'Time on legacy fixes', to_label: null, factor_label: null },
  field: 'level', form: 'point', value: 25, low: null, high: null, unit: '%', qualifier: 'on average', conditions: null, ...over });
const KEY = subjectKey({ kind: 'factor', label: 'Time on legacy fixes' }, 'level');

async function build(draft: Rec): Promise<{ sent: Rec; graph: Rec }> {
  let sent: Rec | undefined;
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, SERVED.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft), status: 'completed' }; }) as never) as Rec;
  if (result.ok !== true || sent === undefined || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { sent, graph };
}

describe('SYSTEM 2 step 1: the drafter cites the brief once, and the host verifies each statement', () => {
  it('RED: the SENT drafter request asks for statements once, with the closed field set, required at the provider boundary', async () => {
    const { sent } = await build(SERVED.draft);
    expect((sent.instructions as string).split(STATEMENTS_INSTRUCTION)).toHaveLength(2);
    expect(STATEMENTS_INSTRUCTION).toBe(AIE_TEXT);
    expect((sent.instructions as string).split(AIE_TEXT)).toHaveLength(2);
    const schemas = JSON.stringify(sent).match(/"statements":\{"type":"array"/g) ?? [];
    expect(schemas).toHaveLength(1);
    const text = JSON.stringify(sent);
    expect(text).toContain('"enum":["level","target","holds_now","occurrence","lead","effect","measure","relation"]');
  });

  it('a verbatim sentence of Paul\'s brief with the figure it writes is verified under its subject and field', () => {
    const map = sourceMapOf([legacyLevel()], SERVED.brief);
    expect(map.refused).toEqual([]);
    expect(map.verified.get(KEY)).toEqual([expect.objectContaining({ speaker: 'user', quote: LEGACY, form: 'point', low: 25, high: 25, reading: 'olumi' })]);
  });

  it('a figure the sentence spells is read by the one cardinal parser: "six mid-weight developers" is 6, never the drafter\'s 8', () => {
    const devs = (value: number): Rec => ({ quote: 'We currently have six mid-weight developers.', subject: { kind: 'factor', label: 'Mid-weight developers', to_label: null, factor_label: null },
      field: 'level', form: 'point', value, low: null, high: null, unit: 'developers', qualifier: null, conditions: null });
    const map = sourceMapOf([devs(6), devs(8)], SERVED.brief);
    expect(map.verified.get(subjectKey({ kind: 'factor', label: 'Mid-weight developers' }, 'level'))).toEqual([expect.objectContaining({ low: 6, high: 6 })]);
    expect(map.refused.map((r) => [r.index, r.refusal])).toEqual([[1, 'figure_not_in_quote']]);
  });

  it('CONTRASTS: a figure the sentence does not write, a shortened sentence and words not in the brief are UNKNOWN, retained with quote and reason; never the user\'s, never Olumi\'s', () => {
    const map = sourceMapOf([
      legacyLevel({ value: 15 }), // NUMBER: the drafter's figure, not the user's
      legacyLevel({ quote: '25% of their time on fixing legacy code.' }), // not a whole statement
      legacyLevel({ quote: 'Our developers spend 25% of their time on legacy code.' }), // Olumi's paraphrase
      { quote: LEGACY, field: 'level', form: 'point', value: 25 }, // no subject
      legacyLevel(),
    ], SERVED.brief);
    // Each is retained WHOLE as the drafter gave it (AIE 6180604131), never shortened.
    expect(map.refused[0]!.given).toEqual({ ...legacyLevel({ value: 15 }), subject: { kind: 'factor', label: 'Time on legacy fixes', to_label: null, factor_label: null } });
    expect(map.refused[3]!.given).toEqual({ quote: LEGACY, field: 'level', form: 'point', value: 25 });
    expect(map.refused.map((r) => [r.index, r.refusal, r.quote, r.key])).toEqual([
      [0, 'figure_not_in_quote', LEGACY, KEY],
      [1, 'statement_not_found', '25% of their time on fixing legacy code.', KEY],
      [2, 'statement_not_found', 'Our developers spend 25% of their time on legacy code.', KEY],
      [3, 'statement_malformed', LEGACY, undefined],
    ]);
    expect(map.refused.every((r) => r.detail.length > 0)).toBe(true);
    // Only the one verified statement is the user's; the refused ones never join it.
    expect(map.verified.get(KEY)).toEqual([expect.objectContaining({ low: 25, high: 25 })]);
  });

  it('nothing reads the map yet: the registered graph is the same with and without statements', async () => {
    const without = await build(SERVED.draft);
    const withStatements = await build({ ...SERVED.draft, statements: [legacyLevel(), legacyLevel({ value: 15 })] });
    expect(withStatements.graph).toEqual(without.graph);
  });

  it('two figures written side by side are not a range by themselves: "between 10 and 30" stays unknown, retained, until the clause check (step 2)', () => {
    const quote = 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.';
    const map = sourceMapOf([{ quote, subject: { kind: 'factor', label: 'Specialist capacity', to_label: null, factor_label: null }, field: 'level', form: 'range',
      value: null, low: 10, high: 30, unit: 'tickets per week', qualifier: 'about', conditions: null }], CAPACITY.brief);
    expect(map.verified.size).toBe(0);
    expect(map.refused).toEqual([expect.objectContaining({ index: 0, refusal: 'figure_not_in_quote', quote, given: expect.objectContaining({ low: 10, high: 30 }) })]);
  });

  it('nothing past the per-draft limit is dropped: it is retained whole, unchecked, its authorship unknown', () => {
    const many = Array.from({ length: 61 }, () => legacyLevel());
    const map = sourceMapOf(many, SERVED.brief);
    expect(map.verified.get(KEY)).toHaveLength(60);
    expect(map.refused).toEqual([expect.objectContaining({ index: 60, refusal: 'not_checked', quote: LEGACY, given: expect.objectContaining({ value: 25 }) })]);
  });

  it('statements is OPTIONAL: a malformed list never fails a draft (DL condition, 23:06Z)', async () => {
    const without = await build(SERVED.draft);
    for (const statements of ['not a list', [null, 7, { quote: 3 }], null]) {
      expect((await build({ ...SERVED.draft, statements })).graph).toEqual(without.graph);
      expect(sourceMapOf(statements, SERVED.brief).verified.size).toBe(0);
    }
  });
});
