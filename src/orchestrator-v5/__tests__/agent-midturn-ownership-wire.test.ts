/** Real Agent HTTP route, ownership hook, tool loop and persistence door; local provider/store ports. */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommittedTurnRecord, SessionStore, SessionTurnWrite } from '../session/store.js';
import type { SessionTurnWithContent } from '../session/conversation-content.js';
import { DURABLE_SEED_ROWS_READ, HistoryStore } from '../agent-lane/history-store.js';
import { createMockSessionStore } from '../../../tests/utils/mock-session-store.js';
import { claimingTurnFenceStore } from '../../../tests/utils/claiming-turn-fence-store.js';
import { installOwnershipHarness, verifyFixtureIdentity } from '../../../tests/utils/ownership-route-harness.js';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import { readSuccessfulDoorEntries, readUnsavableEffects, recordSuccessfulSave, bindWriteCaller } from '../ownership/door-ownership.js';
import * as guidanceHistory from '../agent-lane/turn-context/guidance-history.js';
import served from '../agent-lane/__tests__/fixtures/m1-s1-served-graphs.json';
import { legacyDoorGraph } from '../agent-lane/__tests__/licence-test-graphs.js';
import { agentV1TurnRoute } from '../../routes/agent-v1-turn.js';
import { ceeOrchestratorRouteV2 } from '../../orchestrator/route-v2.js';
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
const SEED_ROW: SessionTurnWithContent = {
  id: 'c1111111-1111-4111-8111-111111111111', scenario_id: SID, user_id: null, turn_id: 'previous-answer',
  turn_class: 'direct_answer', handler_id: null, request_hash: 'agent_turn:previous-answer', response_emitted: true,
  llm_calls_used: 1, duration_ms: 0, created_at: '2026-10-08T12:00:00.000Z',
  user_message: 'Previously saved saffron reasoning.', assistant_message: 'Previously saved saffron answer.',
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); state.store = undefined; state.tool = undefined; });

