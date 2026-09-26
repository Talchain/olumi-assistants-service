/**
 * ⛔ THE MAGNITUDE CONTRACT, PR1 (MG design `MAGNITUDE-CONTRACT-DESIGN.md`, D1–D9): a size the drafter states
 * reaches the edge on the TARGET's own frame. It is never a frame-blind ±0.5.
 *
 * SERVED (Paul's T3, CEE 59f682e, #70 5844762506): the drafted `AI feature availability -> Monthly churn` link
 * carried −0.5 on churn's 0–100% frame, so releasing AI moved churn by about −50 points. On local ISL the leader's
 * median churn was −41.7% and 81.5% of its draws were below 0%, while the churn limit read "met" at ~99%.
 *
 * Every row goes through the real path: the strict candidate schema, then `buildModelFromBrief` with a faked
 * drafter, then the `/graph/register` body, then `GraphV3.parse`, then the edge by id.
 *
 * T3's shape, rebuilt by node id from the served graph (`04-T3-run.json`, scenario 58368b14):
 *   `ai_feature_availability` is a yes/no factor on frame 1 that both AI options set to 1 (status quo 0), so d = [0, 1];
 *   `monthly_churn` is a % factor on frame 100 at 4% today (T2's figure), so b = 0.04 on the domain [0, 1].
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { detectStrengthDefaults, detectStrengthMeanDominant } from '../../../cee/validation/integrity-sentinel.js';

type Edge = Record<string, unknown> & {
  from: string; to: string; strength: { mean: number; std: number };
  provenance?: { source?: string; magnitude?: string };
};
type Graph = { nodes: (Record<string, unknown> & { id: string; kind: string })[]; edges: Edge[] };

type Prov = 'explicit' | 'inferred' | 'ai_proposed';
interface Size { readonly amount: number | null; readonly per: number | null; readonly by: Prov | null }
const UNKNOWN: Size = { amount: null, per: null, by: null };

const link = (from: string, to: string, direction: 'positive' | 'negative', size: Size = UNKNOWN, provenance: Prov = 'inferred') => ({
  from, to, direction, provenance,
  effect_amount: size.amount, effect_per_source_change: size.per, effect_provenance: size.by,
});

const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase the '
  + 'Pro plan price from £49 to £59 per month with the next AI feature release? Our monthly churn is 4% today, from our billing data.';

/** Paul's T3 shape by node id; only the AI -> churn link's size (and its authorship) varies between rows. */
function t3(aiToChurn: Size, aiToChurnProvenance: Prov = 'inferred') {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP/month', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [{ metric: 'Monthly churn', operator: '<', value: 10, unit: '%', provenance: 'explicit' }],
    options: [
      { label: 'Carry on as now', provenance: 'inferred', changes: [], interventions: [], is_status_quo: true },
      { label: 'Release AI at £49', provenance: 'inferred', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP/month', provenance: 'explicit' },
        { factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: 'available', provenance: 'ai_proposed' },
      ] },
      { label: 'Raise price with AI release', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP/month', provenance: 'explicit' },
        { factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: 'available', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP/month', provenance: 'explicit', plausible_max: 200 },
      { label: 'AI feature availability', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'ai_proposed', plausible_max: 1 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: null, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: true, baseline_value: 4, unit: '%', provenance: 'explicit', plausible_max: 100 },
    ],
    risks: [{ label: 'Price sensitivity', provenance: 'inferred' }],
    outcomes: [],
    links: [
      link('Pro plan price', 'MRR', 'positive'),
      link('Pro plan price', 'Price sensitivity', 'positive'),
      link('AI feature availability', 'Pro subscribers', 'positive'),
      link('AI feature availability', 'Monthly churn', 'negative', aiToChurn, aiToChurnProvenance),
      link('Price sensitivity', 'Monthly churn', 'positive'),
      link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Pro subscribers', 'MRR', 'positive'),
      link('Monthly churn', 'MRR', 'negative'),
    ],
    identities: [],
    unknowns: [],
  };
}

/** The production contract: the candidate must pass the real strict schema, as the model's output would. */
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function register(wire: Record<string, unknown>): Promise<{ graph: Graph; out: Record<string, unknown> }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let body: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out };
}

const edge = (g: Graph, from: string, to: string): Edge => {
  const e = g.edges.find((x) => x.from === from && x.to === to);
  expect(e, `${from} -> ${to}`).toBeDefined();
  return e!;
};
const questions = (out: Record<string, unknown>): string[] => (Array.isArray(out.open_questions) ? out.open_questions as string[] : []);
const AI = 'ai_feature_availability';
const CHURN = 'monthly_churn';

