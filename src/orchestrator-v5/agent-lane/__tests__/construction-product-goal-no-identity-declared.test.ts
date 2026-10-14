/**
 * ⛔ A GOAL THE BRIEF'S OWN FIGURES RECONCILE AS A PRODUCT IS READ AS ONE EVEN WHEN THE DRAFT DECLARES NONE (R3 #75
 * 5903882132, guest `73192fdf` on served CEE `de0659f`; AIQ 5903896470; DL 5903903027).
 *
 * 1 in 5 constructor-brief drafts declared no product: MRR's parents were price (0.5), subscribers (0.5) and a direct
 * churn → MRR (Olumi's −£735/month per point). The mint (`withReconcilingProductIdentity`) needs exactly two parents, so it
 * declined; #2328 acts only on a goal read as a product; the card needs exactly two parents. No card, and Run 1 stated an
 * additive "£59 → ~£76.8k, 0% chance" where the user's own figures give £59 × 1,500 = £88.5k before churn — a false
 * figure. A third parent that #2328 re-points (a non-money factor, Olumi-sized, no route to either part) no longer hides
 * the reading: Olumi's inferred product is kept, churn acts through subscribers, and the card is offered.
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

async function build(model: CandidateModel, brief: string = BRIEF): Promise<{ graph: { nodes: Json[]; edges: Json[] }; out: Json }> {
  for (const f of model.factors) {
    if (!f.baseline_known || f.provenance !== 'explicit') continue;
    if (f.label === 'Pro plan price') f.baseline_evidence = { quote: 'Our Pro price is £49 per subscriber per month.' };
    if (f.label === 'Paying subscribers') f.baseline_evidence = { quote: 'We have 1,500 paying subscribers.' };
  }
  brief = `Our Pro price is £49 per subscriber per month. We have 1,500 paying subscribers.\n\n${brief}`;
  expect(strict(model), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('ec51a31b-0000-4000-8000-000000000001', brief, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: graph as { nodes: Json[]; edges: Json[] }, out };
}
const goalOf = (g: { nodes: Json[] }) => g.nodes.find((n) => n.kind === 'goal')!;
const parentsOf = (g: { nodes: Json[]; edges: Json[] }) => g.edges.filter((e) => e.to === goalOf(g).id).map((e) => e.from).sort();
const idOf = (g: { nodes: Json[] }, label: string) => String(g.nodes.find((n) => n.label === label)!.id);
const edge = (g: { nodes: Json[]; edges: Json[] }, a: string, b: string) => g.edges.find((e) => e.from === idOf(g, a) && e.to === (b === 'GOAL' ? goalOf(g).id : idOf(g, b)));

const noIdentity = (c: Json) => { c.identities = []; };
const goalIdentity = (g: { nodes: Json[] }) => goalOf(g).nonlinear_identity as Json | undefined;

describe('a goal the brief reconciles as price × subscribers is read as one when the draft declares no product (73192fdf)', () => {
  it('PREMISE: the 73192fdf shape — no identity, and churn straight into MRR beside price and subscribers', () => {
    const c = draft(noIdentity) as unknown as Json;
    expect(c.identities).toEqual([]);
    expect(c.links.filter((l: Json) => l.to === 'Monthly recurring revenue').map((l: Json) => l.from).sort())
      .toEqual(['Monthly churn', 'Paying subscribers', 'Pro plan price']);
  });

  it('RED (73192fdf): Olumi reads MRR as price × subscribers, churn acts through subscribers (−15/pt), the card is offered on £49 × 1,500', async () => {
    const { graph } = await build(draft(noIdentity));
    expect(goalIdentity(graph)).toBeDefined();
    expect(parentsOf(graph)).toEqual([idOf(graph, 'Paying subscribers'), idOf(graph, 'Pro plan price')].sort());
    expect(edge(graph, 'Monthly churn', 'GOAL')).toBeUndefined();
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')?.provenance?.natural_effect?.amount).toBeCloseTo(-15, 6);
    const card = proposeProductIdentity(graph as never);
    expect(card?.words).toContain('£49');
    expect(card?.words).toContain('1,500');
  });

  it('RED (P0 PARTNER 5904117525): the brief ALSO states churn ("3.5%") — three of the user\'s figures among the parents; the one reconciling pair is the product', async () => {
    const withChurn = `${BRIEF} Our monthly churn is 3.5%.`;
    const { graph } = await build(draft((c) => {
      noIdentity(c);
      Object.assign(c.factors.find((f: Json) => f.label === 'Monthly churn'), { baseline_known: true, baseline_value: 3.5, provenance: 'explicit',
        baseline_evidence: { quote: withChurn.slice(BRIEF.length).trim() } });
    }), withChurn);
    expect(goalIdentity(graph)).toBeDefined();
    expect(parentsOf(graph)).toEqual([idOf(graph, 'Paying subscribers'), idOf(graph, 'Pro plan price')].sort());
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')?.provenance?.natural_effect?.amount).toBeCloseTo(-15, 6);
    expect(proposeProductIdentity(graph as never)?.words).toContain('£49');
  });

  it('CONTROL (the identity-declared drafts, 4/4 served): unchanged — one product on the goal, the card offered', async () => {
    const { graph } = await build(draft());
    expect(goalIdentity(graph)).toBeDefined();
    expect(parentsOf(graph)).toHaveLength(2);
    expect(proposeProductIdentity(graph as never)?.words).toContain('£49');
  });

  it('CONTROL: a MONEY third parent (an addend in the goal\'s own terms) keeps today\'s refusal — no product minted', async () => {
    const { graph } = await build(draft((c) => {
      noIdentity(c);
      c.links = c.links.filter((l: Json) => !(l.from === 'Monthly churn' && l.to === 'Monthly recurring revenue'));
      // Not the gap (£75,000 − £49 × 1,500 = £1,500): a gap-sized Olumi residual is taken out and said instead
      // (`construction-gap-residual-goal-addend.test.ts`, AIQ 5904406904 / DL 5904403673). Any other money addend keeps the refusal.
      c.factors.push({ label: 'Other plan revenue', role: 'observable', baseline_known: false, baseline_value: 6000, unit: 'GBP/month', provenance: 'ai_proposed', plausible_max: 20000 });
      c.links.push(link('Other plan revenue', 'Monthly recurring revenue', 'positive', 1, 1, 'ai_proposed'));
    }));
    expect(goalIdentity(graph)).toBeUndefined();
  });

  it('CONTROL: a third parent the USER sized keeps today\'s refusal', async () => {
    const { graph } = await build(draft((c) => { noIdentity(c); c.links[3].effect_provenance = 'explicit'; }));
    expect(goalIdentity(graph)).toBeUndefined();
  });

  it('CONTROL (C46 rule 7): a third parent that ALSO reaches subscribers is an addend — no product minted', async () => {
    const { graph } = await build(draft((c) => { noIdentity(c); c.links.push(link('Monthly churn', 'Paying subscribers', 'negative', -15, 1, 'ai_proposed')); }));
    expect(goalIdentity(graph)).toBeUndefined();
  });

  it('CONTROL: an unsized third parent keeps today\'s refusal (never an invented size)', async () => {
    const { graph } = await build(draft((c) => { noIdentity(c); c.links[3].effect_amount = null; c.links[3].effect_per_source_change = null; c.links[3].effect_provenance = null; }));
    expect(goalIdentity(graph)).toBeUndefined();
  });
});
