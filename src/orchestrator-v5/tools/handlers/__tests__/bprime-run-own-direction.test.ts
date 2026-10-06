/**
 * RT-10 B′ follow-through, DL e8 condition 1: the shares and the leader come from ISL AT THE RUN'S OWN DIRECTION
 * (minimise → "came out lowest"), with a maximise contrast, and a stale-shares mutant goes RED.
 *
 * Two REAL PLoT bodies (staging PLoT 2473ace, 5 Oct), each the answer to the exact payload CEE builds for the red team's
 * rt10b post-edit graph (guest 078e521e):
 * - "at most 400" → CEE sends `goal_direction: minimise` → ISL: 15% Loyalty Discount 70.8%, Pause 25.2%;
 * - "at least 400" → CEE sends no direction → ISL ranks by the LARGEST cancellations: More Reliable Courier 86.7% (the
 *   same shares as the served Run 1, which also sent none). Science's first example quoted those stale shares.
 * The PLoT stub answers BY THE DIRECTION IT RECEIVES, so a handler that loses the direction gets the other body.
 *
 * And Science d5's T1 ruling: the goal's own untestable target row no longer withholds the leader (served Run 2 read
 * `constraint_withheld`, "One limit on your model could not be checked").
 *
 * THE PATH: the served graph through the REAL loader and the REAL handler. Rung: TESTED (in-process), not a wire witness.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { textNamesLeadingOption } from '../../../compose/leading-option-egress-guard.js';
import { notTargetTestableSentence, targetNotTestableWarning, targetTestabilityOf, targetWarningSentence, untestableTargetTail } from '../../../admission/target-testability.js';
import { goalChanceWithheldForAgent } from '../../../agent-lane/goal-chance-withheld.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../../orchestrator/context/option-result-source.js';

type Json = Record<string, any>;
const F = JSON.parse(readFileSync(new URL('./fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_without_target: Json; graph_with_target: Json; plot_body_minimise: Json; plot_body_at_least: Json;
};
const SCENARIO = '078e521e-907b-4444-96c9-b9a49472b766';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** What ISL answers for each direction CEE can send. */
const BODY_FOR = { minimise: F.plot_body_minimise, none: F.plot_body_at_least };

/** The post-edit graph held "at least 400": the goal's comparator and its own row both `>=`. */
const atLeast = (): Json => {
  const g = clone(F.graph_with_target);
  g.goal_constraints[0].operator = '>=';
  for (const n of g.nodes) if (n.kind === 'goal') n.goal_direction = '>=';
  return g;
};
/** A graph whose goal LABEL attests the reduce aim: CEE sends minimise with or without a target. */
const reduceLabel = (graph: Json): Json => {
  const g = clone(graph);
  for (const n of g.nodes) if (n.kind === 'goal') n.label = 'Reduce monthly cancellations';
  return g;
};

