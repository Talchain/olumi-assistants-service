// Import the Run producer first: the reverse order reaches PLACEHOLDER_PARTS_REASON before initialisation.
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE as TARGET } from '../../../orchestrator/context/option-result-source.js';
import {
  convertingOlumiEstimate,
  scoredGoalIdOf,
  targetBecause,
  targetTestabilityOf,
  untestableTargetParts,
  type TargetTestability,
} from '../../admission/target-testability.js';
import { GOAL_CHANCE_LICENSED } from '../goal-chance-licence.js';
import { GOAL_CHANCE_RANGE } from '../goal-chance-range.js';
import { goalChanceFactsForAgent } from '../goal-chance-range-agent.js';
import { scopeTargetNotTestableWithRanges } from '../scope-target-not-testable.js';
import { analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';
import {
  BASELINE_WAITS_FOR_OTHERS,
  OWN_REASON_FALLBACK,
  optionPathsOf,
  perOptionTargetReasons,
  perOptionTargetReasonsForRun,
} from '../target-testability-per-option.js';

type Rec = Record<string, any>;
type Link = { from: string; to: string };

// Science §(i) amendment (A): "case (c) stops blocking on a link whose size is an Olumi ESTIMATE
// with a natural effect that converts into goal units." The stored captures remain byte-identical.
// DL ruling, 7 October: the expected sentence is independent of the product constant.
const BASELINE = 'Not shown. It needs nothing more of its own; it waits until the other options can be tested against your target, so all are shown on the same footing.';
const read = (path: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url), 'utf8'));
const capture = (name: 'unseen-1' | 'unseen-2'): { graph: Rec; envelope: Rec } => {
  const blocks = read(`s4b/${name}-run`).blocks.filter((b: Rec) => b.type === 'analysis_result');
  expect(blocks.map((b: Rec) => b.type)).toEqual(['analysis_result']);
  return { graph: read(`s4b/${name}-read`).j.graph, envelope: blocks[0].enrichment };
};
const warning = (envelope: Rec, goalId = 'monthly_profit'): Rec => {
  const matches = envelope.inference_warnings.filter((w: Rec) => w.code === TARGET);
  expect(matches.map((w: Rec) => ({ code: w.code, node_ids: w.node_ids })))
    .toEqual([{ code: TARGET, node_ids: [goalId] }]);
  return matches[0]!;
};
const notTestable = (graph: Rec, evaluations?: readonly unknown[]): Extract<TargetTestability, { kind: 'not_testable' }> => {
  const verdict = targetTestabilityOf(graph, evaluations);
  expect(verdict.kind).toBe('not_testable');
  if (verdict.kind !== 'not_testable') throw new Error('The named graph must have a target-testability failure');
  return verdict;
};
const ends = (links: readonly Rec[]): Link[] => links.map(({ from, to }) => ({ from, to }));
const sameLink = (a: Link, b: Link): boolean => a.from === b.from && a.to === b.to;
const unsizedLinks = (verdict: Extract<TargetTestability, { kind: 'not_testable' }>): Link[] =>
  verdict.failures.filter(f => f.case === 'c').flatMap(f => f.links ?? (f.link === undefined ? [] : [f.link]));


// Adapt the private withToday/poundsInto builders in admission/__tests__/target-testability.test.ts:
// the same user-stated baseline and natural-effect conventions, with only the nodes these controls need.
const controlGraph = (): Rec => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Monthly profit', goal_threshold: 0.8, goal_threshold_raw: 24000,
      success_threshold: 24000, goal_threshold_cap: 30000, goal_threshold_unit: '£',
      goal_threshold_frame: 'level', threshold_source: 'user',
      observed_state: { value: 0, baseline: 0, raw_value: 0, unit: '£', cap: 30000, source: 'user_stated' } },
    { id: 'option_a', kind: 'option', label: 'A', interventions: { factor: { value: 1 } } },
    { id: 'factor', kind: 'factor', label: 'Sales', unit: 'orders' },
  ],
  edges: [
    { from: 'option_a', to: 'factor', strength: { mean: 1, std: 0.1 } },
    { from: 'factor', to: 'goal', strength: { mean: 0.2, std: 0.1 }, provenance: { source: 'user_specified' } },
  ],
});
const controlEnvelope = (optionIds: string[]): Rec => ({
  option_comparison: optionIds.map(option_id => ({ option_id, probability_of_goal: 0.5 })),
  inference_warnings: [],
});

