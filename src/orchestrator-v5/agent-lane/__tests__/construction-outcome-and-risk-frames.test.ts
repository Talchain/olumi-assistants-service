/**
 * ⭐ A QUANTITY OUTCOME, AND A RISK'S EXPOSURE, CARRY THE FRAME A FACTOR DOES (DL #75 5916155976 (a); R3 5916156932 (b)).
 *
 * SERVED (Paul's funding build, R3 accept-paul `base-1449Z`): both links into `securing_funding` came from frameless
 * nodes — the outcome "Qualified investor conversations" and the risk "Fundraising distraction". The drafter's schema gave
 * outcomes and risks only `{label, provenance}`, so `resolveMagnitudeFrame` had nothing to read and every size through
 * them was `unconvertible`, even after the goal had a £ frame: under #2371 the goal could never become target-testable
 * through its links. Now an outcome or a risk may carry `unit` + `plausible_max`, framed exactly as a factor with no
 * baseline (`scale_frame`), and a risk that bears on a money goal is drafted as its money exposure.
 *
 * Real path: strict candidate schema → `buildModelFromBrief` → the `/graph/register` body → `GraphV3.parse` → edges by id.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, strictForTheDrafter, type CallStructuredModel } from '../runtime/build-model.js';
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
  const out = await buildModelFromBrief('77787778-7778-4777-8777-777877787778', BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out };
}

const CONV = 'qualified_investor_conversations';
const GOAL = 'securing_funding';
type E = Graph['edges'][number] & { provenance?: { magnitude?: string; natural_effect?: { amount_unit?: string } } };
const edge = (g: Graph, from: string, to: string) => g.edges.find((x) => x.from === from && x.to === to) as E | undefined;

/** Paul's shape with a stated £1.2m target (so the goal has a £ frame) and Olumi's £30,000 per conversation. */
function framed(outcome: { unit: string | null; plausible_max: number | null }, extra: { risk?: Record<string, unknown>; riskLink?: Record<string, unknown> } = {}) {
  const wire = funding({ amount: 30000, per: 1, by: 'ai_proposed' }) as Record<string, any>;
  return {
    ...wire,
    goal: { ...wire.goal, target_stated: true, value: 1200000, unit: '£', operator: '>=' },
    outcomes: wire.outcomes.map((o: Record<string, unknown>) => ({ ...o, ...outcome })),
    risks: extra.risk === undefined ? wire.risks.map((r: Record<string, unknown>) => ({ ...r, unit: null, plausible_max: null })) : [extra.risk],
    links: extra.riskLink === undefined ? wire.links
      : [...wire.links.filter((l: { from: string }) => l.from !== 'Fundraising distraction'), extra.riskLink],
  };
}

describe('a quantity outcome and a risk exposure carry a frame, so sizes through them convert (DL 5916155976, R3 5916156932)', () => {
  it('RED: conversations framed (conversations, 0–20) → Olumi\'s £30,000 per conversation into the £ goal is SIZED, with a natural effect in £', async () => {
    const { graph } = await build(framed({ unit: 'conversations', plausible_max: 20 }));
    const e = edge(graph, CONV, GOAL);
    expect(e, JSON.stringify(graph.edges.map((x) => `${x.from}->${x.to}`))).toBeDefined();
    expect(e!.provenance?.magnitude).toBe('olumi_estimate');
    expect(e!.provenance?.natural_effect?.amount_unit).toBe('£');
    expect((graph.nodes.find((n) => n.id === CONV) as Record<string, unknown>).scale_frame).toBe(20);
  });

  it('CONTROL: the same outcome with no unit/range → the size stays unconvertible and is set aside, exactly as before', async () => {
    const { graph, out } = await build(framed({ unit: null, plausible_max: null }));
    expect(edge(graph, CONV, GOAL)!.provenance?.natural_effect).toBeUndefined();
    expect((graph.nodes.find((n) => n.id === CONV) as Record<string, unknown>).scale_frame).toBeUndefined();
    expect(out.set_aside_estimates).toEqual([expect.objectContaining({ from: CONV, to: GOAL })]);
  });

  it('RED (R3 (b)): a risk drafted as its £ EXPOSURE ("Funding lost to distraction", £, 0–500,000) sizes £ → £ into the goal', async () => {
    const risk = { label: 'Funding lost to distraction', provenance: 'inferred', unit: '£', plausible_max: 500000 };
    const riskLink = { from: 'Funding lost to distraction', to: 'securing funding', direction: 'negative', provenance: 'inferred',
      effect_amount: -1, effect_per_source_change: 1, effect_provenance: 'ai_proposed' };
    const wire = framed({ unit: 'conversations', plausible_max: 20 }, { risk, riskLink });
    wire.links = wire.links.map((l: Record<string, unknown>) => (l.to === 'Fundraising distraction' ? { ...l, to: 'Funding lost to distraction' } : l));
    const { graph } = await build(wire);
    const e = edge(graph, 'funding_lost_to_distraction', GOAL);
    expect(e, JSON.stringify(graph.edges.map((x) => `${x.from}->${x.to}`))).toBeDefined();
    expect(e!.provenance?.natural_effect?.amount_unit).toBe('£');
  });
});

