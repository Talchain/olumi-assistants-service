/**
 * ⛔ OLUMI'S SIZE THAT NO EDGE CARRIES IS NEVER A MODEL INPUT (AIQ 5914222384; MG trace 5914192157).
 *
 * SERVED (Paul's funding brief, R3's accept-paul base-1449Z, CEE `fbfc63d1`): the drafter sized "Qualified investor
 * conversations → securing funding" at £75,000 per conversation. Neither end has a range the magnitude contract can read,
 * so the edge carries today's placeholder (0.5) and the £75,000 is in NO edge. Turn 1 still said the first pass was
 * "built on Olumi assumptions: … and £75,000 per qualified conversation". What reached the Agent: the drafter's own
 * question ("The provisional estimate of £75,000 per conversation is highly uncertain") and a ledger note that did
 * not say whose size it was.
 *
 * Fixed at the INPUT, not by an egress rewriter (#2354's failed 8/9 phrasings): the size is typed as set aside
 * (`set_aside_estimates`), said in `not_represented` as "Olumi's guess, set aside: NOT in the model", asked once in the
 * contract's own words, and the drafter's question quoting the same amount is not shown beside it.
 *
 * Real path: the strict candidate schema → `buildModelFromBrief` with a faked drafter → the `/graph/register` body →
 * `GraphV3.parse` → the edge by id. The served LLM reply is NOT witnessed here (UNVERIFIED until a served turn).
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Edge = Record<string, unknown> & { from: string; to: string; strength: { mean: number; std: number }; provenance?: { magnitude?: string } };
type Graph = { nodes: (Record<string, unknown> & { id: string; kind: string })[]; edges: Edge[] };
type Prov = 'explicit' | 'inferred' | 'ai_proposed';

/** Paul's 506-character brief, verbatim (R3 `accept-paul/paul-scenario-read.json`). */
const BRIEF =
  "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it.';

const DRAFTER_75K = 'How much funding, on average, does a qualified investor conversation produce within two months? '
  + 'The provisional estimate of £75,000 per conversation is highly uncertain.';
const DRAFTER_RUNWAY = 'What is the available cash runway and the minimum bridge amount needed to avoid running out of money?';

const link = (from: string, to: string, direction: 'positive' | 'negative', size?: { amount: number; per: number; by: Prov }) => ({
  from, to, direction, provenance: 'inferred' as Prov,
  effect_amount: size?.amount ?? null, effect_per_source_change: size?.per ?? null, effect_provenance: size?.by ?? null,
});

