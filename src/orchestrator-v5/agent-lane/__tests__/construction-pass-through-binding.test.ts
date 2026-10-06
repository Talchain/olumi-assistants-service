/**
 * ⭐ (B) A STATED SIZE IS BOUND THROUGH OLUMI'S PASS-THROUGH (Science d5 #87 6008551439 (B); MC G1b ceiling on Acceptance's
 * 14 served T1b drafts, CEE 231affbe). The `sizeWritten` door's retirement (6008581742) is its own PR.
 *
 * Served draft 9 (scenario 956e3c12): "Each lost customer removes £300 a month of monthly recurring revenue" sized ‘Customers
 * lost from price rise’ → ‘MRR lost to price churn’ (credited by the door, NO quote), and ‘MRR lost to price churn’ →
 * ‘monthly recurring revenue’ stayed a placeholder, which withheld every option's goal figures. On the 14 drafts, 15 of 57
 * user-stated links carried no quote. Bound by edge endpoints, the persisted graph and the stored quote.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '956e3c12-0000-4000-8000-0000000956e3';
const T1B = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. '
  + 'Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least '
  + '£126,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month to monthly recurring '
  + 'revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer removes £300 a '
  + 'month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. Each '
  + 'starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in '
  + 'support. Keeping pricing as it is adds nothing.';
const QUOTE = 'Each lost customer removes £300 a month of monthly recurring revenue.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
const sized = (from: string, to: string, direction: Dir, amount: number | null, per: number | null, provenance = 'explicit') =>
  ({ from, to, direction, provenance, effect_amount: amount, effect_per_source_change: per, effect_provenance: amount === null ? null : provenance });
const set = (factor_label: string, value: number, unit: string, provenance = 'explicit') => ({ factor_label, value, value_kind: 'absolute', unit, provenance });

/** Served draft 9's shape: the £300 runs into Olumi's mediator ‘MRR lost to price churn’, which passes into the goal. */
function draft9(over: { extraLinks?: Record<string, unknown>[]; extraFactors?: Record<string, unknown>[]; extraRisks?: Record<string, unknown>[] } = {}): Record<string, unknown> {
  return {
    goal: { metric: 'monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 126000, unit: 'GBP per month', horizon_months: 9,
      provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Raise prices by 10%', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Price rise', 10, '%')] },
      { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: 'Price rise', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      ...(over.extraFactors ?? []),
    ],
    risks: [{ label: 'MRR lost to price churn', provenance: 'inferred', unit: 'GBP per month', plausible_max: 50000 }, ...(over.extraRisks ?? [])],
    outcomes: [{ label: 'Customers lost from price rise', provenance: 'inferred', unit: 'customers', plausible_max: 1000 }],
    links: [
      sized('Price rise', 'monthly recurring revenue', 'positive', 1200, 1),
      sized('Price rise', 'Customers lost from price rise', 'positive', 2, 1),
      sized('Customers lost from price rise', 'MRR lost to price churn', 'positive', 300, 1),
      sized('MRR lost to price churn', 'monthly recurring revenue', 'negative', null, null, 'inferred'),
      ...(over.extraLinks ?? []),
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  };
}

type Edge = Record<string, any>;
async function build(wire: Record<string, unknown>, brief = T1B): Promise<{ edge: (from: string, to: string) => Edge; label: Map<string, string> }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: { nodes: Edge[]; edges: Edge[] } | null = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: { nodes: Edge[]; edges: Edge[] } }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as { ok: boolean };
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const g = registered!;
  const label = new Map<string, string>(g.nodes.map((n) => [n.id, n.label]));
  const idOf = (l: string) => g.nodes.find((n) => n.label === l)!.id;
  return { edge: (from, to) => g.edges.find((e) => e.from === idOf(from) && e.to === idOf(to))!, label };
}

describe('(B) a stated size is bound through Olumi\'s pass-through', () => {
  it('RED (served draft 9): the £300 link is the user\'s WITH its quote, and the mediator\'s link onward is the −1 definition', async () => {
    const { edge } = await build(draft9());
    const into = edge('Customers lost from price rise', 'MRR lost to price churn');
    expect(into.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: QUOTE });
    const onward = edge('MRR lost to price churn', 'monthly recurring revenue');
    expect(onward.provenance).toMatchObject({ definitional: true });
    expect(onward.provenance.magnitude).not.toBe('olumi_placeholder');
    expect(onward.provenance.natural_effect).toMatchObject({ amount: -1, per_source_change: 1 });
    expect(onward.effect_direction).toBe('negative');
    expect(onward.provenance.source).not.toBe('user_specified');
  });

  it('CONTROL (unit-only typing is refused): a sentence that never names the onward quantity binds directly and types NOTHING onward', async () => {
    const brief = T1B.replace(QUOTE, 'Each lost customer removes £300 a month.');
    const { edge } = await build(draft9(), brief);
    expect(edge('Customers lost from price rise', 'MRR lost to price churn').provenance).toMatchObject({ magnitude: 'user_stated', source_quote: 'Each lost customer removes £300 a month.' });
    expect(edge('MRR lost to price churn', 'monthly recurring revenue').provenance.definitional).toBeUndefined();
  });

  it('CONTROL: a mediator with TWO links onward is no pass-through — nothing is bound through it', async () => {
    const { edge } = await build(draft9({
      extraRisks: [{ label: 'Reputation damage', provenance: 'inferred' }],
      extraLinks: [sized('MRR lost to price churn', 'Reputation damage', 'positive', null, null, 'inferred'),
        sized('Reputation damage', 'monthly recurring revenue', 'negative', null, null, 'inferred')],
    }));
    expect(edge('Customers lost from price rise', 'MRR lost to price churn').provenance.source_quote).toBeUndefined();
    expect(edge('MRR lost to price churn', 'monthly recurring revenue').provenance.definitional).toBeUndefined();
  });

  it('CONTROL (Science\'s coincidental £300): a drafter\'s "explicit" £300 the brief writes only as a PRICE is never bound as the user\'s', async () => {
    // "400 customers paying £300 a month": £300 is each customer's price, not what one more customer does to anything.
    const { edge } = await build(draft9({
      extraFactors: [{ label: 'Existing customers', role: 'observable', baseline_known: true, baseline_value: 400, unit: 'customers', provenance: 'explicit', plausible_max: 2000 }],
      extraLinks: [sized('Existing customers', 'monthly recurring revenue', 'positive', 300, 1)],
    }));
    const priceLink = edge('Existing customers', 'monthly recurring revenue');
    expect(priceLink.provenance.magnitude).not.toBe('user_stated');
    expect(priceLink.provenance.source).not.toBe('user_specified');
    expect(priceLink.provenance.source_quote).toBeUndefined();
  });
});
