/**
 * T1h (PL #94 6135017311 item 4): a replay of an earlier Run answer names THAT answer's Run, read from the exact row
 * (`readCommittedTurn`), never today's Run or the latest row's. A row without a key leaves the Run unknown.
 *
 * Real route, real loop, real Run handler (the `run-press-loop.route.test.ts` harness). The committed-turn and latest-offers
 * reads are the real `SupabaseSessionStore` over a fake PostgREST transport; the append double writes the row exactly as the
 * real store does (the Run key only beside 1–8 durable offers, migration 20261006230000).
 *
 * ⚠ SEEDED: the route writes no Run key for a typed Run answer today (its only controls are Explain/Run, never durable
 * offers). Rows (a) and (b) set that one column on the stored row to the answer's own narration key, as a write side would.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { SupabaseSessionStore } from '../../session/supabase-store.js';
import { SessionLRUCache } from '../../session/cache.js';
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
      then: (resolve: (v: unknown) => void) => resolve({ data: table.filter(row => checks.every(check => check(row)))
        .sort((a, b) => { for (const o of orders) { const c = String(a[o.key]).localeCompare(String(b[o.key])); if (c) return o.ascending ? c : -c; } return 0; })
        .slice(0, cap).map(row => Object.fromEntries(columns.map(c => [c, row[c]]))), error: null }),
    };
    return chain;
  },
};
let realStore = new SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 });
const rows: Rec[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn((s: string, id: string) => realStore.readCommittedTurn(s, id)),
  readLatestAnswerOffers: vi.fn((s: string) => realStore.readLatestAnswerOffers(s)),
  append: vi.fn(async (w: Rec) => {
    rows.push({ ...w, assistant_message: w.assistantMessage, user_message: w.userMessage });
    const withOffers = Array.isArray(w.suggested_actions) && w.suggested_actions.length > 0;
    table.unshift({ id: randomUUID(), scenario_id: w.scenario_id, turn_id: w.turn_id, turn_class: w.turn_class,
      handler_id: w.handler_id ?? null, request_hash: w.request_hash, response_emitted: w.response_emitted,
      llm_calls_used: w.llm_calls_used, created_at: new Date(Date.parse(AT) + table.length * 1000).toISOString(),
      user_message: w.userMessage ?? null, assistant_message: w.assistantMessage ?? null, pending_actions: w.pending_actions ?? null,
      agent_guidance: w.agent_guidance ?? null, suggested_actions: withOffers ? w.suggested_actions : null,
      suggested_actions_run_key: withOffers ? w.suggested_actions_run_key ?? null : null });
    return { id: w.turn_id };
  }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readMostRecentPendingActions: vi.fn(async () => []),
  loadGraphAndBriefText: vi.fn(async () => ({ graph, briefText: FX.brief })),
  loadGraph: vi.fn(async () => graph),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
const call = (name: string, args: Rec, id: string) => ({ type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) });
const answer = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

describe('T1h: a replay names its own answer’s Run (real route, real committed-turn read)', () => {
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
    realStore = new SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 });
    await freshApp();
  }
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')); bodies.push(body);
      const ranHere = (body.input ?? []).some((i: Rec) => i.type === 'function_call_output');
      const explaining = JSON.stringify(body.input ?? []).includes('Explain this result');
      return new Response(JSON.stringify({ output: explaining || ranHere ? [answer('The analysis ran on the held model; this is what it says, in this model.')]
        : [call('run_analysis', { reason: 'Productivity up at least 10% from today by month three.', effects_timing: 'in_place_by_period' }, 'run-one')] }), { status: 200 });
    }));
    await freshApp();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { graph = structuredClone(FX.graph); block = undefined; bodies = []; runs = []; rows.length = 0; table.length = 0;
    STATE.run_state.computed_at = AT; originalLoop = true; rootLineCalls.length = 0; });

  const press = (extra: Rec = {}) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', turn_id: randomUUID(), agent_session_id: randomUUID(), scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click',
    chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, ...extra,
  } });
  /** Run A, answered by the AI loop (a historical receipt on replay). */
  async function runA() {
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID() };
    const first = await press(request);
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json();
    expect(runs).toHaveLength(1);
    expect(live.narration?.run_key).toMatch(/^[0-9a-f]{16}$/);
    const row = table.find(r => r.turn_id === request.turn_id)!;
    expect(row.assistant_message).toBe(live.assistant_text);
    return { request, live, row };
  }
  /** Run B on a later computed_at, then Explain B: the Explain answer carries next-step offers, so the real write keys it. */
  async function runBExplained(keyA: string) {
    STATE.run_state.computed_at = LATER;
    const ran = await press();
    expect(ran.statusCode, ran.body).toBe(200);
    expect(runs).toHaveLength(2);
    const keyB = ran.json().narration?.run_key as string;
    expect(keyB).toMatch(/^[0-9a-f]{16}$/); expect(keyB).not.toBe(keyA);
    originalLoop = false;
    const explained = await press({ message: 'Explain this result', chip: { id: `agent-explain-run:${keyB}` } });
    expect(explained.statusCode, explained.body).toBe(200);
    const latest = await realStore.readLatestAnswerOffers(SCENARIO);
    expect(latest?.run_key, 'precondition: the LATEST answer row carries Run B, written by the real route').toBe(keyB);
    return keyB;
  }

  it('hook (a): the Run turn and its replay hand the treated-as-zero reader the readback’s bound saved result', async () => {
    originalLoop = false; // the result-first Run: its replay is rebuilt from the readback (the replay call site)
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID() };
    const first = await press(request);
    expect(first.statusCode, first.body).toBe(200);
    const saved = JSON.parse(JSON.stringify(block)) as Rec;
    expect(saved.type).toBe('analysis_result');
    const live = rootLineCalls.filter(c => c.fromRoute);
    expect(live.length, 'the live Run call site was reached').toBeGreaterThan(0);
    for (const c of live) expect(c.args[2]).toEqual(saved);
    rootLineCalls.length = 0;
    const replay = await press(request);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(replay.json().narration?.status, 'precondition: the rebuilt (result-first) replay').toBe('pending');
    const replayed = rootLineCalls.filter(c => c.fromRoute);
    expect(replayed.length, 'the replay call site was reached').toBeGreaterThan(0);
    for (const c of replayed) expect(c.args[2]).toEqual(saved);
    expect(runs).toHaveLength(1);
  });

  it('store: readCommittedTurn returns THIS row’s Run key; another row’s never; a malformed key reads as unknown', async () => {
    const base = { scenario_id: SCENARIO, request_hash: 'agent_turn:h', assistant_message: 'a', user_message: 'u', llm_calls_used: 0, pending_actions: [] };
    table.push({ ...base, id: 'r2', turn_id: 'later', suggested_actions_run_key: 'bbbbbbbbbbbbbbbb' },
      { ...base, id: 'r1', turn_id: 'earlier', suggested_actions_run_key: 'aaaaaaaaaaaaaaaa' },
      { ...base, id: 'r0', turn_id: 'legacy', suggested_actions_run_key: null },
      { ...base, id: 'rx', turn_id: 'malformed', suggested_actions_run_key: 'AAAAAAAAAAAAAAAA' });
    expect((await realStore.readCommittedTurn(SCENARIO, 'earlier'))?.suggested_actions_run_key).toBe('aaaaaaaaaaaaaaaa');
    expect((await realStore.readCommittedTurn(SCENARIO, 'later'))?.suggested_actions_run_key).toBe('bbbbbbbbbbbbbbbb');
    expect((await realStore.readCommittedTurn(SCENARIO, 'legacy'))?.suggested_actions_run_key).toBeNull();
    expect((await realStore.readCommittedTurn(SCENARIO, 'malformed'))?.suggested_actions_run_key).toBeNull();
  });

  it('(a) SEEDED key K → cold replay names K on the historical receipt, with the committed words byte for byte', async () => {
    const { request, live, row } = await runA();
    expect(row.suggested_actions_run_key, 'precondition: the route wrote no key for a Run answer (the blocked write side)').toBeNull();
    row.suggested_actions_run_key = live.narration.run_key;
    const callCount = bodies.length;
    await restart();
    store.append.mockClear();
    const body = (await press(request)).json();
    expect(body._agent.replayed).toBe(true);
    expect(body.assistant_text).toBe(live.assistant_text);
    expect(body.narration).toEqual({ status: 'stale', run_key: live.narration.run_key });
    expect(body.blocks ?? []).toEqual([]);
    expect(body.suggested_actions.map((a: Rec) => a.id)).toEqual(['agent-run-analysis']);
    expect(runs).toHaveLength(1); expect(bodies).toHaveLength(callCount);
    expect(store.append).not.toHaveBeenCalled();
  });

  it('(b) SEEDED key K, then a later Run K2 on the latest row → cold replay still names K, never K2', async () => {
    const { request, live, row } = await runA();
    row.suggested_actions_run_key = live.narration.run_key;
    const keyB = await runBExplained(live.narration.run_key);
    await restart();
    originalLoop = true;
    const body = (await press(request)).json();
    expect(body._agent.replayed).toBe(true);
    expect(body.assistant_text).toBe(live.assistant_text);
    expect(body.narration).toEqual({ status: 'stale', run_key: live.narration.run_key });
    expect(body.narration.run_key).not.toBe(keyB);
    expect(runs).toHaveLength(2);
  });

  it('(c) a row with no key (as the route writes a Run answer today) → cold replay names no Run, never K2 or today’s', async () => {
    const { request, live, row } = await runA();
    expect(row.suggested_actions_run_key).toBeNull();
    await runBExplained(live.narration.run_key);
    await restart();
    originalLoop = true;
    const body = (await press(request)).json();
    expect(body._agent.replayed).toBe(true);
    expect(body.assistant_text).toBe(live.assistant_text);
    expect(body.narration).toEqual({ status: 'stale', run_key: '' });
    expect(runs).toHaveLength(2);
  });
});