describe('S-E GOALS S6: each option owns its target-testability reason', () => {
  it('R1 B9 served: carry_on_as_now waits, and the Run-wide message stays byte-identical', () => {
    // Served staging CEE df15c8c, captured by the Science lane, PR #2749 (sci/s2l-target-not-testable).
    const served = read('s-e-goals/b9-unseen1-df15c8c-readback').j;
    const envelope = served.analysis_result.enrichment;
    const input = warning(envelope);
    expect(input.message).toContain('Loyalty app deployment');
    expect(BASELINE_WAITS_FOR_OTHERS).toBe(BASELINE.slice('Not shown. '.length));

    const out = warning(scopeTargetNotTestableWithRanges(envelope, served.graph));
    expect(out.option_ids).toEqual(['carry_on_as_now']);
    expect(targetTestabilityOf(served.graph, envelope.identity_evaluations).kind).toBe('testable');
    expect(out.per_option).toBeUndefined();
    expect(out.say).toBe('');
    expect(out.message).toBe(input.message);
  });

  it('R2 s4b unseen-1: loyalty_app names its own failing link; carry_on_as_now waits', () => {
    const { graph, envelope } = capture('unseen-1');
    const input = warning(envelope);
    const verdict = notTestable(graph, envelope.identity_evaluations);
    const failing = unsizedLinks(verdict);
    const path = ends(optionPathsOf(graph, ['loyalty_app'], envelope.identity_evaluations).get('loyalty_app') ?? []);
    const onPath = failing.filter(link => path.some(own => sameLink(own, link)));
    const estimates = graph.edges.filter((edge: Rec) => path.some(link => link.from === edge.from && link.to === edge.to)
      && edge.provenance?.magnitude?.startsWith('olumi_'));
    expect(estimates).toHaveLength(3);
    expect(estimates.every((edge: Rec) => convertingOlumiEstimate(edge, graph, scoredGoalIdOf(graph)))).toBe(true);
    expect(onPath).toEqual([]);
    // The untouched capture records the old 11-link block; only its real placeholder still blocks now.
    expect(input.message).toContain('and 9 more.');
    expect(failing).toEqual([{ from: 'fourth_shop_fit_out_spend', to: 'monthly_profit' }]);
    const out = warning(scopeTargetNotTestableWithRanges(envelope, graph));
    expect(out.option_ids).toEqual(['loyalty_app', 'carry_on_as_now']);
    expect(Object.keys(out.per_option)).toEqual(out.option_ids);
    expect(out.per_option.carry_on_as_now.message).toBe(BASELINE);
    expect(out.per_option.loyalty_app.message).toBe(BASELINE);
    expect(out.say).toBe('');
    expect(out.message).toBe(input.message);
  });

  it('R3 s4b unseen-2: launch_loyalty_app names Loyalty app active, never fourth-shop nodes', () => {
    const { graph, envelope } = capture('unseen-2');
    expect(targetTestabilityOf(graph, envelope.identity_evaluations)).toEqual({ kind: 'testable', goal_id: 'monthly_profit' });
    const estimate = graph.edges.find((edge: Rec) => edge.from === 'loyalty_app_active'
      && edge.to === 'incremental_monthly_profit_from_loyalty_app');
    expect(convertingOlumiEstimate(estimate, graph, scoredGoalIdOf(graph))).toBe(true);
    const out = warning(scopeTargetNotTestableWithRanges(envelope, graph));
    expect(out.option_ids).toEqual(['carry_on_as_now', 'launch_loyalty_app']);
    expect(out.per_option).toBeUndefined();
    expect(out.say).toBe('');
    expect(out.message).toBe(warning(envelope).message);
  });

  it('R4 producer without ranges: records per_option before the untouched scoping seam', () => {
    const { graph, envelope } = capture('unseen-1');
    // Derive from unseen-1: remove TNT and every range/licence record. Retain the separate placeholder withhold;
    // expose a goal figure for loyalty_app and carry_on_as_now so this gate owns exactly those two options.
    const noRanges = structuredClone(envelope);
    noRanges.inference_warnings = noRanges.inference_warnings.filter((w: Rec) =>
      ![TARGET, GOAL_CHANCE_RANGE, GOAL_CHANCE_LICENSED].includes(w.code));
    noRanges.option_comparison = noRanges.option_comparison.map((row: Rec) =>
      ['loyalty_app', 'carry_on_as_now'].includes(row.option_id) ? { ...row, probability_of_goal: 0.5 } : row);
    expect(noRanges.inference_warnings.filter((w: Rec) =>
      [TARGET, GOAL_CHANCE_RANGE, GOAL_CHANCE_LICENSED].includes(w.code))).toEqual([]);
    expect(Object.keys(goalChanceFactsForAgent(noRanges, graph, true).goal_chance_range_display ?? {})).toEqual([]);
    const evaluations = noRanges.identity_evaluations;
    const verdict = notTestable(graph, evaluations);
    const produced = withholdGoalFiguresForUntestableTarget(noRanges, graph);
    const recorded = warning(produced);
    expect(recorded.option_ids).toEqual(['loyalty_app', 'carry_on_as_now']);
    expect(Object.keys(recorded.per_option)).toEqual(recorded.option_ids);
    expect(recorded.per_option).toEqual(perOptionTargetReasonsForRun(graph, verdict, recorded.option_ids, evaluations));
    expect(recorded.per_option.carry_on_as_now.message).toBe(BASELINE);
    expect(recorded.per_option.loyalty_app.message).toBe(BASELINE);
    expect(recorded.say).not.toContain('Loyalty-app gross-profit uplift');
    expect(Object.keys(goalChanceFactsForAgent(produced, graph, true).goal_chance_range_display ?? {})).toEqual([]);
    const scoped = scopeTargetNotTestableWithRanges(produced, graph);
    expect(scoped).toBe(produced);
    expect(warning(scoped).per_option).toBe(recorded.per_option);
  });

  it('R5(a) single option: its unsized factor-to-goal link is also the Run-wide reason', () => {
    const graph = controlGraph();
    const verdict = notTestable(graph);
    expect(verdict).toEqual({ kind: 'not_testable', goal_id: 'goal', failures: [{
      precondition: 'P5', case: 'c', code: 'goal_path_unsized', lever: 'Sales', link_to: 'Monthly profit',
      link: { from: 'factor', to: 'goal' }, links: [{ from: 'factor', to: 'goal' }],
    }] });
    expect(ends(optionPathsOf(graph, ['option_a']).get('option_a') ?? [])).toEqual([{ from: 'factor', to: 'goal' }]);
    const out = warning(withholdGoalFiguresForUntestableTarget(controlEnvelope(['option_a']), graph), 'goal');
    expect(out.option_ids).toEqual(['option_a']);
    expect(Object.keys(out.per_option)).toEqual(['option_a']);
    expect(out.message).toContain('a size for the link from Sales to Monthly profit');
    expect(out.per_option.option_a.message).toContain('a size for the link from Sales to Monthly profit');
    expect(out.per_option.option_a.message).not.toBe(BASELINE);
  });

  it("R5(b) goal-level failure: status_quo also needs today's level", () => {
    const graph = controlGraph();
    delete graph.nodes.find((n: Rec) => n.id === 'goal').observed_state;
    graph.nodes.push({ id: 'status_quo', kind: 'option', label: 'Status quo', interventions: {} });
    graph.edges.find((link: Rec) => link.from === 'factor' && link.to === 'goal').provenance = {
      source: 'user_specified', natural_effect: { amount: 10, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'orders' },
    };
    expect(notTestable(graph)).toEqual({ kind: 'not_testable', goal_id: 'goal', failures: [
      { precondition: 'P1', case: 'a', code: 'missing_goal_baseline' },
    ] });
    expect(optionPathsOf(graph, ['status_quo']).get('status_quo')).toEqual([]);
    const out = warning(withholdGoalFiguresForUntestableTarget(controlEnvelope(['option_a', 'status_quo']), graph), 'goal');
    expect(out.option_ids).toEqual(['option_a', 'status_quo']);
    expect(Object.keys(out.per_option)).toEqual(out.option_ids);
    for (const id of ['option_a', 'status_quo']) {
      expect(out.per_option[id].message, id).not.toBe(BASELINE);
      expect(out.per_option[id].message, id).toContain("today's level of Monthly profit");
    }
    expect(out.per_option.status_quo.message).toBe(out.per_option.option_a.message);
  });

  it.each(['olumi_placeholder', 'olumi_estimate'])('amendment (A) CONTRAST: %s without a converting natural effect still blocks its own option', (magnitude) => {
    const graph = controlGraph();
    const edge = graph.edges.find((link: Rec) => link.from === 'factor' && link.to === 'goal');
    edge.provenance = { source: 'cee', magnitude };
    expect(convertingOlumiEstimate(edge, graph, scoredGoalIdOf(graph))).toBe(false);
    const verdict = notTestable(graph);
    expect(unsizedLinks(verdict)).toEqual([{ from: 'factor', to: 'goal' }]);
    const out = warning(withholdGoalFiguresForUntestableTarget(controlEnvelope(['option_a']), graph), 'goal');
    expect(out.per_option.option_a.message).toBe("Not shown. It can't yet be tested against your target (£24,000), because it needs a size for the link from Sales to Monthly profit. Roughly how much Monthly profit in £ does a change in Sales bring?");
  });

  it('R6 fallback: no named-link count fits 388 characters, so the own-reason fallback is exact', () => {
    const graph = controlGraph();
    const longLabel = `Sales ${'very long label '.repeat(40)}`.trim();
    graph.nodes.find((n: Rec) => n.id === 'factor').label = longLabel;
    const verdict = notTestable(graph);
    expect(unsizedLinks(verdict)).toEqual([{ from: 'factor', to: 'goal' }]);
    expect(verdict.failures[0]!.lever).toBe(longLabel);
    const ownPath = [{ from: 'factor', to: 'goal' }];
    expect(ends(optionPathsOf(graph, ['option_a']).get('option_a') ?? [])).toEqual(ownPath);
    for (const count of [3, 2, 1]) {
      const parts = untestableTargetParts(graph, verdict, count);
      if (parts === null) throw new Error(`R6 option_a must have readable parts at named-link count ${count}`);
      const candidate = `It can't yet be tested against your target (${parts.target}), because ${targetBecause(parts)}.${parts.question !== null ? ` ${parts.question}` : ''}`;
      expect(candidate, `option_a, named-link count ${count}`).toContain(`from ${longLabel} to Monthly profit`);
      expect(candidate.length, `option_a, named-link count ${count}`).toBeGreaterThan(388);
    }
    const reasons = perOptionTargetReasons(graph, verdict, new Map([['option_a', ownPath]]), ['option_a']);
    expect(Object.keys(reasons)).toEqual(['option_a']);
    expect(OWN_REASON_FALLBACK).toBe("It can't yet be tested against your target.");
    expect(reasons.option_a!.message).toBe("Not shown. It can't yet be tested against your target.");
  });

  it('R8 Agent view (Codex r1 P2): the panel prose never reaches the model; the projection is exactly the pre-S6 one', () => {
    const served = read('s-e-goals/b9-unseen1-df15c8c-readback').j;
    const scoped = scopeTargetNotTestableWithRanges(served.analysis_result.enrichment, served.graph) as Rec;
    expect(warning(scoped).per_option).toBeUndefined();
    expect(warning(scoped).say).toBe('');
    const block = { ...served.analysis_result, enrichment: scoped };
    const withoutPanel = structuredClone(block);
    delete warning(withoutPanel.enrichment).per_option;
    const agent = analysisResultForAgent(block, served.graph) as Rec;
    expect(JSON.stringify(agent)).not.toContain('per_option');
    expect(JSON.stringify(agent)).not.toContain('It needs nothing more of its own');
    // CONTROL: the Agent keeps the warning's scoped identity (S2l #2749 rules its Run-wide words beside a range), and
    // nothing else in its view moved.
    expect(warning(agent.enrichment).option_ids).toEqual(['carry_on_as_now']);
    expect(agent).toEqual(analysisResultForAgent(withoutPanel, served.graph));
  });
});
