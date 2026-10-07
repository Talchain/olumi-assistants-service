import { describe, expect, it } from 'vitest';
import {
  notTargetTestableSentence, targetNotTestableWarning, targetTestabilityOf, untestableTargetParts, untestableTargetTail,
  type TargetTestability,
} from '../target-testability.js';
import { sayGoalChange } from '../../agent-lane/limit-frame.js';
import { sayFigure } from '../../agent-lane/say-figure.js';
import { readinessViewOf } from '../../agent-lane/readiness-view.js';
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, unknown>;
// Verbatim goal from cut-6 f-1 (scenario 1dcb5c91, CEE 0f2c3b2):
// acceptance-pd/output/cut6-witness-20261007/f-1/wire/read-P1-draft-1791329842499.json, j.graph.nodes.
// Unlike the older Z1 fixture, this witnessed goal has NO goal_threshold_unit.
const FOUNDER_GOAL: Rec = {
  id: 'productivity', ref: 'G1', kind: 'goal', label: 'productivity', provenance: 'from_brief',
  goal_direction: '>=', threshold_source: 'brief_extraction', goal_threshold_raw: 0.1, goal_threshold_frame: 'change_rel',
};
const graphWith = (fields: Rec = {}) => ({ nodes: [{ ...FOUNDER_GOAL, ...fields }], edges: [] });
const missingLevel: TargetTestability = {
  kind: 'not_testable', goal_id: 'productivity',
  failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }],
};
const TAIL = "I can't yet say how likely any option is to keep productivity up at least 10% from today: "
  + "I need today's level. What's today's level of productivity?";
const SENTENCE = "Olumi can compare your options, but can't yet test them against your target (up at least 10% from today), "
  + "because it needs today's level of productivity. What's today's level of productivity?";
const figure = (value: number, unit: string | undefined): string => sayFigure(value, unit ?? '');

