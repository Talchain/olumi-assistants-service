/**
 * ⛔ THE CLAIM MUST DECIDE OWNERSHIP ON THE PRODUCTION STORE, NOT ON A DOUBLE.
 *
 * Independent review of #1720 at cb4e9d35: the earlier witnesses ran against a
 * hand-written store double that classified EVERY append as new / replay /
 * conflict. The real `SupabaseSessionStore` does not: a write with no graph goes
 * to `append_turn_atomic_v2`, which does `ON CONFLICT (scenario_id, turn_id) DO
 * NOTHING` and returns the EXISTING id with no error
 * (`20260711000000_v5_append_turn_atomic_for_share.sql:297-309`). So a losing
 * request looked exactly like a winner, and W1 / W2 / the reused-id refusal all
 * failed on the real path.
 *
 * Here the route runs against the REAL `SupabaseSessionStore`; only its Supabase
 * client is faked, and the fake models `append_turn_atomic_v2` as that migration
 * defines it (first insert wins, a conflicting insert silently changes nothing
 * and returns the existing id). The claim now carries a per-request nonce and is
 * READ BACK, which is what decides ownership.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SupabaseSessionStore, __setUseAppendV6ForTest } from '../../session/supabase-store.js';
import { SessionLRUCache } from '../../session/cache.js';

type Row = {
  id: string; scenario_id: string; user_id: string; turn_id: string; turn_class: string; handler_id: string | null; request_hash: string;
  response_emitted: boolean; llm_calls_used: number; duration_ms: number; created_at: string;
  user_message: string | null; assistant_message: string | null; pending_actions: unknown[]; coaching_state: unknown;
};
const table: Row[] = [];
let seq = 0;
let failAnswerFor: string | null = null;

/** `append_turn_atomic_v2` exactly as its migration defines it — and a PostgREST-shaped `from()`. */
const fakeClient = {
  rpc: vi.fn(async (fn: string, a: Record<string, unknown>) => {
    // S-D.1b (#2754) deploys BEFORE its migration: until the DL applies it, PostgREST answers the conditional answer RPC
    // with PGRST202, and the store falls back to today's path. Modelled exactly; every other unknown RPC still fails loud.
    if (fn === 'append_agent_answer_if_latest') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.append_agent_answer_if_latest in the schema cache' } };
    if (fn !== 'append_turn_atomic_v2' && fn !== 'append_turn_atomic_v3') return { data: null, error: { message: `unexpected rpc ${fn}` } };
    if (failAnswerFor !== null && a.p_turn_id === failAnswerFor) return { data: null, error: { message: 'simulated persistence failure' } };
    const existing = table.find((r) => r.scenario_id === a.p_scenario_id && r.turn_id === a.p_turn_id);
    if (existing !== undefined) return { data: existing.id, error: null }; // ON CONFLICT DO NOTHING → existing id, no error
    seq += 1;
    const row: Row = {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, scenario_id: String(a.p_scenario_id), user_id: '11111111-1111-4111-8111-111111111111', turn_id: String(a.p_turn_id),
      turn_class: String(a.p_turn_class), handler_id: (a.p_handler_id as string | null) ?? null, request_hash: String(a.p_request_hash),
      response_emitted: a.p_response_emitted !== false, llm_calls_used: Number(a.p_llm_calls_used ?? 0), duration_ms: Number(a.p_duration_ms ?? 0),
      created_at: new Date(Date.UTC(2026, 8, 23, 0, 0, seq)).toISOString(),
      user_message: (a.p_user_message as string | null) ?? null, assistant_message: (a.p_assistant_message as string | null) ?? null,
      pending_actions: (a.p_pending_actions as unknown[] | null) ?? [], coaching_state: a.p_coaching_state ?? null,
    };
    table.push(row);
    return { data: row.id, error: null };
  }),
  from: vi.fn((name: string) => {
    const eqs: [string, unknown][] = [];
    const nots: [string, string][] = [];
    let desc = false; let lim = Infinity; let del = false; let count = false; let cols: string[] | null = null;
    const run = () => {
      if (name !== 'v5_conversation_turns') return { data: [], error: null };
      let rows = table.filter((r) => eqs.every(([c, v]) => (r as Record<string, unknown>)[c] === v))
        .filter((r) => nots.every(([c, pat]) => !(pat.startsWith('%') ? String((r as Record<string, unknown>)[c]).endsWith(pat.slice(1)) : false)));
      if (del) { for (const r of rows) table.splice(table.indexOf(r), 1); return { data: null, error: null }; }
      if (count) return { data: null, count: rows.length, error: null };
      rows = [...rows].sort((x, y) => (desc ? y.created_at.localeCompare(x.created_at) : x.created_at.localeCompare(y.created_at)));
      const out = rows.slice(0, lim);
      // PostgREST returns ONLY the selected columns — the store's strict row parse depends on it.
      return { data: cols === null ? out : out.map((r) => Object.fromEntries(cols!.map((c) => [c, (r as Record<string, unknown>)[c]]))), error: null };
    };
    const chain: Record<string, unknown> = {
      select: (c?: string, opts?: { count?: string }) => { if (opts?.count) count = true; if (typeof c === 'string' && c.trim() !== '*') cols = c.split(',').map((x) => x.trim()).filter(Boolean); return chain; },
      delete: () => { del = true; return chain; },
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return chain; },
      not: (c: string, _op: string, pat: string) => { nots.push([c, pat]); return chain; },
      order: (_c: string, o?: { ascending?: boolean }) => { if (o?.ascending === false) desc = true; return chain; },
      limit: (n: number) => { lim = n; return chain; },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: null }; },
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => { try { resolve(run()); } catch (e) { reject?.(e); } },
    };
    return chain;
  }),
};