describe('R1–R4: Paul\'s T3 AI -> churn link is sized on churn\'s own frame', () => {
  it('R1: Olumi\'s "releasing AI: about −1 point" admits −0.01 / 0.005, stamped olumi_estimate (today −0.5)', async () => {
    const { graph, out } = await register(t3({ amount: -1, per: 1, by: 'ai_proposed' }));
    const e = edge(graph, AI, CHURN);
    expect(e.strength.mean).toBe(-0.01);
    expect(e.strength.std).toBe(0.005);
    expect(e.provenance?.magnitude).toBe('olumi_estimate');
    expect(e.effect_direction).toBe('negative');
    // In domain (2|β|·|d| = 0.02 ≤ 0.04 of headroom): nothing to ask.
    expect(questions(out).filter((q) => q.includes('Monthly churn') && q.includes('AI feature availability'))).toEqual([]);
  });

  it('R2: an unknown size ("null") admits the frame-aware placeholder −0.01, and asks how much, naming both', async () => {
    const { graph, out } = await register(t3(UNKNOWN));
    const e = edge(graph, AI, CHURN);
    // sign · min(0.5, headroom / (4·|d|)) = −min(0.5, 0.04 / 4)
    expect(e.strength.mean).toBe(-0.01);
    expect(e.strength.std).toBe(0.005);
    expect(e.provenance?.magnitude).toBe('olumi_placeholder');
    expect(e.defaulted).toBe(true);
    const asked = questions(out).filter((q) => q.includes('"AI feature availability"') && q.includes('"Monthly churn"'));
    expect(asked, JSON.stringify(questions(out))).toHaveLength(1);
  });

  it('R3: Olumi\'s out-of-domain "−6 points" is withdrawn for the placeholder — not −0.06 and not clamped to −0.04 — and asked, quoting it', async () => {
    const { graph, out } = await register(t3({ amount: -6, per: 1, by: 'ai_proposed' }));
    const e = edge(graph, AI, CHURN);
    expect(e.strength.mean).not.toBe(-0.06);
    expect(e.strength.mean).not.toBe(-0.04);
    expect(e.strength.mean).toBe(-0.01);
    expect(e.strength.std).toBe(0.005);
    expect(e.provenance?.magnitude).toBe('olumi_placeholder');
    const asked = questions(out).filter((q) => q.includes('"Monthly churn"'));
    expect(asked, JSON.stringify(questions(out))).toHaveLength(1);
    expect(asked[0]).toContain('6 points');
    expect(asked[0]).toContain('4% today');
  });

  it('R4: the user\'s own out-of-domain "−6 points" is kept exactly as stated, stamped user_stated, and asked', async () => {
    const { graph, out } = await register(t3({ amount: -6, per: 1, by: 'explicit' }, 'explicit'));
    const e = edge(graph, AI, CHURN);
    expect(e.strength.mean).toBe(-0.06);
    expect(e.strength.std).toBe(0.03);
    expect(e.provenance?.magnitude).toBe('user_stated');
    expect(e.provenance?.source).toBe('brief_extraction');
    const asked = questions(out).filter((q) => q.includes('"Monthly churn"'));
    expect(asked, JSON.stringify(questions(out))).toHaveLength(1);
    expect(asked[0]).toContain('6 points');
    expect(asked[0]).toContain('kept exactly as you said');
  });
});

/**
 * §4 of the design: other unit classes. One SaaS model holds all three conversions; each option moves one lever.
 *   price £ on frame 200, £49 → £59 (d = [0, 0.05]); a free trial yes/no on frame 1 (d = [0, 1]);
 *   sales hires on frame 50, 5 → 7 (d = [0, 0.04]); churn % on 100 at 4%; trial conversion a fraction at 0.03;
 *   enterprise customers a count on 2000 at 300.
 */
