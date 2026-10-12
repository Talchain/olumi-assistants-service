/**
 * ⭐ G round 2 (DL, 13 Oct; answering CHECK-f46cd7c5 BLOCKING): the conditional chance FAILS SAFE on any stated timing.
 *
 * Round 1 licensed the conditional chance unless the brief matched one of its listed contradictions, so "The hires start in
 * month four." (later than the 3-month period) escaped and a chance was shown. The default is now inverted: the chance is
 * licensed ONLY when the persisted brief says nothing about when, how fast or how much of the options' effects arrive beyond
 * the goal's own period phrase. A false withhold is acceptable; a false chance is not.
 *
 * Every row runs the served run-4 hiring Run (`served-hiring-run4-turn07-20261012T172858Z.json`) the way the Run handler does
 * (E's withhold, then the licence, with the same inputs), with a statement added to the persisted brief. This spec imports only
 * what the licence exported before round 2, so it runs unchanged against the round-1 rules (the "old rules back" mutant).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceForAgent, sentGoalThresholdOf, withGoalChanceLicence, withholdForPeriodEndEffects } from '../goal-chance-licence.js';
import { goalChanceCellFacesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { toOutboundGraph } from '../outbound-graph.js';
import { withShareByDateFrame } from '../share-by-date-run.js';
import { withoutStatedLevelRanges } from '../../routing/add-factor-transaction.js';
import { resolveGoalDirection, resolveGoalThresholdStrict } from '../goal-direction.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/batch-g/served-hiring-run4-turn07-20261012T172858Z.json', 'utf8')) as Rec;
const GOAL = 'productivity';
const HIRING = ['hire_a_tech_lead', 'hire_two_developers'];
const NOTE = 'Provisional: this calculation assumes the estimated effects are in place by month three. It does not model when they arrive.';
const WITHHOLD = 'The chance of reaching your target for ‘productivity’ (up at least 10% from today) by month three isn’t shown: '
  + 'the model has not established how much of these effects would be in place by then.';

function sentRunOf(graph: Rec): Rec {
  const sent: Rec = { graph: toOutboundGraph(withoutStatedLevelRanges(withShareByDateFrame(graph, graph))) };
  const direction = resolveGoalDirection(graph, GOAL);
  if (direction !== undefined) sent.goal_direction = direction.direction;
  if (resolveGoalThresholdStrict(graph, GOAL)) sent.goal_threshold_strict = true;
  return sent;
}
const earned = (id: string, p: 0 | 1): boolean => (FX.goal_certainty as Rec[]).some((d) => d.option_id === id && d.probability_of_goal === p && d.earned);
const SENT = sentRunOf(FX.graph);

/** The Run handler's own order (`run-analysis.ts`): E's withhold, then the licence, with the same inputs. */
function runWith(brief: string): { envelope: Rec; view: Rec } {
  const graph = FX.graph;
  const withheld = withholdForPeriodEndEffects(FX.envelope, graph, GOAL, { sentRun: SENT, brief });
  const envelope = withGoalChanceLicence(withheld, graph, GOAL, earned, sentGoalThresholdOf(withheld, SENT.graph, GOAL, earned, SENT),
    graph, { storedConstraints: graph.goal_constraints, sentConstraints: graph.goal_constraints, sentRun: SENT, brief });
  return { envelope, view: { type: 'analysis_result', enrichment: envelope } };
}
/** E's sentence on both hiring options and no licence, or the conditional licence with its note; anything else is OTHER. */
function verdictOf(brief: string): 'WITHHELD' | 'LICENSED' | 'OTHER' {
  const run = runWith(brief);
  const w = (run.envelope.inference_warnings as Rec[]).find((x) => x.detail?.reason === 'effects_at_period_end_unstated');
  const licence = goalChanceLicenceForAgent(run.view);
  if (w?.message === WITHHOLD && HIRING.every((id) => (w.option_ids as string[]).includes(id)) && licence === undefined) return 'WITHHELD';
  const faces = [...goalChanceCellFacesForAgent(run.view, FX.graph, true).keys()];
  return w === undefined && licence?.notes?.includes(NOTE) === true && HIRING.every((id) => faces.includes(id)) ? 'LICENSED' : 'OTHER';
}
/** The statement as the person's: after the persisted brief, or (odd rows) before it. */
const withStatement = (s: string, i: number): string => (i % 2 === 0 ? `${FX.brief} ${s}` : `${s} ${FX.brief}`);

