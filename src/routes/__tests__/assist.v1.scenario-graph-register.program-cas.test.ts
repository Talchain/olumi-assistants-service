/**
 * W5 (DL 27 Oct, Option A): a MODEL PROGRAM's save is decided by its identity and revision compare-and-set alone. The register
 * computes its CAS base's identity only (the legacy analysis hash is not computed for it), and the store's app-side A3 hook,
 * which decides by the legacy analysis projection, does not run for it; v6's revision check and the RPC's identity check decide.
 * Every other save is unchanged. A revision refusal is said as the save's `stale`, like GRAPH_STALE.
 *
 * The REAL register route over the REAL `SupabaseSessionStore` (v6 append); only the Supabase client is fake (tables and RPCs
 * held in memory). A concurrent writer lands between the register's base read and the store's pre-write SELECT. Synthetic
 * bakery program; a synthetic non-program graph for the contrast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';

const ports = vi.hoisted(() => ({ store: vi.fn(), throwHash: false, hashCallers: [] as string[], categorise: 0, baseHashed: [] as unknown[] }));
/** The caller of a legacy-hash call: the first frames under src/ outside this spec. */
const callerOf = (): string => (new Error().stack ?? '').split('\n').map((l) => /src\/([\w./-]+\.ts):\d+/.exec(l)?.[1])
  .filter((f): f is string => f !== undefined && !f.includes('__tests__') && !f.endsWith('graph-hash.ts')).slice(0, 3).join(' <- ');
