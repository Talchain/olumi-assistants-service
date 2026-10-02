/**
 * ⭐ DECIDE & REVIEW S1 (MG lease #85 5948537951; DL conditions): the decision-record READ-BACK.
 *
 * Real tokens against the real `verifySupabaseUserJwt` (as the commit route's spec does), a hand-rolled store port
 * through the route's `deps` seam, and the adapter's own query read through a recording fake client. Bound by identity:
 * exact refusal bytes, exact record ids, the exact filters sent to PostgREST.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgeUserToken,
  makeEs256Key,
  startJwksFixture,
  type JwksFixture,
} from '../../utils/__tests__/helpers/supabase-jwks-fixture.js';

const mockConfig = {
  auth: {
    supabaseJwksUrl: undefined as string | undefined,
    supabaseUrl: undefined as string | undefined,
    requireUserJwt: false,
  },
};
vi.mock('../../config/index.js', () => ({ config: mockConfig }));
vi.mock('../../utils/telemetry.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

const { SupabaseDecisionRecordStore } = await import('../../orchestrator-v5/decision-records/store-adapter.js');
type StorePort = import('../../orchestrator-v5/decision-records/store-adapter.js').DecisionRecordStorePort;
type UserRead = import('../../orchestrator-v5/decision-records/store-adapter.js').DecisionRecordUserRead;
const route = await import('../assist.v1.decision-records.js');
const { resetSupabaseJwksCacheForTests } = await import('../../utils/supabase-user-jwt.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VIEWER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LIST = '/assist/v1/decision-records/list';

let projectKey: Awaited<ReturnType<typeof makeEs256Key>>;
let jwks: JwksFixture;
const userToken = (sub: string = OWNER_ID) => forgeUserToken(projectKey.privateKey, jwks.issuer, {
  sub, aud: 'authenticated', extraClaims: { role: 'authenticated' },
});

const CHOSEN: UserRead = {
  record_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', scenario_id: SCENARIO_ID, created_at: '2026-10-02T08:00:00.000Z',
  review_date: '2026-12-31T00:00:00.000Z', has_outcome: false,
  decision: { chosen_option_id: 'opt_b', chosen_option_label: 'Option B', graph_hash: 'aag_v1:abc', committed_by_user: true, rationale: 'Cheaper to reverse.' },
  prediction: { statement: 'Runway holds above 9 months.', confidence: 0.72, confidence_source: 'user_stated' },
};
const NOT_READY: UserRead = {
  record_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', scenario_id: SCENARIO_ID, created_at: '2026-10-01T08:00:00.000Z',
  review_date: '2026-12-30T00:00:00.000Z', has_outcome: true,
  decision: { position: 'not_ready', graph_hash: 'aag_v1:abd', committed_by_user: true, revisit_trigger: 'When Q4 numbers land.' },
  prediction: null,
};

function makeStore(owner: string | null | undefined | Error, page = { records: [CHOSEN, NOT_READY] as UserRead[], totalCount: 2 }) {
  const readScenarioOwner = vi.fn(async () => { if (owner instanceof Error) throw owner; return owner; });
  const retrieveUserRecords = vi.fn(async () => page);
  const store = { readScenarioOwner, retrieveUserRecords } as unknown as StorePort;
  return { store, readScenarioOwner, retrieveUserRecords };
}
async function buildApp(store: StorePort): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await route.default(app, { store });
  await app.ready();
  return app;
}
async function list(store: StorePort, token: string | null, scenarioId = SCENARIO_ID) {
  const app = await buildApp(store);
  return app.inject({ method: 'POST', url: LIST, payload: { scenario_id: scenarioId }, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
}
/** The refusal bytes with the per-request id (the only per-request byte) replaced by a fixed token. */
const bytes = (payload: string) => payload.replace(/"request_id":"[^"]*"/, '"request_id":"<id>"');

beforeEach(async () => {
  projectKey = await makeEs256Key('kid-1');
  jwks = await startJwksFixture([projectKey.jwk]);
  mockConfig.auth.supabaseJwksUrl = undefined;
  mockConfig.auth.supabaseUrl = jwks.base;
  resetSupabaseJwksCacheForTests();
});
afterEach(async () => { await jwks.close(); });