const realStore = new SupabaseSessionStore(fakeClient as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 });
// The ONLY stub: scenario provisioning (a `scenarios` table concern, not the turn table).
const store = Object.assign(Object.create(Object.getPrototypeOf(realStore)), realStore, {
  ensureScenarioExists: async () => ({ user_id: null }),
}) as SupabaseSessionStore;
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Step = { kind: 'text'; text?: string } | { kind: 'fail' } | { kind: 'tool'; name: string; args: string }
  | { kind: 'tools'; calls: readonly { name: string; args: string }[] };
const provider = { calls: 0, script: [] as Step[] };
const fakeFetch = vi.fn(async () => {
  provider.calls += 1;
  const step = provider.script.shift() ?? { kind: 'text' };
  if (step.kind === 'fail') return new Response('{"error":"boom"}', { status: 500 });
  if (step.kind === 'tool') return new Response(JSON.stringify({ output: [{ type: 'function_call', name: step.name, call_id: `c${provider.calls}`, arguments: step.args }] }), { status: 200 });
  if (step.kind === 'tools') return new Response(JSON.stringify({ output: step.calls.map((call, i) => ({ type: 'function_call', name: call.name, call_id: `c${provider.calls}-${i}`, arguments: call.args })) }), { status: 200 });
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: step.text ?? `Answer ${provider.calls}` }] }] }), { status: 200 });
});

const SID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const T1 = '0b8c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';

type InternalTurn = (body: Record<string, unknown>) => Promise<{ status: number; json: Record<string, unknown> }>;
const freshModuleAppendV6Setters = new Set<(value: boolean) => void>();
async function freshApp(internalTurn?: InternalTurn): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const freshStoreModule = await import('../../session/supabase-store.js');
  freshModuleAppendV6Setters.add(freshStoreModule.__setUseAppendV6ForTest);
  freshStoreModule.__setUseAppendV6ForTest(true);
  const mod = await import('../../../routes/agent-v1-turn.js');
  mod.AGENT_TURN_CLAIM_WAIT.totalMs = 1_500;
  mod.AGENT_TURN_CLAIM_WAIT.everyMs = 20;
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [], edges: [] }, graph_hash: 'h1' }));
  if (internalTurn !== undefined) app.post('/orchestrate/v2/turn', async (req, reply) => {
    const result = await internalTurn(req.body as Record<string, unknown>);
    return reply.code(result.status).send(result.json);
  });
  await app.register(mod.agentV1TurnRoute);
  await app.ready();
  return app;
}
const say = (app: FastifyInstance, message: string, turnId: string) =>
  app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, message, turn_id: turnId } });
const textOf = (r: { json: () => unknown }) => String((r.json() as { assistant_text?: string }).assistant_text);
const errorOf = (r: { json: () => unknown }) => (r.json() as { error?: string }).error;

