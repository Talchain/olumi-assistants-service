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
import { rerouteExtraParentsOfProductGoal, sayExtraParentOfProductGoal } from '../product-goal-extra-parent.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { buildAnalysisParticipationDisclosure } from '../../coaching/analysis-participation-disclosure.js';

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

  it('CONTROL (C46 rule 7: a direct cause that ALSO feeds an operand is an addend): the direct link is kept, nothing said', async () => {
    const { graph, out } = await build(draft((c) => { c.links.push(link('Monthly churn', 'Paying subscribers', 'negative', -15, 1, 'ai_proposed')); }));
    expect(edge(graph, 'Monthly churn', 'GOAL')).toBeDefined();
    expect(((out.not_represented ?? []) as string[]).some((l) => l.includes('"Monthly churn" was linked straight'))).toBe(false);
  });

  it('CONTROL (a money parent is an addend in the goal\'s own terms): Olumi-sized "Other plan revenue" → MRR is not re-pointed', async () => {
    const { graph } = await build(draft((c) => {
      c.factors.push({ label: 'Other plan revenue', role: 'observable', baseline_known: false, baseline_value: 5000, unit: 'GBP/month', provenance: 'ai_proposed', plausible_max: 20000 });
      c.links.push(link('Other plan revenue', 'Monthly recurring revenue', 'positive', 1, 1, 'ai_proposed'));
    }));
    expect(edge(graph, 'Other plan revenue', 'GOAL')).toBeDefined();
    expect(edge(graph, 'Other plan revenue', 'Paying subscribers')).toBeUndefined();
  });

  it('ROW (AIQ 5902792262): the USER stated churn → MRR and only Olumi routes churn through subscribers — the user\'s direct link is kept, nothing said', async () => {
    const { graph, out } = await build(draft((c) => {
      c.links[3].effect_provenance = 'explicit';
      c.links.push(link('Monthly churn', 'Paying subscribers', 'negative', -15, 1, 'ai_proposed'));
    }));
    expect(edge(graph, 'Monthly churn', 'GOAL')).toBeDefined();
    expect(((out.not_represented ?? []) as string[]).some((l) => l.includes('count it twice'))).toBe(false);
  });

  it('ROW (AIQ 5902792262): a direct link the user named (link provenance explicit, Olumi size) is neither dropped nor re-pointed', async () => {
    const { graph } = await build(draft((c) => { (c.links[3] as { provenance?: string }).provenance = 'explicit'; }));
    expect(edge(graph, 'Monthly churn', 'GOAL')).toBeDefined();
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')).toBeUndefined();
  });

  it('ROW (MG CR 5902882621): a goal drafted in "£k/month" (−0.735 per point) still acts through subscribers at −15 per point, said in whole pounds', async () => {
    const { graph, out } = await build(draft((c) => {
      Object.assign(c.goal, { unit: '£k/month', value: 85, baseline_value: 75 });
      c.links[3].effect_amount = -0.735;
    }));
    expect(edge(graph, 'Monthly churn', 'GOAL')).toBeUndefined();
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')?.provenance?.natural_effect?.amount).toBeCloseTo(-15, 6);
    const said = ((out.not_represented ?? []) as string[]).find((l) => l.includes('"Monthly churn"') && l.includes('"Paying subscribers"'));
    expect(said, JSON.stringify(out.not_represented)).toMatch(/735/);
    expect(said).not.toMatch(/0\.73/);
  });

  it('CONTROL (MG CR 5902882621): a GBP goal against a USD rate is left exactly as drafted', async () => {
    const { graph } = await build(draft((c) => { c.factors[0].unit = 'USD per subscriber per month'; }));
    expect(edge(graph, 'Monthly churn', 'GOAL')).toBeDefined();
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')).toBeUndefined();
  });

  it('CONTROL (MG CR 5902882621, the function itself): a GBP goal against a USD rate is not converted — nothing found, links as drafted', () => {
    const c = draft((m) => { m.factors[0].unit = 'USD per subscriber per month'; }) as unknown as Parameters<typeof rerouteExtraParentsOfProductGoal>[0];
    const r = rerouteExtraParentsOfProductGoal(c);
    expect(r.found).toEqual([]);
    expect(r.model.links).toBe(c.links);
  });

  it('CONTROL (the user stated the churn → MRR size): nothing is re-pointed', async () => {
    const { graph } = await build(draft((c) => { c.links[3].effect_provenance = 'explicit'; }));
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')).toBeUndefined();
  });

  it('CONTROL (no size on the extra link): nothing is re-pointed (never an invented size)', async () => {
    const { graph } = await build(draft((c) => { c.links[3].effect_amount = null; c.links[3].effect_per_source_change = null; c.links[3].effect_provenance = null; }));
    expect(edge(graph, 'Monthly churn', 'Paying subscribers')).toBeUndefined();
  });

  /**
   * Science goals §(e) addendum 6 + its correction (8 Oct, P48 552acb7d on CEE b7653047): the drafter typed the volume
   * operand "Pro paying subscribers" as an OUTCOME (no unit, no level), so the volume lookup over factors found nothing and
   * Olumi's placeholder risk "Price sensitivity" (caused only by the price) stayed straight into MRR: no card on Paul's brief.
   */
  const outcomeVolume = (edit: (c: Json) => void = () => {}) => draft(c => {
    // Paul's brief states only the TARGET (552acb7d's goal has no current level), so §(e) condition 4 is vacuous there.
    Object.assign(c.goal, { baseline_known: false, baseline_value: null, baseline_provenance: 'explicit' });
    c.factors = c.factors.filter((f: Json) => f.label !== 'Paying subscribers');
    c.outcomes = [{ label: 'Paying subscribers', provenance: 'inferred' }];
    c.risks = [{ label: 'Price sensitivity', provenance: 'ai_proposed' }];
    c.links = [
      link('Pro plan price', 'Monthly recurring revenue', 'positive'),
      link('Paying subscribers', 'Monthly recurring revenue', 'positive'),
      link('Pro plan price', 'Monthly churn', 'positive', 0.5, 10, 'ai_proposed'),
      link('Monthly churn', 'Paying subscribers', 'negative', -12, 1, 'ai_proposed'),
      link('Pro plan price', 'Price sensitivity', 'positive'),
      link('Price sensitivity', 'Monthly recurring revenue', 'negative'),
    ];
    edit(c);
  });
  it('ROW (add. 6, 552acb7d shape): an OUTCOME volume operand is the volume — Olumi\'s price-only risk is kept out of the Run (the price already reaches subscribers via churn) and the card is offered', async () => {
    const { model, found } = rerouteExtraParentsOfProductGoal(outcomeVolume(), BRIEF);
    expect(found).toEqual([expect.objectContaining({ kind: 'kept_out_already_carried', from: 'Price sensitivity', volume: 'Paying subscribers', via: ['Monthly churn'] })]);
    expect((model.risks ?? []).find(r => r.label === 'Price sensitivity')?.analysis_participation).toBe('retained_excluded');
    const { graph } = await build(outcomeVolume());
    expect(proposeProductIdentity(graph)).not.toBeNull();
  });
  it('ROW (add. 6): with no other price → subscribers route, the unsized risk link is RE-POINTED to the outcome volume; the card is offered', async () => {
    const shape = (c: Json) => { c.links = c.links.filter((l: Json) => !(l.from === 'Monthly churn' && l.to === 'Paying subscribers')); };
    const { found } = rerouteExtraParentsOfProductGoal(outcomeVolume(shape), BRIEF);
    expect(found).toEqual([expect.objectContaining({ kind: 'rerouted_unsized', from: 'Price sensitivity', volume: 'Paying subscribers' })]);
    const { graph } = await build(outcomeVolume(shape));
    expect(edge(graph, 'Price sensitivity', 'Paying subscribers')).toBeDefined();
    expect(edge(graph, 'Price sensitivity', 'GOAL')).toBeUndefined();
    expect(proposeProductIdentity(graph)).not.toBeNull();
  });
  const noAltRoute = (c: Json) => { c.links = c.links.filter((l: Json) => !(l.from === 'Monthly churn' && l.to === 'Paying subscribers')); };
  it('Codex r1 P1-3: a risk the USER named (explicit), with no other price route, is never re-pointed — the link stays into MRR', () => {
    const shaped = outcomeVolume(c => { noAltRoute(c); c.risks = [{ label: 'Price sensitivity', provenance: 'explicit' }]; });
    const { model, found } = rerouteExtraParentsOfProductGoal(shaped, BRIEF);
    expect(found).toEqual([]);
    expect(model.links.filter(l => l.from === 'Price sensitivity').map(l => l.to)).toEqual(['Monthly recurring revenue']);
  });
  it('Codex r1 P1-2: a SIZED link into the goal is never converted into an outcome volume (no unit to state it in)', () => {
    // Churn must NOT already reach the volume (else it is an addend, kept before the sized branch is reached).
    const shaped = outcomeVolume(c => { noAltRoute(c); c.links.push(link('Monthly churn', 'Monthly recurring revenue', 'negative', -735, 1, 'ai_proposed')); });
    const { model, found } = rerouteExtraParentsOfProductGoal(shaped, BRIEF);
    expect(found.some(f => f.kind === 'rerouted')).toBe(false);
    expect(model.links.some(l => l.from === 'Monthly churn' && l.to === 'Monthly recurring revenue' && l.effect_amount === -735)).toBe(true);
  });
  it('Codex r1 P2: a DEFINITIONAL link into the goal is an addend — kept where it is, even with an outcome volume', () => {
    const shaped = outcomeVolume(c => { noAltRoute(c); c.links.find((l: Json) => l.from === 'Price sensitivity' && l.to === 'Monthly recurring revenue').definitional = true; });
    const { model, found } = rerouteExtraParentsOfProductGoal(shaped, BRIEF);
    expect(found).toEqual([]);
    expect(model.links.filter(l => l.from === 'Price sensitivity').map(l => l.to)).toEqual(['Monthly recurring revenue']);
  });
  it('CONTROL (add. 6 correction: never a user-authored link): the USER stated the risk → MRR link, no other route → left exactly as drafted, no card', async () => {
    const shaped = outcomeVolume(c => { noAltRoute(c); c.links.find((l: Json) => l.from === 'Price sensitivity' && l.to === 'Monthly recurring revenue').provenance = 'explicit'; });
    const { model, found } = rerouteExtraParentsOfProductGoal(shaped, BRIEF);
    expect(found).toEqual([]);
    expect(model.links.filter(l => l.from === 'Price sensitivity').map(l => l.to)).toEqual(['Monthly recurring revenue']);
    expect(proposeProductIdentity((await build(shaped)).graph)).toBeNull();
  });
  it('CONTROL: an outcome that is NOT an operand of the declared product is never the volume', () => {
    const { found } = rerouteExtraParentsOfProductGoal(outcomeVolume(c => { c.identities[0].factors = ['Pro plan price', 'Something else']; }), BRIEF);
    expect(found).toEqual([]);
  });

  /**
   * Science goals §(e) addendum 7 (8 Oct, P48 draw 3 d8c01a8f on CEE 1920e4a4): Olumi drafted the brief's churn LIMIT as a
   * risk "Pro churn exceeds 4%" ← Monthly churn, straight into MRR, beside churn → subscribers: churn counted twice, and
   * the reading's card vetoed. Every cause already reaches the volume, so the risk is kept OUT of the calculation, said.
   */
  const churnLimitRisk = (edit: (c: Json) => void = () => {}) => draft(c => {
    Object.assign(c.goal, { baseline_known: false, baseline_value: null, baseline_provenance: 'explicit' });
    c.constraints = [{ metric: 'Monthly churn', operator: '<=', value: 4, unit: '%', provenance: 'explicit', frame: 'level' }];
    c.risks = [{ label: 'Pro churn exceeds 4%', provenance: 'ai_proposed' }];
    c.links = [
      link('Pro plan price', 'Monthly recurring revenue', 'positive'),
      link('Paying subscribers', 'Monthly recurring revenue', 'positive'),
      link('Pro plan price', 'Monthly churn', 'positive', 0.5, 10, 'ai_proposed'),
      link('Monthly churn', 'Paying subscribers', 'negative', -12, 1, 'ai_proposed'),
      link('Monthly churn', 'Pro churn exceeds 4%', 'positive'),
      link('Pro churn exceeds 4%', 'Monthly recurring revenue', 'negative'),
    ];
    edit(c);
  });
  const SAID = "‘Pro churn exceeds 4%’ is left out of the calculation: ‘Monthly churn’ already affects ‘Monthly recurring revenue’ through ‘Paying subscribers’, and your ‘Monthly churn under 4%’ is checked as a limit.";
  it('RED (add. 7, d8c01a8f shape): the churn-limit risk is kept out (retained_excluded), said with the limit, and the card is offered', async () => {
    const { model, found } = rerouteExtraParentsOfProductGoal(churnLimitRisk(), BRIEF);
    expect(found).toEqual([{ kind: 'kept_out_cause_carried', from: 'Pro churn exceeds 4%', goal: 'Monthly recurring revenue', volume: 'Paying subscribers', causes: ['Monthly churn'], limit: 'Monthly churn under 4%' }]);
    expect(sayExtraParentOfProductGoal(found[0]!)).toBe(SAID);
    expect((model.risks ?? []).find(r => r.label === 'Pro churn exceeds 4%')?.analysis_participation).toBe('retained_excluded');
    const { graph } = await build(churnLimitRisk());
    expect(proposeProductIdentity(graph)).not.toBeNull();
  });
  it('add. 7, the Run reply: the built graph hands run_analysis a model without the risk, and the Run turn discloses it', async () => {
    const { graph } = await build(churnLimitRisk());
    const risk = graph.nodes.find(n => n.label === 'Pro churn exceeds 4%')!;
    const guarded = guardAnalysisParticipation(graph, { goalNodeId: graph.nodes.find(n => n.kind === 'goal')!.id });
    expect(guarded.excludedNodeIds).toEqual([risk.id]);
    expect(buildAnalysisParticipationDisclosure(guarded)).toMatch(/kept out of the calculation/);
  });
  it('add. 7, no stated limit: kept out, said WITHOUT the limit clause', () => {
    const { found } = rerouteExtraParentsOfProductGoal(churnLimitRisk(c => { c.constraints = []; }), BRIEF);
    expect(sayExtraParentOfProductGoal(found[0]!)).toBe("‘Pro churn exceeds 4%’ is left out of the calculation: ‘Monthly churn’ already affects ‘Monthly recurring revenue’ through ‘Paying subscribers’.");
  });
  it.each([
    ['the USER named the risk', (c: Json) => { c.risks = [{ label: 'Pro churn exceeds 4%', provenance: 'explicit' }]; }],
    ['a SIZED link into the goal', (c: Json) => { const l = c.links.find((x: Json) => x.from === 'Pro churn exceeds 4%'); Object.assign(l, { effect_amount: -500, effect_per_source_change: 1, effect_provenance: 'ai_proposed' }); }],
    ['the risk has another link out', (c: Json) => { c.links.push(link('Pro churn exceeds 4%', 'Monthly churn', 'positive')); }],
    ['a cause that does NOT reach the volume', (c: Json) => { c.links = c.links.filter((l: Json) => !(l.from === 'Monthly churn' && l.to === 'Paying subscribers')); }],
    // NARROWED (Science 393023, 605-scenario census: 17 competitor-response risks): a separate event, not a restatement.
    ['a SECOND cause (competitor response ← churn + price, both reaching the volume)', (c: Json) => { c.links.push(link('Pro plan price', 'Pro churn exceeds 4%', 'positive')); }],
    ['its ONE cause is not a %-unit rate (a release flag)', (c: Json) => { c.factors.find((f: Json) => f.label === 'Monthly churn').unit = 'release live (0/1)'; }],
  ] as const)('CONTROL (add. 7): %s → left exactly as drafted', (_name, edit) => {
    const { found } = rerouteExtraParentsOfProductGoal(churnLimitRisk(edit), BRIEF);
    expect(found.filter(f => f.kind === 'kept_out_cause_carried')).toEqual([]);
  });
});
