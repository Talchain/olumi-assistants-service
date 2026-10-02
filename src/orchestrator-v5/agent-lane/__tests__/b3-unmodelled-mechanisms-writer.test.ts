/**
 * B3-4 (PROSE = TYPE) and the writer half of B3-1 / B3-3 / B3-5, end to end at 0 LLM.
 *
 * The Agent DECLARES what an option does not model (`unmodelled_mechanisms`) on the two tools that created Paul's two
 * defective options — `propose_new_option` (per-seat pricing) and `propose_option_interventions` (the introductory
 * offer) — and the approved option node must carry it (`unresolved_targets` + `user_questions`) through the REAL
 * approval and the REAL commit, read back from the stored graph; the Run built from that stored graph must then leave
 * the option out of the comparison with a typed reason. Clearing the declaration (`[]`) must put it back (B3-5).
 *
 * HARNESS (not a self-authored model of either route): the REAL `agentV1TurnRoute` and the REAL `ceeOrchestratorRouteV2`
 * on one Fastify app — the add-option hold, its confirm (`commitGmHeldResume`) and the level door
 * (`commitOptionLevelsInProcess`) are production code. The session store keeps rows and the committed graph with the
 * production READ semantics the writers check (pending actions from the latest answer row, JSONB key order). OpenAI is
 * a script of tool calls; any other network call, and any use of route-v2's LLM router, fails the test.
 * Shape from `agent-add-option-held-seam.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { B3_IDS as I, B3_LABELS as L, b3PricingGraph } from '../../tools/handlers/__tests__/fixtures/b3-pricing-shape.js';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `b3b3b3b3-4a4f-4e5d-8c6b-7a8f9e0d2c${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
const jsonbOrder = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(jsonbOrder)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
      : v;
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  const raw = row ? (jsonbOrder(JSON.parse(JSON.stringify(row.pending_actions))) as unknown[]) : [];
  return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
let tick = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 9, 3, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id))
    .flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact })))),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  storeDraftGraph: vi.fn(async (sid: string, g: unknown) => { graphOf.set(sid, g); }),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

type Chip = { id: string; label: string; message: string; detail?: string };
type Body = { assistant_text: string; suggested_actions: Chip[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string }[] } };
type Rec = Record<string, any>;

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

/** The served pricing shape with the decision linked, as the Agent reads it before writing. */
function seed(opts: { introWithoutLevels?: boolean; perSeatFactor?: boolean } = {}): Rec {
  const g = b3PricingGraph({ withoutPerSeat: true, ...(opts.introWithoutLevels === true ? {} : { withoutIntro: true }) });
  if (opts.introWithoutLevels === true) {
    const intro = (g.nodes as Rec[]).find((x) => x.id === I.intro)!;
    delete intro.interventions;
    g.edges = (g.edges as Rec[]).filter((e) => !(e.from === I.intro && e.to === I.price));
  }
  if (opts.perSeatFactor !== true) return { ...g, goal_node_id: I.goal };
  // Per-seat's own factor, for the new option to act on (the Agent added it in the served session).
  (g.nodes as Rec[]).push({ id: I.perSeatPrice, kind: 'factor', label: 'Pro price per seat', category: 'controllable',
    observed_state: { value: 0, raw_value: 0, cap: 100, unit: 'GBP/seat/month', declared_scale: 'unit_interval', source: 'user' } });
  (g.edges as Rec[]).push({ from: I.perSeatPrice, to: I.goal, strength: { mean: 0.5, std: 0.125 }, exists_probability: 1, effect_direction: 'positive' });
  return { ...g, goal_node_id: I.goal };
}