function saas(priceToChurn: Size = { amount: 0.5, per: 10, by: 'ai_proposed' }) {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP/month', horizon_months: null, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'inferred', changes: [], interventions: [], is_status_quo: true },
      { label: 'Raise price to £59', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP/month', provenance: 'explicit' }] },
      { label: 'Launch a free trial', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Free trial', value: 1, value_kind: 'absolute', unit: 'on', provenance: 'explicit' }] },
      { label: 'Hire two sales reps', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Sales hires', value: 7, value_kind: 'absolute', unit: 'hires', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP/month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Free trial', role: 'controllable', baseline_known: true, baseline_value: 0, unit: null, provenance: 'explicit', plausible_max: 1 },
      { label: 'Sales hires', role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'hires', provenance: 'explicit', plausible_max: 50 },
      { label: 'Monthly churn', role: 'observable', baseline_known: true, baseline_value: 4, unit: '%', provenance: 'explicit', plausible_max: 100 },
      { label: 'Trial conversion', role: 'observable', baseline_known: true, baseline_value: 0.03, unit: 'fraction', provenance: 'explicit', plausible_max: 1 },
      { label: 'Enterprise customers', role: 'observable', baseline_known: true, baseline_value: 300, unit: 'customers', provenance: 'explicit', plausible_max: 2000 },
    ],
    risks: [],
    outcomes: [],
    links: [
      link('Pro plan price', 'Monthly churn', 'positive', priceToChurn),
      link('Free trial', 'Trial conversion', 'positive', { amount: 0.01, per: 1, by: 'ai_proposed' }),
      link('Sales hires', 'Enterprise customers', 'positive', { amount: 10, per: 1, by: 'ai_proposed' }),
      link('Pro plan price', 'MRR', 'positive'),
      link('Monthly churn', 'MRR', 'negative'),
      link('Trial conversion', 'MRR', 'positive'),
      link('Enterprise customers', 'MRR', 'positive'),
    ],
    identities: [],
    unknowns: [],
  };
}

describe('R5: unit-class conversions (design §4)', () => {
  it('price → churn "+£10 → +0.5 pt" is β = (0.5/100)/(10/200) = 0.10; hires → customers "+1 → +10" is 0.25; a yes/no → fraction "+0.01" is 0.01', async () => {
    const { graph, out } = await register(saas());
    const price = edge(graph, 'pro_plan_price', CHURN);
    expect(price.strength.mean).toBeCloseTo(0.10, 12);
    expect(price.strength.std).toBeCloseTo(0.05, 12);
    expect(price.provenance?.magnitude).toBe('olumi_estimate');
    const hires = edge(graph, 'sales_hires', 'enterprise_customers');
    expect(hires.strength.mean).toBeCloseTo(0.25, 12);
    expect(hires.provenance?.magnitude).toBe('olumi_estimate');
    const trial = edge(graph, 'free_trial', 'trial_conversion');
    expect(trial.strength.mean).toBeCloseTo(0.01, 12);
    expect(trial.strength.std).toBeCloseTo(0.005, 12);
    expect(trial.provenance?.magnitude).toBe('olumi_estimate');
    // All three are in domain across their own option's swing: nothing to ask about any of them.
    expect(questions(out).filter((q) => /Monthly churn|Enterprise customers|Trial conversion/.test(q)), JSON.stringify(questions(out))).toEqual([]);
  });

  it('a continuous lever swings from its baseline to the farthest option level, not across its whole frame: an unknown price → churn keeps the full +0.5', async () => {
    // d = [0, 0.05], so headroom 0.96 / (4 · 0.05) = 4.8 and the cap 0.5 binds. Read across the frame (d = 1) it would be 0.24.
    const { graph, out } = await register(saas(UNKNOWN));
    const price = edge(graph, 'pro_plan_price', CHURN);
    expect(price.strength.mean).toBe(0.5);
    expect(price.strength.std).toBe(0.25);
    expect(price.provenance?.magnitude).toBe('olumi_placeholder');
    expect(questions(out).filter((q) => q.includes('"Pro plan price"') && q.includes('"Monthly churn"'))).toHaveLength(1);
  });

  it('D8: "+£1 → +1 pt" is β = 2.0, which the engine would truncate to 1 — Olumi\'s estimate is withdrawn and asked, never silently cut', async () => {
    const { graph, out } = await register(saas({ amount: 1, per: 1, by: 'ai_proposed' }));
    const price = edge(graph, 'pro_plan_price', CHURN);
    expect(Math.abs(price.strength.mean)).toBeLessThanOrEqual(1);
    expect(price.strength.mean).toBe(0.5);
    expect(price.provenance?.magnitude).toBe('olumi_placeholder');
    const asked = questions(out).filter((q) => q.includes('"Monthly churn"'));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('more than the analysis can represent');
  });
});

