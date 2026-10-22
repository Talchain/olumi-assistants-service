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

function graph() {
  return {
    nodes: [
      { id: 'specialists', kind: 'factor', label: 'Specialists', observed_state: { value: 0, raw_value: 0, cap: 10, source: 'brief_extraction' } },
      { id: 'each', kind: 'factor', label: 'Capacity each', observed_state: { value: .4, raw_value: 12, cap: 30, source: 'brief_extraction' } },
      { id: 'total', kind: 'outcome', label: 'Additional capacity', observed_state: { value: 0, raw_value: 0, cap: 100, source: 'brief_extraction' },
        nonlinear_identity: { operation: 'product', factor_ids: ['specialists', 'each'], addends: [] as string[] } },
    ],
    edges: ['specialists', 'each'].map((from) => ({ from, to: 'total' })),
  };
}

describe('a pure capacity product keeps its stated zero', () => {
  it('admission retains Olumi’s declared reading over an already stated zero part', () => {
    const c = candidate();
    const without = admitCandidateModel({ ...c, identities: [] }, {}, brief, () => true);
    const admitted = admitCandidateModel(c, {}, brief, () => true);
    const total = admitted.nodes.find((n) => n.label === 'Additional capacity')!;
    const specialists = admitted.nodes.find((n) => n.label === 'Specialists')!;
    expect(total.nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: false });
    expect(specialists.observed_state).toEqual(without.nodes.find((n) => n.label === 'Specialists')!.observed_state);
    expect(specialists.observed_state?.value).toBe(0);
    expect(total.observed_state?.value).toBe(0);
  });

  it('coaching does not ask the person to replace a consistent zero', () => {
    const g = graph();
    const before = structuredClone(g);
    expect(composeIdentityAskForNode('total', g)).toBeNull();
    expect(g).toEqual(before);
  });

  it('an evidenced newly created part may start at Olumi’s zero under a pure stated-zero total', () => {
    const c = candidate();
    const edited = {
      ...c,
      factors: c.factors.map((f, i) => i === 0 ? { ...f, baseline_known: false, baseline_value: null } : f),
      options: c.options.map((o, i) => i === 1 ? { ...o, label: 'Start a specialist team' } : o),
      identities: c.identities!.map((d) => ({ ...d, provenance: 'explicit' })),
    } as CandidateModel;
    const admitted = admitCandidateModel(edited, {}, brief, () => true);
    expect(admitted.nodes.find((n) => n.label === 'Specialists')!.observed_state)
      .toMatchObject({ value: 0, source: 'cee_inference' });
    expect(admitted.nodes.find((n) => n.label === 'Additional capacity')!.observed_state?.value).toBe(0);
  });

  it('a nonzero total beside a zero product still asks', () => {
    const g = graph();
    g.nodes[2]!.observed_state = { ...g.nodes[2]!.observed_state, value: .1, raw_value: 10 };
    expect(composeIdentityAskForNode('total', g)?.reason).toBe('identity_zero_level');
  });

  it('an unexplained extra cause beside zero still asks', () => {
    const g = graph();
    g.edges.push({ from: 'extra', to: 'total' });
    expect(composeIdentityAskForNode('total', g)?.reason).toBe('identity_zero_level');
  });

  it('a declared addend beside zero still asks', () => {
    const g = graph();
    g.nodes[2]!.nonlinear_identity!.addends = ['extra'];
    expect(composeIdentityAskForNode('total', g)?.reason).toBe('identity_zero_level');
  });

  it('an unstated part still asks for the missing input', () => {
    const g = graph();
    delete (g.nodes[0] as { observed_state?: unknown }).observed_state;
    expect(composeIdentityAskForNode('total', g)?.reason).toBe('identity_operand_missing');
  });
});
