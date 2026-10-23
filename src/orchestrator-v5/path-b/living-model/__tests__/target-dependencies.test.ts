import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LivingModel } from '../../../../schemas/living-model.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { goalDependencyCauses, targetTestabilityOf } from '../../../admission/target-testability.js';
import { goalChanceLicenceForAgent, withGoalChanceLicence, primaryOnlyTargetIds } from '../../../goal-target/goal-chance-licence.js';
import { goalTargetsBlockOf } from '../../../goal-target/goal-targets-joint.js';
import { mapLivingModel } from '../mapper.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { buildModel } from '../../tools/draft-tool.js';
import { blockersOf, corePostimage, REPAIRS, selfCheck } from '../../tools/goal-path.js';
import { resolveRunAdmission } from '../../../tools/handlers/analysis-ready-core.js';
import { validateGraphStructure } from '../../../../orchestrator/graph-structure-validator.js';
import { guardAnalysisParticipation } from '../../../tools/handlers/run-analysis-participation-guard.js';
import { withGoalDependencyScores, goalDependencyConstraintsForRun } from '../../../goal-target/goal-chance-licence.js';
import { deriveConstraintVerdict, readRatifiedConstraints } from '../../../../orchestrator/context/constraint-feasibility.js';
import { KNOWN_ANSWER } from './fixtures.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { assertTargetHeld } from './assert-target-held.js';
import { buildAnalysisResultBlock } from '../../../compose.js';
import { goalChanceCellFacesForAgent } from '../../../agent-lane/goal-chance-screen-lines.js';
import { readRunEvidence, runEvidenceWireOf } from '../../../agent-lane/run-evidence.js';

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


/** Transport double answers ONLY rows sent by the real handler; no provider/engine or borrowed question evidence. */
async function runTargetModel(model: Parameters<typeof mapLivingModel>[0], savedGraph?: ReturnType<typeof stored>) {
  const graph = savedGraph ?? stored(model), scenario = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const before = structuredClone(graph);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(scenario, 'b2-target-presentation', {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  const run = vi.fn(async (payload: Rec) => {
    const rows: Rec[] = payload.goal_constraints ?? [];
    return { analysis_status: 'completed', constraints_status: 'computed', response_hash: 'own',
      meta: { seed_used: 42, n_samples: 1000, response_hash: 'own' },
      constraint_results: rows.map(r => ({ ...r, frame_verdict: 'scored',
        scale_provenance: { source: 'test_transport_own_node_cap', range_unified: true, decision_grade: true } })),
      option_comparison: payload.options.map((o: Rec, i: number) => {
        const p = (i + 2) / 10;
        return { option_id: o.id ?? o.option_id, option_label: o.label, probability_of_goal: p,
          win_probability: p, evppi: 7, probability_of_goal_precision: { n_met: Math.round(p * 1000), n_informative: 1000 },
          ...(rows.length === 0 ? {} : { constraint_probabilities: Object.fromEntries(rows.map(r => [r.constraint_id, p])),
            constraint_probabilities_precision: Object.fromEntries(rows.map(r => [r.constraint_id, { n_informative: 1000, standard_error: 0.02 }])),
            probability_of_joint_goal: p / 2,
            probability_of_joint_goal_precision: { n_informative: 1000, standard_error: 0.02 } }) };
      }), inference_warnings: [] };
  });
  const outcome = await createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run, validatePatch: vi.fn() } as never })({ requestId: 'b2-target-presentation', context: {},
    payload: { kind: 'message', scenario_id: scenario, turn_id: 'b2-target-presentation', message: 'Run analysis.' },
    signal: new AbortController().signal, orientationText: '' } as never);
  expect(run).toHaveBeenCalledOnce(); expect(graph).toEqual(before);
  const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
  if (fact?.fact_type !== 'run_analysis') throw new Error('Run fact missing');
  const result = fact.result as Rec;
  return { graph, result, fact, wire: run.mock.calls[0]![0],
    licence: result.enrichment.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED') as Rec };
}

