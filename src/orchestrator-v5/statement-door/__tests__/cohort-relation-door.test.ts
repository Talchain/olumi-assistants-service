/**
 * M4-cohort (SCIENCE): the science table's row T8 "Relation (same cohort)" on the ONE statement door, with AIE 6180618773's C4
 * (the number reached is held fixed only as Olumi's explicit conditional scenario). Two briefs:
 *  · marketing: Paul's served model after L20 (run-08: both targets as served; window from launch);
 *  · recruitment: a different brief with a reach figure (an offer-acceptance rate above 60% and at least 5 hires, over the first
 *    four months from today). Built here, outside the journeys, so the row is not fitted to marketing's words or window.
 * Every row goes through `readStatement` (the door's one read: the table's reader, the binding, the verifier) and the row's writer.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { applyCohortForecastEdit, cohortForecastAskWords, cohortQuartileQuestion, storedTargetRowsOf } from '../../goal-target/cohort-forecast-write.js';
import { readCohortForecast, targetForecastWireOf } from '../../goal-target/cohort-forecast.js';
import { goalTargetBasisOf, launchWindowQuestion, periodWords } from '../../goal-target/goal-target-basis.js';
import { cohortForecastAsks, COHORT_RELATION_ROW, COHORT_SAME_PEOPLE_ROW } from '../fields/cohort-relation.js';
import { readStatement, type DoorQuote } from '../read.js';
import { doorRowFor } from '../role-table.js';
import { userStatementFor } from '../statements.js';
import type { DoorSubject } from '../subject.js';

type Rec = Record<string, any>;
const persisted = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
const edge = (from: string, to: string): Rec => ({ from, to, strength: { std: 0.1, mean: 0.5 }, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 1 });

const MARKETING = (): Rec => persisted(JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')).graph);
/** The recruitment brief: an over-period window from TODAY (marketing's is from launch), its own labels, units and figures. */
const RECRUITMENT = (): Rec => persisted({
  nodes: [
    { id: 'how_should_we_hire_engineers', kind: 'decision', label: 'Should we use an agency or a referral scheme to hire engineers?', provenance: 'from_brief' },
    { id: 'offer_acceptance_rate', kind: 'goal', label: 'Offer acceptance rate', provenance: 'from_brief', goal_direction: '>', goal_threshold: 0.6,
      goal_threshold_raw: 60, goal_threshold_unit: '%', goal_threshold_frame: 'level', goal_threshold_cap: 100, goal_threshold_cap_provenance: 'metric_scale',
      goal_horizon_months: 4,
      goal_target_basis: { source: 'olumi_reading', reference: 'today', target_raw: 60, target_frame: 'level', quantity_frame: 'level',
        effect_unit: 'percentage points of offer acceptance rate over the first four months', period_kind: 'over_period', period_months: 4,
        effects_at_period_end: true, also_required: ['hire at least 5 engineers within the first four months'] } },
    { id: 'carry_on_as_now', kind: 'option', label: 'Carry on as now', provenance: 'ai_inferred', is_baseline: true },
    { id: 'use_a_recruitment_agency', kind: 'option', label: 'Use a recruitment agency', provenance: 'from_brief' },
    { id: 'start_a_referral_scheme', kind: 'option', label: 'Start a referral scheme', provenance: 'from_brief' },
    { id: 'candidate_quality', kind: 'factor', label: 'Candidate quality', provenance: 'ai_inferred' },
    { id: 'engineers_hired', kind: 'outcome', label: 'Engineers hired', provenance: 'from_brief', scale_frame: 100 },
  ],
  edges: [edge('how_should_we_hire_engineers', 'carry_on_as_now'), edge('how_should_we_hire_engineers', 'use_a_recruitment_agency'),
    edge('how_should_we_hire_engineers', 'start_a_referral_scheme'), edge('use_a_recruitment_agency', 'candidate_quality'),
    edge('start_a_referral_scheme', 'candidate_quality'), edge('candidate_quality', 'offer_acceptance_rate'), edge('candidate_quality', 'engineers_hired')],
  goal_constraints: [
    { role: 'goal_target', unit: '%', label: 'Offer acceptance rate', value: 60, node_id: 'offer_acceptance_rate', operator: '>=', operator_as_stated: '>',
      provenance: 'explicit', value_frame: 'level', constraint_id: 'agent-lane:offer_acceptance_rate:>=' },
    { role: 'goal_target', unit: 'engineers', label: 'Engineers hired', value: 5, node_id: 'engineers_hired', operator: '>=',
      provenance: 'explicit', value_frame: 'level', constraint_id: 'agent-lane:engineers_hired:>=' },
  ],
});

