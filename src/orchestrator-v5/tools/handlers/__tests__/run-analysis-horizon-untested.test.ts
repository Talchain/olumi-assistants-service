/**
 * Science §(ad): a held month-H goal owes either a computed horizon or the user's steady-level attestation.
 * Otherwise the real Run producer withholds every option's goal figures. Historical horizon formatters remain
 * byte-stable for normalization, but the typed chance-free/disclaimer warning is retired for positive integer H.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GOAL_FIGURES_HORIZON_NOT_TESTED, GOAL_FIGURES_MISSING_CURRENT_LEVEL, GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../../orchestrator/context/option-result-source.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, withholdGoalFiguresForMissingCurrentLevel } from '../run-analysis.js';
import {
  GOAL_HORIZON_NOT_TESTED,
  decisionInputLines,
  untestedHorizonLine,
  withShortHorizonBesideChance,
  withUntestedHorizonWarning,
} from '../../../agent-lane/decision-input-ask.js';
import { GOAL_CHANCE_LICENSED } from '../../../goal-target/goal-chance-licence.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { goalKindOf } from '../../../goal-target/goal-kind.js';
import { teamShareMoments } from '../../../goal-target/event-by-date-share.js';
import { targetTestabilityOf } from '../../../admission/target-testability.js';

type Json = Record<string, any>;
const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json;
};
const SCENARIO = 'c8108752-0000-4000-8000-0000000000a7';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const A7_12 = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £85,000 within 12 months.";
const A7_SHORT = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet.";
const ONE_FIGURE = [{ kind: 'figure' as const, display: 'about 40%' }];

async function runOn(graph: Json, body: Json = M1.plot_body): Promise<Json> {
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: M1._provenance.brief_text })),
    loadGraph: vi.fn(async () => clone(graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-a7-load', store as never);
  const run = vi.fn(async () => clone(body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-a7-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-a7', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'req-a7-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return fact.result as Json;
}

/** Every warning-shaped record anywhere in the Run's result. */
const warningsOf = (result: Json): Json[] => {
  const found: Json[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const r = v as Json;
    if (typeof r.code === 'string' && typeof r.message === 'string') found.push(r);
    Object.values(r).forEach(walk);
  };
  walk(result);
  return found;
};
const horizonWarnings = (result: Json): Json[] => warningsOf(result).filter((w) => w.code === GOAL_HORIZON_NOT_TESTED);

/** The served m1 route sized with the user's figures; horizon admission remains an independent gate. */
const sizedRoute = (): Json => {
  const g = clone(M1.graph);
  for (const e of g.edges as Json[]) {
    if ((e.to === 'monthly_churn_rate' || e.to === 'paying_subscribers_at_12_months') && (e.defaulted === true || String(e.provenance?.magnitude ?? '').startsWith('olumi_'))) {
      e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' };
    }
  }
  return g;
};
const withDurationLimit = (g: Json): Json => ({
  ...g, goal_constraints: [...(g.goal_constraints ?? []), { constraint_id: 'k-months', node_id: 'mrr', unit: 'months', operator: '<=', value: 12 }],
});
const withoutHeldMonths = (): Json => {
  const g = clone(M1.graph);
  for (const n of g.nodes as Json[]) if (n.kind === 'goal') delete n.goal_horizon_months;
  return g;
};

/** A held pure share sum, recognized by its parts rather than a claimed goal-kind flag. */
const shareByDateGraph = (): Json => {
  const unit = '% of launch', deadline = '2027-04-07', team = teamShareMoments(6, 6, 10);
  return { nodes: [
    { id: 'launch_share', kind: 'goal', label: 'Launch share', goal_horizon: { deadline },
      goal_threshold_frame: 'level', goal_threshold_raw: 100, goal_threshold_cap: 100,
      goal_threshold_unit: unit, goal_direction: '>=' },
    { id: 'team_share', kind: 'factor', label: 'Team launch share', observed_state: {
      value: team.mean, std: team.sd, unit, cap: 100, source: 'user_override',
      stated_time: { quantity: 'months_to_finish', low: 6, high: 10, unit: 'months', deadline, reference_date: '2026-10-07' },
    } },
    { id: 'status_quo', kind: 'option', label: 'Carry on', is_baseline: true, interventions: {} },
  ], edges: [
    { from: 'team_share', to: 'launch_share', exists_probability: 1, strength: { mean: 1, std: 0.01 }, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', definitional: true, natural_effect: {
        amount: 1, amount_unit: unit, per_source_change: 1, per_source_change_unit: unit,
        strength_mean: 1, strength_mean_frame: 'edge_strength',
      } } },
  ] };
};