/**
 * ⭐ OPTION D (DL 5916270318): the frames are REQUIRED only in the schema sent to OpenAI. A candidate recorded before the
 * frames existed (served lsF-A0, 29 Sep: its risk and outcome carry only label + provenance) still validates against the
 * candidate contract, and builds to exactly what the same candidate builds to with both keys null.
 */
describe('strict only at the OpenAI boundary: a candidate recorded before the frames builds exactly as today (DL 5916270318)', () => {
  const recorded = JSON.parse(readFileSync(new URL('./fixtures/lsF-A0-candidate-20260929.json', import.meta.url), 'utf8')) as {
    brief: string; candidate: Record<string, unknown> & { risks: Record<string, unknown>[]; outcomes: Record<string, unknown>[] };
  };

  async function registered(candidate: unknown): Promise<{ graph: unknown; out: unknown; sent: Record<string, unknown>[] }> {
    let graph: unknown = null;
    const sent: Record<string, unknown>[] = [];
    const call = (async (req: { schema: Record<string, unknown> }) => { sent.push(req.schema); return { text: JSON.stringify(candidate) }; }) as unknown as CallStructuredModel;
    const d: InternalDispatch = async (path, b) => {
      if (path.endsWith('/graph/register')) {
        graph = structuredClone((b as { graph: unknown }).graph);
        return { status: 200, json: { model_version: { version_number: 1 } } };
      }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const out = await buildModelFromBrief('77787778-7778-4777-8777-777877787779', recorded.brief, d, call);
    return { graph, out, sent };
  }

  // The recorded draft also predates the goal's `frame` key, so the contract is checked on its outcomes and risks only.
  it('the recorded candidate has no frame keys: the contract finds nothing on its outcomes or risks; the schema SENT would', () => {
    for (const x of [...recorded.candidate.risks, ...recorded.candidate.outcomes]) {
      expect('unit' in x || 'plausible_max' in x, JSON.stringify(x)).toBe(false);
    }
    const onFrames = (errors: { instancePath: string }[] | null | undefined) => (errors ?? []).filter((e) => /^\/(risks|outcomes)\//.test(e.instancePath));
    const contract = new Ajv({ strict: false, allErrors: true }).compile(buildCandidateSchema());
    contract(recorded.candidate);
    expect(onFrames(contract.errors)).toEqual([]);
    const sent = new Ajv({ strict: false, allErrors: true }).compile(strictForTheDrafter(buildCandidateSchema()));
    expect(sent(recorded.candidate)).toBe(false);
    expect(onFrames(sent.errors).map((e) => (e as { params?: { missingProperty?: string } }).params?.missingProperty).sort())
      .toEqual(['plausible_max', 'plausible_max', 'unit', 'unit']);
  });

  it('what is SENT requires both keys on every outcome and risk; every other object is sent byte for byte as the contract', async () => {
    const { sent } = await registered(recorded.candidate);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const items = (s: Record<string, unknown>, k: string) => ((s.properties as Record<string, { items: { required: string[] } }>)[k]!.items);
    for (const s of sent) for (const k of ['risks', 'outcomes']) expect(items(s, k).required).toEqual(['label', 'provenance', 'unit', 'plausible_max']);
    const contract = buildCandidateSchema();
    const back = structuredClone(sent[0]!);
    for (const k of ['risks', 'outcomes']) items(back, k).required = ['label', 'provenance'];
    expect(JSON.stringify(back)).toBe(JSON.stringify(contract));
  });

  it('RED-guard: the recorded candidate builds to EXACTLY what it builds to with both keys null (graph and result)', async () => {
    const nulls = {
      ...recorded.candidate,
      risks: recorded.candidate.risks.map((r) => ({ ...r, unit: null, plausible_max: null })),
      outcomes: recorded.candidate.outcomes.map((o) => ({ ...o, unit: null, plausible_max: null })),
    };
    const a = await registered(recorded.candidate);
    const b = await registered(nulls);
    expect((a.out as { ok?: boolean }).ok, JSON.stringify(a.out)).toBe(true);
    expect(a.graph).toEqual(b.graph);
    expect(a.out).toEqual(b.out);
    const nodes = (a.graph as { nodes: Record<string, unknown>[] }).nodes.filter((n) => n.kind === 'risk' || n.kind === 'outcome');
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    for (const n of nodes) expect(n.scale_frame, String(n.id)).toBeUndefined();
  });
});
