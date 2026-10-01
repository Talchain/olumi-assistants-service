/**
 * ACCOUNTS B3 — the guest → account COPY route.
 *
 * The JWT half runs REAL tokens through the REAL `verifySupabaseUserJwt` (ES256 against an in-process JWKS), as the
 * decision-records suite does, so the `aud` and `exp` guards are what refuse. The store is a hand-rolled port fake
 * (route rows) or a fake Supabase client whose `rpc` returns what PostgREST returns (adapter rows).
 *
 * Every assertion binds by IDENTITY: the exact (source, user) pair sent to the RPC, the exact refusal code and body.
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

// CEE_REQUIRE_USER_JWT is FALSE throughout: every 401 below proves the check is always-on.
const mockConfig = { auth: { supabaseJwksUrl: undefined as string | undefined, supabaseUrl: undefined as string | undefined, requireUserJwt: false } };
vi.mock('../../config/index.js', () => ({ config: mockConfig }));
vi.mock('../../utils/telemetry.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

const copyRoute = (await import('../assist.v1.scenario-copy.js')).default;
const { SupabaseGuestCopyStore, GuestCopyStoreError } = await import('../../orchestrator-v5/guest-copy/index.js');
type Port = import('../../orchestrator-v5/guest-copy/index.js').GuestCopyStorePort;
type Outcome = import('../../orchestrator-v5/guest-copy/index.js').GuestCopyOutcome;
const { resetSupabaseJwksCacheForTests } = await import('../../utils/supabase-user-jwt.js');

const GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COPY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SOMEONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const url = (id: string) => `/assist/v1/scenarios/${id}/copy`;

let projectKey: Awaited<ReturnType<typeof makeEs256Key>>;
let jwks: JwksFixture;
const userToken = (sub: string = ME, opts?: { expired?: boolean }) =>
  forgeUserToken(projectKey.privateKey, jwks.issuer, { sub, expired: opts?.expired, aud: 'authenticated', extraClaims: { role: 'authenticated' } });
const anonKeyShapedToken = () => forgeUserToken(projectKey.privateKey, jwks.issuer, { sub: null, aud: null, extraClaims: { role: 'anon' } });

function portReturning(outcome: Outcome | Error) {
  const copyGuestScenario = vi.fn(async (_source: string, _user: string): Promise<Outcome> => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  return { store: { copyGuestScenario } as Port, copyGuestScenario };
}
async function buildApp(store: Port): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await copyRoute(app, { store });
  await app.ready();
  return app;
}

beforeEach(async () => {
  projectKey = await makeEs256Key('kid-1');
  jwks = await startJwksFixture([projectKey.jwk]);
  mockConfig.auth.supabaseJwksUrl = undefined;
  mockConfig.auth.supabaseUrl = jwks.base;
  resetSupabaseJwksCacheForTests();
});
afterEach(async () => { await jwks.close(); });

describe('the owner is the VERIFIED token sub, and only that', () => {
  it('a signed-in copy sends (route id, token sub) and answers 200 with the copy', async () => {
    const { store, copyGuestScenario } = portReturning({ kind: 'copied', scenarioId: COPY, created: true });
    const app = await buildApp(store);
    const res = await app.inject({ method: 'POST', url: url(GUEST), headers: { authorization: `Bearer ${await userToken()}` }, payload: { user_id: SOMEONE } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ scenario_id: COPY, created: true });
    // A body naming another user is ignored: the pair is (route id, sub).
    expect(copyGuestScenario.mock.calls).toEqual([[GUEST, ME]]);
  });
  it('a replay answers the same copy with created=false', async () => {
    const { store } = portReturning({ kind: 'copied', scenarioId: COPY, created: false });
    const app = await buildApp(store);
    const res = await app.inject({ method: 'POST', url: url(GUEST), headers: { authorization: `Bearer ${await userToken()}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ scenario_id: COPY, created: false });
  });
});

describe('anonymous and unverifiable callers are refused before any store call', () => {
  const cases: Array<[string, () => Promise<Record<string, string>>, string]> = [
    ['no Authorization header (anon)', async () => ({}), 'sign_in_required'],
    ['an anon-key-shaped token (genuine signature, no authenticated audience)', async () => ({ authorization: `Bearer ${await anonKeyShapedToken()}` }), ''],
    ['an expired user token', async () => ({ authorization: `Bearer ${await userToken(ME, { expired: true })}` }), 'expired_token'],
    ['garbage', async () => ({ authorization: 'Bearer not-a-jwt' }), ''],
  ]
  for (const [name, headers, code] of cases) {
    it(`${name} → 401, store never called`, async () => {
      const { store, copyGuestScenario } = portReturning({ kind: 'copied', scenarioId: COPY, created: true });
      const app = await buildApp(store);
      const res = await app.inject({ method: 'POST', url: url(GUEST), headers: await headers() });
      expect(res.statusCode).toBe(401);
      if (code !== '') expect(res.json().code).toBe(code);
      expect(copyGuestScenario).not.toHaveBeenCalled();
    });
  }
});

describe('refusals', () => {
  it('absent/owned, no model, too large and a malformed id all answer the SAME 404 bytes (no existence or ownership oracle)', async () => {
    const bodies: string[] = [];
    const cases = [
      [GUEST, { kind: 'refused', reason: 'not_copyable' }],
      [GUEST, { kind: 'refused', reason: 'no_model' }],
      [GUEST, { kind: 'refused', reason: 'too_large' }],
      ['not-a-uuid', { kind: 'copied', scenarioId: COPY, created: true }],
    ] as const;
    for (const [id, outcome] of cases) {
      const { store, copyGuestScenario } = portReturning(outcome as Outcome);
      const app = await buildApp(store);
      const res = await app.inject({ method: 'POST', url: url(id), headers: { authorization: `Bearer ${await userToken()}` } });
      expect(res.statusCode).toBe(404);
      const { request_id: _r, ...rest } = res.json();
      bodies.push(JSON.stringify(rest));
      if (id === 'not-a-uuid') expect(copyGuestScenario).not.toHaveBeenCalled();
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies).toHaveLength(4);
    expect(JSON.parse(bodies[0]).code).toBe('scenario_not_copyable');
  });
  const rows: Array<[Outcome, number, string]> = [
    [{ kind: 'refused', reason: 'unknown_user' }, 401, 'sign_in_required'],
  ];
  for (const [outcome, status, code] of rows) {
    it(`${(outcome as { reason: string }).reason} → ${status} ${code}`, async () => {
      const { store } = portReturning(outcome);
      const app = await buildApp(store);
      const res = await app.inject({ method: 'POST', url: url(GUEST), headers: { authorization: `Bearer ${await userToken()}` } });
      expect(res.statusCode).toBe(status);
      expect(res.json().code).toBe(code);
    });
  }
  it('a store failure is 503 copy_unavailable, never a refusal', async () => {
    const { store } = portReturning(new GuestCopyStoreError('copy_guest_scenario failed: 57014'));
    const app = await buildApp(store);
    const res = await app.inject({ method: 'POST', url: url(GUEST), headers: { authorization: `Bearer ${await userToken()}` } });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('copy_unavailable');
  });
});

describe('the adapter: exactly one RPC, and the SQL function\'s SQLSTATEs map to outcomes', () => {
  const client = (result: { data: unknown; error: { code?: string; message: string } | null }) => {
    const rpc = vi.fn(async () => result);
    return { rpc, store: new SupabaseGuestCopyStore({ rpc } as never) };
  };
  it('sends exactly { p_source_scenario_id, p_user_id } to copy_guest_scenario', async () => {
    const { rpc, store } = client({ data: { scenario_id: COPY, created: true }, error: null });
    expect(await store.copyGuestScenario(GUEST, ME)).toEqual({ kind: 'copied', scenarioId: COPY, created: true });
    expect(rpc.mock.calls).toEqual([['copy_guest_scenario', { p_source_scenario_id: GUEST, p_user_id: ME }]]);
  });
  const map: Array<[string, string]> = [['CG404', 'not_copyable'], ['CG409', 'not_copyable'], ['CG422', 'no_model'], ['CG413', 'too_large'], ['22023', 'unknown_user']];
  for (const [code, reason] of map) {
    it(`${code} → refused ${reason}`, async () => {
      const { store } = client({ data: null, error: { code, message: 'x' } });
      expect(await store.copyGuestScenario(GUEST, ME)).toEqual({ kind: 'refused', reason });
    });
  }
  it('any other error, or an unexpected shape, throws (the route answers 503)', async () => {
    await expect(client({ data: null, error: { code: '57014', message: 'timeout' } }).store.copyGuestScenario(GUEST, ME)).rejects.toBeInstanceOf(GuestCopyStoreError);
    await expect(client({ data: { scenario_id: 'nope', created: true }, error: null }).store.copyGuestScenario(GUEST, ME)).rejects.toBeInstanceOf(GuestCopyStoreError);
    await expect(client({ data: { scenario_id: COPY }, error: null }).store.copyGuestScenario(GUEST, ME)).rejects.toBeInstanceOf(GuestCopyStoreError);
  });
});
