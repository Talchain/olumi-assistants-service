import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { edgeStrengthProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { censusConfidenceParameters, resolveAnalysisAdmission, semanticReasonFromAnalysisReady, semanticReasons } from '../analysis-admission.js';

const draw2 = () => JSON.parse(readFileSync(new URL('./fixtures/mc-p0/draw2.json', import.meta.url), 'utf8'));
const size = { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%', strength_mean: 0.64 };
const user = () => ({ defaulted: true, provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: size } });
const control = () => expect(edgeStrengthProvenance(user())).toBe('user_stated');
const ALL = "The sizes of the links that decide it are yours, from your brief. How uncertain they are, and whether each link holds, are Olumi's assumptions.";
const MIXED = 'At least one of the estimates this comparison rests on is yours, so a leading option can be named.';
const reason = (g: unknown) => resolveAnalysisAdmission(g).reasons.find(r => r.field === 'semantic_quality_sufficient')!;
const mixedGraph = () => { const g = draw2(); for (const e of g.edges) if (e.provenance?.natural_effect) e.provenance.magnitude = e.from === 'price_increase' && e.to === 'customer_losses_from_price_rise' ? 'user_stated' : 'olumi_estimate'; return g; };
const allGraph = () => { const g = draw2(); g.edges.find((e: any) => e.from === 'price_increase' && e.to === 'monthly_recurring_revenue').provenance.magnitude = 'user_stated'; return g; };

describe('MC P0 FD: strength credit follows its mean', () => {
  it('T1b user mean with projected spread/existence earns material credit', () => {
    control();
    expect(censusConfidenceParameters(draw2()).material_parameters_user_stated).toBeGreaterThan(0);
    expect(resolveAnalysisAdmission(draw2()).semantic_quality_sufficient).toBe(true);
  });
  it('contrast A: Olumi mean with projected spread never earns credit (even if authored_magnitudes)', () => {
    control();
    expect(edgeStrengthProvenance({ ...user(), authored_magnitudes: ['price::mrr'], provenance: { ...user().provenance, magnitude: 'olumi_estimate' } })).toBe('ai_drafted');
  });
  it('contrast B: authored spread/existence and brief source cannot credit an Olumi mean', () => {
    control();
    expect(edgeStrengthProvenance({ provenance: { ...user().provenance, magnitude: 'olumi_estimate' }, strength: { mean: 0.64, std: 0.2 }, exists_probability: 1 })).toBe('ai_drafted');
  });
  it('unmarked links keep the source/defaulted rule; user magnitude needs natural effect', () => {
    control();
    expect(edgeStrengthProvenance({ defaulted: true, provenance: { source: 'brief_extraction' } })).toBe('ai_drafted');
    expect(edgeStrengthProvenance({ provenance: { source: 'brief_extraction' } })).toBe('user_stated');
    expect(edgeStrengthProvenance({ defaulted: true, provenance: { source: 'brief_extraction', magnitude: 'user_stated' } })).toBe('ai_drafted');
  });
  it('ALL material link means are yours: exact copy and same code, including the reader', () => {
    const r = reason(allGraph());
    expect(r.message).toBe(ALL);
    expect(r.code).toBe('CONFIDENCE_PARAMETERS_PARTLY_USER_STATED');
    expect(semanticReasonFromAnalysisReady({ analysis_admission: { reasons: [r] } })).toEqual({ code: r.code, message: ALL });
    expect(semanticReasons().some(r => r.message === ALL)).toBe(true);
  });
  it('MIXED material link means keep the existing sentence (one is not all)', () => {
    expect(reason(allGraph()).message).toBe(ALL); // paired positive prevents a vacuous base pass
    expect(censusConfidenceParameters(mixedGraph()).material_parameters_user_stated).toBe(1);
    expect(reason(mixedGraph()).message).toBe(MIXED);
    expect(reason(mixedGraph()).code).toBe('CONFIDENCE_PARAMETERS_PARTLY_USER_STATED');
  });
  it('all-yours refers to material links only; input is untouched', () => {
    const g = allGraph(); const before = JSON.stringify(g);
    g.edges.push({ from: 'unrelated', to: 'outside', provenance: { magnitude: 'olumi_estimate' } });
    const frozen = JSON.stringify(g);
    expect(reason(g).message).toBe(ALL);
    expect(JSON.stringify(g)).toBe(frozen);
    expect(before).not.toBe(frozen);
  });
});