describe('B3-4 — what the Agent declares missing is carried by the approved option node, and the Run reads it', () => {
  async function buildApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { computeGraphIdentityHash } = await import('../../context/graph-identity.js');
    const a = Fastify({ logger: false });
    a.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never),
        graph_identity_hash: g === null ? null : computeGraphIdentityHash(g as never) };
    });
    await a.register(ceeOrchestratorRouteV2);
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (!String(url).includes('openai')) throw new Error(`non-OpenAI network call: ${String(url)}`);
      openAiCalls += 1;
      const next = script.shift();
      return new Response(JSON.stringify(next !== undefined ? next({}) : say('Done.')), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildApp();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const approve = async (b: Body): Promise<Body> => {
    const chip = b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(chip?.id, JSON.stringify({ chips: b.suggested_actions, tools: b._agent.tool_calls })).toBeDefined();
    return turn({ message: chip!.message, source: 'chip', chip: { id: chip!.id } });
  };
  const node = (id: string): Rec | undefined => ((graphOf.get(SCENARIO) as Rec).nodes as Rec[]).find((x) => x.id === id);
  const nodeByLabel = (label: string): Rec | undefined => ((graphOf.get(SCENARIO) as Rec).nodes as Rec[]).find((x) => x.label === label);
  /** The stored graph → the real Run loader + run_analysis handler; the ids PLoT would be sent, and the gate's exclusions. */
  const runStored = async (): Promise<{ sent: string[]; excluded: Rec[] }> => {
    const { loadScenarioSnapshotForRunAnalysis } = await import('../../build-turn-context.js');
    const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
    const { createNoopSessionStore } = await import('../../session/__tests__/fixtures.js');
    const { makeMessagePayload } = await import('../../__tests__/fixtures.js');
    const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Rec;
    const bodies: Rec[] = [];
    const handler = createRunAnalysisHandler({
      plotClient: { validatePatch: vi.fn().mockResolvedValue({}), run: vi.fn(async (body: Rec) => {
        bodies.push(body);
        return { ...structuredClone(happy), fact_objects: [], review_cards: [],
          results: (body.options as Rec[]).map((o, i) => ({ option_id: o.option_id, option_label: o.label, win_probability: 1 / (i + 2), percentile_p10: 0.1, percentile_p90: 0.9 })) };
      }) } as never,
      scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'b3-w', createNoopSessionStore({ loadGraphResult: structuredClone(graphOf.get(SCENARIO)) })),
    });
    const out = await handler({
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
        request_id: 'b3-w', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: makeMessagePayload({ turn_id: 'b3-w', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'b3-w', signal: new AbortController().signal, orientationText: '',
    } as never) as unknown as Rec;
    return { sent: ((bodies[0]?.options ?? []) as Rec[]).map((o) => o.option_id), excluded: (out.__excluded_options ?? []) as Rec[] };
  };

  it('propose_new_option (per-seat, "billable seats" declared) → one approval → the stored node carries it → the Run leaves per-seat out', async () => {
    graphOf.set(SCENARIO, seed({ perSeatFactor: true }));
    script = [
      () => fnCall('propose_new_option', {
        label: L.perSeat,
        acts_on: [{ factor_label: 'Pro price per seat', direction: 'positive', level: { value: 10, unit: 'GBP/seat/month' } }],
        unmodelled_mechanisms: ['billable seats'],
        rationale: 'The user asked for it.',
      }),
      () => say('I would add per-seat pricing at £10 per seat; billable seats are not modelled yet, so it stays out of the comparison. Add it?'),
    ];
    const t1 = await turn({ message: `Add an option: ${L.perSeat}, at £10 per seat.` });
    expect(nodeByLabel(L.perSeat), 'nothing is written before the approval').toBeUndefined();
    const t2 = await approve(t1);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const added = nodeByLabel(L.perSeat);
    expect(added, JSON.stringify((graphOf.get(SCENARIO) as Rec).nodes)).toBeDefined();
    expect(added!.unresolved_targets).toEqual(['billable seats']);
    expect((added!.user_questions as string[]).join(' ')).toContain('billable seats');
    const run = await runStored();
    expect(run.sent).not.toContain(added!.id);
    expect(run.excluded).toEqual([expect.objectContaining({ option_id: added!.id, reason: 'incomplete', missing: ['billable seats'] })]);
    expect(routerCalls).toEqual([]);
  }, 180_000);

  it('propose_option_interventions (the free month declared) → one approval → the stored node carries it → the Run leaves the offer out as incomplete; then [] clears it (B3-5)', async () => {
    graphOf.set(SCENARIO, seed({ introWithoutLevels: true }));
    const say59 = `For "${L.intro}": it sets Pro plan price to £59.`;
    script = [
      () => fnCall('propose_option_interventions', { interventions: [{
        option_label: L.intro, factor_label: 'Pro plan price', value: 59, unit: 'GBP/month', basis: 'the user: £59', user_stated: true,
        unmodelled_mechanisms: ['free first month'],
      }] }),
      () => say('This records £59; the free first month is not modelled yet, so the offer stays out of the comparison. Approve?'),
    ];
    const t1 = await turn({ message: say59 });
    const proposed = t1._agent.tool_calls.find((c) => c.name === 'propose_option_interventions');
    expect(proposed?.ok, JSON.stringify(t1._agent.tool_calls)).toBe(true);
    const t2 = await approve(t1);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(node(I.intro)!.unresolved_targets).toEqual(['free first month']);
    expect((node(I.intro)!.user_questions as string[]).join(' ')).toContain('free first month');
    // The line beneath the reply says why it is left out — never "until its levels are set" (its level IS set).
    expect(t2.assistant_text).toContain(`The analysis can run now; it will leave out "${L.intro}" until it models the free first month.`);
    expect(JSON.stringify(node(I.intro)!.interventions)).toMatch(/0\.295/);
    const run = await runStored();
    expect(run.sent).toEqual([I.keep, I.p59, I.p54]);
    expect(run.excluded).toEqual([{ option_id: I.intro, label: L.intro, reason: 'incomplete', missing: ['free first month'] }]);

    // B3-5 — the declaration is CLEARED with [] on the same (unchanged) level: nothing stale survives. The offer is then
    // complete — and byte-identical to £59, so B3-2 names it as that option's twin rather than ranking two copies.
    script = [
      () => fnCall('propose_option_interventions', { interventions: [{
        option_label: L.intro, factor_label: 'Pro plan price', value: 59, unit: 'GBP/month', basis: 'the user: £59', user_stated: true,
        unmodelled_mechanisms: [],
      }] }),
      () => say('This records that nothing about the offer is left unmodelled. Approve?'),
    ];
    const t3 = await turn({ message: say59 });
    expect(t3._agent.tool_calls.find((c) => c.name === 'propose_option_interventions')?.ok, JSON.stringify(t3._agent.tool_calls)).toBe(true);
    const t4 = await approve(t3);
    expect(t4._agent.tool_calls, JSON.stringify(t4._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(node(I.intro)!.unresolved_targets).toBeUndefined();
    expect(node(I.intro)!.user_questions).toBeUndefined();
    const rerun = await runStored();
    expect(rerun.excluded).toEqual([expect.objectContaining({ option_id: I.intro, reason: 'duplicate', duplicate_of: I.p59 })]);
  }, 180_000);
});
