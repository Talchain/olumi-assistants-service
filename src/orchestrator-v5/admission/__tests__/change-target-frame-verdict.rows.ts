// Shared assertion rows: Vitest registers these, while the W6b proof runs them directly with tsx (no Vitest).
import assert from 'node:assert/strict';
import type * as Target from '../target-testability.js';
import type { sayGoalChange } from '../../agent-lane/limit-frame.js';
import { readinessViewOf } from '../../agent-lane/readiness-view.js';
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, unknown>;
type Api = typeof Target & { sayGoalChange: typeof sayGoalChange };
const goal = (fields: Rec = {}): Rec => ({ id: 'productivity', kind: 'goal', label: 'productivity', ...fields });
const rowGraph = (frame: string, value = 0.1, operator = '>=') => ({
  // Stale node frame/normalisation must not turn a row-only change into a level.
  nodes: [goal({ goal_threshold_frame: 'level', goal_threshold: 0 })], edges: [],
  goal_constraints: [{ node_id: 'productivity', value, value_frame: frame, operator }],
});
const missingLevel: Target.TargetTestability = { kind: 'not_testable', goal_id: 'productivity',
  failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] };
const sentence = "Olumi can compare your options, but can't yet test them against your target (up at least 10% from today), "
  + "because it needs today's level of productivity. What's today's level of productivity?";
const tail = "I can't yet say how likely any option is to keep productivity up at least 10% from today: "
  + "I need today's level. What's today's level of productivity?";
const bandGraph = (frame: string) => ({ nodes: [
  goal({ goal_threshold_raw: frame === 'level' ? 1200000 : 0.1, goal_threshold_frame: frame,
    goal_threshold_unit: '£', goal_direction: '>=', goal_threshold: 0.8,
    observed_state: { baseline: 0, raw_value: 0, unit: '£' } }),
  { id: 'hire', kind: 'option' }, { id: 'headcount', kind: 'factor', label: 'headcount' },
], edges: [{ from: 'hire', to: 'headcount' }, {
  from: 'headcount', to: 'productivity', strength: { mean: 0.5 },
  provenance_display: 'user_set', provenance: { source: 'user_specified' },
}] });

