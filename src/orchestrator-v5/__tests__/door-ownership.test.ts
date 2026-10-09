import { claimingTurnFenceStore } from '../../../tests/utils/claiming-turn-fence-store.js';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { createMockSessionStore } from '../../../tests/utils/mock-session-store.js';
import { installOwnershipHarness, verifyFixtureIdentity } from '../../../tests/utils/ownership-route-harness.js';
import { log } from '../../utils/telemetry.js';
import { SupabaseSessionStore } from '../session/supabase-store.js';
import registerRoute from '../../routes/assist.v1.scenario-graph-register.js';

const routeState = vi.hoisted(() => ({ store: undefined as SessionStore | undefined }));
vi.mock('../session/index.js', async load => ({
  ...(await load<typeof import('../session/index.js')>()),
  getSessionStore: () => routeState.store!,
}));
vi.mock('../../utils/supabase-user-jwt.js', async load => ({
  ...(await load<typeof import('../../utils/supabase-user-jwt.js')>()),
  verifySupabaseUserJwt: (token: string) => verifyFixtureIdentity(token),
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, key) => key }),
}));
vi.mock('../../config/index.js', async load => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});

// The same rows run on the untouched base, where no binding/guard exists yet.
const door = existsSync('src/orchestrator-v5/ownership/door-ownership.ts')
  ? await import('../ownership/door-ownership.js') : undefined;
