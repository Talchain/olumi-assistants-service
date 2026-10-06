/**
 * ⭐ G1b ON REAL DRAFTS (DL 0df0e1 bench, 6 Oct): two construction defects that kept the first Run's per-option chances
 * withheld on a brief that states every figure on the MRR path. Every row is a real draft (`fixtures/g1b-price-count-
 * pass-through.json`, provenance inside), bound by node and link ids and the exact unit strings.
 *
 *  · PRICE × COUNT (2), 3 of the bench's 23 price × count drafts: the rate "£ per starter subscriber per month" was never
 *    read as money (the shared currency reader takes ONE word after "per"), and its qualifier lives in the count's label
 *    (‘Starter subscribers’, counted in "subscribers"). So ‘Starter-tier MRR’ stayed two added links for the user to size.
 *    Now it is Olumi's product of the two (`withRateCountProducts`), on the units' own proof.
 *    The point-set count (Science (A) #87 6008551439: "A point 150 gives Starter 100%, manufactured certainty") is NOT
 *    changed: an option that sets the count to one figure still gets no product until the user's range rides with it.
 *  · PASS-THROUGH, raw draw a37cb d1: the drafter's definition ‘MRR lost to price-rise churn’ → MRR (−£1 per £1) sat on a
 *    £500,000 frame against MRR's £187,500, |β| 2.67, so it was set aside as a placeholder and asked. Now the part is
 *    measured on its total's frame and the definition is typed (`admit-model.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { EdgeV3, NodeV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, any>;
interface RealDraft { case_id: string; graph_sha12: string; brief_sha12: string; brief: string; candidate: Rec }
const FX = JSON.parse(readFileSync(new URL('./fixtures/g1b-price-count-pass-through.json', import.meta.url), 'utf8')) as {
  price_count: RealDraft[]; point_count: RealDraft; pass_through: { brief: string; response_text: string };
};

async function build(wire: string, brief: string): Promise<{ graph: Rec; node: (label: string) => Rec; edge: (from: string, to: string) => Rec }> {
  let registered: Rec | null = null;
  const call = (async () => ({ text: wire })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('6b1b0000-0000-4000-8000-00000000a37c', brief, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const graph = registered!;
  // As a reload reads them back (`NodeV3` / `EdgeV3`).
  const node = (label: string): Rec => {
    const n = (graph.nodes as Rec[]).find((x) => x.label === label);
    expect(n, `node ‘${label}’`).toBeDefined();
    return NodeV3.parse(n) as Rec;
  };
  const edge = (from: string, to: string): Rec => {
    const e = (graph.edges as Rec[]).find((x) => x.from === node(from).id && x.to === node(to).id);
    expect(e, `edge ‘${from}’ → ‘${to}’`).toBeDefined();
    return EdgeV3.parse(e) as Rec;
  };
  return { graph, node, edge };
}

/** Each real draft's product, by the labels its stored graph carries. */
const PRODUCTS: Record<string, { outcome: string; rate: string; count: string }> = {
  'acc__g1-2633-predup-overlapMC_draft-1__52d4d576': { outcome: 'Starter-tier MRR', rate: 'Starter monthly price', count: 'Starter subscribers' },
  'acc__g1-2633s_draft-4__e7b8ee26': { outcome: 'Starter-tier monthly recurring revenue', rate: 'Starter-tier price', count: 'Starter subscribers' },
  'acc__g1-2633t_draft-3__72af3e85': { outcome: 'Starter tier monthly recurring revenue', rate: 'Starter tier price', count: 'Starter subscribers' },
};
const RATE_UNIT = '£ per starter subscriber per month';

