/**
 * Calibration R0 — the recording-seam ROUTES.
 *
 * The JWT half is verified with REAL tokens against the REAL
 * `verifySupabaseUserJwt` util (jose, ES256 against an in-process JWKS) — not
 * a mocked verifier. A mocked verifier would prove the route calls something;
 * only a real token can prove the `aud` guard, the `exp` guard and the
 * UUID-`sub` guard are the things doing the work.
 *
 * The store is a hand-rolled port fake injected through the route's `deps`
 * seam — no Supabase client, no network.
 *
 * Every assertion binds by IDENTITY: exact record ids, exact refusal codes,
 * exact payload keys sent to the RPC (trap 19).
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

// CEE_REQUIRE_USER_JWT is DELIBERATELY FALSE throughout this file. Every 401
// and 403 below therefore proves the endpoint's verification is ALWAYS-ON and
// independent of that flag — which is the whole point of T4.
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

const { deriveDecisionRecordId, AAG_V1_GRAPH_HASH_PREFIX } = await import(
  '../../orchestrator-v5/decision-records/capture.js'
);
const {
  DecisionRecordNotFoundError,
  DecisionRecordOutcomeConflictError,
} = await import('../../orchestrator-v5/decision-records/store-adapter.js');
type StorePort =
  import('../../orchestrator-v5/decision-records/store-adapter.js').DecisionRecordStorePort;
// The mocks are typed by the PORT's own signatures, so `mock.calls[0][0]` is
// the real write payload and every assertion below reads a typed field rather
// than a cast (a cast can silently drift from the shape actually sent).
type CreateWrite =
  import('../../orchestrator-v5/decision-records/store-adapter.js').CreateDecisionRecordWrite;
type OutcomeWrite =
  import('../../orchestrator-v5/decision-records/store-adapter.js').RecordDecisionOutcomeWrite;

const decisionRecordsRoute = (await import('../assist.v1.decision-records.js')).default;
const { resetSupabaseJwksCacheForTests } = await import(
  '../../utils/supabase-user-jwt.js'
);

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RECORD_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const HASH_AT_RUN = 'abcdef0123456789';
const COMPUTED_AT = '2026-07-10T12:00:00.000Z';
const GRAPH_HASH = `${AAG_V1_GRAPH_HASH_PREFIX}${HASH_AT_RUN}`;
const NOW = new Date('2026-08-06T09:00:00.000Z');

/** The project's signing key and the JWKS endpoint publishing it. */
let projectKey: Awaited<ReturnType<typeof makeEs256Key>>;
let jwks: JwksFixture;

/** A genuine Supabase-shaped user access token. */
async function userToken(
  sub: string = OWNER_ID,
  opts?: { expired?: boolean; audience?: string | null },
): Promise<string> {
  return forgeUserToken(projectKey.privateKey, jwks.issuer, {
    sub,
    expired: opts?.expired,
    aud: opts?.audience === null ? null : (opts?.audience ?? 'authenticated'),
    extraClaims: { role: 'authenticated' },
  });
}

/**
 * POSITIVE CONTROL for the `aud` guard: a token signed by the project's OWN
 * key — so the signature is genuine — but carrying no `authenticated`
 * audience and no `sub`, the shape of a project API key rather than a user
 * session. If this ever verifies, the guard is not doing the work.
 */
async function anonApiKeyShapedToken(): Promise<string> {
  return forgeUserToken(projectKey.privateKey, jwks.issuer, {
    sub: null,
    aud: null,
    extraClaims: { role: 'anon' },
  });
}

interface FakeStoreState {
  scenarioOwner: string | null | undefined;
  anchor: { graphHashAtRun: string; computedAt: string | null } | null;
  record: {
    record_id: string;
    owner_user_id: string | null;
    confidence: number | undefined;
    hasOutcome: boolean;
  } | null;
  createResult: { record_id: string; deduped: boolean; event_id: string | null };
  /**
   * The `record.decision` the fake RPC echoes back. `'echo'` (default) models
   * the real function on a fresh insert — the row holds exactly the payload
   * sent. An object models a REPLAY returning an earlier row; `undefined`
   * models an envelope with no decision.
   */
  storedDecision: 'echo' | Record<string, unknown> | undefined;
  outcomeResult: { record_id: string; deduped: boolean; event_id: string | null };
  outcomeError: Error | null;
}

