/** Outcome-door rows (P14-O) live on branch dl/p14-widen-factor-outcome @157fe4fd; they return with that slice (DL ruling B; Science ruled (A) with a stamp). */
/** P14 RED-first. Harness copied from widen-risks-seam.test.ts: both real routes; only store/network mocked. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { asSent } from './helpers/as-sent.js';
import { readFileSync } from 'node:fs';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5a0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d2c${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
/** The latest ANSWER row for a scenario — claim rows excluded, exactly as the production read excludes them. */
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
/** What a Postgres `jsonb` column gives back: keys shorter-first then bytewise, `undefined` dropped. */
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
        // Stored with the turn, as `append_turn_atomic` does, so a writer's own read-back of its fact is served.
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 8, 26, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  // The production shape (`supabase-store.ts` readFactsWithTurnFor): each stored fact with the id of the turn row it rode on.
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id))
    .flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact })))),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
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
/** route-v2's LLM router: the typed add-option and its confirm are deterministic — ANY use is a failure. */
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the typed add-option seam (${what})`); };
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
type Body = { assistant_text: string; suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string }; _provider_calls?: { provider: string; outcome?: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string; conflict_fields?: string[]; rejected_levels?: Record<string, unknown>[] }[] } };

/** Scripted OpenAI: each Agent model call takes the next reply; anything that is not OpenAI throws. */
let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The inner requests the Agent sent to route-v2, in order. */
let inner: Record<string, unknown>[] = [];
/** Runs inside the inner request's preHandler — BEFORE route-v2 reads the store (a writer racing the confirm). */
let onInner: ((body: Record<string, unknown>) => void) | undefined;
/** Runs as route-v2's answer to an inner request is sent — AFTER it has decided. */
let onInnerSent: ((body: Record<string, unknown>) => void) | undefined;
/** Extra keys on the graph read (an analysis state), per row. */
let extraRead: Record<string, unknown> = {};
/** Exercise incomplete capability replies while retaining the real factor hold and approval door. */
let factorReplyShape: { heldReply: unknown; keepCard: boolean } | undefined;
let incompleteFactorReply: Record<string, unknown> | undefined;
vi.mock('../runtime/agent-capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/agent-capabilities.js')>();
  return { ...actual, createAgentCapabilities: (...args: Parameters<typeof actual.createAgentCapabilities>) => {
    const capabilities = actual.createAgentCapabilities(...args);
    const propose = capabilities.proposeNewFactor!;
    return { ...capabilities, proposeNewFactor: async (...params: Parameters<typeof propose>) => {
      const issued = await propose(...params);
      if (factorReplyShape === undefined) return issued;
      const shaped = { ...issued };
      delete shaped.held_reply;
      if (factorReplyShape.heldReply !== undefined) shaped.held_reply = factorReplyShape.heldReply;
      if (!factorReplyShape.keepCard) { delete shaped.held_message; delete shaped.held_detail; }
      incompleteFactorReply = shaped;
      return shaped;
    } };
  } };
});

describe('P14 factors on the live route and real held commit door', () => {
  async function buildApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { computeGraphIdentityHash } = await import('../../context/graph-identity.js');
    const a = Fastify({ logger: false });
    a.addHook('preHandler', async (req) => { if (req.url === '/orchestrate/v2/turn') { inner.push(req.body as Record<string, unknown>); onInner?.(req.body as Record<string, unknown>); } });
    a.addHook('onSend', async (req, _reply, payload) => { if (req.url === '/orchestrate/v2/turn') onInnerSent?.(req.body as Record<string, unknown>); return payload; });
    a.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never),
        graph_identity_hash: g === null ? null : computeGraphIdentityHash(g as never), ...extraRead };
    });
    await a.register(ceeOrchestratorRouteV2);
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (!String(url).includes('openai')) throw new Error(`non-OpenAI network call: ${String(url)}`);
      openAiCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const next = script.shift();
      return new Response(JSON.stringify(next !== undefined ? next(body) : say('Done.')), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildApp();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; inner = []; onInner = undefined; onInnerSent = undefined; routerCalls.length = 0; extraRead = {}; factorReplyShape = undefined; incompleteFactorReply = undefined; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  type GraphNow = { nodes: { id: string; kind: string; label: string; proposed_by?: string;
    analysis_participation?: string; interventions?: Record<string, unknown> }[]; edges: { from: string; to: string; [key: string]: unknown }[] };
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  /** The hold the Agent's LATEST answer row carries — what the next turn (and route-v2's confirm) will read. */
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; expires_at_turn_count: number; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };

  type Door = 'factors';
  const PRESS = {
    factors: { id: 'ask:missing-factor', label: 'Suggest factors', message: 'What else could change how this turns out that the model doesn’t have yet?' },
  };
  const ANCHOR = { factors: 'feature_delivery_capacity' };
  const LABELS = {
    factors: ['Customer feedback', 'Supplier flexibility', 'Team continuity', 'Schedule slack'],
  };
  const BASIS = "Olumi's suggestion: the direction is Olumi's estimate from general patterns, not from your data or your words. Its strength isn't set yet.";
  const methodLine = (_door: Door) => 'I looked for what else could drive ‘Feature Delivery Capacity’, across customers and demand, money and price, people and capacity, timing, how the work is done, and outside conditions (influence-diagram elicitation).';
  const caveat = (_door: Door) => 'Possible drivers to consider, not established causes.';
  const paulV1 = () => {
    const g = JSON.parse(readFileSync(new URL('../method-turn/__tests__/fixtures/s-c-widen/paul-6582edbc-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    delete g['_provenance']; graphOf.set(SCENARIO, g);
  };
  const candidates = async (door: Door) => {
    const mod = await import('../method-turn/widen-turn.js');
    // Scripted model uses the implemented category vocabulary when present; base has neither registry row.
    const m = (mod as Record<string, unknown>)['FACTOR_METHOD'] as { categories: string[] } | undefined;
    const categories = m?.categories ?? ['customers', 'money', 'people', 'timing'];
    const items = LABELS[door].map((label, i) => ({ label, category: categories[i], direction: 'positive',
      since: 'steadier relationships support the work', anchor_id: ANCHOR[door] }));
    const tag = 'factor_suggestions';
    return say(`<${tag}>${JSON.stringify(items)}</${tag}>`);
  };
  const addChips = (b: Body) => b.suggested_actions.filter((c) => c.id.startsWith('agent-widen-add:'));
  const press = (c: { id: string; message: string }) => turn({ message: c.message, source: 'chip', chip: { id: c.id } });
  const reread = async () => {
    const r = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    expect(r.statusCode).toBe(200);
    return r.json() as { graph: GraphNow; graph_hash: string };
  };
  const edgeIds = (g: GraphNow) => g.edges.map((e) => `${e.from}::${e.to}`).sort();
  const nodeIds = (g: GraphNow) => g.nodes.map((n) => n.id).sort();
  const added = (after: string[], before: string[]) => after.filter((id) => !before.includes(id));
  const suggest = async (door: Door) => {
    const reply = await candidates(door); script = [() => reply];
    const b = await press(PRESS[door]); const add = addChips(b)[0];
    expect(add?.label, `P14 ${door} door must offer the exact item before Add/approve can run`).toBe(`Add ‘${LABELS[door][0]}’`);
    expect(add!.id).toMatch(/^agent-widen-add:[0-9a-f]{16}$/);
    return add!;
  };

  for (const door of ['factors'] as const) {
    const row = 'SF';
    it(`${row}-1: typed press → ONE tool-less call, ≤3 exact suggestions and Adds, Something else; no graph write`, async () => {
      paulV1(); const before = await reread(); const bodies: Record<string, unknown>[] = [];
      const reply = await candidates(door);
      script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return reply; }];
      const b = await press(PRESS[door]);
      expect(openAiCalls, 'ONE model call').toBe(1);
      expect(bodies[0]?.['tools'] ?? [], `P14 ${door} press must select its tool-less method door`).toEqual([]);
      expect(addChips(b).map((c) => c.label)).toEqual(LABELS[door].slice(0, 3).map((label) => `Add ‘${label}’`));
      for (const c of addChips(b)) expect(c.id).toMatch(/^agent-widen-add:[0-9a-f]{16}$/);
      expect(b.suggested_actions.map((c) => c.label)).toEqual([...LABELS[door].slice(0, 3).map((label) => `Add ‘${label}’`), 'Something else']);
      expect(b.suggested_actions.at(-1)?.id).toBe('agent-widen-something-else');
      expect(b.assistant_text.split('\n')).toContain(methodLine(door));
      expect(b.assistant_text).toContain(caveat(door));
      expect(b.assistant_text.split('\n').filter((line) => line.startsWith('- ‘')).length).toBe(3);
      expect(b.assistant_text).not.toContain(LABELS[door][3]);
      expect(b._agent.tool_calls).toEqual([]); expect(await heldOnLatestRow()).toEqual([]);
      expect(await reread()).toEqual(before); expect(routerCalls).toEqual([]);
    }, 120_000);

    it(`${row}-2 WRITER: Add → ONE gmh_ hold → real approve → exactly one node and one edge; Olumi placeholder, hash changes, fresh read agrees`, async () => {
      paulV1(); const before = await reread(); const add = await suggest(door); const calls = openAiCalls;
      const heldReply = await press(add);
      expect(openAiCalls, 'Add makes NO model call').toBe(calls);
      expect(heldReply._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([[door === 'factors' ? 'propose_new_factor' : 'propose_new_outcome', true]]);
      const held = await heldOnLatestRow(); expect(held).toHaveLength(1);
      const approve = approveChipOf(heldReply);
      expect(approve?.id).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
      expect(approve!.id).toBe(`agent-approve-proposal:${held[0]!.chip_id}`);
      if (door === 'factors') {
        expect(held[0]!.action.inline_patch).toMatchObject({ olumi_direction: true });
        expect(held[0]!.action.inline_patch).not.toHaveProperty('user_today');
      }
      const ops = held[0]!.action.inline_patch!.operations!;
      expect(ops.map((o) => o.op)).toEqual(['add_node', 'add_edge']);
      const id = ops[0]!.path;
      const from = id; const to = ANCHOR[door];
      expect(ops[1]!.path).toBe(`${from}::${to}`);
      expect(heldReply.assistant_text).toContain(BASIS);
      expect(heldReply.assistant_text).toContain('whose strength nobody has set yet');
      expect(heldReply.assistant_text).toContain(door === 'factors'
        ? `How much could ‘${LABELS[door][0]}’ move ‘Feature Delivery Capacity’? Give a figure and a range if you can, or leave it for now.`
        : `Does ‘${LABELS[door][0]}’ count towards ‘meet our next feature-launch deadline’?`);
      expect(await reread(), 'nothing written before approval, including goal edges').toEqual(before);
      const innerBefore = inner.length;
      const approved = await press(approve!);
      expect(openAiCalls, 'approval makes NO model call').toBe(calls);
      expect(inner.length, 'approval must reach REAL route-v2 commit door').toBeGreaterThan(innerBefore);
      expect(approved._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true, proposal_id: held[0]!.chip_id }));
      const after = await reread();
      expect(added(nodeIds(after.graph), nodeIds(before.graph))).toEqual([id]);
      expect(added(nodeIds(before.graph), nodeIds(after.graph))).toEqual([]);
      expect(added(edgeIds(after.graph), edgeIds(before.graph))).toEqual([`${from}::${to}`]);
      expect(added(edgeIds(before.graph), edgeIds(after.graph))).toEqual([]);
      expect(after.graph.nodes.find((n) => n.id === id)).toMatchObject({ id, kind: door === 'factors' ? 'factor' : 'outcome', label: LABELS[door][0] });
      const newNode = after.graph.nodes.find((n) => n.id === id)!;
      if (door === 'factors') expect((newNode as Record<string, unknown>)['observed_state']).toBeUndefined();
      for (const n of before.graph.nodes) expect(after.graph.nodes.find((x) => x.id === n.id)).toEqual(n);
      for (const e of before.graph.edges) expect(after.graph.edges.find((x) => x.from === e.from && x.to === e.to)).toEqual(e);
      expect(after.graph).toEqual({ ...before.graph, nodes: after.graph.nodes, edges: after.graph.edges, ...(door === 'factors' ? { ref_high_water: { F: 1 } } : {}) });
      expect(after.graph.edges.filter((e) => e.to === 'meet_our_next_feature_launch_deadline')).toEqual(before.graph.edges.filter((e) => e.to === 'meet_our_next_feature_launch_deadline'));
      const { hypothesisEdgeValue } = await import('../../routing/add-option-transaction.js');
      const edge = after.graph.edges.find((e) => e.from === from && e.to === to)!;
      expect(edge).toMatchObject(hypothesisEdgeValue(from, to, 'positive'));
      // Existing factor door encodes Olumi authorship in provenance.source; accepting it must keep that origin.
      expect((edge['provenance'] as Record<string, unknown>)['source']).toBe('cee_hypothesis');
      expect((edge['provenance'] as Record<string, unknown>)['magnitude']).toBe('olumi_placeholder');
      expect(edge['exists_probability']).toBe(hypothesisEdgeValue(from, to, 'positive')['exists_probability']);
      expect(after.graph_hash).not.toBe(before.graph_hash);
      expect(await reread(), 'fresh reload returns the same graph and hash').toEqual(after);
      expect(await heldOnLatestRow()).toEqual([]); expect(routerCalls).toEqual([]);
    }, 120_000);
  }

  for (const door of ['factors'] as const)
  it(`SF-7 reload ${door}: typed method press is live-only until the offers envelope admits its id (as SR-7, #2792), and stands only while the result is current`, async () => {
    const { isDurableAnswerOffer, stillValidOffers } = await import('../../../routes/agent-v1-turn.js');
    const offer = PRESS[door];
    // #2792: the answer-offers envelope admits only `agent-…` ids, so a canvas `ask:` press is never stored (SR-7's family rule).
    expect(isDurableAnswerOffer(offer), `P14 ${offer.id} must not be stored outside the envelope`).toBe(false);
    const current = { analysisReady: undefined, modelExists: true, analysisState: { run_state: { kind: 'complete_current' }, usable_for_chips: true } };
    expect(stillValidOffers([offer], { ...current, outstandingProposalIds: new Set() }).map((c) => c.id)).toEqual([offer.id]);
    expect(stillValidOffers([offer], { ...current, outstandingProposalIds: new Set(['gmh_0123456789ab']) })).toEqual([]);
    expect(stillValidOffers([offer], { ...current, analysisState: { run_state: { kind: 'stale' }, usable_for_chips: true }, outstandingProposalIds: new Set() })).toEqual([]);
  });

  for (const door of ['factors'] as const)
  it(`SF-8 ${door}: edited Add message refused; no model call, hold or graph write`, async () => {
    paulV1(); const before = await reread(); const add = await suggest(door); const calls = openAiCalls;
    const refused = await press({ ...add, message: add.message.replace(LABELS[door][0], 'Changed suggestion') });
    expect(openAiCalls).toBe(calls); expect(refused._agent.tool_calls).toEqual([]);
    // COPY-SHAPE ruling #2796 (comment 6049756212): an unidentified Add gets one kind-neutral line, never another door's words.
    expect(refused.assistant_text).toBe('I couldn’t tell which item that Add was for, so nothing was changed. Press its Add again.');
    expect(refused.suggested_actions.map((c) => c.id)).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]); expect(await reread()).toEqual(before);
  }, 120_000);

  it.each([
    { case: 'missing held_reply with card', heldReply: undefined, keepCard: true },
    { case: 'empty held_reply with card', heldReply: '', keepCard: true },
    { case: 'blank held_reply without card', heldReply: '   ', keepCard: false },
    { case: 'non-string held_reply without card', heldReply: 42, keepCard: false },
  ])('SF-10 held reply: $case uses the factor fallback chain, never undefined', async ({ heldReply, keepCard }) => {
    paulV1(); const before = await reread(); const add = await suggest('factors'); const calls = openAiCalls;
    factorReplyShape = { heldReply, keepCard };
    const held = await press(add);
    expect(openAiCalls, 'held Add makes NO model call').toBe(calls);
    expect(held._agent.tool_calls).toEqual([
      expect.objectContaining({ name: 'propose_new_factor', ok: true, mutated: false, proposal_id: expect.any(String) }),
    ]);
    expect(incompleteFactorReply?.ok).toBe(true);
    expect(typeof incompleteFactorReply?.proposal_id).toBe('string');
    const { factorAddCallOf } = await import('../method-turn/widen-turn.js');
    const { composeProposalReply } = await import('../proposal-reply.js');
    const call = factorAddCallOf(add.id, add.message, before)!;
    const composed = composeProposalReply(call.tool, call.args, incompleteFactorReply, add.message);
    expect(composed, 'direction-only factor has no figure for the generic composer').toBeNull();
    const subject = keepCard ? /^Yes, ([\s\S]+?)\.?$/.exec(String(incompleteFactorReply?.held_message))?.[1] : undefined;
    if (keepCard) expect(subject).toBeTruthy();
    const fallback = subject !== undefined
      ? `Ready to ${subject}. Nothing is added until you approve the change.`
      : 'I’ve prepared that factor as a change for you to approve. Nothing is added until you approve it.';
    expect(held.assistant_text).not.toContain('undefined');
    expect(held.assistant_text).toBe(composed ?? fallback);
    expect(await heldOnLatestRow()).toHaveLength(1);
    expect(approveChipOf(held)?.id).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(await reread(), 'reply fallback leaves the held graph untouched').toEqual(before);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('SF-9 identity: valid factor Add refused by the door still reoffers factors; no model call, hold or graph write', async () => {
    paulV1(); const before = await reread(); const add = await suggest('factors'); const calls = openAiCalls;
    // The Add identity stays valid; the real holder reads the source hash and refuses this stale served revision.
    extraRead = { graph_hash: '0'.repeat(16) };
    const refused = await press(add);
    expect(openAiCalls, 'refused Add makes NO model call').toBe(calls);
    expect(refused._agent.tool_calls).toEqual([
      expect.objectContaining({ name: 'propose_new_factor', ok: false, mutated: false, refusal: 'model_changed' }),
    ]);
    expect(refused.assistant_text).toContain('nothing was added');
    expect(refused.suggested_actions.map((c) => c.id)).toEqual([PRESS.factors.id]);
    expect(await heldOnLatestRow()).toEqual([]);
    extraRead = {};
    expect(await reread(), 'the refused door writes no graph').toEqual(before);
    expect(routerCalls).toEqual([]);
  }, 120_000);
});
