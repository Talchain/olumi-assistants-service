/**
 * ⭐ M3a — THE GOAL'S MEASURE ON THE ONE STATEMENT DOOR (AIE #94 6180193788 §1; DL 14 Oct 23:06Z/23:09Z).
 *
 * Served hiring r4 (CEE e7f95dc6, `live/runs/2026-10-14T220736Z-hiring-t1h-positive-r4`): Paul wrote "We measure productivity as
 * story points completed per sprint." and nothing could record it; the judge read the measure as lost. Here the door reads that
 * statement on the r4 server-read graph, shows the AIE's measurement card, and its writer moves ONLY the held reading's
 * denominator and effect unit (the reference stays the held "today") with the user's words recorded on the goal in the same
 * commit. The real Run then says the shortfall in that measure, joined to the SAME recorded reading; the same denominator
 * without the user's recorded statement says none (never a hidden generic denominator).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readStatement } from '../read.js';
import { doorCardWords } from '../card.js';
import type { DoorWrite } from '../write.js';
import { doorRowFor } from '../role-table.js';
import { recordedMeasureOf } from '../fields/measure.js';
import { userStatementFor, userStatementsOn, withUserStatement } from '../statements.js';
import { subjectKey, type DoorSubject } from '../subject.js';
import { applyGoalReadingEdit } from '../../goal-target/goal-reading-write.js';
import { projectModelContext } from '../../agent-lane/runtime/agent-capabilities.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const R4 = (JSON.parse(readFileSync('src/orchestrator-v5/agent-lane/__tests__/fixtures/hiring-positive-r4-turn06.json', 'utf8')) as Rec).graph as Rec;
const SHORTFALL = JSON.parse(readFileSync('tests/fixtures/hiring-shortfall/served-hiring-post3000-run-turn17-20261014.json', 'utf8')) as Rec;
const GOAL: DoorSubject = { kind: 'goal', id: 'productivity', field: 'measure' };
// Paul's r4 turn (the scripted user's own words, `hiring-controls-r4.sh` QANS).
const TURN = 'I mean at least 10% more than today’s productivity, achieved by the launch date. We measure productivity as story points completed per sprint.';
const SAID = 'We measure productivity as story points completed per sprint.';
const MEASURE = 'story points completed per sprint';
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === 'productivity')!;
const read = (g: Rec, words: string | null = MEASURE, texts: Rec = { now: TURN }) => readStatement(g, GOAL, 'Productivity',
  [words === null ? SAID : { quote: SAID, reading_words: words }], texts as never);
const writeOn = (g: Rec): { write: DoorWrite; after: Rec } => {
  const v = read(g);
  if (v.kind !== 'read') throw new Error(`refused: ${v.detail}`);
  const w = doorRowFor(GOAL, g)!.writer.approve(v.reading, g);
  if ('refused' in w) throw new Error(`refused: ${w.refused}`);
  const written = applyGoalReadingEdit(g, w.payload as never);
  if (written.kind !== 'mutated') throw new Error(`not mutated: ${JSON.stringify(written)}`);
  return { write: w, after: written.mutatedGraph };
};

describe('M3a: the measure statement is read on the door, against the HELD target reading', () => {
  it('the row is signed by the AIE answer and writes through the goal-reading member', () => {
    expect(doorRowFor(GOAL, R4)).toMatchObject({ field: 'measure', carrier: 'goal_reading', forms: ['describes'], signed_by: '6180193788' });
    expect(doorRowFor({ ...GOAL, kind: 'factor' }, R4)).toBeUndefined();
  });

  it('r4: the card says the AIE measurement card’s lines in the ONE template, from the held target (reference, period, conditions, the open question kept)', () => {
    const v = read(R4);
    expect(v.kind).toBe('read');
    if (v.kind !== 'read') return;
    expect(v.reading.words).toBe(MEASURE);
    expect(v.reading.statements).toHaveLength(1);
    expect(v.reading.statements[0]).toMatchObject({ speaker: 'user', quote: SAID, form: 'describes' });
    // The AIE's measurement card (6180193788 §1) in the ONE template: the reading, then each line once.
    expect(doorCardWords(v.reading)).toBe(`From your words: “${TURN}”. Olumi reads this as ‘Productivity’ measured in story points completed per `
      + 'sprint. Your target remains up at least 10% from today, relative to today’s level, at three months. Under this target reading, 100% means '
      + 'today\'s story points completed per sprint; each option’s change is expressed in % of today\'s story points completed per sprint. '
      + 'Other stated requirements: maintaining code quality. Still open: Is the 10% productivity increase required by the launch date, and how '
      + 'should productivity be measured? Record this reading?');
  });

  it('refusals keep the words: not the user’s words for the measure, unverified origin, a level target, another kind of subject', () => {
    expect(read(R4, 'velocity')).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    expect(read(R4, null)).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    expect(read(R4, MEASURE, { now: 'Yes.', unverified: TURN })).toMatchObject({ kind: 'refused', refusal: 'origin_unknown' });
    const level = structuredClone(R4);
    Object.assign(goalOf(level), { quantity_frame: 'level', goal_threshold_frame: 'level' });
    Object.assign(goalOf(level).goal_target_basis, { quantity_frame: 'level', target_frame: 'level' });
    expect(read(level)).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    expect(readStatement(R4, { kind: 'factor', id: 'productivity', field: 'measure' }, 'Productivity', [{ quote: SAID, reading_words: MEASURE }],
      { now: TURN } as never)).toMatchObject({ kind: 'refused', refusal: 'no_table_row' });
  });
});

describe('M3a, TWO-BRIEF RULE (property across the other served briefs): a measure on a target that is not a % change from today', () => {
  /** The first graph in a served capture (its nodes and edges), whatever envelope holds it. */
  const graphIn = (v: unknown): Rec | undefined => {
    if (v === null || typeof v !== 'object') return undefined;
    const r = v as Rec;
    if (Array.isArray(r.nodes) && Array.isArray(r.edges) && (r.nodes as Rec[]).some((n) => n?.kind === 'goal')) return r;
    for (const x of Object.values(r)) { const g = graphIn(x); if (g !== undefined) return g; }
    return undefined;
  };
  const F = 'src/orchestrator-v5/agent-lane/__tests__/fixtures/';
  const BRIEFS: readonly [string, string, string][] = [
    ['capacity-post2996-run2-read.json', 'We measure weekly support capacity as tickets closed per week.', 'tickets closed per week'],
    ['marketing-17c98e69.json', 'We measure the launch as features shipped to customers.', 'features shipped to customers'],
    ['pricing-e2e-2a35ff31-read02-after-reopen.json', 'We measure MRR as monthly recurring revenue from paying accounts.', 'monthly recurring revenue from paying accounts'],
  ];
  it.each(BRIEFS)('%s: a level target is refused with its reason, the words kept, and nothing is written', (file, said, words) => {
    const g = graphIn(JSON.parse(readFileSync(F + file, 'utf8')))!;
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    const subject: DoorSubject = { kind: 'goal', id: String(goal.id), field: 'measure' };
    const v = readStatement(g, subject, String(goal.label), [{ quote: said, reading_words: words }], { now: said } as never);
    expect(v).toMatchObject({ kind: 'refused', refusal: 'not_this_field' });
    expect((v as Rec).detail).toMatch(/Keep the user’s words exactly as they said them/);
    expect(recordedMeasureOf(goal)).toBeUndefined();
  });
});

