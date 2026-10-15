/**
 * ⭐ M3b — THE USER'S FORECAST THAT EVERY EFFECT IS IN PLACE, on the ONE statement door (AIE #94 6180193788 §2; DL 23:06Z, AMEND
 * 23:49Z). Served hiring r4 (CEE e7f95dc6, turn 10): Paul volunteered "All of these effects would be fully in place by month 3."
 * Nothing could record it. Here:
 *  - the volunteered statement is never refused: what it leaves open (its reference, and the effects that are Olumi's
 *    estimates, not his) is asked ONCE, in the timing ask's words, with his words kept;
 *  - with his answer to that ask, ONE press sets `effects_at_period_end` and records both statements, with a fingerprint of the
 *    effects, settings, target and reference;
 *  - a later month is recorded and blocks Olumi's not-stated reading;
 *  - a changed effect makes the forecast stale;
 *  - the REAL Run cites his timing on the SAME licence (origin 'user').
 * Two briefs: hiring r4 (turn 10 graph, and the served post3000 Run) and pricing MRR (2a35ff31).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readStatement, type DoorQuote } from '../read.js';
import { doorCardWords } from '../card.js';
import { doorRowFor } from '../role-table.js';
import { goalTargetBasisIn, humanEffectsTimingOf, timingAskOf, TIMING_ROW } from '../fields/goal-timing.js';
import { userStatementFor } from '../statements.js';
import type { DoorSubject } from '../subject.js';
import type { DoorWrite } from '../write.js';
import { applyGoalReadingEdit } from '../../goal-target/goal-reading-write.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const R10 = (JSON.parse(readFileSync('src/orchestrator-v5/statement-door/__tests__/fixtures/hiring-positive-r4-turn10.json', 'utf8')) as Rec).graph as Rec;
const SHORTFALL = JSON.parse(readFileSync('tests/fixtures/hiring-shortfall/served-hiring-post3000-run-turn17-20261014.json', 'utf8')) as Rec;
const PRICING = (JSON.parse(readFileSync('src/orchestrator-v5/agent-lane/__tests__/fixtures/pricing-e2e-2a35ff31-read02-after-reopen.json', 'utf8')) as Rec).body.graph as Rec;
const SAID = 'All of these effects would be fully in place by month 3.';
const WORDS = 'All of these effects would be fully in place by month 3';
const YES = 'Yes, from today, all of them.';
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const subjectOf = (g: Rec): DoorSubject => ({ kind: 'goal', id: String(goalOf(g).id), field: 'lead' });
// The route passes the asks Olumi said (`ask.ts`): the timing ask among them, so an answer to it binds.
const read = (g: Rec, quotes: DoorQuote[], texts: Rec) => readStatement(g, subjectOf(g), String(goalOf(g).label), quotes, texts as never,
  { asks: [timingAskOf(g, String(goalOf(g).id))!] });
const volunteered = (said = SAID, words = WORDS): DoorQuote => ({ quote: said, reading_words: words });
const answered = (g: Rec): DoorQuote => ({ quote: YES, answering: timingAskOf(g, String(goalOf(g).id))!.words });
const write = (g: Rec, quotes: DoorQuote[], texts: Rec): { w: DoorWrite; after: Rec } => {
  const v = read(g, quotes, texts);
  if (v.kind !== 'read') throw new Error(`refused: ${v.detail}`);
  const w = doorRowFor(subjectOf(g), g)!.writer.approve(v.reading, g);
  if ('refused' in w) throw new Error(`refused: ${w.refused}`);
  const done = applyGoalReadingEdit(g, w.payload as never);
  if (done.kind !== 'mutated') throw new Error(JSON.stringify(done));
  return { w, after: done.mutatedGraph };
};
const EFFECTS_R10 = '‘Developers hired’ on ‘Code quality’, ‘Developers hired’ on ‘Productivity’, ‘Tech leads hired’ on ‘Code quality’ and ‘Tech leads hired’ on ‘Productivity’';
const ASK_R10 = `Would all of these effects be fully in place by month three from today (14 January 2027): ${EFFECTS_R10}?`;

describe('M3b r4: a volunteered "All of these effects…" is never refused; only what it leaves open is asked, once', () => {
  it('the timing ask names every current option effect and the target’s own end point', () => {
    expect(timingAskOf(R10, 'productivity')?.words).toBe(ASK_R10);
  });

  it('volunteered: bound to the one goal by its own scope; the reference and Olumi’s two Code quality effects are asked in the ask’s words', () => {
    const v = read(R10, [volunteered()], { now: SAID });
    expect(v).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    const detail = (v as Rec).detail as string;
    expect(detail).not.toMatch(/is not clearly about/);
    expect(detail).toContain('whether month 3 is from today or after launch');
    expect(detail).toContain('whether it also covers ‘Developers hired’ on ‘Code quality’ and ‘Tech leads hired’ on ‘Code quality’ (Olumi’s estimates, not yours)');
    expect(detail).toContain(`Ask only this, exactly: “${ASK_R10}”`);
    expect(detail).toContain('Keep the user’s words exactly as they said them');
  });

  it('with his answer to that ask: the card, then ONE press sets the flag and records both statements, fingerprinted', () => {
    const texts = { now: YES, conversation: SAID };
    const v = read(R10, [volunteered(), answered(R10)], texts);
    expect(v.kind).toBe('read');
    if (v.kind !== 'read') return;
    // AIE 6180193788's timing card, in its own order: the reading, when it is evaluated, its question, then what it does not say.
    expect(doorCardWords(v.reading)).toBe(`From your words: “${SAID}” and “${YES}” Olumi reads this as your forecast that ${EFFECTS_R10} would be fully `
      + 'in place by month 3 from today. This target is evaluated at month three from today (14 January 2027). Record this timing reading? It describes '
      + 'the effects at that point; it does not say they operate throughout the preceding window or that their arrival has been simulated.');
    const before = goalOf(R10).goal_target_basis as Rec;
    expect(before.effects_at_period_end).toBe(false);
    const { w, after } = write(R10, [volunteered(), answered(R10)], texts);
    expect(goalOf(after).goal_target_basis).toEqual({ ...before, effects_at_period_end: true });
    expect(userStatementFor(after, subjectOf(R10))).toMatchObject({ field: 'lead', statements: [{ quote: SAID }, { quote: YES, answering: ASK_R10 }],
      attest: { month: 3, later: false } });
    expect(humanEffectsTimingOf(after, 'productivity')).toMatchObject({ kind: 'in_place', month: 3 });
    expect(TIMING_ROW.writer.holds(w, after)).toBe(true);
    expect(TIMING_ROW.writer.holds(w, R10)).toBe(false);
    expect(applyGoalReadingEdit(after, w.payload as never)).toEqual({ kind: 'unchanged' });
  });

  it('the end point: "by month 2" does not prove month three; the ask is said again for that alone', () => {
    const v = read(R10, [volunteered('All of these effects would be fully in place by month 2.', 'All of these effects would be fully in place by month 2'), answered(R10)],
      { now: YES, conversation: 'All of these effects would be fully in place by month 2.' });
    expect(v).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    expect((v as Rec).detail).toMatch(/^Not yet clear: whether they would still be fully in place at month three\./);
  });

  it('later: "by month 5" is recorded as his, the flag stays false, and the horizon reads no period-end effects', () => {
    const said = 'All of these effects would be fully in place by month 5.';
    const { after } = write(R10, [volunteered(said, 'All of these effects would be fully in place by month 5'), answered(R10)], { now: YES, conversation: said });
    expect(goalOf(after).goal_target_basis.effects_at_period_end).toBe(false);
    expect(humanEffectsTimingOf(after, 'productivity')).toMatchObject({ kind: 'later', month: 5 });
  });

  it('stale: an effect that changes after the press turns his forecast stale, and the flag reads false again', () => {
    const { after } = write(R10, [volunteered(), answered(R10)], { now: YES, conversation: SAID });
    expect(goalTargetBasisIn(after, goalOf(after))?.effects_at_period_end).toBe(true);
    const moved = structuredClone(after);
    const e = (moved.edges as Rec[]).find((x) => x.from === 'tech_leads_hired' && x.to === 'code_quality')!;
    e.strength = { mean: 0.3, std: 0.1 };
    expect(humanEffectsTimingOf(moved, 'productivity')).toMatchObject({ kind: 'stale' });
    expect(goalTargetBasisIn(moved, goalOf(moved))?.effects_at_period_end).toBe(false);
    expect(goalOf(moved).goal_target_basis.effects_at_period_end).toBe(true);
  });
});

describe('M3b: the REAL Run cites his forecast on the SAME licence (served hiring post3000)', () => {
  const SCENARIO = '2eb6131e-eef9-49da-bfb8-cd50888d2c58';
  async function licenceOn(graph: Rec): Promise<{ licence?: Rec; warnings: Rec[] }> {
    const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(graph), briefText: SHORTFALL.brief, revision: 7 })),
      readMostRecentPendingActions: vi.fn(async () => []) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-m3b', port as never);
    const run = vi.fn(async () => ({ ...structuredClone(minimalFixture), option_comparison: structuredClone(SHORTFALL.option_comparison) }));
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn() } as never, scenarioReader: async () => snapshot });
    const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 't-m3b', kind: 'message',
      chip: { parameters: { effects_timing: SHORTFALL.served_licence.effects_timing } } }, requestId: 'req-m3b',
    signal: new AbortController().signal, context: {}, orientationText: '' } as never) as Rec;
    const warnings = ((outcome.handler_facts as Rec[]).find((f) => f.fact_type === 'run_analysis')!.result as Rec).enrichment.inference_warnings as Rec[];
    return { licence: warnings.find((w) => w.code === 'GOAL_CHANCE_LICENSED'), warnings };
  }
  const G = SHORTFALL.graph as Rec;
  const said = 'All of these effects would be fully in place by month 3.';

  it('precondition: without his forecast the served Run licenses Olumi’s period-end assumption (origin olumi)', async () => {
    const { licence } = await licenceOn(G);
    expect(licence).toMatchObject({ effects_timing: 'not_stated', effects_timing_origin: 'olumi' });
  });

  it('in place: the licence records origin user and says "Timing basis: you stated …"; the additive reading stays Olumi’s', async () => {
    const { after } = write(G, [volunteered(said, WORDS), answered(G)], { now: YES, conversation: said });
    const { licence } = await licenceOn(after);
    expect(licence).toMatchObject({ effects_timing: 'in_place_by_period', effects_timing_origin: 'user' });
    expect(licence).not.toHaveProperty('period_end_assumption');
    const notes = licence!.notes as string[];
    const basis = notes.find((n) => n.startsWith('Timing basis: you stated'))!;
    expect(basis).toMatch(new RegExp(`^Timing basis: you stated “${said}” and “${YES}”\\. This calculation reads .+ at month three on that forecast\\. It does not model when they arrive\\.$`));
    expect(notes.some((n) => n.startsWith('Each option’s effects are read as their size at month three'))).toBe(true);
  });

  it('later: never licensed on Olumi’s not-stated reading; the withhold keeps his month', async () => {
    const later = 'All of these effects would be fully in place by month 5.';
    const { after } = write(G, [volunteered(later, 'All of these effects would be fully in place by month 5'), answered(G)], { now: YES, conversation: later });
    const { licence, warnings } = await licenceOn(after);
    expect(licence?.pct_by_option ?? {}).toEqual({});
    expect(JSON.stringify(warnings)).toContain('You said they would be fully in place by month 5 from today, after that.');
  });
});

describe('M3b TWO-BRIEF RULE: pricing MRR (2a35ff31), a level target at twelve months', () => {
  const said = 'All of these effects would be fully in place by month 12 from today.';
  const words = 'All of these effects would be fully in place by month 12 from today';
  it('volunteered with its reference: only the effects that are Olumi’s are asked, in the ask’s words', () => {
    const v = read(PRICING, [volunteered(said, words)], { now: said });
    expect(v).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    const detail = (v as Rec).detail as string;
    expect(detail).not.toContain('from today or after launch');
    expect(detail).toContain('(Olumi’s estimates, not yours)');
    expect(detail).toContain(`Ask only this, exactly: “${timingAskOf(PRICING, String(goalOf(PRICING).id))!.words}”`);
  });

  it('with the answer: the flag is set on THIS reading and his words recorded; its open question stays', () => {
    const before = goalOf(PRICING).goal_target_basis as Rec;
    const { after } = write(PRICING, [volunteered(said, words), answered(PRICING)], { now: YES, conversation: said });
    expect(goalOf(after).goal_target_basis).toEqual({ ...before, effects_at_period_end: true });
    expect(humanEffectsTimingOf(after, String(goalOf(PRICING).id))).toMatchObject({ kind: 'in_place', month: 12 });
    expect(goalHorizonVerdict(after)).toBe(goalHorizonVerdict(PRICING));
  });
});
