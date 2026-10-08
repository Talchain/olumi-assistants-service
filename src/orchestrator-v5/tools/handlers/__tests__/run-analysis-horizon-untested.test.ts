/**
 * ⭐ A7 AS A TYPED FACT ON THE RUN (DL 0df0e1 → Reasoning, 4 Oct; beat 2).
 *
 * The PL's beat-2 wording separates "no option reaches the target" from "the deadline is untested". Until now the second
 * existed only as chat text (the host's A7 line), so no surface beside the chat could say it without re-deriving A7. The
 * Run now carries it as ONE `info` inference warning, `GOAL_HORIZON_NOT_TESTED`, in A7's own sentence, from A7's own rule
 * (`untestedHorizonLine`, `decision-input-ask.ts`): the goal holds the brief's deadline and no duration limit scores it.
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
  withUntestedHorizonWarning,
} from '../../../agent-lane/decision-input-ask.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, any>;
const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json;
};
const SCENARIO = 'c8108752-0000-4000-8000-0000000000a7';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const A7_12 = 'This model doesn\'t yet say whether any option gets there within 12 months.';

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
    const warnings = warningsOf(await runOn(M1.graph));
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain(GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(codes).toContain(GOAL_HORIZON_NOT_TESTED);
    expect(warnings.find((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)?.option_ids).toEqual(['59_price']);
  });

  it('RED: a Run that SHOWS the goal chance still says the deadline is untested (the PL\'s distinction)', async () => {
    const result = await runOn(sizedRoute());
    expect(warningsOf(result).some((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)).toBe(false);
    expect(horizonWarnings(result).map((w) => w.message)).toEqual([A7_12]);
  });

  it('CONTROL: a duration limit scores the deadline → no horizon warning, and the chat says no A7 either', async () => {
    const g = withDurationLimit(M1.graph);
    expect(horizonWarnings(await runOn(g))).toEqual([]);
    expect(untestedHorizonLine(g)).toBeNull();
  });

  it('CONTROL: no held deadline → no horizon warning', async () => {
    const g = clone(M1.graph);
    for (const n of g.nodes as Json[]) if (n.kind === 'goal') delete n.goal_horizon_months;
    expect(horizonWarnings(await runOn(g))).toEqual([]);
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
