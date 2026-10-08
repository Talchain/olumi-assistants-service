import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { holdStatedEventRisks } from '../stated-event-risk-draft.js';
import { goalChanceEstimateLikelihoods } from '../goal-chance-estimate-attribution.js';

const BASIS = 'Typical annual key-staff turnover in small software teams.';
const LABEL = 'Key developer departure';
function candidate(p = 10): CandidateModel {
  return {
    goal: { metric: 'Revenue', operator: '>=', value: 20000, unit: 'GBP/month', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 10000, baseline_provenance: 'explicit' },
    constraints: [], options: [], factors: [], outcomes: [],
    risks: [{ label: LABEL, provenance: 'explicit', unit: 'event', plausible_max: 1,
      occurrence: { p_low_pct: p, p_high_pct: p, horizon_months: 12, basis_text: BASIS } } as CandidateModel['risks'][number]],
    links: [{ from: LABEL, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed',
      effect_amount: -1000, effect_per_source_change: 1, effect_provenance: 'ai_proposed' }],
  };
}
function admit(c: CandidateModel, brief = '') {
  const result = admitCandidateModel(c, {}, brief, () => true);
  const graph = GraphV3.parse({ nodes: result.nodes, edges: result.edges });
  return { ...result, ...graph };
}
const risk = (result: ReturnType<typeof admit>) => result.nodes.find(n => n.kind === 'risk')!;
function probability(c: CandidateModel, label = `${LABEL} probability`, value = 10, unit = '%'): CandidateModel {
  return { ...c, risks: c.risks.map(({ occurrence: _occurrence, ...r }: any) => r),
    factors: [{ label, role: 'external', baseline_known: false, baseline_value: value, unit, provenance: 'ai_proposed', plausible_max: unit === '%' ? 100 : 1 }],
    links: [...c.links, { from: label, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed' }],
  };
}

describe('Science event branch admission, 8 October', () => {
  it.each([[10, 5, 18], [50, 33, 67], [90, 82, 95], [2, 1, 4]])('%s%% widens by odds ÷2…×2', (p, lo, hi) => {
    const node = risk(admit(candidate(p)));
    expect(node.event_risk?.occurrence.basis).toBe('olumi');
    expect(Math.round(node.event_risk!.occurrence.p_low * 100)).toBe(lo);
    expect(Math.round(node.event_risk!.occurrence.p_high * 100)).toBe(hi);
    expect(node.event_risk!.occurrence.meaning).toBe('at_least_once_within_horizon');
    expect((node as any).event_risk_basis_text).toBe(BASIS);
  });
  it('keeps a range wider than the odds minimum', () => {
    const c = candidate(50);
    (c.risks[0] as any).occurrence.p_low_pct = 10;
    (c.risks[0] as any).occurrence.p_high_pct = 90;
    expect(risk(admit(c)).event_risk?.occurrence).toMatchObject({ p_low: 0.1, p_high: 0.9 });
  });
  it.each(['', '  '])('basis-less Olumi occurrence %j stays a placeholder', basis => {
    const c = candidate();
    (c.risks[0] as any).occurrence.basis_text = basis;
    expect(risk(admit(c)).event_risk).toBeUndefined();
  });
  it('requires its own horizon, never silently fills the goal horizon', () => {
    const c = candidate();
    delete (c.risks[0] as any).occurrence.horizon_months;
    expect(risk(admit(c)).event_risk).toBeUndefined();
  });
  it('user likelihood and its own six-month horizon beat Olumi', () => {
    const result = admit(candidate(90), 'Key developer departure has a 10% chance within 6 months.');
    expect(risk(result).event_risk).toMatchObject({ occurrence: { p_low: 0.1, p_high: 0.1, basis: 'user' }, horizon: { months: 6 } });
    expect((risk(result) as any).event_risk_basis_text).toBeUndefined();
  });
  it('explicit 10% chance converts to the named risk as user, removes factor and its links', () => {
    const result = admit(probability(candidate()), 'Key developer departure: a 10% chance he leaves within 6 months.');
    expect(risk(result).event_risk).toMatchObject({ occurrence: { p_low: 0.1, p_high: 0.1, basis: 'user' }, horizon: { months: 6 } });
    expect(result.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
    expect(result.edges.every(e => result.nodes.some(n => n.id === e.from))).toBe(true);
    expect(result.loss.some(l => /converted/i.test(l.reason))).toBe(true);
    expect(result.loss.some(l => /You said/.test(l.reason))).toBe(false);
    expect(risk(result).event_risk_basis_text).toBeUndefined();
  });
  it('5b50b4c8 hedge drops with the exact interim sentence and no auto-apply', () => {
    const result = admit(probability(candidate()), 'Key developer departure: probably 10% within 6 months.');
    expect(risk(result).event_risk).toBeUndefined();
    expect(result.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
    expect(result.loss.map(l => l.reason)).toContain("You said ‘Key developer departure: probably 10% within 6 months’ for ‘Key developer departure’; it isn't used as its likelihood yet.");
    expect(result.loss.some(l => /Olumi had drafted/.test(l.reason))).toBe(false);
    expect(result.loss.some(l => /so the chance doesn't include this risk yet/.test(l.reason))).toBe(false);
  });
  it('a user hedge also withholds a drafted Olumi occurrence with a reference basis', () => {
    const result = admit(candidate(), 'Key developer departure: probably 10% within 6 months.');
    expect(risk(result).event_risk).toBeUndefined();
    expect(risk(result).event_risk_basis_text).toBeUndefined();
    expect(result.loss.map(l => l.reason)).toContain("You said ‘Key developer departure: probably 10% within 6 months’ for ‘Key developer departure’; it isn't used as its likelihood yet.");
    expect(result.loss.some(l => /Olumi had drafted/.test(l.reason))).toBe(false);
  });
  it('slices the user clause verbatim including hedge, case and internal spacing', () => {
    const quote = 'KEY developer departure:  probably 10% within 6 months';
    const brief = `Revenue can grow 20%. ${quote}. We could mitigate it.`;
    const result = admit(probability(candidate()), brief);
    expect(brief.includes(quote)).toBe(true);
    expect(result.loss.map(l => l.reason)).toContain(`You said ‘${quote}’ for ‘${LABEL}’; it isn't used as its likelihood yet.`);
  });
  it.each([false, true])('repeating a refused user hedge cannot become Olumi case (c), occurrence=%s', occurrence => {
    const quote = `${LABEL}: probably 10% within 6 months`;
    const result = admit(occurrence ? candidate() : probability(candidate()), `${quote}. ${quote}.`);
    expect(risk(result).event_risk).toBeUndefined();
    expect(result.loss.map(l => l.reason)).toContain(`You said ‘${quote}’ for ‘${LABEL}’; it isn't used as its likelihood yet.`);
    expect(result.loss.some(l => /Olumi had drafted/.test(l.reason))).toBe(false);
  });
  it.each(['15%', '110%', '10.5%'])('a different brief number %s is case (c), not (b)', figure => {
    const result = admit(probability(candidate()), `${LABEL}: probably ${figure} within 6 months.`);
    expect(risk(result).event_risk).toBeUndefined();
    expect(result.loss.map(l => l.reason)).toContain(`Olumi had drafted ‘${LABEL} probability’ = 10% without a basis, so it isn't used.`);
    expect(result.loss.some(l => /You said/.test(l.reason))).toBe(false);
  });
  it('an unrelated matching percentage cannot be attributed to the risk', () => {
    const result = admit(probability(candidate()), 'Revenue may fall 10%. Key developer departure is a risk.');
    expect(result.loss.some(l => /You said/.test(l.reason))).toBe(false);
    expect(risk(result).event_risk).toBeUndefined();
  });
  it('an orphan sidecar is dropped during admission', () => {
    const c = probability(candidate());
    (c.risks[0] as any).event_risk_basis_text = 'Forged orphan reference';
    expect(risk(admit(c)).event_risk_basis_text).toBeUndefined();
  });
  it.each(['missing', 'invalid', 'user', 'non-risk'])('a %s occurrence never displays orphan basis text', state => {
    const node: any = { id: 'risk', kind: state === 'non-risk' ? 'factor' : 'risk', label: LABEL,
      event_risk_basis_text: 'Forged orphan reference', event_risk: {
        version: 1, occurrence: { p_low: 0.1, p_high: 0.2, basis: state === 'user' ? 'user' : 'olumi' }, horizon: { months: 6 },
      } };
    if (state === 'missing') delete node.event_risk;
    if (state === 'invalid') node.event_risk.occurrence.p_low = 0.9;
    expect(goalChanceEstimateLikelihoods({ nodes: [node, { id: 'goal', kind: 'goal' }],
      edges: [{ from: 'risk', to: 'goal', strength: { mean: -1, std: 0.5 } }] }, 'goal')).toEqual([]);
  });
  it('the later shared user hold clears an existing Olumi sidecar', () => {
    const node = risk(admit(candidate()));
    const held = holdStatedEventRisks([node], [], 'Key developer departure: a 10% chance within 6 months.');
    expect(held.nodes[0]!.event_risk?.occurrence.basis).toBe('user');
    expect(held.nodes[0]!.event_risk_basis_text).toBeUndefined();
  });
  it('a probability absent from the brief with no basis is dropped and disclosed', () => {
    const result = admit(probability(candidate()), 'A key developer could leave.');
    expect(risk(result).event_risk).toBeUndefined();
    expect(result.loss.map(l => l.reason)).toContain("Olumi had drafted ‘Key developer departure probability’ = 10% without a basis, so it isn't used.");
    expect(result.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
  });
  it('a 0–1 chance factor converts using the risk occurrence basis and horizon', () => {
    const c = probability(candidate(), `${LABEL} chance`, 0.1, null as any);
    c.risks = candidate().risks;
    const result = admit(c);
    expect(risk(result).event_risk?.occurrence.basis).toBe('olumi');
    expect(result.nodes.some(n => n.kind === 'factor')).toBe(false);
  });
  it('unmatched and ambiguous probability factors never feed the goal', () => {
    for (const c of [probability({ ...candidate(), risks: [] }), probability({ ...candidate(), risks: [...candidate().risks, ...candidate().risks] })]) {
      const result = admit(c);
      expect(result.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
      expect(result.loss.some(l => /isn't used/.test(l.reason))).toBe(true);
    }
  });
  it('a probability suffix with trailing whitespace is still refused', () => {
    const result = admit(probability(candidate(), `${LABEL} probability `));
    expect(result.nodes.some(n => /probability$/i.test(n.label.trim()))).toBe(false);
  });
  it.each([null, Number.NaN])('a probability factor with missing or nonfinite value %s is never kept', value => {
    const result = admit(probability(candidate(), `${LABEL} probability`, value as number));
    expect(result.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
    expect(result.loss.some(l => /likelihood belongs on an event risk/.test(l.reason))).toBe(true);
  });
  it('an out-of-range unitless probability factor is never kept', () => {
    const result = admit(probability(candidate(), `${LABEL} probability`, 2, null as any));
    expect(result.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
  });
  it('invalid probability percentages never survive as continuous factors', () => {
    const result = admit(probability(candidate(), `${LABEL} probability`, 110));
    expect(result.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
    expect(risk(result).event_risk).toBeUndefined();
    expect(result.loss.some(l => /isn't used/.test(l.reason))).toBe(true);
  });
  it('a conflicting probability factor cannot silently replace the risk estimate', () => {
    const c = probability(candidate(90)); c.risks = candidate(90).risks;
    const result = admit(c);
    expect(Math.round(risk(result).event_risk!.occurrence.p_low * 100)).toBe(82);
    expect(result.nodes.some(n => /probability$/i.test(n.label))).toBe(false);
    expect(result.loss.some(l => /different likelihood estimate/.test(l.reason))).toBe(true);
    expect(result.loss.some(l => /Converted/.test(l.reason))).toBe(false);
  });
  it('a widener causal driver leaves the discrete event ordinary', () => {
    const c = candidate();
    c.factors = [{ label: 'Hiring effort', role: 'controllable', baseline_known: true,
      baseline_value: 1, unit: 'hours', provenance: 'explicit', plausible_max: 10 }];
    const result = admitCandidateModel(c, { proposed_links: [{ from: 'Hiring effort', to: LABEL,
      direction: 'negative', provenance: 'ai_proposed' }] });
    expect(result.nodes.find(n => n.kind === 'risk')!.event_risk).toBeUndefined();
  });
  it('a raw drafted cause leaves the discrete event ordinary', () => {
    const c = candidate();
    c.links = [...c.links, { from: 'Revenue', to: LABEL, direction: 'negative', provenance: 'ai_proposed' }];
    expect(risk(admit(c)).event_risk).toBeUndefined();
  });
  it('an option-generated driver cannot bypass the event root gate', () => {
    const c = candidate();
    c.options = [{ label: 'Prevent departure', provenance: 'explicit', changes: [LABEL] }];
    expect(risk(admit(c)).event_risk).toBeUndefined();
  });
  it.each([0, -1, 601, Number.NaN])('invalid horizon %s stays a placeholder', horizon => {
    const c = candidate(); (c.risks[0] as any).occurrence.horizon_months = horizon;
    expect(risk(admit(c)).event_risk).toBeUndefined();
  });
  it.each([['Client cancels Revenue', 1], ['Competitor launches', 0.8]] as const)('%s impact existence is %s', (label, existence) => {
    const c = candidate();
    c.risks = [{ ...c.risks[0]!, label }]; c.links = [{ ...c.links[0]!, from: label }];
    expect(admit(c).edges.find(e => e.from === 'client_cancels_revenue' || e.from === 'competitor_launches')!.exists_probability).toBe(existence);
  });
  it('does not overwrite a user-sized impact', () => {
    const c = candidate();
    c.links = [{ ...c.links[0]!, effect_provenance: 'explicit', provenance: 'explicit', effect_amount: -2000 }];
    const result = admitCandidateModel(c, {}, 'Key developer departure costs £2000 a month in revenue.', () => true,
      () => false, () => null, () => true);
    const impact = result.edges.find(e => e.from === 'key_developer_departure')!;
    expect(impact.provenance?.magnitude).toBe('user_stated');
    expect(impact.provenance?.natural_effect?.amount).toBe(-2000);
  });
});