async function harness(options: {
  reason?: keyof typeof BYTES; atClaim?: boolean; tool?: 'in_process' | 'child' | 'refused'; release?: 'throws' | 'absent';
  missing?: boolean; guidance?: boolean; seed?: boolean;
} = {}) {
  const graph = options.guidance ? legacyDoorGraph(served.cases.find(c => c.id === 'D1-sprint-run')!.graph) : GRAPH;
  const routeBodies: string[] = [];
  const rows = new Map<string, CommittedTurnRecord>();
  const fence = claimingTurnFenceStore();
  let flipped = options.atClaim ?? false;
  let scenarioExists = !options.missing;
  let countAtRefusal = -1;
  let effectsAtRefusal = -1;
  const getScenarioOwner = vi.fn(async () => {
    if (!flipped) return OWNER;
    countAtRefusal = readSuccessfulDoorEntries();
    effectsAtRefusal = readUnsavableEffects();
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
  const readRecent = vi.fn<SessionStore['readRecent']>(async () => options.seed ? [SEED_ROW] : []);
  const ensureScenarioExists = vi.fn(async () => { scenarioExists = true; return { user_id: OWNER }; });
  state.store = createMockSessionStore({ append, getScenarioOwner, releaseTurnClaim, ensureScenarioExists, readRecent,
    scenarioExists: async () => scenarioExists,
    readCommittedTurn: async (_sid, tid) => rows.get(tid) ?? null,
    claimTurnFence: fence.store.claimTurnFence.bind(fence.store),
    markGraphWriteFailed: fence.store.markGraphWriteFailed.bind(fence.store),
    hasOtherAdmittedLiveTurn: fence.store.hasOtherAdmittedLiveTurn.bind(fence.store),
    readExistingScenario: async () => scenarioExists ? { userId: OWNER, graph, briefText: null, analysisInvalidatedAt: null } : null,
    loadGraph: async () => graph, loadGraphAndBriefText: async () => ({ graph, briefText: null }),
  });
  if (options.release === 'absent') delete state.store.releaseTurnClaim;
  const app: FastifyInstance = Fastify();
  await installOwnershipHarness(app, () => ({ mode: 'verified', userId: OWNER }));
  app.addHook('preSerialization', async (req, _reply, payload) => {
    if (req.routeOptions.url === '/agent/v1/turn') routeBodies.push(JSON.stringify(payload));
    return payload;
  });
  if (options.guidance) app.post('/assist/v1/scenarios/:scenario_id/graph', {
    config: { scenarioId: { from: 'params', key: 'scenario_id' } },
  }, async () => ({ graph, graph_hash: 'guidance-control', analysis_ready: { status: 'ready', may_run: true },
    analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-01T11:52:22.669Z' }, usable_for_chips: true },
    analysis_option_participation: [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }],
  }));
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
  const providerInputs: string[] = [];
  const fetch = vi.fn(async (_url: unknown, init?: Parameters<typeof globalThis.fetch>[1]) => {
    providerInputs.push(String(init?.body));
    calls += 1;
    if (options.tool && calls === 1) {
      if (options.tool === 'refused') flipped = true;
      return new Response(JSON.stringify({ output: [{
        type: 'function_call', name: 'authorise_change', call_id: 'tool-fixture',
        arguments: JSON.stringify({ proposal_id: 'prop_0123456789abcdef0123456789abcdef' }),
      }] }), { status: 200 });
    }
    // Both the claim and the optional tool have finished before the final append.
    flipped = true;
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Consider the assumptions together.' }] }] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  await agentV1TurnRoute(app);
  await ceeOrchestratorRouteV2(app);
  const inject = (payload = {}) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-request-id': 'midturn-request' },
    payload: { scenario_id: SID, turn_id: TID, message: 'Consider the strategic framing.', ...payload } });
  return { app, rows, fence, append, releaseTurnClaim, fetch, inject, providerInputs, ensureScenarioExists, routeBodies, readRecent,
    scenarioExists: () => scenarioExists, countAtRefusal: () => countAtRefusal, effectsAtRefusal: () => effectsAtRefusal,
  };
}

it.each([
  ['not_owner', 'composer'], ['owner_unreadable', 'composer'],
  ['not_owner', 'chip_click'], ['owner_unreadable', 'chip_click'],
] as const)('(a) published claim-only mid-turn %s/%s keeps code-only bytes and releases the claim without after_commit', async (reason, source) => {
  const warn = vi.spyOn(log, 'warn');
  const h = await harness({ reason });
  try {
    const r = await h.inject({ source });
    process.stdout.write(`MIDTURN_BYTES a/${reason}/${source} ${r.statusCode} ${r.payload}\n`);
    expect(r.statusCode).toBe(403);
    expect(h.countAtRefusal()).toBe(1);
    expect(h.effectsAtRefusal()).toBe(source === 'composer' ? 2 : 1);
    expect(h.ensureScenarioExists).not.toHaveBeenCalled();
    expect(h.append).toHaveBeenCalledOnce();
    expect(h.append.mock.calls[0]![0].turn_id).toBe(`${TID}:claim`);
    expect(h.releaseTurnClaim).toHaveBeenCalledExactlyOnceWith(SID, `${TID}:claim`, expect.any(String));
    expect(h.rows.size).toBe(0);
    expect(h.rows.has(TID)).toBe(false);
    expect(h.fence.rows).toHaveLength(0); // This Agent answer acquires no graph fence.
    await expect(state.store!.hasOtherAdmittedLiveTurn!(SID, 'next-turn')).resolves.toBe(false);
    expect(r.payload).toBe(CODE_ONLY);
    expect(r.payload).not.toContain('Nothing was saved');
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'model_write.ownership_refused_after_commit' }), expect.any(String));
  } finally { await h.app.close(); }
}, 30_000);

