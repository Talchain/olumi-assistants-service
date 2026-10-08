import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';

const LABEL = 'Key developer departure';
const BASIS = 'Typical annual key-staff turnover in small software teams.';
function candidate(): CandidateModel {
  return {
    goal: { metric: 'Revenue', operator: '>=', value: 20000, unit: 'GBP/month', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 10000, baseline_provenance: 'explicit' },
    constraints: [], options: [], factors: [], outcomes: [],
    risks: [{ label: LABEL, provenance: 'explicit', unit: 'event', plausible_max: 1,
      occurrence: { p_low_pct: 90, p_high_pct: 90, horizon_months: 12, basis_text: BASIS } }],
    links: [{ from: LABEL, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed',
      effect_amount: -1000, effect_per_source_change: 1, effect_provenance: 'ai_proposed' }],
  };
}
const admit = (draft: CandidateModel, brief: string) => admitCandidateModel(draft, {}, brief, () => true);
const risk = (result: ReturnType<typeof admit>) => result.nodes.find(n => n.kind === 'risk' && (n.description ?? n.label) === LABEL)!;

describe('FIX2 Class A: every figure scope and every probability factor uses the same user-claim guard', () => {
  it.each(['estimated', 'at most'])('comma context with refused phrase %s retains the user figure without Olumi occurrence', hedge => {
    const result = admit(candidate(), `${LABEL}, ${hedge} 10% within 6 months.`);
    expect(risk(result).event_risk).toBeUndefined();
    expect(risk(result).event_risk_basis_text).toBeUndefined();
    expect(result.loss.some(l => l.reason.includes('You said') && l.reason.includes(`${hedge} 10% within 6 months`))).toBe(true);
    expect(result.loss.some(l => l.reason.includes('Olumi had drafted'))).toBe(false);
  });

  it('two figures in one comma fragment cannot bind an unmodelled event likelihood to the modelled risk', () => {
    const result = admit(candidate(), `${LABEL}: probably 10% and Supplier outage has a 20% chance within 12 months.`);
    expect(risk(result).event_risk).toBeUndefined();
    expect(risk(result).event_risk_basis_text).toBeUndefined();
    expect(result.loss.some(l => l.reason.includes('You said') && l.reason.includes('probably 10%'))).toBe(true);
    expect(result.loss.some(l => l.reason.includes('Olumi had drafted'))).toBe(false);
  });

  it.each([false, true])('orphan probability factor with invalid baseline=%s quotes the user figure and does not call it Olumi-drafted', invalidBaseline => {
    const factorLabel = `${LABEL} probability`;
    const draft: CandidateModel = { ...candidate(), risks: [],
      factors: [{ label: factorLabel, role: 'external', baseline_known: false,
        baseline_value: invalidBaseline ? 110 : 10, unit: '%', provenance: 'ai_proposed', plausible_max: 100 }],
      links: [{ from: factorLabel, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed' }],
    };
    const result = admit(draft, `${LABEL}: probably 10% within 6 months.`);
    expect(result.nodes.some(n => n.kind === 'factor')).toBe(false);
    expect(result.loss.some(l => l.reason.includes('You said') && l.reason.includes('probably 10% within 6 months'))).toBe(true);
    expect(result.loss.some(l => l.reason.includes('Olumi had drafted'))).toBe(false);
  });

  it('an ambiguous probability factor quotes the user figure without assigning it to either risk', () => {
    const original = candidate();
    const factorLabel = `${LABEL} probability`;
    const draft: CandidateModel = { ...original,
      risks: [...original.risks, { ...original.risks[0]!, label: 'Developer departure' }],
      factors: [{ label: factorLabel, role: 'external', baseline_known: false,
        baseline_value: 10, unit: '%', provenance: 'ai_proposed', plausible_max: 100 }],
      links: [...original.links, { from: factorLabel, to: 'Revenue', direction: 'negative', provenance: 'ai_proposed' }],
    };
    const result = admit(draft, `${LABEL}: probably 10% within 6 months.`);
    expect(result.nodes.filter(n => n.kind === 'risk').every(n => n.event_risk === undefined)).toBe(true);
    expect(result.nodes.some(n => n.kind === 'factor')).toBe(false);
    expect(result.loss.some(l => l.reason.includes('You said') && l.reason.includes('probably 10% within 6 months'))).toBe(true);
    expect(result.loss.some(l => l.reason.includes('Olumi had drafted'))).toBe(false);
  });

  it('comma-attached event discussion without a figure keeps the warranted Olumi path', () => {
    const result = admit(candidate(), `${LABEL}, estimated to be possible within 6 months. Revenue can rise 20%.`);
    expect(risk(result).event_risk?.occurrence.basis).toBe('olumi');
    expect(risk(result).event_risk_basis_text).toBe(BASIS);
  });
});
