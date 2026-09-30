/**
 * ⭐ THE FUNDING GOAL'S UNIT IS WRITTEN AS OLUMI'S READING, WITH THE BRIEF'S OWN SENTENCE (`@talchain/schemas` 0.67.0
 * `unit_reading`; PTL A; P0 SHARED DATA 5914707462; AIQ 5914471584 — "no Olumi reading ever travels as user_stated").
 *
 * Paul's brief states no funding target, but speaks of "investment firms that do deals between £1-2 million", so the
 * drafter types the goal in £. The goal node now says so as Olumi's reading, quoting that sentence; a goal whose own
 * target the brief writes in £ says `user_stated`; a unit the brief never writes gets no reading (unattested).
 *
 * Real path: strict candidate schema → `buildModelFromBrief` → the `/graph/register` body → `GraphV3.parse` → the goal.
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

async function build(wire: Record<string, unknown>): Promise<{ graph: Graph; out: Record<string, unknown> }> {
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
  const out = await buildModelFromBrief('76767676-7676-4767-8767-767676767676', BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out };
}

const goalOf = (g: Graph) => g.nodes.find((n) => n.kind === 'goal') as Record<string, unknown>;
const OLUMIS_75K = { amount: 75000, per: 1, by: 'ai_proposed' as Prov };

describe("the funding goal's unit is Olumi's reading, quoting the brief's sentence (0.67.0 unit_reading)", () => {
  it("RED: Paul's brief → the goal carries unit_reading {GBP, olumi_reading, the '£1-2 million' sentence}, and no value", async () => {
    const { graph } = await build(funding(OLUMIS_75K));
    expect(goalOf(graph).unit_reading).toEqual({
      unit: 'GBP', source: 'olumi_reading',
      source_quote: "We've been focused on investment firms that do deals between £1-2 million, mostly based in the UK",
    });
    expect(BRIEF).toContain((goalOf(graph).unit_reading as { source_quote: string }).source_quote);
  });

  it('CONTROL: the same brief with a goal whose unit is not money gets no reading (unattested)', async () => {
    const wire = funding(OLUMIS_75K);
    const { graph } = await build({ ...wire, goal: { ...wire.goal, unit: 'conversations' } });
    expect(goalOf(graph).unit_reading).toBeUndefined();
  });
});
