/**
 * M4-cohort (SCIENCE), System 4 "Relation (same cohort)": the door's row and writer adapter for ONE option's cohort forecast, on
 * run-08's saved marketing model after L20 (both targets as served). Unregistered until the contract AMENDs; these rows pin the
 * row's reading, its AIE words, and the writer's gates (conflict 4 fails closed; the one-in-four ask re-checked).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { applyCohortForecastEdit, cohortQuartileQuestion } from '../../goal-target/cohort-forecast-write.js';
import { targetForecastWireOf } from '../../goal-target/cohort-forecast.js';
import { storedTargetRowsOf } from '../../goal-target/cohort-forecast-write.js';
import { COHORT_FORECAST_WRITER, COHORT_RELATION_ROW, cohortForecastAsk, cohortForecastWriter } from '../rows/cohort-relation.js';
import type { DoorReading } from '../read.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const graph = (): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(F.graph)), { nodes: [], edges: [] }).graph as Rec;
const SUBJECT = { kind: 'option', id: 'hire_marketing_manager', field: 'relation' } as const;
const LABEL = 'Hire marketing manager';
const WINDOW = 'the first three months after launch';
const Q = cohortQuartileQuestion(LABEL, WINDOW);
const st = (form: string, extra: Rec): Rec => ({ speaker: 'user', quote: extra.quote, source: extra.quote, subject: { quantity: 'relation' }, form, reading: 'olumi', ...extra });
const PPL = st('point', { quote: 'Hiring a marketing manager would reach about 500 people in the first three months.', low: 500, high: 500 });
const CONV = st('range', { quote: 'Between 12 and 18%.', low: 12, high: 18, answering: Q });
const SAME = st('holds_now', { quote: 'Yes, the new customers will come from the same people we measure the conversion rate on.' });
const reading = (statements: Rec[]): DoorReading => ({ subject: SUBJECT, label: LABEL, statements: statements as never, reading: '', assumptions: [] });

describe('System 4 relation row (cohort): read, words, and the writer\'s gates', () => {
  it('reads each statement\'s form by its figures; two figures in one statement are kept as said', () => {
    const g = graph();
    expect(COHORT_RELATION_ROW.read('Between 12 and 18%.', SUBJECT, g)).toEqual({ form: 'range', low: 12, high: 18 });
    expect(COHORT_RELATION_ROW.read(PPL.quote, SUBJECT, g)).toEqual({ form: 'point', low: 500, high: 500 });
    expect(COHORT_RELATION_ROW.read(SAME.quote, SUBJECT, g)).toEqual({ form: 'holds_now' });
    expect(COHORT_RELATION_ROW.read('About 500 people, converting 12–18%.', SUBJECT, g)).toHaveProperty('refused');
    expect(COHORT_RELATION_ROW.read('Between 12 and 18%.', { ...SUBJECT, kind: 'goal' }, g)).toHaveProperty('refused');
  });

  it('the reading and assumptions are the AIE\'s words: the user\'s quartiles; the Beta curve and the fixed number reached are Olumi\'s', () => {
    const g = graph();
    const words = COHORT_RELATION_ROW.readingWords([PPL, CONV, SAME] as never, SUBJECT, LABEL, g);
    expect(words).toContain('your estimates as about one chance in four below 12% and one chance in four above 18% for ‘Hire marketing manager’, among the people it reaches, during the first three months after launch. These are your estimates, not a minimum and maximum');
    const a = COHORT_RELATION_ROW.assumptions([PPL, CONV, SAME] as never, SUBJECT, g);
    expect(a[0]).toMatch(/^Olumi’s approximation, not yours: .*Beta distribution/);
    expect(a).toContain('The number reached is held fixed, so its own uncertainty is not included.');
    expect(`${words} ${a.join(' ')}`).not.toMatch(/as likely to fall inside|even chance|middle half/);
  });

  it('RED (conflict 4 open): the registered writer fails closed and writes nothing', () => {
    expect(COHORT_FORECAST_WRITER.approve(reading([PPL, CONV, SAME]), graph())).toEqual({ refused: expect.stringMatching(/^conflict_open/) });
  });

  it('once signed: the three statements write the user\'s record; the read-back holds it; #3103\'s wire reads the quartiles', () => {
    const g = graph();
    const w = cohortForecastWriter(true).approve(reading([PPL, CONV, SAME]), g) as Rec;
    expect(w.member).toBe('cohort_forecast');
    const after = applyCohortForecastEdit(g, w.payload) as Rec;
    expect(after.kind).toBe('mutated');
    expect(w.holds(after.mutatedGraph)).toBe(true);
    expect(w.holds(g)).toBe(false);
    const option = after.mutatedGraph.nodes.find((n: Rec) => n.id === SUBJECT.id);
    expect(targetForecastWireOf(option, storedTargetRowsOf(after.mutatedGraph))).toMatchObject({ exposure: 500, rate_quartiles: [0.12, 0.18] });
  });

  it('CONTRASTS once signed: a range not answering THIS option\'s one-in-four ask, or a missing statement → refused', () => {
    const g = graph();
    const writer = cohortForecastWriter(true);
    const { answering: _a, ...plain } = CONV;
    for (const conv of [plain, { ...CONV, answering: 'Which range is the conversion as likely to fall inside as outside (an even chance)?' },
      { ...CONV, answering: cohortQuartileQuestion('Carry on as now', WINDOW) }]) {
      expect(writer.approve(reading([PPL, conv, SAME]), g)).toEqual({ refused: 'invalid_forecast' });
    }
    expect(writer.approve(reading([PPL, CONV]), g)).toEqual({ refused: expect.stringMatching(/^incomplete/) });
  });

  it('the ask is said in the door\'s subject, in the AIE\'s question words', () => {
    expect(cohortForecastAsk(graph(), 'hire_marketing_manager')).toEqual({ subject: SUBJECT, words: Q });
  });
});
