import type { CandidateModel } from '../admit-model.js';
import { expect, it } from 'vitest';
import { creditStatedFactorLevels, figureTheUserWroteFor, goalLevelTheUserWrote, levelWrittenApartFromTarget, withdrawUnstatedBaselineStamps, type EntityScope } from '../stated-by-user.js';

// P02 instance #25: the complete heldout1-d1 brief and its quantity scope.
const appointmentsBrief = "Our regional hospital's outpatient clinic completes 920 appointments each month, has 18 staff, and currently has 140 patients waiting for a first visit. Running the clinic costs roughly £48,000 per month, so additional activity needs a clear funding route. The waiting room is often quiet late in the afternoon, although reception says that transport difficulties make those slots hard to fill.\n\nOur single goal is to reach 1,100 completed appointments a month within the next 6 months. We could keep the present timetable, open for 4 Saturday sessions each month, or extend weekday opening by 10 hours a week. The Saturday plan would need volunteers from the existing team; longer weekdays would depend on patients accepting later slots.\n\nRecent pilots suggest each extra Saturday session adds between 14 and 18 completed appointments. Every extra nurse hour enables about 3 to 5 additional completed appointments, provided a consulting room is available. For every 100 reminder messages sent, missed appointments fall by about 7. Each Saturday session also adds £600 in staffing costs. These estimates come from local trials, and the weekday and Saturday effects should be assessed separately because they could draw on the same patients.";
const appointmentsScope: EntityScope = { currentLevel: true, target: ['completed appointments'], others: ["Saturday sessions per month", "Extra weekday opening hours", "Extra nurse hours per month", "Consulting rooms available for extra activity", "Patient acceptance of later slots", "Reminder messages sent per month", "Existing clinic operating cost per month", "Additional staffing cost per month", "Missed appointments per month", "Transport difficulties filling late slots", "Unfunded additional activity"] };
const appointmentsUnit = 'completed appointments per month';

