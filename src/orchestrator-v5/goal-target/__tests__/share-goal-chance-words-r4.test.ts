import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import type { CandidateModel } from '../../agent-lane/admit-model.js';
import { buildModelFromBrief } from '../../agent-lane/runtime/build-model.js';
import { deliverableIsALaunch, shareGoalChanceWords } from '../share-goal-chance-words.js';

const DEADLINE = '2027-04-07';

describe('r4 L1-LAUNCHING-WORDS', () => {
  it.each([
    'the launch',
    'the feature launch',
    'launch',
    'the app launch',
    'launching the app',
    'the app launch in Europe',
    'launching our app',
    'launching checklist',
  ])('L1-LAUNCHING-WORDS positive: %s names the launch', deliverable => {
    expect(shareGoalChanceWords(deliverable, DEADLINE)).toBe('chance of launching by 7 April 2027');
    expect(deliverableIsALaunch(deliverable)).toBe(true);
  });

  it.each([
    'the pre-launch security review',
    'launch checklist',
    'launch marketing plan',
    'the security review before launch',
    'launching',
    'launching the',
    'the migration',
  ])('L1-LAUNCHING-WORDS control: %s retains the deliverable', deliverable => {
    expect(shareGoalChanceWords(deliverable, DEADLINE)).toBe(`chance of finishing ${deliverable} by 7 April 2027`);
    expect(deliverableIsALaunch(deliverable)).toBe(false);
  });

  it.each(['before', 'after', 'in', 'for', 'of', 'by', 'to', 'on', 'with', 'at', 'from', 'across'])(
    'R5-B-HEAD uses the head before %s rather than a later launch token', preposition => {
      expect(deliverableIsALaunch(`the app launch ${preposition} Europe`)).toBe(true);
      expect(deliverableIsALaunch(`the security review ${preposition} launch`)).toBe(false);
      expect(deliverableIsALaunch(`launching ${preposition} Europe`)).toBe(false);
    },
  );

  it.each([
    ['Finish the security review before launch by April', 'security review', 'the security review before launch', false],
    ['Deliver the app launch in Europe by April', 'app launch', 'the app launch in Europe', true],
    ['We are launching our app by April', 'app launch', 'launching our app', true],
    ['Finish the pre-launch security review by April', 'security review', 'the pre-launch security review', false],
    ['Finish the launch checklist by April', 'launch checklist', 'launch checklist', false],
  ] as const)('R5-B-BUILD real candidate names its own event: %s', async (brief, metric, deliverable, isLaunch) => {
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
    expect(shareGoalChanceWords(registeredDeliverable!, DEADLINE)).toBe(isLaunch
      ? 'chance of launching by 7 April 2027'
      : `chance of finishing ${deliverable} by 7 April 2027`);
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