describe('the Agent turn claim decides ownership on the REAL SupabaseSessionStore', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    __setUseAppendV6ForTest(true);
    table.length = 0; seq = 0; failAnswerFor = null; provider.calls = 0; provider.script = [];
    vi.stubGlobal('fetch', fakeFetch);
    app = await freshApp();
  }, 60_000);
  afterEach(async () => {
    __setUseAppendV6ForTest(false);
    for (const setAppendV6 of freshModuleAppendV6Setters) setAppendV6(false);
    freshModuleAppendV6Setters.clear();
    await app.close();
    vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED;
    delete process.env.AGENT_LANE_PREVIEW;
  });

  it('CONTROL: sequential replay — the retry is answered from the durable row, 1 provider call', async () => {
    const first = await say(app, 'What should I consider?', T1);
    const retry = await say(app, 'What should I consider?', T1);
    expect(retry.statusCode).toBe(200);
    expect(textOf(retry)).toBe(textOf(first));
    expect(provider.calls).toBe(1);
  });

  it('RED (W1): two identical requests at once → exactly ONE provider call and the SAME durable answer', async () => {
    const [a, b] = await Promise.all([say(app, 'What should I consider?', T1), say(app, 'What should I consider?', T1)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(provider.calls, 'the losing request must not call the model').toBe(1);
    expect(textOf(a)).toBe(textOf(b));
    expect(table.filter((r) => r.turn_id === T1)).toHaveLength(1);
  });

  it('RED (W2): the answer could not be recorded → a retry on a FRESH instance runs nothing, TURN_OUTCOME_UNKNOWN', async () => {
    failAnswerFor = T1;
    const first = await say(app, 'What should I consider?', T1);
    expect(first.statusCode).toBe(200);
    failAnswerFor = null;
    await app.close(); app = await freshApp();
    const retry = await say(app, 'What should I consider?', T1);
    expect(retry.statusCode).toBe(409);
    expect(errorOf(retry)).toBe('TURN_OUTCOME_UNKNOWN');
    expect(provider.calls).toBe(1);
  });

  it('RED: a claim held by a DIFFERENT message refuses the reuse — nothing runs', async () => {
    failAnswerFor = T1; // leave ONLY the first request's claim behind
    await say(app, 'What should I consider?', T1);
    failAnswerFor = null;
    const reused = await say(app, 'Something else entirely', T1);
    expect(reused.statusCode).toBe(409);
    expect(errorOf(reused)).toBe('TURN_ID_REUSED');
    expect(provider.calls).toBe(1);
  });

  it('RED: a provider failure BEFORE anything was sent releases the claim — the same turn_id can be retried and runs', async () => {
    provider.script = [{ kind: 'fail' }];
    const failed = await say(app, 'What should I consider?', T1);
    expect(failed.statusCode).toBe(502);
    expect((failed.json() as { retry_safe?: boolean }).retry_safe).toBe(true);
    const retry = await say(app, 'What should I consider?', T1);
    expect(retry.statusCode).toBe(200);
    expect(provider.calls).toBe(2);
  });

  it('CONTRAST: a provider failure AFTER a write was sent keeps the claim — the retry never runs the turn again', async () => {
    provider.script = [{ kind: 'tool', name: 'run_analysis', args: '{"reason":"first comparison"}' }, { kind: 'fail' }];
    const failed = await say(app, 'Run it.', T1);
    expect(failed.statusCode).toBe(502);
    expect((failed.json() as { retry_safe?: boolean }).retry_safe).toBe(false);
    const callsBefore = provider.calls;
    const retry = await say(app, 'Run it.', T1);
    expect(retry.statusCode).toBe(409);
    expect(errorOf(retry)).toBe('TURN_OUTCOME_UNKNOWN');
    expect(provider.calls).toBe(callsBefore);
  });

  it('a single dispatched revision refusal releases the durable claim — the SAME turn_id runs on a fresh instance', async () => {
    let dispatched = 0;
    let refuseRevision = true;
    const internalTurn: InternalTurn = async (body) => {
      dispatched += 1;
      expect(body).toMatchObject({ scenario_id: SID, stage: 'analyse', chip: { action_type: 'run_analysis' } });
      if (refuseRevision) return { status: 409, json: { code: 'revision_conflict', expected: 7, current: 8 } };
      return { status: 200, json: { blocks: [], assistant_text: 'No comparison result.' } };
    };
    await app.close(); app = await freshApp(internalTurn);
    provider.script = [{ kind: 'tool', name: 'run_analysis', args: '{"reason":"first comparison"}' }];

    const refused = await say(app, 'Run it.', T1);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'revision_conflict', expected: 7, current: 8, retry_safe: true });
    expect(dispatched).toBe(1);
    expect(table, 'the refused action wrote no turn, and its real-store claim was deleted').toHaveLength(0);
    expect(await store.readCommittedTurn(SID, `${T1}:claim`)).toBeNull();

    refuseRevision = false;
    await app.close(); app = await freshApp(internalTurn);
    provider.script = [{ kind: 'tool', name: 'run_analysis', args: '{"reason":"first comparison"}' }, { kind: 'text', text: 'Retry accepted.' }];
    const callsBefore = provider.calls;
    const retry = await say(app, 'Run it.', T1);
    expect(retry.statusCode).toBe(200);
    expect(dispatched, 'the SAME outer turn_id must reach its action again').toBe(2);
    expect(provider.calls).toBeGreaterThan(callsBefore);
    expect(await store.readCommittedTurn(SID, T1)).not.toBeNull();
  });

  it('an earlier dispatched step wrote before a revision refusal — retry_safe is false and the SAME turn_id never runs again', async () => {
    const dispatchedTurnIds: string[] = [];
    const internalTurn: InternalTurn = async (body) => {
      expect(body).toMatchObject({ scenario_id: SID, stage: 'analyse', chip: { action_type: 'run_analysis' } });
      const internalTurnId = String(body.turn_id);
      dispatchedTurnIds.push(internalTurnId);
      if (dispatchedTurnIds.length === 2) return { status: 409, json: { code: 'revision_conflict', expected: 8, current: 9 } };
      // The endpoint boundary persists through the production store/RPC path:
      // a successful earlier step is a durable turn, not a hand-written table row.
      await store.append({
        scenario_id: SID, turn_id: internalTurnId, turn_class: 'handler', handler_id: 'run_analysis',
        request_hash: 'first-analysis-step', response_emitted: true, llm_calls_used: 0,
        duration_ms: 1, handler_facts: [],
      });
      return { status: 200, json: { blocks: [], assistant_text: 'First analysis step recorded.' } };
    };
    await app.close(); app = await freshApp(internalTurn);
    provider.script = [{ kind: 'tools', calls: [
      { name: 'run_analysis', args: '{"reason":"first comparison"}' },
      { name: 'run_analysis', args: '{"reason":"second comparison"}' },
    ] }];

    const refused = await say(app, 'Run both comparisons.', T1);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'revision_conflict', expected: 8, current: 9, retry_safe: false });
    expect(dispatchedTurnIds).toHaveLength(2);
    const firstStep = await store.readCommittedTurn(SID, dispatchedTurnIds[0]!);
    expect(firstStep).toMatchObject({ request_hash: 'first-analysis-step' });
    expect(await store.readCommittedTurn(SID, dispatchedTurnIds[1]!)).toBeNull();
    expect(await store.readCommittedTurn(SID, T1)).toBeNull();
    const retainedClaim = await store.readCommittedTurn(SID, `${T1}:claim`);
    expect(retainedClaim).not.toBeNull();

    const callsBefore = provider.calls;
    await app.close(); app = await freshApp(internalTurn);
    const retry = await say(app, 'Run both comparisons.', T1);
    expect(retry.statusCode).toBe(409);
    expect(errorOf(retry)).toBe('TURN_OUTCOME_UNKNOWN');
    expect(provider.calls).toBe(callsBefore);
    expect(dispatchedTurnIds, 'neither step may execute again on a retry').toHaveLength(2);
    expect(await store.readCommittedTurn(SID, `${T1}:claim`)).toEqual(retainedClaim);
    expect(await store.readCommittedTurn(SID, dispatchedTurnIds[0]!)).toEqual(firstStep);
    expect(table).toHaveLength(2);
  });
});