describe('the full reasoning model and the submitted calculation share one admission contract', () => {
  const brief = readFileSync(new URL('./fixtures/hiring-05745055-brief.txt', import.meta.url), 'utf8');
  const hiring = (round: 1 | 2) => LivingModel.parse(JSON.parse(readFileSync(new URL(round === 1
    ? './fixtures/hiring-05745055-living-model.json' : './fixtures/hiring-05745055-r2-living-model.json', import.meta.url), 'utf8')));

  /** Stateful graph-route double only: the real draft, kernel, mapper, write/readback, self-check, admission and Run run. */
  async function savedDraft(model: ReturnType<typeof hiring>) {
    let graph: Rec | null = null;
    const identity = () => computeGraphIdentityHash(graph as never)!;
    const dispatch = vi.fn(async (path: string, body?: unknown) => {
      const b = (body ?? {}) as Rec;
      if (path.endsWith('/graph/register')) {
        if (b.expected_graph_identity_hash !== null || graph !== null) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
        graph = structuredClone(b.graph as Rec);
        return { status: 200, json: { graph_identity_hash: identity(), graph_hash: computeAnalysisAffectingGraphHash(graph as never),
          model_version: { version_id: 'v_draft', version_number: 1, mutation_id: 'm_draft', creation_kind: 'committed_mutation',
            graph_identity_hash: identity().value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(graph as never) } } };
      }
      return graph === null ? { status: 200, json: { graph: null, graph_present: false, graph_hash: null, graph_identity_hash: null } }
        : { status: 200, json: { graph, brief_text: brief, graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: identity() } };
    });
    const out = await buildModel({ dispatch, restructure: { repairs: REPAIRS } },
      { scenario_id: 'scn_secondary_admission', verified_user_messages: [brief], user_turn_text: brief }, { brief, model });
    expect(out).toMatchObject({ status: 'ok', data: { run_ready: true } });
    expect(graph).not.toBeNull();
    return GraphV3.parse(JSON.parse(JSON.stringify(graph)));
  }

  for (const [round, secondary, oldBlock] of [[1, 'spend', 'ORPHAN_NODE'], [2, 'spend_less', 'NO_PATH_TO_GOAL']] as const) {
    it(`real hiring r${round}: ${oldBlock} belongs to a held secondary, not the primary; actual draft/admission then Run`, async () => {
      const model = hiring(round), before = structuredClone(model), graph = await savedDraft(model);
      expect(graph.living_model).toMatchObject({ aims: before.aims });
      expect(model).toEqual(before);
      expect(goal(graph, secondary)).toMatchObject({ analysis_participation: 'retained_excluded', goal_rests_on: expect.any(Array) });
      expect(validateGraphStructure(graph, { leaveOutInertRisks: true }).violations.some(v => v.code === oldBlock)).toBe(true);
      expect(resolveRunAdmission(graph).willProceed).toBe(true);
      const run = await runTargetModel(model, graph);
      expect(run.wire.graph.nodes.some((n: Rec) => n.id === secondary)).toBe(false);
      expect(run.wire.goal_constraints.some((r: Rec) => r.node_id === secondary)).toBe(false);
      expect(run.licence).toBeDefined();
      expect(graph.living_model).toMatchObject({ aims: before.aims });
      expect(goal(graph, secondary).goal_rests_on.length).toBeGreaterThan(0);
      expect(run.result.enrichment.option_comparison.every((o: Rec) => o.probability_of_joint_goal === undefined)).toBe(true);
    });
  }

  const withHeldSecondary = () => {
    const model = structuredClone(KNOWN_ANSWER), second = structuredClone(model.aims[0]!);
    model.factors[0]!.unit = 'level';
    Object.assign(second, { id: 'second', text: 'Reach 90 units' });
    Object.assign(second.target!, { value: 90, current: null });
    model.aims.push(second);
    return model;
  };

  it('a primary depending on a held secondary remains held and is never calculated on less', () => {
    const model = withHeldSecondary();
    model.links.push({ ...model.links[0]!, id: 'second_g', from: 'second', to: 'g' });
    const mapped = mapLivingModel(model), graph = corePostimage(mapped, model);
    expect(goal(graph, 'second').analysis_participation).not.toBe('retained_excluded');
    expect(goalDependencyCauses(graph, 'g')).toContainEqual({ id: 'second', reason: 'goal_level_unknown' });
    expect(blockersOf(model, selfCheck(model, mapped)).all.length).toBeGreaterThan(0);
    expect(goalChanceLicenceForAgent(withGoalChanceLicence(raw(), graph, 'g'))).toBeUndefined();
  });

  it('a required limit protects its upstream held target; the existing guard still refuses an excluded intervention target', () => {
    const model = withHeldSecondary();
    model.factors.push({ ...model.factors[0]!, id: 'budget_level', label: 'Budget used', value: 5, unit: 'units',
      limit: { comparator: '<=', value: 8, source: 'user', party: null, quote: 'at most 8 units' } });
    model.links.push({ ...model.links[0]!, id: 'second_budget', from: 'second', to: 'budget_level' });
    const graph = corePostimage(mapLivingModel(model), model);
    expect(goal(graph, 'second').analysis_participation).not.toBe('retained_excluded');
    goal(graph, 'second').analysis_participation = 'retained_excluded';
    const guarded = guardAnalysisParticipation(graph, { goalNodeId: 'g', submittedOptionIds: ['push', 'hold'],
      optionInterventionTargetIds: ['second'] });
    expect(guarded.refusals).toContainEqual({ node_id: 'second', reason: 'option_intervention_target' });
    expect(guarded.excludedNodeIds).toEqual([]);
  });
});

