import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { keepOptionsAndQuantitiesApart } from '../keep-options-apart.js';

const LABEL = 'Key developer departure';
const BASIS = 'Typical annual key-staff turnover in small software teams.';
function draft(withOccurrence = true, withBasis = true): CandidateModel {
  return {
    goal: { metric: 'Revenue', operator: '>=', value: 20000, unit: 'GBP/month', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 10000, baseline_provenance: 'explicit' },
    constraints: [], options: [], factors: [], outcomes: [],
    risks: [{ label: LABEL, provenance: 'explicit', unit: 'event', plausible_max: 1,
      ...(withOccurrence ? { occurrence: { p_low_pct: 90, p_high_pct: 90, horizon_months: 12,
        basis_text: withBasis ? BASIS : '' } } : {}) }],
    links: [{ from: LABEL, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed',
      effect_amount: -1000, effect_per_source_change: 1, effect_provenance: 'ai_proposed' }],
  };
}
function admit(c: CandidateModel, brief = '') { return admitCandidateModel(c, {}, brief, () => true); }
function risk(result: ReturnType<typeof admit>, label = LABEL) {
  return result.nodes.find(n => n.kind === 'risk' && (n.description ?? n.label) === label)!;
}
function factor(c: CandidateModel, label = `${LABEL} probability`): CandidateModel {
  return { ...c, factors: [{ label, role: 'external', baseline_known: false, baseline_value: 10,
    unit: '%', provenance: 'ai_proposed', plausible_max: 100 }],
    links: [...c.links, { from: label, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed' }] };
}

describe('FIX2 Class A: every named event figure prevents Olumi authorship', () => {
  it('r1 #1 exact: lexical leave/departure binds a risk-only user 10% / six months over drafted 90% / twelve', () => {
    const result = admit(draft(), 'The key developer has a 10% chance he leaves within 6 months');
    expect(risk(result).event_risk).toMatchObject({ occurrence: { p_low: 0.1, p_high: 0.1, basis: 'user' }, horizon: { months: 6 } });
    expect(risk(result).event_risk_basis_text).toBeUndefined();
  });
  it('a signed explicit +10% uses the existing reader for a risk-only user likelihood', () => {
    const result = admit(draft(), 'The key developer has a +10% chance he leaves within 6 months');
    expect(risk(result).event_risk).toMatchObject({ occurrence: { p_low: 0.1, p_high: 0.1, basis: 'user' }, horizon: { months: 6 } });
    expect(risk(result).event_risk_basis_text).toBeUndefined();
  });
  it.each(['-10%', '−10%'])('a refused signed percentage %s never permits an Olumi occurrence', figure => {
    const result = admit(draft(), `${LABEL}: probably ${figure} within 6 months.`);
    expect(risk(result).event_risk).toBeUndefined();
    expect(result.loss.some(l => /You said/.test(l.reason))).toBe(true);
  });
  it('duplicate probability factors cannot call a hedged user figure Olumi-drafted', () => {
    const c = factor(draft());
    const result = admit({ ...c, factors: [...c.factors, { ...c.factors[0]!, label: `${LABEL} likelihood` }] },
      `${LABEL}: probably 10% within 6 months.`);
    expect(risk(result).event_risk).toBeUndefined();
    expect(result.nodes.some(n => n.kind === 'factor')).toBe(false);
    expect(result.loss.some(l => /You said/.test(l.reason))).toBe(true);
    expect(result.loss.some(l => /Olumi had drafted/.test(l.reason))).toBe(false);
  });
  it.each([[true, false], [false, false], [true, true], [false, true]])('r1 #2 exact: another event explicit figure never hides this hedge, drafted basis=%s, probability factor=%s', (withBasis, withFactor) => {
    const c = draft(true, withBasis);
    const withDraft = { ...c, risks: [{ ...c.risks[0]!, occurrence: { p_low_pct: 10, p_high_pct: 10, horizon_months: 12, basis_text: withBasis ? BASIS : '' } }] };
    const result = admit(withFactor ? factor(withDraft) : withDraft, 'Key developer departure: probably 10% within 6 months, Supplier outage has a 20% chance');
    expect(risk(result).event_risk).toBeUndefined();
    expect(risk(result).event_risk_basis_text).toBeUndefined();
    expect(result.loss.some(l => /You said.*probably 10% within 6 months/.test(l.reason))).toBe(true);
    expect(result.loss.some(l => /Olumi had drafted/.test(l.reason))).toBe(false);
  });
  it.each(['15%', '110%', '10.5%', '0.15', '.15'])('any refused user figure %s blocks a different drafted factor and occurrence', figure => {
    const result = admit(factor(draft()), `${LABEL}: probably ${figure} within 6 months.`);
    expect(risk(result).event_risk).toBeUndefined();
    expect(result.nodes.some(n => n.kind === 'factor')).toBe(false);
    expect(result.loss.some(l => /You said/.test(l.reason))).toBe(true);
    expect(result.loss.some(l => /Olumi had drafted/.test(l.reason))).toBe(false);
  });
  it('reads each event/figure separately when both risks are modelled', () => {
    const c = draft();
    const supplier = 'Supplier outage';
    const result = admit({ ...c, risks: [...c.risks, { ...c.risks[0]!, label: supplier }],
      links: [...c.links, { ...c.links[0]!, from: supplier }] },
      `${LABEL}: probably 10% within 6 months, Supplier outage has a 20% chance within 12 months`);
    expect(risk(result).event_risk).toBeUndefined();
    expect(risk(result, supplier).event_risk).toMatchObject({ occurrence: { p_low: 0.2, p_high: 0.2, basis: 'user' }, horizon: { months: 12 } });
  });
  it('reuses cancellation lexical equivalence for risk-only user likelihood', () => {
    const c = draft();
    const label = 'Largest client cancellation';
    const result = admit({ ...c, risks: [{ ...c.risks[0]!, label }], links: [{ ...c.links[0]!, from: label }] },
      'The largest client has a 10% chance it cancels within 6 months.');
    expect(risk(result, label).event_risk?.occurrence.basis).toBe('user');
  });
  it('ambiguous event name binding under-claims', () => {
    const c = draft();
    const result = admit({ ...c, risks: [...c.risks, { ...c.risks[0]!, label: 'Developer departure' }] },
      'Key developer departure has a 10% chance within 6 months.');
    expect(result.nodes.filter(n => n.kind === 'risk').every(n => n.event_risk === undefined)).toBe(true);
  });
  it('no figure about the event leaves Olumi admission intact', () => {
    const result = admit(draft(), 'The key developer may leave. Revenue can rise 20%.');
    expect(risk(result).event_risk?.occurrence.basis).toBe('olumi');
    expect(risk(result).event_risk_basis_text).toBe(BASIS);
  });
  it('a one-month event duration is not a unitless likelihood figure', () => {
    const result = admit(draft(), 'Key developer departure could happen within 1 month.');
    expect(risk(result).event_risk?.occurrence.basis).toBe('olumi');
  });
});

describe('FIX2 Class B: drafted likelihood word token anywhere is removed before separation', () => {
  it('r1 #3 exact: option/factor same probability label cannot become a continuous probability level', () => {
    const label = `${LABEL} probability`;
    const c = factor(draft(false), label);
    const apart = keepOptionsAndQuantitiesApart({ ...c, options: [{ label, provenance: 'explicit', changes: [label] }] });
    expect(apart.renamed.some(r => r.kind === 'factor' && r.from === label)).toBe(false);
    const result = admit(apart.model);
    expect(result.nodes.some(n => n.kind === 'factor' && /probability/i.test(n.description ?? n.label))).toBe(false);
    expect(result.edges.some(e => /probability/.test(e.from))).toBe(false);
    expect(result.loss.some(l => /probability/.test(l.reason) && /isn't used/.test(l.reason))).toBe(true);
  });
  it.each(['probability', 'likelihood', 'chance', 'odds'])('token %s in the middle survives no label gate', word => {
    const result = admit(factor(draft(false), `${LABEL} ${word} level`));
    expect(result.nodes.some(n => n.kind === 'factor')).toBe(false);
    expect(result.loss.some(l => /isn't used/.test(l.reason))).toBe(true);
  });
  it('ordinary factors without likelihood words remain untouched', () => {
    const label = 'Hiring effort';
    const result = admit(factor(draft(false), label));
    expect(result.nodes.some(n => n.kind === 'factor' && (n.description ?? n.label) === label)).toBe(true);
    expect(result.edges.some(e => e.from === 'hiring_effort' && e.to === 'revenue')).toBe(true);
  });
});
