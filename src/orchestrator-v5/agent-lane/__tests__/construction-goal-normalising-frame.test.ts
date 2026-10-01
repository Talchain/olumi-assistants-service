/**
 * ⭐ A4/A4b ROOT — A £ GOAL WITH NO TARGET, NO LEVEL AND NO FRAME GETS A NORMALISING FRAME (R3 5922308054 F1–F5;
 * DL 5922308488; MG 5922280148).
 *
 * MEASURED (raw-captured drafts on `52e05ac8`, #75 5922280148): Paul's 506-character brief states no target and no level.
 * The drafter DID draft "Investment-firm deals closed → securing funding" at £1,000,000 per 1 deal (`explicit`) and both
 * doors passed (#2389 size, #2409 range), but `sizeLink` found no frame on the goal, so the size was `unconvertible`: a ±0.5
 * placeholder with its natural size and range dropped. Same root for the risk → £ goal exposure (A4b).
 *
 * Real path: strict candidate schema → `buildModelFromBrief` (ONE scripted drafter call) → `/graph/register` → GraphV3.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type NE = { amount?: number; per_source_change?: number; amount_unit?: string; stated_range?: { text?: string; end?: string; low?: number } };
type Edge = { from: string; to: string; strength?: { mean?: number }; provenance?: { magnitude?: string; definitional?: boolean; natural_effect?: NE } };
type Node = { id: string; kind: string; label: string; scale_frame?: number; goal_threshold_raw?: number; goal_threshold_cap?: number; observed_state?: { raw_value?: number; value?: number } };
type Graph = { nodes: Node[]; edges: Edge[] };

/** Paul's 506-character brief, verbatim (R3 `accept-paul/paul-scenario-read.json`): no target, no level. */
const PAUL =
  "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it.';

type Prov = 'explicit' | 'inferred' | 'ai_proposed';
const link = (from: string, to: string, size?: { amount: number; per: number; by: Prov }, direction: 'positive' | 'negative' = 'positive', definitional: boolean | null = null) => ({
  from, to, direction, provenance: 'inferred' as Prov,
  effect_amount: size?.amount ?? null, effect_per_source_change: size?.per ?? null, effect_provenance: size?.by ?? null, definitional,
});