const SID = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c';
const GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'Growth' },
  { id: 'factor', kind: 'factor', label: 'Capacity' }],
  edges: [{ from: 'factor', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' }] };
const write: SessionTurnWrite = { scenario_id: SID, turn_id: 'door-test', turn_class: 'direct_answer',
  handler_id: null, request_hash: 'door-test', response_emitted: false, llm_calls_used: 0,
  duration_ms: 0, handler_facts: [], graph: GRAPH };
const verified = { userId: 'u-owner', verified: true };
const unverified = { userId: null, verified: false };
function bound<T>(caller: { userId: string | null; verified: boolean }, done: () => T): T {
  return door ? door.bindWriteCaller(caller, done) : done();
}
function fixture(owner: string | null) {
  const rows: SessionTurnWrite[] = [structuredClone(write)];
  const append = vi.fn(async (next: SessionTurnWrite) => { rows.push(structuredClone(next)); return { id: 'row' }; });
  const appendIfLatest = vi.fn(async (next: SessionTurnWrite) => { rows.push(structuredClone(next)); return { id: 'row' }; });
  const getScenarioOwner = vi.fn(async () => owner);
  const store = createMockSessionStore({ append, appendIfLatest, getScenarioOwner });
  return { rows, append, appendIfLatest, getScenarioOwner, store };
}
function through(store: SessionStore, writesGraph = true) {
  return appendCheckedGraphWrite({ store, write: writesGraph ? structuredClone(write) : { ...write, graph: undefined, pending_actions: [] },
    writesGraph, source: 'door_test', baseGraphForInvariants: GRAPH });
}
async function refused(operation: Promise<unknown>, reason: 'not_owner' | 'owner_unreadable') {
  const err = await operation.then(() => undefined, (error: unknown) => error);
  expect(err, 'door must refuse before any append').toBeInstanceOf(Error);
  expect(err).toBeInstanceOf(door!.ModelWriteOwnershipRefused);
  expect(err).toMatchObject({ reason, code: 'model_write_ownership_refused' });
  return err as Error & { code: string };
}
function noWrites(f: ReturnType<typeof fixture>, before: string) {
  expect(f.append).not.toHaveBeenCalled();
  expect(f.appendIfLatest).not.toHaveBeenCalled();
  expect(JSON.stringify(f.rows)).toBe(before);
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { routeState.store = undefined; });

it('cross-owner: refuses, logs exactly one prefix-only event, and preserves rows byte-for-byte', async () => {
  const f = fixture('u-owner'); const before = JSON.stringify(f.rows);
  const err = await refused(bound({ userId: 'u-other', verified: true }, () => through(f.store)), 'not_owner');
  noWrites(f, before);
  expect(f.getScenarioOwner).toHaveBeenCalledExactlyOnceWith(SID);
  expect(log.warn).toHaveBeenCalledExactlyOnceWith({ event: 'model_write.ownership_refused',
    site: 'door_test', reason: 'not_owner', scenario_id_prefix: SID.slice(0, 8) }, expect.any(String));
  expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain(SID);
  expect(err.code).not.toBe('revision_conflict');
  expect(err.code).not.toContain('revision');
});
it('owner: a verified owner commits exactly once', async () => {
  const f = fixture('u-owner');
  await expect(bound(verified, () => through(f.store))).resolves.toEqual({ id: 'row' });
  expect(f.append).toHaveBeenCalledTimes(1); expect(f.appendIfLatest).not.toHaveBeenCalled();
  expect(f.getScenarioOwner).toHaveBeenCalledExactlyOnceWith(SID);
});
it.each([verified, unverified])('guest: commits for caller %j', async caller => {
  const f = fixture(null); await bound(caller, () => through(f.store));
  expect(f.append).toHaveBeenCalledTimes(1); expect(f.getScenarioOwner).toHaveBeenCalledTimes(1);
});
it('a detached setImmediate writer (auto-run after draft) inherits the bound owner and commits', async () => {
  const f = fixture('u-owner');
  await bound(verified, () => new Promise<void>((done, fail) => { setImmediate(() => { through(f.store).then(() => done(), fail); }); }));
  expect(f.append).toHaveBeenCalledTimes(1);
});
it('no request context: owned scenario is refused', async () => {
  const f = fixture('u-owner'); const before = JSON.stringify(f.rows);
  await refused(through(f.store), 'not_owner'); noWrites(f, before);
});
it('no request context: guest scenario commits', async () => {
  const f = fixture(null); await through(f.store); expect(f.append).toHaveBeenCalledTimes(1);
});
it('unverified claimed owner is refused', async () => {
  const f = fixture('u-owner'); const before = JSON.stringify(f.rows);
  await refused(bound({ userId: 'u-owner', verified: false }, () => through(f.store)), 'not_owner'); noWrites(f, before);
});
it('reader throws: owner_unreadable, no RPC calls, no leaked reader error', async () => {
  const f = fixture('u-owner'); const before = JSON.stringify(f.rows);
  f.getScenarioOwner.mockRejectedValue(new Error(`reader token secret ${SID}`));
  await refused(bound(verified, () => through(f.store)), 'owner_unreadable'); noWrites(f, before);
  expect(f.getScenarioOwner).toHaveBeenCalledTimes(1);
  expect(log.warn).toHaveBeenCalledExactlyOnceWith({ event: 'model_write.ownership_refused',
    site: 'door_test', reason: 'owner_unreadable', scenario_id_prefix: SID.slice(0, 8) }, expect.any(String));
  expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('secret');
});
it('pending-actions-only cross-owner write is refused', async () => {
  const f = fixture('u-owner'); const before = JSON.stringify(f.rows);
  await refused(bound({ userId: 'u-other', verified: true }, () => through(f.store, false)), 'not_owner'); noWrites(f, before);
});
it('two CAS attempts read the owner exactly once', async () => {
  const f = fixture('u-owner');
  const appendIfLatest = vi.fn<NonNullable<SessionStore['appendIfLatest']>>()
    .mockResolvedValueOnce({ status: 'latest_moved' }).mockResolvedValueOnce({ id: 'row' });
  f.store.appendIfLatest = appendIfLatest;
  f.store.readMostRecentPendingActions = vi.fn<SessionStore['readMostRecentPendingActions']>(async (_id, options) => { options?.onLatestRowId?.('latest'); return []; });
  await bound(verified, () => appendCheckedGraphWrite({ store: f.store, write, writesGraph: true, source: 'door_test',
    baseGraphForInvariants: GRAPH, heldProposals: { isHeld: () => false, seenByThisRequest: new Set() } }));
  expect(appendIfLatest).toHaveBeenCalledTimes(2); expect(f.append).not.toHaveBeenCalled();
  expect(f.getScenarioOwner).toHaveBeenCalledExactlyOnceWith(SID);
});
it('a store modelling no ownership allows a write', async () => {
  const f = fixture('u-owner'); delete f.store.getScenarioOwner;
  await through(f.store); expect(f.append).toHaveBeenCalledTimes(1);
});
it('production Supabase session store implements the ownership reader', async () => {
  expect(typeof SupabaseSessionStore.prototype.getScenarioOwner).toBe('function');
  const rpc = vi.fn();
  const maybeSingle = vi.fn(async () => ({ data: { user_id: 'u-owner' }, error: null }));
  const eq = vi.fn(() => ({ maybeSingle })); const select = vi.fn(() => ({ eq })); const from = vi.fn(() => ({ select }));
  const store = new SupabaseSessionStore({ from, rpc } as never, { invalidateAll: vi.fn() } as never, {} as never);
  expect(await store.getScenarioOwner(SID)).toBe('u-owner');
  expect(from).toHaveBeenCalledExactlyOnceWith('scenarios'); expect(select).toHaveBeenCalledExactlyOnceWith('user_id');
  expect(eq).toHaveBeenCalledExactlyOnceWith('id', SID); expect(maybeSingle).toHaveBeenCalledTimes(1);
  expect(rpc).not.toHaveBeenCalled();
});

async function realRegistration(ownerAtDoor: string, failRead = false) {
  const f = fixture(ownerAtDoor);
  const fence = claimingTurnFenceStore();
  f.store.claimTurnFence = fence.store.claimTurnFence.bind(fence.store);
  f.store.markGraphWriteFailed = fence.store.markGraphWriteFailed.bind(fence.store);
  f.store.hasOtherAdmittedLiveTurn = fence.store.hasOtherAdmittedLiveTurn.bind(fence.store);
  if (failRead) f.getScenarioOwner.mockRejectedValue(new Error('reader unavailable'));
  f.store.readExistingScenario = async () => ({ userId: 'u-owner', graph: GRAPH, briefText: null, analysisInvalidatedAt: null });
  f.store.ensureScenarioExists = async () => ({ user_id: 'u-owner' });
  f.store.loadGraph = async () => GRAPH;
  routeState.store = f.store;
  const app = Fastify();
  try {
    await installOwnershipHarness(app, () => ({ mode: 'verified', userId: 'u-owner' }));
    await registerRoute(app);
    const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SID}/graph/register`,
      payload: { graph: { ...GRAPH, nodes: GRAPH.nodes.map(n => ({ ...n, label: `${n.label} updated` })) } } });
    return { ...f, response, fence };
  } finally { await app.close(); }
}
it('real route: verified owner inherits the binding and commits through the real door', async () => {
  const { response, append, getScenarioOwner } = await realRegistration('u-owner');
  expect(response.statusCode, response.payload).toBe(200);
  expect(append).toHaveBeenCalledTimes(1); expect(append.mock.calls[0][0].scenario_id).toBe(SID);
  expect(getScenarioOwner).toHaveBeenCalledExactlyOnceWith(SID);
});
it.each([false, true])('real route: ownership changes/read failures at the door surface as 403, reader fails %s', async failRead => {
  const { response, append, appendIfLatest, fence, store } = await realRegistration('u-other', failRead);
  expect(response.statusCode, response.payload).toBe(403);
  expect(response.json()).toEqual({ error: 'model_write_ownership_refused' });
  expect(response.payload).not.toContain('revision');
  expect(append).not.toHaveBeenCalled(); expect(appendIfLatest).not.toHaveBeenCalled();
  expect(fence.rows).toHaveLength(1);
  expect(fence.rows[0]).toMatchObject({ graph_write_failed_at: expect.any(String),
    graph_write_failure_reason: 'model_write_ownership_refused', graph_loss_disclosable_at: null });
  await expect(store.hasOtherAdmittedLiveTurn!(SID, 'next-registration')).resolves.toBe(false);
});
