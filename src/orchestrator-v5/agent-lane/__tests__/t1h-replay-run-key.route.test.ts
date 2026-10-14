/**
 * T1h (PL #94 6135017311 item 4): a replay of an earlier Run answer names THAT answer's Run, after a restart too: the
 * narration it was sent with is stored WITH its row (migration 20261013230000) and read back from the exact row
 * (`readCommittedTurn`), never today's Run or the latest row's. A row without it leaves the Run unknown.
 *
 * Real route, real loop, real Run handler (the `run-press-loop.route.test.ts` harness). Writes AND reads are the real
 * `SupabaseSessionStore`; only the PostgREST transport is fake. Its RPCs transcribe the migrations' checks: the narrated
 * appends (20261013230000), the offers/guidance wrappers (20261006230000 / 20261004142707) and the conditional append
 * (20261007090000). `narratedMissing` makes the narrated RPCs absent (PGRST202), as before the migration is applied.
 * Requests are the UI's own bodies: DGAI `buildV5Payload` (`src/v5/buildPayload.ts`, staging e218e3d2) for a chip
 * click, which carries `stage`/`turn_class` and no `agent_session_id`, as the proxy forwards it to this route.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { SupabaseSessionStore } from '../../session/supabase-store.js';
import { SessionLRUCache } from '../../session/cache.js';
import { log } from '../../../utils/telemetry.js';
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/batch-g/served-hiring-run4-turn07-20261012T172858Z.json', 'utf8')) as Rec;
const SCENARIO = '3ad403fc-caf8-48e4-bd5b-578e20c1c48a';
const HASH = '0123456789abcdef';
const AT = '2026-10-13T01:00:00.000Z';
const LATER = '2026-10-13T02:00:00.000Z';
const READY = { status: 'ready', options: [], blockers: [] };
const STATE = { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true,
  leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } };
let graph: Rec;
let block: Rec | undefined;
let bodies: Rec[] = [];
let runs: Rec[] = [];
let originalLoop = true;
vi.mock('../runtime/agent-loop.js', async (original) => {
  const actual = await original<typeof import('../runtime/agent-loop.js')>();
  return { ...actual, runAgentTurn: (...args: Parameters<typeof actual.runAgentTurn>) => actual.runAgentTurn(
    originalLoop ? { ...args[0], stopAfterSuccessfulRun: undefined } : args[0], args[1], args[2]),
  };
});

// Hook (a): a pass-through wrapper records what the ROUTE hands the treated-as-zero reader (its third argument).
const { rootLineCalls } = vi.hoisted(() => ({ rootLineCalls: [] as { fromRoute: boolean; args: unknown[] }[] }));
vi.mock('../root-line.js', async (original) => {
  const actual = await original<typeof import('../root-line.js')>();
  return { ...actual, treatedAsZeroReplyLine: (...args: Parameters<typeof actual.treatedAsZeroReplyLine>) => {
    rootLineCalls.push({ fromRoute: (new Error().stack ?? '').includes('agent-v1-turn.ts'), args });
    return actual.treatedAsZeroReplyLine(...args);
  } };
});

/** `v5_conversation_turns`, newest first. */
const table: Rec[] = [];
const rpcCalls: string[] = [];
let narratedMissing = false;
let selectMissingColumn = false;
const NARRATION_STATUSES = new Set(['pending', 'ready', 'unavailable', 'stale']);
/** 20261013230000's narration check, transcribed. */
const validNarration = (n: unknown): boolean => n !== null && typeof n === 'object' && !Array.isArray(n)
  && Object.keys(n).every(k => k === 'status' || k === 'run_key') && NARRATION_STATUSES.has((n as Rec).status)
  && typeof (n as Rec).run_key === 'string' && /^[0-9a-f]{16}$/.test((n as Rec).run_key);