describe('S1: the owner reads back their own decisions — from any device', () => {
  it('RED on base (no route): the owner gets their records, projected in the commit request\'s own field names', async () => {
    const { store, retrieveUserRecords } = makeStore(OWNER_ID);
    const res = await list(store, await userToken());
    expect(res.statusCode).toBe(200);
    expect(retrieveUserRecords).toHaveBeenCalledWith(SCENARIO_ID, OWNER_ID);
    const body = res.json();
    expect(body.records).toEqual([
      { record_id: CHOSEN.record_id, created_at: CHOSEN.created_at, review_date: CHOSEN.review_date, graph_hash: 'aag_v1:abc', has_outcome: false,
        position: 'chosen', chosen_option_id: 'opt_b', chosen_option_label: 'Option B', confidence_0_100: 72,
        expectation_statement: 'Runway holds above 9 months.', rationale: 'Cheaper to reverse.' },
      { record_id: NOT_READY.record_id, created_at: NOT_READY.created_at, review_date: NOT_READY.review_date, graph_hash: 'aag_v1:abd', has_outcome: true,
        position: 'not_ready', revisit_trigger: 'When Q4 numbers land.' },
    ]);
    expect(body.total_count).toBe(2);
    expect(body.truncated).toBe(false);
  });

  it('a malformed chosen row (no label / confidence out of range) is DROPPED, never shown half-true; a capped page says truncated', async () => {
    const noLabel = { ...CHOSEN, record_id: '11111111-1111-4111-8111-111111111111', decision: { ...CHOSEN.decision, chosen_option_label: '' } };
    const badConf = { ...CHOSEN, record_id: '22222222-2222-4222-8222-222222222222', prediction: { ...CHOSEN.prediction, confidence: 72 } };
    const { store } = makeStore(OWNER_ID, { records: [noLabel, badConf, CHOSEN], totalCount: 11 });
    const body = (await list(store, await userToken())).json();
    expect(body.records.map((r: { record_id: string }) => r.record_id)).toEqual([CHOSEN.record_id]);
    expect(body.truncated).toBe(true);
    expect(body.total_count).toBe(11);
  });

  it('CODEX P2: a projection drop on an UNCAPPED page still says truncated (2 stored, 1 shown)', async () => {
    const noLabel = { ...CHOSEN, record_id: '11111111-1111-4111-8111-111111111111', decision: { ...CHOSEN.decision, chosen_option_label: '' } };
    const { store } = makeStore(OWNER_ID, { records: [noLabel, CHOSEN], totalCount: 2 });
    const body = (await list(store, await userToken())).json();
    expect(body.records).toHaveLength(1);
    expect(body.truncated).toBe(true);
  });

  it('CODEX P2: a chosen row with no expectation (null / blank / missing) is malformed — /commit requires one — and is dropped', async () => {
    const rows = [null, '  ', undefined].map((statement, i) => ({ ...CHOSEN, record_id: `4444444${i}-4444-4444-8444-444444444444`,
      prediction: { confidence: 0.6, confidence_source: 'user_stated', ...(statement === undefined ? {} : { statement }) } })) as UserRead[];
    const { store } = makeStore(OWNER_ID, { records: [...rows, CHOSEN], totalCount: 4 });
    expect((await list(store, await userToken())).json().records.map((r: { record_id: string }) => r.record_id)).toEqual([CHOSEN.record_id]);
  });

  it('CODEX P3: a fractional stated confidence comes back as stated (0.724 → 72.4), not rounded to an integer', async () => {
    const { store } = makeStore(OWNER_ID, { records: [{ ...CHOSEN, prediction: { ...CHOSEN.prediction, confidence: 0.724 } }], totalCount: 1 });
    expect((await list(store, await userToken())).json().records[0].confidence_0_100).toBe(72.4);
  });

  it('CODEX P2: an UPPERCASE scenario id reads the same records (Postgres returns UUIDs lowercase)', async () => {
    const { store, readScenarioOwner, retrieveUserRecords } = makeStore(OWNER_ID);
    const res = await list(store, await userToken(), SCENARIO_ID.toUpperCase());
    expect(res.statusCode).toBe(200);
    expect(readScenarioOwner).toHaveBeenCalledWith(SCENARIO_ID);
    expect(retrieveUserRecords).toHaveBeenCalledWith(SCENARIO_ID, OWNER_ID);
    expect(res.json().records).toHaveLength(2);
  });
});

