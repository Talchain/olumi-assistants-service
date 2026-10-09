/**
 * ⛔ THE WHOLE AGENT TURN IS ONE OPERATION, AND ITS IDENTITY IS THE CLIENT'S `turn_id`.
 *
 * Release Control, 23 Sep 2026 (olumi-programme-docs#63 5788656586): the
 * conversational `/agent/v1/turn` route read no `turn_id`, ran the model and
 * advanced the in-process history. So an exact lost-response retry was a FRESH
 * execution against a history the first attempt had already moved on — it took a
 * different next action and could write where the first had only proposed.
 *
 * The discriminators are RC's, in order. The store double classifies an append
 * the way `SupabaseSessionStore` does — same `(scenario_id, turn_id)` + same
 * `request_hash` is a replay, a different hash is a conflict — and the route
 * reads the committed row through `readCommittedTurn`, so a "restart" (a fresh
 * route module with fresh in-memory stores) is answered from the SAME durable
 * rows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { __setUseAppendV6ForTest } from '../../session/supabase-store.js';
import type { createAgentCapabilities, InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CommitOptionLevelsInput } from '../../system-events/dispatch.js';

type ProductPorts = NonNullable<Parameters<typeof createAgentCapabilities>[5]>;
// Exercise the route's real accounting/claim catch without requiring a provider
// to choose these exact door sequences. Other replay rows use real capabilities.
let refusedDoorSequence: ((dispatch: InternalDispatch, ports: ProductPorts) => Promise<never>) | undefined;
const internalCalls: string[] = [];

type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number };
const rows = new Map<string, Row>();
let readFails = false;
let answerAppendFails = false;
let ownershipChangesAfterClaim = false;
const store = {
  getScenarioOwner: vi.fn(async () => ownershipChangesAfterClaim && rows.has(`${T1}:claim`) ? 'u-owner' : null),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => {
    if (readFails) throw new Error('read failed');
    return rows.get(turnId) ?? null;
  }),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used: number }) => {
    if (answerAppendFails && !w.turn_id.endsWith(':claim')) throw new Error('answer append failed');
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  releaseTurnClaim: vi.fn(async (_sid: string, turnId: string, claimHash: string) => {
    if (rows.get(turnId)?.request_hash === claimHash) rows.delete(turnId);
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
vi.mock('../runtime/agent-capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/agent-capabilities.js')>();
  return { ...actual, createAgentCapabilities: (...args: Parameters<typeof actual.createAgentCapabilities>) => {
    const capabilities = actual.createAgentCapabilities(...args);
    return refusedDoorSequence === undefined ? capabilities : {
      ...capabilities, authoriseChange: async () => refusedDoorSequence!(args[0], args[5]!),
    };
  } };
});
vi.mock('../../system-events/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../system-events/dispatch.js')>();
  return { ...actual, commitOptionLevelsInProcess: vi.fn(async (input: CommitOptionLevelsInput) => {
    await store.append({ turn_id: input.turn_id, request_hash: 'option-levels-written', llm_calls_used: 0 });
    return { status: 'committed', graph_hash: 'h2', receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  }) };
});

/** The provider: every call is counted, and the Nth answer is "Answer N". */
const provider: { calls: number; userTurnsSeen: number[] } = { calls: 0, userTurnsSeen: [] };
const fakeFetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
  provider.calls += 1;
  const sent = JSON.parse(String(init?.body ?? '{}')) as { input?: { role?: string }[] };
  provider.userTurnsSeen.push((sent.input ?? []).filter((i) => i.role === 'user').length);
  if (refusedDoorSequence !== undefined) return new Response(JSON.stringify({ output: [{
    type: 'function_call', name: 'authorise_change', call_id: 'refused-door',
    arguments: JSON.stringify({ proposal_id: 'prop_0123456789abcdef0123456789abcdef' }),
  }] }), { status: 200 });
  const text = `Answer ${provider.calls}`;
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { status: 200 });
});

const SID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const T1 = '0b8c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const T2 = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

