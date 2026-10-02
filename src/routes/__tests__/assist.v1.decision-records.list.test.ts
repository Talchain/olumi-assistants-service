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
    expect(retrieveUserRecords).toHaveBeenCalledWith(SCENARIO_ID);
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
});

describe('S1 refusals: no identity, guest, and NO EXISTENCE ORACLE (DL condition)', () => {
  it('401 with no token — and NO store call', async () => {
    const { store, readScenarioOwner } = makeStore(OWNER_ID);
    const res = await list(store, null);
    expect(res.statusCode).toBe(401);
    expect(readScenarioOwner).not.toHaveBeenCalled();
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
  function fakeClient(rows: unknown[], count: number) {
    const calls: [string, ...unknown[]][] = [];
    const chain = {
      select: (...a: unknown[]) => { calls.push(['select', ...a]); return chain; },
      eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return chain; },
      order: (...a: unknown[]) => { calls.push(['order', ...a]); return chain; },
      limit: (...a: unknown[]) => { calls.push(['limit', ...a]); return Promise.resolve({ data: rows, error: null, count }); },
    };
    return { client: { from: (t: string) => { calls.push(['from', t]); return chain; } }, calls };
  }

  it('sends the scenario AND authorship filters to PostgREST, and a model_derived row that slips through is still dropped', async () => {
    const modelDerived = { ...CHOSEN, record_id: '33333333-3333-4333-8333-333333333333', decision: { chosen_option_id: 'opt_a', chosen_option_label: 'A', graph_hash: 'aag_v1:x' },
      prediction: { confidence: 0.5, confidence_source: 'model_derived' }, review_date: '2026-12-01T00:00:00.000Z', outcome: null };
    const userRow = { ...CHOSEN, outcome: { result: 'happened' } };
    const { client, calls } = fakeClient([modelDerived, userRow], 2);
    const store = new SupabaseDecisionRecordStore(client as never);
    const page = await store.retrieveUserRecords(SCENARIO_ID);
    expect(calls).toContainEqual(['from', 'decision_records']);
    expect(calls).toContainEqual(['eq', 'scenario_id', SCENARIO_ID]);
    expect(calls).toContainEqual(['eq', 'decision->>committed_by_user', 'true']);
    expect(String(calls.find((c) => c[0] === 'select')?.[1])).toContain('review_date');
    expect(String(calls.find((c) => c[0] === 'select')?.[1])).not.toContain('owner_user_id');
    expect(page.records.map((r) => r.record_id)).toEqual([CHOSEN.record_id]);
    expect(page.records[0]!.has_outcome).toBe(true);
  });
});