describe('W6: untestable change targets use the level card formatter', () => {
  it('witnessed founder draft: +10% is a change, never a raw level of 0.1', () => {
    const graph = graphWith();
    const verdict = targetTestabilityOf(graph);
    expect(verdict).toEqual(missingLevel);
    expect(untestableTargetTail(graph, verdict)).toBe(TAIL);
    expect(notTargetTestableSentence(graph, verdict)).toBe(SENTENCE);
    const cardTarget = sayGoalChange('change_rel', 0.1, undefined, figure, '>=');
    expect(cardTarget).toBe('up at least 10% from today');
    expect(untestableTargetParts(graph, verdict)).toMatchObject({ target: cardTarget, tailTarget: cardTarget });
    for (const sentence of [untestableTargetTail(graph, verdict)!, notTargetTestableSentence(graph, verdict)!]) {
      expect(sentence).not.toContain('0.1');
    }
  });

  it.each([
    ['<=', -0.05, 'down at least 5% from today'],
    ['>=', -0.05, 'down no more than 5% from today'],
    ['<=', 0.1, 'up no more than 10% from today'],
    ['>', 0.1, 'up more than 10% from today'],
  ])('relative target held %s at %s: %s', (held, value, expected) => {
    const graph = graphWith({ goal_direction: held, goal_threshold_raw: value });
    const verdict = targetTestabilityOf(graph);
    expect(sayGoalChange('change_rel', value as number, undefined, figure, held)).toBe(expected);
    expect(untestableTargetParts(graph, verdict)).toMatchObject({ target: expected, tailTarget: expected });
    expect(untestableTargetTail(graph, verdict)).toContain(`keep productivity ${expected}:`);
    expect(notTargetTestableSentence(graph, verdict)).toContain(`target (${expected})`);
  });

  it.each([
    ['>=', 5000, 'GBP', 'up at least £5,000 from today'],
    ['<=', -2, 'points', 'down at least 2 points from today'],
  ])('absolute change held %s at %s %s: %s', (held, value, unit, expected) => {
    const graph = graphWith({ goal_direction: held, goal_threshold_frame: 'change_abs', goal_threshold_raw: value, goal_threshold_unit: unit });
    const verdict = targetTestabilityOf(graph);
    expect(sayGoalChange('change_abs', value as number, unit as string, figure, held)).toBe(expected);
    expect(untestableTargetParts(graph, verdict)).toMatchObject({ target: expected, tailTarget: expected });
    expect(untestableTargetTail(graph, verdict)).toContain(`keep productivity ${expected}:`);
  });

  it('a level target keeps the existing tail and readiness sentence byte-for-byte', () => {
    const graph = graphWith({ label: 'funding', goal_threshold_frame: 'level', goal_threshold_raw: 1200000, goal_threshold_unit: '£' });
    // Isolate the wording control's missing-level case; path admission has separate existing coverage.
    expect(untestableTargetTail(graph, missingLevel)).toBe("I can't yet say how likely any option is to keep funding at or above £1,200,000: I need today's level. What's today's level of funding?");
    expect(notTargetTestableSentence(graph, missingLevel)).toBe("Olumi can compare your options, but can't yet test them against your target (at least £1,200,000), because it needs today's level of funding. What's today's level of funding?");
  });

  it('the run_analysis warning and actual readiness view agree with the founder tail', () => {
    const graph = graphWith();
    const warning = targetNotTestableWarning(graph, targetTestabilityOf(graph), ['hire_a_tech_lead'], GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(warning).toMatchObject({ message: `Not shown. ${SENTENCE}`, say: TAIL });
    expect(readinessViewOf(graph).target_not_testable).toBe(SENTENCE);
    const run = withholdGoalFiguresForUntestableTarget({ option_comparison: [{ option_id: 'hire_a_tech_lead', probability_of_goal: 0.5 }] }, graph);
    expect((run as { inference_warnings?: unknown[] }).inference_warnings).toContainEqual(expect.objectContaining({
      code: GOAL_FIGURES_TARGET_NOT_TESTABLE, message: `Not shown. ${SENTENCE}`, say: TAIL,
    }));
  });

  it('a row-only relative target uses that row\'s frame and held comparator', () => {
    const goal = { ...FOUNDER_GOAL };
    delete goal.goal_threshold_raw;
    delete goal.goal_threshold_frame;
    delete goal.goal_direction;
    const graph = { nodes: [goal], edges: [], goal_constraints: [
      { node_id: 'productivity', value: -0.05, value_frame: 'change_rel', operator: '<=' },
    ] };
    expect(untestableTargetParts(graph, missingLevel)).toMatchObject({ target: 'down at least 5% from today', tailTarget: 'down at least 5% from today' });
  });

  it('band acknowledgement and unscorable-comparator sentences also use the change phrase', () => {
    const graph = {
      nodes: [{ ...FOUNDER_GOAL }, { id: 'headcount', kind: 'factor', label: 'headcount' }],
      edges: [{ from: 'headcount', to: 'productivity', strength: { mean: 0.5 }, provenance_display: 'user_set', provenance: { source: 'user_specified' } }],
    };
    const linkGap: TargetTestability = { kind: 'not_testable', goal_id: 'productivity', failures: [
      { precondition: 'P5', case: 'c', code: 'goal_path_unsized', lever: 'headcount', link_to: 'productivity', link: { from: 'headcount', to: 'productivity' } },
    ] };
    expect(untestableTargetParts(graph, linkGap)?.question).toContain('To test your up at least 10% from today target');
    const strictGraph = graphWith({ goal_direction: '<', goal_threshold_raw: -0.05 });
    const gap: TargetTestability = { kind: 'not_testable', goal_id: 'productivity', failures: [
      { precondition: 'P3', case: 'b', code: 'comparator_unscorable' },
    ] };
    expect(untestableTargetTail(strictGraph, gap)).toBe("I can't yet say how likely any option is to keep productivity down more than 5% from today: Olumi can't yet test a 'down more than 5% from today' target.");
    expect(notTargetTestableSentence(strictGraph, gap)).toContain("it can't yet test a 'down more than 5% from today' target on productivity");
  });
});