function makeStore(overrides?: Partial<FakeStoreState>) {
  const state: FakeStoreState = {
    scenarioOwner: OWNER_ID,
    anchor: { graphHashAtRun: HASH_AT_RUN, computedAt: COMPUTED_AT },
    record: {
      record_id: RECORD_ID,
      owner_user_id: OWNER_ID,
      confidence: 0.72,
      hasOutcome: false,
    },
    createResult: { record_id: 'new-record', deduped: false, event_id: 'evt' },
    storedDecision: 'echo',
    outcomeResult: { record_id: RECORD_ID, deduped: false, event_id: 'evt-outcome' },
    outcomeError: null,
    ...overrides,
  };

  const createRecord = vi.fn(async (write: CreateWrite) => {
    const stored =
      state.storedDecision === 'echo'
        ? { ...write.decision }
        : state.storedDecision;
    return {
      ...state.createResult,
      record_id: state.createResult.record_id === 'new-record'
        ? write.record_id
        : state.createResult.record_id,
      ...(stored !== undefined ? { stored_decision: stored } : {}),
    };
  });
  const recordOutcome = vi.fn(async (_write: OutcomeWrite) => {
    if (state.outcomeError !== null) throw state.outcomeError;
    return state.outcomeResult;
  });
  const readScenarioOwner = vi.fn(async () => state.scenarioOwner);
  const readRecordForOutcome = vi.fn(async () => state.record);
  const readNewestAnalysisAnchor = vi.fn(async () => state.anchor);
  const retrieveRecords = vi.fn(async () => ({ records: [], totalCount: 0 }));

  const store = {
    createRecord,
    recordOutcome,
    readScenarioOwner,
    readRecordForOutcome,
    readNewestAnalysisAnchor,
    retrieveRecords,
  } as unknown as StorePort;

  return { store, state, createRecord, recordOutcome, readScenarioOwner, readRecordForOutcome, readNewestAnalysisAnchor };
}

async function buildApp(store: StorePort): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await decisionRecordsRoute(app, { store, now: () => NOW });
  await app.ready();
  return app;
}

const COMMIT_BODY = {
  scenario_id: SCENARIO_ID,
  chosen_option_id: 'opt_b',
  chosen_option_label: 'Option B',
  confidence_0_100: 72,
  expectation_statement: 'Runway holds above 9 months through Q1.',
  client_commit_id: 'commit-nonce-1',
};

let token: string;

beforeEach(async () => {
  projectKey = await makeEs256Key('kid-1');
  jwks = await startJwksFixture([projectKey.jwk]);
  mockConfig.auth.supabaseJwksUrl = undefined;
  mockConfig.auth.supabaseUrl = jwks.base;
  resetSupabaseJwksCacheForTests();
  token = await userToken();
});

afterEach(async () => {
  await jwks.close();
});

// ---------------------------------------------------------------------------
// T1 — the commit does not dedupe into the auto-captured record.
// ---------------------------------------------------------------------------