const client = {
  from: () => {
    let columns: string[] = []; let cap = Infinity;
    const checks: ((row: Rec) => boolean)[] = [];
    const orders: { key: string; ascending: boolean }[] = [];
    const chain = {
      select: (s: string) => { columns = s.split(',').map(c => c.trim()); return chain; },
      eq: (k: string, v: unknown) => { checks.push(row => row[k] === v); return chain; },
      is: (k: string, v: unknown) => { checks.push(row => row[k] === v); return chain; },
      like: (k: string, v: string) => { checks.push(row => String(row[k]).startsWith(v.slice(0, -1))); return chain; },
      not: (k: string, op: string, v: unknown) => { checks.push(row => op === 'like' ? !String(row[k]).endsWith(String(v).slice(1)) : row[k] !== v); return chain; },
      order: (key: string, options: { ascending: boolean }) => { orders.push({ key, ...options }); return chain; },
      abortSignal: () => chain,
      limit: (n: number) => { cap = n; return chain; },
      then: (resolve: (v: unknown) => void) => resolve(selectMissingColumn && columns.includes('run_narration')
        ? { data: null, error: { code: '42703', message: 'column v5_conversation_turns.run_narration does not exist' } }
        : { data: table.filter(row => checks.every(check => check(row)))
          .sort((a, b) => { for (const o of orders) { const c = String(a[o.key]).localeCompare(String(b[o.key])); if (c) return o.ascending ? c : -c; } return 0; })
          .slice(0, cap).map(row => Object.fromEntries(columns.map(c => [c, row[c]]))), error: null }),
    };
    return chain;
  },
  rpc: async (name: string, args: Rec) => {
    rpcCalls.push(name);
    if (narratedMissing && name.endsWith('_narrated')) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    const latest = () => table.find(r => r.scenario_id === args.p_scenario_id && !String(r.turn_id).endsWith(':claim'))?.id ?? null;
    if ((name === 'append_agent_answer_if_latest' || name === 'append_agent_answer_if_latest_narrated') && latest() !== args.p_expected_latest_row_id) {
      return { data: { status: 'latest_moved' }, error: null };
    }
    if (name.endsWith('_narrated') && !validNarration(args.p_run_narration)) return { data: null, error: { code: 'P0001', message: 'invalid answer Run narration' } };
    const prior = table.find(r => r.scenario_id === args.p_scenario_id && r.turn_id === args.p_turn_id);
    const id = prior?.id ?? randomUUID();
    const withOffers = args.p_suggested_actions != null;
    if (!prior) table.unshift({ id, scenario_id: args.p_scenario_id, turn_id: args.p_turn_id, turn_class: args.p_turn_class,
      handler_id: args.p_handler_id, request_hash: args.p_request_hash, response_emitted: args.p_response_emitted,
      llm_calls_used: args.p_llm_calls_used, created_at: new Date(Date.parse(AT) + table.length * 1000).toISOString(),
      user_message: args.p_user_message, assistant_message: args.p_assistant_message, pending_actions: args.p_pending_actions,
      agent_guidance: args.p_agent_guidance ?? null, suggested_actions: withOffers ? args.p_suggested_actions : null,
      suggested_actions_run_key: withOffers ? args.p_suggested_actions_run_key ?? null : null,
      // Only the narrated appends write it, and only on a new row (a retry never replaces the first answer's).
      run_narration: name.endsWith('_narrated') ? args.p_run_narration : null });
    const receipt = { id, replayed_prior_turn: !!prior && prior.request_hash === args.p_request_hash,
      prior_turn_conflict: !!prior && prior.request_hash !== args.p_request_hash };
    if (name.endsWith('_narrated') || name === 'append_agent_answer_with_offers' || name === 'append_agent_answer_with_guidance') return { data: receipt, error: null };
    if (name === 'append_agent_answer_if_latest') return { data: withOffers || args.p_agent_guidance != null ? receipt : id, error: null };
    return { data: id, error: null };
  },
};
const newStore = () => new SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 });
let realStore = newStore();
const rows: Rec[] = [];
let conditional = false;
const store: Rec = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn((s: string, id: string) => realStore.readCommittedTurn(s, id)),
  readLatestAnswerOffers: vi.fn((s: string) => realStore.readLatestAnswerOffers(s)),
  append: vi.fn(async (w: Rec) => { rows.push({ ...w, assistant_message: w.assistantMessage, user_message: w.userMessage }); return realStore.append(w as never); }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  // The floor's conditional door (S-D.1b) reads the latest non-claim row id here.
  readMostRecentPendingActions: vi.fn(async (sid: string, o?: { onLatestRowId?: (id: string | null) => void }) => {
    if (conditional) o?.onLatestRowId?.(table.find(r => r.scenario_id === sid && !String(r.turn_id).endsWith(':claim'))?.id ?? null);
    return [];
  }),
  loadGraphAndBriefText: vi.fn(async () => ({ graph, briefText: FX.brief })),
  loadGraph: vi.fn(async () => graph),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
const call = (name: string, args: Rec, id: string) => ({ type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) });
const answer = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

