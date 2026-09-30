/**
 * ⛔ A PRODUCT GOAL'S RATE IS THE USER'S OWN PRICE WHEN OLUMI'S RATE ONLY PASSES IT ON (shape 2; R3 #75 5902925902 /
 * 5902892629; AIQ 5902905975; DL 5902949807).
 *
 * Guest `afa332b2`, served CEE `f074916` (the constructor brief; `output/r3-successor-996ec64d/graph-afa332b2.json`): MRR
 * read as "Effective monthly revenue per subscriber" (Olumi's £50, `cee_inference`) × subscribers, with the user's £49
 * "Pro plan price" feeding that rate at exactly 1 per 1. The card needs the user's own figures on both parts, so it was
 * never offered — no Yes and no goal chance on journey 1. The rate is folded onto the user's price; Olumi's £50 is said as
 * a reading. Real path: strict candidate → `buildModelFromBrief` → the `/graph/register` body.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import { foldPassThroughRateOntoUsersPrice } from '../product-goal-rate-operand.js';

type Json = Record<string, any>;
const BRIEF = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. '
  + 'Monthly churn must stay below 5%, and we want MRR above £85k within a year.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
const RATE = 'Effective monthly revenue per subscriber';
const PRICE_UNIT = 'GBP per subscriber per month';

const link = (from: string, to: string, direction: 'positive' | 'negative', amount: number | null = null, per: number | null = null, prov: string | null = null) =>
  ({ from, to, direction, provenance: 'inferred', effect_amount: amount, effect_per_source_change: per, effect_provenance: prov });

/** The `afa332b2` shape: MRR = Olumi's rate × subscribers; the user's price feeds the rate at 1 per 1. */
function draft(edit: (c: Json) => void = () => {}): CandidateModel {
  const c: Json = {
    goal: { metric: 'Monthly recurring revenue', operator: '>', target_stated: true, frame: 'level', value: 85000, unit: 'GBP/month', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Monthly churn', operator: '<=', value: 5, unit: '%', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Raise to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: PRICE_UNIT, provenance: 'explicit' }] },
      { label: 'Keep £49', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: PRICE_UNIT, provenance: 'explicit', plausible_max: 200 },
      { label: RATE, role: 'observable', baseline_known: false, baseline_value: 50, unit: PRICE_UNIT, provenance: 'ai_proposed', plausible_max: 200 },
      { label: 'Paying subscribers', role: 'observable', baseline_known: true, baseline_value: 1500, unit: 'subscribers', provenance: 'explicit', plausible_max: 5000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [], outcomes: [],
    links: [
      link('Pro plan price', RATE, 'positive', 1, 1, 'ai_proposed'),
      link(RATE, 'Monthly recurring revenue', 'positive'),
      link('Paying subscribers', 'Monthly recurring revenue', 'positive'),
      link('Pro plan price', 'Monthly churn', 'positive', 0.3, 10, 'ai_proposed'),
      link('Monthly churn', 'Paying subscribers', 'negative', -15, 1, 'ai_proposed'),
    ],
    identities: [{ outcome: 'Monthly recurring revenue', operation: 'product', factors: [RATE, 'Paying subscribers'], provenance: 'inferred' }],
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
  const out = await buildModelFromBrief('afa332b2-0000-4000-8000-000000000001', BRIEF, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: graph as { nodes: Json[]; edges: Json[] }, out };
}
const goalOf = (g: { nodes: Json[] }) => g.nodes.find((n) => n.kind === 'goal')!;
const parentLabels = (g: { nodes: Json[]; edges: Json[] }) =>
  g.edges.filter((e) => e.to === goalOf(g).id).map((e) => g.nodes.find((n) => n.id === e.from)?.label).sort();
// A long label is shortened on the node and kept whole on its description (admission's `shortLabel`).
const hasNode = (g: { nodes: Json[] }, label: string) => g.nodes.some((n) => n.label === label || n.description === label);
const said = (out: Json) => ((out.not_represented ?? []) as string[]).find((l) => l.includes(`"${RATE}"`) && l.includes('only passed on'));

describe('a product goal\'s rate is the user\'s own price when Olumi\'s rate only passes it on (afa332b2)', () => {
  it('RED (afa332b2): MRR = the user\'s price × subscribers, Olumi\'s rate is gone, the card is offered on the user\'s figures, and £50 is said as a reading', async () => {
    const { graph: before } = await build(draft((c) => { c.links[0].effect_amount = 1.02; }));
    expect(hasNode(before, RATE)).toBe(true); // the probe sees the rate when it is there
    const { graph, out } = await build(draft());
    expect(parentLabels(graph)).toEqual(['Paying subscribers', 'Pro plan price']);
    expect(hasNode(graph, RATE)).toBe(false);
    const card = proposeProductIdentity(graph as never);
    expect(card?.words).toContain('£49');
    const s = said(out);
    expect(s, JSON.stringify(out.not_represented)).toMatch(/£50[^"]*my reading/);
    expect(s).toMatch(/your £49/);
  });

  it('CONTROL: a feed that is not exactly 1 per 1 is left as drafted (the rate stays, nothing said)', async () => {
    const { graph, out } = await build(draft((c) => { c.links[0].effect_amount = 1.02; }));
    expect(hasNode(graph, RATE)).toBe(true);
    expect(said(out)).toBeUndefined();
  });

  it('CONTROL: a rate the USER stated is theirs — never folded', async () => {
    const { graph } = await build(draft((c) => { Object.assign(c.factors[1], { provenance: 'explicit', baseline_known: true }); }));
    expect(hasNode(graph, RATE)).toBe(true);
  });

  it('CONTROL: a price that is Olumi\'s (£47, a figure the brief never states), not the user\'s, is never made the operand', async () => {
    const { graph } = await build(draft((c) => { Object.assign(c.factors[0], { provenance: 'ai_proposed', baseline_known: true, baseline_value: 47 }); }));
    expect(hasNode(graph, RATE)).toBe(true);
  });

  it('CONTROL: a second input to the rate (add-on revenue) means it is not a pass-through', async () => {
    const { graph } = await build(draft((c) => {
      c.factors.push({ label: 'Add-on revenue per subscriber', role: 'observable', baseline_known: false, baseline_value: 1, unit: PRICE_UNIT, provenance: 'ai_proposed', plausible_max: 50 });
      c.links.push(link('Add-on revenue per subscriber', RATE, 'positive', 1, 1, 'ai_proposed'));
    }));
    expect(hasNode(graph, RATE)).toBe(true);
  });

  it('CONTROL (the function itself; upstream also drops this identity): a rate in another currency is not the user\'s price', () => {
    const c = draft((m) => { m.factors[1].unit = 'USD per subscriber per month'; }) as unknown as Parameters<typeof foldPassThroughRateOntoUsersPrice>[0];
    const r = foldPassThroughRateOntoUsersPrice(c);
    expect(r.found).toEqual([]);
    expect(r.model).toBe(c);
  });

  it('CONTROL (MG 5903525530, the function itself): a rate in £k per subscriber is not the user\'s £ price — no fold across a scale', () => {
    const c = draft((m) => { m.factors[1].unit = '£k per subscriber per month'; }) as unknown as Parameters<typeof foldPassThroughRateOntoUsersPrice>[0];
    const r = foldPassThroughRateOntoUsersPrice(c);
    expect(r.found).toEqual([]);
    expect(r.model).toBe(c);
  });

  it('CONTROL (the function itself): the same pass-through in £ IS folded — the row above is decided by the currency alone', () => {
    const c = draft() as unknown as Parameters<typeof foldPassThroughRateOntoUsersPrice>[0];
    expect(foldPassThroughRateOntoUsersPrice(c).found.map((f) => f.price)).toEqual(['Pro plan price']);
  });

  it('CONTROL: an option that sets the rate itself keeps it', async () => {
    const { graph } = await build(draft((c) => { c.options[0].interventions.push({ factor_label: RATE, value: 60, value_kind: 'absolute', unit: PRICE_UNIT, provenance: 'ai_proposed' }); }));
    expect(hasNode(graph, RATE)).toBe(true);
  });
});