describe('R6: the contrast control — a target with no frame keeps today\'s ±0.5 / 0.125', () => {
  it('a stated size into a risk (no frame, no range) cannot be converted, so the edge is exactly today\'s', async () => {
    const stated = t3({ amount: -1, per: 1, by: 'ai_proposed' });
    const withSize = { ...stated, links: stated.links.map((l) => (l.to === 'Price sensitivity' ? { ...l, effect_amount: 3, effect_per_source_change: 10, effect_provenance: 'ai_proposed' } : l)) };
    const { graph: sized } = await register(withSize);
    const { graph: unsized } = await register(stated);
    const e = edge(sized, 'pro_plan_price', 'price_sensitivity');
    expect(e.strength).toStrictEqual({ mean: 0.5, std: 0.125 });
    expect(e.exists_probability).toBe(0.8);
    expect(e.defaulted).toBe(true);
    expect(e.provenance).toStrictEqual({ source: 'cee_hypothesis' });
    expect(e).toStrictEqual(edge(unsized, 'pro_plan_price', 'price_sensitivity'));
  });
});

describe('§6: the CIL 0.5-signature detectors do not see a D6 placeholder, and still see the R6 signature', () => {
  it('the placeholder is counted only through its `defaulted` marker, never as the numeric signature', async () => {
    const { graph } = await register(t3(UNKNOWN));
    const nodes = graph.nodes as never;
    const edges = graph.edges as never;
    const placeholder = `${AI}->${CHURN}`;
    const signature = 'pro_plan_price->price_sensitivity';
    // With the producer's marker, the placeholder is counted (producer_declared)…
    expect(detectStrengthDefaults(nodes, edges).defaulted_edge_ids).toContain(placeholder);
    // …and without it, the numeric 0.5 / 0.125 signature does not match it, while it still matches the R6 edge.
    const unmarked = graph.edges.map(({ defaulted: _d, ...rest }) => rest) as never;
    expect(detectStrengthDefaults(nodes, unmarked).defaulted_edge_ids).not.toContain(placeholder);
    expect(detectStrengthDefaults(nodes, unmarked).defaulted_edge_ids).toContain(signature);
    expect(detectStrengthMeanDominant(nodes, edges).mean_defaulted_edge_ids).not.toContain(placeholder);
    expect(detectStrengthMeanDominant(nodes, edges).mean_defaulted_edge_ids).toContain(signature);
  });
});

/**
 * ⭐ THE CANVAS BAND CONTRACT (#70 5845713522 + R&C 5845818897): the size the edge CARRIES, said in natural units, with
 * the β it was written for as the staleness key. Bound by identity: `strength_mean` must equal THIS edge's own mean.
 * R6 above is the contrast: an unchanged edge's provenance is exactly `{ source }`, so no natural size speaks there.
 */
describe('natural_effect: the size the edge carries, in natural units, keyed to its own mean', () => {
  const natural = (e: Edge): Record<string, unknown> | undefined =>
    (e.provenance as { natural_effect?: Record<string, unknown> } | undefined)?.natural_effect;

  it('R1\'s estimate: −1 percentage point of churn per switch of AI, keyed to the edge\'s −0.01', async () => {
    const { graph } = await register(t3({ amount: -1, per: 1, by: 'ai_proposed' }));
    const e = edge(graph, AI, CHURN);
    expect(natural(e)).toStrictEqual({ amount: -1, unit: 'percentage points', per_source_change: 1, source_unit: 'switch', strength_mean: -0.01 });
    expect(natural(e)?.strength_mean).toBe(e.strength.mean);
  });

  it('R2\'s placeholder says the PLACEHOLDER\'s own size (−1 point), marked by `magnitude`', async () => {
    const { graph } = await register(t3(UNKNOWN));
    const e = edge(graph, AI, CHURN);
    expect(e.provenance?.magnitude).toBe('olumi_placeholder');
    expect(natural(e)).toStrictEqual({ amount: -1, unit: 'percentage points', per_source_change: 1, source_unit: 'switch', strength_mean: -0.01 });
    expect(natural(e)?.strength_mean).toBe(e.strength.mean);
  });

  it('R3: Olumi\'s set-aside "−6 points" never speaks — the edge says the placeholder\'s −1', async () => {
    const { graph } = await register(t3({ amount: -6, per: 1, by: 'ai_proposed' }));
    const e = edge(graph, AI, CHURN);
    expect(natural(e)?.amount).toBe(-1);
    expect(natural(e)?.strength_mean).toBe(e.strength.mean);
  });

  it('R4: the user\'s own "−6 points" is said exactly as they stated it, keyed to −0.06', async () => {
    const { graph } = await register(t3({ amount: -6, per: 1, by: 'explicit' }, 'explicit'));
    const e = edge(graph, AI, CHURN);
    expect(natural(e)).toStrictEqual({ amount: -6, unit: 'percentage points', per_source_change: 1, source_unit: 'switch', strength_mean: -0.06 });
  });
});
