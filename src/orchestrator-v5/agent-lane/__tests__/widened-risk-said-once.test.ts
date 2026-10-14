/**
 * Capacity e2e 57687e86, judge row 4 (turn 01): the reply said the same omission twice — the added risk's own line
 * ("…, so the Run leaves it out, and that option's chance doesn't include it yet.") and the generic note ("Risks Olumi
 * added aren't in the chance yet, so it may be too high."). The route drops the note and its marker when every added risk's
 * own line already says it (`widenedRunWordsOf`); this is the producer that decides it, on the served read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { risksSaidLeftOutOfTheChance } from '../decision-input-ask.js';

type Rec = Record<string, unknown>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-capacity-e2e-57687e86-read-01.json', import.meta.url), 'utf8')) as {
  graph: { nodes: Rec[]; edges: Rec[] }; canonical_analysis_view: { options: { option_id: string; cell: Rec }[] } };
const cellsOf = (view: typeof SERVED.canonical_analysis_view) => view.options.map(o => ({ option_id: o.option_id, ...o.cell })) as never;
const RISK = 'specialist_contribution_falls_short';

describe('an added risk whose own line says the chance leaves it out is said once', () => {
  it('PRECONDITION (served read): the one added risk is Olumi\'s widening on "Add one specialist", whose cell shows a chance', () => {
    const risk = SERVED.graph.nodes.find(n => n.id === RISK)!;
    expect((risk.draft_widening as Rec).provenance).toBe('ai_suggested_widen');
    expect(((risk.draft_widening as Rec).hits as Rec).id).toBe('add_one_specialist');
    expect(SERVED.canonical_analysis_view.options.find(o => o.option_id === 'add_one_specialist')!.cell.kind).toBe('figure');
  });

  it('⭐ the served risk\'s own line says its option\'s chance leaves it out, so it is in the set the generic note defers to', () => {
    const cells = cellsOf(SERVED.canonical_analysis_view);
    expect([...risksSaidLeftOutOfTheChance(SERVED.graph, cells)]).toEqual([RISK]);
  });

  it('CONTRAST: with that option\'s chance withheld, its line does not say the chance omits it, so the note is still owed', () => {
    const view = structuredClone(SERVED.canonical_analysis_view);
    view.options.find(o => o.option_id === 'add_one_specialist')!.cell = { kind: 'withheld', reasons: [], face: 'Chance not shown yet', why: 'x' };
    expect(risksSaidLeftOutOfTheChance(SERVED.graph, cellsOf(view)).size).toBe(0);
  });
});
