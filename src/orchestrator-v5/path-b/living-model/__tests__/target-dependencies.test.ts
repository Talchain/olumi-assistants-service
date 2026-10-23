import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { goalDependencyCauses, targetTestabilityOf } from '../../../admission/target-testability.js';
import { goalChanceLicenceForAgent, withGoalChanceLicence } from '../../../goal-target/goal-chance-licence.js';
import { goalTargetsBlockOf } from '../../../goal-target/goal-targets-joint.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';
import { assertTargetHeld } from './assert-target-held.js';

type Rec = Record<string, any>;
const stored = (m = KNOWN_ANSWER) => GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m });
const goal = (g: Rec, id = 'g'): Rec => g.nodes.find((n: Rec) => n.id === id)!;
const raw = () => ({ option_comparison: [{ option_id: 'hold', probability_of_goal: 0.1 }, { option_id: 'push', probability_of_goal: 0.6 }], inference_warnings: [] });

describe('stated targets survive unresolved dependencies without licensing their chance', () => {
  it('keeps target, frame, comparator, current level, qualitative evidence and dissent; withholds producer-supplied chances', () => {
    const m = structuredClone(KNOWN_ANSWER), plain = stored(m);
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
    const checked = withGoalChanceLicence(envelope, graph, 'g', undefined, undefined, graph, { storedConstraints: rows, sentConstraints: rows });
    expect(checked.option_comparison[0]!.constraint_probabilities).not.toHaveProperty('target_second');
    expect(checked.option_comparison[0]!).not.toHaveProperty('probability_of_joint_goal');
  });

  it('malformed or duplicate dependency records fail closed, while old graphs remain readable', () => {
    const graph = stored() as Rec;
    expect(goalDependencyCauses(graph, 'g')).toEqual([]);
    goal(graph).goal_rests_on = [];
    expect(goalDependencyCauses(graph, 'g')).toEqual([{ id: 'g', reason: 'dependency_record_unreadable' }]);
    expect(GraphV3.safeParse(graph).success).toBe(false);
    goal(graph).goal_rests_on = [{ id: 'f', reason: 'identity_part_unknown' }];
    graph.nodes.push(structuredClone(goal(graph)));
    expect(goalDependencyCauses(graph, 'g')[0]?.reason).toBe('dependency_record_unreadable');
  });
});
