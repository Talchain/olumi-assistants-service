/**
 * ⭐ A4f — THE USER'S SIZE INTO AN OUTCOME FITS THE OUTCOME'S FRAME (R3 #75 5923240262; AIQ 5923220559; DL 5923244548).
 *
 * MEASURED: served paul-1 on `d23f5df1` (#2416 live) carried Paul's £1,000,000 per deal as `user_stated`, but the drafter
 * routed it through an intermediate £ OUTCOME ("Investment-firm funding secured", frame £5m; deals frame 10): β 2, cut.
 * The reply then told him the run "couldn't use it at full size". The same shape is in 2 of 4 raw-captured drafts of his
 * brief (raw-1: frame £5m, β 2; raw-2: frame £3m, β 1.67); this spec's draft is raw-1's retry draft, trimmed.
 * #2416 widened only the GOAL's frame. An outcome is computed from its parents, so widening its frame is a pure change of
 * units (R3): every natural size holds, its out-links move up by the same factor, and a factor target stays refused.
 *
 * Real path: strict candidate schema → `buildModelFromBrief` (ONE scripted drafter call) → `/graph/register` → GraphV3.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { NOT_REPRESENTABLE } from '../../../cee/magnitude/link-effect.js';
import { refitFramesForStatedEffects } from '../refit-frames.js';

type Rec = Record<string, any>;

/** Paul's 506-character brief, verbatim (R3 `accept-paul/paul-scenario-read.json`): no target, no level. */
const PAUL =
  "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it.';

type Prov = 'explicit' | 'inferred' | 'ai_proposed';
const link = (from: string, to: string, size?: { amount: number; per: number; by: Prov }, definitional: boolean | null = null) => ({
  from, to, direction: 'positive', provenance: 'inferred' as Prov,
  effect_amount: size?.amount ?? null, effect_per_source_change: size?.per ?? null, effect_provenance: size?.by ?? null, definitional,
});