export const changeTargetFrameRows: ReadonlyArray<{ name: string; check: (api: Api) => void }> = [
  { name: 'RED 1: row-only relative change has no level-only reasons and matching words', check(api) {
    const graph = rowGraph('change_rel');
    const verdict = api.targetTestabilityOf(graph);
    assert.deepEqual(verdict, missingLevel);
    assert.equal(api.notTargetTestableSentence(graph, verdict), sentence);
    assert.equal(api.untestableTargetTail(graph, verdict), tail);
    assert.deepEqual(api.targetNotTestableWarning(graph, verdict, ['hire'], 'TARGET')?.say, tail);
    assert.equal(readinessViewOf(graph).target_not_testable, sentence);
    const run: { option_comparison: unknown[]; inference_warnings?: Array<{ code: string; message: string; say?: string }> } =
      withholdGoalFiguresForUntestableTarget({ option_comparison: [{ option_id: 'hire', probability_of_goal: 0.5 }] }, graph);
    assert(run.inference_warnings?.some(w => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE
      && w.message === `Not shown. ${sentence}` && w.say === tail));
    // Both sides of the row-held comparator, including the strict capability gap.
    const ceiling = rowGraph('change_rel', -0.05, '<=');
    assert.deepEqual(api.targetTestabilityOf(ceiling), missingLevel);
    assert.equal(api.untestableTargetParts(ceiling, api.targetTestabilityOf(ceiling))?.target, 'down at least 5% from today');
    const strict = rowGraph('change_rel', -0.05, '<');
    assert.deepEqual(api.targetTestabilityOf(strict), { ...missingLevel, failures: [
      ...missingLevel.failures, { precondition: 'P3', case: 'b', code: 'comparator_unscorable' },
    ] });
    // Without a node-held figure, a stale node comparator cannot override the target row's own comparator.
    strict.nodes[0].goal_direction = '>=';
    assert.deepEqual(api.targetTestabilityOf(strict), { ...missingLevel, failures: [
      ...missingLevel.failures, { precondition: 'P3', case: 'b', code: 'comparator_unscorable' },
    ] });
    assert.equal(api.untestableTargetParts(strict, api.targetTestabilityOf(strict))?.target, 'down more than 5% from today');
  } },
  { name: 'RED 2: absolute changes need no today level, on the node or only its row', check(api) {
    for (const graph of [rowGraph('change_abs', 5000), {
      nodes: [goal({ goal_threshold_raw: 5000, goal_threshold_frame: 'change_abs', goal_direction: '>=' })], edges: [],
    }]) {
      const verdict = api.targetTestabilityOf(graph);
      assert.deepEqual(verdict, { kind: 'unchecked', goal_id: 'productivity', unchecked: ['P5'] });
      assert.equal(api.notTargetTestableSentence(graph, verdict), null);
      assert.equal(api.untestableTargetTail(graph, verdict), null);
      assert.equal(api.targetNotTestableWarning(graph, verdict, ['hire'], 'TARGET'), null);
      assert.equal(readinessViewOf(graph).target_not_testable ?? null, null);
      const response = { option_comparison: [{ option_id: 'hire', probability_of_goal: 0.5 }] };
      assert.equal(withholdGoalFiguresForUntestableTarget(response, graph), response);
    }
  } },
  { name: 'RED 3: change band acknowledgement wraps the target (hand-built P5 verdict)', check(api) {
    const graph = bandGraph('change_rel');
    // Real change verdicts skip level-only P5: this wording branch is reachable only with a supplied P5 verdict.
    assert.deepEqual(api.targetTestabilityOf(graph), { kind: 'unchecked', goal_id: 'productivity', unchecked: ['P5'] });
    const verdict: Target.TargetTestability = { kind: 'not_testable', goal_id: 'productivity', failures: [
      { precondition: 'P5', case: 'c', code: 'goal_path_unsized', lever: 'headcount', link_to: 'productivity',
        link: { from: 'headcount', to: 'productivity' } },
    ] };
    assert.equal(api.untestableTargetParts(graph, verdict)?.question,
      'You set this link as strong. To test your target (up at least 10% from today) I need it in £: '
      + 'roughly how much productivity in £ does a change in headcount bring?');
  } },
  { name: 'CONTROL: level verdict and words, including the real band acknowledgement, stay byte-identical', check(api) {
    const graph = bandGraph('level');
    const verdict = api.targetTestabilityOf(graph);
    assert.deepEqual(verdict, { kind: 'not_testable', goal_id: 'productivity', failures: [
      { precondition: 'P5', case: 'c', code: 'goal_path_unsized', links: [{ from: 'headcount', to: 'productivity' }],
        lever: 'headcount', link_to: 'productivity', link: { from: 'headcount', to: 'productivity' } },
    ] });
    const question = 'You set this link as strong. To test your £1,200,000 target I need it in £: '
      + 'roughly how much productivity in £ does a change in headcount bring?';
    assert.equal(api.untestableTargetParts(graph, verdict)?.question, question);
    assert.equal(api.notTargetTestableSentence(graph, verdict),
      "Olumi can compare your options, but can't yet test them against your target (at least £1,200,000), "
      + 'because it needs a size for the link from headcount to productivity. ' + question);
    assert.equal(api.untestableTargetTail(graph, verdict),
      "I can't yet say how likely any option is to keep productivity at or above £1,200,000: "
      + 'I need a size for the link from headcount to productivity. ' + question);
    delete (graph.nodes[0] as Rec).observed_state;
    const noToday = api.targetTestabilityOf(graph);
    assert(noToday.kind === 'not_testable');
    assert.deepEqual(noToday.failures[0], missingLevel.failures[0]);
    const offScale = rowGraph('level');
    const offVerdict = api.targetTestabilityOf(offScale);
    assert(offVerdict.kind === 'not_testable');
    assert(offVerdict.failures.some(f => f.code === 'threshold_off_scale'));
  } },
  { name: 'CONTROL: node-held W6 relative target still asks for today through one producer', check(api) {
    const graph = { nodes: [goal({ goal_threshold_raw: 0.1, goal_threshold_frame: 'change_rel', goal_direction: '>=' })], edges: [] };
    const verdict = api.targetTestabilityOf(graph);
    assert.deepEqual(verdict, missingLevel);
    assert.equal(api.notTargetTestableSentence(graph, verdict), sentence);
    assert.equal(api.untestableTargetTail(graph, verdict), tail);
    assert.equal(api.targetNotTestableWarning(graph, verdict, ['hire'], 'TARGET')?.message, `Not shown. ${sentence}`);
    assert.equal(readinessViewOf(graph).target_not_testable, sentence);
  } },
  { name: 'CONTROL: relative changes with today and legacy delta remain unchecked', check(api) {
    for (const frame of ['change_rel', 'delta']) {
      const graph = { nodes: [goal({ goal_threshold_raw: 0.1, goal_threshold_frame: frame, goal_direction: '>=',
        observed_state: { baseline: 0.5 } })], edges: [] };
      assert.deepEqual(api.targetTestabilityOf(graph), { kind: 'unchecked', goal_id: 'productivity', unchecked: ['P5'] });
    }
  } },
  { name: 'RED 4: zero change bounds say no higher/lower than today locally', check(api) {
    const figure = (n: number) => String(n);
    for (const frame of ['change_rel', 'change_abs']) {
      assert.equal(api.sayGoalChange(frame, 0, undefined, figure, '<='), 'no higher than today');
      assert.equal(api.sayGoalChange(frame, 0, undefined, figure, '>='), 'no lower than today');
      assert.equal(api.sayGoalChange(frame, -0, undefined, figure, '<='), 'no higher than today');
    }
    assert.equal(api.sayGoalChange('change_rel', 0, undefined, figure, '<'), 'up less than 0% from today');
    assert.equal(api.sayGoalChange('change_rel', 0, undefined, figure), 'up 0% from today');
    assert.equal(api.sayGoalChange('level', 0, undefined, figure, '<='), undefined);
  } },
];
