/**
 * ⭐ A4u — A COUNT × A CONSTANT MONEY-PER-ONE IS THE PER-ONE LINK (DL #75 5924354666; R3 5924359227; MG 5924092611).
 *
 * Served `train-0258Z` (CEE eea49f5b, guest d1d22196): "Funding from investment firms" = "Investment-firm deals closed" ×
 * "Typical investment-firm funding per deal" (£1,000,000, the brief's figure), Olumi's product → PLoT withheld the goal's
 * figures and Paul's size was never used (R3 A4u FAIL, 2 of 2 drafts). This spec's draft carries that served shape.
 *
 * Real path: strict candidate schema → `buildModelFromBrief` (ONE scripted drafter call) → `/graph/register` → GraphV3.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { perOneLinksForConstantProducts } from '../per-one-product.js';
import type { CandidateModel } from '../admit-model.js';

type Rec = Record<string, any>;
const PAUL =
  "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it.';

const link = (from: string, to: string, size?: { amount: number; by: string }, definitional: boolean | null = null) => ({
  from, to, direction: 'positive', provenance: 'inferred',
  effect_amount: size?.amount ?? null, effect_per_source_change: size ? 1 : null, effect_provenance: size?.by ?? null, definitional,
});

/** The served 0258Z shape: two drafted products, each a deals count × a constant £-per-deal factor. */
function draft() {
  return {
    goal: { metric: 'Funding secured', operator: '>=', target_stated: false, frame: 'level', value: null, unit: 'GBP', horizon_months: 2,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null },
    constraints: [],
    options: [
      { label: 'Continue investment-firm outreach', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Angel outreach pilot', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Hours per week on angel outreach', value: 5, value_kind: 'absolute', unit: 'hours/week', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'Hours per week on investment-firm outreach', role: 'controllable', baseline_known: true, baseline_value: 15, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 60 },
      { label: 'Hours per week on angel outreach', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 40 },
      { label: 'Typical investment-firm funding per deal', role: 'external', baseline_known: true, baseline_value: 1000000, unit: 'GBP per deal', provenance: 'explicit', plausible_max: 2000000 },
      { label: 'Typical angel funding per deal', role: 'external', baseline_known: true, baseline_value: 100000, unit: 'GBP per deal', provenance: 'ai_proposed', plausible_max: 500000 },
    ],
    risks: [],
    outcomes: [
      { label: 'Investment-firm deals closed', provenance: 'inferred', unit: 'deals', plausible_max: 5 },
      { label: 'Angel deals closed', provenance: 'inferred', unit: 'deals', plausible_max: 10 },
      { label: 'Funding from investment firms', provenance: 'inferred', unit: 'GBP', plausible_max: 3000000 },
      { label: 'Funding from angel investors', provenance: 'inferred', unit: 'GBP', plausible_max: 1000000 },
    ],
    links: [
      link('Hours per week on investment-firm outreach', 'Investment-firm deals closed', { amount: 0.05, by: 'ai_proposed' }),
      link('Hours per week on angel outreach', 'Angel deals closed', { amount: 0.1, by: 'ai_proposed' }),
      link('Investment-firm deals closed', 'Funding from investment firms'),
      link('Typical investment-firm funding per deal', 'Funding from investment firms'),
      link('Angel deals closed', 'Funding from angel investors'),
      link('Typical angel funding per deal', 'Funding from angel investors'),
      link('Funding from investment firms', 'Funding secured', { amount: 1, by: 'ai_proposed' }, true),
      link('Funding from angel investors', 'Funding secured', { amount: 1, by: 'ai_proposed' }, true),
    ],
    identities: [
      { outcome: 'Funding from investment firms', operation: 'product', factors: ['Investment-firm deals closed', 'Typical investment-firm funding per deal'], provenance: 'ai_proposed' },
      { outcome: 'Funding from angel investors', operation: 'product', factors: ['Angel deals closed', 'Typical angel funding per deal'], provenance: 'ai_proposed' },
    ],
    unknowns: [], decision_question: null,
  };
}

