import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { buildAnalysisResultBlock } from '../../../compose.js';
import { goalChanceCellFacesForAgent } from '../../../agent-lane/goal-chance-screen-lines.js';
import { readRunEvidence, runEvidenceWireOf } from '../../../agent-lane/run-evidence.js';
import { deriveRunQuestion } from '../../../goal-target/goal-chance-licence.js';
import { RUN_QUESTION_EVIDENCE_KEY } from '../run-input-snapshot.js';
import { describe, expect, it, vi } from 'vitest';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { buildAnalysisResultHeadlineParts } from '../../../coaching/analysis-result-headline.js';
import { boundRunLeaderClaim } from '../../../model-management/version-result-binding.js';

/**
 * ⭐ STEP 8 (AIE `point_uncertainty` 564fe768, cc9fbadf): a chance resting on a user's size whose spread is not attested is
 * withheld (`run-analysis-unsupported-spread.test.ts` pins that rule, its words and every surface). This fixture's user sizes
 * have no attested spread, and no positive is invented for them. This file tests
 * the range writer's recorded target, not that rule, so the Run's spread selection is held empty here; the rest of the support walk runs as served.
 */
vi.mock('../../../agent-lane/goal-certainty.js', async (original) => {
  const actual = await original<typeof import('../../../agent-lane/goal-certainty.js')>();
  return { ...actual, chanceSupportGoalPaths: (...args: Parameters<typeof actual.chanceSupportGoalPaths>) =>
    ({ ...actual.chanceSupportGoalPaths(...args), unsupportedSpread: [] }) };
});

const scenario = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const invocation = { context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
  messages: [{ role: 'user', content: 'run analysis' }], session_id: scenario, request_id: 'headline-licence',
  budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
  payload: { turn_id: 'fresh', scenario_id: scenario, message: 'run analysis', turn_class: 'decide', stage: 'analyse' },
  requestId: 'headline-licence', signal: new AbortController().signal, orientationText: '' } as unknown as HandlerInvocation;
const link = (from: string, to: string) => ({ from, to, strength: { mean: 1, std: 0.1 }, exists_probability: 1,
  effect_direction: 'positive', provenance: { source: 'user_specified' } });
const graphFor = (label: string) => ({ goal_node_id: 'g', nodes: [
  { id: 'd', kind: 'decision', label: 'Explore' },
  { id: 'g', kind: 'goal', label, goal_threshold: 0.7 },
  { id: 'f', kind: 'factor', label: 'Effort', observed_state: { value: 0, raw_value: 0, source: 'user', extractionType: 'explicit' } },
  { id: 'a', kind: 'option', label: 'Plan A', interventions: { f: 1 } },
  { id: 'b', kind: 'option', label: 'Plan B', interventions: { f: 0 } },
], edges: [link('d', 'a'), link('d', 'b'), link('a', 'f'), link('b', 'f'), link('f', 'g')] });