/** A FRESH route module each call — its HistoryStore/ProposalStore are new, as after a restart. */
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const mod = await import('../../../routes/agent-v1-turn.js');
  const { agentV1TurnRoute } = mod;
  const { bindWriteCaller } = await import('../../ownership/door-ownership.js');
  // A request that loses the claim waits for the winner's answer — short here.
  mod.AGENT_TURN_CLAIM_WAIT.totalMs = 2_000;
  mod.AGENT_TURN_CLAIM_WAIT.everyMs = 20;
  const app = Fastify({ logger: false });
  // Match production's request-scoped door accounting, including the claim append.
  app.addHook('preHandler', (_req, _reply, done) => bindWriteCaller({ userId: null, verified: false }, done));
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [], edges: [] }, graph_hash: 'h1' }));
  const revisionRefusal = (path: string) => async (_req: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    internalCalls.push(path);
    return reply.code(409).send({ code: 'revision_conflict', expected: 7, current: 8 });
  };
  app.post('/assist/v1/scenarios/:id/graph/register', revisionRefusal('/graph/register'));
  app.post('/orchestrate/v2/turn', revisionRefusal('/orchestrate/v2/turn'));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('flag OFF: Agent claim release after revision refusal', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    __setUseAppendV6ForTest(false);
    rows.clear(); readFails = false; answerAppendFails = false; ownershipChangesAfterClaim = false; provider.calls = 0; provider.userTurnsSeen = [];
    refusedDoorSequence = undefined; internalCalls.length = 0; store.releaseTurnClaim.mockClear();
    store.append.mockClear(); store.readCommittedTurn.mockClear();
    vi.stubGlobal('fetch', fakeFetch);
    app = await freshApp();
  }, 60_000);
  afterEach(async () => { __setUseAppendV6ForTest(false); await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const approve = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SID, turn_id: T1, message: 'Yes, apply that change.',
  } });
  const register = async (dispatch: InternalDispatch): Promise<never> => {
    await dispatch(`/assist/v1/scenarios/${SID}/graph/register`, { turn_id: T2 });
    throw new Error('revision refusal must escape the dispatch');
  };

  it('ownership refusal on an unwritten final answer releases its conversation claim', async () => {
    ownershipChangesAfterClaim = true;
    const response = await approve();
    expect(response.statusCode, response.payload).toBe(403);
    expect(response.payload).toBe('{"error":"model_write_ownership_refused"}');
    expect(response.payload).not.toContain('Nothing was saved');
    expect(store.append).toHaveBeenCalledTimes(1); // Only the earlier claim, never the refused answer.
    expect(store.releaseTurnClaim).toHaveBeenCalledExactlyOnceWith(SID, `${T1}:claim`, expect.any(String));
    expect(rows.size).toBe(0);
  });

  it('Addendum 6 (a): a lone register revision refusal releases the claim and is retry_safe', async () => {
    refusedDoorSequence = register;
    const response = await approve();
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'revision_conflict', expected: 7, current: 8, retry_safe: true });
    expect(internalCalls).toEqual(['/graph/register']);
    expect(store.releaseTurnClaim).toHaveBeenCalledTimes(1);
    expect(store.releaseTurnClaim).toHaveBeenCalledWith(SID, `${T1}:claim`, expect.any(String));
    expect(rows.size).toBe(0);
    expect(provider.calls).toBe(1);
  });

  it('Addendum 6 (b): commitOptionLevels succeeds before a later register revision refusal, so the claim stays', async () => {
    refusedDoorSequence = async (dispatch, ports) => {
      const committed = await ports.commitOptionLevels!({ scenario_id: SID, turn_id: T2, base_graph_hash: 'h1', levels: [], links: [] });
      expect(committed.status).toBe('committed');
      return register(dispatch);
    };
    const response = await approve();
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'revision_conflict', expected: 7, current: 8, retry_safe: false });
    expect(internalCalls).toEqual(['/graph/register']);
    expect(rows.get(T2)).toMatchObject({ request_hash: 'option-levels-written' });
    expect(rows.has(`${T1}:claim`)).toBe(true);
    expect(rows.has(T1)).toBe(false);
    expect(rows.size).toBe(2);
    expect(store.releaseTurnClaim).not.toHaveBeenCalled();
    expect(provider.calls).toBe(1);
  });

  it('Addendum 6 (c): a lone v2/turn revision refusal keeps the claim and is not retry_safe', async () => {
    refusedDoorSequence = async (dispatch) => {
      await dispatch('/orchestrate/v2/turn', { scenario_id: SID, turn_id: T2 });
      throw new Error('revision refusal must escape the dispatch');
    };
    const response = await approve();
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({ code: 'revision_conflict', expected: 7, current: 8, retry_safe: false });
    expect(internalCalls).toEqual(['/orchestrate/v2/turn']);
    expect(rows.has(`${T1}:claim`)).toBe(true);
    expect(rows.size).toBe(1);
    expect(store.releaseTurnClaim).not.toHaveBeenCalled();
    expect(provider.calls).toBe(1);
  });
});
