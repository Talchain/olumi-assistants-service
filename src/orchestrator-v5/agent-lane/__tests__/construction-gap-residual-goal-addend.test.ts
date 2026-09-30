/**
 * ⛔ OLUMI'S GAP RESIDUAL IS NOT A REVENUE STREAM: it is taken out, said, and the card applies (R3 #75 5904253749, served
 * `ef042ce` m0 `c8108752`; AIQ 5904262145 + 5904406904; DL 5904403673).
 *
 * m0: MRR's parents were the user's £49 and 1,500 plus Olumi's "non-Pro MRR" £1,500/month — exactly £75,000 − £49 × 1,500.
 * Three parents: no product reading, no card, and Run 1 stated an additive "£59 → £75.0k–£78.4k".
 * WIRE rows: `D0` is a real drafter answer (constructor brief, OpenAI, CEE `ef042ce`, MG SUCCESSOR's arm d0), and
 * `OTHER_MRR` is the drafter's own residual factor + link verbatim (MG's arm, base draft-0). Real path: strict candidate →
 * `buildModelFromBrief` → the `/graph/register` body.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import { applyIdentityConfirmEdit, identityConfirmReadingToken } from '../../system-events/identity-confirm-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const BRIEF = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. '
  + 'Monthly churn must stay below 5%, and we want MRR above £85k within a year.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

const D0: Json = {"goal":{"metric":"MRR","operator":">","target_stated":true,"value":85000,"unit":"£/month","horizon_months":12,"provenance":"explicit","frame":"level","baseline_known":true,"baseline_value":75000,"baseline_provenance":"explicit","scope":{"modelled":"the Pro plan only","alternative":"all plans together","stated_in_brief":false}},"constraints":[{"metric":"Monthly churn","operator":"<","value":5,"unit":"%","provenance":"explicit","frame":"level"}],"options":[{"label":"Keep Pro at £49","provenance":"inferred","changes":[],"interventions":[],"is_status_quo":true},{"label":"Raise Pro to £59","provenance":"explicit","changes":[],"interventions":[{"factor_label":"Pro plan monthly price","value":59,"value_kind":"absolute","unit":"£/subscriber/month","provenance":"explicit"}],"is_status_quo":null},{"label":"Raise Pro to £54","provenance":"ai_proposed","changes":[],"interventions":[{"factor_label":"Pro plan monthly price","value":54,"value_kind":"absolute","unit":"£/subscriber/month","provenance":"ai_proposed"}],"is_status_quo":null}],"factors":[{"label":"Pro plan monthly price","role":"controllable","baseline_known":true,"baseline_value":49,"unit":"£/subscriber/month","provenance":"explicit","plausible_max":200},{"label":"Paying subscribers","role":"observable","baseline_known":true,"baseline_value":1500,"unit":"subscribers","provenance":"explicit","plausible_max":5000},{"label":"Monthly churn","role":"observable","baseline_known":false,"baseline_value":3.5,"unit":"%","provenance":"ai_proposed","plausible_max":100},{"label":"Monthly new paying subscribers","role":"observable","baseline_known":false,"baseline_value":100,"unit":"subscribers/month","provenance":"ai_proposed","plausible_max":1000}],"risks":[],"outcomes":[],"links":[{"from":"Pro plan monthly price","to":"MRR","direction":"positive","provenance":"ai_proposed","effect_amount":1500,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Paying subscribers","to":"MRR","direction":"positive","provenance":"inferred","effect_amount":49,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Pro plan monthly price","to":"Monthly churn","direction":"positive","provenance":"ai_proposed","effect_amount":0.08,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Monthly churn","to":"Paying subscribers","direction":"negative","provenance":"ai_proposed","effect_amount":-180,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Monthly new paying subscribers","to":"Paying subscribers","direction":"positive","provenance":"ai_proposed","effect_amount":12,"effect_per_source_change":1,"effect_provenance":"ai_proposed"}],"identities":[],"unknowns":["Does “MRR” mean Pro-plan MRR only or MRR across all plans? The model provisionally measures the Pro plan only.","What is current Monthly churn? The provisional 3.5% estimate is needed to check the below-5% constraint.","What is the current monthly rate of new paying subscribers? The provisional estimate is 100 subscribers/month.","How much would each £1/month Pro price increase change Monthly churn? The provisional estimate is +0.08 percentage points per £1.","£49 multiplied by 1,500 paying subscribers equals £73,500/month, while stated MRR is £75,000/month. Are discounts, annual-plan normalisation, add-ons, or non-Pro revenue responsible for the difference?"],"decision_question":"Should we raise our Pro plan price from £49 to £59 a month?"};
const OTHER_MRR: { f: Json; l: Json } = {"f": {"label": "Other MRR", "role": "external", "baseline_known": false, "baseline_value": 1500, "unit": "\u00a3/month", "provenance": "inferred", "plausible_max": 50000}, "l": {"from": "Other MRR", "to": "MRR", "direction": "positive", "provenance": "inferred", "effect_amount": 1, "effect_per_source_change": 1, "effect_provenance": "ai_proposed"}};

/** D0 with the drafter's residual beside the user's two parts (the m0 shape). */
function m0(edit: (c: Json) => void = () => {}): CandidateModel {
  const c: Json = structuredClone(D0);
  c.factors.push(structuredClone(OTHER_MRR.f));
  c.links.push(structuredClone(OTHER_MRR.l));
  edit(c);
  return c as unknown as CandidateModel;
}

