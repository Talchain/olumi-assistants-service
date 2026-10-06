/**
 * ⭐ (A) A RATE × COUNT DRAWN AS TWO ADDED LINKS IS THEIR PRODUCT (Science d5 #87 6008551439 (A); MC G1b ceiling).
 *
 * Served draft 7 (Acceptance G1, scenario b63d8672, CEE 231affbe): ‘Starter-tier MRR’ ← ‘Starter tier monthly price’ (£ per
 * subscriber per month) + ‘Starter subscribers’, both links placeholders. The withhold asked the user to size two links no
 * honest size exists for. Now the outcome is Olumi's product of the two, the created count is 0 today, and the licence's
 * own walk finds no link nobody sized once the product is evaluated. Bound by node label, the persisted graph and the
 * licence predicate (`unsizedLeaderGoalPaths`).
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { unsizedLeaderGoalPaths } from '../goal-certainty.js';

const T1B = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. '
  + 'Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least '
  + '£126,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month to monthly recurring '
  + 'revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer removes £300 a '
  + 'month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. Each '
  + 'starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in '
  + 'support. Keeping pricing as it is adds nothing.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
const link = (from: string, to: string, direction: Dir, amount: number | null = null, per: number | null = null, provenance = amount === null ? 'inferred' : 'explicit') =>
  ({ from, to, direction, provenance, effect_amount: amount, effect_per_source_change: per, effect_provenance: amount === null ? null : provenance });
const set = (factor_label: string, value: number, unit: string, provenance = 'explicit') => ({ factor_label, value, value_kind: 'absolute', unit, provenance });

/** Served draft 7's shape. `pointCount`: draft 8's shape instead, where Launch sets the subscribers to one figure. */
function draft7(over: { pointCount?: boolean; priceUnit?: string; price?: number } = {}): Record<string, unknown> {
  const launch = over.pointCount === true
    ? [set('Starter subscribers', 150, 'subscribers', 'ai_proposed'), set('Starter tier monthly price', over.price ?? 49, over.priceUnit ?? 'GBP per subscriber per month', 'ai_proposed')]
    : [set('Starter tier launched', 1, '', 'ai_proposed'), set('Starter tier monthly price', over.price ?? 49, over.priceUnit ?? 'GBP per subscriber per month', 'ai_proposed')];
  return {
    goal: { metric: 'monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 126000, unit: 'GBP per month', horizon_months: 9,
      provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Raise prices 10%', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Price rise', 10, '%')] },
      { label: 'Launch £49 starter tier', provenance: 'explicit', is_status_quo: null, changes: [], interventions: launch },
      { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: 'Price rise', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      ...(over.pointCount === true
        ? [{ label: 'Starter subscribers', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 1000 }]
        : [{ label: 'Starter tier launched', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '', provenance: 'ai_proposed', plausible_max: 1 }]),
      { label: 'Starter tier monthly price', role: 'controllable', baseline_known: true, baseline_value: 0, unit: over.priceUnit ?? 'GBP per subscriber per month', provenance: 'ai_proposed', plausible_max: 200 },
    ],
    risks: [],
    outcomes: [
      { label: 'Customers lost from price rise', provenance: 'inferred', unit: 'customers', plausible_max: 1000 },
      ...(over.pointCount === true ? [] : [{ label: 'Starter subscribers', provenance: 'inferred', unit: 'subscribers', plausible_max: 1000 }]),
      { label: 'Starter-tier MRR', provenance: 'inferred', unit: 'GBP per month', plausible_max: 50000 },
    ],
    links: [
      link('Price rise', 'monthly recurring revenue', 'positive', 1200, 1),
      link('Price rise', 'Customers lost from price rise', 'positive', 2, 1),
      link('Customers lost from price rise', 'monthly recurring revenue', 'negative', -300, 1),
      ...(over.pointCount === true ? [] : [link('Starter tier launched', 'Starter subscribers', 'positive', 150, 1)]),
      link('Starter tier monthly price', 'Starter-tier MRR', 'positive'),
      link('Starter subscribers', 'Starter-tier MRR', 'positive'),
      { ...link('Starter-tier MRR', 'monthly recurring revenue', 'positive', 1, 1, 'inferred'), definitional: true },
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  };
}

type Rec = Record<string, any>;
async function build(wire: Record<string, unknown>): Promise<{ graph: Rec; node: (label: string) => Rec; said: string[] }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: Rec | null = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('b63d8672-0000-4000-8000-0000000b63d8', T1B, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const graph = registered!;
  return { graph, node: (label) => (graph.nodes as Rec[]).find((n) => n.label === label)!, said: [...(out.not_represented ?? []), ...(out.open_questions ?? [])] };
}

describe('(A) a rate × count drawn as two added links is Olumi\'s product of the two', () => {
  it('RED (served draft 7): ‘Starter-tier MRR’ is Olumi\'s product of price × subscribers; the created count is 0 today', async () => {
    const { node } = await build(draft7());
    const mrr = node('Starter-tier MRR');
    expect(mrr.nonlinear_identity).toEqual({ operation: 'product', factor_ids: [node('Starter tier monthly price').id, node('Starter subscribers').id], stated_in_brief: false });
    expect(node('Starter subscribers').observed_state).toMatchObject({ value: 0, source: 'cee_inference' });
  });

  it('RED (the licence\'s own walk): once ISL evaluates the product, no compared path holds a link nobody sized', async () => {
    const { graph, node } = await build(draft7());
    const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => n.id as string);
    expect(unsizedLeaderGoalPaths(graph, options).length, 'before evaluation: the two links are still unsized').toBeGreaterThan(0);
    expect(unsizedLeaderGoalPaths(graph, options, [{ node_id: node('Starter-tier MRR').id, evaluated: true }])).toEqual([]);
  });

  it('CONTROL (Science mutant: a point option level): Launch SETS the subscribers to one figure — no product; the range must survive', async () => {
    const { node } = await build(draft7({ pointCount: true }));
    expect(node('Starter-tier MRR').nonlinear_identity).toBeUndefined();
  });

  it('CONTROL: a rate whose denominator does not name the count ("GBP per month") is no proof — no product', async () => {
    const { node } = await build(draft7({ priceUnit: 'GBP per month' }));
    expect(node('Starter-tier MRR').nonlinear_identity).toBeUndefined();
  });

  it('CONTROL: an option level the brief never writes (£59) is not the user\'s — no product', async () => {
    const { node } = await build(draft7({ price: 59 }));
    expect(node('Starter-tier MRR').nonlinear_identity).toBeUndefined();
  });
});
