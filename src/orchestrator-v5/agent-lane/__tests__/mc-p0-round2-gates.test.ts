import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as admission from '../admit-model.js';
import { edgeStrengthProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { resolveAnalysisAdmission } from '../../admission/analysis-admission.js';
const brief = readFileSync(new URL('../../admission/__tests__/fixtures/mc-p0/BRIEF.txt', import.meta.url), 'utf8');
const draw1 = () => JSON.parse(readFileSync(new URL('../../admission/__tests__/fixtures/mc-p0/draw1.json', import.meta.url), 'utf8'));
const priceSentence = 'Each 1% price rise adds £1,200 a month to monthly recurring revenue before churn.';
const price = { from: 'price', to: 'mrr', effect_direction: 'positive', natural_effect: { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' } };
const ns = [{ id: 'price', label: 'Price increase', unit: '%' }, { id: 'mrr', label: 'monthly recurring revenue', unit: '£/month' }];
const bind = (links: any[], nodes: any[], text: string) => (admission as any).bindStatedLinkSizes?.(links, nodes, text) as Map<number, string> | undefined ?? new Map<number, string>();
const control = () => expect(bind([price], ns, priceSentence).get(0)).toBe(priceSentence);
const wrong = { from: 'starter_subscribers', to: 'starter_support_cost', effect_direction: 'positive', natural_effect: { amount: 49, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'subscribers' } };
const wrongNodes = (label: string) => [{ id: wrong.from, label: 'Starter subscribers', unit: 'subscribers' }, { id: wrong.to, label: 'Starter support cost', unit: '£/month' }, { id: 'mrr', label, unit: '£/month' }];
const user = { defaulted: true, provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: price.natural_effect } };
describe('MC P0 round 2 binding and DL gates', () => {
  it('R2-1 sealed T1b starter_subscribers->starter_support_cost £49 refuses other Monthly recurring revenue label', () => {
    control();
    expect(bind([wrong], wrongNodes('Monthly recurring revenue'), brief).has(0)).toBe(false);
  });
  it('R2-1 accepted residual: starter_subscribers->starter_support_cost £49 passes when other node label is MRR', () => {
    control();
    expect(bind([wrong], wrongNodes('MRR'), brief).get(0)).toBe('Each starter subscriber adds £49 a month to monthly recurring revenue.');
  });
  it('R2-1 Price increase->monthly recurring revenue £1,200 remains promoted without target-label requirement', control);
  it('R2-2 real stored draft 1 invented support chain has no credit and cannot license comparative_leader', () => {
    control();
    const g = draw1();
    const realPath = '/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/a320bf52-a93a-43ab-ae80-d7d8e435a988/scratchpad/served-t1b/out/draw1/graph-read.json';
    expect(g).toEqual(JSON.parse(readFileSync(realPath, 'utf8')).body.graph);
    const nodes = g.nodes.map((n: any) => ({ ...n, unit: n.observed_state?.unit ?? (n.kind === 'goal' ? n.goal_threshold_unit : undefined) ?? n.unit }));
    const bindings = bind(g.edges.map((e: any) => ({ ...e, natural_effect: e.provenance?.natural_effect })), nodes, brief);
    const projected = structuredClone(g);
    for (const [i, sentence] of bindings) if (projected.edges[i].provenance?.magnitude === 'olumi_estimate') projected.edges[i].provenance = { ...projected.edges[i].provenance, magnitude: 'user_stated', source_quote: sentence };
    for (const id of ['starter_subscribers->starter_support_cost', 'starter_support_cost->mrr_lost_to_starter_support_burden', 'mrr_lost_to_starter_support_burden->monthly_recurring_revenue']) {
      const i = projected.edges.findIndex((e: any) => `${e.from}->${e.to}` === id);
      expect(i, id).toBeGreaterThanOrEqual(0);
      expect(bindings.has(i), id).toBe(false);
      expect(edgeStrengthProvenance(projected.edges[i]), id).toBe('ai_drafted');
    }
    expect(resolveAnalysisAdmission(projected).permitted_analysis_mode).not.toBe('comparative_leader');
  });
  it('R3-F4 supersedes R2-3 a: marked user_stated without natural_effect is not credited', () => {
    expect(edgeStrengthProvenance(user)).toBe('user_stated');
    expect(edgeStrengthProvenance({ defaulted: true, provenance: { source: 'brief_extraction', magnitude: 'user_stated' } })).toBe('ai_drafted');
    expect(edgeStrengthProvenance({ provenance: { source: 'brief_extraction', magnitude: 'user_stated' } })).toBe('ai_drafted');
  });
  it('R2-3 b: defaulted + brief_extraction + no magnitude is ai_drafted (paired c control)', () => {
    expect(edgeStrengthProvenance(user)).toBe('user_stated');
    expect(edgeStrengthProvenance({ defaulted: true, provenance: { source: 'brief_extraction' } })).toBe('ai_drafted');
  });
  it('R2-3 c: user_stated + natural_effect + defaulted is credited (paired b control)', () => {
    expect(edgeStrengthProvenance({ defaulted: true, provenance: { source: 'brief_extraction' } })).toBe('ai_drafted');
    expect(edgeStrengthProvenance(user)).toBe('user_stated');
  });
});
