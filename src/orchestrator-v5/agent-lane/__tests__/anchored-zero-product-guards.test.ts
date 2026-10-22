import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';

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


/** Claude #3677 r1: extra-cause guards. The accumulation guard is owned by core-route's readiness change (DL 22 Oct). */
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

describe('the stated-zero exception retains its extra-cause refusal guards', () => {
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