async function build(d: Rec): Promise<Rec> {
  let body: unknown = null;
  const call = (async () => ({ text: JSON.stringify(d) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('a4a4a4a4-0000-4a4a-8a4a-a4a4a4a4a4a5', PAUL, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
  return GraphV3.parse(body) as unknown as Rec;
}
const edge = (g: Rec, from: string, to: string): Rec | undefined => g.edges.find((e: Rec) => e.from === from && e.to === to);

describe('A4u: a count × a constant £-per-one is read as the per-one link', () => {
  it('RED (served 0258Z shape): £1,000,000 per deal is the USER\'s sized link with "£1-2 million" at its low end, no identity, writable', async () => {
    const { isEditableGraph } = await import('../../system-events/editable-graph.js');
    const g = await build(draft());
    const deal = edge(g, 'investment_firm_deals_closed', 'funding_from_investment_firms');
    if (process.env.PROBE) throw new Error(JSON.stringify({ deal, edges: g.edges.filter((e: Rec) => e.to === 'funding_from_investment_firms'), nodes: g.nodes.filter((x: Rec) => /investment|deal/.test(x.id)).map((x: Rec) => [x.id, x.kind, x.scale_frame, x.observed_state]) }));
    expect(deal?.provenance?.magnitude).toBe('user_stated');
    expect(deal?.provenance?.natural_effect?.amount).toBe(1000000);
    expect(deal?.provenance?.natural_effect?.per_source_change).toBe(1);
    expect(deal?.provenance?.natural_effect?.stated_range?.text).toBe('£1-2 million');
    expect(Math.abs(deal!.strength.mean)).toBeLessThanOrEqual(1);
    expect(g.nodes.find((n: Rec) => n.id === 'funding_from_investment_firms')?.nonlinear_identity).toBeUndefined();
    expect(g.nodes.some((n: Rec) => n.id === 'typical_investment_firm_funding_per_deal')).toBe(false);
    expect(isEditableGraph(g)).toBe(true);
  });

  it('Olumi\'s own £100,000 per angel deal becomes Olumi\'s sized link — never the user\'s', async () => {
    const g = await build(draft());
    const angel = edge(g, 'angel_deals_closed', 'funding_from_angel_investors');
    expect(angel?.provenance?.magnitude).not.toBe('user_stated');
    expect(g.nodes.find((n: Rec) => n.id === 'funding_from_angel_investors')?.nonlinear_identity).toBeUndefined();
  });
});

describe('controls: only a CONSTANT money-per-one in a two-quantity product is read as a link', () => {
  const base = draft() as unknown as CandidateModel;

  it('a per-one amount an OPTION sets (a price lever) keeps the product exactly as drafted', () => {
    const c = { ...base, options: [...base.options, { label: 'Raise deal size', provenance: 'ai_proposed', changes: [], is_status_quo: null,
      interventions: [{ factor_label: 'Typical investment-firm funding per deal', value: 1500000, value_kind: 'absolute', unit: 'GBP per deal', provenance: 'ai_proposed' }] }] } as unknown as CandidateModel;
    expect(perOneLinksForConstantProducts(c).identities!.map((i) => i.outcome)).toContain('Funding from investment firms');
  });

  it('a THREE-quantity product (served 0341Z: conversations × rate × average) is left exactly as drafted', () => {
    const c = { ...base, identities: [{ outcome: 'Funding from investment firms', operation: 'product',
      factors: ['Investment-firm deals closed', 'Typical angel funding per deal', 'Typical investment-firm funding per deal'], provenance: 'ai_proposed' }] } as unknown as CandidateModel;
    expect(perOneLinksForConstantProducts(c)).toBe(c);
  });

  it('a per-one factor with a cause of its own (a link INTO it) is not a constant: left as drafted', () => {
    const c = { ...base, identities: [base.identities![0]!],
      links: [...base.links, { from: 'Hours per week on investment-firm outreach', to: 'Typical investment-firm funding per deal', direction: 'positive', provenance: 'inferred' }] } as unknown as CandidateModel;
    expect(perOneLinksForConstantProducts(c)).toBe(c);
  });

  it('probe', () => {
    if (!process.env.PROBE) return;
    const r = perOneLinksForConstantProducts(draft() as unknown as CandidateModel);
    throw new Error(JSON.stringify({ ids: r.identities, links: r.links.filter((l) => /Funding from investment/.test(l.to)), f: r.factors.map((f) => f.label) }));
  });

  it('no product at all: the candidate itself', () => {
    const c = { ...base, identities: [] } as unknown as CandidateModel;
    expect(perOneLinksForConstantProducts(c)).toBe(c);
  });
});