describe('claim markers never become conversation history', () => {
  it('RED: after 25 claim+answer turns, readRecent(20) returns the 20 newest REAL turns and no claim row', async () => {
    table.length = 0; seq = 0;
    for (let i = 1; i <= 25; i += 1) {
      const tid = `t-${String(i).padStart(2, '0')}`;
      await fakeClient.rpc('append_turn_atomic_v2', { p_scenario_id: SID, p_turn_id: `${tid}:claim`, p_turn_class: 'direct_answer', p_handler_id: null, p_request_hash: `h${i}#claim:n`, p_response_emitted: false, p_llm_calls_used: 0, p_duration_ms: 0 });
      await fakeClient.rpc('append_turn_atomic_v2', { p_scenario_id: SID, p_turn_id: tid, p_turn_class: 'direct_answer', p_handler_id: null, p_request_hash: `h${i}`, p_response_emitted: true, p_llm_calls_used: 1, p_duration_ms: 1, p_user_message: `q${i}`, p_assistant_message: `a${i}` });
    }
    const fresh = new SupabaseSessionStore(fakeClient as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 });
    const recent = await fresh.readRecent(SID, 20);
    const ids = recent.map((t) => t.turn_id);
    expect(ids.some((id) => id.endsWith(':claim'))).toBe(false);
    expect(ids).toHaveLength(20);
    expect(new Set(ids)).toEqual(new Set(Array.from({ length: 20 }, (_, k) => `t-${String(k + 6).padStart(2, '0')}`)));
    expect(await fresh.countTurns!(SID)).toBe(25);
  });
});
