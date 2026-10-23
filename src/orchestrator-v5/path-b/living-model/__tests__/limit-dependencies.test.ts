import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel } from '../../../../schemas/living-model.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { deriveConstraintVerdict, readRatifiedConstraints } from '../../../../orchestrator/context/constraint-feasibility.js';
import { unresolvedRetainedLimits } from '../../../../graph/retained-limit.js';
import { goalDependencyWords } from '../../../admission/target-testability.js';
import { goalDependencyConstraintsForRun, withGoalDependencyScores } from '../../../goal-target/goal-chance-licence.js';
import { goalTargetsBlockOf } from '../../../goal-target/goal-targets-joint.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const scenario = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
function limited(variant: 'off_frame' | 'unknown' | 'disconnected') {
  const model = structuredClone(KNOWN_ANSWER);
  model.factors.push({ ...model.factors[0]!, id: 'cost', label: 'Total spending', unit: '£',
    value: variant === 'unknown' ? null : 100, limit: { comparator: '<=', value: variant === 'off_frame' ? 200 : 110,
      source: 'user', party: null, quote: 'Keep total spending within the stated budget' } });
  if (variant === 'off_frame') model.links.push({ ...model.links[0]!, id: 'f_cost', to: 'cost',
    effect: { ...model.links[0]!.effect, unit: '£' } });
  return projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;
}
const producer = () => ({ analysis_status: 'completed', response_hash: 'own',
  meta: { seed_used: 42, n_samples: 1000, response_hash: 'own' },
  option_comparison: [{ option_id: 'hold', option_label: 'Hold', probability_of_goal: 0.1, win_probability: 0.2 },
    { option_id: 'push', option_label: 'Push', probability_of_goal: 0.6, win_probability: 0.8, evppi: 7,
      constraint_probabilities: { target_g: 0.6, limit_cost: 0.9 }, probability_of_joint_goal: 0.5,
      probability_of_joint_goal_precision: { n_informative: 1000, standard_error: 0.02 } }],
  constraint_analysis: { joint_probability: 0.5, joint_probability_precision: { n_informative: 1000, standard_error: 0.02 } },
  evppi: { f: 7 }, inference_warnings: [] });

describe('a held limit cannot erase supported goal figures or fabricate a full joint', () => {
  it.each(['off_frame', 'unknown', 'disconnected'] as const)('%s retains the bound, scope and model-relative goal results', variant => {
    const graph = limited(variant), row = graph.goal_constraints.find((c: Rec) => c.constraint_id === 'limit_cost');
    expect(row.value).toBe(variant === 'off_frame' ? 200 : 110);
    expect(row.value_frame).toBe('level');
    expect(goalDependencyConstraintsForRun(graph, graph.goal_constraints)).not.toContainEqual(expect.objectContaining({ constraint_id: 'limit_cost' }));
    expect(unresolvedRetainedLimits(graph)).toEqual([]); // Never enter the old global goal-stripping consumer.
    const raw = producer(), before = structuredClone(raw);
    const checked = withGoalDependencyScores(raw, graph, graph.goal_constraints);
    expect(checked.option_comparison[1]).toMatchObject({ probability_of_goal: 0.6, win_probability: 0.8, evppi: 7,
      constraint_probabilities: { target_g: 0.6 } });
    expect(checked.option_comparison[1]!.constraint_probabilities).not.toHaveProperty('limit_cost');
    expect(checked.option_comparison[1]).not.toHaveProperty('probability_of_joint_goal');
    expect(checked.constraint_analysis).not.toHaveProperty('joint_probability');
    expect(checked.evppi).toEqual(raw.evppi);
    const verdict = deriveConstraintVerdict(checked, readRatifiedConstraints(graph), 'push');
    expect(verdict.perLimit?.find(v => v.constraint_id === 'limit_cost')?.state).toBe('unscored');
    const block = goalTargetsBlockOf({ envelope: checked, graph, storedConstraints: graph.goal_constraints,
      sentConstraints: goalDependencyConstraintsForRun(graph, graph.goal_constraints), optionIds: ['push'], primaryGoalId: 'g' });
    expect(block?.joint.status).toBe('withheld');
    expect(block?.per_target).toContainEqual(expect.objectContaining({ constraint_id: 'target_g', pct_by_option: { push: 60 } }));
    if (variant === 'off_frame') {
      expect(goalDependencyWords(graph, 'cost')).toContain('outside the current calculation frame');
      expect(goalDependencyWords(graph, 'cost')).not.toMatch(/forecast.*needed|what forecast/i);
    }
    expect(raw).toEqual(before);
    expect(withGoalDependencyScores(checked, graph, graph.goal_constraints)).toEqual(checked);
    const plain = structuredClone(graph); delete plain.nodes.find((n: Rec) => n.id === 'cost').goal_rests_on;
    expect(withGoalDependencyScores(raw, plain, plain.goal_constraints)).toBe(raw);
  });

  it('the real loader and handler suppress a held limit before persisting the per-limit verdict', async () => {
    const graph = limited('off_frame');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(scenario, 'b2-held-limit', {
      loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
    } as never);
    const run = vi.fn(async () => producer());
    const outcome = await createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run, validatePatch: vi.fn() } as never })({ requestId: 'b2-held-limit', context: {},
      payload: { kind: 'message', scenario_id: scenario, turn_id: 'b2-held-limit', message: 'Run analysis.' },
      signal: new AbortController().signal, orientationText: '' } as never);
    expect(run).toHaveBeenCalledOnce();
    expect((run.mock.calls as unknown as Rec[][])[0]?.[0]?.goal_constraints).not.toContainEqual(expect.objectContaining({ constraint_id: 'limit_cost' }));
    const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
    expect(fact?.fact_type).toBe('run_analysis');
    if (fact?.fact_type !== 'run_analysis') throw new Error('Run fact missing');
    const result = fact.result as Rec;
    expect(result.enrichment.option_comparison[1]).toMatchObject({ probability_of_goal: 0.6, win_probability: 0.8, evppi: 7 });
    expect(result.enrichment.option_comparison[1].constraint_probabilities).not.toHaveProperty('limit_cost');
    expect(result.constraint_verdict.per_limit.find((v: Rec) => v.constraint_id === 'limit_cost').state).toBe('unscored');
    expect(result.enrichment.option_comparison[1]).not.toHaveProperty('probability_of_joint_goal');
  });

  it('the actual hiring r2 orphan stays recorded and does not refuse unrelated analysis', () => {
    const model = LivingModel.parse(JSON.parse(readFileSync(new URL('./fixtures/hiring-6ecad928-r2-living-model.json', import.meta.url), 'utf8')));
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;
    expect(graph.goal_constraints.find((c: Rec) => c.constraint_id === 'limit_cost')).toMatchObject({ value: 200000 });
    expect(graph.edges.some((e: Rec) => e.from === 'cost' || e.to === 'cost')).toBe(false);
    expect(assessCanonicalAnalysisReadiness(graph).analysisReady?.status).toBe('ready');
    expect(unresolvedRetainedLimits(graph)).toEqual([]);
  });
});
