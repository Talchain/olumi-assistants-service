import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import type { CandidateModel } from '../../agent-lane/admit-model.js';
import { buildModelFromBrief } from '../../agent-lane/runtime/build-model.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { deliverableIsALaunch, shareGoalChanceWords } from '../share-goal-chance-words.js';

const DEADLINE = '2027-04-07';

const chanceLines = (deliverable: string): string[] => {
  const target = { comparator: 'at_least', value: 100, unit: `% of ${deliverable}`, by_date: DEADLINE };
  const graph = { nodes: [
    { id: 'carry', kind: 'option', label: 'Carry on' },
    { id: 'team', label: 'Team share', observed_state: { stated_time: { quantity: 'months_to_finish', low: 6, high: 10, unit: 'months' } } },
    { id: 'goal', label: 'Deliverable share' },
  ] };
  const point = { inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Licensed.',
    form: 'each', option_ids: ['carry'], pct_by_option: { carry: 39 }, target }] };
  const range = { inference_warnings: [{ code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'Stated time.',
    option_ids: ['carry'], target, range_by_option: { carry: {
      kind: 'stated_time', basis: 'stated_time', quantity: 'months_to_finish',
      stated_estimate: { low: 6, high: 10, unit: 'months' }, low: 0.2, high: 0.8,
      low_pct: 20, high_pct: 80, low_rounding: 'whole', high_rounding: 'whole', from: 'team', to: 'goal', among: 'all',
    } } }] };
  return [point, range].map(result => goalChanceScreenLinesForAgent(result, graph, true)[0]!.chance);
};

const expectChanceWords = (deliverable: string, isLaunch: boolean): void => {
  const words = isLaunch ? 'chance of launching by 7 April 2027' : `chance of finishing ${deliverable} by 7 April 2027`;
  expect(deliverableIsALaunch(deliverable)).toBe(isLaunch);
  expect(shareGoalChanceWords(deliverable, DEADLINE)).toBe(words);
  expect(chanceLines(deliverable)).toEqual([
    `‘Carry on’: about 39% ${words}, in this model.`,
    `‘Carry on’: between about 20% and 80% ${words}, in this model, from the slow end of your 6–10 months to the fast end.`,
  ]);
};

