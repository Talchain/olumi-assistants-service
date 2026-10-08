/** Captured-wire regression rows collected by the default and required CI Vitest suites. */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { scopeTargetNotTestableWithRanges } from '../scope-target-not-testable.js';
import { GOAL_CHANCE_RANGE } from '../goal-chance-range.js';
import { goalChanceFactsForAgent } from '../goal-chance-range-agent.js';
import { decisionReviewFor } from '../../agent-lane/decision-review-press.js';
import { convertingOlumiEstimate, targetTestabilityOf, untestableTargetTail } from '../../admission/target-testability.js';
import { GOAL_CHANCE_LICENSED } from '../goal-chance-licence.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE as TARGET } from '../../../orchestrator/context/option-result-source.js';
import { goalChanceLineOwed, goalChanceWithheldForAgent } from '../../agent-lane/goal-chance-withheld.js';
import { enforceAgentLaneLeaderClaimsAtWire } from '../../agent-lane/withheld-leader-fail-closed.js';

// Science §(i) amendment (A): "case (c) stops blocking on a link whose size is an Olumi ESTIMATE
// with a natural effect that converts into goal units." Contrasts below keep refused conversion and placeholders blocked.
type Rec = Record<string, any>;
type Wire = Parameters<typeof enforceAgentLaneLeaderClaimsAtWire>[0];
const read = (name: string): Rec => JSON.parse(readFileSync(new URL(`./fixtures/s4b/${name}.json`, import.meta.url), 'utf8'));
const warnings = (e: Rec): Rec[] => e.inference_warnings;
const warning = (e: Rec, code = TARGET): Rec | undefined => warnings(e).find(w => w.code === code);
const optionIds = (e: Rec): string[] => e.option_comparison.map((o: Rec) => o.option_id);
const labelsOf = (g: Rec): Map<string, string> => new Map(g.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => [n.id, n.label]));
const captures = ['unseen-1', 'unseen-2'].map(name => {
  const wire = read(`${name}-run`);
  const graph = read(`${name}-read`).j.graph;
  const block = wire.blocks.find((b: Rec) => b.type === 'analysis_result');
  return { name, wire, graph, block, envelope: block.enrichment as Rec };
});