describe('the real Run preserves the primary presentation beside a held secondary aim', () => {
  it('no secondary aim: the verdict is byte-identical to the frozen staging no-constraint result', () => {
    const graph = stored(), contextOnly = primaryOnlyTargetIds(graph, [], [], 'g');
    expect(contextOnly.size).toBe(0);
    const legacy = deriveConstraintVerdict(raw(), [], 'push');
    const next = deriveConstraintVerdict(raw(), [], 'push', undefined, undefined, undefined, undefined, contextOnly);
    // Frozen from staging 6f10ccd4's unchanged verdict('not_applicable') shape, rather than a repinned model hash.
    const staging = { state: 'not_applicable', mayNameLeadingOption: true, codes: [], constraints: [],
      leaderInfeasibility: null, outOfScopeConstraints: [], unmeasuredTargetConstraints: [] };
    expect(JSON.stringify(next)).toBe(JSON.stringify(staging));
    expect(JSON.stringify(next)).toBe(JSON.stringify(legacy));
    const limits = [{ constraint_id: 'budget', node_id: 'f', label: 'Budget', unit: '£', source_quote: null }];
    expect(JSON.stringify(deriveConstraintVerdict(raw(), limits, 'push', undefined, undefined, undefined, undefined, contextOnly)))
      .toBe(JSON.stringify(deriveConstraintVerdict(raw(), limits, 'push')));
  });

  it('actual MRR: the full primary licence, status quo, leader permission and static horizon survive; churn gets its true reason once', async () => {
    const model = LivingModel.parse(JSON.parse(readFileSync(new URL('./fixtures/mrr-459f8bde-living-model.json', import.meta.url), 'utf8')));
    const primary = structuredClone(model); primary.aims = primary.aims.filter(a => a.id === 'mrr');
    // Staging's single-scored-aim slice: same MRR facts and producer; the current model keeps the person's churn aim too.
    const base = await runTargetModel(primary), head = await runTargetModel(model);
    expect(base.licence).toBeDefined(); expect(head.licence).toBeDefined();
    expect(base.licence.pct_by_option).toEqual({ features_price: 20, advertising: 30, status_quo: 40, retention: 50 });
    const held = head.licence.notes.filter((n: string) => n.includes('keeping monthly churn under 4%'));
    expect(held).toHaveLength(1);
    expect(held[0]).toContain("today's level");
    expect(held[0]).not.toMatch(/scoring frame|quantity.*resolved/);
    expect({ ...head.licence, notes: head.licence.notes.filter((n: string) => n !== held[0]) }).toEqual(base.licence);
    expect(head.licence).not.toHaveProperty('targets');
    expect(head.licence.horizon_line).toContain("doesn't project");
    expect(head.licence.notes).toContain('Static model; not a forecast to a date.');
    const horizon = (r: Rec) => r.enrichment.inference_warnings.filter((w: Rec) => w.code === 'GOAL_HORIZON_NOT_TESTED');
    expect(horizon(head.result)).toEqual(horizon(base.result));
    expect(head.result.constraint_verdict.may_name_leading_option).toBe(base.result.constraint_verdict.may_name_leading_option);
    expect(base.result.constraint_verdict.may_name_leading_option).toBe(true);
    expect(head.result.constraint_verdict.per_limit).toContainEqual(expect.objectContaining({ constraint_id: 'target_churn', state: 'unscored' }));
    expect(head.wire.goal_constraints.map((r: Rec) => r.constraint_id)).toEqual(['target_mrr']);
    expect(head.wire.graph.nodes.some((n: Rec) => n.id === 'churn')).toBe(false);
    expect(goal(head.graph, 'churn').goal_rests_on).toContainEqual({ id: 'churn', reason: 'goal_level_unknown' });
    const primaryFigures = (r: Rec) => r.enrichment.option_comparison.map((o: Rec) => ({ id: o.option_id,
      chance: o.probability_of_goal, precision: o.probability_of_goal_precision, share: o.win_probability, evppi: o.evppi }));
    expect(primaryFigures(head.result)).toEqual(primaryFigures(base.result));
    const baseAgent = goalChanceLicenceForAgent(base.result.enrichment), headAgent = goalChanceLicenceForAgent(head.result.enrichment);
    expect(baseAgent).toBeDefined(); expect(headAgent).toBeDefined();
    expect({ ...headAgent, notes: headAgent!.notes!.filter(n => n !== held[0]) }).toEqual(baseAgent);
    const faces = (r: typeof head) => goalChanceCellFacesForAgent(buildAnalysisResultBlock(r.fact), r.graph, true,
      readRunEvidence(runEvidenceWireOf(r.fact)));
    expect(faces(head)).toEqual(faces(base));
    const baseBlock = buildAnalysisResultBlock(base.fact), headBlock = buildAnalysisResultBlock(head.fact);
    expect(headBlock.leading_option_id).toBe(baseBlock.leading_option_id);
    expect(headBlock.win_probabilities).toEqual(baseBlock.win_probabilities);
    // The actual writer's primary opening/headline survives; later disclosure may name the held part and its links.
    expect(head.result.summary).toContain(base.result.summary.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '));
    expect(JSON.stringify(head.result)).not.toContain('Its quantity and scoring frame need to be resolved');
  });

  it('primary-only scope cannot discard a hard limit, hide a held primary, or license a partial-subset joint', () => {
    const graph = stored(twoAims()) as Rec;
    goal(graph, 'second').goal_rests_on = [{ id: 'second', reason: 'goal_level_unknown' }];
    const rows = [...graph.goal_constraints, { constraint_id: 'budget', node_id: 'f', role: 'limit', value: 20 }];
    const sent = rows.filter(r => r.constraint_id !== 'target_second');
    expect([...primaryOnlyTargetIds(graph, rows, sent, 'g')]).toEqual(['target_g', 'target_second']);
    expect(primaryOnlyTargetIds(graph, rows, sent, 'g').has('budget')).toBe(false);
    expect(primaryOnlyTargetIds(graph, rows, [], 'g').size).toBe(0); // No scored primary cannot acquire its permission.
    const verdict = deriveConstraintVerdict(raw(), readRatifiedConstraints({ goal_constraints: rows }), 'push',
      undefined, undefined, { userBaselineIds: new Set(), userAssumptionIds: new Set() }, undefined,
      primaryOnlyTargetIds(graph, rows, sent, 'g'));
    expect(verdict.mayNameLeadingOption).toBe(false); // The genuine budget has no score; it still blocks.
    expect(verdict.perLimit?.map(r => r.constraint_id)).toEqual(['target_g', 'target_second', 'budget']);
    expect(verdict.joint).toMatchObject({ state: 'withheld' });
    goal(graph).goal_rests_on = [{ id: 'g', reason: 'goal_level_unknown' }];
    expect(primaryOnlyTargetIds(graph, rows, sent, 'g').size).toBe(0);
    delete goal(graph).goal_rests_on;
    // Two scored aims plus a third held aim still require the full saved joint, never a two-aim subset.
    const third = { constraint_id: 'target_third', node_id: 'third', role: 'goal_target', value: 80 };
    const three = [...rows, third];
    expect(primaryOnlyTargetIds(graph, three, [...sent, third], 'g').size).toBe(0);
    delete goal(graph, 'second').goal_rests_on;
    expect(primaryOnlyTargetIds(graph, rows, sent, 'g').size).toBe(0);
  });

  it('two actually scored aims still use the per-target and full same-draw joint presentation', async () => {
    const { result, licence, wire } = await runTargetModel(twoAims());
    expect(wire.goal_constraints.map((r: Rec) => r.constraint_id)).toEqual(['target_g', 'target_second']);
    expect(licence.targets.per_target.map((r: Rec) => r.constraint_id)).toEqual(['target_g', 'target_second']);
    expect(licence.targets.joint).toMatchObject({ status: 'licensed', pct_by_option: { push: 15 } });
    expect(licence.pct_by_option).toEqual(licence.targets.joint.pct_by_option);
    expect(result.constraint_verdict.per_limit.every((r: Rec) => r.state === 'scored')).toBe(true);
  });
});