describe('fresh Run headline consumes its own canonical licence', () => {
  it.each(['Revenue', 'Delivery capacity'].flatMap(label => [true, false].flatMap(separated =>
    [false, true].map(directional => ({ label, separated, directional })))))(
    '$label / licensed=$separated / directional=$directional: exact summary bytes and no borrowed permission', async ({ label, separated, directional }) => {
      const graph = graphFor(label);
      if (directional) {
        graph.nodes.find(n => n.id === 'g')!.label = `Increase ${label}`;
        graph.nodes.find(n => n.id === 'f')!.label = label;
        graph.nodes.find(n => n.id === 'a')!.interventions = { f: 0 };
        graph.nodes.find(n => n.id === 'b')!.interventions = { f: 1 };
      }
      const response = { analysis_status: 'completed', response_hash: 'own', meta: { seed_used: 42, n_samples: 1000, response_hash: 'own' },
        option_comparison: [{ option_id: 'a', option_label: 'Plan A', win_probability: 0.65 },
          { option_id: 'b', option_label: 'Plan B', win_probability: 0.35 }],
        ...(separated ? { robustness: { level: 'strong', near_tie: { is_tie: false } } } : {}) };
      const snapshot = { graph, rawPersistedGraph: graph, goal_node_id: 'g', options: graph.nodes.filter(n => n.kind === 'option') } as RunAnalysisScenarioSnapshot;
      const outcome = await createRunAnalysisHandler({ scenarioReader: async () => snapshot,
        plotClient: { run: vi.fn(async () => response) } as unknown as PLoTClient })(invocation);
      const fact = outcome.handler_facts[0];
      expect(fact.fact_type).toBe('run_analysis');
      if (fact.fact_type !== 'run_analysis') throw new Error('missing Run');
      const licence = boundRunLeaderClaim({ fact, identity: { scenario_id: scenario, run_id: fact.result.run_id!,
        graph_hash_at_run: fact.result.graph_hash_at_run!, computed_at: fact.result.computed_at! } }, { graph, scenario_id: scenario }).licence;
      expect(licence).toBe(separated ? 'permitted' : 'withheld');
      const expected = 'Ran analysis on your current scenario.' + (separated && directional
        ? ` “Plan A” was supported by the most runs without moving “${label}” the way your goal asks. Among the options that do, “Plan B” was supported by 35% of runs.` : '');
      expect(fact.result.summary).toBe(expected);
      expect(outcome.assistant_text).toBe(fact.result.summary);
      // Another Run's clean leader / unrelated £2m sentence cannot supply this Run's missing licence.
      const input = { enrichment: { ...response, decision_brief: { headline: 'Other plan leads at £2m.' } }, leading_option_id: 'a', status_kind: 'ok' as const };
      const licensed = buildAnalysisResultHeadlineParts(input);
      expect(buildAnalysisResultHeadlineParts(input, 'permitted')).toEqual(licensed);
      expect(buildAnalysisResultHeadlineParts(input, 'permitted_with_caveat')).toEqual(licensed);
      if (!separated) {
        const withheld = buildAnalysisResultHeadlineParts(input, 'withheld');
        expect(withheld.text).toBeNull();

      }
  });
});

