/** A2: real route + real in-process risk hold; OpenAI output is stubbed, the writer is not. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { fixture, candidate, REPLY, OPTION } from '../runtime/reasoning-artefacts/__tests__/premortem-fixture.js';
import { planPickChipId } from '../method-turn/method-turn.js';
import type { PremortemWorksheetV1 } from '../runtime/reasoning-artefacts/premortem.js';

let SCENARIO = '';
type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
/** Every append that carried a graph, per scenario: "ONE graph-bearing row". */
const graphWrites = new Map<string, number>();
/** (7c) Refuse every graph read once the scenario has more than this many graph-bearing rows; `undefined` = never. */
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
        created_at: new Date(Date.UTC(2026, 8, 27, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) {
        graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
        graphWrites.set(w.scenario_id, (graphWrites.get(w.scenario_id) ?? 0) + 1);
      }
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
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
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the writer doors (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));


type Body = { assistant_text: string; _premortem_worksheet?: PremortemWorksheetV1; suggested_actions: { id: string; message: string }[]; _agent: { tool_calls: { name: string; ok: boolean; proposal_id?: string }[] } };
let script: ((body: Record<string, unknown>) => unknown)[] = [];
let modelCalls = 0;
let runStamp: 'valid' | 'missing_hash' | 'missing_time' | 'graph_differs' = 'valid';
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: unknown) => ({ output: [{ type: 'function_call', name, call_id: randomUUID(), arguments: JSON.stringify(args) }] });

describe('A2 final root carrier and existing consent door', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (!String(url).includes('openai')) throw new Error('unexpected provider');
      modelCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const next = script.shift();
      return new Response(JSON.stringify(next ? next(body) : say('Prepared.')), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async req => {
      const sid = (req.params as { id: string }).id;
      const graph = graphOf.get(sid);
      const read = fixture().read;
      const result = { ...read.analysisResult as Record<string, unknown> };
      const state = structuredClone(read.analysisState) as Record<string, unknown>;
      if (runStamp === 'missing_hash') delete result.computed_against_hash;
      if (runStamp === 'missing_time') state.run_state = { kind: 'complete_current' };
      if (runStamp === 'graph_differs') result.computed_against_hash = '0000000000000000';
      return { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), analysis_state: state,
        analysis_result: result, analysis_ready: read.analysisReady, analysis_option_participation: read.optionParticipation };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); modelCalls = 0; script = []; runStamp = 'valid';
    graphOf.set(SCENARIO, fixture().read.graph); routerCalls.length = 0;
  });
  const turn = async (id: string | undefined, message = 'Run a pre-mortem.') => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message,
      ...(id ? { source: 'chip', chip: { id } } : {}),
    } });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    return response.json() as Body;
  };
  const produce = async (appendix = JSON.stringify([candidate()])) => {
    script = [() => say(`${REPLY}\n<premortem_rows>${appendix}</premortem_rows>`)];
    return turn(planPickChipId(OPTION));
  };
  it('settled method carries validated root worksheet after finaliser, in one call; graph unchanged', async () => {
    const before = JSON.stringify(graphOf.get(SCENARIO));
    const body = await produce();
    expect(body.assistant_text).toBe(REPLY);
    expect(body._premortem_worksheet?.rows).toHaveLength(1);
    expect(body._premortem_worksheet?.run.graph_hash_at_run).toBe((fixture().read.analysisResult as Record<string, unknown>).computed_against_hash);
    expect(modelCalls).toBe(1);
    expect(JSON.stringify(graphOf.get(SCENARIO))).toBe(before);
  });
  it('malformed producer loses only worksheet; prose byte-identical', async () => {
    const body = await produce('broken');
    expect(body._premortem_worksheet).toBeUndefined();
    expect(body.assistant_text).toBe(REPLY);
    expect(modelCalls).toBe(1);
  });
  it('refusal and non-method never emit a worksheet', async () => {
    const refused = await turn(planPickChipId('removed'));
    expect(refused._premortem_worksheet).toBeUndefined();
    expect(modelCalls).toBe(0);
    script = [() => say('A shared model helps us think.')];
    expect((await turn(undefined, 'What is in the model?'))._premortem_worksheet).toBeUndefined();
  });
  it.each(['missing_hash', 'missing_time', 'graph_differs'] as const)('route withholds %s stamp', async stamp => {
    runStamp = stamp;
    expect((await produce())._premortem_worksheet).toBeUndefined();
  });
  it('one produced risk_request reaches holdAddRiskInProcess as one gmh_ proposal, graph hash unchanged before Approve', async () => {
    const generated = await produce();
    const request = generated._premortem_worksheet?.rows[0].risk_request;
    expect(request).toBeDefined();
    if (!request) throw new Error('real producer row required');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const before = JSON.stringify(graphOf.get(SCENARIO));
    const hashBefore = computeAnalysisAffectingGraphHash(graphOf.get(SCENARIO) as never);
    let rowWasGiven = false;
    script = [body => {
      rowWasGiven = JSON.stringify(body.input).includes(candidate().risk.label);
      return call('propose_new_risk', { label: candidate().risk.label,
        affects: [{ target_label: 'monthly recurring revenue', direction: request.direction }], rationale: request.message });
    }];
    const prepared = await turn(request.chip_id, request.message);
    expect(rowWasGiven).toBe(true);
    expect(prepared._agent.tool_calls.filter(c => c.name === 'propose_new_risk' && c.ok)).toHaveLength(1);
    const held = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; action: { kind: string; inline_patch?: { handler_id?: string } } }[];
    const cards = held.filter(p => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
    expect(cards).toHaveLength(1);
    expect(cards[0].chip_id).toMatch(/^gmh_[0-9a-f]{12}$/u);
    expect(prepared.suggested_actions.some(c => c.id === `agent-approve-proposal:${cards[0].chip_id}`)).toBe(true);
    expect(JSON.stringify(graphOf.get(SCENARIO))).toBe(before);
    expect(computeAnalysisAffectingGraphHash(graphOf.get(SCENARIO) as never)).toBe(hashBefore);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    expect(routerCalls).toEqual([]);
  });
});
