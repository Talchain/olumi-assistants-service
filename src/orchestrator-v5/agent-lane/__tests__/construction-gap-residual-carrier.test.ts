/**
 * ⛔ m8: OLUMI'S GAP RESIDUAL BESIDE A CARRIER IS TAKEN OUT AND SAID; THE CARRIER CARD READS TODAY'S FIGURE (R3 #75
 * 5904253749 served `ef042ce` m8 `5c909daa`; AIQ 5904262145 + 5904406904; DL 5904403673).
 *
 * MRR = ‘Pro subscription MRR at month 12’ (Olumi's product of ‘Pro plan price’ × ‘Paying subscribers at month 12’, an
 * outcome with no level fed by the user's 1,500) + Olumi's ‘Other MRR’ £1,500 — exactly £75,000 − £49 × 1,500. #416
 * withheld honestly, but no card appeared at the draft or at Run 1, so the user had no route to a chance.
 * WIRE row: `M8` is a real drafter answer verbatim (constructor brief, OpenAI; MG's arm base draft-0). Real path: strict
 * candidate → `buildModelFromBrief` → the `/graph/register` body.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { proposeProductIdentity } from '../identity-proposal.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[] };
const BRIEF = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. '
  + 'Monthly churn must stay below 5%, and we want MRR above £85k within a year.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
const M8: Json = {"goal":{"metric":"MRR","operator":">","target_stated":true,"value":85000,"unit":"£/month","horizon_months":12,"provenance":"explicit","frame":"level","baseline_known":true,"baseline_value":75000,"baseline_provenance":"explicit","scope":{"modelled":"MRR across the business, assuming the 1,500 paying subscribers are on the Pro plan","alternative":"Pro plan MRR only","stated_in_brief":false}},"constraints":[{"metric":"Monthly churn","operator":"<","value":5,"unit":"%","provenance":"explicit","frame":"level"}],"options":[{"label":"Raise Pro price to £59","provenance":"explicit","changes":[],"interventions":[{"factor_label":"Pro plan price","value":59,"value_kind":"absolute","unit":"£ per subscriber per month","provenance":"explicit"}],"is_status_quo":null},{"label":"Keep current Pro price","provenance":"ai_proposed","changes":[],"interventions":[],"is_status_quo":true},{"label":"Raise Pro price to £54","provenance":"ai_proposed","changes":[],"interventions":[{"factor_label":"Pro plan price","value":54,"value_kind":"absolute","unit":"£ per subscriber per month","provenance":"ai_proposed"}],"is_status_quo":null}],"factors":[{"label":"Pro plan price","role":"controllable","baseline_known":true,"baseline_value":49,"unit":"£ per subscriber per month","provenance":"explicit","plausible_max":200},{"label":"Current paying subscribers","role":"observable","baseline_known":true,"baseline_value":1500,"unit":"subscribers","provenance":"explicit","plausible_max":5000},{"label":"Monthly churn","role":"observable","baseline_known":false,"baseline_value":4,"unit":"%","provenance":"ai_proposed","plausible_max":100},{"label":"Monthly subscriber acquisitions","role":"observable","baseline_known":false,"baseline_value":70,"unit":"subscribers per month","provenance":"ai_proposed","plausible_max":1000},{"label":"Other MRR","role":"external","baseline_known":false,"baseline_value":1500,"unit":"£/month","provenance":"inferred","plausible_max":50000}],"risks":[],"outcomes":[{"label":"Paying subscribers at month 12","provenance":"ai_proposed"},{"label":"Pro subscription MRR at month 12","provenance":"ai_proposed"}],"links":[{"from":"Pro plan price","to":"Monthly churn","direction":"positive","provenance":"ai_proposed","effect_amount":0.04,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Current paying subscribers","to":"Paying subscribers at month 12","direction":"positive","provenance":"ai_proposed","effect_amount":0.61,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Monthly churn","to":"Paying subscribers at month 12","direction":"negative","provenance":"ai_proposed","effect_amount":-170,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Monthly subscriber acquisitions","to":"Paying subscribers at month 12","direction":"positive","provenance":"ai_proposed","effect_amount":9.4,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Pro plan price","to":"Pro subscription MRR at month 12","direction":"positive","provenance":"ai_proposed","effect_amount":1575,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Paying subscribers at month 12","to":"Pro subscription MRR at month 12","direction":"positive","provenance":"ai_proposed","effect_amount":49,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Pro subscription MRR at month 12","to":"MRR","direction":"positive","provenance":"ai_proposed","effect_amount":1,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Other MRR","to":"MRR","direction":"positive","provenance":"inferred","effect_amount":1,"effect_per_source_change":1,"effect_provenance":"ai_proposed"}],"identities":[{"outcome":"Pro subscription MRR at month 12","operation":"product","factors":["Pro plan price","Paying subscribers at month 12"],"provenance":"ai_proposed"}],"unknowns":["Does “MRR” mean total business MRR or Pro plan MRR only? The model provisionally treats it as total business MRR, with the 1,500 subscribers assumed to be Pro subscribers.","The current monthly churn rate was not provided. The provisional 4% estimate is below the 5% limit and must be replaced with the observed rate.","Monthly subscriber acquisitions were not provided. The provisional estimate is 70 subscribers per month and materially affects month-12 subscriber count.","The £75k MRR exceeds £49 × 1,500 subscribers (£73.5k). The model provisionally treats the £1.5k difference as Other MRR; confirm whether this is add-on, non-Pro, discounted, or other revenue.","The estimated price sensitivity assumes each £1 monthly price increase raises monthly churn by 0.04 percentage points. Validate this using historical pricing, cohorts, or a controlled test."],"decision_question":"Should we raise our Pro plan price from £49 to £59 a month?"};

const m8 = (edit: (c: Json) => void = () => {}): CandidateModel => { const c = structuredClone(M8); edit(c); return c as unknown as CandidateModel; };

async function build(model: CandidateModel, brief = BRIEF): Promise<{ graph: Graph; out: Json }> {
  expect(strict(model), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('5c909daa-0000-4000-8000-000000000001', brief, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: graph as Graph, out };
}
const goalOf = (g: Graph) => g.nodes.find((n) => n.kind === 'goal')!;
const labelsInto = (g: Graph, id: string) => g.edges.filter((e) => e.to === id).map((e) => String(g.nodes.find((n) => n.id === e.from)?.label)).sort();
const residualNode = (g: Graph) => g.nodes.find((n) => n.label === 'Other MRR');
const carrierOf = (g: Graph) => g.nodes.find((n) => n.label === 'Pro subscription MRR at month 12')!;

describe('Olumi’s gap residual beside a carrier is taken out and said; the carrier card reads today’s 1,500 (m8 5c909daa)', () => {
  it('PREMISE: the wire shape — MRR = the carrier + Olumi’s £1,500, and the carrier’s count has no level', () => {
    expect(M8.links.filter((l: Json) => l.to === 'MRR').map((l: Json) => l.from).sort()).toEqual(['Other MRR', 'Pro subscription MRR at month 12']);
    expect(M8.identities).toEqual([expect.objectContaining({ outcome: 'Pro subscription MRR at month 12', operation: 'product', factors: ['Pro plan price', 'Paying subscribers at month 12'] })]);
    expect(M8.outcomes.map((o: Json) => o.label)).toContain('Paying subscribers at month 12');
    expect(75000 - 49 * 1500).toBe(M8.factors.find((f: Json) => f.label === 'Other MRR').baseline_value);
  });

  /**
   * S7 disposition `pending_b5_neighbour_bound` (AIE quantity contract). The user's "1,500 paying subscribers" is refused by the
   * receipt gate's next-sentence bound check ("…must stay below 5%, and we want MRR above £85k within a year": B5, split out
   * to its follow-up PR) and "£49" is written in a question with no per-subscriber period. Neither level is VERIFIED, so
   * Olumi's £1,500 plug stays Olumi's, no card is offered and nothing claims one: the drop is said only when the card is real.
   * B5 restores the three rows below to their original assertions.
   */
  it('RED: with the levels unverified (B5) the residual stays Olumi\u2019s and no carrier card is offered', async () => {
    const { graph } = await build(m8());
    expect(residualNode(graph)).toBeDefined();
    expect(labelsInto(graph, goalOf(graph).id)).toEqual(expect.arrayContaining(['Other MRR']));
    expect(proposeProductIdentity(graph)).toBeNull();
  });

  it('RED: nothing says the figures are on a card that is not offered, and the plug is not said dropped', async () => {
    const { out } = await build(m8());
    expect(JSON.stringify(out)).not.toContain('is on the card for you to confirm');
    expect(JSON.stringify(out)).not.toContain('I had added ‘Other MRR’ of £1,500 a month');
  });

  it('POST-YES: no card is reachable while the levels are unverified, so no reading can be recorded from the carrier', async () => {
    const { graph } = await build(m8());
    expect(proposeProductIdentity(graph)).toBeNull();
    expect(residualNode(graph)).toBeDefined();
    expect(carrierOf(graph).nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: false });
  });

  // The carrier over the user's TWO own levels + Olumi's plug is NOT this rule's: MG's class-2 fold (goal-product-carrier.ts,
  // AIQ 5888943993 (1)) already folds that carrier into the goal and leaves the plug out, in its own words. This row guards
  // that the two never both act, and that the shape still reaches a card (the carrier card refuses beside a plug).
  it('the carrier over the user\u2019s TWO own levels + the plug: class 2 folds it, says so, and the card applies', async () => {
    const { graph, out } = await build(m8((c) => {
      c.identities = [{ outcome: 'Pro subscription MRR at month 12', operation: 'product', factors: ['Pro plan price', 'Current paying subscribers'], provenance: 'ai_proposed' }];
      c.links = c.links.filter((l: Json) => !(l.from === 'Paying subscribers at month 12' && l.to === 'Pro subscription MRR at month 12'));
      c.links.push({ from: 'Current paying subscribers', to: 'Pro subscription MRR at month 12', direction: 'positive', provenance: 'ai_proposed', effect_amount: 49, effect_per_source_change: 1, effect_provenance: 'ai_proposed' });
    }));
    expect(residualNode(graph)).toBeUndefined();
    expect(JSON.stringify(out)).toContain('‘Other MRR’ was Olumi\'s addition, and your figures don\'t need it');
    expect(JSON.stringify(out)).not.toContain('Its size was my guess');
    expect(proposeProductIdentity(graph)).not.toBeNull();
  });

  it('CONTROL: an Olumi addend beside the carrier that is NOT the gap stays', async () => {
    const { graph } = await build(m8((c) => { c.factors.find((f: Json) => f.label === 'Other MRR').baseline_value = 6000; }));
    expect(residualNode(graph)).toBeDefined();
  });

  it('CONTROL: a carrier with a cause beyond its two parts (churn straight in) is more than the product — the addend stays', async () => {
    const { graph } = await build(m8((c) => {
      c.links.push({ from: 'Monthly churn', to: 'Pro subscription MRR at month 12', direction: 'negative', provenance: 'ai_proposed', effect_amount: -500, effect_per_source_change: 1, effect_provenance: 'ai_proposed' });
    }));
    expect(residualNode(graph)).toBeDefined();
  });

  it('CONTROL: a carrier whose count has TWO user-levelled causes is not read at today’s level — the addend stays', async () => {
    const brief = BRIEF.replace('1,500 paying subscribers', '1,500 paying subscribers and 200 annual subscribers');
    const { graph } = await build(m8((c) => {
      c.factors.push({ label: 'Annual subscribers', role: 'observable', baseline_known: true, baseline_value: 200, unit: 'subscribers', provenance: 'explicit', plausible_max: 5000 });
      c.links.push({ from: 'Annual subscribers', to: 'Paying subscribers at month 12', direction: 'positive', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
    }), brief);
    expect(residualNode(graph)).toBeDefined();
  });
});
