/**
 * Post-B (DL 12 Oct; AIE #94 6123937762 item 3): a single stated target the Run did not send as specified is SAID on the Run,
 * in the AIE's words, through the existing reason (`figure_not_preserved`) and the ONE goal-figure seam. Before this the licence
 * refused it (`goalChanceLicenceOf`, R5-5 (b)) and nothing said why.
 *
 * THE PATH: the REAL `run_analysis` handler, PLoT faked, over the capacity LEVEL goal of `batch-c-goal-chance-licence.test.ts`
 * (R5-5 (b)'s fixture: "at least 85%" from 75% today, links sized by the user, no horizon), so no other cause withholds the
 * chance. The RED variant removes the goal's normalised threshold: the goal still states its target, and no threshold for it
 * reaches the engine. Rung: TESTED (in-process), not a wire witness.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = '5e1f0c3a-7d1b-4c2e-9a41-2f9b1c7e0a13';
const AIE = 'Your stated target for ‘Development capacity’ was not used as specified in this analysis, so its chance is not shown.';

const capacityGraph = (goal: Rec = {}): Rec => ({
  nodes: [
    { id: 'capacity', kind: 'goal', label: 'Development capacity', goal_threshold_frame: 'level', goal_threshold_raw: 85,
      goal_threshold_unit: '%', goal_threshold_cap: 100, goal_threshold: 0.85, goal_direction: '>=',
      observed_state: { value: 0.75, baseline: 0.75, raw_value: 75, cap: 100, unit: '%', source: 'brief_extraction', extractionType: 'explicit' }, ...goal },
    { id: 'devs', kind: 'factor', label: 'Developers', observed_state: { value: 0.6, raw_value: 6, cap: 10, unit: 'people', source: 'brief_extraction', extractionType: 'explicit' } },
    { id: 'lead', kind: 'option', label: 'Hire a tech lead', interventions: { devs: { value: 0.6, raw_value: 6, source: 'brief_extraction', extractionType: 'explicit', target_match: { node_id: 'devs' } } } },
    { id: 'two', kind: 'option', label: 'Hire two developers', interventions: { devs: { value: 0.8, raw_value: 8, source: 'brief_extraction', extractionType: 'explicit', target_match: { node_id: 'devs' } } } },
    { id: 'carry_on', kind: 'option', label: 'Carry on as now', is_baseline: true, interventions: {} },
  ],
  edges: [
    { from: 'lead', to: 'devs', strength: { mean: 1, std: 0 } }, { from: 'two', to: 'devs', strength: { mean: 1, std: 0 } },
    { from: 'devs', to: 'capacity', strength: { mean: 0.3, std: 0.05 }, exists_probability: 1, effect_direction: 'positive',
      // Sized by the user in the goal's own unit (`linkIsSized`), so no link-size ask withholds this chance first.
      provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 3, amount_unit: 'percentage points',
        strength_mean: 0.3, per_source_change: 1, strength_mean_frame: 'edge_strength', per_source_change_unit: 'people' } } },
  ],
  goal_constraints: [],
});

/** The REAL `run_analysis` handler over `graph`, PLoT faked with a goal chance for every option: the Run's stored result. */
async function runOn(graph: Rec): Promise<Rec> {
  const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option');
  const run = vi.fn(async (_request: unknown) => ({
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'sha256:s' }, response_hash: 'sha256:t', analysis_status: 'computed',
    option_comparison: [
      { option_id: 'lead', option_label: 'Hire a tech lead', win_probability: 0.6, probability_of_goal: 0.46, outcome: { mean: 84, std: 3, p10: 80, p50: 84, p90: 88 } },
      { option_id: 'two', option_label: 'Hire two developers', win_probability: 0.4, probability_of_goal: 0.31, outcome: { mean: 83, std: 3, p10: 79, p50: 83, p90: 87 } },
      { option_id: 'carry_on', option_label: 'Carry on as now', win_probability: 0, probability_of_goal: 0, outcome: { mean: 75, std: 0, p10: 75, p50: 75, p90: 75 } },
    ],
  }) as unknown as V2RunResponseEnvelope);
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const snapshot = {
    graph, rawPersistedGraph: graph, goal_node_id: 'capacity', goal_constraints: graph.goal_constraints,
    options: options.map((n) => ({ id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n as never) })),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run, 'PLoT was called exactly once').toHaveBeenCalledTimes(1);
  const fact = (outcome as Rec).handler_facts[0];
  expect(fact.fact_type).toBe('run_analysis');
  return fact.result.enrichment ?? fact.result;
}
const codes = (env: Rec): string[] => ((env.inference_warnings ?? []) as Rec[]).map((w) => String(w.code));
const said = (env: Rec): Rec[] => ((env.inference_warnings ?? []) as Rec[]).filter((w) => w.detail?.reason === 'figure_not_preserved');

describe('the Run says a single stated target it did not send as specified ("at least 85%" development capacity)', () => {
  it('CONTROL: the threshold sent → the chance is licensed and nothing is said (its reason: the target reached the engine)', async () => {
    const env = await runOn(capacityGraph());
    expect(said(env)).toEqual([]);
    expect(codes(env), 'PRECONDITION: no other cause withholds this chance').toContain('GOAL_CHANCE_LICENSED');
    expect(codes(env), 'PRECONDITION: nothing else withholds a goal figure').not.toContain('GOAL_FIGURES_TARGET_NOT_TESTABLE');
  });
  it('RED: no threshold for the stated target reaches the engine → the AIE\'s sentence, once, and the goal chance goes', async () => {
    const env = await runOn(capacityGraph({ goal_threshold: undefined }));
    expect(said(env).map((w) => [w.code, w.message, w.say])).toEqual([['GOAL_FIGURES_TARGET_NOT_TESTABLE', AIE, AIE]]);
    expect(codes(env)).not.toContain('GOAL_CHANCE_LICENSED');
    for (const r of env.option_comparison as Rec[]) expect(r).not.toHaveProperty('probability_of_goal');
  });
});