/** The served build's shape by label (base-1449Z `02-cold-after-build.json`); only the £-per-conversation size varies. */
function funding(conversationsToFunding: { amount: number; per: number; by: Prov }) {
  return {
    goal: {
      metric: 'securing funding', operator: '>=', target_stated: false, frame: 'level', value: null, unit: '£', horizon_months: 2,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Current outreach', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Angel bridge outreach', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Angel investor outreach', value: 20, value_kind: 'absolute', unit: 'prospects/month', provenance: 'ai_proposed' },
        { factor_label: 'Funding process overhead', value: 12, value_kind: 'absolute', unit: 'hours/week', provenance: 'ai_proposed' },
      ] },
      { label: 'Angel outreach pilot', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Angel investor outreach', value: 10, value_kind: 'absolute', unit: 'prospects/month', provenance: 'ai_proposed' },
        { factor_label: 'Funding process overhead', value: 10, value_kind: 'absolute', unit: 'hours/week', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'UK investment-firm outreach', role: 'observable', baseline_known: true, baseline_value: 30, unit: 'prospects/month', provenance: 'ai_proposed', plausible_max: 200 },
      { label: 'Warm introductions', role: 'observable', baseline_known: true, baseline_value: 4, unit: 'introductions/month', provenance: 'ai_proposed', plausible_max: 50 },
      { label: 'Angel investor outreach', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'prospects/month', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Funding process overhead', role: 'controllable', baseline_known: true, baseline_value: 8, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 80 },
    ],
    risks: [{ label: 'Fundraising distraction', provenance: 'inferred' }],
    outcomes: [{ label: 'Qualified investor conversations', provenance: 'inferred' }],
    links: [
      link('UK investment-firm outreach', 'Qualified investor conversations', 'positive'),
      link('Warm introductions', 'Qualified investor conversations', 'positive'),
      link('Angel investor outreach', 'Qualified investor conversations', 'positive'),
      link('Funding process overhead', 'Qualified investor conversations', 'negative'),
      link('Funding process overhead', 'Fundraising distraction', 'positive'),
      link('Fundraising distraction', 'securing funding', 'negative'),
      link('Qualified investor conversations', 'securing funding', 'positive', conversationsToFunding),
    ],
    identities: [],
    unknowns: [DRAFTER_75K, DRAFTER_RUNWAY],
    decision_question: null,
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function build(wire: Record<string, unknown>, brief: string = BRIEF): Promise<{ graph: Graph; out: Record<string, unknown> }> {
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
  const out = await buildModelFromBrief('75757575-7575-4757-8757-757575757575', brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out };
}

const CONV = 'qualified_investor_conversations';
const GOAL = 'securing_funding';
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
const OLUMIS_75K = { amount: 75000, per: 1, by: 'ai_proposed' as Prov };

describe("Olumi's £75,000 per conversation, which no edge carries, reaches the Agent as set aside — never as an input", () => {
  it('RED: typed in `set_aside_estimates`, said as "Olumi\'s guess, set aside: NOT in the model", and the edge holds no £75,000', async () => {
    const { graph, out } = await build(funding(OLUMIS_75K));
    const e = graph.edges.find((x) => x.from === CONV && x.to === GOAL);
    expect(e, 'conversations -> funding').toBeDefined();
    expect(Math.abs(e!.strength.mean)).toBe(0.5);                    // the placeholder, not the £75,000
    expect(JSON.stringify(e)).not.toMatch(/75000|75,000/);
    expect(out.set_aside_estimates).toEqual([{
      from: CONV, to: GOAL, estimate: expect.stringMatching(/75,?000/), status: 'set_aside_not_in_model',
    }]);
    const said = strings(out.not_represented).filter((s) => /75,?000/.test(s));
    expect(said, JSON.stringify(out.not_represented)).toHaveLength(1);
    expect(said[0]).toMatch(/^Olumi's guess, set aside: NOT in the model: /);
  });

  it('RED: asked ONCE, in words that never place it in the model; the drafter\'s "provisional estimate of £75,000" question is not shown', async () => {
    const { out } = await build(funding(OLUMIS_75K));
    const qs = strings(out.open_questions);
    const quoting = qs.filter((q) => /75,?000/.test(q));
    expect(quoting, JSON.stringify(qs)).toHaveLength(1);
    expect(quoting[0]).toMatch(/^Olumi's starting guess is that .*75,?000.*, but the model doesn't hold it yet\. How much does "Qualified investor conversations" change "securing funding"\?$/);
    expect(qs).not.toContain(DRAFTER_75K);
    expect(qs).toContain(DRAFTER_RUNWAY);                             // CONTROL: an unrelated drafter question stays
  });

  it('RED (AIQ #2383): £75,000 tagged explicit but written nowhere in the brief is Olumi\'s guess, set aside exactly as one', async () => {
    const { out } = await build(funding({ amount: 75000, per: 1, by: 'explicit' }));
    expect(out.set_aside_estimates).toEqual([expect.objectContaining({ to: 'securing_funding' })]);
  });

  // The user's own size is theirs only where the brief WRITES it (AIQ #2383 5916497454).
  it('CONTROL: the same size stated by the USER is not typed as Olumi\'s set-aside guess', async () => {
    const { out } = await build(funding({ amount: 75000, per: 1, by: 'explicit' }), `${BRIEF} Each qualified conversation brings in £75,000.`);
    expect(out.set_aside_estimates).toBeUndefined();
    expect(strings(out.not_represented).some((s) => s.startsWith("Olumi's guess, set aside"))).toBe(false);
    expect(strings(out.open_questions).some((q) => q.startsWith("Olumi's starting guess"))).toBe(false);
  });

  it('CONTROL: with no size stated at all, nothing is set aside and the drafter\'s own questions pass through', async () => {
    const wire = funding(OLUMIS_75K);
    const unsized = { ...wire, links: wire.links.map((l) => ({ ...l, effect_amount: null, effect_per_source_change: null, effect_provenance: null })) };
    const { out } = await build(unsized);
    expect(out.set_aside_estimates).toBeUndefined();
    expect(strings(out.open_questions)).toContain(DRAFTER_75K);
  });
});