/** raw-1's retry draft (`/private/tmp/mgc-resume/raw-1/call-2.json`), trimmed: the £ size lands on an intermediate £ outcome. */
function draft(o: { dealsMax?: number; fundingMax?: number; fundingAsFactor?: boolean; target?: number } = {}) {
  const funding = { label: 'Funding from investment firms', provenance: 'inferred', unit: '£', plausible_max: o.fundingMax ?? 5000000 };
  return {
    goal: {
      metric: 'Funding secured', operator: '>=', target_stated: o.target != null, frame: 'level', value: o.target ?? null, unit: '£', horizon_months: 2,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Continue investment-firm outreach', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Angel outreach pilot', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Hours per week on angel outreach', value: 5, value_kind: 'absolute', unit: 'hours/week', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'Hours per week on investment-firm outreach', role: 'controllable', baseline_known: true, baseline_value: 15, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 60 },
      { label: 'Hours per week on angel outreach', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 40 },
      ...(o.fundingAsFactor ? [{ ...funding, role: 'external', baseline_known: false, baseline_value: null }] : []),
    ],
    risks: [],
    outcomes: [
      { label: 'Qualified investment-firm conversations', provenance: 'inferred', unit: 'qualified investment-firm conversations', plausible_max: 100 },
      { label: 'Investment-firm deals closed', provenance: 'inferred', unit: 'deals', plausible_max: o.dealsMax ?? 10 },
      ...(o.fundingAsFactor ? [] : [funding]),
      { label: 'Funding from angel investors', provenance: 'inferred', unit: '£', plausible_max: 1000000 },
    ],
    links: [
      link('Hours per week on investment-firm outreach', 'Qualified investment-firm conversations', { amount: 0.4, per: 1, by: 'ai_proposed' }),
      link('Qualified investment-firm conversations', 'Investment-firm deals closed', { amount: 0.05, per: 1, by: 'ai_proposed' }),
      link('Investment-firm deals closed', 'Funding from investment firms', { amount: 1000000, per: 1, by: 'explicit' }),
      link('Hours per week on angel outreach', 'Funding from angel investors'),
      link('Funding from investment firms', 'Funding secured', { amount: 1, per: 1, by: 'ai_proposed' }, true),
      link('Funding from angel investors', 'Funding secured', { amount: 1, per: 1, by: 'ai_proposed' }, true),
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  };
}

async function build(d: Record<string, unknown>, brief: string = PAUL) {
  let body: unknown = null;
  const call = (async () => ({ text: JSON.stringify(d) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('a4f0a4f0-0000-4a4f-8a4f-a4f0a4f0a4f0', brief, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { g: GraphV3.parse(body) as unknown as Rec, out };
}
/** Every `open_questions` the build returns, wherever it sits in the result. */
const questionsOf = (o: unknown): string[] => (o === null || typeof o !== 'object' ? []
  : Object.entries(o as Rec).flatMap(([k, v]) => (k === 'open_questions' && Array.isArray(v) ? v as string[] : questionsOf(v))));
const frame = (g: Rec, id: string): number | undefined => g.nodes.find((n: Rec) => n.id === id)?.scale_frame;
const edge = (g: Rec, from: string, to: string): Rec => g.edges.find((e: Rec) => e.from === from && e.to === to);
const DEAL = ['investment_firm_deals_closed', 'funding_from_investment_firms'] as const;

describe('A4f: the user\'s £ size into an intermediate £ outcome fits that outcome\'s frame', () => {
  it('RED: raw-1\'s shape → £1,000,000 per deal is carried at |β| ≤ 1 (frame £5m → £10m), never asked as "cut short"', async () => {
    const { g, out } = await build(draft());
    const deal = edge(g, ...DEAL);
    expect(deal.provenance.magnitude).toBe('user_stated');
    expect(frame(g, DEAL[1])).toBe(10000000);
    expect(Math.abs(deal.strength.mean)).toBeLessThanOrEqual(1);
    for (const e of g.edges.filter((x: Rec) => x.provenance?.magnitude === 'user_stated')) expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    expect(questionsOf(out).some((q) => q.includes(NOT_REPRESENTABLE))).toBe(false);
  });

  it('the user\'s natural size is exactly the stated one, and its range is carried (£1,000,000 per 1 deal, low end of "£1-2 million")', async () => {
    const deal = edge((await build(draft())).g, ...DEAL);
    expect(deal.provenance.natural_effect.amount).toBe(1000000);
    expect(deal.provenance.natural_effect.per_source_change).toBe(1);
    expect(deal.provenance.natural_effect.stated_range?.end).toBe('low');
  });

  it('control: Olumi\'s own estimate the frames cannot hold is still set aside and still asked (only the USER\'s fitted size drops its question)', async () => {
    const d = draft() as Rec;
    d.links = d.links.map((l: Rec) => (l.to === 'Qualified investment-firm conversations' ? { ...l, effect_amount: 100 } : l));
    const { out } = await build(d);
    expect(questionsOf(out).some((q) => q.startsWith('Olumi estimated that') && q.includes(NOT_REPRESENTABLE))).toBe(true);
  });

  it('CASCADE (fresh draft a4b2-p3\'s shape): deals max 100 → the outcome AND the goal widen, every |β| ≤ 1, never asked as "cut short"', async () => {
    const { g, out } = await build(draft({ dealsMax: 100 }));
    expect(frame(g, DEAL[1])).toBe(100000000);
    expect(frame(g, 'funding_secured')).toBeGreaterThanOrEqual(100000000);
    for (const e of g.edges.filter((x: Rec) => typeof x.strength?.mean === 'number')) expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    expect(edge(g, ...DEAL).provenance.natural_effect.amount).toBe(1000000);
    expect(questionsOf(out).some((q) => q.includes(NOT_REPRESENTABLE))).toBe(false);
  });

  it('control: the same size into a FACTOR is never widened — it stays cut and the question is still asked', async () => {
    const { g, out } = await build(draft({ fundingAsFactor: true }));
    expect(Math.abs(edge(g, ...DEAL).strength.mean)).toBeGreaterThan(1);
    expect(questionsOf(out).some((q) => q.includes(NOT_REPRESENTABLE))).toBe(true);
  });
});

/** Served paul-1 (`d23f5df1`, `a4w2/paul-1/02-cold-after-build.json`): the investment-firm chain, verbatim frames and β. */
function servedPaul1(fundingKind: string = 'outcome'): Rec {
  const n = (id: string, kind: string, scale_frame?: number, observed_state?: Rec) => ({ id, kind, label: id, ...(scale_frame ? { scale_frame } : {}), ...(observed_state ? { observed_state } : {}) });
  return {
    nodes: [
      n('securing_funding', 'goal', 10000000),
      n('cold_emails_to_investment_firms', 'factor', 200, { unit: 'emails/week', value: 0.1, source: 'cee_inference', raw_value: 20 }),
      n('qualified_investment_firm_conversations', 'outcome', 100),
      n('investment_firm_deals_closed', 'outcome', 10),
      n('investment_firm_funding_secured', fundingKind, 5000000),
    ],
    edges: [
      { from: 'cold_emails_to_investment_firms', to: 'qualified_investment_firm_conversations', strength: { mean: 0.4, std: 0.2 }, provenance: { magnitude: 'olumi_estimate' } },
      { from: 'qualified_investment_firm_conversations', to: 'investment_firm_deals_closed', strength: { mean: 0.5, std: 0.25 }, provenance: { magnitude: 'olumi_estimate' } },
      { from: 'investment_firm_deals_closed', to: 'investment_firm_funding_secured', strength: { mean: 2, std: 1 },
        provenance: { magnitude: 'user_stated', natural_effect: { amount: 1000000, per_source_change: 1, strength_mean: 2 } } },
      { from: 'investment_firm_funding_secured', to: 'securing_funding', strength: { mean: 0.5, std: 0.25 }, provenance: { magnitude: 'olumi_estimate' } },
    ],
  };
}
const natural = (g: Rec): number[] => g.edges.map((e: Rec) => {
  const F = (id: string) => g.nodes.find((x: Rec) => x.id === id).scale_frame ?? g.nodes.find((x: Rec) => x.id === id).observed_state.raw_value / g.nodes.find((x: Rec) => x.id === id).observed_state.value;
  return (e.strength.mean * F(e.to)) / F(e.from);
});

describe('A4f on the served paul-1 graph (0 LLM)', () => {
  it('the outcome frame £5m → £10m: deal β 2 → 1, its out-link 0.5 → 1, no |β| > 1 left, every natural size held', () => {
    const before = servedPaul1();
    const r = refitFramesForStatedEffects(before);
    expect(r.refits).toEqual([{ node: 'investment_firm_funding_secured', from: 5000000, to: 10000000, for_link: 'investment_firm_deals_closed→investment_firm_funding_secured' }]);
    expect(r.graph.edges.map((e: Rec) => e.strength.mean)).toEqual([0.4, 0.5, 1, 1]);
    expect(natural(r.graph)).toEqual(natural(before));
    expect(r.graph.edges[2].provenance.natural_effect.amount).toBe(1000000);
    expect(r.graph.edges[2].provenance.natural_effect.strength_mean).toBe(1);
    expect(r.graph.nodes[0]).toEqual(before.nodes[0]); // the goal is untouched
  });

  it('CASCADE on the a4b2-p3 shape: outcome £3m holds β 3.33 → outcome £10m and goal £5m → £10m, β 1 / 1, natural sizes held', () => {
    const before = servedPaul1();
    before.nodes[4].scale_frame = 3000000; before.nodes[0].scale_frame = 5000000;
    before.edges[2].strength.mean = 10 / 3; before.edges[3].strength.mean = 0.6;
    const r = refitFramesForStatedEffects(before);
    expect(r.refits.map((x: Rec) => [x.node, x.from, x.to])).toEqual([['investment_firm_funding_secured', 3000000, 10000000], ['securing_funding', 5000000, 10000000]]);
    expect(r.graph.edges.map((e: Rec) => Number(e.strength.mean.toFixed(9)))).toEqual([0.4, 0.5, 1, 1]);
    expect(natural(r.graph).map((x) => Number(x.toFixed(6)))).toEqual(natural(before).map((x) => Number(x.toFixed(6))));
  });

  it('control: the cascade obeys every guard — a goal its limit rows name is not widened, so the widen is refused (new_cut)', () => {
    const before = { ...servedPaul1(), goal_constraints: [{ node_id: 'securing_funding', operator: '>=', value: 2000000 }] };
    before.nodes[4].scale_frame = 3000000; before.nodes[0].scale_frame = 5000000;
    before.edges[2].strength.mean = 10 / 3; before.edges[3].strength.mean = 0.6;
    const r = refitFramesForStatedEffects(before);
    expect(r.refused).toEqual([{ link: 'investment_firm_deals_closed→investment_firm_funding_secured', reason: 'new_cut', detail: 'investment_firm_funding_secured→securing_funding' }]);
    expect(r.graph).toBe(before);
  });

  it('control: an OUTCOME that holds a sampled level (Olumi\'s, no std) keeps the spread guard — refused, the graph as it came', () => {
    const before = servedPaul1();
    before.nodes[4].observed_state = { value: 0.4, raw_value: 2000000, source: 'cee_inference' };
    delete before.nodes[4].scale_frame;
    const r = refitFramesForStatedEffects(before);
    expect(r.refused).toEqual([{ link: 'investment_firm_deals_closed→investment_firm_funding_secured', reason: 'spread_would_move' }]);
    expect(r.graph).toBe(before);
  });

  it('control: the same size into a FACTOR is still refused, the graph returned as it came', () => {
    const before = servedPaul1('factor');
    const r = refitFramesForStatedEffects(before);
    expect(r.refused).toEqual([{ link: 'investment_firm_deals_closed→investment_firm_funding_secured', reason: 'not_the_goal' }]);
    expect(r.graph).toBe(before);
  });
});

/**
 * R3 5923709789 (1): the cascade lives inside the ONE refit, so the F4 retirement shares it. On the a4b2-p3 shape (outcome
 * £3m), (A) Paul's frameless build then the approved "at least £1m" card equals (B) the same draft built with the target,
 * on the goal's frame and every β along the user's chain.
 */
describe('A4f cascade is path independent (construction and the F4 card share it)', () => {
  it('A (build → card "at least £1m") == B (built with £1m): goal frame, deal β and the outcome\'s out-link β', async () => {
    const { applyGoalTargetEdit } = await import('../../system-events/goal-target-edit.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const built = (await build(draft({ fundingMax: 3000000 }))).g;
    const goalId = built.nodes.find((n: Rec) => n.kind === 'goal').id;
    const event = { kind: 'goal_target_edit', goal_node_id: goalId, constraint_type: 'at_least', raw_value: 1000000, unit: '£',
      base_graph_hash: computeAnalysisAffectingGraphHash(built as never) };
    const r = await applyGoalTargetEdit({
      payload: { kind: 'system_event', scenario_id: 'a4f1a4f1-0000-4a4f-8a4f-a4f1a4f1a4f1', turn_id: 'turn-a4f', stage: 'frame', event } as never,
      event: event as never, requestId: 'req-a4f', persistedGraph: built as never, priorFacts: [],
    }) as { kind: string; mutatedGraph?: Rec };
    expect(r.kind, JSON.stringify(r).slice(0, 300)).toBe('mutated');
    const a = r.mutatedGraph!;
    const b = (await build(draft({ fundingMax: 3000000, target: 1000000 }), `${PAUL} We need to raise at least £1m.`)).g;
    // The USER's chain agrees on both paths: the outcome's frame and the deal β, carried at full size.
    expect(frame(a, DEAL[1])).toBe(frame(b, DEAL[1]));
    expect(edge(a, ...DEAL).strength.mean).toBeCloseTo(edge(b, ...DEAL).strength.mean, 9);
    expect(Math.abs(edge(a, ...DEAL).strength.mean)).toBeLessThanOrEqual(1);
    expect(edge(a, ...DEAL).provenance.natural_effect.amount).toBe(edge(b, ...DEAL).provenance.natural_effect.amount);
  });

  // ⚠ NAMED RESIDUAL (MG #75, to R3): Olumi's drafted "+£1 per £1" outcome → goal link is typed `definitional` on the frameless
  // build (the normalising frame holds it) but SET ASIDE when the brief states the target: the target's frame (£1m) cannot
  // hold £3m at 1:1 when it is sized, before any refit, so B carries a placeholder there and the goal's frame differs. The
  // same class as the pinned Olumi-estimate residual in `construction-goal-normalising-frame.test.ts`. Pinned so either side moving is seen.
  it('RESIDUAL (pinned): the outcome → goal link is definitional on A, a placeholder on B (set aside at sizing)', async () => {
    const b = (await build(draft({ fundingMax: 3000000, target: 1000000 }), `${PAUL} We need to raise at least £1m.`)).g;
    const goalId = b.nodes.find((n: Rec) => n.kind === 'goal').id;
    expect(edge(b, DEAL[1], goalId).provenance.definitional).toBeUndefined();
  });
});

/** CODEX delta class 5923720522: the collision class — 3 hops, a diamond, and a refusal mid-chain that rolls everything back. */
describe('A4f cascade: chains, diamonds and rollback (0 LLM)', () => {
  const n = (id: string, kind: string, scale_frame: number) => ({ id, kind, label: id, scale_frame });
  const e = (from: string, to: string, mean: number, user = false) => ({ from, to, strength: { mean, std: Math.abs(mean) / 2 },
    provenance: user ? { magnitude: 'user_stated', natural_effect: { amount: 1, per_source_change: 1, strength_mean: mean } } : { magnitude: 'olumi_estimate' } });
  const nat = (g: Rec): number[] => g.edges.map((x: Rec) => x.strength.mean * g.nodes.find((y: Rec) => y.id === x.to).scale_frame / g.nodes.find((y: Rec) => y.id === x.from).scale_frame);

  it('3 hops: user → A (outcome) → B (outcome) → goal; A, B and the goal widen once each, every |β| ≤ 1, natural sizes held', () => {
    const before = { nodes: [n('s', 'outcome', 10), n('a', 'outcome', 1000), n('b', 'outcome', 1000), n('g', 'goal', 1000)],
      edges: [e('s', 'a', 4, true), e('a', 'b', 0.9), e('b', 'g', 0.9)] };
    const r = refitFramesForStatedEffects(before);
    expect(r.refits.map((x: Rec) => x.node)).toEqual(['a', 'b', 'g']);
    for (const x of r.graph.edges) expect(Math.abs(x.strength.mean)).toBeLessThanOrEqual(1 + 1e-9);
    expect(nat(r.graph).map((v) => Number(v.toFixed(6)))).toEqual(nat(before).map((v) => Number(v.toFixed(6))));
  });

  it('a diamond into one goal: the goal is widened ONCE, to fit both branches', () => {
    const before = { nodes: [n('s', 'outcome', 10), n('x', 'outcome', 1000), n('y', 'outcome', 1000), n('z', 'outcome', 1000), n('g', 'goal', 1000)],
      edges: [e('s', 'x', 3, true), e('x', 'y', 0.5), e('x', 'z', 0.4), e('y', 'g', 0.6), e('z', 'g', 0.6)] };
    const r = refitFramesForStatedEffects(before);
    expect(r.refused).toEqual([]);
    expect(r.refits.filter((x: Rec) => x.node === 'g')).toHaveLength(1);
    for (const x of r.graph.edges) expect(Math.abs(x.strength.mean)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('control: a FACTOR mid-chain refuses, and the whole chain rolls back — the graph returned as it came, no refit recorded', () => {
    const before = { nodes: [n('s', 'outcome', 10), n('a', 'outcome', 1000), n('f', 'factor', 1000), n('g', 'goal', 1000)],
      edges: [e('s', 'a', 4, true), e('a', 'f', 0.9), e('f', 'g', 0.5)] };
    const r = refitFramesForStatedEffects(before);
    expect(r.refused).toEqual([{ link: 's→a', reason: 'new_cut', detail: 'a→f' }]);
    expect(r.refits).toEqual([]);
    expect(r.graph).toBe(before);
  });
});