describe('Science §(ad) replaces a held-horizon disclaimer with typed withhold', () => {
  it('PRECONDITION: the served goal holds 12 months but its product has no accumulation carrier', () => {
    const goal = (M1.graph.nodes as Json[]).find((n) => n.kind === 'goal')!;
    expect(goal.goal_horizon_months).toBe(12);
    expect((M1.graph.goal_constraints as Json[]).map((k) => k.unit)).toEqual(['%']);
    expect(goal.nonlinear_identity.operation).toBe('product');
    const byId = new Map((M1.graph.nodes as Json[]).map((node) => [node.id, node]));
    expect(goal.nonlinear_identity.factor_ids.some((id: string) => byId.get(id)?.nonlinear_identity?.operation === 'accumulation')).toBe(false);
  });

  it('the low-level chance formatter retains its bytes; the host no longer emits its old horizon line', () => {
    expect(untestedHorizonLine(M1.graph)).toBe(A7_12);
    expect(decisionInputLines(M1.graph, {
      restingText: 'A sketch.', questionsToggle: false, awaitingApproval: false, builtOrRan: true,
    // Q-c (DL 87114): one horizon-limit statement per surface.
    })).toEqual(["This model doesn't yet say whether any option gets there within 12 months."]);
  });

  it('the served graph records run-wide HORIZON_NOT_TESTED and removes every option chance', async () => {
    const result = await runOn(M1.graph);
    const warnings = warningsOf(result);
    expect(horizonWarnings(result)).toEqual([]);
    expect(warnings).toContainEqual(expect.objectContaining({
      code: GOAL_FIGURES_HORIZON_NOT_TESTED, severity: 'warning', node_ids: ['mrr'],
      option_ids: ['59_price', 'current_price'], detail: { reason: 'HORIZON_NOT_TESTED' },
    }));
    for (const option of result.enrichment.option_comparison) expect(option).not.toHaveProperty('probability_of_goal');
  });

  it('horizon withhold preserves the independent target-testability cause', async () => {
    const warnings = warningsOf(await runOn(M1.graph));
    expect(warnings.map((w) => w.code)).toEqual(expect.arrayContaining([
      GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_HORIZON_NOT_TESTED,
    ]));
    expect(warnings.find((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)?.option_ids).toEqual(['59_price']);
  });

  it('sizing the route does not turn a steady-state chance into month-H evidence', async () => {
    const result = await runOn(sizedRoute());
    expect(warningsOf(result).some((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)).toBe(false);
    expect(warningsOf(result).some((w) => w.code === GOAL_FIGURES_HORIZON_NOT_TESTED)).toBe(true);
    expect(horizonWarnings(result)).toEqual([]);
    for (const option of result.enrichment.option_comparison) expect(option).not.toHaveProperty('probability_of_goal');
  });

  it('user_set steady_attested preserves the chances without an old horizon warning', async () => {
    const graph = sizedRoute();
    const steadyGoal = graph.nodes.find((node: Json) => node.kind === 'goal');
    Object.assign(steadyGoal, {
      horizon_basis: 'steady_attested', horizon_basis_source: 'user_stated', horizon_basis_months: steadyGoal.goal_horizon_months,
    });
    const result = await runOn(graph);
    expect(warningsOf(result).some((w) => w.code === GOAL_FIGURES_HORIZON_NOT_TESTED)).toBe(false);
    expect(horizonWarnings(result)).toEqual([]);
    expect(result.enrichment.option_comparison.some((option: Json) => typeof option.probability_of_goal === 'number')).toBe(true);
  });

  it.each(['ai_inferred', 'from_brief'])('%s steady_attested cannot license the month-H chance', async (provenance) => {
    const graph = sizedRoute();
    Object.assign(graph.nodes.find((node: Json) => node.kind === 'goal'), { horizon_basis: 'steady_attested', horizon_basis_source: provenance, horizon_basis_months: graph.nodes.find((node: Json) => node.kind === 'goal').goal_horizon_months });
    const result = await runOn(graph);
    expect(warningsOf(result).some((w) => w.code === GOAL_FIGURES_HORIZON_NOT_TESTED)).toBe(true);
    expect(horizonWarnings(result)).toEqual([]);
    for (const option of result.enrichment.option_comparison) expect(option).not.toHaveProperty('probability_of_goal');
  });

  it('a separate duration limit cannot substitute for computing the goal at H', async () => {
    const graph = withDurationLimit(M1.graph);
    const result = await runOn(graph);
    expect(horizonWarnings(result)).toEqual([]);
    expect(warningsOf(result).some((w) => w.code === GOAL_FIGURES_HORIZON_NOT_TESTED)).toBe(true);
    expect(untestedHorizonLine(graph)).toBeNull();
  });

  it('CONTROL: no held months and no licensed chance carries no horizon warning as before', async () => {
    const result = await runOn(withoutHeldMonths());
    expect(horizonWarnings(result)).toEqual([]);
    expect(warningsOf(result).some((w) => w.code === GOAL_FIGURES_HORIZON_NOT_TESTED)).toBe(false);
  });

  it('no-H licensed chance keeps the SHORT form byte-exact on the warning and licence', () => {
    const licence = { code: GOAL_CHANCE_LICENSED, severity: 'info', message: 'licensed', option_ids: ['a'] };
    const out = withShortHorizonBesideChance({ inference_warnings: [licence] }, withoutHeldMonths(), ONE_FIGURE) as Json;
    expect(horizonWarnings(out)).toHaveLength(1);
    expect(horizonWarnings(out)[0]).toMatchObject({ code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: A7_SHORT, node_ids: ['mrr'] });
    expect(out.inference_warnings[0]).toMatchObject({ code: GOAL_CHANCE_LICENSED, horizon_untested: true, horizon_line: A7_SHORT });
    const unlicensed = { inference_warnings: [] };
    expect(withShortHorizonBesideChance(unlicensed, withoutHeldMonths())).toBe(unlicensed);
    const positiveH = withUntestedHorizonWarning({ inference_warnings: [licence] }, M1.graph, ONE_FIGURE);
    expect(withShortHorizonBesideChance(positiveH, M1.graph, ONE_FIGURE)).toBe(positiveH);
  });

  it('no-H draft host keeps its existing silent bytes', () => {
    const graph = withoutHeldMonths();
    expect(untestedHorizonLine(graph)).toBeNull();
    expect(decisionInputLines(graph, {
      restingText: 'A sketch.', questionsToggle: false, awaitingApproval: false, builtOrRan: true,
    }).filter((line) => line.startsWith("This chance uses the model's numbers as they are today"))).toEqual([]);
  });

  it('share_by_date keeps its own goal-kind rule and owes no old horizon warning', () => {
    const graph = shareByDateGraph();
    expect(goalKindOf(graph)).toBe('share_by_date');
    expect(untestedHorizonLine(graph, { besideChance: true })).toBeNull();
    const envelope = { inference_warnings: [] };
    expect(withUntestedHorizonWarning(envelope, graph)).toBe(envelope);
    expect(horizonWarnings(envelope)).toEqual([]);
  });
});

describe('the current-level producer records the engine refusal as a typed option withhold', () => {
  it('the real handler preserves the original P1 target gate\'s outcome stripping before recording the current-level cause', async () => {
    const graph = sizedRoute();
    const goal = graph.nodes.find((node: Json) => node.kind === 'goal');
    delete goal.observed_state;
    delete goal.nonlinear_identity;
    const verdict = targetTestabilityOf(graph);
    expect(verdict).toMatchObject({ kind: 'not_testable', failures: expect.arrayContaining([
      { precondition: 'P1', case: 'a', code: 'missing_goal_baseline' },
    ]) });
    const body = clone(M1.plot_body);
    body.inference_warnings.push({
      code: 'GOAL_THRESHOLD_NOT_CONVERTIBLE', message: 'Threshold not convertible.', severity: 'warning',
      detail: { reason: 'missing_goal_baseline' },
    });
    const centres = ['mean', 'std', 'p10', 'p50', 'p90'];
    expect(body.option_comparison.every((option: Json) => centres.every(field => typeof option.outcome?.[field] === 'number'))).toBe(true);
    const result = await runOn(graph, body);
    const warnings = warningsOf(result);
    expect(warnings.map(warning => warning.code)).toContain(GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(warnings).toContainEqual(expect.objectContaining({
      code: GOAL_FIGURES_MISSING_CURRENT_LEVEL, detail: { reason: 'missing_goal_baseline' },
      option_ids: ['59_price', 'current_price'],
    }));
    const compared = result.enrichment.option_comparison as Json[];
    expect(compared).toHaveLength(body.option_comparison.length);
    for (const option of compared) {
      expect(option).not.toHaveProperty('probability_of_goal');
      for (const field of centres) expect(option.outcome).not.toHaveProperty(field);
      const original = body.option_comparison.find((record: Json) => record.option_id === option.option_id);
      const remaining = Object.fromEntries(Object.entries(original.outcome).filter(([field]) => !centres.includes(field)));
      expect(option.outcome).toEqual(remaining);
    }
  });

  it('records missing_goal_baseline even when another typed withhold already removed every chance', () => {
    const body = clone(M1.plot_body);
    for (const option of body.option_comparison) delete option.probability_of_goal;
    body.inference_warnings = [
      { code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', message: 'Not shown. The identity was not evaluated.', severity: 'warning' },
      { code: 'GOAL_THRESHOLD_NOT_CONVERTIBLE', message: 'Threshold not convertible.', severity: 'warning', detail: { reason: 'missing_goal_baseline' } },
    ];
    const out = withholdGoalFiguresForMissingCurrentLevel(body, M1.graph) as Json;
    expect(out.inference_warnings).toContainEqual(expect.objectContaining({
      code: GOAL_FIGURES_MISSING_CURRENT_LEVEL, severity: 'warning', message: "Not shown. MRR's current level is missing.",
      node_ids: ['mrr'], option_ids: ['59_price', 'current_price'], detail: { reason: 'missing_goal_baseline' },
    }));
    expect(out.inference_warnings).toContainEqual(body.inference_warnings[0]);
    expect(withholdGoalFiguresForMissingCurrentLevel(out, M1.graph)).toBe(out);
  });

  it('a different carried refusal leaves the existing envelope untouched', () => {
    const body = { ...clone(M1.plot_body), inference_warnings: [
      { code: 'GOAL_THRESHOLD_NOT_CONVERTIBLE', message: 'Threshold not convertible.', severity: 'warning', detail: { reason: 'change_rel_base_zero' } },
    ] };
    expect(withholdGoalFiguresForMissingCurrentLevel(body, M1.graph)).toBe(body);
  });
});

describe('withUntestedHorizonWarning no longer writes an old clause on positive H', () => {
  const envelope = { results: [{ option_id: 'a', probability_of_goal: 0.4 }], inference_warnings: [{ code: 'X', message: 'x', severity: 'info' }] };

  it('the pure normalizer leaves the original envelope and figures untouched; the producer owns withhold', () => {
    const before = clone(envelope);
    // Q-c (DL 87114): one horizon-limit statement per surface.
    expect(withUntestedHorizonWarning(before, M1.graph)).toEqual({ ...envelope, inference_warnings: [
      ...envelope.inference_warnings, { code: GOAL_HORIZON_NOT_TESTED, severity: 'info',
        message: "This model doesn't yet say whether any option gets there within 12 months.", node_ids: ['mrr'] },
    ] });
    expect(before).toEqual(envelope);
  });

  it('removes a previous horizon warning and its licence metadata once, preserving other bytes', () => {
    const licence = { code: GOAL_CHANCE_LICENSED, severity: 'info', horizon_untested: true, horizon_line: A7_12 };
    const previous = { ...clone(envelope), inference_warnings: [...envelope.inference_warnings, licence,
      { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: A7_12 }] };
    const once = withUntestedHorizonWarning(previous, M1.graph);
    expect(once).toEqual({ ...envelope, inference_warnings: [...envelope.inference_warnings,
      { code: GOAL_CHANCE_LICENSED, severity: 'info' },
      // Q-c (DL 87114): one horizon-limit statement per surface.
      { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: "This model doesn't yet say whether any option gets there within 12 months." }] });
    expect(withUntestedHorizonWarning(once, M1.graph)).toBe(once);
  });

  it('returns the envelope itself for no-H, duration-limited H, and an ambiguous goal', () => {
    const limited = clone(envelope);
    expect(withUntestedHorizonWarning(limited, withoutHeldMonths())).toBe(limited);
    expect(withUntestedHorizonWarning(limited, withDurationLimit(M1.graph))).toBe(limited);
    const twoGoals = { ...M1.graph, nodes: [...M1.graph.nodes, { id: 'mrr2', kind: 'goal', label: 'MRR 2', goal_horizon_months: 6 }] };
    expect(withUntestedHorizonWarning(limited, twoGoals)).toBe(limited);
  });
});
