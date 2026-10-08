import { describe, expect, it } from 'vitest';
import { admitStoredProductDeclaration, type CandidateModel } from '../admit-model.js';
import { goalCoherenceAsk } from '../goal-coherence.js';
import { proposeProductIdentity, todaysLevelFor } from '../identity-proposal.js';
import { unconfirmGoalProducts, withReconcilingProductIdentity } from '../reconciling-product.js';

type Rec = Record<string, any>;
const PRICE = 'price'; const STOCK = 'stock_today'; const CHURN = 'churn'; const INFLOW = 'inflow';
const AT12 = 'stock_month_12'; const GOAL = 'mrr';

/** Today's £12,250 = £49 × 250; the month-12 draft's 999 is deliberately over 5% away. */
function graph(stockSource = 'brief_extraction'): Rec {
  const os = (raw: number, unit: string, source = 'brief_extraction', cap = raw * 4) => ({ raw_value: raw, value: raw / cap, unit, source, cap });
  return {
    nodes: [
      { id: PRICE, kind: 'factor', label: 'Pro price', observed_state: os(49, 'GBP/subscriber/month') },
      { id: STOCK, kind: 'factor', label: 'Subscribers today', observed_state: os(250, 'subscribers', stockSource) },
      { id: CHURN, kind: 'factor', label: 'Monthly churn', observed_state: os(3, '%') },
      { id: INFLOW, kind: 'factor', label: 'Monthly new subscribers', observed_state: os(20, 'subscribers/month') },
      { id: AT12, kind: 'outcome', label: 'Subscribers at month 12', observed_state: os(999, 'subscribers', 'cee_inference'),
        nonlinear_identity: { operation: 'accumulation', factor_ids: [STOCK, CHURN, INFLOW], horizon_months: 12, rate_scale: 0.01, stated_in_brief: true } },
      { id: GOAL, kind: 'goal', label: 'MRR', observed_state: os(12250, 'GBP/month'),
        nonlinear_identity: { operation: 'product', factor_ids: [PRICE, AT12], stated_in_brief: false },
        goal_threshold_raw: 1000, goal_threshold_unit: 'GBP/month', goal_threshold_frame: 'level', goal_direction: '>=' },
    ],
    edges: [[STOCK, AT12], [CHURN, AT12], [INFLOW, AT12], [PRICE, GOAL], [AT12, GOAL]].map(([from, to]) => ({ from, to })),
  };
}
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id)!;

function candidateCarrier(): CandidateModel {
  const factor = (label: string, value: number, unit: string) => ({ label, role: 'observable', baseline_known: true, baseline_value: value, unit, provenance: 'explicit' });
  return {
    goal: { metric: 'MRR', operator: '>=', value: 20000, target_stated: true, unit: 'GBP/month', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 12250, baseline_provenance: 'explicit', scope: null },
    options: [], constraints: [], risks: [], outcomes: [{ label: 'Projected Pro MRR', provenance: 'inferred' }],
    factors: [factor('Price', 49, 'GBP/subscriber/month'), factor('Stock today', 250, 'subscribers'),
      factor('Month-12 stock', 999, 'subscribers'), factor('Churn', 3, '%'), factor('Inflow', 20, 'subscribers/month')],
    links: [['Price', 'Projected Pro MRR'], ['Month-12 stock', 'Projected Pro MRR'], ['Projected Pro MRR', 'MRR']]
      .map(([from, to]) => ({ from, to, direction: 'positive', provenance: 'inferred' })),
    identities: [
      { outcome: 'Month-12 stock', operation: 'accumulation', factors: ['Stock today', 'Churn', 'Inflow'], provenance: 'explicit' },
      { outcome: 'Projected Pro MRR', operation: 'product', factors: ['Price', 'Month-12 stock'], provenance: 'explicit' },
    ],
  } as unknown as CandidateModel;
}

