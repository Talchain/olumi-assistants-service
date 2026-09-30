/**
 * ⛔ A GOAL READ AS A TWO-PART PRODUCT GETS NO THIRD DIRECT PARENT (R3 #75 5902616543; DL 5902635867; MG successor
 * 5902710041).
 *
 * Signed-in, CEE `1f9d769`, scenario `ec51a31b` (the constructor brief): MRR carried Olumi's reading MRR = price ×
 * subscribers AND a direct `monthly_churn_rate → mrr` link (Olumi's estimate, −£735/month per churn point = 15
 * subscribers × £49). The card needs exactly two parents (`identity-proposal.ts:136`), so it never came: no Yes, no goal
 * chance, for the whole journey. And with MRR = price × subscribers, churn acts THROUGH subscribers: a direct link beside
 * the product misplaces it. Dropping it would erase the price rise's churn penalty from MRR (an optimistic false figure),
 * so an Olumi-sized extra parent is RE-POINTED to the volume operand, its size converted through the product at the
 * rate operand's level (−735 ÷ £49 = −15 subscribers per point), still Olumi's estimate, and said.
 * Real path: strict candidate → `buildModelFromBrief` → the `/graph/register` body.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { proposeProductIdentity } from '../identity-proposal.js';

type Json = Record<string, any>;
const BRIEF = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. '
  + 'Monthly churn must stay below 5%, and we want MRR above £85k within a year.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

const link = (from: string, to: string, direction: 'positive' | 'negative', amount: number | null = null, per: number | null = null, prov: string | null = null) =>
  ({ from, to, direction, provenance: 'inferred', effect_amount: amount, effect_per_source_change: per, effect_provenance: prov });

/** The `ec51a31b` shape: churn straight into MRR beside MRR = price × subscribers; no churn → subscribers link. */
function draft(edit: (c: Json) => void = () => {}): CandidateModel {
  const c: Json = {
    goal: { metric: 'Monthly recurring revenue', operator: '>', target_stated: true, frame: 'level', value: 85000, unit: 'GBP/month', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Monthly churn', operator: '<=', value: 5, unit: '%', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Raise to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP per subscriber per month', provenance: 'explicit' }] },
      { label: 'Keep £49', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP per subscriber per month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Paying subscribers', role: 'observable', baseline_known: true, baseline_value: 1500, unit: 'subscribers', provenance: 'explicit', plausible_max: 5000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [], outcomes: [],
    links: [
      link('Pro plan price', 'Monthly recurring revenue', 'positive'),
      link('Paying subscribers', 'Monthly recurring revenue', 'positive'),
      link('Pro plan price', 'Monthly churn', 'positive', 0.8, 10, 'ai_proposed'),
      link('Monthly churn', 'Monthly recurring revenue', 'negative', -735, 1, 'ai_proposed'),
    ],
    identities: [{ outcome: 'Monthly recurring revenue', operation: 'product', factors: ['Pro plan price', 'Paying subscribers'], provenance: 'inferred' }],
    unknowns: [], decision_question: null,
  };
  edit(c);
  return c as unknown as CandidateModel;
}

async function build(model: CandidateModel): Promise<{ graph: { nodes: Json[]; edges: Json[] }; out: Json }> {
  expect(strict(model), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('ec51a31b-0000-4000-8000-000000000001', BRIEF, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: graph as { nodes: Json[]; edges: Json[] }, out };
}
const goalOf = (g: { nodes: Json[] }) => g.nodes.find((n) => n.kind === 'goal')!;
const parentsOf = (g: { nodes: Json[]; edges: Json[] }) => g.edges.filter((e) => e.to === goalOf(g).id).map((e) => e.from).sort();
const idOf = (g: { nodes: Json[] }, label: string) => String(g.nodes.find((n) => n.label === label)!.id);
const edge = (g: { nodes: Json[]; edges: Json[] }, a: string, b: string) => g.edges.find((e) => e.from === idOf(g, a) && e.to === (b === 'GOAL' ? goalOf(g).id : idOf(g, b)));

describe('a goal read as price × subscribers gets no third direct parent', () => {
  it('PREMISE: the draft declares MRR = price × subscribers and links churn straight into MRR', () => {
    const c = draft() as unknown as Json;
    expect(c.identities[0].factors).toEqual(['Pro plan price', 'Paying subscribers']);
    expect(c.links.filter((l: Json) => l.to === 'Monthly recurring revenue').map((l: Json) => l.from)).toContain('Monthly churn');
  });

  it('ROW 1 (ec51a31b): churn acts through subscribers at −15 per point (−£735 ÷ £49), MRR keeps its two parts, the card is offered', async () => {
    const { graph, out } = await build(draft());
    expect(parentsOf(graph)).toEqual([idOf(graph, 'Paying subscribers'), idOf(graph, 'Pro plan price')].sort());
    expect(edge(graph, 'Monthly churn', 'GOAL')).toBeUndefined();
    const routed = edge(graph, 'Monthly churn', 'Paying subscribers');
    expect(routed).toBeDefined();
    expect(routed!.provenance?.natural_effect?.amount).toBeCloseTo(-15, 6);
    expect(routed!.provenance?.magnitude).toBe('olumi_estimate');
    expect(proposeProductIdentity(graph as never)?.factor_ids).toEqual([idOf(graph, 'Pro plan price'), idOf(graph, 'Paying subscribers')]);
    expect(((out.not_represented ?? []) as string[]).some((l) => l.includes('"Monthly churn"') && l.includes('"Paying subscribers"'))).toBe(true);
  });

  it('CONTROL (guest A shape: churn already acts through subscribers, no direct link): the edges are unchanged', async () => {
    const shape = (c: Json) => { c.links = c.links.filter((l: Json) => !(l.from === 'Monthly churn' && l.to === 'Monthly recurring revenue')); c.links.push(link('Monthly churn', 'Paying subscribers', 'negative', -15, 1, 'ai_proposed')); };
    const { graph } = await build(draft(shape));
    expect(parentsOf(graph)).toHaveLength(2);
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')?.provenance?.natural_effect?.amount).toBeCloseTo(-15, 6);
  });

  it('CONTROL (a double route: churn → subscribers AND churn → MRR): the direct link is taken out, and said', async () => {
    const { graph, out } = await build(draft((c) => { c.links.push(link('Monthly churn', 'Paying subscribers', 'negative', -15, 1, 'ai_proposed')); }));
    expect(parentsOf(graph)).toHaveLength(2);
    expect(edge(graph, 'Monthly churn', 'GOAL')).toBeUndefined();
    expect(((out.not_represented ?? []) as string[]).some((l) => l.includes('count it twice'))).toBe(true);
  });

  it('CONTROL (the user stated the churn → MRR size): nothing is re-pointed', async () => {
    const { graph } = await build(draft((c) => { c.links[3].effect_provenance = 'explicit'; }));
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')).toBeUndefined();
  });

  it('CONTROL (no size on the extra link): nothing is re-pointed (never an invented size)', async () => {
    const { graph } = await build(draft((c) => { c.links[3].effect_amount = null; c.links[3].effect_per_source_change = null; c.links[3].effect_provenance = null; }));
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')).toBeUndefined();
  });
});
