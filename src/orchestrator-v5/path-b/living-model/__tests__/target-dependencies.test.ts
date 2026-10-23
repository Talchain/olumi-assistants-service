import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { goalDependencyCauses, targetTestabilityOf } from '../../../admission/target-testability.js';
import { goalChanceLicenceForAgent, withGoalChanceLicence } from '../../../goal-target/goal-chance-licence.js';
import { goalTargetsBlockOf } from '../../../goal-target/goal-targets-joint.js';
import { mapLivingModel } from '../mapper.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { withGoalDependencyScores, goalDependencyConstraintsForRun } from '../../../goal-target/goal-chance-licence.js';
import { deriveConstraintVerdict, readRatifiedConstraints } from '../../../../orchestrator/context/constraint-feasibility.js';
import { KNOWN_ANSWER } from './fixtures.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { assertTargetHeld } from './assert-target-held.js';

type Rec = Record<string, any>;
const stored = (m = KNOWN_ANSWER) => GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m });
const goal = (g: Rec, id = 'g'): Rec => g.nodes.find((n: Rec) => n.id === id)!;
function twoAims() {
  const m = structuredClone(KNOWN_ANSWER), second = structuredClone(m.aims[0]!);
  Object.assign(second, { id: 'second', text: 'Reach 90 units' }); second.target!.value = 90;
  m.aims.push(second); m.links.push({ ...m.links[0]!, id: 'f_second', to: 'second' });
  return m;
}
const raw = () => ({ option_comparison: [{ option_id: 'hold', probability_of_goal: 0.1 }, { option_id: 'push', probability_of_goal: 0.6 }], inference_warnings: [] });