/** The raw-captured first draft's shape (raw-3, `52e05ac8`): the deals countable sized per one at the low end, into the goal. */
function draft(o: { dealsMax?: number; target?: number | null } = {}) {
  return {
    goal: {
      metric: 'securing funding', operator: '>=', target_stated: o.target != null, frame: 'level', value: o.target ?? null, unit: 'GBP', horizon_months: 2,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Continue investment-firm outreach', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Angel outreach pilot', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Hours per week on angel outreach', value: 5, value_kind: 'absolute', unit: 'hours/week', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'Hours per week on investment-firm outreach', role: 'controllable', baseline_known: true, baseline_value: 20, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 60 },
      { label: 'Hours per week on angel outreach', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 40 },
    ],
    risks: [{ label: 'Funding lost to fundraising distraction', provenance: 'inferred', unit: 'GBP', plausible_max: 200000 }],
    outcomes: [
      { label: 'Investment-firm deals closed', provenance: 'inferred', unit: 'deals', plausible_max: o.dealsMax ?? 3 },
      { label: 'Qualified angel conversations', provenance: 'inferred', unit: 'conversations', plausible_max: 20 },
    ],
    links: [
      link('Hours per week on investment-firm outreach', 'Investment-firm deals closed'),
      link('Investment-firm deals closed', 'securing funding', { amount: 1000000, per: 1, by: 'explicit' }),
      link('Hours per week on angel outreach', 'Qualified angel conversations'),
      // Olumi's own size into the goal (F5): never sized by the normalising frame.
      link('Qualified angel conversations', 'securing funding', { amount: 50000, per: 1, by: 'ai_proposed' }),
      link('Hours per week on angel outreach', 'Funding lost to fundraising distraction'),
      // A4b: the exposure holds by definition, −£1 per £1, in ONE unit.
      link('Funding lost to fundraising distraction', 'securing funding', { amount: -1, per: 1, by: 'ai_proposed' }, 'negative', true),
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
  const out = await buildModelFromBrief('f4a3f4a3-0000-4f4a-8f4a-f4a3f4a3f4a3', brief, dispatch, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return GraphV3.parse(body) as unknown as Graph;
}
const goalOf = (g: Graph) => g.nodes.find((n) => n.kind === 'goal')!;
const edge = (g: Graph, from: string, to: string = goalOf(g).id) => g.edges.find((e) => e.from === from && e.to === to);

describe('A4/A4b root: a £ goal with no target, no level and no frame is read on a normalising frame', () => {
  it('RED: Paul\'s brief → the user\'s £1,000,000 per deal is carried as theirs, with "£1-2 million" at its low end', async () => {
    const g = await build(draft());
    const deal = edge(g, 'investment_firm_deals_closed');
    expect(deal?.provenance?.magnitude).toBe('user_stated');
    expect(deal?.provenance?.natural_effect?.stated_range?.text).toBe('£1-2 million');
    expect(deal?.provenance?.natural_effect?.stated_range?.end).toBe('low');
  });

  it('F2: the stored natural size is exactly the stated one (£1,000,000 per 1 deal)', async () => {
    const ne = edge(await build(draft()), 'investment_firm_deals_closed')?.provenance?.natural_effect;
    expect(ne?.amount).toBe(1000000);
    expect(ne?.per_source_change).toBe(1);
  });

  it('F3: the frame is the smallest {1,2,5}·10^k over the brief\'s £2m and every carried reach ÷ 0.8 — |β| ≤ 0.8 (deals max 3 → £5m; max 5 → £10m)', async () => {
    const g3 = await build(draft());
    expect(goalOf(g3).scale_frame).toBe(5000000);
    expect(Math.abs(edge(g3, 'investment_firm_deals_closed')!.strength!.mean!)).toBeLessThanOrEqual(0.8);
    const g5 = await build(draft({ dealsMax: 5 }));
    expect(goalOf(g5).scale_frame).toBe(10000000);
    expect(Math.abs(edge(g5, 'investment_firm_deals_closed')!.strength!.mean!)).toBeLessThanOrEqual(0.8);
  });

  it('A4b: the definitional −£1 per £1 exposure is typed `definitional` once the goal has a frame', async () => {
    const risk = edge(await build(draft()), 'funding_lost_to_fundraising_distraction');
    expect(risk?.provenance?.definitional).toBe(true);
    expect(risk?.provenance?.natural_effect?.amount).toBe(-1);
  });

  it('F5: Olumi\'s own £ size into the goal is sized exactly as before (no natural size, no magnitude author)', async () => {
    const olumi = edge(await build(draft()), 'qualified_angel_conversations');
    expect(olumi?.provenance?.natural_effect).toBeUndefined();
    expect(olumi?.provenance?.magnitude).toBeUndefined();
  });

  it('F5: a link the drafter CLAIMS is definitional but is not ±1 (−£0.5 per £1) is sized exactly as before', async () => {
    const d = draft() as Record<string, any>;
    d.links = d.links.map((l: Record<string, unknown>) => (l.from === 'Funding lost to fundraising distraction' ? { ...l, effect_amount: -0.5 } : l));
    const risk = edge(await build(d), 'funding_lost_to_fundraising_distraction');
    expect(risk?.provenance?.definitional).toBeUndefined();
    expect(risk?.provenance?.natural_effect).toBeUndefined();
  });

  // ⛔ CODEX CEE BUDDY 5922482284: the frame reads the SAME earned door as sizing. An unwritten size tagged `explicit`
  // once set it (£5m → £5bn) and shrank the user's own £1m/deal β from 0.6 to 0.0006.
  it('RED (CODEX twin): an UNWRITTEN £100m per conversation tagged `explicit` never sets the frame — £5m, the user\'s β stays 0.6', async () => {
    const d = draft() as Record<string, any>;
    d.links = d.links.map((l: Record<string, unknown>) => (l.from === 'Qualified angel conversations' ? { ...l, effect_amount: 100000000, effect_provenance: 'explicit' } : l));
    const g = await build(d);
    expect(goalOf(g).scale_frame).toBe(5000000);
    expect(edge(g, 'investment_firm_deals_closed')!.strength!.mean).toBeCloseTo(0.6, 9);
    expect(edge(g, 'qualified_angel_conversations')?.provenance?.natural_effect).toBeUndefined();
  });

  it('RED (CODEX twin): a claimed definition that is not ±1 (−£0.5 per £1) on a £100m-range risk never sets the frame — £5m', async () => {
    const d = draft() as Record<string, any>;
    d.risks = d.risks.map((r: Record<string, unknown>) => ({ ...r, plausible_max: 100000000 }));
    d.links = d.links.map((l: Record<string, unknown>) => (l.from === 'Funding lost to fundraising distraction' ? { ...l, effect_amount: -0.5 } : l));
    expect(goalOf(await build(d)).scale_frame).toBe(5000000);
  });

  it('F1: the frame is never a level or a target: no goal threshold, cap or level is written', async () => {
    const goal = goalOf(await build(draft()));
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold_cap).toBeUndefined();
    expect(goal.observed_state?.raw_value).toBeUndefined();
  });

  it('CONTROL (DL): a £ goal WITH a target gets no normalising frame — its links are read on the target\'s own frame', async () => {
    const g = await build(draft({ target: 1200000 }), `${PAUL} We need to raise at least £1.2m.`);
    expect(goalOf(g).scale_frame).toBeUndefined();
    expect(edge(g, 'investment_firm_deals_closed')?.provenance?.natural_effect?.amount).toBe(1000000);
  });

  it('CONTROL: a brief that writes no money and a draft with no sized link into the goal → no frame, the links stay placeholders', async () => {
    const d = draft() as Record<string, any>;
    d.links = d.links.map((l: Record<string, unknown>) => ({ ...l, effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null }));
    const g = await build(d, PAUL.replace(' between £1-2 million', ''));
    expect(goalOf(g).scale_frame).toBeUndefined();
    expect(edge(g, 'investment_firm_deals_closed')?.provenance?.natural_effect).toBeUndefined();
  });
});