describe.each(captures)('$name: captured Run', ({ name, wire, graph, block, envelope }) => {
  const rangeIds: string[] = warning(envelope, GOAL_CHANCE_RANGE)!.option_ids;
  const remaining = optionIds(envelope).filter(id => !rangeIds.includes(id));
  const labels = labelsOf(graph);
  const oldSay: string = warning(envelope)!.say;
  const linkedIds = remaining.filter(id => Object.keys(graph.nodes.find((n: Rec) => n.id === id)?.interventions ?? {}).length > 0);
  const baselineId = remaining.find(id => !linkedIds.includes(id))!;
  const named = linkedIds.map(id => `‘${labels.get(id)}’`).join(' or ');
  const needs = name === 'unseen-1'
    ? 'a size for the links from Loyalty-app gross-profit uplift to monthly profit, from Loyalty-app operating cost to monthly profit and from Loyalty-app incremental sales to Loyalty-app gross-profit uplift'
    : 'a size for the link from Loyalty app active to Incremental monthly profit from loyalty app';
  const question = oldSay.slice(oldSay.indexOf(' Roughly'));
  const expectedSay = `${oldSay.replace('how likely any option is to', `how likely ${named} is to`).split(': I need')[0]}: I need ${needs}.${question}`;
  const scoped = (): Rec => scopeTargetNotTestableWithRanges(envelope, graph);

  it(`${name}: untouched capture witnesses the base contradiction`, () => {
    expect(rangeIds.length).toBe(2);
    expect(remaining.length).toBe(2);
    expect(warning(envelope)!.option_ids.some((id: string) => rangeIds.includes(id))).toBeTruthy();
    expect(oldSay.includes('how likely any option is to')).toBeTruthy();
    expect(wire.assistant_text.includes('how likely any option is to')).toBeTruthy();
  });

  it(`${name}: target ids exclude ranges and retain every withheld option (RED at base)`, () => {
    expect(warning(scoped())!.option_ids).toEqual(remaining);
    expect(warning(scoped())!.option_ids.every((id: string) => !rangeIds.includes(id))).toBeTruthy();
  });

  it(`${name}: say names only W’s options with a failing link, keeping their links and ask (RED at base)`, () => {
    const say: string = warning(scoped())!.say;
    // The captured estimates now convert: their old case-(c) ask must be absent.
    expect(say).toBe('');
    expect(!say.includes('any option')).toBeTruthy();
    expect(!say.includes('—')).toBeTruthy();
    for (const id of rangeIds) expect(!say.includes(`‘${labels.get(id)}’`)).toBeTruthy();
    expect(say).not.toContain(`‘${labels.get(baselineId)}’`);
    expect(say).not.toContain(question);
  });

  it(`${name}: panel message stays byte-identical to the base producer`, () => {
    expect(warning(scoped())!.message).toBe(warning(envelope)!.message);
    const missingLabel = { ...graph, nodes: graph.nodes.map((n: Rec) => n.id === linkedIds[0] ? { ...n, label: undefined } : n) };
    const out = scopeTargetNotTestableWithRanges(envelope, missingLabel);
    expect(warning(out)!.message).toBe(warning(envelope)!.message);
    expect(warning(out)!.say).toBe('');
  });

  it(`${name}: served Challenge with the capture's analysis_ready retains the range opening`, () => {
    const resultBlock = { ...block, enrichment: scoped() };
    const review = decisionReviewFor('s4b-review', { graph, analysisResult: resultBlock, analysisReady: wire.analysis_ready,
      analysisState: wire.analysis_state, graphHash: block.computed_against_hash });
    expect(review.bound).toBe(true);
    expect(review.reply).toContain('This run shows some options’ chances only as a range.');
    expect(review.reply).not.toContain('each option');
    expect(review.reply).not.toContain('any option');
    expect(warning(envelope, GOAL_CHANCE_RANGE)!.message).toBe(warning(resultBlock.enrichment, GOAL_CHANCE_RANGE)!.message);
  });

  it(`${name}: narration and actual wire leader gate keep scoped say (RED at base)`, () => {
    const resultBlock = { ...block, enrichment: scoped() };
    const goalChance = goalChanceWithheldForAgent(resultBlock, graph);
    expect(goalChance?.say ?? '').not.toContain(expectedSay);
    expect(goalChance?.say ?? '').not.toContain('any option');
    const review = decisionReviewFor('s4b-review', { graph, analysisResult: resultBlock, analysisState: wire.analysis_state, graphHash: block.computed_against_hash });
    expect(review.reply).not.toContain(expectedSay);
    expect(review.reply).not.toContain('any option');
    const owed = goalChanceLineOwed([{ ran: true, goal_chance: goalChance }], 'Your results are ready.');
    expect(owed).toBe(goalChance?.say ?? null);
    const protectedSay = goalChance?.say ?? review.reply;
    const projected = enforceAgentLaneLeaderClaimsAtWire({
      ...wire, blocks: [resultBlock], assistant_text: `${protectedSay}\n\n${labels.get(rangeIds[0]!)} is the best option.`,
      analysis_state: { ...wire.analysis_state, run_state: { kind: 'complete_current' },
        leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
    } as Wire, { requestId: `s4b-${name}`, exitPath: 'agent_lane_v1', mayNameLeadingOption: false,
      separationEstablished: false, leaderClaimWithheldReason: 'goal_path_unsized', graph,
      analysisReady: undefined, protectedGoalChanceSay: protectedSay });
    expect(projected.response.assistant_text!).not.toContain(expectedSay);
    expect(projected.response.assistant_text!).not.toContain('any option');
    expect(!projected.response.assistant_text!.includes('is the best option')).toBeTruthy();
  });

  it(`${name}: NO range control keeps the entire warning and say byte-identical`, () => {
    const noRange = { ...envelope, inference_warnings: warnings(envelope).filter(w => w.code !== GOAL_CHANCE_RANGE) };
    const out = scopeTargetNotTestableWithRanges(noRange, graph);
    expect(out).toBe(noRange);
    expect(warning(out)).toEqual(warning(envelope));
    expect(warning(out)!.say).toBe(oldSay);
    expect(goalChanceWithheldForAgent({ enrichment: out }, graph)).toEqual(goalChanceWithheldForAgent({ enrichment: noRange }));
  });

  it(`${name}: all options ranged removes target warning (RED at base)`, () => {
    const range = warning(envelope, GOAL_CHANCE_RANGE)!;
    const allRange = { ...envelope, inference_warnings: warnings(envelope).map(w => w === range ? {
      ...w, option_ids: optionIds(envelope), range_by_option: Object.fromEntries(optionIds(envelope).map(id => [id, range.range_by_option[rangeIds[0]!]])),
    } : w) };
    const out = scopeTargetNotTestableWithRanges(allRange, graph);
    expect(warning(out)).toBe(undefined);
    expect(Object.keys(goalChanceFactsForAgent(out, graph, true).goal_chance_range_display ?? {})).toEqual(optionIds(envelope));
    expect(!goalChanceWithheldForAgent({ enrichment: out }, graph)?.say.includes('how likely')).toBeTruthy();
  });

  it(`${name}: licensed point also excluded, withheld point stays (RED at base)`, () => {
    const points = { ...envelope, inference_warnings: [...warnings(envelope), {
      code: GOAL_CHANCE_LICENSED, severity: 'info', form: 'each', message: 'Point licence control.',
      option_ids: optionIds(envelope), pct_by_option: { [remaining[0]!]: 45 }, withheld_option_ids: [remaining[1]!],
    }] };
    const out = scopeTargetNotTestableWithRanges(points, graph);
    expect(warning(out)!.option_ids).toEqual([remaining[1]]);
    expect(warning(out)!.say).toBe('');
    expect(!warning(out)!.say.includes(`‘${labels.get(remaining[0]!)}’`)).toBeTruthy();
    const allPoints = { ...points, inference_warnings: warnings(points).map(w => w.code === GOAL_CHANCE_LICENSED ? {
      ...w, pct_by_option: Object.fromEntries(remaining.map(id => [id, 45])), withheld_option_ids: undefined,
    } : w) };
    expect(warning(scopeTargetNotTestableWithRanges(allPoints, graph))).toBe(undefined);
  });

  it(`${name}: point-only Run is byte-identical (must not fire)`, () => {
    const noRange = { ...envelope, inference_warnings: [
      ...warnings(envelope).filter(w => w.code !== GOAL_CHANCE_RANGE),
      { code: GOAL_CHANCE_LICENSED, severity: 'info', form: 'each', message: 'Point control.',
        option_ids: optionIds(envelope), pct_by_option: Object.fromEntries(optionIds(envelope).map(id => [id, 45])) },
    ] };
    expect(scopeTargetNotTestableWithRanges(noRange, graph)).toBe(noRange);
    expect(warning(noRange)!.say).toBe(oldSay);
  });

  it(`${name}: barred, malformed and unlabelled ranges do not scope`, () => {
    const barred = { ...envelope, inference_warnings: [...warnings(envelope), {
      code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', severity: 'warning', message: 'Not shown.',
    }] };
    expect(scopeTargetNotTestableWithRanges(barred, graph)).toBe(barred);
    const malformed = { ...envelope, inference_warnings: warnings(envelope).map(w => w.code === GOAL_CHANCE_RANGE
      ? { ...w, range_by_option: {} } : w) };
    expect(scopeTargetNotTestableWithRanges(malformed, graph)).toBe(malformed);
    const noLabels = { ...graph, nodes: graph.nodes.map((n: Rec) => ({ ...n, label: undefined })) };
    expect(scopeTargetNotTestableWithRanges(envelope, noLabels)).toBe(envelope);
  });

  it(`${name}: W uses the warning’s own ids, never widens to other scored options`, () => {
    const narrow = { ...envelope, inference_warnings: warnings(envelope).map(w => w.code === TARGET
      ? { ...w, option_ids: [linkedIds[0]] } : w) };
    const out = scopeTargetNotTestableWithRanges(narrow, graph);
    expect(warning(out)!.option_ids).toEqual([linkedIds[0]]);
    expect(warning(out)!.say).toBe('');
    expect(warning(out)!.say).not.toContain(`‘${labels.get(baselineId)}’`);
    const empty = { ...envelope, inference_warnings: warnings(envelope).map(w => w.code === TARGET
      ? { ...w, option_ids: rangeIds } : w) };
    expect(warning(scopeTargetNotTestableWithRanges(empty, graph))).toBeUndefined();
  });

  it(`${name}: status-quo-only W has no failing link and no withheld sentence; ranges remain`, () => {
    expect(baselineId).toBe('carry_on_as_now');
    const onlyBaseline = { ...envelope, inference_warnings: warnings(envelope).map(w => w.code === TARGET
      ? { ...w, option_ids: [baselineId] } : w) };
    const out = scopeTargetNotTestableWithRanges(onlyBaseline, graph);
    expect(warning(out)!.option_ids).toEqual([baselineId]);
    expect(warning(out)!.say).toBe('');
    expect(warning(out)!.first_ask).toBeUndefined();
    expect(warning(out)!.message).toBe(warning(envelope)!.message);
    expect(goalChanceWithheldForAgent({ enrichment: out }, graph)?.say ?? '').not.toContain("I can't yet say how likely");
    const targetAlone = { ...out, inference_warnings: warnings(out).filter(w => w.code !== 'GOAL_FIGURES_PLACEHOLDER_PATH') };
    expect(goalChanceWithheldForAgent({ enrichment: targetAlone }, graph)).toBeUndefined();
    expect(goalChanceFactsForAgent(targetAlone, graph, true).goal_chance_range_display)
      .toEqual(goalChanceFactsForAgent(envelope, graph, true).goal_chance_range_display);
  });

  it(`${name}: two W options with failing links each keep their own reason and ask`, () => {
    const range = warning(envelope, GOAL_CHANCE_RANGE)!;
    const otherLink = range.range_by_option[rangeIds[0]!];
    const movedGraph = { ...graph, nodes: graph.nodes.map((n: Rec) => n.id === baselineId
      ? { ...n, interventions: { [otherLink.from]: 1 } } : n) };
    const out = scopeTargetNotTestableWithRanges(envelope, movedGraph);
    const say: string = warning(out)!.say;
    const movedEdge = movedGraph.edges.find((edge: Rec) => edge.from === otherLink.from && edge.to === otherLink.to);
    expect(convertingOlumiEstimate(movedEdge, movedGraph)).toBe(true);
    expect(say).toBe('');
    expect(say).not.toContain(expectedSay);
  });

  it(`${name}: a shared failing link stays on W’s path and the ask follows the first retained link`, () => {
    const range = warning(envelope, GOAL_CHANCE_RANGE)!;
    const rangedLink = range.range_by_option[rangeIds[0]!];
    const sharedGraph = { ...graph, nodes: graph.nodes.map((n: Rec) => n.id === remaining.find(id =>
      Object.keys(graph.nodes.find((o: Rec) => o.id === id)?.interventions ?? {}).length > 0)
      ? { ...n, interventions: { ...n.interventions, [rangedLink.from]: { value: 1 } } } : n) };
    const out = scopeTargetNotTestableWithRanges(envelope, sharedGraph);
    const sharedEdge = sharedGraph.edges.find((edge: Rec) => edge.from === rangedLink.from && edge.to === rangedLink.to);
    expect(convertingOlumiEstimate(sharedEdge, sharedGraph)).toBe(true);
    expect(warning(out)!.say).toBe('');
    expect(warning(out)!.first_ask).toBeUndefined();
  });

  it.each(['placeholder', 'non-converting estimate'])(`${name}: amendment (A) CONTRAST: %s still keeps W's complete link reason and ask`, (kind) => {
    const refused = structuredClone(graph);
    let changed = 0;
    const ownPath = new Set((name === 'unseen-1'
      ? [['loyalty_app_gross_profit_uplift', 'monthly_profit'], ['loyalty_app_operating_cost', 'monthly_profit'],
        ['loyalty_app_incremental_sales', 'loyalty_app_gross_profit_uplift']]
      : [['loyalty_app_active', 'incremental_monthly_profit_from_loyalty_app']]).map(ends => JSON.stringify(ends)));
    for (const edge of refused.edges) if (ownPath.has(JSON.stringify([edge.from, edge.to]))) {
      expect(convertingOlumiEstimate(edge, graph)).toBe(true);
      changed += 1;
      if (kind === 'placeholder') edge.provenance.magnitude = 'olumi_placeholder';
      else delete edge.provenance.natural_effect;
      expect(convertingOlumiEstimate(edge, refused)).toBe(false);
    }
    expect(changed).toBe(name === 'unseen-1' ? 3 : 1);
    const out = scopeTargetNotTestableWithRanges(envelope, refused);
    expect(warning(out)!.say).toBe(expectedSay);
    expect(warning(out)!.say.endsWith(question)).toBe(true);
    expect(warning(out)!.per_option[linkedIds[0]!].message).toContain(name === 'unseen-1'
      ? 'Loyalty-app gross-profit uplift' : 'Loyalty app active');
    expect(warning(out)!.first_ask).toBeDefined();
  });

  it(`${name}: pure, idempotent, figures and other warnings unchanged`, () => {
    const before = structuredClone(envelope);
    const out = scoped();
    expect(envelope).toEqual(before);
    expect(out.option_comparison).toBe(envelope.option_comparison);
    expect(warnings(out).filter(w => w.code !== TARGET)).toEqual(warnings(envelope).filter(w => w.code !== TARGET));
    expect(scopeTargetNotTestableWithRanges(out, graph)).toEqual(out);
  });
});

it.each([
  { labels: ['A'], named: '‘A’' },
  { labels: ['A', 'B'], named: '‘A’ or ‘B’' },
  { labels: ['A', 'B', 'C'], named: '‘A’, ‘B’ or ‘C’' },
  { labels: ['A', 'B', 'C', 'D'], named: '‘A’, ‘B’, ‘C’ or ‘D’' },
])('scoped list grammar: $named', ({ labels, named }) => {
  const { graph, envelope } = captures[0]!;
  const verdict = targetTestabilityOf(graph, envelope.identity_evaluations);
  expect(untestableTargetTail(graph, verdict, labels)).toContain(`how likely ${named} is to`);
});

it('a scoped tail without a reason or an ask is silent; the unscoped control keeps its words', () => {
  const { graph, envelope } = captures[0]!;
  const verdict = targetTestabilityOf(graph, envelope.identity_evaluations);
  expect(verdict.kind).toBe('not_testable');
  if (verdict.kind !== 'not_testable') throw new Error('Capture must have target failures');
  expect(untestableTargetTail(graph, { ...verdict, failures: [] }, ['Carry on as now'])).toBe(null);
  const noAsk = { ...verdict, failures: [{ precondition: 'P3' as const, case: 'b' as const, code: 'comparator_unscorable' as const }] };
  expect(untestableTargetTail(graph, noAsk, ['Carry on as now'])).toBe(null);
  expect(untestableTargetTail(graph, noAsk)).toContain("I can't yet say how likely any option is to");
});

it('producer wiring scopes after point licence and before Run storage', () => {
  const source = readFileSync(new URL('../../tools/handlers/run-analysis.ts', import.meta.url), 'utf8');
  const licence = source.indexOf('response = withGoalChanceLicence(');
  const scope = source.indexOf('response = scopeTargetNotTestableWithRanges(');
  const storage = source.indexOf('enrichment: stampRunAnalysisProjection(response', licence);
  expect(licence >= 0 && scope > licence && storage > scope).toBeTruthy();
});

it('20k whitespace copy path runs below 50 ms (no new regex)', () => {
  const { envelope, graph } = captures[0]!;
  const long = { ...envelope, inference_warnings: warnings(envelope).map(w => w.code === TARGET ? {
    ...w, say: `${w.say}${' '.repeat(20_000)}`,
  } : w) };
  const start = performance.now();
  const out = scopeTargetNotTestableWithRanges(long, graph);
  const elapsed = performance.now() - start;
  console.log(`S4b 20k whitespace: ${elapsed.toFixed(3)} ms; new regex: none`);
  expect(elapsed < 50).toBeTruthy();
  expect(warning(out)!.say).toBeDefined();
});