interface Brief {
  readonly name: string;
  readonly graph: () => Rec;
  readonly option: string;
  readonly label: string;
  readonly window: string;
  readonly rateLabel: string;
  readonly countLabel: string;
  /** The user's three statements, in the brief's own words. */
  readonly people: string;
  readonly range: string;
  readonly low: number;
  readonly high: number;
  readonly reach: number;
  readonly same: string;
}
const BRIEFS: readonly Brief[] = [
  { name: 'marketing (run-08, from launch)', graph: MARKETING, option: 'hire_marketing_manager', label: 'Hire marketing manager',
    window: 'the first three months after launch', rateLabel: 'Conversion rate', countLabel: 'New customers in first 3 months',
    people: 'Hiring a marketing manager would reach about 500 people in the first three months.', range: 'Between 12 and 18%.', low: 12, high: 18,
    reach: 500, same: 'Yes, the new customers will come from the same people we measure the conversion rate on.' },
  { name: 'recruitment (from today)', graph: RECRUITMENT, option: 'start_a_referral_scheme', label: 'Start a referral scheme',
    window: 'the first four months', rateLabel: 'Offer acceptance rate', countLabel: 'Engineers hired',
    people: 'A referral scheme would get us 9 candidates to offer in the first four months.', range: 'I would say 55% to 80%.', low: 55, high: 80,
    reach: 9, same: 'Yes, the engineers we hire are the candidates who accept our offers.' },
];

const subjectOf = (b: Brief): DoorSubject => ({ kind: 'option', id: b.option, field: 'relation' });
/** The user's words as the session holds them, and the asks Olumi said (the goal's same-people question, then the one-in-four). */
function conversation(b: Brief) {
  const g = b.graph();
  const basis = goalTargetBasisOf(g.nodes.find((n: Rec) => n.kind === 'goal'))!;
  const sameQ = launchWindowQuestion(b.rateLabel, basis, b.countLabel);
  // The option's forecast ask as readiness says it (both questions in one): the people reached and the range answer it.
  const forecastQ = cohortForecastAskWords(b.label, periodWords(basis), b.window);
  const quartileQ = forecastQ;
  // The user's earlier verified messages (the people reached and the same-people answer), and this turn's range.
  const texts = { conversation: `${b.people}\n\n${b.same}`, now: b.range } as never;
  const ctx = { asks: cohortForecastAsks(g, sameQ) };
  const quotes: DoorQuote[] = [{ quote: b.people, answering: forecastQ }, { quote: b.same, answering: sameQ }, { quote: b.range, answering: forecastQ }];
  return { g, sameQ, quartileQ, texts, ctx, quotes };
}