type Row = { name: string; value: number; unit: string; brief: string; scope: EntityScope; expected: boolean };
const rows: Row[] = [
  { name: 'NEGATIVE P02 #25: 1,100 is the goal target, never the current completed appointments', value: 1100, unit: appointmentsUnit,
    brief: appointmentsBrief, scope: appointmentsScope, expected: false },
  { name: 'P02 #25 contrast: 920 is the current completed appointments', value: 920, unit: appointmentsUnit,
    brief: appointmentsBrief, scope: appointmentsScope, expected: true },
  { name: 'NEGATIVE target paraphrase: aim to hit 1,100 a month never states the current level', value: 1100, unit: appointmentsUnit,
    brief: 'Our clinic completes 920 appointments each month. We aim to hit 1,100 a month.', scope: appointmentsScope, expected: false },
  { name: 'NEGATIVE target noun: completed appointments target 1,100 is not the current level', value: 1100, unit: appointmentsUnit,
    brief: 'Completed appointments target 1,100 a month.', scope: appointmentsScope, expected: false },
  { name: 'NEGATIVE target deadline: completed appointments to 1,100 by December is not current', value: 1100, unit: appointmentsUnit,
    brief: 'Increase completed appointments to 1,100 a month by December.', scope: appointmentsScope, expected: false },
  { name: 'NEGATIVE repeated targets: two target writings still do not state a current level', value: 1100, unit: appointmentsUnit,
    brief: 'Our goal is to reach 1,100 completed appointments. We aim to hit 1,100 a month.', scope: appointmentsScope, expected: false },
  { name: 'current equals target: the separately stated current figure still credits', value: 1100, unit: appointmentsUnit,
    brief: 'Our goal is to reach 1,100 completed appointments. Our clinic completes 1,100 appointments each month.', scope: appointmentsScope, expected: true },
  { name: 'current payment: customer price is explicitly paid, not a total', value: 300, unit: 'GBP/customer/month',
    brief: '£120,000 monthly recurring revenue from 400 customers paying £300 a month.',
    scope: { target: ['Existing monthly price'], others: ['Existing customers', 'Starter monthly price', 'monthly recurring revenue'] }, expected: true },
  { name: 'NEGATIVE current payment: starter customers pay the same price', value: 300, unit: 'GBP/customer/month',
    brief: 'Starter customers are paying £300 a month; existing customers have an uncertain monthly price. We have 400 starter customers paying £300 a month.',
    scope: { target: ['Existing monthly price'], others: ['Existing customers', 'Starter monthly price', 'Starter customers'] }, expected: false },
  { name: 'NEGATIVE current payment: customer price per year is not a monthly price', value: 300, unit: 'GBP/customer/month',
    brief: 'We have 400 customers paying £300 a year; our monthly price is unknown.',
    scope: { target: ['Existing monthly price'], others: ['Existing customers', 'Starter monthly price'] }, expected: false },
  { name: 'current payment: a shared count noun still names existing paying customers', value: 400, unit: 'customers',
    brief: '£120,000 monthly recurring revenue from 400 customers paying £300 a month.',
    scope: { target: ['Existing customers'], others: ['Existing customer monthly price', 'Customers lost to price rise', 'Starter customers', 'monthly recurring revenue'] }, expected: true },
  { name: 'NEGATIVE current payment count: starter payers never count existing customers', value: 400, unit: 'customers',
    brief: 'We have 400 starter customers paying £300 a month; existing customer count is unknown.',
    scope: { target: ['Existing customers'], others: ['Starter customers', 'Existing customer monthly price'] }, expected: false },
  { name: 'unit noun: existing customers are written beside their count', value: 400, unit: 'customers',
    brief: '£120,000 monthly recurring revenue from 400 customers paying £300 a month.',
    scope: { target: ['Existing customers'], others: ['monthly recurring revenue', 'Existing monthly price', 'Starter subscribers'] }, expected: true },
  { name: 'NEGATIVE unit noun: 400 counts starter customers, never existing customers', value: 400, unit: 'customers',
    brief: 'We have 400 starter customers and existing customers pay £300 a month.',
    scope: { target: ['Existing customers'], others: ['Starter customers', 'Existing monthly price'] }, expected: false },
  { name: 'unit naming word: completes binds completed appointments', value: 920, unit: 'completed appointments per month',
    brief: 'Our clinic completes 920 appointments each month, has 18 staff.',
    scope: { target: ['completed appointments'], others: ['Missed appointments per month', 'Clinic staff'] }, expected: true },
  { name: 'NEGATIVE unit naming word: 920 missed appointments never counts completed appointments', value: 920, unit: 'completed appointments per month',
    brief: 'Our clinic misses 920 appointments each month, and completes 800 appointments.',
    scope: { target: ['completed appointments'], others: ['Missed appointments per month', 'Clinic staff'] }, expected: false },
  { name: 'shared count noun: general completed appointments are not additional appointments', value: 920, unit: 'appointments/month',
    brief: 'The clinic completes 920 appointments each month, with 18 staff.',
    scope: { target: ['Completed appointments per month'], others: ['Additional Saturday completed appointments', 'Clinic staff'] }, expected: true },
  { name: 'NEGATIVE shared count noun: Saturday appointments never count general completions', value: 920, unit: 'appointments/month',
    brief: 'Saturday sessions complete 920 additional Saturday appointments each month; general completed appointments are unknown.',
    scope: { target: ['Completed appointments per month'], others: ['Additional Saturday completed appointments', 'Clinic staff'] }, expected: false },
  { name: 'shared period count: weekly loaves are bound by each week', value: 60000, unit: 'loaves/week',
    brief: 'We sell 60,000 loaves each week at a wholesale price of £0.80 per loaf.',
    scope: { target: ['Weekly loaves sold'], others: ['Monthly loaves sold', 'Wholesale price per loaf'] }, expected: true },
  { name: 'NEGATIVE shared period count: monthly loaves never count weekly loaves', value: 60000, unit: 'loaves/week',
    brief: 'We sell 60,000 loaves each month; our weekly loaves sold are uncertain.',
    scope: { target: ['Weekly loaves sold'], others: ['Monthly loaves sold', 'Wholesale price per loaf'] }, expected: false },
  { name: 'shared money noun: unqualified revenue belongs to general revenue', value: 120000, unit: 'GBP/month',
    brief: 'We have £120,000 monthly recurring revenue from 400 customers.',
    scope: { target: ['monthly recurring revenue'], others: ['Starter tier monthly recurring revenue', 'Existing customers'] }, expected: true },
  { name: 'NEGATIVE shared money noun: starter revenue is never general revenue', value: 120000, unit: 'GBP/month',
    brief: 'The starter tier has £120,000 monthly recurring revenue; existing customers pay £300.',
    scope: { target: ['monthly recurring revenue'], others: ['Starter tier monthly recurring revenue', 'Existing customers'] }, expected: false },
  { name: 'NEGATIVE shared money noun: another cost keeps its qualifier', value: 48000, unit: 'GBP/month',
    brief: 'The clinic pays £48,000 in staffing costs per month; operating cost remains uncertain.',
    scope: { target: ['Monthly operating cost'], others: ['Additional staffing cost', 'Clinic staff'] }, expected: false },
  { name: 'money noun phrase: in monthly revenue is adjacent to the amount', value: 190000, unit: 'GBP/month',
    brief: 'Our bakery supplies independent grocers and earns about £190,000 in monthly revenue.',
    scope: { target: ['monthly revenue'], others: ['Additional stores supplied'] }, expected: true },
  { name: 'NEGATIVE money noun phrase: in monthly support cost is never revenue', value: 190000, unit: 'GBP/month',
    brief: 'Our bakery earns revenue and pays £190,000 in monthly support cost.',
    scope: { target: ['monthly revenue'], others: ['Monthly support cost'] }, expected: false },
  { name: 'per-one link: each price rise adds the stated monthly revenue', value: 1200, unit: 'GBP/month',
    brief: 'Each 1% price rise adds £1,200 a month to monthly recurring revenue before churn.',
    scope: { target: ['Price increase', 'monthly recurring revenue'], others: ['Customers lost to price rise', 'Starter subscribers'] }, expected: true },
  { name: 'NEGATIVE per-one link: the same amount acts on support cost', value: 1200, unit: 'GBP/month',
    brief: 'Each 1% price rise adds £1,200 a month to support cost before churn, while monthly recurring revenue is uncertain.',
    scope: { target: ['Price increase', 'monthly recurring revenue'], others: ['Customers lost to price rise', 'Support cost'] }, expected: false },
  { name: 'NEGATIVE per-one source: a capacity rise producing revenue never credits the price-rise link', value: 1200, unit: 'GBP/month',
    brief: 'Each 1% capacity rise adds £1,200 a month to monthly recurring revenue before churn; the price increase effect is unknown.',
    scope: { target: ['Price increase', 'monthly recurring revenue'], others: ['Capacity increase', 'Customers lost to price rise'] }, expected: false },
  { name: 'NEGATIVE per-one source: starter price effect never credits the existing price effect', value: 1200, unit: 'GBP/month',
    brief: 'Each 1% starter price rise adds £1,200 a month to monthly recurring revenue; the existing price effect is unknown.',
    scope: { target: ['Existing price increase', 'monthly recurring revenue'], others: ['Starter price rise', 'Existing customers'] }, expected: false },
  { name: 'support per subscriber: singular subscriber names the link', value: 6, unit: 'GBP/month',
    brief: 'Each starter subscriber costs about £6 a month in support.',
    scope: { target: ['Starter subscribers', 'Starter support cost'], others: ['Existing customers', 'Existing support cost'] }, expected: true },
  { name: 'NEGATIVE support per subscriber: existing support cost never credits starter support', value: 6, unit: 'GBP/month',
    brief: 'Each existing customer costs about £6 a month in support; starter support is unknown.',
    scope: { target: ['Starter subscribers', 'Starter support cost'], others: ['Existing customers', 'Existing support cost'] }, expected: false },
];
for (const row of rows) it(row.name, () => {
  expect(figureTheUserWroteFor(row.value, row.unit, row.brief, row.scope)).toBe(row.expected);
});

