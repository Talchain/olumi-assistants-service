/**
 * Recovery Batch C — a goal stated as a CHANGE is admitted when its semantics are explicit and valid (Batch 0 change-goal
 * decision rulings 2–5, 9–11; amendments 2–3 and 7). Hand-written natural-unit expectations, never engine output.
 *
 * Paul's hiring brief: "increase productivity by at least 10% … urgent launch date in the next three months". Served on
 * 11 Oct (CEE 50530b5f) it was drafted `change_rel` 0.1 with no level today and withheld everywhere with "needs today's
 * level of productivity". Ruling 2: a percentage-change QUANTITY uses `quantity_frame: 'change'` and `change_abs` in its
 * own units, so +10 is 10 on that quantity's scale and needs no level today; its denominator (today's productivity), the
 * three-month period and the unit of every effect must be stated (ruling 4), else it is still refused (ruling 9).
 */
import { describe, expect, it } from 'vitest';

import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { goalTargetBasisOf } from '../../goal-target/goal-target-basis.js';

type Rec = Record<string, unknown>;

const BASIS = {
  reference: 'today' as const,
  denominator: 'today’s productivity (monthly development capacity)',
  period_months: 3,
  period_kind: 'at_end' as const,
  effect_unit: '% of today’s productivity per added person, at month three',
  effects_at_period_end: true,
  also_required: ['code quality maintained', 'spend within £200,000'],
  open_question: null,
};