describe('products over an accumulation reconcile against S₀, never S_N', () => {
  it('an accumulation typed as a factor cannot gain a goal product from its own matching S_N; a plain product still mints', () => {
    const c = candidateCarrier();
    const month12 = c.factors.find((f) => f.label === 'Month-12 stock')!;
    const missingProduct = {
      ...c,
      factors: c.factors.map((f) => f === month12 ? { ...f, baseline_value: 250 } : f),
      links: [{ from: 'Price', to: 'MRR', direction: 'positive', provenance: 'inferred' },
        { from: 'Month-12 stock', to: 'MRR', direction: 'positive', provenance: 'inferred' }],
      identities: c.identities!.filter((i) => i.operation === 'accumulation'),
    } as unknown as CandidateModel;
    const brief = 'Price is £49 per subscriber per month. We have 250 subscribers and MRR is £12,250 today. '
      + 'Our goal is MRR £20,000 within 12 months.';
    expect(withReconcilingProductIdentity(missingProduct, brief)).toBe(missingProduct);
    const plain = { ...missingProduct, identities: [] };
    expect(withReconcilingProductIdentity(plain, brief).identities).toEqual([
      { outcome: 'MRR', operation: 'product', factors: ['Price', 'Month-12 stock'], provenance: 'inferred' },
    ]);
  });

  it('candidate goal-carrier reading uses 250 today and remains Olumi’s reading', () => {
    const result = unconfirmGoalProducts(candidateCarrier(), '');
    expect(result.model.identities!.find((i) => i.operation === 'product')!.provenance).toBe('inferred');
  });

  it('candidate accumulation with malformed or missing S₀ cannot use its own matching S_N', () => {
    for (const malformed of [false, true]) {
      const c = candidateCarrier();
      const revised = {
        ...c,
        factors: c.factors.filter((f) => malformed || f.label !== 'Stock today')
          .map((f) => f.label === 'Month-12 stock' ? { ...f, baseline_value: 250 } : f),
        identities: c.identities!.map((i) => malformed && i.operation === 'accumulation' ? { ...i, factors: ['Stock today', 'Churn'] } : i),
      };
      expect(unconfirmGoalProducts(revised, '').model.identities!.find((i) => i.operation === 'product')!.provenance).toBe('explicit');
    }
  });

  it('stored reading compares today’s £12,250 with £49 × S₀, including a ratified S₀', () => {
    const proposal = proposeProductIdentity(graph('user_confirmed'));
    expect(proposal).toMatchObject({ outcome_id: GOAL, factor_ids: [PRICE, AT12] });
    expect(proposal!.words).toMatch(/^Olumi reads/);
  });

  it('legacy today operand reads the accumulation’s positional stock and its own user source', () => {
    expect(todaysLevelFor(graph(), AT12)).toMatchObject({ raw: 250, unit: 'subscribers', source: 'brief_extraction', frame: 1000 });
    expect(proposeProductIdentity(graph())!.words).toContain('Today that is £49 × 250');
  });

  it('coherence keeps the product when S₀ has no execution frame: £49 × 250 still reconciles', () => {
    const g = graph();
    node(g, STOCK).observed_state = { raw_value: 250, value: 250, unit: 'subscribers', source: 'brief_extraction' };
    expect(todaysLevelFor(g, AT12)).toBeNull();
    expect(goalCoherenceAsk(g, { nodeId: PRICE, previousRaw: 48 })).toMatchObject({ implied: 12250, ratio: 12.25 });
  });

  it('CONTRAST (#2851 user-figure rule through S₀): Olumi\'s inferred S₀ gives no implied level', () => {
    const g = graph();
    node(g, STOCK).observed_state = { raw_value: 250, value: 250, unit: 'subscribers', source: 'cee_inference' };
    expect(goalCoherenceAsk(g, { nodeId: PRICE, previousRaw: 48 })).toBeNull();
  });

  it('admission preserves the month-N product without comparing its 999 against today’s MRR', () => {
    expect(admitStoredProductDeclaration(graph(), { outcome_id: GOAL, factor_ids: [PRICE, AT12] })).toEqual({ ok: true });
  });

  it('no S₀: a projected month-N level matching today’s goal cannot fill the gap', () => {
    const g = graph();
    g.nodes = g.nodes.filter((n: Rec) => n.id !== STOCK);
    node(g, AT12).observed_state.raw_value = 250;
    node(g, AT12).observed_state.source = 'brief_extraction';
    expect(proposeProductIdentity(g)).toBeNull();
    expect(goalCoherenceAsk(g, { nodeId: PRICE })).toBeNull();
  });

  it('CONTROL: a plain product still has the 5% reconciliation gate', () => {
    const g = graph('user_confirmed');
    delete node(g, AT12).nonlinear_identity;
    expect(proposeProductIdentity(g)).toBeNull();
    node(g, AT12).observed_state.raw_value = 250;
    expect(proposeProductIdentity(g)).not.toBeNull();
    node(g, AT12).observed_state.source = 'brief_extraction';
    expect(goalCoherenceAsk(g, { nodeId: PRICE })).toMatchObject({ implied: 12250 });
    node(g, AT12).observed_state.raw_value = 999;
    expect(goalCoherenceAsk(g, { nodeId: PRICE })).toBeNull();
  });
});