describe('M3a: ONE press moves only the two members, and records the user’s words on the goal in the same commit', () => {
  it('the postimage: denominator and effect unit in the measure, reference and everything else unchanged, the statement kept', () => {
    const before = goalOf(R4).goal_target_basis as Rec;
    const { write, after } = writeOn(R4);
    const goal = goalOf(after);
    expect(goal.goal_target_basis).toEqual({ ...before, denominator: `today's ${MEASURE}`, effect_unit: `% of today's ${MEASURE}` });
    // The question it does not answer stays; the reading stays Olumi's.
    expect(goal.goal_target_basis.open_question).toBe(before.open_question);
    expect(goal.goal_target_basis.source).toBe('olumi_reading');
    expect(userStatementFor(after, GOAL)).toMatchObject({ subject_key: subjectKey(GOAL), field: 'measure',
      statements: [{ speaker: 'user', quote: SAID, source: TURN, form: 'describes', reading: 'olumi' }] });
    expect(goal.user_statements).toHaveLength(1);
    // Nothing else on the graph moved.
    const strip = (g: Rec) => ({ ...g, nodes: (g.nodes as Rec[]).map((n) => (n.id === 'productivity' ? { ...n, goal_target_basis: null, user_statements: null } : n)) });
    expect(strip(after)).toEqual(strip(R4));
    // The read-back holds exactly the write; the base does not.
    expect(write.holds(after)).toBe(true);
    expect(write.holds(R4)).toBe(false);
    // A retry of the write that landed is the verified no-op.
    expect(applyGoalReadingEdit(after, write.payload as never)).toEqual({ kind: 'unchanged' });
  });

  it('one record per subject: a later record for the same subject REPLACES it; another subject’s record is kept', () => {
    const { after } = writeOn(R4);
    const goal = goalOf(after);
    const other = { subject_key: 'goal|productivity|||target', field: 'target', statements: (userStatementFor(after, GOAL)!).statements, recorded_at: 'x' };
    const later = { ...userStatementFor(after, GOAL)!, recorded_at: '2026-10-15T00:00:00.000Z' };
    const g = { ...after, nodes: (after.nodes as Rec[]).map((n) => (n.id === 'productivity' ? { ...goal, user_statements: [other, ...goal.user_statements] } : n)) };
    const written = withUserStatement(g as never, later, GOAL)!;
    expect(goalOf(written).user_statements).toEqual([other, later]);
    expect(withUserStatement(g as never, later, { ...GOAL, id: 'nope' })).toBeUndefined();
  });

  it('a stale card (the held reading moved since it was shown) refuses', () => {
    const { write } = writeOn(R4);
    const moved = structuredClone(R4);
    goalOf(moved).goal_target_basis.also_required = ['maintaining code quality', 'no overtime'];
    expect(applyGoalReadingEdit(moved, write.payload as never)).toMatchObject({ kind: 'refused' });
  });

  it('the receipt repeats the saved reading and gives no agent direction (DL 23:08Z: HIRING_TIMES_APPLIED’s follow_up leak)', () => {
    const { after } = writeOn(R4);
    const v = read(R4);
    if (v.kind !== 'read') throw new Error('refused');
    const receipt = doorRowFor(GOAL, R4)!.recordedWords(v.reading.statements, GOAL, 'Productivity', after, v.reading.words);
    expect(receipt).toBe(`Recorded your measurement definition: “${SAID}” The saved target reading is ‘Productivity’ measured in story points `
      + 'completed per sprint, up at least 10% from today, relative to today’s level, at three months; 100% means today\'s story points completed '
      + 'per sprint, and each option’s change is in % of today\'s story points completed per sprint. Other stated requirements: maintaining code '
      + 'quality. Still open: Is the 10% productivity increase required by the launch date, and how should productivity be measured?');
    expect(receipt).not.toMatch(/\b(?:Run the analysis|do not state|Tell the user|Ask the user|Show the|Call )\b/);
  });

  it('the AI’s working input holds the user’s definition apart from Olumi’s reading (cold: from the saved graph alone)', () => {
    const { after } = writeOn(R4);
    const ctx = projectModelContext({ nodes: after.nodes, edges: after.edges, raw: after, analysis_state: undefined, analysis_ready: false } as never);
    const goal = ctx.goal as Rec;
    expect(goal.id).toBe('productivity');
    expect(goal.user_statements).toEqual([{ field: 'measure', said: [SAID], speaker: 'user' }]);
    expect(goal.measured_in).toBe(MEASURE);
    const plain = projectModelContext({ nodes: R4.nodes, edges: R4.edges, raw: R4, analysis_state: undefined, analysis_ready: false } as never);
    expect(plain.goal).toMatchObject({ id: 'productivity' });
    expect(plain.goal).not.toHaveProperty('user_statements');
  });
});

