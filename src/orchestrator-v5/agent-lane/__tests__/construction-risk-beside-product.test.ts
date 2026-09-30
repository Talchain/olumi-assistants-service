/**
 * ⛔ OLUMI'S RISK STRAIGHT INTO A GOAL READ AS RATE × COUNT MOVES IT THROUGH THE COUNT, AND IT IS SAID (AIQ 5906371639; R3
 * share-build `b3d11a92`: "Customer backlash" → MRR beside MRR = price × subscribers, so no card).
 * WIRE base: `D0` is a real drafter answer (constructor brief, OpenAI, CEE `ef042ce`); the risk and its links are the
 * served `b3d11a92` shape (price → backlash, backlash → MRR, Olumi's, unsized). Real path: `buildModelFromBrief`.
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
const D0: Json = {"goal":{"metric":"MRR","operator":">","target_stated":true,"value":85000,"unit":"£/month","horizon_months":12,"provenance":"explicit","frame":"level","baseline_known":true,"baseline_value":75000,"baseline_provenance":"explicit","scope":{"modelled":"the Pro plan only","alternative":"all plans together","stated_in_brief":false}},"constraints":[{"metric":"Monthly churn","operator":"<","value":5,"unit":"%","provenance":"explicit","frame":"level"}],"options":[{"label":"Keep Pro at £49","provenance":"inferred","changes":[],"interventions":[],"is_status_quo":true},{"label":"Raise Pro to £59","provenance":"explicit","changes":[],"interventions":[{"factor_label":"Pro plan monthly price","value":59,"value_kind":"absolute","unit":"£/subscriber/month","provenance":"explicit"}],"is_status_quo":null},{"label":"Raise Pro to £54","provenance":"ai_proposed","changes":[],"interventions":[{"factor_label":"Pro plan monthly price","value":54,"value_kind":"absolute","unit":"£/subscriber/month","provenance":"ai_proposed"}],"is_status_quo":null}],"factors":[{"label":"Pro plan monthly price","role":"controllable","baseline_known":true,"baseline_value":49,"unit":"£/subscriber/month","provenance":"explicit","plausible_max":200},{"label":"Paying subscribers","role":"observable","baseline_known":true,"baseline_value":1500,"unit":"subscribers","provenance":"explicit","plausible_max":5000},{"label":"Monthly churn","role":"observable","baseline_known":false,"baseline_value":3.5,"unit":"%","provenance":"ai_proposed","plausible_max":100},{"label":"Monthly new paying subscribers","role":"observable","baseline_known":false,"baseline_value":100,"unit":"subscribers/month","provenance":"ai_proposed","plausible_max":1000}],"risks":[],"outcomes":[],"links":[{"from":"Pro plan monthly price","to":"MRR","direction":"positive","provenance":"ai_proposed","effect_amount":1500,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Paying subscribers","to":"MRR","direction":"positive","provenance":"inferred","effect_amount":49,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Pro plan monthly price","to":"Monthly churn","direction":"positive","provenance":"ai_proposed","effect_amount":0.08,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Monthly churn","to":"Paying subscribers","direction":"negative","provenance":"ai_proposed","effect_amount":-180,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Monthly new paying subscribers","to":"Paying subscribers","direction":"positive","provenance":"ai_proposed","effect_amount":12,"effect_per_source_change":1,"effect_provenance":"ai_proposed"}],"identities":[],"unknowns":["Does “MRR” mean Pro-plan MRR only or MRR across all plans? The model provisionally measures the Pro plan only.","What is current Monthly churn? The provisional 3.5% estimate is needed to check the below-5% constraint.","What is the current monthly rate of new paying subscribers? The provisional estimate is 100 subscribers/month.","How much would each £1/month Pro price increase change Monthly churn? The provisional estimate is +0.08 percentage points per £1.","£49 multiplied by 1,500 paying subscribers equals £73,500/month, while stated MRR is £75,000/month. Are discounts, annual-plan normalisation, add-ons, or non-Pro revenue responsible for the difference?"],"decision_question":"Should we raise our Pro plan price from £49 to £59 a month?"};
const link = (from: string, to: string, direction: 'positive' | 'negative', extra: Json = {}) =>
  ({ from, to, direction, provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null, ...extra });

function m9(edit: (c: Json) => void = () => {}): CandidateModel {
  const c: Json = structuredClone(D0);
  c.identities = [{ outcome: 'MRR', operation: 'product', factors: ['Pro plan monthly price', 'Paying subscribers'], provenance: 'inferred' }];
  c.risks = [...(c.risks ?? []), { label: 'Customer backlash', provenance: 'ai_proposed' }];
  c.links.push(link('Pro plan monthly price', 'Customer backlash', 'positive'), link('Customer backlash', 'MRR', 'negative'));
  edit(c);
  return c as unknown as CandidateModel;
}
async function build(model: CandidateModel, brief: string = BRIEF): Promise<{ graph: Graph; out: Json }> {
  expect(strict(model), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('b3d11a92-0000-4000-8000-000000000001', brief, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: graph as Graph, out };
}
const idOf = (g: Graph, label: string) => g.nodes.find((n) => n.label === label)?.id;
const goalId = (g: Graph) => g.nodes.find((n) => n.kind === 'goal')!.id;
const edge = (g: Graph, from: string, to: string) => g.edges.some((e) => e.from === idOf(g, from) && e.to === (to === 'GOAL' ? goalId(g) : idOf(g, to)));

describe('Olumi’s risk straight into MRR = price × subscribers moves it through subscribers, said (b3d11a92)', () => {
  // R3 5906397501 / AIQ 5906413249 (a): D0 already carries the price's effect on subscribers through churn, which IS the
  // backlash mechanism, so re-pointing would count it a third time.
  it('RED (a): the price already reaches subscribers (via churn) → the direct link is dropped with the risk, said, and the card', async () => {
    const { graph, out } = await build(m9());
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(false);
    expect(edge(graph, 'Customer backlash', 'Paying subscribers')).toBe(false);
    // Left with no link out, admission would re-link it to MRR (risk repair); it goes, and the line names it.
    expect(idOf(graph, 'Customer backlash')).toBeUndefined();
    expect(JSON.stringify(out)).toContain('I had ‘Customer backlash’ moving ‘MRR’ directly; with ‘MRR’ read as ‘Pro plan monthly price’ × ‘Paying subscribers’, the effect of ‘Pro plan monthly price’ on ‘Paying subscribers’ is already in the model through ‘Monthly churn’, so I haven\'t added it again, and I\'ve taken ‘Customer backlash’ out of the model.');
    expect(proposeProductIdentity(graph)).not.toBeNull();
  });

  it('RED (b): with NO price → subscribers route, the unsized link is re-pointed to the count, said, and the card', async () => {
    const { graph, out } = await build(m9((c) => { c.links = c.links.filter((l: Json) => !(l.from === 'Pro plan monthly price' && l.to === 'Monthly churn')); }));
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(false);
    expect(edge(graph, 'Customer backlash', 'Paying subscribers')).toBe(true);
    expect(JSON.stringify(out)).toContain('I had ‘Customer backlash’ moving ‘MRR’ directly; with ‘MRR’ read as ‘Pro plan monthly price’ × ‘Paying subscribers’ it now moves ‘Paying subscribers’.');
    expect(proposeProductIdentity(graph)).not.toBeNull();
  });

  it('CONTROL (R3 5906615257): a risk the USER named (from_brief) is never removed — left as drafted, no card', async () => {
    const { graph } = await build(m9((c) => { c.risks.find((r: Json) => r.label === 'Customer backlash').provenance = 'explicit'; }));
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(true);
    expect(idOf(graph, 'Customer backlash')).toBeDefined();
    expect(proposeProductIdentity(graph)).toBeNull();
  });

  it('CONTROL (AIQ 5906624217 row 2): a risk whose words the BRIEF writes is the user’s — never removed, left as drafted, no card', async () => {
    const { graph } = await build(m9(), `${BRIEF} We are worried about customer backlash.`);
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(true);
    expect(idOf(graph, 'Customer backlash')).toBeDefined();
    expect(proposeProductIdentity(graph)).toBeNull();
  });

  it('CONTROL: a risk with ANOTHER link out is left exactly as drafted — no card', async () => {
    const { graph, out } = await build(m9((c) => {
      c.outcomes = [...(c.outcomes ?? []), { label: 'Support ticket volume', provenance: 'ai_proposed' }];
      c.links.push(link('Customer backlash', 'Support ticket volume', 'positive'));
    }));
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(true);
    expect(JSON.stringify(out)).not.toContain('out of the model');
    expect(proposeProductIdentity(graph)).toBeNull();
  });

  it('CONTROL: a link the USER sized is theirs — left as drafted, no card', async () => {
    const { graph } = await build(m9((c) => { Object.assign(c.links.find((l: Json) => l.from === 'Customer backlash' && l.to === 'MRR'), { effect_amount: -500, effect_per_source_change: 1, effect_provenance: 'explicit' }); }));
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(true);
    expect(proposeProductIdentity(graph)).toBeNull();
  });

  it('CONTROL: a risk with a cause other than the price (served journey C\u2019s "Budget overrun risk" ← spend) is left as drafted', async () => {
    const { graph } = await build(m9((c) => {
      c.links = c.links.filter((l: Json) => !(l.from === 'Pro plan monthly price' && l.to === 'Customer backlash'));
      c.links.push(link('Monthly churn', 'Customer backlash', 'positive'));
    }));
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(true);
    expect(edge(graph, 'Customer backlash', 'Paying subscribers')).toBe(false);
  });

  it('CONTROL: a SIZED risk link is left as drafted (no card)', async () => {
    const { graph } = await build(m9((c) => { Object.assign(c.links.find((l: Json) => l.from === 'Customer backlash' && l.to === 'MRR'), { effect_amount: -500, effect_per_source_change: 1, effect_provenance: 'ai_proposed' }); }));
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(true);
    expect(proposeProductIdentity(graph)).toBeNull();
  });

  it('CONTROL: a link the USER stated is theirs — left as drafted', async () => {
    const { graph } = await build(m9((c) => { c.links.find((l: Json) => l.from === 'Customer backlash' && l.to === 'MRR').provenance = 'explicit'; }));
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(true);
  });

  it('CONTROL: a risk that already reaches an operand is an addend (C46 rule 7) — left as drafted', async () => {
    const { graph } = await build(m9((c) => { c.links.push(link('Customer backlash', 'Paying subscribers', 'negative')); }));
    expect(edge(graph, 'Customer backlash', 'GOAL')).toBe(true);
  });
});