describe('S1 refusals: no identity, guest, and NO EXISTENCE ORACLE (DL condition)', () => {
  it('401 with no token — and NO store call', async () => {
    const { store, readScenarioOwner } = makeStore(OWNER_ID);
    const res = await list(store, null);
    expect(res.statusCode).toBe(401);
    expect(readScenarioOwner).not.toHaveBeenCalled();
  });

  it('CODEX P2: a FORGED signature, an EXPIRED token and a WRONG audience are all 401 with NO ownership or record read (requireUserJwt is false)', async () => {
    const otherKey = await makeEs256Key('kid-not-published');
    const forged = await forgeUserToken(otherKey.privateKey, jwks.issuer, { sub: OWNER_ID, aud: 'authenticated', extraClaims: { role: 'authenticated' } });
    const expired = await forgeUserToken(projectKey.privateKey, jwks.issuer, { sub: OWNER_ID, aud: 'authenticated', expired: true, extraClaims: { role: 'authenticated' } });
    const wrongAud = await forgeUserToken(projectKey.privateKey, jwks.issuer, { sub: OWNER_ID, aud: null, extraClaims: { role: 'anon' } });
    for (const t of [forged, expired, wrongAud]) {
      const { store, readScenarioOwner, retrieveUserRecords } = makeStore(OWNER_ID);
      const res = await list(store, t);
      expect(res.statusCode).toBe(401);
      expect(readScenarioOwner).not.toHaveBeenCalled();
      expect(retrieveUserRecords).not.toHaveBeenCalled();
    }
  });

  it('a guest scenario answers DR001 (distinct, as on /commit) and reads no records', async () => {
    const { store, retrieveUserRecords } = makeStore(null);
    const res = await list(store, await userToken());
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('DR001');
    expect(retrieveUserRecords).not.toHaveBeenCalled();
  });

  it('ABSENT, someone ELSE\'s, a VIEWER MEMBER\'s and an ownership-lookup FAILURE all answer the SAME status and bytes, and read nothing', async () => {
    const absent = makeStore(undefined);
    const others = makeStore(OWNER_ID); // the caller below is not the owner
    const viewer = makeStore(OWNER_ID); // a scenario_members viewer is not the owner (sharing grants no decision read)
    const down = makeStore(new Error('owner lookup failed'));
    const resAbsent = await list(absent.store, await userToken(VIEWER_ID));
    const resOthers = await list(others.store, await userToken(VIEWER_ID));
    const resViewer = await list(viewer.store, await userToken(VIEWER_ID));
    const resDown = await list(down.store, await userToken(OWNER_ID));
    expect(resAbsent.statusCode).toBe(404);
    for (const r of [resOthers, resViewer, resDown]) {
      expect(r.statusCode).toBe(resAbsent.statusCode);
      expect(bytes(r.payload)).toBe(bytes(resAbsent.payload));
    }
    expect(bytes(resAbsent.payload)).toBe('{"error":"scenario_not_found","code":"scenario_not_found","message":"No such scenario.","request_id":"<id>"}');
    for (const s of [absent, others, viewer, down]) expect(s.retrieveUserRecords).not.toHaveBeenCalled();
  });
});