describe('M3a: the Run says the shortfall in the recorded measure, joined to the SAME approved reading', () => {
  const SCENARIO = '2eb6131e-eef9-49da-bfb8-cd50888d2c58';
  async function runServed(graph: Rec): Promise<Rec | undefined> {
    const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(graph), briefText: SHORTFALL.brief, revision: 7 })),
      readMostRecentPendingActions: vi.fn(async () => []) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-m3a', port as never);
    const run = vi.fn(async () => ({ ...structuredClone(minimalFixture), option_comparison: structuredClone(SHORTFALL.option_comparison) }));
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn() } as never, scenarioReader: async () => snapshot });
    const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 't-m3a', kind: 'message',
      chip: { parameters: { effects_timing: SHORTFALL.served_licence.effects_timing } } }, requestId: 'req-m3a',
    signal: new AbortController().signal, context: {}, orientationText: '' } as never) as Rec;
    const fact = (outcome.handler_facts as Rec[]).find((f) => f.fact_type === 'run_analysis')!;
    return ((fact.result as Rec).enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_CHANCE_LICENSED');
  }

  it('recorded: "21% of today’s story points completed per sprint" (hand: 10 − (−11.41) = 21.41)', async () => {
    const { after } = writeOn(SHORTFALL.graph);
    expect(recordedMeasureOf(goalOf(after))).toBe(MEASURE);
    const licence = (await runServed(after))!;
    expect(licence.shortfall_note_by_option.hire_a_tech_lead)
      .toBe('In its worst 1 in 20 runs of this model, ‘Hire a Tech Lead’ falls short of your target by 21% of today’s story points completed per sprint or more.');
  });

  it('contrast: the same denominator with NO recorded statement says no shortfall (no hidden generic denominator)', async () => {
    const g = structuredClone(SHORTFALL.graph);
    Object.assign(goalOf(g).goal_target_basis, { denominator: `today's ${MEASURE}`, effect_unit: `% of today's ${MEASURE}` });
    expect(recordedMeasureOf(goalOf(g))).toBeUndefined();
    expect(userStatementsOn(goalOf(g))).toEqual([]);
    const licence = (await runServed(g))!;
    expect(licence).not.toHaveProperty('shortfall_note_by_option');
  });
});