it('P02 #25: current goal reader and baseline stamps exclude the target, retaining 920', () => {
  const reader = goalLevelTheUserWrote({ goal: { metric: 'completed appointments' }, factors: appointmentsScope.others.map(label => ({ label })) }, appointmentsBrief);
  for (const value of [1100, 920]) {
    const expected = value === 920;
    expect(reader(value, appointmentsUnit)).toBe(expected);
    expect(levelWrittenApartFromTarget(value, appointmentsUnit, undefined, appointmentsBrief)).toBe(expected);
    const node = { kind: 'factor', label: 'completed appointments', observed_state: { raw_value: value, unit: appointmentsUnit, source: 'brief_extraction' } };
    expect(withdrawUnstatedBaselineStamps([node], appointmentsBrief)[0]!.observed_state.source).toBe(expected ? 'brief_extraction' : 'cee_inference');
  }
});

it('repeated targets cannot stamp a baseline; a separate current writing equal to the target can', () => {
  const targets = 'Our goal is to reach 1,100 completed appointments. We aim to hit 1,100 a month.';
  const current = targets + ' Our clinic completes 1,100 appointments each month.';
  const node = { kind: 'factor', label: 'completed appointments', observed_state: { raw_value: 1100, unit: appointmentsUnit, source: 'brief_extraction' } };
  for (const [brief, expected] of [[targets, false], [current, true]] as const) {
    expect(levelWrittenApartFromTarget(1100, appointmentsUnit, 1100, brief)).toBe(expected);
    expect(withdrawUnstatedBaselineStamps([node], brief)[0]!.observed_state.source).toBe(expected ? 'brief_extraction' : 'cee_inference');
  }
});

it('the target writing remains user-written in its own role', () => {
  expect(figureTheUserWroteFor(1100, appointmentsUnit, appointmentsBrief, { ...appointmentsScope, currentLevel: undefined })).toBe(true);
});