// Restarting rows re-import the whole route (vi.resetModules); 5 s is not enough on a loaded runner.
describe('T1h: a replay names its own answer’s Run (real route, real write → read → replay)', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  async function freshApp() {
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async (req) => {
      const payload = req.body as Rec;
      if (payload.chip?.action_type !== 'run_analysis') return { error: 'unexpected_write' };
      runs.push(payload);
      const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 't1h-load', store as never);
      const handler = createRunAnalysisHandler({ plotClient: { run: async () => ({ ...structuredClone(FX.envelope), analysis_status: 'computed',
        meta: { seed_used: 1, n_samples: 1000, response_hash: 't1h' }, response_hash: 't1h' }) } as never,
        scenarioReader: async () => snapshot });
      const outcome = await handler({ payload, requestId: 't1h-run', signal: new AbortController().signal,
        orientationText: '', context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
          session_id: SCENARIO, request_id: 't1h-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
          scenarioBriefText: null, persistedGraph: null } } as never);
      block = { type: 'analysis_result', computed_against_hash: HASH, enrichment: (outcome.handler_facts[0] as Rec).result.enrichment };
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: HASH,
        analysis_state: STATE, analysis_ready: READY, blocks: [block] };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({ graph, graph_hash: HASH, brief_text: FX.brief,
      analysis_ready: READY, analysis_state: block ? STATE : { run_state: { kind: 'none' } },
      ...(block ? { analysis_result: block, goal_certainty: FX.goal_certainty } : {}) }, SCENARIO));
    await app.register(agentV1TurnRoute); await app.ready();
  }
  /** A restart: a fresh route module (no in-process controls) and a fresh store (no hot cache). */
  async function restart() {
    await app.close(); vi.resetModules();
    realStore = newStore();
    await freshApp();
  }
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')); bodies.push(body);
      // Read only THIS turn's tail: with no agent_session_id the scenario's history is shared across presses.
      const input = (body.input ?? []) as Rec[];
      const ranHere = input.at(-1)?.type === 'function_call_output';
      const explaining = JSON.stringify([...input].reverse().find(i => i.role === 'user') ?? {}).includes('Explain this result');
      return new Response(JSON.stringify({ output: explaining || ranHere ? [answer('The analysis ran on the held model; this is what it says, in this model.')]
        : [call('run_analysis', { reason: 'Productivity up at least 10% from today by month three.', effects_timing: 'in_place_by_period' }, 'run-one')] }), { status: 200 });
    }));
    await freshApp();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { graph = structuredClone(FX.graph); block = undefined; bodies = []; runs = []; rows.length = 0; table.length = 0;
    rpcCalls.length = 0; STATE.run_state.computed_at = AT; originalLoop = true; rootLineCalls.length = 0;
    narratedMissing = false; selectMissingColumn = false; conditional = false; store.appendIfLatest = undefined; });

  /** The UI's Run chip click (`buildV5Payload`); a resend is rebuilt after the Run, so its stage has moved on. */
  const uiRun = (turnId: string, stage = 'ideate') => ({ kind: 'message', turn_id: turnId, scenario_id: SCENARIO, stage,
    turn_class: 'frame', message: 'Run analysis.', source: 'chip_click', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });
  /** The UI's Explain click: no published action_type, so `source: 'chip'`. */
  const uiExplain = (turnId: string, runKey: string) => ({ kind: 'message', turn_id: turnId, scenario_id: SCENARIO, stage: 'analyse',
    turn_class: 'frame', message: 'Explain this result', source: 'chip', chip: { id: `agent-explain-run:${runKey}` } });
  const send = (payload: Rec) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
  const press = (turnId: string = randomUUID()) => send(uiRun(turnId));
  const resend = (turnId: string) => send(uiRun(turnId, 'analyse'));
  /** Run A, answered by the AI loop (its replay re-sends the committed words). */
  async function runA() {
    const request = { turn_id: randomUUID() };
    const first = await press(request.turn_id);
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json();
    expect(runs).toHaveLength(1);
    expect(live.narration?.run_key).toMatch(/^[0-9a-f]{16}$/);
    const row = table.find(r => r.turn_id === request.turn_id)!;
    expect(row.assistant_message).toBe(live.assistant_text);
    return { request, live, row };
  }
  /** Run B on a later computed_at, answered by the AI loop: the LATEST answer row carries Run B's narration. */
  async function runB(keyA: string) {
    STATE.run_state.computed_at = LATER;
    const ran = await press();
    expect(ran.statusCode, ran.body).toBe(200);
    expect(runs).toHaveLength(2);
    const narrationB = ran.json().narration;
    expect(narrationB?.run_key).toMatch(/^[0-9a-f]{16}$/); expect(narrationB.run_key).not.toBe(keyA);
    expect(table.find(r => !String(r.turn_id).endsWith(':claim'))?.run_narration, 'precondition: the latest row is Run B').toEqual(narrationB);
    return narrationB.run_key as string;
  }

  it('hook (a): the Run turn and its replay hand the treated-as-zero reader the readback’s bound saved result', async () => {
    originalLoop = false; // the result-first Run: its replay is rebuilt from the readback (the replay call site)
    const request = { turn_id: randomUUID() };
    const first = await press(request.turn_id);
    expect(first.statusCode, first.body).toBe(200);
    const saved = JSON.parse(JSON.stringify(block)) as Rec;
    expect(saved.type).toBe('analysis_result');
    const live = rootLineCalls.filter(c => c.fromRoute);
    expect(live.length, 'the live Run call site was reached').toBeGreaterThan(0);
    for (const c of live) expect(c.args[2]).toEqual(saved);
    rootLineCalls.length = 0;
    const replay = await resend(request.turn_id);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(replay.json().narration?.status, 'precondition: the rebuilt (result-first) replay').toBe('pending');
    const replayed = rootLineCalls.filter(c => c.fromRoute);
    expect(replayed.length, 'the replay call site was reached').toBeGreaterThan(0);
    for (const c of replayed) expect(c.args[2]).toEqual(saved);
    expect(runs).toHaveLength(1);
  });

  it('store: readCommittedTurn returns THIS row’s narration; another row’s never; malformed or absent reads as unknown', async () => {
    const base = { scenario_id: SCENARIO, request_hash: 'agent_turn:h', assistant_message: 'a', user_message: 'u', llm_calls_used: 0, pending_actions: [] };
    table.push({ ...base, id: 'r2', turn_id: 'later', suggested_actions_run_key: 'bbbbbbbbbbbbbbbb', run_narration: { status: 'pending', run_key: 'bbbbbbbbbbbbbbbb' } },
      { ...base, id: 'r1', turn_id: 'earlier', suggested_actions_run_key: null, run_narration: { status: 'ready', run_key: 'aaaaaaaaaaaaaaaa' } },
      { ...base, id: 'r0', turn_id: 'legacy', suggested_actions_run_key: null, run_narration: null },
      { ...base, id: 'rx', turn_id: 'malformed', suggested_actions_run_key: 'AAAAAAAAAAAAAAAA', run_narration: { status: 'ready', run_key: 'aaaaaaaaaaaaaaaa', extra: 1 } });
    const read = async (id: string) => (await realStore.readCommittedTurn(SCENARIO, id))?.run_narration;
    expect(await read('earlier')).toEqual({ status: 'ready', run_key: 'aaaaaaaaaaaaaaaa' });
    expect(await read('later')).toEqual({ status: 'pending', run_key: 'bbbbbbbbbbbbbbbb' });
    expect(await read('legacy')).toBeNull();
    expect(await read('malformed')).toBeNull();
    // Before the migration the column is absent: the same row is still read, its Run identity unknown (never a 503),
    // and never silently (Codex check on 1c4362de).
    const warn = vi.spyOn(log, 'warn');
    selectMissingColumn = true;
    expect(await read('earlier')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'v5.committed_turn.run_narration_column_missing',
      scenario_id: SCENARIO, turn_id: 'earlier' }), expect.any(String));
    warn.mockRestore();
    expect((await realStore.readCommittedTurn(SCENARIO, 'earlier'))?.assistant_message).toBe('a');
  });

  it.each([['checked', false], ['conditional', true]] as const)(
    '(a) %s write: a cold replay of a current Run answer returns its narration, words and shape byte for byte', async (_n, viaConditional) => {
      conditional = viaConditional;
      store.appendIfLatest = viaConditional ? (w: Rec, o: Rec) => realStore.appendIfLatest(w as never, o as never) : undefined;
      const { request, live, row } = await runA();
      expect(row.suggested_actions, 'precondition: a zero-offer Run answer (the case with no stored key today)').toBeNull();
      expect(row.run_narration, 'the real route wrote the narration it sent').toEqual(live.narration);
      expect(rpcCalls).toContain(viaConditional ? 'append_agent_answer_if_latest_narrated' : 'append_agent_answer_narrated');
      const callCount = bodies.length;
      await restart();
      store.append.mockClear();
      const body = (await resend(request.turn_id)).json();
      expect(body._agent.replayed).toBe(true);
      expect(body.narration).toEqual(live.narration);
      expect(body.assistant_text).toBe(live.assistant_text);
      expect(body._answer_shape).toEqual(live._answer_shape);
      expect(body.blocks).toEqual(live.blocks);
      expect(body.suggested_actions.some((a: Rec) => a.id === 'agent-run-analysis' || a.id.startsWith('agent-explain-run:')), 'no manufactured Run or Explain control').toBe(false);
      expect(runs).toHaveLength(1); expect(bodies).toHaveLength(callCount);
      expect(store.append).not.toHaveBeenCalled();
    });

  it('(b) a later Run K2 on the latest row → a cold replay of the Run A answer names K, never K2', async () => {
    const { request, live } = await runA();
    const keyB = await runB(live.narration.run_key);
    await restart();
    originalLoop = true;
    const body = (await resend(request.turn_id)).json();
    expect(body._agent.replayed).toBe(true);
    expect(body.assistant_text).toBe(live.assistant_text);
    expect(body.narration).toEqual({ status: 'stale', run_key: live.narration.run_key });
    expect(body.narration.run_key).not.toBe(keyB);
    expect(body.blocks ?? []).toEqual([]);
    expect(runs).toHaveLength(2);
  });

  it('(c) written before the migration (narrated RPC absent) → the answer is still recorded; its cold replay names no Run, never K2', async () => {
    narratedMissing = true;
    const { request, live, row } = await runA();
    expect(row.run_narration, 'recorded through the existing path, without narration').toBeNull();
    expect(rpcCalls).toContain('append_agent_answer_narrated');
    expect(rpcCalls).toContain('append_turn_atomic_v2');
    narratedMissing = false;
    await runB(live.narration.run_key);
    await restart();
    originalLoop = true;
    const body = (await resend(request.turn_id)).json();
    expect(body._agent.replayed).toBe(true);
    expect(body.assistant_text).toBe(live.assistant_text);
    expect(body.narration).toEqual({ status: 'stale', run_key: '' });
    expect(runs).toHaveLength(2);
  });
  it('idempotent duplicate: a resend writes nothing, and a duplicate append never replaces the first answer’s narration', async () => {
    const { request, live, row } = await runA();
    store.append.mockClear();
    const again = (await resend(request.turn_id)).json();
    expect(again._agent.replayed).toBe(true);
    expect(again.narration).toEqual(live.narration);
    expect(store.append).not.toHaveBeenCalled();
    // The same answer appended again (a concurrent identical request): the store reports the replay, the row keeps its narration.
    const duplicate = { scenario_id: SCENARIO, turn_id: request.turn_id, turn_class: 'direct_answer', handler_id: null,
      request_hash: row.request_hash, response_emitted: true, llm_calls_used: 0, duration_ms: 1, handler_facts: [],
      assistantMessage: row.assistant_message, run_narration: { status: 'stale', run_key: 'ffffffffffffffff' } };
    expect(await realStore.append(duplicate as never)).toEqual({ id: row.id, replayedPriorTurn: true });
    expect((await realStore.readCommittedTurn(SCENARIO, request.turn_id))?.run_narration).toEqual(live.narration);
    expect(table.filter(r => r.turn_id === request.turn_id)).toHaveLength(1);
  });

  it('coverage: an answer that carries offers AND narration (Explain) records both on its row through the narrated path', async () => {
    const { live } = await runA();
    originalLoop = false;
    const turnId = randomUUID();
    const explained = await send(uiExplain(turnId, live.narration.run_key));
    expect(explained.statusCode, explained.body).toBe(200);
    const body = explained.json();
    expect(body.narration).toEqual({ status: 'ready', run_key: live.narration.run_key });
    const row = table.find(r => r.turn_id === turnId)!;
    expect(row.suggested_actions?.length, 'precondition: durable next-step offers').toBeGreaterThan(0);
    expect(row.suggested_actions_run_key).toBe(live.narration.run_key);
    expect(row.run_narration).toEqual(body.narration);
    expect(rpcCalls.filter(n => n.startsWith('append_agent_answer')).at(-1)).toBe('append_agent_answer_narrated');
  });
  it('default result-first Run press: the row stores its narration, and a cold replay of a still-current Run returns the same narration, words and shape', async () => {
    originalLoop = false;
    const turnId = randomUUID();
    const first = await press(turnId);
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json();
    expect(live.narration?.status).toBe('pending');
    expect(table.find(r => r.turn_id === turnId)?.run_narration).toEqual(live.narration);
    await restart();
    const body = (await resend(turnId)).json();
    expect(body._agent.replayed).toBe(true);
    expect(body.narration).toEqual(live.narration);
    expect(body.assistant_text).toBe(live.assistant_text);
    expect(body._answer_shape).toEqual(live._answer_shape);
    expect(runs).toHaveLength(1);
  });

  it('default result-first Run press, MOVED (DL ruling 14 Oct): a cold replay is Run A\'s historical receipt — {stale, K}, its words, no current result', async () => {
    originalLoop = false;
    const turnId = randomUUID();
    const first = await press(turnId);
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json();
    expect(live.narration?.status).toBe('pending');
    const keyB = await runB(live.narration.run_key);
    await restart();
    const body = (await resend(turnId)).json();
    expect(body._agent.replayed).toBe(true);
    expect(body.narration).toEqual({ status: 'stale', run_key: live.narration.run_key });
    expect(body.narration.run_key).not.toBe(keyB);
    expect(body.assistant_text).toBe(live.assistant_text);
    expect(body.blocks ?? []).toEqual([]);
    expect(body.suggested_actions.map((a: Rec) => a.id)).toEqual(['agent-run-analysis']);
    expect(runs).toHaveLength(2);
  });

  it.each([['still current', false], ['after a later Run B', true]] as const)(
    'default result-first Run press, LEGACY (written before the migration), %s: a cold replay is {stale, \'\'}, its words, never today\'s Run', async (_n, laterRun) => {
      originalLoop = false;
      narratedMissing = true;
      const turnId = randomUUID();
      const first = await press(turnId);
      expect(first.statusCode, first.body).toBe(200);
      const live = first.json();
      expect(live.narration?.status).toBe('pending');
      expect(table.find(r => r.turn_id === turnId)?.run_narration, 'precondition: recorded without its narration').toBeNull();
      narratedMissing = false;
      const keyB = laterRun ? await runB(live.narration.run_key) : undefined;
      await restart();
      const body = (await resend(turnId)).json();
      expect(body._agent.replayed).toBe(true);
      // Its original Run is unknown: never re-answered on the current Run (Codex check on 1c4362de: it named B's key).
      expect(body.narration).toEqual({ status: 'stale', run_key: '' });
      if (keyB !== undefined) expect(body.narration.run_key).not.toBe(keyB);
      expect(body.assistant_text).toBe(live.assistant_text);
      expect(body.blocks ?? []).toEqual([]);
      expect(body.suggested_actions.map((a: Rec) => a.id)).toEqual(['agent-run-analysis']);
      expect(runs).toHaveLength(laterRun ? 2 : 1);
    });
});