describe.each(BRIEFS)('T8 cohort relation on the door: $name', (b) => {
  it('the ONE row for an option\'s relation is this one; the goal\'s is the same-people row; a factor has none', () => {
    const g = b.graph();
    expect(doorRowFor(subjectOf(b), g)).toBe(COHORT_RELATION_ROW);
    expect(doorRowFor({ ...subjectOf(b), kind: 'goal', id: g.nodes.find((n: Rec) => n.kind === 'goal').id }, g)).toBe(COHORT_SAME_PEOPLE_ROW);
    expect(doorRowFor({ kind: 'factor', id: 'candidate_quality', field: 'relation' }, g)).toBeUndefined();
  });

  it('RED (C4): the card says the reach is the user\'s FORECAST and holding it fixed is Olumi\'s scenario, with its uncertainty left out', () => {
    const c = conversation(b);
    const v = readStatement(c.g, subjectOf(b), b.label, c.quotes, c.texts, c.ctx);
    expect(v.kind, JSON.stringify(v)).toBe('read');
    if (v.kind !== 'read') return;
    expect(v.reading.reading).toContain(`your forecast that ‘${b.label}’ reaches ${b.reach} people during ${b.window}`);
    expect(v.reading.reading).toContain(`about one chance in four below ${b.low}% and one chance in four above ${b.high}% for the underlying conversion rate of ‘${b.label}’`);
    expect(v.reading.assumptions).toEqual([
      `Olumi’s scenario, not yours: the chance is worked out as if exactly ${b.reach} people are reached during ${b.window}; how many it actually reaches may differ, and that uncertainty is not included.`,
      `Olumi’s approximation, not yours: the underlying ‘${b.rateLabel}’ is treated as a smooth curve (a Beta distribution) through your two estimates, and each person converts or not at that same chance. If no such curve fits them, no chance is given for this option.`,
    ]);
    expect(`${v.reading.reading} ${v.reading.assumptions.join(' ')}`).not.toMatch(/held fixed\.|as likely to fall inside|even chance|middle half/);
  });

  it('RED: the press writes the user\'s forecast AND their words in ONE commit; the read-back holds both; the Run reads the quartiles', () => {
    const c = conversation(b);
    const v = readStatement(c.g, subjectOf(b), b.label, c.quotes, c.texts, c.ctx);
    if (v.kind !== 'read') throw new Error(JSON.stringify(v));
    const w = COHORT_RELATION_ROW.writer.approve(v.reading, c.g) as Rec;
    // The figure statements keep the ask they answered (the served forecast ask runs past 500 characters).
    expect(v.reading.statements.filter((st) => st.form !== 'holds_now').map((st) => st.answering)).toEqual([c.quartileQ, c.quartileQ]);
    expect(w.member, JSON.stringify(w)).toBe('cohort_forecast');
    const after = applyCohortForecastEdit(c.g, w.payload) as Rec;
    expect(after.kind).toBe('mutated');
    expect(w.holds(after.mutatedGraph)).toBe(true);
    expect(w.holds(c.g)).toBe(false);
    const option = after.mutatedGraph.nodes.find((n: Rec) => n.id === b.option);
    expect(readCohortForecast(option)).toMatchObject({ people_reached: b.reach, conversion_middle_half_pct: [b.low, b.high], author: 'user' });
    expect(userStatementFor(after.mutatedGraph, subjectOf(b))?.statements.map((s) => s.quote)).toEqual([b.people, b.same, b.range]);
    expect(targetForecastWireOf(option, storedTargetRowsOf(after.mutatedGraph))).toMatchObject({ exposure: b.reach, rate_quartiles: [b.low / 100, b.high / 100] });
    // The retry after it landed is the verified no-op, never a second write.
    expect(applyCohortForecastEdit(after.mutatedGraph, { ...w.payload, own_write_landed: true })).toEqual({ kind: 'unchanged' });
  });

  it('CONTRAST: the same-people answer binds through the goal\'s ask only; with no ask it is not about this option, and nothing is read', () => {
    const c = conversation(b);
    const v = readStatement(c.g, subjectOf(b), b.label, [{ quote: b.people, answering: c.quartileQ }, b.same, { quote: b.range, answering: c.quartileQ }], c.texts, c.ctx);
    expect(v).toMatchObject({ kind: 'refused', refusal: 'not_this_subject' });
  });

  it('CONTRAST: a range answering ANOTHER option\'s one-in-four ask is not this option\'s, and is refused', () => {
    const c = conversation(b);
    const other = c.g.nodes.find((n: Rec) => n.kind === 'option' && n.id !== b.option);
    const v = readStatement(c.g, subjectOf(b), b.label,
      [{ quote: b.people, answering: c.quartileQ }, { quote: b.same, answering: c.sameQ },
        { quote: b.range, answering: cohortForecastAskWords(other.label, periodWords(goalTargetBasisOf(c.g.nodes.find((n: Rec) => n.kind === 'goal'))!), b.window) }], c.texts, c.ctx);
    expect(v).toMatchObject({ kind: 'refused', refusal: 'not_this_subject' });
  });

  it('CONTRAST: a missing statement writes nothing (incomplete), and two figures in one statement are kept as said', () => {
    const c = conversation(b);
    const v = readStatement(c.g, subjectOf(b), b.label, c.quotes.slice(0, 2), c.texts, c.ctx);
    if (v.kind !== 'read') throw new Error(JSON.stringify(v));
    expect(COHORT_RELATION_ROW.writer.approve(v.reading, c.g)).toEqual({ refused: expect.stringMatching(/^incomplete/) });
    expect(COHORT_RELATION_ROW.read(`${b.people} ${b.range}`, subjectOf(b), c.g)).toHaveProperty('refused');
  });
});

describe('T8 result note (C4): the inputs are each forecast\'s author\'s, and the reach is Olumi\'s conditional scenario', () => {
  it('the legacy card and the door say the same C4 words (one source)', async () => {
    const { cohortForecastCardWords } = await import('../../goal-target/cohort-forecast-write.js');
    const s = { people: { source: 'P' }, conversion: { source: 'R' }, same_cohort: { source: 'S' } } as never;
    const lines = cohortForecastCardWords('Hire marketing manager', { people_reached: 500, conversion_middle_half_pct: [12, 18] } as never, s,
      'Conversion rate', 'New customers in first 3 months', 'the first three months after launch').split('\n');
    expect(lines[1]).toBe('From your messages: ‘P’ · ‘S’. Your forecast is that it reaches 500 people during the first three months after launch, '
      + 'and ‘New customers in first 3 months’ counts the people who convert among those same people, as you said.');
    expect(lines[2]).toBe(COHORT_RELATION_ROW.assumptions([{ form: 'point', low: 500, high: 500 }] as never, subjectOf(BRIEFS[0]!), MARKETING())[0]);
  });
});