async function build(model: CandidateModel, brief = BRIEF): Promise<{ graph: { nodes: Json[]; edges: Json[] }; out: Json }> {
  expect(strict(model), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('c8108752-0000-4000-8000-000000000001', brief, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: graph as { nodes: Json[]; edges: Json[] }, out };
}
const goalOf = (g: { nodes: Json[] }) => g.nodes.find((n) => n.kind === 'goal')!;
const labelsInto = (g: { nodes: Json[]; edges: Json[] }) => g.edges.filter((e) => e.to === goalOf(g).id)
  .map((e) => String(g.nodes.find((n) => n.id === e.from)?.label)).sort();
const residualNode = (g: { nodes: Json[] }) => g.nodes.find((n) => n.label === 'Other MRR' || n.description === 'Other MRR');
const said = (out: Json): string => JSON.stringify(out);

describe('Olumi’s gap residual beside the user’s price × subscribers is taken out and said; the card applies (m0 c8108752)', () => {
  it('PREMISE: the wire shape — D0 reads as price × subscribers with a card; the residual added makes three parents', async () => {
    const plain = await build(D0 as unknown as CandidateModel);
    expect(proposeProductIdentity(plain.graph)).not.toBeNull();
    const c = m0() as unknown as Json;
    expect(c.links.filter((l: Json) => l.to === 'MRR').map((l: Json) => l.from).sort()).toEqual(['Other MRR', 'Paying subscribers', 'Pro plan monthly price']);
    expect(c.identities).toEqual([]);
    expect(75000 - 49 * 1500).toBe(OTHER_MRR.f.baseline_value);
  });

  it('RED: the residual is taken out, the goal reads as the user’s price × subscribers, and the card is offered', async () => {
    const { graph } = await build(m0());
    expect(residualNode(graph)).toBeUndefined();
    expect(labelsInto(graph)).toEqual(['Paying subscribers', 'Pro plan monthly price']);
    expect(goalOf(graph).nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: false });
    const card = proposeProductIdentity(graph);
    expect(card).not.toBeNull();
    expect(card!.words).toContain('£73,500');
    expect(card!.words).toContain('close to your £75,000');
  });

  it('RED: the drop is SAID in the build’s own words (AIQ 5904406904), with the card’s figures', async () => {
    const { out } = await build(m0());
    expect(said(out)).toContain('I had added ‘Other MRR’ of £1,500 a month so that ‘MRR’ matched your £75,000; that was my guess');
    expect(said(out)).toContain('Your £49 × 1,500 = £73,500 is on the card for you to confirm.');
  });

  it('POST-YES (DL 5904403673): the Yes makes the goal the user\u2019s price × subscribers; the residual is not added back', async () => {
    const { graph } = await build(m0());
    const card = proposeProductIdentity(graph)!;
    const r = applyIdentityConfirmEdit({ persistedGraph: graph, outcome_id: card.outcome_id, factor_ids: card.factor_ids, words: card.words,
      expected_graph_hash: computeAnalysisAffectingGraphHash(graph as never), reading_token: identityConfirmReadingToken(card) });
    expect(r.kind).toBe('mutated');
    const after = (r as { mutatedGraph: { nodes: Json[]; edges: Json[] } }).mutatedGraph;
    expect(goalOf(after).nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: true });
    expect([...goalOf(after).nonlinear_identity.factor_ids].sort()).toEqual([...card.factor_ids].sort());
    expect(labelsInto(after)).toEqual(['Paying subscribers', 'Pro plan monthly price']);
    expect(residualNode(after)).toBeUndefined();
  });

  it('the line quotes the user\u2019s price as the card does: £49.99 is never said as £50 (AIQ 5904567773 follow-up 1)', async () => {
    const brief = BRIEF.replace('from £49 to £59', 'from £49.99 to £59');
    const model = m0((c) => {
      c.factors.find((f: Json) => f.label === 'Pro plan monthly price').baseline_value = 49.99;
      c.factors.find((f: Json) => f.label === 'Other MRR').baseline_value = 75000 - 49.99 * 1500;
    });
    const { graph, out } = await build(model, brief);
    expect(residualNode(graph)).toBeUndefined();
    expect(said(out)).toContain('Your £49.99 × 1,500 = £74,985 is on the card');
    expect(proposeProductIdentity(graph)!.words).toContain('£49.99 × 1,500 = £74,985');
  });

  it('CONTROL: an Olumi addend NOT equal to the gap stays, and there is no card', async () => {
    const { graph } = await build(m0((c) => { c.factors.find((f: Json) => f.label === 'Other MRR').baseline_value = 6000; }));
    expect(residualNode(graph)).toBeDefined();
    expect(labelsInto(graph)).toHaveLength(3);
    expect(proposeProductIdentity(graph)).toBeNull();
  });

  it('CONTROL: other revenue the USER states stays (their figure, their words)', async () => {
    const brief = BRIEF.replace('£75k MRR.', '£75k MRR, including £1,500 a month from other plans.');
    const { graph, out } = await build(m0((c) => { const f = c.factors.find((x: Json) => x.label === 'Other MRR'); f.provenance = 'explicit'; f.baseline_known = true; }), brief);
    expect(residualNode(graph)).toBeDefined();
    expect(said(out)).not.toContain('that was my guess');
  });

  it('CONTROL: money the brief WRITES at the residual\u2019s size stays, even tagged as Olumi\u2019s', async () => {
    const brief = BRIEF.replace('£75k MRR.', '£75k MRR, including £1,500 a month from other plans.');
    const { graph } = await build(m0(), brief);
    expect(residualNode(graph)).toBeDefined();
  });

  it('CONTROL: a residual with a cause of its own stays (it is modelled, not a plug)', async () => {
    const { graph } = await build(m0((c) => { c.links.push({ from: 'Monthly churn', to: 'Other MRR', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null }); }));
    expect(residualNode(graph)).toBeDefined();
  });

  it('CONTROL: a residual an option sets stays', async () => {
    const { graph } = await build(m0((c) => { c.options[0].interventions = [...(c.options[0].interventions ?? []), { factor_label: 'Other MRR', value: 2000, value_kind: 'absolute', unit: '£/month', provenance: 'ai_proposed' }]; }));
    expect(residualNode(graph)).toBeDefined();
  });

  it('CONTROL: the gap residual in another period (a year) stays', async () => {
    const { graph } = await build(m0((c) => { c.factors.find((f: Json) => f.label === 'Other MRR').unit = '£/year'; }));
    expect(residualNode(graph)).toBeDefined();
  });
});