describe('S1 adapter: only the user\'s OWN commits, filtered IN the query', () => {
  type Row = Record<string, unknown> & { owner_user_id: string; scenario_id: string; created_at: string; decision: Record<string, unknown> };
  /** A fake PostgREST that HONOURS the filters, the order, the limit and the exact-count option it is sent. */
  function fakeClient(rows: Row[], ignore: string[] = []) {
    const calls: [string, ...unknown[]][] = [];
    const filters: [string, unknown][] = [];
    let cols: string[] = []; let opts: { count?: string } | undefined; let order: { col: string; asc: boolean } | undefined;
    const chain = {
      select: (c: string, o?: { count?: string }) => { calls.push(['select', c, o]); cols = c.split(',').map((x) => x.trim()); opts = o; return chain; },
      eq: (c: string, v: unknown) => { calls.push(['eq', c, v]); filters.push([c, v]); return chain; },
      order: (c: string, o: { ascending: boolean }) => { calls.push(['order', c, o]); order = { col: c, asc: o.ascending }; return chain; },
      limit: (n: number) => {
        calls.push(['limit', n]);
        let hit = rows.filter((r) => filters.filter(([c]) => !ignore.includes(c)).every(([c, v]) => (c === 'decision->>committed_by_user' ? String(r.decision.committed_by_user) === v : r[c] === v)));
        if (order) hit = [...hit].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
        const data = hit.slice(0, n).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
        return Promise.resolve({ data, error: null, count: opts?.count === 'exact' ? hit.length : null });
      },
    };
    return { client: { from: (t: string) => { calls.push(['from', t]); return chain; } }, calls };
  }
  const row = (id: string, at: string, over: Partial<Row> = {}): Row => ({ record_id: id, scenario_id: SCENARIO_ID, owner_user_id: OWNER_ID, created_at: at,
    review_date: '2026-12-31T00:00:00.000Z', outcome: null, decision: { ...CHOSEN.decision }, prediction: { ...CHOSEN.prediction }, ...over });

  it('sends scenario + OWNER + authorship filters, exact count, newest-first, limit 8; never selects owner_user_id; a model_derived row is excluded', async () => {
    const modelDerived = row('33333333-3333-4333-8333-333333333333', '2026-10-02T09:00:00.000Z', { decision: { chosen_option_id: 'opt_a', chosen_option_label: 'A' } });
    const { client, calls } = fakeClient([modelDerived, row(CHOSEN.record_id, '2026-10-02T08:00:00.000Z', { outcome: { result: 'happened' } })]);
    const page = await new SupabaseDecisionRecordStore(client as never).retrieveUserRecords(SCENARIO_ID, OWNER_ID);
    expect(calls).toContainEqual(['eq', 'scenario_id', SCENARIO_ID]);
    expect(calls).toContainEqual(['eq', 'owner_user_id', OWNER_ID]);
    expect(calls).toContainEqual(['eq', 'decision->>committed_by_user', 'true']);
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(calls).toContainEqual(['limit', 8]);
    const sel = calls.find((c) => c[0] === 'select')!;
    expect(sel[2]).toEqual({ count: 'exact' });
    expect(String(sel[1])).toContain('review_date');
    expect(String(sel[1])).not.toContain('owner_user_id');
    expect(page.records.map((r) => r.record_id)).toEqual([CHOSEN.record_id]);
    expect(page.records[0]!.has_outcome).toBe(true);
  });

  it('DEFENCE IN DEPTH: if a future query change ever lets a model_derived row through, the per-row check still drops it', async () => {
    const modelDerived = row('33333333-3333-4333-8333-333333333333', '2026-10-02T09:00:00.000Z', { decision: { chosen_option_id: 'opt_a', chosen_option_label: 'A' } });
    const { client } = fakeClient([modelDerived, row(CHOSEN.record_id, '2026-10-02T08:00:00.000Z')], ['decision->>committed_by_user']);
    const page = await new SupabaseDecisionRecordStore(client as never).retrieveUserRecords(SCENARIO_ID, OWNER_ID);
    expect(page.records.map((r) => r.record_id)).toEqual([CHOSEN.record_id]);
  });

  it('CODEX P1: a scenario UUID RE-CREATED by someone else never reads the previous owner\'s records', async () => {
    const formerOwners = row(CHOSEN.record_id, '2026-10-01T08:00:00.000Z', { owner_user_id: VIEWER_ID });
    const { client } = fakeClient([formerOwners]);
    const page = await new SupabaseDecisionRecordStore(client as never).retrieveUserRecords(SCENARIO_ID, OWNER_ID);
    expect(page).toEqual({ records: [], totalCount: 0 });
  });

  it('CODEX P2: the 8/9 boundary — nine stored, eight returned newest-first, the true total is nine (and the route says truncated)', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => row(`5555555${i}-5555-4555-8555-555555555555`, `2026-10-0${i + 1}T08:00:00.000Z`));
    const { client } = fakeClient(nine);
    const store = new SupabaseDecisionRecordStore(client as never);
    const page = await store.retrieveUserRecords(SCENARIO_ID, OWNER_ID);
    expect(page.totalCount).toBe(9);
    expect(page.records.map((r) => r.record_id)).toEqual(nine.slice(1).reverse().map((r) => r.record_id));
    (store as unknown as { readScenarioOwner: () => Promise<string> }).readScenarioOwner = async () => OWNER_ID;
    const body = (await list(store as never, await userToken())).json();
    expect(body.records).toHaveLength(8);
    expect(body.truncated).toBe(true);
  });
});
