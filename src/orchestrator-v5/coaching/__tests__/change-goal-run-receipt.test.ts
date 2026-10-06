import { describe, expect, it } from 'vitest';
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import { buildRunInputSnapshot } from '../../tools/handlers/run-input-snapshot.js';
import { buildRunDelta } from '../build-run-delta.js';
import { rerunExplanationPlan } from '../../agent-lane/rerun-explanation.js';
import { diffRunInputs } from '../run-input-changes.js';

// Goal-node fields from the founder adoption in change-goal-adopts-level-unit.test.ts @692fb96e,
// as reported by ACCEPTANCE-EVIDENCE / CODEX-BRIEF. Other Run envelopes below are synthetic controls.
const UNIT = 'small-update equivalents per sprint';
const BEFORE = {
  id: 'productivity', kind: 'goal', label: 'productivity', goal_direction: '>=',
  goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold: 0.1, goal_threshold_unit: '%',
};
const AFTER = {
  ...BEFORE, goal_threshold_unit: UNIT, goal_threshold_cap: 22,
  observed_state: { value: 16 / 22, baseline: 16 / 22, raw_value: 16, cap: 22, unit: UNIT, source: 'user_override' },
};

type RecordedRun = Extract<HandlerFact, { fact_type: 'run_analysis' }>;
function run(node: Record<string, unknown>, index: number): RecordedRun {
  const graph = { nodes: [node], edges: [] };
  const snapshot = buildRunInputSnapshot({
    wireGraph: graph, plotPayload: { graph, goal_node_id: 'productivity' },
    submittedOptions: [], rawObjectsPerOption: [], wirePerOption: [],
    heldFactorIdsByOptionId: new Map(), optionsNotSent: [],
  });
  expect(snapshot, 'the actual producer must record contract-valid inputs').not.toBeNull();
  return { fact_type: 'run_analysis', noop: false, result: {
    run_id: `run-${index}`, computed_at: `2026-10-06T17:0${index}:00.000Z`, graph_hash_at_run: `graph-${index}`,
    input_snapshot: snapshot,
    enrichment: { analysis_status: 'completed', results: [
      { option_id: 'opt-a', option_label: 'Tech lead', win_probability: 0.5 },
      { option_id: 'opt-b', option_label: 'Carry on', win_probability: 0.5 },
    ], meta: { seed_used: '42', n_samples: 10000 },
      _meta: { builds: { plot: 'plot', isl: 'isl' }, evidence: { isl_draw_structure_key: 'a'.repeat(64) } } },
    constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'unknown' },
  } } as unknown as RecordedRun;
}

function receipt(before: Record<string, unknown>, after: Record<string, unknown>) {
  const built = buildRunDelta({ priorFacts: [run(after, 2), run(before, 1)], mayNameLeadingOption: false });
  expect(built.kind).toBe('ok');
  if (built.kind !== 'ok') throw new Error(`Run delta refused: ${built.reason}`);
  expect(RunDeltaSchema.safeParse(built.delta).success).toBe(true);
  const plan = rerunExplanationPlan(built.delta, (id) => id === 'productivity' ? 'productivity' : undefined, [], false)!;
  return { delta: built.delta, plan };
}

