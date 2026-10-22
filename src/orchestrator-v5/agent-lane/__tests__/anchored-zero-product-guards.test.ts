import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { composeIdentityAskForNode } from '../../coaching/identity-not-evaluated-ask.js';

const brief = 'Additional capacity is 0 cases per week today: specialists times cases per specialist per week. '
  + 'We have 0 specialists today. Each specialist handles 12 cases per week. '
  + 'Hire 2 specialists or stay as we are. Reach at least 10 cases per week.';

function candidate(): CandidateModel {
  return {
    goal: { metric: 'Additional capacity', operator: '>=', target_stated: true, frame: 'level', value: 10,
      unit: 'cases per week', horizon_months: null, provenance: 'explicit', baseline_known: true,
      baseline_value: 0, baseline_provenance: 'explicit', scope: null },
    constraints: [], risks: [], outcomes: [], unknowns: [], decision_question: null,
    options: [
      { label: 'Stay as we are', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Hire 2 specialists', provenance: 'explicit', is_status_quo: false, changes: [],
        interventions: [{ factor_label: 'Specialists', value: 2, value_kind: 'absolute', unit: 'specialists', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Specialists', role: 'controllable', baseline_known: true, baseline_value: 0,
        unit: 'specialists', provenance: 'explicit', plausible_max: 10 },
      { label: 'Capacity each', role: 'observable', baseline_known: true, baseline_value: 12,
        unit: 'cases per specialist per week', provenance: 'explicit', plausible_max: 30 },
    ],
    links: ['Specialists', 'Capacity each'].map((from) => ({ from, to: 'Additional capacity',
      direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null })),
    identities: [{ outcome: 'Additional capacity', operation: 'product', factors: ['Specialists', 'Capacity each'], provenance: 'inferred' }],
  } as CandidateModel;
}


/** Claude #3677 r1: guard rows that its original seven-case spec did not kill as mutants. */
function withExtraCause(c: CandidateModel): CandidateModel {
  return {
    ...c,
    factors: [...c.factors, { label: 'Other capacity', role: 'observable', baseline_known: true,
      baseline_value: 5, unit: 'cases per week', provenance: 'explicit', plausible_max: 10 }],
    links: [...c.links, { from: 'Other capacity', to: 'Additional capacity', direction: 'positive',
      provenance: 'explicit', effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'explicit' }],
  } as CandidateModel;
}
const extraBrief = brief + ' Other capacity is 5 cases per week; each case adds 1 case per week to Additional capacity.';

describe('the stated-zero exception retains its three refusal guards', () => {
  it('an accumulation operand at zero still asks, rather than treating it as a pure unit product', () => {
    const frame = (value: number) => ({ value: value / 100, raw_value: value, cap: 100, source: 'brief_extraction' });
    const g = {
      nodes: [
        { id: 'stock', kind: 'factor', observed_state: frame(0) },
        { id: 'churn', kind: 'factor', observed_state: frame(0) },
        { id: 'inflow', kind: 'factor', observed_state: frame(0) },
        { id: 'specialists', kind: 'outcome', label: 'Specialists', observed_state: frame(0),
          nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock', 'churn', 'inflow'],
            horizon_months: 1, rate_scale: 1 } },
        { id: 'each', kind: 'factor', label: 'Capacity each', observed_state: frame(12) },
        { id: 'total', kind: 'outcome', label: 'Additional capacity', observed_state: frame(0),
          nonlinear_identity: { operation: 'product', factor_ids: ['specialists', 'each'] } },
      ],
      edges: [
        ...['stock', 'churn', 'inflow'].map((from) => ({ from, to: 'specialists' })),
        ...['specialists', 'each'].map((from) => ({ from, to: 'total' })),
      ],
    };
    expect(composeIdentityAskForNode('total', g)?.reason).toBe('identity_zero_level');
  });

  it('Olumi’s product over a stated zero and an extra cause is refused', () => {
    const admitted = admitCandidateModel(withExtraCause(candidate()), {}, extraBrief, () => true);
    const total = admitted.nodes.find((n) => n.label === 'Additional capacity')!;
    const extra = admitted.nodes.find((n) => n.label === 'Other capacity')!;
    // Non-vacuity: the extra cause must reach the product for this to exercise the guard.
    expect(admitted.edges.some((e) => e.from === extra.id && e.to === total.id)).toBe(true);
    expect(total.nonlinear_identity).toBeUndefined();
    expect(admitted.nodes.find((n) => n.label === 'Specialists')!.observed_state?.value).toBe(0);
  });

  it('the user’s product with an extra cause never gives its created part an Olumi zero', () => {
    const c = withExtraCause(candidate());
    const edited = {
      ...c,
      factors: c.factors.map((f) => f.label === 'Specialists' ? { ...f, baseline_known: false, baseline_value: null } : f),
      options: c.options.map((o, i) => i === 1 ? { ...o, label: 'Start a specialist team' } : o),
      identities: c.identities!.map((d) => ({ ...d, provenance: 'explicit' })),
    } as CandidateModel;
    const admitted = admitCandidateModel(edited, {}, extraBrief, () => true);
    const total = admitted.nodes.find((n) => n.label === 'Additional capacity')!;
    const extra = admitted.nodes.find((n) => n.label === 'Other capacity')!;
    expect(total.nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: true });
    expect(admitted.edges.some((e) => e.from === extra.id && e.to === total.id)).toBe(true);
    expect(admitted.nodes.find((n) => n.label === 'Specialists')!.observed_state?.value).not.toBe(0);
  });
});
