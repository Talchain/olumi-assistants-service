/**
 * ⭐ A LINK THAT HOLDS BY DEFINITION IS TYPED, CHECKED, NEVER CLAIMED (DL #75 5916504679; R3 5916476294 / 5916525389).
 *
 * Paul's funding shape with a risk drafted as its £ exposure (R3 (b)): "Funding lost to distraction" → "securing funding"
 * is −£1 per £1 by definition. Typed as Olumi's guess, it would make the goal ask Paul to size a definition. The drafter
 * says `definitional: true`; the edge carries `provenance.definitional` ONLY when its natural size proves it (±1, one unit
 * at both ends). R3's three controls (5916525389), RED-first on the real path: strict candidate schema →
 * `buildModelFromBrief` → the `/graph/register` body → `GraphV3.parse` → the edge by id.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, strictForTheDrafter, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[] };
type Prov = 'explicit' | 'inferred' | 'ai_proposed';

const BRIEF =
  "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it. We need to raise at least £1.2m.';

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
    risks: [{ label: 'Fundraising distraction', provenance: 'inferred', unit: null, plausible_max: null }],
    outcomes: [{ label: 'Qualified investor conversations', provenance: 'inferred', unit: null, plausible_max: null }],
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

async function build(wire: Json, brief: string = BRIEF): Promise<Graph> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('59165046-0000-4000-8000-000000000001', brief, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return GraphV3.parse(registered) as unknown as Graph;
}

const RISK = 'Funding lost to distraction';
const GOAL = 'securing_funding';
const RISK_ID = 'funding_lost_to_distraction';

/** Paul's shape with a £1.2m target, the risk drafted as its exposure, and its one link into the goal. */
function exposure(o: { unit?: string; amount?: number; definitional?: boolean | null } = {}): Json {
  const wire = funding({ amount: 30000, per: 1, by: 'ai_proposed' }) as Json;
  return {
    ...wire,
    goal: { ...wire.goal, target_stated: true, value: 1200000, unit: '£', operator: '>=' },
    outcomes: wire.outcomes.map((x: Json) => ({ ...x, unit: 'conversations', plausible_max: 20 })),
    risks: [{ label: RISK, provenance: 'inferred', unit: o.unit ?? '£', plausible_max: 500000 }],
    links: [
      ...wire.links.filter((l: Json) => l.from !== 'Fundraising distraction' && l.to !== 'Fundraising distraction'),
      { from: 'Funding process overhead', to: RISK, direction: 'positive', provenance: 'inferred',
        effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: RISK, to: 'securing funding', direction: 'negative', provenance: 'inferred',
        effect_amount: o.amount ?? -1, effect_per_source_change: 1, effect_provenance: 'ai_proposed',
        ...(o.definitional === undefined ? {} : { definitional: o.definitional }) },
    ],
  };
}
const riskEdge = (g: Graph) => g.edges.find((e) => e.from === RISK_ID && e.to === GOAL);

describe('a definitional link is typed only when its own size proves it (DL 5916504679)', () => {
  it('RED: −1 £ per £, tagged by the drafter → the edge carries definitional; who sized it is unchanged', async () => {
    const e = riskEdge(await build(exposure({ definitional: true })));
    expect(e, 'the risk\'s link into the goal').toBeDefined();
    expect(e!.provenance?.natural_effect?.amount_unit).toBe('£');
    expect(e!.provenance?.definitional).toBe(true);
    expect(e!.provenance?.magnitude).toBe('olumi_estimate');
  });

  it('RED (the DL\'s guard): tagged, but the risk is read in hours/week → NOT definitional (units do not match)', async () => {
    const e = riskEdge(await build(exposure({ definitional: true, unit: 'hours/week' })));
    expect(e).toBeDefined();
    expect(e!.provenance?.definitional).toBeUndefined();
  });

  it('guard: tagged, but −0.4 £ per £ → NOT definitional (a definition moves the target by exactly one unit)', async () => {
    const e = riskEdge(await build(exposure({ definitional: true, amount: -0.4 })));
    expect(e).toBeDefined();
    expect(e!.provenance?.definitional).toBeUndefined();
  });

  it('CONTROL: −1 £ per £ the drafter did NOT tag → NOT definitional (never inferred from the numbers alone)', async () => {
    for (const definitional of [null, false, undefined]) {
      const e = riskEdge(await build(exposure({ definitional })));
      expect(e, String(definitional)).toBeDefined();
      expect(e!.provenance?.definitional, String(definitional)).toBeUndefined();
    }
  });

  it('the key is optional in the contract (a recorded candidate validates) and required in what is SENT', () => {
    const recorded = JSON.parse(readFileSync(new URL('./fixtures/lsF-A0-candidate-20260929.json', import.meta.url), 'utf8')).candidate as Json;
    const onLinks = (errors: { instancePath: string }[] | null | undefined) => (errors ?? []).filter((x) => /^\/links\//.test(x.instancePath));
    const contract = new Ajv({ strict: false, allErrors: true }).compile(buildCandidateSchema());
    contract(recorded);
    expect(onLinks(contract.errors)).toEqual([]);
    const sent = new Ajv({ strict: false, allErrors: true }).compile(strictForTheDrafter(buildCandidateSchema()));
    sent(recorded);
    expect(onLinks(sent.errors).length).toBe((recorded.links as unknown[]).length);
  });
});