async function runOn(graph: Json): Promise<{ sent: Json; result: Json }> {
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: 'Monthly cancellations should come down.' })),
    loadGraph: vi.fn(async () => clone(graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-dir-load', store as never);
  const run = vi.fn(async (payload: Json) =>
    clone(payload.goal_direction === 'minimise' ? BODY_FOR.minimise : BODY_FOR.none) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-dir-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-dir', scenario_id: SCENARIO, message: 'Run analysis', turn_class: 'frame', stage: 'analyse' } as never),
    requestId: 'req-dir-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  return { sent: run.mock.calls[0]![0] as Json, result: fact.result as Json };
}

const sharesById = (rows: Json[]): Record<string, number> =>
  Object.fromEntries(rows.map((r) => [String(r.option_id ?? r.id), r.win_probability as number]));
const resultShares = (result: Json): Record<string, number> => sharesById(result.enrichment.option_comparison);
const leaderOf = (body: Json): string =>
  [...body.option_comparison].sort((a: Json, b: Json) => b.win_probability - a.win_probability)[0].option_id;
/** Every NUMERIC `probability_of_goal` / `probability_of_joint_goal` anywhere in the result (PLoT's debug copies are hashed strings). */
const goalChanceKeys = (v: unknown): number => {
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + goalChanceKeys(x), 0);
  if (v === null || typeof v !== 'object') return 0;
  return Object.entries(v as Json).reduce((n, [k, x]) =>
    n + ((k === 'probability_of_goal' || k === 'probability_of_joint_goal') && typeof x === 'number' ? 1 : 0) + goalChanceKeys(x), 0);
};
const headlineOf = (summary: string): string => summary.split(/(?<=\.)\s/)[0]!;

describe('B′ — the shares and the leader are ISL\'s at the direction THIS Run sent', () => {
  it('precondition: CEE sends minimise for "at most" and nothing for "at least"; the two real bodies name different leaders', async () => {
    expect((await runOn(F.graph_with_target)).sent.goal_direction).toBe('minimise');
    expect((await runOn(atLeast())).sent).not.toHaveProperty('goal_direction');
    expect(leaderOf(F.plot_body_minimise)).toBe('15_loyalty_discount');
    expect(leaderOf(F.plot_body_at_least)).toBe('more_reliable_courier');
  });

  it('row 1 (served Run 2, "at most 400"): every share is the minimise body\'s, by option id, and the lead says "gave the lowest"', async () => {
    const { result } = await runOn(F.graph_with_target);
    expect(resultShares(result)).toEqual(sharesById(F.plot_body_minimise.option_comparison));
    expect(result.leading_option_id).toBe('15_loyalty_discount');
    const headline = headlineOf(result.summary);
    expect(headline).toBe('15% Loyalty Discount gave the lowest monthly cancellations in 71% of runs of this model, but treat this as provisional: the result is sensitive to Pauses taken instead of cancellations.');
    // The egress cage admits it, and the leader detectors see it (so a withheld leader cannot leave through this verb).
    expect(isAllowedRunAnalysisAssistantText(headline)).toBe(true);
    expect(textNamesLeadingOption(headline)).toBe(true);
    // Only the claims against the target go.
    expect(goalChanceKeys(result)).toBe(0);
  });

  it('row 1 (Science d5, T1): the goal\'s own target row withholds nothing more — the leader is named and no limit is "not checked"', async () => {
    const { result } = await runOn(F.graph_with_target);
    expect(result.constraint_verdict).toMatchObject({ may_name_leading_option: true });
    expect(result.summary).not.toMatch(/could not be checked/);
  });

  /**
   * DL e8 ACCEPT (5 Oct, Review Desk ask): under R2 the admission's mode reason is the no-target one, so before a Run the
   * panel's reason line no longer carries the target sentence. Condition (1): after the Run it still reaches the user, on
   * the panel's "Not shown. …" warning (DGAI `goalIdentityWithheld.ts:43` renders its `message`) and in the chat tail
   * (`say`, said once through `goal_chance`). Both are bound to the ONE source by identity, on the served graph.
   */
  it('row 1 (DL e8 condition 1): after the Run the target sentence reaches the user — the panel warning and the chat tail', async () => {
    const { result } = await runOn(F.graph_with_target);
    const verdict = targetTestabilityOf(F.graph_with_target);
    // #2613 (DL): the warning's ONE source is now the capped B′ composer; the readiness sentence keeps three names.
    const sentence = targetWarningSentence(F.graph_with_target, verdict)!;
    expect(sentence).toMatch(/^Olumi can compare your options, but can't yet test them against your target \(at most 400 cancellations \/ month\), because it needs today's level of monthly cancellations/);
    const warning = (result.enrichment.inference_warnings as Json[]).find((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)!;
    expect(warning.message).toBe(`Not shown. ${sentence}`);
    expect(notTargetTestableSentence(F.graph_with_target, verdict)).toContain('and from Late-delivery cancellations to monthly cancellations and 3 more.');
    const tail = untestableTargetTail(F.graph_with_target, verdict)!;
    expect(warning.say).toBe(tail);
    expect(goalChanceWithheldForAgent(result)?.say).toBe(tail);
  });

  it('at least four missing links: the long B′ warning keeps its target and reasons by naming the first link and the remaining count', () => {
    const graph = clone(F.graph_with_target);
    const firstLinkSource = graph.nodes.find((node: Json) => node.id === 'pauses_taken_instead_of_cancellations');
    firstLinkSource.label = 'Pauses taken instead of cancellations by returning customers';
    const verdict = targetTestabilityOf(graph);
    expect(verdict.kind).toBe('not_testable');
    if (verdict.kind !== 'not_testable') throw new Error('the long-list precondition is absent');
    expect(verdict.failures.find((failure) => failure.case === 'c')?.links?.length).toBeGreaterThanOrEqual(4);
    const warning = targetNotTestableWarning(graph, verdict, [], GOAL_FIGURES_TARGET_NOT_TESTABLE)!;
    expect(warning.message).toBe("Not shown. Olumi can compare your options, but can't yet test them against your target (at most 400 cancellations / month), because it needs today's level of monthly cancellations and a size for the links from Pauses taken instead of cancellations by returning customers to monthly cancellations and 5 more. What's today's level of monthly cancellations?");
    expect(warning.message.length).toBeLessThanOrEqual(400);
  });

  it('MAXIMISE CONTRAST ("at least 400"): the shares are the at-least body\'s, and the lead never says "came out lowest"', async () => {
    const { result } = await runOn(atLeast());
    expect(resultShares(result)).toEqual(sharesById(F.plot_body_at_least.option_comparison));
    expect(result.summary).not.toMatch(/came out lowest|gave the lowest/);
    expect(goalChanceKeys(result)).toBe(0);
  });

  it('MONOTONICITY (Science d5 row): with minimise sent either way, the target graph names the same leader as the no-target graph', async () => {
    const withTarget = await runOn(reduceLabel(F.graph_with_target));
    const withoutTarget = await runOn(reduceLabel(F.graph_without_target));
    expect(withTarget.sent.goal_direction).toBe('minimise');
    expect(withoutTarget.sent.goal_direction).toBe('minimise');
    expect(withoutTarget.result.leading_option_id).toBe('15_loyalty_discount');
    expect(withTarget.result.leading_option_id).toBe(withoutTarget.result.leading_option_id);
    expect(textNamesLeadingOption(headlineOf(withTarget.result.summary))).toBe(true);
    // Ladder rung 2 (Science d5 #87 6008589328): an aim-verb label ("Reduce monthly cancellations") has its verb
    // stripped, so the lead names the quantity on BOTH graphs, and never carries the verb.
    expect(withTarget.result.summary).toMatch(/gave the lowest monthly cancellations in \d{1,3}% of runs of this model/);
    expect(withoutTarget.result.summary).toMatch(/gave the lowest monthly cancellations in \d{1,3}% of runs of this model/);
    expect(withTarget.result.summary).not.toMatch(/lowest reduce|came out lowest/i);
  });
});