// Delegate contrast table from probe.ts; probe2.ts's typed-target checks follow.
// Each row carries the full brief, its entity, the figure and must_credit verdict.
const delegateRows = [
  {
    "id": "c1 hit",
    "brief": "We hit 920 completed appointments last month; our goal is 1,100.",
    "entity": "appointments",
    "value": 920,
    "must_credit": true
  },
  {
    "id": "c2 hit+want",
    "brief": "Our team hit 920 appointments in March and we want 1,100.",
    "entity": "appointments",
    "value": 920,
    "must_credit": true
  },
  {
    "id": "c3 at+aim",
    "brief": "We are at 920 appointments and aim for 1,100.",
    "entity": "appointments",
    "value": 920,
    "must_credit": true
  },
  {
    "id": "c4 currently",
    "brief": "Currently 920 completed appointments, goal 1,100.",
    "entity": "appointments",
    "value": 920,
    "must_credit": true
  },
  {
    "id": "c5 do today",
    "brief": "Our goal is 1,100 appointments; we do 920 a month today.",
    "entity": "appointments",
    "value": 920,
    "must_credit": true
  },
  {
    "id": "c6 hitting",
    "brief": "Hitting 920 a month already, target is 1,100.",
    "entity": "appointments",
    "value": 920,
    "must_credit": true
  },
  {
    "id": "t1 aim for",
    "brief": "We aim for 1,100 appointments.",
    "entity": "appointments",
    "value": 1100,
    "must_credit": false
  },
  {
    "id": "t2 aiming",
    "brief": "Aiming for 1,100 completed appointments next year.",
    "entity": "appointments",
    "value": 1100,
    "must_credit": false
  },
  {
    "id": "t3 want",
    "brief": "We want 1,100 completed appointments.",
    "entity": "appointments",
    "value": 1100,
    "must_credit": false
  },
  {
    "id": "t4 hoping",
    "brief": "Hoping to get to 1,100 appointments.",
    "entity": "appointments",
    "value": 1100,
    "must_credit": false
  },
  {
    "id": "t5 looking",
    "brief": "Looking for 1,100 appointments a month.",
    "entity": "appointments",
    "value": 1100,
    "must_credit": false
  },
  {
    "id": "t6 need",
    "brief": "Right now we do 920 appointments and need 1,100.",
    "entity": "appointments",
    "value": 1100,
    "must_credit": false
  },
  {
    "id": "t7 goal is",
    "brief": "Our goal is 1,100 appointments.",
    "entity": "appointments",
    "value": 1100,
    "must_credit": false
  },
  {
    "id": "t8 reach",
    "brief": "The goal is to reach 1,100.",
    "entity": "appointments",
    "value": 1100,
    "must_credit": false
  }
];
const factorCredit = (text: string, entity: string, value: number, unit = entity): boolean => {
  const candidate = { goal: { metric: '__contrast_goal__' }, options: [], constraints: [], outcomes: [], risks: [], links: [],
    factors: [{ label: entity, unit, baseline_value: value, baseline_known: false, provenance: 'inferred' }] } as unknown as CandidateModel;
  const factor = creditStatedFactorLevels(candidate, text).factors[0]!;
  return factor.baseline_known === true && factor.provenance === 'explicit';
};
it.each(delegateRows)('delegate $id: current-level credit contrast', ({ id, brief, entity, value, must_credit }) => {
  expect(levelWrittenApartFromTarget(value, entity, undefined, brief)).toBe(must_credit);
  expect(factorCredit(brief, entity, value)).toBe(must_credit);
  process.stdout.write(`S7PROBE ${JSON.stringify({ id, brief, entity, value, must_credit, credited: factorCredit(brief, entity, value) })}\n`);
});
it('delegate probe2 typed-target and MRR contrasts', () => {
  const brief = delegateRows[0]!.brief;
  expect(levelWrittenApartFromTarget(920, 'appointments', 1100, brief)).toBe(true);
  expect(levelWrittenApartFromTarget(1100, 'appointments', 1100, brief)).toBe(false);
  const mrr = 'Our team hit £85k MRR in March; we want to reach £120k.';
  expect(levelWrittenApartFromTarget(85000, 'GBP', 120000, mrr)).toBe(true);
  expect(factorCredit(mrr, 'MRR', 85000, 'GBP')).toBe(true);
});
it.each([
  'aim to hit', 'aiming to hit', 'to hit', 'hoping to hit', 'want to hit', 'need to hit', 'plan to hit', 'will hit',
])('purpose/future hit: %s never states the current level', purpose => {
  expect(factorCredit(`We ${purpose} 1,100 appointments.`, 'appointments', 1100)).toBe(false);
});
it('bare hit with a future time marker is a target; current beside need stays current', () => {
  expect(factorCredit('We hit 1,100 appointments next year.', 'appointments', 1100)).toBe(false);
  expect(factorCredit(delegateRows[11]!.brief, 'appointments', 920)).toBe(true);
});

it('a past deadline does not make bare hit a future intention', () => {
  expect(factorCredit('We hit 920 appointments by March last year.', 'appointments', 920)).toBe(true);
});