describe('T1 — a commit for an already-auto-captured graph writes a SECOND, distinct record', () => {
  it('sends a record_id that is NOT the auto-capture id, with user_stated + committed_by_user', async () => {
    const { store, createRecord } = makeStore();
    const app = await buildApp(store);

    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      payload: COMMIT_BODY,
    });

    expect(res.statusCode).toBe(201);
    expect(createRecord).toHaveBeenCalledTimes(1);
    const write = createRecord.mock.calls[0]![0];

    // IDENTITY: the auto-capture id for THIS analysed graph, named exactly.
    const autoId = deriveDecisionRecordId(SCENARIO_ID, GRAPH_HASH, COMPUTED_AT);
    expect(write.record_id).not.toBe(autoId);

    expect(write.prediction!.confidence_source).toBe('user_stated');
    expect(write.decision.committed_by_user).toBe(true);
    expect(write.decision.graph_hash).toBe(GRAPH_HASH);

    const body = res.json();
    expect(body.deduped).toBe(false);
    expect(body.confidence_source).toBe('user_stated');
    expect(body.committed_by_user).toBe(true);
    await app.close();
  });

  it('derives the graph_hash SERVER-side from CEE\'s own analysis fact, ignoring any client-sent hash', async () => {
    const { store, createRecord } = makeStore();
    const app = await buildApp(store);

    await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      // A client trying to set the anchor. The UI's `results.hash` is PLoT's
      // response_hash — a different regime the record must never carry.
      payload: { ...COMMIT_BODY, graph_hash: 'response_hash:forged', decision: { graph_hash: 'x' } },
    });

    const write = createRecord.mock.calls[0]![0];
    expect(write.decision.graph_hash).toBe(GRAPH_HASH);
    expect(write.decision.graph_hash).not.toContain('forged');
    await app.close();
  });

  it('refuses when the scenario has no analysed graph, rather than anchoring to nothing', async () => {
    const { store, createRecord } = makeStore({ anchor: null });
    const app = await buildApp(store);

    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      payload: COMMIT_BODY,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('no_analysed_graph');
    expect(createRecord).not.toHaveBeenCalled();
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// T4 — the JWT is ALWAYS-ON and independent of CEE_REQUIRE_USER_JWT.
// ---------------------------------------------------------------------------

describe('T4 — user-JWT verification is always-on (config.requireUserJwt is FALSE in this file)', () => {
  it('401s with no Authorization header, and makes NO store call', async () => {
    const { store, createRecord, readScenarioOwner } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      payload: COMMIT_BODY,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('sign_in_required');
    expect(readScenarioOwner).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it('401 expired_token on an expired token', async () => {
    const { store } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${await userToken(OWNER_ID, { expired: true })}` },
      payload: COMMIT_BODY,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('expired_token');
    await app.close();
  });

  it('POSITIVE CONTROL — an anon-API-key-shaped JWT on the SAME secret is refused (the aud guard is doing the work)', async () => {
    const { store, createRecord } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${await anonApiKeyShapedToken()}` },
      payload: COMMIT_BODY,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_token');
    expect(createRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it('401 invalid_token when aud is present but not "authenticated"', async () => {
    const { store } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${await userToken(OWNER_ID, { audience: 'somebody-else' })}` },
      payload: COMMIT_BODY,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_token');
    await app.close();
  });

  it('401 invalid_token on garbage', async () => {
    const { store } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: 'Bearer not-a-jwt' },
      payload: COMMIT_BODY,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('the outcome endpoint enforces the same always-on verification', async () => {
    const { store, recordOutcome } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      payload: { result: 'worse' },
    });
    expect(res.statusCode).toBe(401);
    expect(recordOutcome).not.toHaveBeenCalled();
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// T10 — guest and cross-user isolation, refused BEFORE any RPC.
// ---------------------------------------------------------------------------

describe('T10 — guest and cross-user isolation', () => {
  it('a guest scenario is a DR001-class refusal, never a defaulted owner', async () => {
    const { store, createRecord } = makeStore({ scenarioOwner: null });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      payload: COMMIT_BODY,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('DR001');
    expect(createRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it('another user\'s scenario is 403 with NO write', async () => {
    const { store, createRecord } = makeStore({ scenarioOwner: OTHER_USER_ID });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      payload: COMMIT_BODY,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('not_scenario_owner');
    expect(createRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it('a missing scenario is 404, distinct from the guest refusal', async () => {
    const { store, createRecord } = makeStore({ scenarioOwner: undefined });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      payload: COMMIT_BODY,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('scenario_not_found');
    expect(createRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it('another user\'s RECORD cannot be outcome-written, and the RPC is never reached', async () => {
    const { store, recordOutcome } = makeStore({
      record: { record_id: RECORD_ID, owner_user_id: OTHER_USER_ID, confidence: 0.72, hasOutcome: false },
    });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'worse' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('not_record_owner');
    expect(recordOutcome).not.toHaveBeenCalled();
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// T7 — normalisation is server-side; out-of-range is refused with NO RPC.
// ---------------------------------------------------------------------------

describe('T7 — confidence_0_100 → [0,1] happens SERVER-side', () => {
  it.each([
    [70, 0.7],
    [100, 1],
    [0, 0],
  ])('sends %s as %s on the RPC payload', async (input, expected) => {
    const { store, createRecord } = makeStore();
    const app = await buildApp(store);
    await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...COMMIT_BODY, confidence_0_100: input },
    });
    const write = createRecord.mock.calls[0]![0];
    expect(write.prediction!.confidence!).toBeCloseTo(expected, 12);
    await app.close();
  });

  it.each([101, -1, 'abc', '', null])(
    'refuses %p with a typed 400 and NO RPC call',
    async (input) => {
      const { store, createRecord } = makeStore();
      const app = await buildApp(store);
      const res = await app.inject({
        method: 'POST',
        url: '/assist/v1/decision-records/commit',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...COMMIT_BODY, confidence_0_100: input },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid_confidence');
      expect(createRecord).not.toHaveBeenCalled();
      await app.close();
    },
  );
});

// ---------------------------------------------------------------------------
// T9 — the review-date rung rides the response.
// ---------------------------------------------------------------------------

describe('T9 — the response discloses which review-date rung was used', () => {
  it('a user-supplied ISO date is used verbatim and labelled user_set', async () => {
    const { store, createRecord } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...COMMIT_BODY, revisit_trigger_or_date: '2026-12-01' },
    });
    expect(res.json().review_date_source).toBe('user_set');
    const write = createRecord.mock.calls[0]![0];
    expect(write.review_date).toBe(new Date('2026-12-01').toISOString());
    await app.close();
  });

  it('an unparseable trigger says so — it does NOT read as "no input given"', async () => {
    const { store } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/decision-records/commit',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...COMMIT_BODY, revisit_trigger_or_date: 'runway falls below 9 months' },
    });
    expect(res.json().review_date_source).toBe('default_horizon_after_unparsed_trigger');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// T2/T3 — the outcome path and the first brier_component ever written.
// ---------------------------------------------------------------------------

describe('T2/T3 — outcome writes the brier component, or honestly none', () => {
  it('confidence 0.72 + worse → brier_component 0.5184 ON THE RPC PAYLOAD', async () => {
    const { store, recordOutcome } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'worse', notes: 'Two customers churned.' },
    });
    expect(res.statusCode).toBe(200);
    const write = recordOutcome.mock.calls[0]![0];
    expect(write.record_id).toBe(RECORD_ID);
    expect(write.outcome.result).toBe('worse');
    expect(write.outcome.brier_component!).toBeCloseTo(0.5184, 12);
    expect(write.outcome.notes).toBe('Two customers churned.');
    expect(write.outcome.recorded_at).toBe(NOW.toISOString());
    expect(write.event_id).toBe(`decision_outcome_recorded_${RECORD_ID}`);
    // The RPC's whitelist is CLOSED at four keys — an extra key 22023s the
    // whole outcome, so the key-set is pinned exactly.
    expect(Object.keys(write.outcome).sort()).toEqual(
      ['brier_component', 'notes', 'recorded_at', 'result'].sort(),
    );
    expect(res.json().scored).toBe(true);
    await app.close();
  });

  it('as_expected → 0.0784 (the other direction, a different assertion)', async () => {
    const { store, recordOutcome } = makeStore();
    const app = await buildApp(store);
    await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'as_expected' },
    });
    const write = recordOutcome.mock.calls[0]![0];
    expect(write.outcome.brier_component!).toBeCloseTo(0.0784, 12);
    await app.close();
  });

  it('abandoned → NO brier_component key at all on the payload (not 0, not null)', async () => {
    const { store, recordOutcome } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'abandoned' },
    });
    const write = recordOutcome.mock.calls[0]![0];
    expect(write.outcome).not.toHaveProperty('brier_component');
    expect(Object.keys(write.outcome).sort()).toEqual(['recorded_at', 'result']);
    expect(res.json().scored).toBe(false);
    expect(res.json()).not.toHaveProperty('brier_component');
    await app.close();
  });

  it('T3 — a record with NO confidence still records an outcome, stored UNSCORED', async () => {
    const { store, recordOutcome } = makeStore({
      record: { record_id: RECORD_ID, owner_user_id: OWNER_ID, confidence: undefined, hasOutcome: false },
    });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'worse' },
    });
    expect(res.statusCode).toBe(200);
    const write = recordOutcome.mock.calls[0]![0];
    expect(write.outcome).not.toHaveProperty('brier_component');
    expect(res.json().scored).toBe(false);
    await app.close();
  });

  it('refuses a result outside the contract vocabulary, with no RPC call', async () => {
    const { store, recordOutcome } = makeStore();
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'succeeded' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_result');
    expect(recordOutcome).not.toHaveBeenCalled();
    await app.close();
  });

  it('omits an empty note rather than sending one the RPC would 22023', async () => {
    const { store, recordOutcome } = makeStore();
    const app = await buildApp(store);
    await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'worse', notes: '   ' },
    });
    const write = recordOutcome.mock.calls[0]![0];
    expect(write.outcome).not.toHaveProperty('notes');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// T5 — write-once surfaces as 409; identical retry is a success.
// ---------------------------------------------------------------------------

describe('T5 — the outcome is write-once', () => {
  it('a CONFLICTING second outcome is 409 {code:"DR409"}', async () => {
    const { store } = makeStore({
      outcomeError: new DecisionRecordOutcomeConflictError('already has an outcome'),
    });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'better' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('DR409');
    await app.close();
  });

  it('an IDENTICAL retry is a 200 carrying deduped:true (the RPC replays)', async () => {
    const { store } = makeStore({
      outcomeResult: { record_id: RECORD_ID, deduped: true, event_id: null },
    });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'worse' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deduped).toBe(true);
    await app.close();
  });

  it('a DR404 from the RPC surfaces as 404 {code:"DR404"}', async () => {
    const { store } = makeStore({
      outcomeError: new DecisionRecordNotFoundError('record not found'),
    });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'worse' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('DR404');
    await app.close();
  });

  it('an absent record is 404 before any RPC', async () => {
    const { store, recordOutcome } = makeStore({ record: null });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'worse' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('DR404');
    expect(recordOutcome).not.toHaveBeenCalled();
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// T8 — the scoring source is the TABLE, never the event journal.
// ---------------------------------------------------------------------------

describe('T8 — a record outlives its scenario and is still scoreable', () => {
  it('records an outcome with its brier component when the scenario is GONE (event_id null)', async () => {
    // `record_decision_outcome` deliberately SKIPS the journey event when the
    // scenario has been deleted (…decision_records.sql:753-757) and returns
    // event_id null. The record — and its score — must survive that.
    const { store, recordOutcome, readScenarioOwner } = makeStore({
      outcomeResult: { record_id: RECORD_ID, deduped: false, event_id: null },
    });
    const app = await buildApp(store);
    const res = await app.inject({
      method: 'POST',
      url: `/assist/v1/decision-records/${RECORD_ID}/outcome`,
      headers: { authorization: `Bearer ${token}` },
      payload: { result: 'worse' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().event_id).toBeNull();
    expect(res.json().scored).toBe(true);
    const write = recordOutcome.mock.calls[0]![0];
    expect(write.outcome.brier_component!).toBeCloseTo(0.5184, 12);

    // AND the outcome path never consults the scenario at all — a scoring
    // path routed through `scenarios`/its event journal would have lost this
    // record entirely.
    expect(readScenarioOwner).not.toHaveBeenCalled();
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 0.57.0 — "not ready to choose" + durable reasoning text
// (schemas 0.57.0 DecisionRecordNotReadyPositionSchema; migration
// 20260924120000). Every assertion reads the EXACT payload handed to the RPC.
// ---------------------------------------------------------------------------

const { deriveCommittedDecisionRecordId, DECISION_RECORD_TEXT_MAX_CHARS } = await import(
  '../../orchestrator-v5/decision-records/user-commit.js'
);

const NINETY_DAYS_LATER = new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

async function postCommit(payload: Record<string, unknown>, storeOverrides?: Partial<FakeStoreState>) {
  const harness = makeStore(storeOverrides);
  const app = await buildApp(harness.store);
  const res = await app.inject({
    method: 'POST',
    url: '/assist/v1/decision-records/commit',
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  await app.close();
  return { res, ...harness };
}

describe('0.57.0 (a) — TODAY\'S payload is unchanged, byte for byte', () => {
  it('sends EXACTLY the pre-0.57.0 write: same keys, same values, no position, no reasoning keys', async () => {
    const { res, createRecord } = await postCommit(COMMIT_BODY);
    expect(res.statusCode).toBe(201);
    const write = createRecord.mock.calls[0]![0];
    const expectedId = deriveCommittedDecisionRecordId(SCENARIO_ID, GRAPH_HASH, OWNER_ID, 'commit-nonce-1');
    // toStrictEqual: an extra key — even one set to undefined — fails.
    expect(write).toStrictEqual({
      scenario_id: SCENARIO_ID,
      decision: {
        chosen_option_id: 'opt_b',
        chosen_option_label: 'Option B',
        graph_hash: GRAPH_HASH,
        committed_by_user: true,
      },
      prediction: {
        statement: 'Runway holds above 9 months through Q1.',
        confidence: 0.72,
        confidence_source: 'user_stated',
      },
      review_date: NINETY_DAYS_LATER,
      record_id: expectedId,
      event_id: `decision_recorded_${expectedId}`,
    });
    // Key ORDER too: the RPC receives the same JSON text as before.
    expect(Object.keys(write.decision)).toEqual([
      'chosen_option_id',
      'chosen_option_label',
      'graph_hash',
      'committed_by_user',
    ]);
  });

  it('the response keeps every pre-0.57.0 key, in order, and ADDS exactly position + stored_text_fields', async () => {
    const { res } = await postCommit(COMMIT_BODY);
    const body = res.json();
    expect(Object.keys(body)).toEqual([
      'record_id',
      'deduped',
      'event_id',
      'review_date',
      'review_date_source',
      'confidence_source',
      'committed_by_user',
      'position',
      'stored_text_fields',
      'request_id',
    ]);
    expect(body.position).toBe('chosen');
    expect(body.review_date_source).toBe('default_horizon');
    expect(body.confidence_source).toBe('user_stated');
    expect(body.committed_by_user).toBe(true);
    expect(body.deduped).toBe(false);
    // Today's payload sends no text, so nothing is claimed stored.
    expect(body.stored_text_fields).toEqual([]);
  });

  it('the revisit_trigger_or_date TEXT is still NOT persisted from today\'s payload (the live copy says it stays on this device)', async () => {
    const { res, createRecord } = await postCommit({
      ...COMMIT_BODY,
      revisit_trigger_or_date: 'runway falls below 9 months',
    });
    expect(res.statusCode).toBe(201);
    const write = createRecord.mock.calls[0]![0];
    expect(write.decision).not.toHaveProperty('revisit_trigger');
    expect(JSON.stringify(write)).not.toContain('runway falls below 9 months');
  });

  it('an explicit position "chosen" writes the SAME decision as no position at all', async () => {
    const explicit = await postCommit({ ...COMMIT_BODY, position: 'chosen' });
    const implicit = await postCommit(COMMIT_BODY);
    expect(explicit.res.statusCode).toBe(201);
    expect(explicit.createRecord.mock.calls[0]![0].decision).toStrictEqual(
      implicit.createRecord.mock.calls[0]![0].decision,
    );
    expect(explicit.createRecord.mock.calls[0]![0].decision).not.toHaveProperty('position');
  });
});

describe('0.57.0 (b) — "not ready to choose" is valid WITHOUT an option, a confidence or an expectation, and is never written as a decision', () => {
  // The body the UI sends (decision-record-v2): position + texts, and NO
  // option, NO confidence, NO expectation.
  const NOT_READY_BODY = {
    scenario_id: SCENARIO_ID,
    position: 'not_ready',
    client_commit_id: 'commit-nonce-nr',
    next_action: 'Call the pilot customer this week.',
  };

  it('201 — writes position:not_ready, the SERVER-derived anchor, committed_by_user:true, NO option key and prediction: null', async () => {
    const { res, createRecord } = await postCommit(NOT_READY_BODY);
    expect(res.statusCode).toBe(201);
    const write = createRecord.mock.calls[0]![0];
    expect(write.decision).toStrictEqual({
      position: 'not_ready',
      graph_hash: GRAPH_HASH,
      committed_by_user: true,
      next_action: 'Call the pilot customer this week.',
    });
    expect(write.decision).not.toHaveProperty('chosen_option_id');
    expect(write.decision).not.toHaveProperty('chosen_option_label');
    // NO FORECAST: not an empty object, not a statement — null.
    expect(write.prediction).toBeNull();
    const expectedId = deriveCommittedDecisionRecordId(SCENARIO_ID, GRAPH_HASH, OWNER_ID, 'commit-nonce-nr');
    expect(write.record_id).toBe(expectedId);
    const body = res.json();
    expect(body.position).toBe('not_ready');
    expect(body.record_id).toBe(expectedId);
    // No confidence was stated, so no source is named (never 'user_stated').
    expect(body).not.toHaveProperty('confidence_source');
    expect(body.committed_by_user).toBe(true);
    expect(body.stored_text_fields).toEqual(['next_action']);
  });

  it('keeps review_date semantics: the 90-day default when no date is given…', async () => {
    const { res, createRecord } = await postCommit(NOT_READY_BODY);
    expect(createRecord.mock.calls[0]![0].review_date).toBe(NINETY_DAYS_LATER);
    expect(res.json().review_date_source).toBe('default_horizon');
  });

  it('…and the user\'s own date when one is given', async () => {
    const { res, createRecord } = await postCommit({ ...NOT_READY_BODY, revisit_trigger_or_date: '2026-11-30' });
    expect(createRecord.mock.calls[0]![0].review_date).toBe(new Date('2026-11-30').toISOString());
    expect(res.json().review_date_source).toBe('user_set');
  });

  it('keeps graph_hash semantics: with no analysed graph it is REFUSED, never anchored to nothing', async () => {
    const { res, createRecord } = await postCommit(NOT_READY_BODY, { anchor: null });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('no_analysed_graph');
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('ignores a client-sent graph_hash on the not-ready branch too', async () => {
    const { createRecord } = await postCommit({ ...NOT_READY_BODY, graph_hash: 'response_hash:forged' });
    expect(createRecord.mock.calls[0]![0].decision.graph_hash).toBe(GRAPH_HASH);
  });

  it.each([
    ['a confidence', { confidence_0_100: 55 }],
    ['a confidence of 0', { confidence_0_100: 0 }],
    ['an expectation', { expectation_statement: 'We will know by November.' }],
    ['both', { confidence_0_100: 55, expectation_statement: 'We will know by November.' }],
  ])('not_ready + %s → 400 position_contradiction, NO RPC (refused, never silently dropped)', async (_label, extra) => {
    const { res, createRecord } = await postCommit({ ...NOT_READY_BODY, ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('position_contradiction');
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('null / blank confidence and expectation are "nothing", not a contradiction', async () => {
    const { res, createRecord } = await postCommit({
      ...NOT_READY_BODY,
      confidence_0_100: null,
      expectation_statement: '   ',
    });
    expect(res.statusCode).toBe(201);
    expect(createRecord.mock.calls[0]![0].prediction).toBeNull();
  });

  it('empty-string option fields are "no option", not a contradiction', async () => {
    const { res, createRecord } = await postCommit({
      ...NOT_READY_BODY,
      chosen_option_id: '',
      chosen_option_label: '   ',
    });
    expect(res.statusCode).toBe(201);
    expect(createRecord.mock.calls[0]![0].decision).not.toHaveProperty('chosen_option_id');
  });

  it('refuses an unknown position with a typed 400 and NO RPC', async () => {
    for (const position of ['maybe', '', 7]) {
      const { res, createRecord } = await postCommit({ ...COMMIT_BODY, position });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid_position');
      expect(createRecord).not.toHaveBeenCalled();
    }
  });
});

describe('0.57.0 (c) — rationale, key assumption, revisit trigger and next action are PERSISTED', () => {
  it('on a chosen record: all four, trimmed, inside `decision`, after the pre-0.57.0 keys', async () => {
    const { res, createRecord } = await postCommit({
      ...COMMIT_BODY,
      rationale: '  Cash runway is the binding constraint.  ',
      key_assumption: 'The pilot customer renews in Q1.',
      revisit_trigger: 'Runway falls below 9 months.',
      next_action: 'Call the pilot customer this week.',
    });
    expect(res.statusCode).toBe(201);
    const write = createRecord.mock.calls[0]![0];
    expect(write.decision).toStrictEqual({
      chosen_option_id: 'opt_b',
      chosen_option_label: 'Option B',
      graph_hash: GRAPH_HASH,
      committed_by_user: true,
      rationale: 'Cash runway is the binding constraint.',
      key_assumption: 'The pilot customer renews in Q1.',
      revisit_trigger: 'Runway falls below 9 months.',
      next_action: 'Call the pilot customer this week.',
    });
    // The rationale is NEVER the scored claim.
    expect(write.prediction!.statement).toBe('Runway holds above 9 months through Q1.');
  });

  it('on a not-ready record: next_action + rationale persisted beside position', async () => {
    const { createRecord } = await postCommit({
      scenario_id: SCENARIO_ID,
      position: 'not_ready',
      rationale: 'The pilot renewal is the fact that decides this.',
      next_action: 'Call the pilot customer this week.',
      client_commit_id: 'commit-nonce-nr2',
    });
    const write = createRecord.mock.calls[0]![0];
    expect(write.decision).toStrictEqual({
      position: 'not_ready',
      graph_hash: GRAPH_HASH,
      committed_by_user: true,
      rationale: 'The pilot renewal is the fact that decides this.',
      next_action: 'Call the pilot customer this week.',
    });
  });

  it('whitespace-only / null reasoning text is OMITTED (never "" — the RPC would refuse the whole record)', async () => {
    const { res, createRecord } = await postCommit({
      ...COMMIT_BODY,
      rationale: '   ',
      next_action: null,
    });
    expect(res.statusCode).toBe(201);
    const decision = createRecord.mock.calls[0]![0].decision;
    expect(decision).not.toHaveProperty('rationale');
    expect(decision).not.toHaveProperty('next_action');
  });

  it('a non-string reasoning field is refused, not coerced', async () => {
    const { res, createRecord } = await postCommit({ ...COMMIT_BODY, next_action: 42 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_text_field');
    expect(res.json().message).toContain('next_action');
    expect(createRecord).not.toHaveBeenCalled();
  });
});

describe('0.57.0 (d) — over-length reasoning text is REJECTED, never truncated', () => {
  it('pins the bound the migration enforces (1000)', () => {
    expect(DECISION_RECORD_TEXT_MAX_CHARS).toBe(1000);
  });

  it.each(['rationale', 'key_assumption', 'revisit_trigger', 'next_action'])(
    '%s at 1001 chars → 400 text_field_too_long naming the field, NO RPC',
    async (field) => {
      const { res, createRecord } = await postCommit({
        ...COMMIT_BODY,
        [field]: 'x'.repeat(DECISION_RECORD_TEXT_MAX_CHARS + 1),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('text_field_too_long');
      expect(res.json().message).toContain(field);
      expect(createRecord).not.toHaveBeenCalled();
    },
  );

  it.each(['rationale', 'key_assumption', 'revisit_trigger', 'next_action'])(
    'BOUNDARY — %s at exactly 1000 chars is accepted and stored whole',
    async (field) => {
      const value = 'x'.repeat(DECISION_RECORD_TEXT_MAX_CHARS);
      const { res, createRecord } = await postCommit({ ...COMMIT_BODY, [field]: value });
      expect(res.statusCode).toBe(201);
      const decision = createRecord.mock.calls[0]![0].decision as unknown as Record<string, unknown>;
      expect(decision[field]).toBe(value);
    },
  );

  it('the length is measured AFTER trimming (padding cannot push a valid value over)', async () => {
    const value = `  ${'x'.repeat(DECISION_RECORD_TEXT_MAX_CHARS)}  `;
    const { res } = await postCommit({ ...COMMIT_BODY, rationale: value });
    expect(res.statusCode).toBe(201);
  });
});

describe('0.57.0 (e) — not_ready WITH an option is a CONTRADICTION, refused before any RPC', () => {
  const NOT_READY_BASE = {
    scenario_id: SCENARIO_ID,
    position: 'not_ready',
    client_commit_id: 'commit-nonce-contra',
  };

  it.each([
    ['an option id', { chosen_option_id: 'opt_b' }],
    ['an option label', { chosen_option_label: 'Option B' }],
    ['both', { chosen_option_id: 'opt_b', chosen_option_label: 'Option B' }],
    ['a NON-STRING option id', { chosen_option_id: 7 }],
  ])('not_ready + %s → 400 position_contradiction', async (_label, option) => {
    const { res, createRecord } = await postCommit({ ...NOT_READY_BASE, ...option });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('position_contradiction');
    expect(createRecord).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// stored_text_fields — the response says which texts the ACCOUNT holds, per
// field, from the RPC's own echo. The UI reads it to decide, per field,
// between "on your account" and "on this device".
// ---------------------------------------------------------------------------

describe('0.57.0 (f) — stored_text_fields confirms the durable texts, from the row, never from the request', () => {
  const WITH_TEXT = {
    ...COMMIT_BODY,
    rationale: '  Cash runway is the binding constraint.  ',
    key_assumption: 'The pilot customer renews in Q1.',
    revisit_trigger: 'Runway falls below 9 months.',
    revisit_trigger_or_date: 'Runway falls below 9 months.',
  };

  it('lists every text the row holds verbatim, in canonical order (next_action absent: not sent)', async () => {
    const { res } = await postCommit(WITH_TEXT);
    expect(res.statusCode).toBe(201);
    expect(res.json().stored_text_fields).toEqual(['rationale', 'key_assumption', 'revisit_trigger']);
  });

  it('the revisit TEXT is stored from revisit_trigger, while revisit_trigger_or_date still only drives review_date', async () => {
    const { res, createRecord } = await postCommit(WITH_TEXT);
    const write = createRecord.mock.calls[0]![0];
    expect(write.decision).toHaveProperty('revisit_trigger', 'Runway falls below 9 months.');
    expect(res.json().review_date_source).toBe('default_horizon_after_unparsed_trigger');
  });

  it('a REPLAY returning an earlier row with DIFFERENT text does not confirm that text', async () => {
    const earlierRow = {
      chosen_option_id: 'opt_b',
      chosen_option_label: 'Option B',
      graph_hash: GRAPH_HASH,
      committed_by_user: true,
      rationale: 'An earlier rationale.',
      key_assumption: 'The pilot customer renews in Q1.',
    };
    const { res } = await postCommit(WITH_TEXT, {
      createResult: { record_id: 'new-record', deduped: true, event_id: null },
      storedDecision: earlierRow,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().deduped).toBe(true);
    expect(res.json().stored_text_fields).toEqual(['key_assumption']);
  });

  it('no decision echoed ⇒ [] (the client keeps saying "on this device")', async () => {
    const { res } = await postCommit(WITH_TEXT, { storedDecision: undefined });
    expect(res.statusCode).toBe(201);
    expect(res.json().stored_text_fields).toEqual([]);
  });
});