const hiring = (goal: Partial<CandidateModel['goal']> = {}): CandidateModel => ({
  goal: {
    metric: 'Productivity', operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3,
    provenance: 'explicit', frame: 'change_abs', quantity_frame: 'change', baseline_known: false, baseline_value: null,
    baseline_provenance: 'explicit', scope: null, basis: BASIS, ...goal,
  } as CandidateModel['goal'],
  constraints: [{ metric: 'First-year hiring cost', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit', frame: 'level' }],
  options: [
    { label: 'Hire a tech lead', provenance: 'explicit',
      interventions: [{ factor_label: 'Additional tech leads hired', value: 1, unit: 'people', provenance: 'explicit' },
        { factor_label: 'First-year hiring cost', value: 110000, unit: 'GBP', provenance: 'ai_proposed' }] },
    { label: 'Hire two developers', provenance: 'explicit',
      interventions: [{ factor_label: 'Additional developers hired', value: 2, unit: 'people', provenance: 'explicit' },
        { factor_label: 'First-year hiring cost', value: 140000, unit: 'GBP', provenance: 'ai_proposed' }] },
    { label: 'Carry on with the current team', provenance: 'ai_proposed', is_status_quo: true },
  ],
  factors: [
    { label: 'Additional tech leads hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 5 },
    { label: 'Additional developers hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 10 },
    { label: 'First-year hiring cost', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP', provenance: 'explicit', plausible_max: 300000 },
  ],
  risks: [],
  outcomes: [],
  links: [
    { from: 'Additional tech leads hired', to: 'Productivity', direction: 'positive', provenance: 'ai_proposed',
      effect_amount: 9, effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null,
      basis: 'A tech lead adds review and planning capacity once ramped up.' },
    { from: 'Additional developers hired', to: 'Productivity', direction: 'positive', provenance: 'ai_proposed',
      effect_amount: 4, effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null,
      basis: 'Each developer adds capacity after recruitment and ramp-up.' },
    { from: 'First-year hiring cost', to: 'Productivity', direction: 'unknown', provenance: 'ai_proposed',
      effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null },
  ],
  identities: [],
  unknowns: [],
  decision_question: null,
} as unknown as CandidateModel);

const goalOf = (m: { nodes: readonly unknown[] }): Rec => m.nodes.find((n) => (n as Rec).kind === 'goal') as Rec;
const goalLoss = (m: { loss?: readonly unknown[] }): Rec[] => ((m.loss ?? []) as Rec[])
  .filter((l) => typeof l.field_path === 'string' && (l.field_path as string).startsWith('nodes[productivity]'));

describe('hiring — a change QUANTITY with change_abs +10 needs no level today (rulings 2–5)', () => {
  it('RED: the goal is admitted as a change of +10 on a 0–100 scale, with its basis held; nothing withheld for a missing level', () => {
    const m = admitCandidateModel(hiring());
    const g = goalOf(m);
    expect(g).toMatchObject({
      quantity_frame: 'change', goal_threshold_frame: 'change_abs', goal_threshold_raw: 10, goal_threshold_unit: '%',
      goal_threshold_cap: 100, goal_threshold: 0.1,
    });
    // No level today is written or guessed: a change quantity is 0 today by definition (ISL pairs it with the status quo).
    expect(g.observed_state).toBeUndefined();
    expect(goalTargetBasisOf(g)).toMatchObject({
      quantity_frame: 'change', target_frame: 'change_abs', target_raw: 10, reference: 'today', period_months: 3,
      period_kind: 'at_end', effects_at_period_end: true, denominator: BASIS.denominator, effect_unit: BASIS.effect_unit,
      also_required: ['code quality maintained', 'spend within £200,000'], source: 'olumi_reading',
    });
    // Served before C: "needs today's level of productivity" (a withheld base on the goal). Nothing is withheld now.
    expect(goalLoss(m).filter((l) => l.field_path === 'nodes[productivity].observed_state.baseline')).toEqual([]);
  });

  it('RED: each per-person effect is sized on the goal\'s own 0–100 frame: 2 developers × 4 = +8, 1 tech lead × 9 = +9', () => {
    const m = admitCandidateModel(hiring());
    const edge = (from: string): Rec => (m.edges as unknown as Rec[]).find((e) => e.from === from && e.to === 'productivity')!;
    const devs = (m.nodes as unknown as Rec[]).find((n) => n.id === 'additional_developers_hired')!;
    const leads = (m.nodes as unknown as Rec[]).find((n) => n.id === 'additional_tech_leads_hired')!;
    const devFrame = (devs.scale_frame ?? (devs.observed_state as Rec | undefined)?.cap) as number;
    const leadFrame = (leads.scale_frame ?? (leads.observed_state as Rec | undefined)?.cap) as number;
    // β = (amount / 100) / (per_change / F_source); the engine's paired change for an option setting x people is β·x/F·100.
    const devChange = ((edge('additional_developers_hired').strength as Rec).mean as number) * (2 / devFrame) * 100;
    const leadChange = ((edge('additional_tech_leads_hired').strength as Rec).mean as number) * (1 / leadFrame) * 100;
    expect(devChange).toBeCloseTo(8, 9);
    expect(leadChange).toBeCloseTo(9, 9);
  });

  it('NEGATIVE (ruling 9): no denominator → still refused, said, and no threshold is written (no chance)', () => {
    const m = admitCandidateModel(hiring({ basis: { ...BASIS, denominator: null } } as never));
    const g = goalOf(m);
    expect(g.goal_threshold).toBeUndefined();
    expect(g.goal_target_basis).toBeUndefined();
    expect(g).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 10, quantity_frame: 'change' });
    expect(goalLoss(m).map((l) => l.reason).join(' ')).toMatch(/what the percentage is a percentage of/);
  });

  it('NEGATIVE: no basis at all (an older candidate) → refused, never assumed', () => {
    const g = goalOf(admitCandidateModel(hiring({ basis: null } as never)));
    expect(g.goal_threshold).toBeUndefined();
    expect(g.goal_target_basis).toBeUndefined();
  });

  it('NEGATIVE: a period that disagrees with the stated deadline → refused', () => {
    const m = admitCandidateModel(hiring({ basis: { ...BASIS, period_months: 6 } } as never));
    expect(goalOf(m).goal_threshold).toBeUndefined();
    expect(goalLoss(m).map((l) => l.reason).join(' ')).toMatch(/the target's period and its deadline disagree/);
  });

  it('NEGATIVE (contract): a RELATIVE change of a change quantity is refused (a % of a % change)', () => {
    const g = goalOf(admitCandidateModel(hiring({ frame: 'change_rel' } as never)));
    expect(g.goal_threshold).toBeUndefined();
  });

  it('amendment 3: an open question is held on the basis (the target is admitted; the licence withholds with it)', () => {
    const q = 'Should “at least 10%” mean 10% more development capacity than today (75% → 82.5%), or 10 more percentage points of time on development (75% → 85%)?';
    const g = goalOf(admitCandidateModel(hiring({ basis: { ...BASIS, open_question: q } } as never)));
    expect(goalTargetBasisOf(g)?.open_question).toBe(q);
  });
});

// ── Re-scope (DL after independent check r2, BLOCKING 2): a refused reading never drops the conditions it retained ─────────
describe('a refused reading that retained conditions refuses the WHOLE goal reading, with why (never a target without them)', () => {
  const level = (basis: Rec): CandidateModel => hiring({ frame: 'level', quantity_frame: 'level', value: 120, unit: 'points',
    baseline_known: true, baseline_value: 80, baseline_provenance: 'explicit', basis } as never);
  const levelChange = (basis: Rec): CandidateModel => hiring({ frame: 'change_abs', quantity_frame: 'level', value: 40, unit: 'points',
    baseline_known: true, baseline_value: 80, baseline_provenance: 'explicit', basis } as never);
  const reasons = (m: { loss?: readonly unknown[] }): string => goalLoss(m).map((l) => l.reason).join(' ');

  it.each([
    ['a LEVEL target', level],
    ['a change of a LEVEL quantity', levelChange],
  ])('RED on 2ecbae5 (r2 BLOCKING 2): %s whose reading is refused while it retained 2 conditions → no threshold, and why', (_name, build) => {
    const m = admitCandidateModel(build({ ...BASIS, effect_unit: null }), {}, undefined, () => true);
    const g = goalOf(m);
    expect(g.goal_threshold).toBeUndefined();
    expect(g.goal_target_basis).toBeUndefined();
    expect(reasons(m)).toContain('Olumi needs the unit each option\'s effect on it is stated in, and will not guess it. '
      + 'No chance is shown without the 2 conditions you set beside it.');
  });

  it.each([
    ['a LEVEL target', level],
    ['a change of a LEVEL quantity', levelChange],
  ])('CONTROL: %s whose refused reading retained NO condition is admitted exactly as before (threshold written)', (_name, build) => {
    const m = admitCandidateModel(build({ ...BASIS, effect_unit: null, also_required: null }), {}, undefined, () => true);
    expect(typeof goalOf(m).goal_threshold).toBe('number');
    expect(reasons(m)).not.toContain('conditions you set beside it');
  });

  it('CONTROL: a valid LEVEL reading keeps its threshold and every condition', () => {
    const g = goalOf(admitCandidateModel(level({ ...BASIS, denominator: null }), {}, undefined, () => true));
    expect(typeof g.goal_threshold).toBe('number');
    expect(goalTargetBasisOf(g)?.also_required).toEqual(['code quality maintained', 'spend within £200,000']);
  });
});

describe('a relative change on Olumi\'s starting value is estimate_only (ruling 9, amendments 7 and 10)', () => {
  const mrr = (goal: Partial<CandidateModel['goal']>): CandidateModel => {
    const base = hiring();
    return { ...base, goal: { ...base.goal, metric: 'MRR', unit: 'GBP/month', frame: 'change_rel', quantity_frame: 'level',
      value: 10, horizon_months: 3, baseline_known: false, baseline_value: 20000, baseline_provenance: 'ai_proposed',
      basis: { ...BASIS, denominator: 'today’s MRR', effect_unit: 'GBP/month per added person, at month three', also_required: null },
      ...goal } as CandidateModel['goal'],
      links: base.links.map((l) => ({ ...l, to: 'MRR', effect_amount: typeof l.effect_amount === 'number' ? l.effect_amount * 100 : null })) } as CandidateModel;
  };
  const mrrGoal = (m: { nodes: readonly unknown[] }): Rec => goalOf(m);

  it('RED: Olumi\'s £20,000 / month is written as OLUMI\'s base (cee_inference), r = 0.10 is the threshold, and the basis is held', () => {
    const g = mrrGoal(admitCandidateModel(mrr({})));
    expect(g).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold: 0.1 });
    expect(g.observed_state).toMatchObject({ source: 'cee_inference', raw_value: 20000 });
    expect((g.observed_state as Rec).source).not.toBe('brief_extraction');
    expect(goalTargetBasisOf(g)).toMatchObject({ target_frame: 'change_rel', denominator: 'today’s MRR' });
  });

  it('NEGATIVE: no starting value at all → still refused (a base is never guessed)', () => {
    const g = mrrGoal(admitCandidateModel(mrr({ baseline_value: null })));
    expect(g.goal_threshold).toBeUndefined();
    expect(g.observed_state).toBeUndefined();
  });

  it('NEGATIVE: Olumi\'s starting value with no stated denominator → still refused', () => {
    const g = mrrGoal(admitCandidateModel(mrr({ basis: { ...BASIS, denominator: null } } as never)));
    expect(g.goal_threshold).toBeUndefined();
    expect(g.observed_state).toBeUndefined();
  });

  it('CONTROL (unchanged path): the user\'s own stated level is admitted as before (brief_extraction), with the basis held beside it', () => {
    const m = admitCandidateModel(mrr({ baseline_known: true, baseline_provenance: 'explicit' }), {}, undefined, () => true);
    const g = mrrGoal(m);
    expect(g.observed_state).toMatchObject({ source: 'brief_extraction', raw_value: 20000 });
    expect(goalTargetBasisOf(g)).toMatchObject({ target_frame: 'change_rel' });
  });
});