it.each(['in_process', 'child'] as const)('durable tool control: mid-turn flip after %s tool success keeps existing bytes and logs after_commit', async tool => {
  const warn = vi.spyOn(log, 'warn');
  const h = await harness({ tool });
  try {
    const r = await h.inject();
    process.stdout.write(`MIDTURN_BYTES tool/${tool} ${r.statusCode} ${r.payload}\n`);
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

it.each(['not_owner', 'owner_unreadable'] as const)('(b) before-publication claim %s returns exact canonical bytes without any append', async reason => {
  const h = await harness({ reason, atClaim: true });
  try {
    const r = await h.inject();
    process.stdout.write(`MIDTURN_BYTES b/${reason} ${r.statusCode} ${r.payload}\n`);
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(BYTES[reason]);
    expect(h.routeBodies).toEqual([BYTES[reason]]); // Pin the direct catch before the real onSend hook.
    expect(h.countAtRefusal()).toBe(0); expect(h.effectsAtRefusal()).toBe(0);
    expect(h.ensureScenarioExists).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    expect(h.releaseTurnClaim).not.toHaveBeenCalled(); expect(h.rows.size).toBe(0);
    expect(h.fence.rows).toHaveLength(0);
  } finally { await h.app.close(); }
});

it('(c) unclaimed guidance turn refuses after publication without an onSend no-save override', async () => {
  const warn = vi.spyOn(log, 'warn');
  const guidance = vi.spyOn(guidanceHistory, 'guidanceOnAnswer');
  const h = await harness({ guidance: true });
  try {
    const r = await h.inject({ turn_id: undefined, message: 'Where does this leave me?' });
    process.stdout.write(`MIDTURN_BYTES c ${r.statusCode} ${r.payload}\n`);
    expect(guidance).toHaveBeenCalled();
    expect(guidance.mock.results.some(result => result.type === 'return' && result.value !== undefined)).toBe(true);
    expect(h.effectsAtRefusal()).toBe(2);
    expect(h.countAtRefusal()).toBe(0); // The minted final row really entered and was refused at the door.
    expect(h.fetch).toHaveBeenCalledOnce(); expect(h.append).not.toHaveBeenCalled();
    expect(h.releaseTurnClaim).not.toHaveBeenCalled(); expect(h.rows.size).toBe(0);
    expect(h.routeBodies).toEqual([CODE_ONLY]);
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(CODE_ONLY);
    expect(r.payload).not.toContain('Nothing was saved');
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'model_write.ownership_refused_after_commit' }), expect.any(String));
  } finally { await h.app.close(); }
}, 30_000);

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

it('(d) missing scenario provisioning survives an unreadable claim refusal without no-save copy', async () => {
  const h = await harness({ missing: true, atClaim: true, reason: 'owner_unreadable' });
  try {
    expect(h.scenarioExists()).toBe(false);
    const r = await h.inject();
    process.stdout.write(`MIDTURN_R2_BYTES d ${r.statusCode} ${r.payload}\n`);
    expect(h.ensureScenarioExists).toHaveBeenCalledOnce(); expect(h.scenarioExists()).toBe(true);
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(CODE_ONLY);
    expect(r.payload).not.toContain('Nothing was saved');
    expect(h.append).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    expect(h.countAtRefusal()).toBe(1); expect(h.effectsAtRefusal()).toBe(0);
  } finally { await h.app.close(); }
});

it('(e) provisioning survives the released claim and final append refusal, logged after_commit', async () => {
  const warn = vi.spyOn(log, 'warn');
  const h = await harness({ missing: true, reason: 'owner_unreadable' });
  try {
    const r = await h.inject();
    process.stdout.write(`MIDTURN_R2_BYTES e ${r.statusCode} ${r.payload}\n`);
    expect(h.ensureScenarioExists).toHaveBeenCalledOnce(); expect(h.scenarioExists()).toBe(true);
    expect(h.append).toHaveBeenCalledOnce(); expect(h.rows.size).toBe(0);
    expect(h.releaseTurnClaim).toHaveBeenCalledExactlyOnceWith(SID, `${TID}:claim`, expect.any(String));
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(CODE_ONLY);
    expect(r.payload).not.toContain('Nothing was saved'); expect(h.countAtRefusal()).toBe(2); expect(h.effectsAtRefusal()).toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'model_write.ownership_refused_after_commit' }), expect.any(String));
  } finally { await h.app.close(); }
});

