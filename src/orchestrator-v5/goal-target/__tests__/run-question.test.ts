import { describe, expect, it } from 'vitest';
import { withEvaluatedGoalChanceInputs, deriveRunQuestion, sentGoalThresholdOf } from '../goal-chance-licence.js';
import { sentDigest } from '../../tools/handlers/run-input-snapshot.js';
import { STATIC_LEVEL_CAPABILITY } from '../run-question-scope.js';

const saved = () => ({ nodes: [
  { id: 'capacity', kind: 'goal', label: 'Weekly capacity', goal_threshold_raw: 100, goal_threshold: 0.2,
    goal_threshold_cap: 500, goal_threshold_frame: 'level', goal_threshold_unit: 'tickets per week', goal_direction: '>=',
    goal_target_basis: { reference: 'today' },
    goal_deadline_as_stated: 'by March', goal_horizon: { deadline: '2027-03-31' },
    observed_state: { raw_value: 80, value: 0.16, baseline: 0.16, cap: 500, unit: 'tickets per week', source: 'user_override' } },
  { id: 'hire', kind: 'option' }, { id: 'hold', kind: 'option', is_baseline: true },
], edges: [] });
const request = () => ({ graph: saved(), goal_node_id: 'capacity', options: [{ id: 'hire' }, { id: 'hold', is_baseline: true }] });
const evidence = (sent: unknown = request()) => ({ runId: 'run-N', occurrence: { fact_row_id: 'fact-N', evaluated_scenario_revision: 12 }, inputSnapshot: {
  sent_digest: sentDigest(sent as Record<string, unknown>),
  goal: { node_id: 'capacity', label: 'Weekly capacity', target_raw: 100, frame: 'level', unit: 'tickets per week', operator: '>=' },
  options: [{ option_id: 'hire' }, { option_id: 'hold', is_baseline: true }], options_not_sent: [],
  factors: [{ factor_id: 'capacity', raw: 80, encoded: 0.16, unit: 'tickets per week' }],
} });

