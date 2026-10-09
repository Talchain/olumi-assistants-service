/** Real Agent HTTP route, ownership hook, tool loop and persistence door; local provider/store ports. */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommittedTurnRecord, SessionStore, SessionTurnWrite } from '../session/store.js';
import { createMockSessionStore } from '../../../tests/utils/mock-session-store.js';
import { claimingTurnFenceStore } from '../../../tests/utils/claiming-turn-fence-store.js';
import { installOwnershipHarness, verifyFixtureIdentity } from '../../../tests/utils/ownership-route-harness.js';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import { readSuccessfulDoorEntries } from '../ownership/door-ownership.js';
import { agentV1TurnRoute } from '../../routes/agent-v1-turn.js';
import { log } from '../../utils/telemetry.js';

const state = vi.hoisted(() => ({
  store: undefined as SessionStore | undefined,
  tool: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('../session/index.js', async load => ({
  ...await load<typeof import('../session/index.js')>(), getSessionStore: () => state.store!,
}));
vi.mock('../../utils/supabase-user-jwt.js', async load => ({
  ...await load<typeof import('../../utils/supabase-user-jwt.js')>(),
  verifySupabaseUserJwt: (token: string) => verifyFixtureIdentity(token),
}));
vi.mock('../../config/index.js', async load => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false, assistApiKey: 'ownership-wire-fixture-key' },
    proxy: { ...actual.config.proxy, agentLaneEnabled: true, agentLanePreview: false },
  } };
});
// Choose a bounded successful tool sequence, as in the claim-release regression harness.
// The real loop dispatches it, and every write still enters the real ownership door.
vi.mock('../agent-lane/runtime/agent-capabilities.js', async load => {
  const actual = await load<typeof import('../agent-lane/runtime/agent-capabilities.js')>();
  return { ...actual, createAgentCapabilities: (...args: Parameters<typeof actual.createAgentCapabilities>) => {
    const caps = actual.createAgentCapabilities(...args);
    return state.tool === undefined ? caps : { ...caps, authoriseChange: async () => {
      await state.tool!();
      return { ok: true, mutated: true };
    } };
  } };
});

const SID = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c';
const TID = 'b1111111-1111-4111-8111-111111111111';
const OWNER = 'u-owner';
const GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'Growth' }, { id: 'factor', kind: 'factor', label: 'Capacity' }], edges: [] };
// Pin approved bytes independently of the production constant.
const BYTES = {
  not_owner: '{"error":"model_write_ownership_refused","message":"Nothing was saved. You don\'t have access to change this model."}',
  owner_unreadable: '{"error":"model_write_ownership_refused","message":"Nothing was saved. I couldn\'t check access to this model. Try again."}',
};
const CODE_ONLY = '{"error":"model_write_ownership_refused"}';

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); state.store = undefined; state.tool = undefined; });

async function harness(options: {
  reason?: keyof typeof BYTES; atClaim?: boolean; tool?: 'in_process' | 'child'; release?: 'throws' | 'absent';
} = {}) {
  const rows = new Map<string, CommittedTurnRecord>();
  const fence = claimingTurnFenceStore();
  let flipped = options.atClaim ?? false;
  let countAtRefusal = -1;
  const getScenarioOwner = vi.fn(async () => {
    if (!flipped) return OWNER;
    countAtRefusal = readSuccessfulDoorEntries();
    if (options.reason === 'owner_unreadable') throw new Error('owner reader unavailable');
    return 'u-other';
  });
  const append = vi.fn(async (w: SessionTurnWrite) => {
    rows.set(w.turn_id, { id: `row-${rows.size}`, request_hash: w.request_hash,
      assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used });
    return { id: `row-${rows.size}` };
  });
  const releaseTurnClaim = vi.fn(async (_sid: string, tid: string, hash: string) => {
    if (options.release === 'throws') throw new Error('claim release unavailable');
    if (rows.get(tid)?.request_hash === hash) rows.delete(tid);
  });
  state.store = createMockSessionStore({ append, getScenarioOwner, releaseTurnClaim,
    readCommittedTurn: async (_sid, tid) => rows.get(tid) ?? null,
    claimTurnFence: fence.store.claimTurnFence.bind(fence.store),
    markGraphWriteFailed: fence.store.markGraphWriteFailed.bind(fence.store),
    hasOtherAdmittedLiveTurn: fence.store.hasOtherAdmittedLiveTurn.bind(fence.store),
    readExistingScenario: async () => ({ userId: OWNER, graph: GRAPH, briefText: null, analysisInvalidatedAt: null }),
    loadGraph: async () => GRAPH, loadGraphAndBriefText: async () => ({ graph: GRAPH, briefText: null }),
  });
  if (options.release === 'absent') delete state.store.releaseTurnClaim;
  const app: FastifyInstance = Fastify();
  await installOwnershipHarness(app, () => ({ mode: 'verified', userId: OWNER }));
  const toolWrite = () => appendCheckedGraphWrite({ store: state.store!, writesGraph: false, source: 'tool-fixture', write: {
    scenario_id: SID, turn_id: 'tool-write', turn_class: 'direct_answer', handler_id: null, request_hash: 'tool-write',
    response_emitted: false, llm_calls_used: 0, duration_ms: 0, handler_facts: [],
  } });
  app.post('/tool-write', { config: { scenarioId: { from: 'body', key: 'scenario_id' } } }, toolWrite);
  // Direct in-process tool success is deliberately outside the route's dispatch ledger;
  // the door counter must still protect it (and aggregate unnamed child successes).
  if (options.tool) state.tool = async () => {
    if (options.tool === 'child') {
      const child = await app.inject({ method: 'POST', url: '/tool-write', payload: { scenario_id: SID } });
      expect(child.statusCode, child.payload).toBe(200);
    } else await toolWrite();
  };
  let calls = 0;
  const fetch = vi.fn(async () => {
    calls += 1;
    if (options.tool && calls === 1) return new Response(JSON.stringify({ output: [{
      type: 'function_call', name: 'authorise_change', call_id: 'tool-fixture',
      arguments: JSON.stringify({ proposal_id: 'prop_0123456789abcdef0123456789abcdef' }),
    }] }), { status: 200 });
    // Both the claim and the optional tool have finished before the final append.
    flipped = true;
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Consider the assumptions together.' }] }] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  await agentV1TurnRoute(app);
  const inject = () => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-request-id': 'midturn-request' },
    payload: { scenario_id: SID, turn_id: TID, message: 'Consider the strategic framing.' } });
  return { app, rows, fence, append, releaseTurnClaim, fetch, inject, countAtRefusal: () => countAtRefusal };
}

