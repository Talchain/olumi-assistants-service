/**
 * ⭐ E-TAIL (a) (DL, 12 Oct; run 4 deadline, scenario cdca7c76, CEE a770ce49): A PLAIN APPROVAL THE CAPABILITY REFUSED SAYS THE
 * CAPABILITY'S OWN REASON (§7.3: receipts are accurate). Turns 7 and 14 pressed the deadline card's "Yes"; the UI sends that
 * press with `proposal_edits.fields: []`. The deadline writer refused (Render 18:03:40.257Z: `deadline_scope_mismatch`), and the
 * user read "Those values could not be applied to this change, so nothing was applied." though no value was edited.
 * Replayed on run 4's own bytes through the real route and writer: the pre-approval graph (it hashes to the card's precondition),
 * the stored pending card (read-only SQL; the server's digest equals the served one) and each turn's exact request.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/run4-deadline-turn14-plain-approval.json', import.meta.url), 'utf8')) as Rec;
const SCENARIO = FX.scenario_id as string;

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null;
  llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string; writes_graph: boolean };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const graphWrites = new Map<string, number>();
const latestRow = (sid: string): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
const jsonbOrder = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(jsonbOrder)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Rec).filter((k) => (v as Rec)[k] !== undefined)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, jsonbOrder((v as Rec)[k])]))
      : v;
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  const raw = row ? (jsonbOrder(JSON.parse(JSON.stringify(row.pending_actions))) as unknown[]) : [];
  return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  scenarioExists: vi.fn(async () => true),
  getScenarioOwner: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => ({ userId: null, graph: graphOf.get(SCENARIO), briefText: FX.brief_text })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  readCommittedTurnLedger: vi.fn(async (sid: string) => ({ write_turn_ids: [...rows.values()].filter(r => r.scenario_id === sid && r.writes_graph).map(r => r.turn_id), user_message_turn_ids: [], first_user_message: null, complete: true })),
  append: vi.fn(async (w: Rec) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[], created_at: new Date().toISOString(), writes_graph: w.graph !== undefined && w.graph !== null });
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
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: FX.brief_text })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({ ...(await importOriginal<Rec>()), resolveUserIdentity: async () => ({ mode: 'off' }) }));
vi.mock('../../../adapters/llm/router.js', () => {
  const refuse = async () => { throw new Error('no LLM on the approval fast path'); };
  const adapter = { name: 'test', model: 'test-model', chat: refuse, chatWithTools: refuse };
  return { getAdapter: () => adapter, getMaxTokensFromConfig: () => undefined,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }) };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

let providerCalls = 0;
describe('E-tail (a): run 4 deadline turns 7 and 14, the plain "Yes" the writer refused', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => { providerCalls += 1; throw new Error(`no network on the approval fast path: ${String(url)}`); }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never), brief_text: FX.brief_text };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T18:03:37.341Z'));
    rows.clear(); order.length = 0; graphOf.clear(); graphWrites.clear(); providerCalls = 0;
    graphOf.set(SCENARIO, structuredClone(FX.graph));
    const issuing = FX.issuing_turn as Rec;
    void store.append({ scenario_id: SCENARIO, turn_id: issuing.turn_id, request_hash: 'run4-turn5', userMessage: issuing.user_message,
      assistantMessage: issuing.assistant_message, turn_class: 'frame', pending_actions: FX.pending_actions });
  });

  it('precondition: the replayed card is the served one (the server\'s own digest) on the graph it was made against', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    expect(computeAnalysisAffectingGraphHash(FX.graph as never)).toBe('b932fdf3b4660078');
    expect(FX.request.proposal_edits).toMatchObject({ fields: [], digest: '9a107e4eed0e0e07cb6eca0dd787269b', graph_hash: 'b932fdf3b4660078' });
    expect(FX.served_reply).toMatch(/^Those values could not be applied to this change/);
  });

  // Runs FIRST: the Agent's proposal store is per process, and the rows below consume this card.
  it('PERMANENT (independent of the deadline cap): another writer moved the goal\'s date; the plain "Yes" says that reason', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const moved = structuredClone(FX.graph) as Rec;
    (moved.nodes as Rec[]).find((n) => n.id === 'event_goal')!.goal_horizon = { deadline: '2027-01-29' };
    // The date is outside the analysis hash, so the card's own envelope still binds: this refusal is the capability's.
    expect(computeAnalysisAffectingGraphHash(moved as never)).toBe('b932fdf3b4660078');
    graphOf.set(SCENARIO, moved);
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: FX.request });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    const b = r.json() as Rec;
    expect(b._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'not_applied' }));
    // The capability's own reason ("Read it again; …" is addressed to the Agent and dropped), then the narrator's status.
    expect(b.assistant_text).toBe('The goal\u2019s deadline changed after this was offered, so nothing was recorded.\n\nNot saved: none of it was applied.');
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
  }, 120_000);

  /**
   * ⭐ E-TAIL (b) (AIE 6130197656 §2 ACK): with Olumi's 35 %-a-month link limited to the whole launch, run 4's own sequence
   * now saves. Turn 7's plain "Yes" writes the deadline once and the read-back holds it, with the limited mean AND spread on
   * the stored link, the raw ones and the pace beside them, and the same link on the engine's input. Turn 14's "Yes" to the
   * same card (served then as "Those values could not be applied") writes nothing a second time.
   */
  it('after_write interruption → exact deadline commit/readback → same card says already saved, no second write; foreign or unproved outcomes stay unknown', async () => {
    const { extraShareMoments } = await import('../../goal-target/event-by-date-share.js');
    const { toOutboundGraph } = await import('../../goal-target/outbound-graph.js');
    const { withShareByDateFrame } = await import('../../goal-target/share-by-date-run.js');
    const { withoutStatedLevelRanges } = await import('../../routing/add-factor-transaction.js');
    const raw = extraShareMoments(0.35, 6, 2, 4);
    const was = { env: process.env.OLUMI_ENV, seam: process.env.CEE_RECOVERY_FAULT_SEAM };
    process.env.OLUMI_ENV = 'staging'; process.env.CEE_RECOVERY_FAULT_SEAM = 'on';
    const r7 = await (async () => { try {
      return await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { ...FX.request_turn7,
        _recovery_fault: { scenario_id: SCENARIO, point: 'after_write' } } });
    } finally {
      if (was.env === undefined) delete process.env.OLUMI_ENV; else process.env.OLUMI_ENV = was.env;
      if (was.seam === undefined) delete process.env.CEE_RECOVERY_FAULT_SEAM; else process.env.CEE_RECOVERY_FAULT_SEAM = was.seam;
    } })();
    expect(r7.statusCode, r7.body.slice(0, 400)).toBe(503);
    expect(r7.json()).toEqual({ error: 'RECOVERY_FAULT_INJECTED', point: 'after_write' });
    expect(rows.has(`${SCENARIO}:${FX.request_turn7.turn_id}`), 'receipt/answer was not written').toBe(false);
    const { authorisationTurnId } = await import('../runtime/agent-capabilities.js');
    expect(rows.get(`${SCENARIO}:${authorisationTurnId('prop_b9ca206131b318f52cb6df4d85f9b4e9#deadline')}`)?.writes_graph,
      'the exact approved operation committed before the interruption').toBe(true);
    expect(graphWrites.get(SCENARIO)).toBe(1);
    const held = graphOf.get(SCENARIO) as Rec;
    expect((held.nodes as Rec[]).find((n) => n.id === 'event_goal')!.goal_horizon).toMatchObject({ deadline: '2027-04-12' });
    const link = (g: Rec, from: string): Rec => (g.edges as Rec[]).find((e) => e.from === from && e.to === 'event_goal')!;
    expect(link(held, 'event_capacity_2').strength).toEqual({ mean: 1, std: raw.sd / raw.mean });
    const carrier = (held.nodes as Rec[]).find((n) => n.id === 'event_capacity_2')!.observed_state.extra_share_by_date;
    expect(carrier).toMatchObject({ monthly_share: 35, lead_low: 2, lead_high: 4, deadline: '2027-04-12',
      link_limit: { raw_mean: raw.mean, raw_sd: raw.sd, entered_mean: 1, entered_sd: raw.sd / raw.mean, origin: 'olumi_assumption' } });
    // The engine's input: the Run's outbound projection of the stored graph carries the same limited mean and spread.
    const wire = toOutboundGraph(withoutStatedLevelRanges(withShareByDateFrame(held, held))) as Rec;
    expect(link(wire, 'event_capacity_2').strength).toEqual({ mean: 1, std: raw.sd / raw.mean });
    for (const [id, pace] of [['event_capacity_1', 0.2], ['event_capacity_4', 0.18]] as const) {
      const m = extraShareMoments(pace, 6, 2, 4);
      expect(link(wire, id).strength).toEqual({ mean: m.mean, std: m.sd });
    }
    expect(providerCalls).toBe(0);

    const r14 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: FX.request });
    expect(r14.statusCode, r14.body.slice(0, 400)).toBe(200);
    const b14 = r14.json() as Rec;
    expect(b14._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: false }));
    // Its exact write is committed and the saved deadline still holds: report that outcome, never superseded.
    expect(b14.assistant_text).toBe("That change was already saved; nothing was written again. The analysis can't run yet. How long would next feature launch take with the team you have now?");
    expect(b14.assistant_text).not.toContain('Those values could not be applied');
    expect(graphWrites.get(SCENARIO), 'no second write').toBe(1);
    expect(providerCalls).toBe(0);
    // An applied-memory flag is not proof of the current saved field, nor of this operation's durable commit.
    const unknown = async () => {
      const before = JSON.stringify(graphOf.get(SCENARIO));
      const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { ...FX.request,
        turn_id: randomUUID() } });
      const body = res.json() as Rec;
      expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: false,
        mutated: false, refusal: 'not_confirmed' }));
      expect(body.assistant_text).toBe('The save could not be confirmed. Check the current model before retrying.');
      expect(body.assistant_text).not.toContain('already saved');
      expect(body.assistant_text).not.toContain('could not read the model back');
      expect(JSON.stringify(graphOf.get(SCENARIO))).toBe(before);
      expect(graphWrites.get(SCENARIO)).toBe(1);
    };
    const moved = structuredClone(held);
    moved.nodes.find((n: Rec) => n.id === 'event_goal').goal_horizon = { deadline: '2027-05-12' };
    graphOf.set(SCENARIO, moved);
    await unknown();
    graphOf.set(SCENARIO, structuredClone(held));
    store.readCommittedTurnLedger.mockResolvedValueOnce({ write_turn_ids: [], user_message_turn_ids: [], first_user_message: null, complete: true });
    await unknown();
    expect(providerCalls).toBe(0);

  }, 120_000);
});
