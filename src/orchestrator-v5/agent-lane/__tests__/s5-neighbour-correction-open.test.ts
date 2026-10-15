/**
 * ⭐ AIE 6186002237 (S5 amend of the DL's neighbour ruling) + DL ruling (a): a correction or cross-reference in DIFFERENT words
 * still constrains the count, read only from the statements the drafter files on the subject (the shared contract, no word
 * list). Rows on REAL drafter raws (the served capacity brief with ONE sentence PROMPT added), through the real
 * `buildModelFromBrief`:
 *  - LINK, a correction ("Actually, it is closer to 15 a week." after "about 20 …"): the user's corrected 15 is THEIR size
 *    (`user_stated`), the earlier 20 superseded; never Olumi's estimate (DL condition 2);
 *  - LINK, a cross-reference ("That's last year's figure, though."): the 20 stays the user's, asked about with the ruled words,
 *    and the Run's licence carries it as a provisional note while it is open (DL condition 1);
 *  - LEVEL (pins): the same two sentences on a factor level leave it unresolved, with the user's sentences kept.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { userStatementsOn } from '../../statement-door/statements.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';

type Rec = Record<string, any>;
type Case = { brief: string; call1_text: string; _source: Rec };
const load = (id: string): Case => JSON.parse(readFileSync(`tests/fixtures/sys2/s5-${id}.json`, 'utf8')) as Case;
const LINK_CORRECTION = load('N1-correction-different-words');
const LINK_CROSS_REF = load('N2-cross-reference');
const LEVEL_CORRECTION = load('N3-level-correction');
const LEVEL_CROSS_REF = load('N4-level-cross-reference');
const CROSS_REF = "That's last year's figure, though.";
const QUESTION = `You also said ‘${CROSS_REF}’: is 20 per specialist still right?`;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T08:30:00.000Z')); });
afterEach(() => { vi.useRealTimers(); });

async function built(c: Case, edit: (raw: Rec) => Rec = (r) => r, brief = c.brief): Promise<{ graph: Rec; result: Rec }> {
  let graph: Rec | undefined;
  const text = JSON.stringify(edit(JSON.parse(c.call1_text)));
  const result = await buildModelFromBrief('6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c', brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text, status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { graph, result };
}
const specialistLink = (g: Rec): Rec => (g.edges as Rec[]).find((e) => /specialist/.test(e.from) && e.to === 'additional_specialist_capacity')!;
const linkStatements = (c: Case): [string, unknown, string][] => (JSON.parse(c.call1_text).statements as Rec[])
  .filter((s) => s.subject.kind === 'link' && s.field === 'effect').map((s) => [s.form, s.value, s.quote]);
const team = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.label === 'Existing team capacity')!;
const levelQuotes = (n: Rec): string[] => userStatementsOn(n).filter((r) => r.field === 'level').flatMap((r) => r.statements.map((s) => s.quote));
const unresolved = { source: 'cee_inference', user_material_unverified: true };
/** The Run's licence on this graph: every option at one chance, so only the notes and the label differ between rows. */
function licence(g: Rec): Rec {
  const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
  const options = (g.nodes as Rec[]).filter((n) => n.kind === 'option').map((o) => o.id as string);
  return goalChanceLicenceOf({ option_comparison: options.map((id) => ({ option_id: id, id, probability_of_goal: 0.6, win_probability: 0.5 })),
    inference_warnings: [] }, g, goal.id) as Rec;
}

describe('S5 amend + DL ruling (a): a correction or cross-reference in other words, on a link', () => {
  it('PRECONDITION (real raws): the drafter files the correction and the cross-reference on the same link and field', () => {
    expect(linkStatements(LINK_CORRECTION).map(([f, v]) => [f, v])).toEqual([['range', null], ['point', 15]]);
    expect(linkStatements(LINK_CROSS_REF).map(([f, , q]) => [f, q])).toContainEqual(['describes', CROSS_REF]);
  });

  it('CORRECTION: the user\'s corrected 15 is THEIR size (never Olumi\'s estimate); the earlier 20 is superseded, nothing asked', async () => {
    const { graph, result } = await built(LINK_CORRECTION);
    expect(specialistLink(graph).provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 15, per_source_change_unit: 'specialists' } });
    expect(JSON.stringify(result.open_questions ?? [])).not.toContain('You also said');
  });

  it('CROSS-REFERENCE: the 20 stays the user\'s, and is asked about in the ruled words', async () => {
    const { graph, result } = await built(LINK_CROSS_REF);
    expect(specialistLink(graph).provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 20 } });
    expect(result.open_questions).toContain(QUESTION);
  });

  it('CROSS-REFERENCE on the Run: the licence is provisional and notes the ruled question, by the link\'s identity', async () => {
    const l = licence((await built(LINK_CROSS_REF)).graph);
    expect(l.provisional).toBe(true);
    expect(l.notes).toContain(QUESTION);
  });

  it('CONTRAST: without the cross-reference sentence, the same 20 is the user\'s, unasked and not noted', async () => {
    const plain = LINK_CROSS_REF.brief.replace(` ${CROSS_REF}`, '');
    const drop = (r: Rec): Rec => ({ ...r, statements: (r.statements as Rec[]).filter((s) => s.quote !== CROSS_REF) });
    const { graph, result } = await built(LINK_CROSS_REF, drop, plain);
    expect(specialistLink(graph).provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 20 } });
    expect(JSON.stringify(result.open_questions ?? [])).not.toContain('You also said');
    expect(licence(graph).notes ?? []).not.toContain(QUESTION);
  });
});

describe('AIE 6186002237 pins: the same sentences on a factor LEVEL leave it unresolved', () => {
  it('PRECONDITION (real raws): the drafter files both on the same factor level', () => {
    const levels = (c: Case): [unknown, string][] => (JSON.parse(c.call1_text).statements as Rec[])
      .filter((s) => s.subject.label === 'Existing team capacity' && s.field === 'level').map((s) => [s.value, s.quote]);
    expect(levels(LEVEL_CORRECTION)).toEqual([[80, 'Our existing team resolves 80 tickets per week.'], [70, 'Actually, it is closer to 70 these days.']]);
    expect(levels(LEVEL_CROSS_REF)).toEqual([[80, `Our existing team resolves 80 tickets per week. ${CROSS_REF}`]]);
  });

  it('CORRECTION: unresolved (never verified, never Olumi\'s); both sentences kept', async () => {
    const n = team((await built(LEVEL_CORRECTION)).graph);
    expect(n.observed_state).toMatchObject({ raw_value: 70, ...unresolved });
    expect(levelQuotes(n)).toEqual(['Our existing team resolves 80 tickets per week.', 'Actually, it is closer to 70 these days.']);
  });

  it('CROSS-REFERENCE: unresolved; the cross-reference is kept with the statement', async () => {
    const n = team((await built(LEVEL_CROSS_REF)).graph);
    expect(n.observed_state).toMatchObject({ raw_value: 80, ...unresolved });
    expect(levelQuotes(n)).toEqual([`Our existing team resolves 80 tickets per week. ${CROSS_REF}`]);
  });
});
