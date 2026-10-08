/**
 * ⭐ A7 AS A TYPED FACT ON THE RUN (DL 0df0e1 → Reasoning, 4 Oct; beat 2).
 *
 * The PL's beat-2 wording separates "no option reaches the target" from "the deadline is untested". Until now the second
 * existed only as chat text (the host's A7 line), so no surface beside the chat could say it without re-deriving A7. The
 * Run now carries it as ONE `info` inference warning, `GOAL_HORIZON_NOT_TESTED`, in A7's own sentence, from A7's own rule
 * (`untestedHorizonLine`, `decision-input-ask.ts`): the full sentence for held months, else the short present-number
 * basis beside the Run's chance. The chat host still says A7 only when held months have no scored duration limit.
 *
 * THE PATH: R3's served m1 graph (goal "MRR", `goal_horizon_months: 12`, one % limit) through the REAL loader and the REAL
 * handler; the PLoT client returns the served run body. Rung: TESTED (in-process), not a wire witness.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../../orchestrator/context/option-result-source.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
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

type Json = Record<string, any>;
const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json;
};
const SCENARIO = 'c8108752-0000-4000-8000-0000000000a7';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const A7_12 = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £85,000 within 12 months.";
const A7_SHORT = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet.";

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

/** The served m1 goal with the user's figures on its route sized, so the Run SHOWS each option's goal chance. */
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

describe('A7 is one rule: the chat line and the Run warning say the same sentence', () => {
  it('PRECONDITION: the served goal holds the brief\'s 12 months and no limit is a duration', () => {
    const goal = (M1.graph.nodes as Json[]).find((n) => n.kind === 'goal')!;
    expect(goal.goal_horizon_months).toBe(12);
    expect((M1.graph.goal_constraints as Json[]).map((k) => k.unit)).toEqual(['%']);
  });

  it('the rule says A7, and the chat\'s host line is that same string', () => {
    expect(untestedHorizonLine(M1.graph)).toBe(A7_12);
    const lines = decisionInputLines(M1.graph, { restingText: 'A sketch.', questionsToggle: false, awaitingApproval: false, builtOrRan: true });
    expect(lines).toContain(A7_12);
  });
});

describe('the Run carries A7 as a typed warning (served m1 through the real handler)', () => {
  it('RED: the served graph → exactly one GOAL_HORIZON_NOT_TESTED, info, in A7\'s words, naming the goal', async () => {
    const result = await runOn(M1.graph);
    const w = horizonWarnings(result);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: A7_12, node_ids: ['mrr'] });
  });

  it('RED: it rides beside the target withhold, never in place of it (two separate facts)', async () => {
    const codes = warningsOf(await runOn(M1.graph)).map((w) => w.code);
    expect(codes).toContain(GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(codes).toContain(GOAL_HORIZON_NOT_TESTED);
  });

  it('RED: a Run that SHOWS the goal chance still says the deadline is untested (the PL\'s distinction)', async () => {
    const result = await runOn(sizedRoute());
    expect(warningsOf(result).some((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)).toBe(false);
    expect(horizonWarnings(result).map((w) => w.message)).toEqual([A7_12]);
  });

  it('CONTROL: a duration limit scores the deadline → no horizon warning on a Run with no licensed chance, and no chat A7', async () => {
    const g = withDurationLimit(M1.graph);
    expect(horizonWarnings(await runOn(g))).toEqual([]);
    expect(untestedHorizonLine(g)).toBeNull();
  });

  it('CONTROL: no held months and no licensed chance on the Run → no horizon warning (stored bytes as before)', async () => {
    expect(horizonWarnings(await runOn(withoutHeldMonths()))).toEqual([]);
  });

  it('R3 a Run that LICENSED a goal chance with no held months carries the SHORT form byte-exact, on the warning and the licence', () => {
    const licence = { code: GOAL_CHANCE_LICENSED, severity: 'info', message: 'licensed', option_ids: ['a'] };
    const out = withShortHorizonBesideChance({ inference_warnings: [licence] }, withoutHeldMonths()) as Json;
    expect(horizonWarnings(out)).toHaveLength(1);
    expect(horizonWarnings(out)[0]).toMatchObject({ code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: A7_SHORT, node_ids: ['mrr'] });
    expect(out.inference_warnings[0]).toMatchObject({ code: GOAL_CHANCE_LICENSED, horizon_untested: true, horizon_line: A7_SHORT });
    // CONTROLS: no licensed chance → the same object; a held month count already wrote the full sentence → the same object.
    const unlicensed = { inference_warnings: [] };
    expect(withShortHorizonBesideChance(unlicensed, withoutHeldMonths())).toBe(unlicensed);
    const full = withUntestedHorizonWarning({ inference_warnings: [licence] }, M1.graph);
    expect(withShortHorizonBesideChance(full, M1.graph)).toBe(full);
  });

  it('R3 no-months draft chat A7 host owes no horizon line', () => {
    const g = withoutHeldMonths();
    expect(untestedHorizonLine(g)).toBeNull();
    expect(decisionInputLines(g, {
      restingText: 'A sketch.', questionsToggle: false, awaitingApproval: false, builtOrRan: true,
    }).filter((line) => line.startsWith("This chance uses the model's numbers as they are today"))).toEqual([]);
  });

  it('R3 share_by_date owes no GOAL_HORIZON_NOT_TESTED warning', () => {
    const g = shareByDateGraph();
    expect(goalKindOf(g)).toBe('share_by_date');
    expect(untestedHorizonLine(g, { besideChance: true })).toBeNull();
    const envelope = { inference_warnings: [] };
    expect(withUntestedHorizonWarning(envelope, g)).toBe(envelope);
    expect(horizonWarnings(envelope)).toEqual([]);
  });
});

describe('withUntestedHorizonWarning withholds nothing', () => {
  const envelope = { results: [{ option_id: 'a', probability_of_goal: 0.4 }], inference_warnings: [{ code: 'X', message: 'x', severity: 'info' }] };

  it('appends after the existing warnings and leaves every other key as it was', () => {
    const out = withUntestedHorizonWarning(clone(envelope), M1.graph) as Json;
    expect(out.inference_warnings.map((w: Json) => w.code)).toEqual(['X', GOAL_HORIZON_NOT_TESTED]);
    const { inference_warnings: _a, ...rest } = out;
    const { inference_warnings: _b, ...before } = envelope;
    expect(rest).toEqual(before);
  });

  it('is idempotent, and returns the envelope itself when the rule does not hold', () => {
    const once = withUntestedHorizonWarning(clone(envelope), M1.graph);
    expect(withUntestedHorizonWarning(once, M1.graph)).toBe(once);
    const limited = clone(envelope);
    expect(withUntestedHorizonWarning(limited, withDurationLimit(M1.graph))).toBe(limited);
    const twoGoals = { ...M1.graph, nodes: [...M1.graph.nodes, { id: 'mrr2', kind: 'goal', label: 'MRR 2', goal_horizon_months: 6 }] };
    expect(withUntestedHorizonWarning(limited, twoGoals)).toBe(limited);
  });
});
