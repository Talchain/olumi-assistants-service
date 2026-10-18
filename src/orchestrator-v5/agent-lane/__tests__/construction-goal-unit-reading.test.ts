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
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

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
  const out = await buildModelFromBrief('76767676-7676-4767-8767-767676767676', brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out };
}

const SID = '76767676-7676-4767-8767-767676767677';
/** The real build with the drafter's request captured: the SENT instructions, the cold read and the raw register body. */
async function buildSent(wire: Record<string, unknown>, brief: string = BRIEF): Promise<{ sent: string; graph: Graph; raw: Record<string, unknown> }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let body: unknown = null;
  let sent = '';
  const call = (async (req: { instructions?: string }) => { sent ||= String(req.instructions); return { text: JSON.stringify(wire) }; }) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SID, brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { sent, graph: GraphV3.parse(body) as unknown as Graph, raw: body as Record<string, unknown> };
}

/** The request PLoT receives: the stored model loaded cold for the Run, the REAL Run handler, PLoT faked. */
async function preparedRequest(raw: Record<string, unknown>, brief: string = BRIEF): Promise<Record<string, any>> {
  const stored = GraphV3.parse(projectGraphForPersistence(raw)) as unknown as Record<string, unknown>;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'req-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(stored), briefText: brief }),
    loadGraph: async () => structuredClone(stored),
  } as never);
  let request: Record<string, any> = {};
  const plotRun = vi.fn(async (payload: Record<string, any>) => {
    request = structuredClone(payload);
    return { ...structuredClone(minimalFixture), inference_warnings: [],
      results: payload.options.map((o: Record<string, any>) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: 1 / payload.options.length })),
    } as unknown as V2RunResponseEnvelope;
  });
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot });
  await handler({ payload: { kind: 'message', scenario_id: SID, turn_id: 't-run' }, requestId: 'req-run', signal: new AbortController().signal,
    context: {}, orientationText: '' } as unknown as HandlerInvocation);
  expect(plotRun, 'PLoT was called exactly once').toHaveBeenCalledOnce();
  return request;
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

  // ⛔ ONE AUTHORITY FOR THE NODE (P0 PARTNER CR on #2381 @ 65d0d911, measured): the brief writes £85k, but a goal the
  // drafter marked `inferred` holds no user target (`threshold_source` absent), so its unit is Olumi's reading too.
  it.each([
    ['explicit', 'user_stated'],
    ['inferred', 'olumi_reading'],
  ] as const)('RED: target written in the brief, drafter goal %s → the node\'s own target authority decides: %s', async (prov, source) => {
    const brief = 'We need to raise at least £85k within 2 months.';
    const wire = funding(OLUMIS_75K);
    const { graph } = await build({ ...wire, goal: { ...wire.goal, target_stated: true, value: 85000, provenance: prov } }, brief);
    const goal = goalOf(graph);
    expect(goal.threshold_source === 'brief_extraction').toBe(prov === 'explicit');
    expect(goal.unit_reading).toEqual({ unit: 'GBP', source, source_quote: 'We need to raise at least £85k within 2 months' });
  });

  it('CONTROL: the same brief with a goal whose unit is not money gets no reading (unattested)', async () => {
    const wire = funding(OLUMIS_75K);
    const { graph } = await build({ ...wire, goal: { ...wire.goal, unit: 'conversations' } });
    expect(goalOf(graph).unit_reading).toBeUndefined();
  });

  // AIE item 6 (UNITS, 18 Oct) with its v3 absence clause: "When no unit is supported for that claim, set goal.unit to "" …". goal.unit
  // is a REQUIRED string in the sent schema, so "" is its one absence form: the strict schema takes it and admission saves no unit.
  it('AIE item 6 v3: the SENT instructions carry the absence clause once (the v2 clause it replaces is gone)', async () => {
    const T1 = JSON.parse(readFileSync('tests/fixtures/sys2/aie-t1-producer-text-v1.json', 'utf8')) as { goal_unit_absence: { find: string; replace: string } };
    const { sent } = await buildSent(funding(OLUMIS_75K));
    expect(sent.split(T1.goal_unit_absence.replace)).toHaveLength(2);
    expect(sent).not.toContain(T1.goal_unit_absence.find);
  });

  it('AIE item 6 v3: a goal unit left "" is accepted, and neither the cold read nor the prepared Run request holds a unit or a unit reading', async () => {
    const wire = funding(OLUMIS_75K);
    const { graph, raw } = await buildSent({ ...wire, goal: { ...wire.goal, unit: '' } });
    const goal = goalOf(graph);
    expect(goal.label).toBe('securing funding');
    expect(goal).not.toHaveProperty('goal_threshold_unit');
    expect(goal.unit_reading).toBeUndefined();
    // The prepared request: the stored model, loaded cold by the real Run handler (PLoT faked); the SAME goal, by id.
    const request = await preparedRequest(raw);
    const sentGoal = (request.graph.nodes as Record<string, unknown>[]).find((n) => n.id === goal.id);
    expect(sentGoal, 'PRECONDITION: the goal is in the request').toBeDefined();
    expect(sentGoal).not.toHaveProperty('goal_threshold_unit');
    expect(sentGoal).not.toHaveProperty('unit_reading');
    expect(JSON.stringify(sentGoal)).not.toMatch(/"unit"\s*:\s*"[^"]/u);
  });

  it('CONTRAST (the probe sees a unit): the same draft with goal.unit "£" carries it to the cold read and the prepared request', async () => {
    const { graph, raw } = await buildSent(funding(OLUMIS_75K));
    const goal = goalOf(graph);
    expect(goal.goal_threshold_unit).toBe('£');
    const sentGoal = ((await preparedRequest(raw)).graph.nodes as Record<string, unknown>[]).find((n) => n.id === goal.id);
    expect(JSON.stringify(sentGoal)).toMatch(/"(goal_threshold_)?unit"\s*:\s*"[^"]/u);
  });
});