describe('stated targets survive unresolved dependencies without licensing their chance', () => {
  it('qualitative secondary aims stay in reasoning context and never change the primary projection or its original reason', () => {
    for (const level of [70, null]) {
      const m = structuredClone(KNOWN_ANSWER); m.aims[0]!.target!.current = level;
      const old = mapLivingModel(m), oldVerdict = targetTestabilityOf(old.graph);
      for (const id of ['quality', 'spend_less', 'economy']) {
        const next = structuredClone(m), qualitative = structuredClone(m.aims[0]!);
        Object.assign(qualitative, { id, text: `Maintain ${id}` });
        Object.assign(qualitative.target!, { value: null, low: null, high: null, current: null });
        next.aims.push(qualitative);
        const before = structuredClone(next), mapped = mapLivingModel(next);
        expect(mapped.graph).toEqual(old.graph);
        expect(targetTestabilityOf(mapped.graph)).toEqual(oldVerdict);
        expect(mapped.withheld).toEqual([...old.withheld, { id, reason: 'aim_not_in_slice' }]);
        expect(next).toEqual(before);
      }
    }
  });

  it('keeps target, frame, comparator, current level, qualitative evidence and dissent; withholds producer-supplied chances', () => {
    const m = twoAims(), plain = stored(m);
    m.conditions.push({ text: 'Board approval remains open', role: 'prerequisite', applies_to: ['f_g'], source: 'user',
      party: null, quote: 'Board approval remains open' });
    const before = structuredClone(m), graph = stored(m), own = goal(graph);
    expect(own).toMatchObject({ goal_threshold_raw: 100, goal_threshold: 0.8, goal_threshold_cap: 125,
      goal_threshold_unit: 'units', goal_direction: '>=', observed_state: { raw_value: 70 } });
    expect(own.goal_rests_on).toEqual([{ id: 'condition:Board approval remains open', reason: 'condition_not_in_slice', applies_to: ['f_g'] }]);
    expect(targetTestabilityOf(graph)).toMatchObject({ kind: 'not_testable', failures: [{ code: 'model_dependency_unresolved' }] });
    assertTargetHeld(graph as Rec, 'g', 100);
    const held = withGoalChanceLicence(raw(), graph, 'g');
    expect(JSON.stringify(held.inference_warnings)).toContain('Board approval remains open');
    expect(JSON.stringify(held.inference_warnings)).not.toContain("What's today's level");
    // Positive and historical controls: a fresh supported model can earn a licence; clearing today's model never revives the old Run.
    expect(goalChanceLicenceForAgent(withGoalChanceLicence(raw(), plain, 'g'))).toBeDefined();
    expect(goalChanceLicenceForAgent(withGoalChanceLicence(held, plain, 'g'))).toBeUndefined();
    const sameQuestion = structuredClone(graph); delete goal(sameQuestion).goal_rests_on;
    expect(computeAnalysisAffectingGraphHash(graph as never)).not.toBe(computeAnalysisAffectingGraphHash(sameQuestion as never));
    expect(graph.living_model).toEqual(before);
    expect(m).toEqual(before);
  });

  it('an off-path prerequisite, challenge or applied assumption does not acquire a blocking hold', () => {
    for (const role of ['challenge', 'assumption', 'prerequisite'] as const) {
      const m = structuredClone(KNOWN_ANSWER);
      m.conditions.push({ text: 'A stated premise', role, applies_to: role === 'prerequisite' ? ['unrelated'] : ['f_g'],
        source: 'user', party: null, quote: 'A stated premise' });
      const graph = stored(m);
      expect(goal(graph)).not.toHaveProperty('goal_rests_on');
      expect(goalDependencyCauses(graph, 'g')).toEqual([]);
    }
  });

  it('withholds only the affected target marginal and the full joint, retaining the other target’s own result', () => {
    const m = structuredClone(KNOWN_ANSWER), second = structuredClone(m.aims[0]!);
    Object.assign(second, { id: 'second', text: 'Reach 90 units' }); second.target!.value = 90;
    m.aims.push(second);
    m.links.push({ ...m.links[0]!, id: 'f_second', to: 'second' });
    m.conditions.push({ text: 'A second-target approval', role: 'prerequisite', applies_to: ['second'], source: 'user', party: null, quote: 'A second-target approval' });
    const graph = stored(m), rows = graph.goal_constraints!;
    expect(goal(graph)).not.toHaveProperty('goal_rests_on');
    expect(goal(graph, 'second').goal_threshold_raw).toBe(90);
    const envelope = { option_comparison: [{ option_id: 'push', probability_of_goal: 0.6,
      constraint_probabilities: { target_g: 0.6, target_second: 0.8 },
      probability_of_joint_goal: 0.5, probability_of_joint_goal_precision: { n_informative: 1000, standard_error: 0.02 } }] };
    const block = goalTargetsBlockOf({ envelope, graph, storedConstraints: rows, sentConstraints: rows, optionIds: ['push'], primaryGoalId: 'g' });
    expect(block?.joint).toMatchObject({ status: 'withheld', reason: 'condition_withheld' });
    expect(block?.per_target).toEqual([expect.objectContaining({ constraint_id: 'target_g', pct_by_option: { push: 60 } })]);
    const wireRows = goalDependencyConstraintsForRun(graph, rows);
    expect(wireRows.map(r => r.constraint_id)).not.toContain('target_second');
    expect(wireRows.map(r => r.constraint_id)).toContain('target_g');
    const projected = withGoalDependencyScores(envelope, graph, rows);
    const verdict = deriveConstraintVerdict(projected, readRatifiedConstraints(graph), 'push', undefined, undefined, { userBaselineIds: new Set(), userAssumptionIds: new Set() });
    expect(verdict.perLimit?.find(r => r.constraint_id === 'target_second')?.state).toBe('unscored');
    const checked = withGoalChanceLicence(envelope, graph, 'g', undefined, undefined, graph, { storedConstraints: rows, sentConstraints: rows });
    expect(checked.option_comparison[0]!.probability_of_goal).toBe(0.6);
    expect(withGoalDependencyScores(projected, graph, rows)).toEqual(projected);
    expect(checked.option_comparison[0]!.constraint_probabilities).not.toHaveProperty('target_second');
    expect(checked.option_comparison[0]!).not.toHaveProperty('probability_of_joint_goal');
  });

  it('the real Run handler withholds a dependent secondary aim before persisting the constraint verdict', async () => {
    const model = structuredClone(KNOWN_ANSWER), second = structuredClone(model.aims[0]!);
    Object.assign(second, { id: 'second', text: 'Reach 90 units' }); second.target!.value = 90;
    model.aims.push(second); model.links.push({ ...model.links[0]!, id: 'f_second', to: 'second' });
    model.conditions.push({ text: 'A second-target approval', role: 'prerequisite', applies_to: ['second'], source: 'user', party: null, quote: 'A second-target approval' });
    const graph = stored(model), scenario = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const snapshot = await loadScenarioSnapshotForRunAnalysis(scenario, 'b2-held-aim', {
      loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
    } as never);
    const producer = { analysis_status: 'completed', response_hash: 'own', meta: { seed_used: 42, n_samples: 1000, response_hash: 'own' },
      option_comparison: [{ option_id: 'hold', option_label: 'Hold', probability_of_goal: 0.1, win_probability: 0.2 },
        { option_id: 'push', option_label: 'Push', probability_of_goal: 0.6, win_probability: 0.8, evppi: 7,
          constraint_probabilities: { target_g: 0.6, target_second: 0.8 }, probability_of_joint_goal: 0.5,
          probability_of_joint_goal_precision: { n_informative: 1000, standard_error: 0.02 } }], inference_warnings: [] };
    const run = vi.fn(async (_payload: Rec) => structuredClone(producer));
    const outcome = await createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run, validatePatch: vi.fn() } as never })({ requestId: 'b2-held-aim', context: {},
      payload: { kind: 'message', scenario_id: scenario, turn_id: 'b2-held-aim', message: 'Run analysis.' },
      signal: new AbortController().signal, orientationText: '' } as never);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0].goal_constraints).not.toContainEqual(expect.objectContaining({ constraint_id: 'target_second' }));
    const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
    if (fact?.fact_type !== 'run_analysis') throw new Error('Run fact missing');
    const result = fact.result as Rec;
    expect(result.enrichment.option_comparison[1]).toMatchObject({ probability_of_goal: 0.6, win_probability: 0.8, evppi: 7 });
    expect(result.enrichment.option_comparison[1].constraint_probabilities).not.toHaveProperty('target_second');
    expect(result.constraint_verdict.per_limit.find((v: Rec) => v.constraint_id === 'target_second').state).toBe('unscored');
    expect(result.enrichment.option_comparison[1]).not.toHaveProperty('probability_of_joint_goal');
    expect(goal(graph, 'second').goal_threshold_raw).toBe(90);
  });

  it('malformed or duplicate dependency records fail closed, while old graphs remain readable', () => {
    const graph = stored() as Rec;
    expect(goalDependencyCauses(graph, 'g')).toEqual([]);
    const oldRun = raw();
    expect(withGoalDependencyScores(oldRun, graph, [])).toBe(oldRun);
    const oldRows = [{ constraint_id: 'legacy', node_id: 'g', value: 100 }];
    expect(goalDependencyConstraintsForRun(graph, oldRows)).toBe(oldRows);
    goal(graph).goal_rests_on = [];
    expect(goalDependencyCauses(graph, 'g')).toEqual([{ id: 'g', reason: 'dependency_record_unreadable' }]);
    expect(GraphV3.safeParse(graph).success).toBe(false);
    goal(graph).goal_rests_on = [{ id: 'f', reason: 'identity_part_unknown' }];
    graph.nodes.push(structuredClone(goal(graph)));
    expect(goalDependencyCauses(graph, 'g')[0]?.reason).toBe('dependency_record_unreadable');
  });
});