describe('price × count (2): a rate per a QUALIFIED count is Olumi\'s product, on real drafts', () => {
  it.each(FX.price_count.map((d) => [d.case_id, d] as const))('RED (%s): the outcome is Olumi\'s product of the rate × the count, by id', async (_id, d) => {
    const p = PRODUCTS[d.case_id]!;
    expect(d.candidate.factors.find((f: Rec) => f.label === p.rate)?.unit, 'the drafted rate unit, exactly').toBe(RATE_UNIT);
    expect(d.candidate.outcomes.find((o: Rec) => o.label === p.count)?.unit, 'the count is counted in its noun alone').toBe('subscribers');
    const { node } = await build(JSON.stringify(d.candidate), d.brief);
    expect(node(p.outcome).nonlinear_identity).toEqual({ operation: 'product', factor_ids: [node(p.rate).id, node(p.count).id], stated_in_brief: false });
    // The count is fed by a link, never set to one figure: its spread survives (Science (A)).
    const launch = (d.candidate.options as Rec[]).find((o) => o.label === 'Launch starter tier')!;
    expect((launch.interventions as Rec[]).map((i) => i.factor_label)).not.toContain(p.count);
  });

  it('CONTROL (Science (A), real draft fa9f d8): Launch SETS the count to one figure (150) — still no product', async () => {
    const d = FX.point_count;
    expect((d.candidate.options as Rec[]).find((o) => o.label === 'Launch starter tier')!.interventions.map((i: Rec) => `${i.factor_label}=${i.value}`))
      .toContain('Starter subscribers=150');
    const { node } = await build(JSON.stringify(d.candidate), d.brief);
    expect(node('Starter-tier monthly recurring revenue').nonlinear_identity).toBeUndefined();
  });

  it('CONTROL: the brief does not state the starter price — the same real draft gets no product', async () => {
    const d = FX.price_count[1]!;
    const p = PRODUCTS[d.case_id]!;
    const brief = d.brief.replace(', launch a starter tier at £49 a month,', ', launch a starter tier,')
      .replace(' Each starter subscriber adds £49 a month to monthly recurring revenue.', '');
    expect(brief).not.toContain('£49');
    const { node } = await build(JSON.stringify(d.candidate), brief);
    expect(node(p.outcome).nonlinear_identity).toBeUndefined();
  });

  it('CONTROL: a count whose label names another noun than its unit (counted in "customers") is not the rate\'s count — no product', async () => {
    const d = FX.price_count[1]!;
    const p = PRODUCTS[d.case_id]!;
    const candidate = structuredClone(d.candidate);
    (candidate.outcomes as Rec[]).find((o) => o.label === p.count)!.unit = 'customers';
    const { node } = await build(JSON.stringify(candidate), d.brief);
    expect(node(p.outcome).nonlinear_identity).toBeUndefined();
  });
});

describe('pass-through: a drafted definition is typed on its total\'s frame (raw draw a37cb d1)', () => {
  const PART = 'MRR lost to price-rise churn';
  const GOAL = 'monthly recurring revenue';

  it('RED: ‘MRR lost to price-rise churn’ → MRR is the definition (−£1 per £1), every user size keeps its natural size, nothing is cut', async () => {
    const drafted = (JSON.parse(FX.pass_through.response_text).links as Rec[]).find((l) => l.from === PART && l.to === GOAL)!;
    expect(drafted).toMatchObject({ effect_amount: -1, effect_per_source_change: 1, definitional: true });
    const { graph, node, edge } = await build(FX.pass_through.response_text, FX.pass_through.brief);
    const def = edge(PART, GOAL);
    expect(def.provenance).toMatchObject({ magnitude: 'olumi_estimate', definitional: true,
      natural_effect: { amount: -1, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '£/month' } });
    expect(def.strength.mean).toBe(-1);
    const natural = (from: string, to: string): Rec => {
      const e = edge(from, to);
      return { magnitude: e.provenance.magnitude, amount: e.provenance.natural_effect?.amount, per: e.provenance.natural_effect?.per_source_change };
    };
    expect(natural('Price rise from current price', GOAL)).toEqual({ magnitude: 'user_stated', amount: 1200, per: 1 });
    expect(natural('Price rise from current price', 'Customers lost from price rise')).toEqual({ magnitude: 'user_stated', amount: 2, per: 1 });
    expect(natural('Customers lost from price rise', PART)).toEqual({ magnitude: 'user_stated', amount: 300, per: 1 });
    expect(natural('Starter subscribers', GOAL)).toEqual({ magnitude: 'user_stated', amount: 49, per: 1 });
    expect((graph.edges as Rec[]).filter((e) => e.provenance?.clamped_from !== undefined || Math.abs(e.strength?.mean ?? 0) > 1)).toEqual([]);
    // The licence's own walk: no compared path holds a link nobody sized.
    const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => n.id as string);
    expect(unsizedLeaderGoalPaths(graph, options)).toEqual([]);
    expect(node(PART).id).toBe('mrr_lost_to_price_rise_churn');
  });

  it('CONTROL: an Olumi size into the part (£250 per customer, no brief figure) that the narrower frame would push past ±1 — the part keeps its frame, Olumi\'s size is kept, the definition is asked as before', async () => {
    const response = JSON.parse(FX.pass_through.response_text) as Rec;
    const into = (response.links as Rec[]).find((l) => l.from === 'Customers lost from price rise' && l.to === PART)!;
    Object.assign(into, { effect_amount: 250, provenance: 'inferred', effect_provenance: 'inferred' });
    const { node, edge } = await build(JSON.stringify(response), FX.pass_through.brief);
    expect(node(PART).scale_frame).toBe(500000);
    expect(edge('Customers lost from price rise', PART).provenance).toMatchObject({ magnitude: 'olumi_estimate', natural_effect: { amount: 250, per_source_change: 1 } });
    expect(edge(PART, GOAL).provenance.magnitude).toBe('olumi_placeholder');
    expect(edge(PART, GOAL).provenance.definitional).toBeUndefined();
  });
});