it('(f) v2 provisioning survives a door refusal without an onSend no-save override', async () => {
  const warn = vi.spyOn(log, 'warn');
  const h = await harness({ missing: true, atClaim: true, reason: 'owner_unreadable' });
  try {
    const r = await h.app.inject({ method: 'POST', url: '/orchestrate/v2/turn', headers: { 'x-request-id': 'midturn-request' },
      payload: { kind: 'system_event', scenario_id: SID, turn_id: TID, stage: 'analyse',
        event: { kind: 'factor_value_edit', target_id: 'factor', value: 0.65 } } });
    process.stdout.write(`MIDTURN_R2_BYTES f ${r.statusCode} ${r.payload}\n`);
    expect(h.ensureScenarioExists).toHaveBeenCalledOnce(); expect(h.scenarioExists()).toBe(true);
    expect(h.append).not.toHaveBeenCalled(); expect(h.countAtRefusal()).toBe(1); expect(h.effectsAtRefusal()).toBe(0);
    expect(r.statusCode).toBe(500);
    expect(r.payload).toBe('{"error":"INTERNAL_ERROR","boundary":"B1","direction":"egress","validator":"turn_commit","details":{"retryable":true,"reason":"system_event_commit_failed","event_kind":"factor_value_edit","stage":"analyse"},"request_id":"midturn-request","retryable":true}');
    expect(r.payload).not.toContain('Nothing was saved');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'model_write.ownership_refused_after_commit' }), expect.any(String));
  } finally { await h.app.close(); }
});

it.each(['not_owner', 'owner_unreadable'] as const)('(h) durable seed alone is not an effect before a mid-loop %s tool refusal', async reason => {
  const get = vi.spyOn(HistoryStore.prototype, 'get');
  const set = vi.spyOn(HistoryStore.prototype, 'set');
  const typed = vi.spyOn(HistoryStore.prototype, 'recordTyped');
  const warn = vi.spyOn(log, 'warn');
  const h = await harness({ reason, seed: true, tool: 'refused' });
  const sessionId = `seed-refusal-${reason}`;
  try {
    const r = await h.inject({ agent_session_id: sessionId, turn_id: undefined, source: 'chip_click' });
    process.stdout.write(`MIDTURN_R4_BYTES h/${reason} ${r.statusCode} ${r.payload} durable=${h.countAtRefusal()} effects=${h.effectsAtRefusal()}\n`);
    expect(get.mock.calls[0]).toEqual([sessionId]); expect(get.mock.results[0]!.value).toEqual([]);
    expect(h.readRecent).toHaveBeenCalledWith(SID, DURABLE_SEED_ROWS_READ);
    // Only the existing durable pair was set; no answer items from this turn were published.
    expect(set).toHaveBeenCalledExactlyOnceWith(sessionId, [
      { role: 'user', content: [{ type: 'input_text', text: SEED_ROW.user_message }] },
      { role: 'assistant', content: SEED_ROW.assistant_message },
    ]);
    expect(typed).not.toHaveBeenCalled();
    expect(h.providerInputs).toHaveLength(1);
    expect(h.providerInputs[0]).toContain(SEED_ROW.user_message!);
    expect(h.providerInputs[0]).toContain(SEED_ROW.assistant_message!);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.ensureScenarioExists).not.toHaveBeenCalled();
    expect(h.append).not.toHaveBeenCalled(); expect(h.releaseTurnClaim).not.toHaveBeenCalled();
    expect(h.rows.size).toBe(0); expect(h.fence.rows).toHaveLength(0);
    expect(r.statusCode).toBe(403); expect(r.payload).toBe(BYTES[reason]);
    expect(h.countAtRefusal()).toBe(0); expect(h.effectsAtRefusal()).toBe(0);
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'model_write.ownership_refused_after_commit' }), expect.any(String));
  } finally { await h.app.close(); }
}, 30_000);

it('explicit saves are inert without context and aggregate through the same child/parent chain as door entries', () => {
  recordSuccessfulSave(); expect(readSuccessfulDoorEntries()).toBe(0);
  const request = {};
  bindWriteCaller({ userId: OWNER, verified: true }, () => {
    expect(readSuccessfulDoorEntries(request)).toBe(0);
    bindWriteCaller({ userId: OWNER, verified: true }, () => {
      recordSuccessfulSave(); expect(readSuccessfulDoorEntries()).toBe(1);
      expect(readSuccessfulDoorEntries(request)).toBe(1);
    });
    expect(readSuccessfulDoorEntries()).toBe(1);
  }, request);
  expect(readSuccessfulDoorEntries()).toBe(0);
});
