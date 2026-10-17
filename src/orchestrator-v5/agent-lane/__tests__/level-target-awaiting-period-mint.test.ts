/**
 * ⭐ G1 THRESHOLD MINT (DL-3 00:26Z rule: every ACTIVE target mints goal_threshold = raw/cap, or admission says why; design ACK
 * 01:03Z; PL + BUDDY-A 01:06Z). Paul's served goal (scenario 2af0a73b) kept raw 800 and a level on cap 1000, but no threshold,
 * cap or reading: admission refused the whole level reading because its period was not stated while conditions stood beside
 * the target, and the reason reached only the build's tool result. The DL's 14 Oct ruling (already on the change path) now
 * holds on the level path too, only there: the reading is kept awaiting its period, conditions whole, the threshold is
 * minted and the period is asked; no chance is licensed until the user's deadline completes it.
 * SYNTHETIC brief (an analogue of the served one, never the brief itself).
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { figureTheUserWrote } from '../stated-by-user.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';
import { goalTargetBasisOf } from '../../goal-target/goal-target-basis.js';
import { applyGoalHorizonEdit } from '../../goal-target/goal-horizon-write.js';

type Rec = Record<string, any>;
const BRIEF = 'Should we open a Nordic office within the next 6 to 12 months? We have 300 clients today. We want 600 clients. '
  + 'If monthly churn passes 10%, we lose money. The budget is at most £400,000.';
const CONDITIONS = ['Monthly churn stays at or below 10%', 'Spend stays within £400,000'];
const PERIOD_ASK = 'Olumi needs when the target must be met (the number of months), and will not guess it.';
const WHOLE_REFUSAL = 'No chance is shown without the 2 conditions you set beside it.';
const subj = { kind: 'goal', label: 'Client base', to_label: null, factor_label: null };
function draft(o: { horizon?: number | null; period?: number | null; conditions?: unknown[] | null } = {}): Rec {
  const { horizon = null, period = null, conditions = CONDITIONS } = o;
  return {
    goal: { kind: null, deliverable: null, metric: 'Client base', operator: '>=', target_stated: true, value: 600, unit: 'clients',
      horizon_months: horizon, provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 300, baseline_provenance: 'explicit',
      scope: null, quantity_frame: 'level', source_quote: 'We want 600 clients.', deadline_words: null,
      basis: { reference: 'today', denominator: null, period_months: period, period_kind: 'at_end', effect_unit: 'clients',
        effects_at_period_end: true, also_required: conditions, open_question: null } },
    constraints: [],
    options: [
      { label: 'Open a Nordic office', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Nordic offices opened', value: 1, value_kind: 'absolute', unit: 'offices', provenance: 'ai_proposed' }] },
      { label: 'Stay in the current market', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: true,
        interventions: [{ factor_label: 'Nordic offices opened', value: 0, value_kind: 'absolute', unit: 'offices', provenance: 'ai_proposed' }] },
    ],
    factors: [{ label: 'Nordic offices opened', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'offices', provenance: 'ai_proposed', plausible_max: 5 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [{ from: 'Nordic offices opened', to: 'Client base', direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
      effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }],
    statements: [
      { quote: 'We have 300 clients today.', subject: subj, field: 'level', form: 'point', value: 300, low: null, high: null, unit: 'clients', qualifier: 'today', conditions: null },
      { quote: 'We want 600 clients.', subject: subj, field: 'target', form: 'lower_bound', value: 600, low: null, high: null, unit: 'clients', qualifier: null, conditions: null },
    ],
  };
}
const admitted = (model: Rec) => admitCandidateModel(model as CandidateModel, {}, BRIEF, (v, u) => figureTheUserWrote(v, u, BRIEF));
const goalOf = (nodes: readonly Rec[]): Rec => nodes.find((n) => n.kind === 'goal')!;
const reasons = (out: { loss: readonly Rec[] }): string => JSON.stringify(out.loss.map((l) => l.reason));
let lastResult: Rec = {};
async function savedCold(model: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const r = await buildModelFromBrief('7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e', BRIEF, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: JSON.stringify(model), status: 'completed' })) as never) as Rec;
  expect(r.ok, JSON.stringify(r).slice(0, 1200)).toBe(true);
  lastResult = r;
  return GraphV3.parse(JSON.parse(JSON.stringify(graph))) as Rec;
}

// A licensable LEVEL goal (the Batch C capacity shape), with the reading under test on it.
const AWAITING = { quantity_frame: 'level', target_frame: 'level', target_raw: 85, reference: 'today', period_kind: 'at_end',
  effect_unit: '%', effects_at_period_end: true, also_required: CONDITIONS, source: 'olumi_reading' };
const levelGraph = (goal: Rec = {}): Rec => ({
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
      provenance: { source: 'user_specified', magnitude: 'user_stated' } },
  ],
  goal_constraints: [],
});
const wilson = (p: number, met: number): Rec => ({ basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95,
  n_informative: 10000, n_met: met, interval_lower: Math.max(0, p - 0.01), interval_upper: Math.min(1, p + 0.01) });
const run = (): Rec => ({ option_comparison: [
  { option_id: 'lead', probability_of_goal: 0.46, probability_of_goal_precision: wilson(0.46, 4600), outcome: { mean: 84, std: 3, p10: 80, p50: 84, p90: 88 } },
  { option_id: 'two', probability_of_goal: 0.31, probability_of_goal_precision: wilson(0.31, 3100), outcome: { mean: 83, std: 3, p10: 79, p50: 83, p90: 87 } },
  { option_id: 'carry_on', probability_of_goal: 0, probability_of_goal_precision: wilson(0, 0), outcome: { mean: 75, std: 0, p10: 75, p50: 75, p90: 75 } },
] });
const licence = (g: Rec) => goalChanceLicenceOf(run(), g, 'capacity', () => false, undefined, g, {});

describe('a level target whose period is not yet stated, with conditions beside it (G1 threshold mint)', () => {
  it('⭐ real build → register → cold read: the threshold is minted, the reading kept awaiting its period with its conditions, and the period asked', async () => {
    const goal = goalOf((await savedCold(draft())).nodes);
    expect(goal).toMatchObject({ goal_threshold_raw: 600, goal_threshold_cap: 750, goal_threshold: 0.8 });
    expect(goal.goal_target_basis).toMatchObject({ target_raw: 600, also_required: CONDITIONS, source: 'olumi_reading' });
    expect(goal.goal_target_basis).not.toHaveProperty('period_months');
    const said = JSON.stringify(lastResult.not_represented ?? []);
    expect(said).toContain(PERIOD_ASK);
    expect(said).not.toContain(WHOLE_REFUSAL);
  }, 60_000);

  it('the existing deadline write completes it: the saved reading then validates with that period and every condition', async () => {
    const saved = await savedCold(draft());
    const id = goalOf(saved.nodes).id as string;
    expect(goalTargetBasisOf(goalOf(saved.nodes))).toBeUndefined();
    const done = applyGoalHorizonEdit(saved, { goal_id: id, deadline: '2027-10-17', expected_deadline: null, reference_date: '2026-10-17', stated_months: 12 });
    expect(done.kind).toBe('mutated');
    const held = goalTargetBasisOf(goalOf((done as { mutatedGraph: Rec }).mutatedGraph.nodes));
    expect(held).toMatchObject({ period_months: 12, also_required: CONDITIONS, target_raw: 600 });
  }, 60_000);

  it('⛔ the licence: no chance on a reading awaiting its period; once the deadline is held, the chance says every condition', () => {
    expect(licence(levelGraph({ goal_target_basis: AWAITING }))).toBeNull();
    const held = licence(levelGraph({ goal_target_basis: AWAITING, goal_horizon_months: 6 }));
    expect(held).not.toBeNull();
    for (const c of CONDITIONS) expect(JSON.stringify(held)).toContain(c);
  });

  it('CONTRAST (licence, unchanged): no stored reading licenses as today; a stale reading for a different target is not read as awaiting', () => {
    expect(licence(levelGraph())).not.toBeNull();
    expect(licence(levelGraph({ goal_target_basis: { ...AWAITING, target_raw: 70 } }))).not.toBeNull();
  });

  it.each([
    ['a horizon is stated beside the missing period', { horizon: 12 }],
    ['the period and the horizon disagree', { horizon: 6, period: 12 }],
    ['a condition cannot be kept whole', { conditions: ['Monthly churn stays\nat or below 10%', CONDITIONS[1]] }],
  ])('CONTRAST (admission, unchanged): %s → still no threshold and no reading, and why is said', (_why, o) => {
    const out = admitted(draft(o));
    const goal = goalOf(out.nodes as Rec[]);
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_target_basis).toBeUndefined();
    expect(reasons(out)).toContain('No chance of meeting the target for \\"Client base\\" is shown yet');
  });

  it('CONTRAST (admission, unchanged): a missing period with NO conditions mints as today and keeps no reading', () => {
    const goal = goalOf(admitted(draft({ conditions: null })).nodes as Rec[]);
    expect(goal).toMatchObject({ goal_threshold_cap: 750, goal_threshold: 0.8 });
    expect(goal.goal_target_basis).toBeUndefined();
  });
});