it.each(['not_owner', 'owner_unreadable'] as const)('(a) claim-only mid-turn %s returns exact canonical bytes and releases the claim', async reason => {
  const h = await harness({ reason });
  try {
    const r = await h.inject();
    process.stdout.write(`MIDTURN_BYTES a/${reason} ${r.statusCode} ${r.payload}\n`);
    expect(r.statusCode).toBe(403);
    expect(h.countAtRefusal()).toBe(1);
    expect(h.append).toHaveBeenCalledOnce();
    expect(h.append.mock.calls[0]![0].turn_id).toBe(`${TID}:claim`);
    expect(h.releaseTurnClaim).toHaveBeenCalledExactlyOnceWith(SID, `${TID}:claim`, expect.any(String));
    expect(h.rows.size).toBe(0);
    expect(h.rows.has(TID)).toBe(false);
    expect(h.fence.rows).toHaveLength(0); // This Agent answer acquires no graph fence.
    await expect(state.store!.hasOtherAdmittedLiveTurn!(SID, 'next-turn')).resolves.toBe(false);
    expect(r.payload).toBe(BYTES[reason]);
  } finally { await h.app.close(); }
}, 30_000);

it.each(['in_process', 'child'] as const)('(b) mid-turn flip after %s tool success keeps existing bytes and logs after_commit', async tool => {
  const warn = vi.spyOn(log, 'warn');
  const h = await harness({ tool });
  try {
    const r = await h.inject();
    process.stdout.write(`MIDTURN_BYTES b/${tool} ${r.statusCode} ${r.payload}\n`);
    expect(r.statusCode).toBe(403);
    expect(h.countAtRefusal()).toBe(2);
    expect(h.append).toHaveBeenCalledTimes(2);
    expect(h.rows.has('tool-write')).toBe(true);
    expect(h.rows.has(TID)).toBe(false);
    expect(r.payload).toBe(CODE_ONLY);
    expect(r.payload).not.toContain('Nothing was saved');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'model_write.ownership_refused_after_commit' }), expect.any(String));
  } finally { await h.app.close(); }
}, 30_000);

it.each(['not_owner', 'owner_unreadable'] as const)('(c) claim %s returns exact canonical bytes without any append', async reason => {
  const h = await harness({ reason, atClaim: true });
  try {
    const r = await h.inject();
    process.stdout.write(`MIDTURN_BYTES c/${reason} ${r.statusCode} ${r.payload}\n`);
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(BYTES[reason]);
    expect(h.countAtRefusal()).toBe(0);
    expect(h.append).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    expect(h.releaseTurnClaim).not.toHaveBeenCalled(); expect(h.rows.size).toBe(0);
    expect(h.fence.rows).toHaveLength(0);
  } finally { await h.app.close(); }
});

it.each(['throws', 'absent'] as const)('claim release %s never claims nothing was saved', async release => {
  const h = await harness({ release });
  try {
    const r = await h.inject();
    process.stdout.write(`MIDTURN_BYTES release/${release} ${r.statusCode} ${r.payload}\n`);
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(CODE_ONLY);
    expect(h.rows.has(`${TID}:claim`)).toBe(true);
    expect(h.append).toHaveBeenCalledOnce(); expect(h.rows.has(TID)).toBe(false);
  } finally { await h.app.close(); }
});