describe('r6 L1-LAUNCHING-WORDS closed grammar', () => {
  it.each([
    'the launch',
    'the feature launch',
    'launch',
    'the app launch',
    'our product launch',
    'launching the app',
    'the app launch in Europe',
    'launching our app',
    'a launch',
    'our launch',
    'the new app launch',
    'app launch',
    'launch in Europe',
    'the app launch across all European markets',
    'launching a new app',
    'launching the',
    'launching our',
    'launching a',
    'THE APP LAUNCH IN EUROPE',
  ])('L1-LAUNCHING-WORDS positive: %s names the launch', deliverable => {
    expectChanceWords(deliverable, true);
  });

  it.each([
    'the pre-launch security review',
    'launch checklist',
    'launch marketing plan',
    'the security review before launch',
    'the security review during launch',
    'following launch',
    'the app launch planned for Europe',
    'launching',
    'launching checklist',
    'launching the app in Europe',
    'launching the new mobile app',
    'the new mobile app launch',
    'launch in',
    'launch across all of the European markets',
    'the pre-launch launch',
    'the post-launch launch',
    'the pre-production launch',
    'launching our post-production app',
    'launch in pre-production',
    'the app launch across post-launch Europe',
    'the before launch',
    'the during launch',
    'once launch',
    'lest launch',
    'whenever launch',
    'wherever launch',
    'the either launch',
    'the neither launch',
    'launching our provided app',
    'launching the notwithstanding app',
    'the and launch',
    'launching our and app',
    'the migration',
  ])('L1-LAUNCHING-WORDS control: %s retains the deliverable', deliverable => {
    expectChanceWords(deliverable, false);
  });

  it('R6-B-NORMALISED whitespace and case do not change the whole-deliverable grammar', () => {
    expect(deliverableIsALaunch('  THE\tAPP\nLAUNCH IN EUROPE  ')).toBe(true);
    expect(shareGoalChanceWords('  THE\tAPP\nLAUNCH IN EUROPE  ', DEADLINE)).toBe('chance of launching by 7 April 2027');
    expect(deliverableIsALaunch('')).toBe(false);
    expect(shareGoalChanceWords('', DEADLINE)).toBe('chance of finishing  by 7 April 2027');
    expect(deliverableIsALaunch('the app launch.')).toBe(false);
    expect(shareGoalChanceWords('the app launch.', DEADLINE)).toBe('chance of finishing the app launch. by 7 April 2027');
  });

  it.each(['before', 'after', 'in', 'for', 'of', 'by', 'to', 'on', 'with', 'at', 'from', 'across'])(
    'R6-B-WHOLE only in/across + place may follow launch: %s', preposition => {
      expectChanceWords(`the app launch ${preposition} Europe`, preposition === 'in' || preposition === 'across');
      expectChanceWords(`the security review ${preposition} launch`, false);
      expectChanceWords(`launching ${preposition} Europe`, false);
    },
  );

  it.each([
    ['Finish the security review before launch by April', 'security review', 'the security review before launch', false],
    ['Deliver the app launch in Europe by April', 'app launch', 'the app launch in Europe', true],
    ['We are launching our app by April', 'app launch', 'launching our app', true],
    ['Finish the pre-launch security review by April', 'security review', 'the pre-launch security review', false],
    ['Finish the launch checklist by April', 'launch checklist', 'launch checklist', false],
    ['Finish the security review during launch by April', 'security review', 'the security review during launch', false],
    ['Finish following launch by April', 'launch', 'following launch', false],
    ['Deliver the app launch planned for Europe by April', 'app launch', 'the app launch planned for Europe', false],
  ] as const)('R6-B-BUILD real candidate names its own event: %s', async (brief, metric, deliverable, isLaunch) => {
    const candidate: CandidateModel = {
      goal: { kind: 'event_by_date', metric, deliverable, value: null, operator: '>=',
        unit: `% of ${deliverable}`, horizon_months: null, provenance: 'inferred' },
      options: [{ label: 'Carry on', provenance: 'ai_proposed', is_status_quo: true }],
      factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
    };
    let registeredDeliverable: string | undefined;
    const result = await buildModelFromBrief('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', brief,
      async (path, body) => {
        if (path.endsWith('/graph/register')) {
          const graph = (body as { graph: { nodes: { kind: string; goal_threshold_unit?: string }[] } }).graph;
          registeredDeliverable = graph.nodes.find(n => n.kind === 'goal')?.goal_threshold_unit?.replace(/^% of /u, '');
          return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
        }
        return { status: 200, json: { graph: { nodes: [], edges: [] } } };
      }, async () => ({ text: JSON.stringify(candidate) }));
    expect(result).toMatchObject({ ok: true, mutated: true });
    expect(registeredDeliverable).toBe(deliverable);
    expectChanceWords(registeredDeliverable!, isLaunch);
  });

  it('L1-LAUNCHING-WORDS whitespace scaling: 5k to 20k remains below 8x', () => {
    const inputs = [5000, 20000].map(n => `the${' '.repeat(n)}launch checklist`);
    for (const input of inputs) expect(deliverableIsALaunch(input)).toBe(false);
    for (const input of inputs) for (let i = 0; i < 1000; i++) shareGoalChanceWords(input, DEADLINE);
    const elapsed = inputs.map(input => {
      const start = performance.now();
      for (let i = 0; i < 10000; i++) shareGoalChanceWords(input, DEADLINE);
      return performance.now() - start;
    });
    const growth = elapsed[1]! / elapsed[0]!;
    process.stdout.write(`r4 launch words whitespace scaling ${JSON.stringify({ small: elapsed[0], large: elapsed[1], growth })}\n`);
    expect(growth).toBeLessThan(8);
  });
});