// Claude r1: exercise the actual writer. The PLoT double carries no CEE question evidence;
// the loader and handler must record the evaluated question before composing this summary.
const RANGE_CAPTURE = JSON.parse(readFileSync(new URL('./fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as {
  graph: Record<string, any>; plot_body: Record<string, any>; _provenance: { brief_text: string };
};
const CONDITIONAL = '‘£59 Price’: for ‘MRR’ being above £85,000 / month, the model’s two groups for how strongly '
  + '‘Pro plan price’ affects ‘Monthly churn rate’ give about 23% and 90%, under the recorded assumptions.';
const QUALIFIER = 'These are conditional model results, not one overall chance or an uncertainty interval.';

describe('real range Run writer keeps its recorded target before any cold projection', () => {
  it.each([false, true])('point licence=%s: writer and card name the same target and say the conditional sentence once', async withPoint => {
    const graph = structuredClone(RANGE_CAPTURE.graph);
    for (const edge of graph.edges) {
      if (edge.to === 'monthly_churn_rate' || edge.to === 'paying_subscribers_at_12_months') {
        edge.provenance = { ...edge.provenance, source: 'user_specified' };
      }
      if (edge.from === 'pro_plan_price' && edge.to === 'monthly_churn_rate') {
        edge.provenance = { ...edge.provenance, source: 'cee_hypothesis', magnitude: 'olumi_placeholder' };
      }
    }
    for (const node of graph.nodes) if (node.kind === 'goal') {
      delete node.goal_horizon_months;
      delete node.goal_deadline_as_stated;
    }
    const body = structuredClone(RANGE_CAPTURE.plot_body);
    const option = body.option_comparison.find((row: Record<string, any>) => row.option_id === '59_price');
    option.probability_of_goal_drivers = { drivers: [{ kind: 'link_strength', status: 'resolved', spread: 0.4,
      from: 'pro_plan_price', to: 'monthly_churn_rate', quantity_id: 'pro_plan_price->monthly_churn_rate',
      p_goal_if_low: 0.234, p_goal_if_high: 0.876, n_low: 4000, n_high: 40 }] };
    option.probability_of_goal_precision = { n_met: 3972, n_informative: 4000 };
    if (!withPoint) for (const row of body.option_comparison) if (row.option_id !== '59_price') {
      delete row.probability_of_goal;
      delete row.probability_of_goal_precision;
      delete row.probability_of_goal_drivers;
    }
    expect(body[RUN_QUESTION_EVIDENCE_KEY]).toBeUndefined();
    expect(body.enrichment?.[RUN_QUESTION_EVIDENCE_KEY]).toBeUndefined();
    const source = JSON.stringify(body);
    const store = { readMostRecentPendingActions: async () => [],
      loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: RANGE_CAPTURE._provenance.brief_text }),
      loadGraph: async () => structuredClone(graph) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(scenario, 'writer-range-load', store as never);
    const run = vi.fn(async () => structuredClone(body));
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient });
    const outcome = await handler({ ...invocation, payload: makeMessagePayload({
      turn_id: 'writer-range', scenario_id: scenario, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse',
    } as never) });
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).toBe(source);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('run_analysis');
    if (fact.fact_type !== 'run_analysis') throw new Error('the actual handler did not produce a Run');
    const warnings = fact.result.enrichment!.inference_warnings as { code: string }[];
    expect(warnings.some(row => row.code === 'GOAL_CHANCE_RANGE')).toBe(true);
    expect(warnings.some(row => row.code === 'GOAL_CHANCE_LICENSED')).toBe(withPoint);
    expect(fact.result.enrichment![RUN_QUESTION_EVIDENCE_KEY]).toBeDefined();
    const evidence = readRunEvidence(runEvidenceWireOf(fact));
    const question = deriveRunQuestion({ storedResult: fact.result, runEvidence: evidence });
    expect(question.run_id).toBe(fact.result.run_id);
    expect(question.calculated).toMatchObject({ quantity: { node_id: 'mrr' }, target: 85000, comparator: '>', unit: '£/month' });
    const face = goalChanceCellFacesForAgent(buildAnalysisResultBlock(fact), graph, true, evidence).get('59_price');
    expect(face?.split(QUALIFIER)[0]).toBe(`${CONDITIONAL} `);
    expect(fact.result.summary?.split(QUALIFIER)[0]).toBe(`${CONDITIONAL} `);
    expect(fact.result.summary?.split(CONDITIONAL).length).toBe(2);
    expect(fact.result.summary?.split(QUALIFIER).length).toBe(2);
    expect(face?.split(QUALIFIER).length).toBe(2);
    expect(outcome.assistant_text).toBe(fact.result.summary);
    if (!withPoint) expect(fact.result.summary).toContain(face);
    const evidenceDir = process.env.RS3_WRITER_EVIDENCE_DIR;
    if (evidenceDir !== undefined) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(`${evidenceDir}/writer-point-${withPoint}.json`, JSON.stringify({
        source: 'Real loader and run-analysis handler; only storage and PLoT transport are doubles; question not pre-attached',
        withPoint, run_id: fact.result.run_id, calculated: question.calculated,
        summary: fact.result.summary, face, conditional: CONDITIONAL,
        summary_contains_full_face: fact.result.summary?.includes(face ?? '') === true,
        summary_qualifier_count: fact.result.summary === undefined ? null : fact.result.summary.split(QUALIFIER).length - 1,
        face_qualifier_count: face === undefined ? null : face.split(QUALIFIER).length - 1,
      }, null, 2) + '\n');
    }
  });
});