describe('founder Run receipt: target, current level and metric unit keep separate meanings', () => {
  it('finding 1 coverage control: an absent goal level is explicitly recorded without inventing a value', () => {
    const snapshot = run(BEFORE, 1).result!.input_snapshot!;
    expect(snapshot.factors).toMatchObject([{ factor_id: 'productivity' }]);
    expect(snapshot.factors[0]).not.toHaveProperty('raw');
    expect(snapshot.factors[0]).not.toHaveProperty('encoded');
    expect(diffRunInputs(snapshot, snapshot)).toEqual({ rows: [], complete: true });
  });

  it('finding 1 RED: an older snapshot omitting an existing 100 GBP goal level never invents a recording', () => {
    const node = { ...BEFORE, goal_threshold_unit: 'GBP', observed_state: { raw_value: 100, value: 100, unit: 'GBP' } };
    const current = run(node, 2);
    const prior = run(node, 1);
    const currentSnapshot: RunInputSnapshot = current.result!.input_snapshot!;
    prior.result!.input_snapshot = { ...currentSnapshot, factors: [] };
    // Identical dispatched graph and equal residuals: coverage alone must prevent a false addition.
    expect(prior.result!.input_snapshot.sent_digest).toBe(currentSnapshot.sent_digest);
    expect(prior.result!.input_snapshot.residual_digest).toBe(currentSnapshot.residual_digest);
    for (const [a, b] of [[prior, current], [current, prior], [prior, prior]]) {
      const diff = diffRunInputs(a!.result!.input_snapshot!, b!.result!.input_snapshot!);
      expect(diff).toEqual({ rows: [], complete: false });
    }
    const built = buildRunDelta({ priorFacts: [current, prior], mayNameLeadingOption: false });
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') throw new Error(built.reason);
    expect(built.delta.input_coverage).toBe('partial');
    expect(built.delta.input_changes).toEqual([]);
    expect(rerunExplanationPlan(built.delta, () => 'productivity', [], false)!.codeLine).not.toContain('was recorded');
  });

  it('RED at base: adoption of level + unit leaves the +10% target unchanged', () => {
    const { delta, plan } = receipt(BEFORE, AFTER);
    expect(delta.input_changes?.filter((r) => r.entity_kind === 'goal' && r.field === 'target')).toEqual([]);
    expect(plan.changes).toEqual([`Today's level of ‘productivity’ was recorded: 16 ${UNIT}.`]);
    expect(plan.codeLine).not.toMatch(/0\.1|Goal target|You changed productivity/);
  });

  it('RED at base / real target-change control: relative target is a percentage from today, never the metric unit', () => {
    const { delta, plan } = receipt(AFTER, { ...AFTER, goal_threshold_raw: 0.2, goal_threshold: 0.2 });
    const targets = delta.input_changes?.filter((r) => r.field === 'target');
    expect(targets).toMatchObject([{ before: { raw: '+10% from today' }, after: { raw: '+20% from today' } }]);
    expect(targets?.every((r) => r.before?.unit === undefined && r.after?.unit === undefined)).toBe(true);
    expect(plan.changes).toEqual(['You changed the target for ‘productivity’: +10% from today → +20% from today.']);
    expect(plan.codeLine).not.toContain(UNIT);
  });

  it('RED at base / change_abs level control: a level change is still recorded, target unchanged', () => {
    const before = { ...AFTER, goal_threshold_frame: 'change_abs', goal_threshold_raw: 2, goal_threshold: 2 / 22 };
    const after = { ...before, observed_state: { ...AFTER.observed_state, raw_value: 18, value: 18 / 22, baseline: 18 / 22 } };
    const { delta, plan } = receipt(before, after);
    expect(delta.input_changes?.some((r) => r.field === 'target')).toBe(false);
    expect(plan.changes).toEqual([`Today's level of ‘productivity’ was recorded: 18 ${UNIT}.`]);
  });

  it('unit-only adoption is a measurement receipt, never a target change', () => {
    const { delta, plan } = receipt(BEFORE, { ...BEFORE, goal_threshold_unit: UNIT });
    expect(delta.input_changes?.map((r) => r.field)).toEqual(['unit']);
    expect(plan.changes).toEqual([`‘productivity’ is now measured in ${UNIT}.`]);
  });

  it('unchanged current level and target produce no change rows', () => {
    const { delta } = receipt(AFTER, AFTER);
    expect(delta.input_changes).toEqual([]);
  });

  it('a real level-frame target change still reports the authored metric amounts', () => {
    const before = { ...AFTER, goal_threshold_frame: 'level', goal_threshold_raw: 18, goal_threshold: 18 / 22 };
    const { plan } = receipt(before, { ...before, goal_threshold_raw: 20, goal_threshold: 20 / 22 });
    expect(plan.changes).toEqual([`You changed the target for ‘productivity’: 18 ${UNIT} → 20 ${UNIT}.`]);
  });

  it('frame changes with the same raw threshold are distinct targets', () => {
    const { delta } = receipt(AFTER, { ...AFTER, goal_threshold_frame: 'change_abs' });
    expect(delta.input_changes?.some((r) => r.field === 'target')).toBe(true);
    expect(delta.input_coverage).toBe('partial');
  });

  it('an encoded threshold change alone stays unexpressed and partial, never claims the target or all inputs stayed the same', () => {
    const { delta, plan } = receipt(AFTER, { ...AFTER, goal_threshold: 0.2 });
    expect(delta.input_coverage).toBe('partial');
    expect(delta.input_changes).toEqual([]);
    expect(plan.codeLine).not.toMatch(/Nothing you entered changed|Nothing else changed|target/);
  });
});