vi.mock('../../orchestrator-v5/session/index.js', async (load) => ({ ...await load<Record<string, unknown>>(), getSessionStore: ports.store }));
vi.mock('../../orchestrator/user-identity.js', async (load) => ({ ...await load<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
// The legacy analysis hash, as served, with its callers recorded and an optional throw (row b).
vi.mock('../../orchestrator-v5/context/graph-hash.js', async (load) => {
  const a = await load<typeof import('../../orchestrator-v5/context/graph-hash.js')>();
  const traced = <F extends (...x: never[]) => unknown>(f: F) => ((...x: Parameters<F>) => {
    ports.hashCallers.push(callerOf());
    if (ports.throwHash) throw new Error('the legacy analysis projection threw');
    return f(...x);
  }) as F;
  return { ...a, computeAnalysisAffectingGraphHash: traced(a.computeAnalysisAffectingGraphHash), computeAnalysisAffectingGraphHashSha256: traced(a.computeAnalysisAffectingGraphHashSha256) };
});
// The categoriser and the both-hash base, counted (the real functions run).
vi.mock('../../orchestrator-v5/context/graph-cas-conflict.js', async (load) => {
  const a = await load<typeof import('../../orchestrator-v5/context/graph-cas-conflict.js')>();
  return { ...a,
    categoriseGraphCasWrite: (...x: Parameters<typeof a.categoriseGraphCasWrite>) => { ports.categorise += 1; return a.categoriseGraphCasWrite(...x); },
    computeExpectedGraphCasHashes: (g: unknown) => { ports.baseHashed.push(g); return a.computeExpectedGraphCasHashes(g); } };
});

import * as storeModule from '../../orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../orchestrator-v5/session/cache.js';
import type { SessionTurnWrite } from '../../orchestrator-v5/session/store.js';
import { _resetConfigCache } from '../../config/index.js';
import { setTestSink } from '../../utils/telemetry.js';
import registerRoute from '../assist.v1.scenario-graph-register.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { writeCorePostimage } from '../../orchestrator-v5/path-b/tools/core-write.js';
import type { InternalDispatch } from '../../orchestrator-v5/core-route/internal-dispatch.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import { bakery, BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { postimageOf, withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { isProgramGraph, MODEL_PROGRAM, savedProgramOf } from '../../orchestrator-v5/model-program-turn/program-store.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPERATION = '11111111-1111-4111-8111-111111111111';
type Row = Record<string, any>;
const identityOf = (g: unknown): string => computeGraphIdentityHash(g as never)!.value;
/** Where a program save still computes the legacy analysis hash: each decides nothing (the receipt column, the review marker, the invariant report). */
const PROGRAM_SAVE_HASH_CALLERS = [
  // register.ts:1260 -> the awaiting-review marker's `model` (program-card.ts:75), which no reader reads (program-card.ts:66 reads presence).
  'orchestrator-v5/context/graph-cas-conflict.ts <- orchestrator-v5/context/graph-cas-conflict.ts <- routes/assist.v1.scenario-graph-register.ts',
  // register.ts:1181 -> commit.ts:1070: the version receipt's column, written to the database, compared by nothing on this path.
  'orchestrator-v5/context/graph-identity.ts <- orchestrator-v5/commit.ts <- routes/assist.v1.scenario-graph-register.ts',
  // persisted-graph-invariants.ts:217-224 (guarded): the report's `analysisGraphHash`, read only by the v2 commit.
  'orchestrator-v5/persisted-graph-invariants.ts <- orchestrator-v5/persist-graph-write.ts <- orchestrator-v5/persist-graph-write.ts',
  'orchestrator-v5/persisted-graph-invariants.ts <- orchestrator-v5/persist-graph-write.ts <- routes/assist.v1.scenario-graph-register.ts',
];

// ── The program: a saved one (P0), the save sent on it (P1), and two concurrent writes on P0. ─────────────────────────────
const P0 = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf('w5-cas'), person_words: [BRIEF], runs: [] }).graph as Row;
const p0 = savedProgramOf(P0)!;
const P1 = withNewRun({ ...p0, person_words: [...p0.person_words, 'The second oven is a maybe.'] }).graph as Row;
/** The living model moved, the legacy analysis projection did not (it reads `cosmetic` under the old hook). */
const wordsMoved = postimageOf({ ...p0, person_words: [...p0.person_words, 'A note another writer added.'] }) as Row;
/** A figure moved: the legacy analysis projection diverges (the old hook blocks it under enforce). */
const figureMoved = postimageOf({ ...p0, canonical: { ...p0.canonical, quantities: p0.canonical.quantities.map((q) => (q.id === 'base_sales' ? { ...q, value: (q.value ?? 0) + 7 } : q)) } }) as Row;

// ── The contrast: a non-program model, its save, and two concurrent writes. ─────────────────────────────────────────────
function plain(price = 0.49, label = 'Price'): Row {
  return projectGraphForPersistence(GraphV3.parse({
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_price', kind: 'factor', label, observed_state: { value: price, source: 'brief_extraction' } },
      { id: 'opt_hold', kind: 'option', label: 'Hold price', is_baseline: true,
        interventions: { fac_price: { value: 0.49, source: 'brief_extraction', target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' } } } },
      { id: 'opt_raise', kind: 'option', label: 'Raise price',
        interventions: { fac_price: { value: 0.59, source: 'brief_extraction', target_match: { node_id: 'fac_price', match_type: 'exact_id', confidence: 'high' } } } },
    ],
    edges: [['opt_hold', 'fac_price'], ['opt_raise', 'fac_price'], ['fac_price', 'goal_revenue']]
      .map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
    goal_node_id: 'goal_revenue',
  })) as Row;
}

/** Only the remote Supabase boundary is fake; every store method, the RPC choice and its CAS arguments are the real store's. */
function harness(mode: 'observe' | 'enforce', stored: Row, concurrent: Row | null) {
  const tables: Record<string, Row[]> = {
    scenarios: [{ id: SCENARIO, user_id: null, graph: structuredClone(stored), brief_text: BRIEF, analysis_invalidated_at: null, revision: 7 }],
    v5_conversation_turns: [], v5_handler_facts: [], v5_turn_fence: [],
  };
  const rpc: Array<{ name: string; args: Row }> = [];
  let graphReads = 0;
  const client = {
    rpc: vi.fn(async (name: string, args: Row) => {
      rpc.push({ name, args: structuredClone(args) });
      if (name === 'ensure_scenario_exists') return { data: null, error: null };
      if (name === 'v5_claim_turn_fence') return { data: 1, error: null };
      if (!name.startsWith('append_turn_atomic_')) return { data: null, error: { code: 'PGRST202', message: `no ${name}` } };
      const s = tables.scenarios![0]!;
      // v6: the revision compare-and-set, in the commit's own transaction.
      if ((name === 'append_turn_atomic_v6' || name === 'append_turn_atomic_v4r') && args.p_expected_revision !== s.revision) {
        return { data: null, error: { code: 'OLRV1', message: 'revision_conflict',
          details: JSON.stringify({ reason: 'revision_conflict', expected: args.p_expected_revision, current: s.revision }) } };
      }
      tables.v5_conversation_turns!.push({ id: 'row-1', scenario_id: SCENARIO, user_id: null, turn_id: args.p_turn_id, request_hash: args.p_request_hash,
        turn_class: args.p_turn_class, handler_id: args.p_handler_id, pending_actions: args.p_pending_actions, created_at: '2026-10-27T10:00:00.000Z' });
      if (args.p_graph != null) { s.graph = structuredClone(args.p_graph); s.revision += 1; }
      return { data: { turn_row_id: 'row-1', revision: s.revision, model_version_receipt: null }, error: null };
    }),
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let columns = '*';
      let limit = Infinity;
      let update: Row | null = null;
      const run = () => {
        const isGraph = table === 'scenarios' && columns.split(',').map((c) => c.trim()).includes('graph');
        const filtered = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (update) { for (const r of filtered) Object.assign(r, update); return { data: null, error: null }; }
        const rows = filtered.slice(0, limit).map((r) => (columns === '*' ? structuredClone(r)
          : Object.fromEntries(columns.split(',').map((c) => [c.trim(), structuredClone(r[c.trim()])]))));
        // The concurrent writer lands right after the register's own base read.
        if (isGraph && (graphReads += 1) === 1 && concurrent !== null) { tables.scenarios![0]!.graph = structuredClone(concurrent); tables.scenarios![0]!.revision = 8; }
        return { data: rows, error: null };
      };
      const chain: Row = {
        select(v: string) { columns = v; return chain; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return chain; },
        neq(k: string, v: unknown) { filters.push((r) => r[k] !== v); return chain; },
        in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return chain; },
        not(k: string, op: string, v: unknown) {
          filters.push((r) => (op === 'is' ? r[k] != null : op === 'like' ? !String(r[k]).endsWith(String(v).replace(/^%/, '')) : r[k] !== v));
          return chain;
        },
        is(k: string, v: unknown) { filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return chain; },
        order() { return chain; }, limit(v: number) { limit = v; return chain; }, update(v: Row) { update = v; return chain; }, abortSignal() { return chain; },
        maybeSingle: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
        then(res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) { try { return Promise.resolve(res(run())); } catch (e) { return Promise.resolve(rej?.(e)); } },
      };
      return chain;
    },
  };
  const real = new storeModule.SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 }),
    { defaultReadLimit: 20, graphCasMode: mode, graphCasRpc: 'shadow' });
  const appended: SessionTurnWrite[] = [];
  const store = new Proxy(real, { get: (t, k) => {
    const v = Reflect.get(t, k, t);
    if (k === 'append' && typeof v === 'function') return (w: SessionTurnWrite) => { appended.push(w); return Reflect.apply(v, t, [w]); };
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  ports.store.mockReturnValue(store);
  return { tables, rpc, appended };
}

const cas: string[] = [];
beforeEach(() => {
  storeModule.__setUseAppendV6ForTest(true);
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_REQUIRE_USER_JWT', 'false');
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
  _resetConfigCache();
  cas.length = 0;
  setTestSink((name, data) => { if (name.startsWith('v5.graph_cas')) cas.push(`${name}:${data.category}/${data.reason}`); });
  ports.throwHash = false; ports.hashCallers.length = 0; ports.categorise = 0; ports.baseHashed.length = 0;
});
afterEach(() => { storeModule.__setUseAppendV6ForTest(true); vi.unstubAllEnvs(); _resetConfigCache(); setTestSink(null); });

/** One save through the real register route, as CEE's own writer (`thin_core` for a program, as core-write sends it). */
async function save(h: ReturnType<typeof harness>, graph: Row, base: Row, program: boolean) {
  cas.length = 0;
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  try {
    const res = await injectAsCeeWriter(app, { method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`,
      payload: { graph, operation_id: OPERATION, brief_text: BRIEF, expected_graph_identity_hash: identityOf(base), ...(program ? { thin_core: true } : {}) } });
    const body = res.json() as Row;
    return { status: res.statusCode, code: body.details?.code ?? null, appendRpc: h.rpc.filter((c) => c.name.startsWith('append_turn_atomic_')).map((c) => c.name), cas: [...cas] };
  } finally { await app.close(); }
}

/** core-write over the real register route, through a raw dispatch (the core route's own, as its canvas edits send). */
async function coreWrite(graph: Row, base: Row) {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const ownVersion = vi.fn(async () => null);
  const dispatch: InternalDispatch = async (path, body) => {
    if (!path.endsWith('/graph/register')) return { status: 404, json: {} };
    const res = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body as Row });
    return { status: res.statusCode, json: res.json() as Row };
  };
  try {
    const w = await writeCorePostimage({ dispatch }, { scenarioId: SCENARIO, graph, operationId: OPERATION, expectedIdentity: identityOf(base), briefText: BRIEF, ownVersion });
    return { write: w, ownVersionCalls: ownVersion.mock.calls.length };
  } finally { await app.close(); }
}

describe('W5 Option A: a program save is decided by its identity and revision CAS, never by the legacy analysis hash', () => {
  it('SETUP: the fixtures are a program and a non-program model, and the program\'s two concurrent writes move its identity with and without the legacy hash', () => {
    expect([isProgramGraph(P0), isProgramGraph(P1), isProgramGraph(plain())]).toEqual([true, true, false]);
    const analysis = (g: Row) => computeAnalysisAffectingGraphHash(g as never);
    expect([identityOf(wordsMoved) !== identityOf(P0), analysis(wordsMoved) === analysis(P0)]).toEqual([true, true]);
    expect([identityOf(figureMoved) !== identityOf(P0), analysis(figureMoved) === analysis(P0)]).toEqual([true, false]);
  });

  it('(a) enforce, the identity moved by a living-model-only change: the hook does not run for the program save, v6 decides, and core-write says stale', async () => {
    const h = harness('enforce', P0, wordsMoved);
    const r = await save(h, P1, P0, true);
    expect([r.status, r.code, r.appendRpc, r.cas, ports.categorise]).toEqual([409, 'revision_conflict', ['append_turn_atomic_v6'], [], 0]);
    expect(h.appended.map((w) => w.programSave), 'the write carries the program save\'s mark').toEqual([true]);
    expect(h.tables.scenarios![0]!.graph, 'nothing written over the concurrent copy').toEqual(wordsMoved);
    // A figure moved (the legacy projection diverged): the old hook blocked it pre-RPC; now v6 decides it too.
    const f = harness('enforce', P0, figureMoved);
    const rf = await save(f, P1, P0, true);
    expect([rf.status, rf.code, rf.appendRpc, rf.cas, ports.categorise]).toEqual([409, 'revision_conflict', ['append_turn_atomic_v6'], [], 0]);
    // The save's own outcome, through core-write: the model moved and nothing was written.
    harness('enforce', P0, wordsMoved);
    const w = await coreWrite(P1, P0);
    expect([w.write, w.ownVersionCalls]).toEqual([{ status: 'stale' }, 1]);
    // With no concurrent write the save lands, still with no hook.
    const ok = harness('enforce', P0, null);
    const r0 = await save(ok, P1, P0, true);
    expect([r0.status, r0.appendRpc, r0.cas, ports.categorise]).toEqual([200, ['append_turn_atomic_v6'], [], 0]);
  });

  it('(b1) a program save\'s base is hashed by identity alone: the legacy hash never runs on it (the old :789 path is gone); it runs only where it decides nothing', async () => {
    const h0 = harness('observe', P0, null);
    expect((await save(h0, P1, P0, true)).status).toBe(200);
    expect(ports.baseHashed.filter((g) => identityOf(g) === identityOf(P0)), 'the both-hash base was never given the stored base').toEqual([]);
    expect([...new Set(ports.hashCallers)].sort(), 'the legacy hash runs only where it decides nothing').toEqual(PROGRAM_SAVE_HASH_CALLERS);
  });

  it('(b2) the legacy analysis hash throws during a program save: no false 409; commit.ts\'s receipt hash fails the save, which core-write says is unknown', async () => {
    const h = harness('enforce', P0, null);
    ports.throwHash = true;
    const r = await save(h, P1, P0, true);
    const threwAt = [...ports.hashCallers];
    const w = (harness('enforce', P0, null), await coreWrite(P1, P0));
    ports.throwHash = false;
    expect([r.status, r.code, r.appendRpc, r.cas], 'never a GRAPH_STALE, nothing written').toEqual([500, null, [], []]);
    expect(threwAt, 'the one throw is the receipt hash (register.ts:1181 -> commit.ts:1070), never the base').toEqual([PROGRAM_SAVE_HASH_CALLERS[1]]);
    expect(h.tables.scenarios![0]!.graph).toEqual(P0);
    const outcome = w.write.status === 'unknown' ? (w.write.outcome as { status?: unknown; reason?: unknown }) : null;
    expect(outcome === null ? w.write : [outcome.status, outcome.reason]).toEqual(['unavailable', 'not_confirmed']);
  });

  it('(c) CONTRAST: a non-program save categorises exactly as before, in observe and in enforce, and carries no program mark', async () => {
    const base = plain();
    const sent = plain(0.55);
    const renamed = plain(0.49, 'Unit price');
    const repriced = plain(0.52);
    const out: Row = {};
    for (const mode of ['observe', 'enforce'] as const) {
      for (const [name, concurrent] of [['renamed', renamed], ['repriced', repriced]] as const) {
        const h = harness(mode, base, concurrent);
        ports.categorise = 0;
        const r = await save(h, sent, base, false);
        out[`${mode} ${name}`] = [r.status, r.code, r.appendRpc.length, r.cas, ports.categorise];
        for (const w of h.appended) {
          expect('programSave' in w, 'no program mark on a non-program write').toBe(false);
          expect(w.expectedGraphAnalysisHash, 'the base\'s legacy hash is still computed and carried').toBe(computeAnalysisAffectingGraphHash(base as never));
        }
      }
    }
    expect(out).toEqual({
      'observe renamed': [409, 'revision_conflict', 1, ['v5.graph_cas.evaluated:cosmetic_concurrent_edit/analysis_projection_matched'], 1],
      'observe repriced': [409, 'revision_conflict', 1, ['v5.graph_cas.evaluated:analysis_affecting_conflict/analysis_projection_diverged'], 1],
      'enforce renamed': [409, 'revision_conflict', 1, ['v5.graph_cas.evaluated:cosmetic_concurrent_edit/analysis_projection_matched'], 1],
      'enforce repriced': [409, 'GRAPH_STALE', 0, ['v5.graph_cas.evaluated:analysis_affecting_conflict/analysis_projection_diverged',
        'v5.graph_cas.write_blocked:analysis_affecting_conflict/analysis_projection_diverged'], 1],
    });
  });

  it('(d) core-write says a v6 revision refusal is stale, as it says GRAPH_STALE (its own version looked up first)', async () => {
    harness('observe', P0, figureMoved);
    const w = await coreWrite(P1, P0);
    expect([w.write, w.ownVersionCalls]).toEqual([{ status: 'stale' }, 1]);
  });
});