// ── The generated timing sweep: verbs × time forms, rotating numbers, units and positions in the sentence. ──
const SUBJECTS = ['The hires', 'The new developers', 'The two developers'];
const VERBS = ['start', 'join the team', 'are fully onboarded', 'ramp up', 'make a difference to productivity', 'deliver the productivity gain'];
const NUMBERS = ['two', '4', 'six', '1'];
const UNITS = ['month', 'week', 'quarter', 'year'];
const plural = (n: string, unit: string): string => (n === '1' || n === 'one' ? unit : `${unit}s`);
const FORMS: readonly ((n: string, unit: string) => string)[] = [
  (n, u) => `in ${u} ${n}`,
  (n, u) => `after ${n} ${plural(n, u)}`,
  (n, u) => `within ${n} ${plural(n, u)}`,
  (n, u) => `from ${u} ${n} onwards`,
  (n, u) => `not until ${u} ${n}`,
  (n, u) => `${n} ${plural(n, u)} after they are hired`,
];
const POSITIONS: readonly ((subject: string, verb: string, time: string) => string)[] = [
  (s, v, t) => `${s} ${v} ${t}.`,
  (s, v, t) => `${t[0]!.toUpperCase()}${t.slice(1)}, ${s.toLowerCase()} ${v}.`,
  (s, v, t) => `${s}, ${t}, ${v}.`,
];
const GENERATED = VERBS.flatMap((verb, i) => FORMS.map((form, j) => {
  const time = form(NUMBERS[(i + j) % NUMBERS.length]!, UNITS[(i + 2 * j) % UNITS.length]!);
  return POSITIONS[(i + j) % POSITIONS.length]!(SUBJECTS[(i + j) % SUBJECTS.length]!, verb, time);
}));
/** Timing without a number: pace, share in place, calendar, onset, onboarding and launch-relative words. */
const WORDED = [
  'The hires ramp up gradually.',
  'Productivity improves only partly before the launch.',
  'We expect half the productivity gain at first.',
  'The gain will not arrive until after launch.',
  'The new developers join from 9 October.',
  'The Tech lead would be in post by January.',
  'The benefit shows up once onboarding is done.',
  'The hires take a while to settle in.',
  'The productivity gain builds up slowly over time.',
  'There is a notice period before the Tech lead can join.',
  'The developers will be productive eventually.',
  'The Tech lead joins next quarter.',
  'The two developers would be effective immediately.',
  'Any improvement is delayed by recruitment.',
  'The hires need to learn the codebase first.',
  'Productivity will dip while the new people are trained.',
  'While the hires are new, output is lower.',
  'The benefit builds up as the team gels.',
];
const TIMING = [...GENERATED, ...WORDED];

/** Statements about the options that say nothing about when, how fast or how much of an effect arrives. */
const NON_TIMING = [
  'The Tech lead would cost about £120,000 including on-costs.',
  'Two developers would cost roughly £150,000 together.',
  'A Tech lead would mentor the existing developers and review their designs.',
  'Our developers are strong on the backend but weak on automated testing.',
  'Code quality matters more to us than raw output.',
  'We could hire contractors instead of permanent staff.',
  'The team is split between London and Leeds.',
  'Our recruiter thinks a strong Tech lead is harder to find than two developers.',
  'Two more developers would add review load for the senior people.',
  'The Tech lead would own architecture decisions.',
  'Hiring two developers leaves more of the budget for tooling.',
  'Leadership is the gap the team itself has identified.',
];

describe('G r2: the check\'s sentence withholds (RED on f46cd7c5)', () => {
  it('"The hires start in month four." (later than the 3-month period) → E\'s sentence, no licence, no note', () => {
    expect(verdictOf(`${FX.brief} The hires start in month four.`)).toBe('WITHHELD');
  });
  it('CONTRAST: the persisted brief alone (its own period phrase only) is still licensed with the note', () => {
    expect(verdictOf(FX.brief)).toBe('LICENSED');
  });
});

describe('G r2: the generated sweep — every stated timing withholds; statements without timing stay licensed', () => {
  it('sizes: ≥ 30 timing statements, ≥ 10 without timing, all distinct', () => {
    expect(GENERATED.length).toBe(VERBS.length * FORMS.length);
    expect(TIMING.length).toBeGreaterThanOrEqual(30);
    expect(NON_TIMING.length).toBeGreaterThanOrEqual(10);
    expect(new Set([...TIMING, ...NON_TIMING]).size).toBe(TIMING.length + NON_TIMING.length);
  });
  it.each(TIMING.map((s, i) => [s, i] as const))('timing → withheld: %s', (s, i) => {
    expect(verdictOf(withStatement(s, i))).toBe('WITHHELD');
  });
  it.each(NON_TIMING.map((s, i) => [s, i] as const))('no timing → licensed: %s', (s, i) => {
    expect(verdictOf(withStatement(s, i))).toBe('LICENSED');
  });
});