describe('Run question: evaluated inputs and saved revision, never today’s model or result percentiles', () => {
  it('the licence validates static capacity; the descriptive record cannot grant a chance before it exists', () => {
    const q = deriveRunQuestion({ runEvidence: evidence(), historicalModel: { revision: 12, graph: saved() }, dispatchedRequest: request() });
    expect(q.run_id).toBe('run-N');
    expect(q.evaluated_scenario_revision).toBe(12);
    expect(q.asked).toMatchObject({ target: 100, comparator: '>=', frame: 'level', unit: 'tickets per week', reference: 'today', horizon: { as_stated: 'by March' } });
    expect(q.calculated).toMatchObject({ target: 100, baseline: 80, encoded_target: 0.2, frame: 'level', comparator: '>=' });
    expect(q.scope.can_show_goal_chance).toBe(false);
    expect(withEvaluatedGoalChanceInputs({}, saved(), 'capacity', request()).scope).toMatchObject({
      status: 'supported_static', note: 'Static model; not a forecast to a date.',
      capability: { declaration_version: 1, authority: 'cee_source_contract', engine_attestation: 'unverified',
        engine_support: { minimum_option_count: 1 },
        transport_admission: { minimum_option_count: 2, single_option_goal_chance: false },
        potential_claim_support: { one_surviving_result_licenses_leader: false, static_calculation_answers_date: false } } });
    expect(q.omitted).toContainEqual({ field: 'horizon', reason: 'not_verified', asked: q.asked!.horizon });
  });

  it.each(['wrong_frame', 'missing_baseline', 'reversed_comparator'] as const)('%s cannot be rescued by a static caveat', mutant => {
    const sent = request();
    if (mutant === 'wrong_frame') sent.graph.nodes[0]!.goal_threshold_frame = 'delta';
    if (mutant === 'missing_baseline') delete (sent.graph.nodes[0] as Record<string, unknown>).observed_state;
    if (mutant === 'reversed_comparator') Object.assign(sent, { goal_direction: 'minimise' });
    const checked = withEvaluatedGoalChanceInputs({ option_comparison: [{ option_id: 'hire', probability_of_goal: 0.6 }] },
      saved(), 'capacity', sent);
    expect(checked.scope.status).toBe('invalid');
    expect(checked.scope.can_show_goal_chance).toBe(false);
    expect(JSON.stringify(checked.response)).not.toContain('probability_of_goal');
  });

  it('a stated target150 with an inconsistent encoded comparison stays a conversion failure, never a missing user target', () => {
    const graph = saved(); graph.nodes[0]!.goal_threshold_raw = 150;
    const sent = request(); sent.graph.nodes[0]!.goal_threshold_raw = 150;
    const checked = withEvaluatedGoalChanceInputs({ option_comparison: [{ option_id: 'hire', probability_of_goal: 0.6 }] },
      graph, 'capacity', sent);
    expect(checked.scope).toMatchObject({ status: 'invalid', can_show_goal_chance: false,
      reasons: ['unverified_target_conversion'] });
    expect(JSON.stringify(checked.response)).not.toContain('probability_of_goal');
  });

  it('a later revision never supplies run N’s missing asked question', () => {
    const later = saved(); later.nodes[0]!.goal_threshold_raw = 150;
    const selected = evidence();
    const q = deriveRunQuestion({ runEvidence: selected, historicalModel: { revision: 13, graph: later } });
    expect(q.asked).toBeNull();
    // Raw100 was retained, but the encoded comparison was not: never call that a performed target.
    expect(selected.inputSnapshot.goal.target_raw).toBe(100);
    expect(q.calculated?.target).toBeUndefined();
    expect(q.evaluated_scenario_revision).toBe(12);
    expect(q.evidence.missing).toContain('historical_model_at_evaluated_revision');
  });

  it('missing snapshots and revisions are unverified, never reconstructed from a probability', () => {
    const q = deriveRunQuestion({ storedResult: { run_id: 'old', option_comparison: [{ probability_of_goal: 0.35, outcome: { p10: 0.1, p90: 0.4 } }] } });
    expect(q.asked).toBeNull(); expect(q.calculated).toBeNull();
    expect(q.evaluated_scenario_revision).toBeNull();
    expect(q.evidence.status).toBe('unverified');
    expect(q.evidence.missing).toEqual(expect.arrayContaining(['input_snapshot', 'evaluated_scenario_revision']));
    expect(q.scope.can_show_goal_chance).toBe(false);
    // The declaration is available before a Run. It cannot supply missing evidence for this historical Run.
    expect(STATIC_LEVEL_CAPABILITY.declaration_version).toBe(1);
    expect(q.scope.capability).toBeUndefined();
  });

  it('a source contract names independent claim owners; engine support grants neither admission nor leadership', () => {
    expect(STATIC_LEVEL_CAPABILITY.engine_support.request_frames).toEqual(['level', 'delta', 'change_abs', 'change_rel']);
    expect(STATIC_LEVEL_CAPABILITY.potential_claim_support.goal_chance_requires)
      .toEqual(['admission', 'target_testability', 'currentness', 'goal_chance_licence']);
    expect(STATIC_LEVEL_CAPABILITY.potential_claim_support.goal_chance_and_ordering).toBe('goalChanceLicenceForAgent');
    expect(STATIC_LEVEL_CAPABILITY.potential_claim_support.comparative_leadership).toBe('leaderLicenceFromState');
    expect(STATIC_LEVEL_CAPABILITY).not.toHaveProperty('may_run');
  });

  it('an existing temporal calculation outside this capability is never labelled static or said to have ignored its horizon', () => {
    const historical = saved(); Object.assign(historical.nodes[0]!, { nonlinear_identity: { operation: 'accumulation' } });
    const q = deriveRunQuestion({ runEvidence: evidence(), historicalModel: { revision: 12, graph: historical }, dispatchedRequest: request() });
    expect(withEvaluatedGoalChanceInputs({}, historical, 'capacity', request()).scope.status).toBe('outside_static_scope');
    expect(STATIC_LEVEL_CAPABILITY.engine_support.temporal_evolution).toBe('outside_this_declaration');
    expect(q.calculated?.scope).toBeUndefined();
    expect(q.omitted).toContainEqual({ field: 'horizon', reason: 'not_verified', asked: q.asked!.horizon });
  });

  it('a different stored Run cannot lend its calculation licence to the selected evidence', () => {
    const q = deriveRunQuestion({ runEvidence: evidence(), storedResult: { run_id: 'another-Run' },
      historicalModel: { revision: 12, graph: saved() }, dispatchedRequest: request() });
    expect(q.evidence.missing).toContain('selected_run_identity');
    expect(q.scope.can_show_goal_chance).toBe(false);
    expect(q.scope.reasons).toContain('selected_run_identity_mismatch');
  });

  it('the final request records80 /100 /level /≥ /tickets per week without consulting output percentiles', () => {
    const sentRun = request();
    const record = sentGoalThresholdOf({}, saved(), 'capacity', undefined, { sentRun });
    expect(record).toEqual({ value: 0.2, field: 'goal_threshold', frame: 'level', baseline: 0.16, status_quo_option_id: 'hold' });
    expect(sentRun.graph.nodes[0]).toMatchObject({ goal_threshold_raw: 100, goal_threshold_frame: 'level',
      goal_threshold_unit: 'tickets per week', goal_direction: '>=', observed_state: { raw_value: 80 } });
    expect(sentGoalThresholdOf({ option_comparison: [{ probability_of_goal: 0.9, outcome: { p10: 0, p90: 1 } }] },
      saved(), 'capacity', undefined, { sentRun })).toEqual(record);
    expect(sentGoalThresholdOf({ option_comparison: [{ probability_of_goal: 0.9, outcome: { p10: 0, p90: 1 } }] },
      saved(), 'capacity')).toBeUndefined();
  });

  it('a conflicting root target cannot borrow the node’s frame attestation', () => {
    const sentRun = { ...request(), goal_threshold: 0.3 };
    expect(sentGoalThresholdOf({}, saved(), 'capacity', undefined, { sentRun })).toBeUndefined();
  });

  it('another request cannot supply the inputs missing from this Run’s snapshot', () => {
    const other = request(); other.graph.nodes[0]!.goal_threshold_raw = 150;
    const selected = evidence();
    const q = deriveRunQuestion({ runEvidence: selected, historicalModel: { revision: 12, graph: saved() }, dispatchedRequest: other });
    // The matching saved question still asks100; an unbound request cannot turn its raw snapshot into a calculation.
    expect(q.asked?.target).toBe(100);
    expect(selected.inputSnapshot.goal.target_raw).toBe(100);
    expect(q.calculated?.target).toBeUndefined();
    expect(q.calculated?.encoded_target).toBeUndefined();
    expect(q.scope.status).toBe('unverified');
  });
});
