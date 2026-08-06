/**
 * Calibration R0 — the recording-seam ROUTES.
 *
 * The JWT half is verified with REAL tokens against the REAL
 * `verifySupabaseUserJwt` util (jose, HS256 on a test secret) — not a mocked
 * verifier. A mocked verifier would prove the route calls something; only a
 * real token can prove the `aud` guard, the `exp` guard and the UUID-`sub`
 * guard are the things doing the work.
 *
 * The store is a hand-rolled port fake injected through the route's `deps`
 * seam — no Supabase client, no network.
 *
 * Every assertion binds by IDENTITY: exact record ids, exact refusal codes,
 * exact payload keys sent to the RPC (trap 19).
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const JWT_SECRET = 'test-supabase-jwt-secret-value-for-hs256-verification';

// CEE_REQUIRE_USER_JWT is DELIBERATELY FALSE throughout this file. Every 401
// and 403 below therefore proves the endpoint's verification is ALWAYS-ON and
// independent of that flag — which is the whole point of T4.
vi.mock('../../config/index.js', () => ({
  config: {
    auth: {
      supabaseJwtSecret: JWT_SECRET,
      supabaseJwksUrl: undefined,
      supabaseUrl: undefined,
      requireUserJwt: false,
    },
  },
}));

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

const decisionRecordsRoute = (await import('../assist.v1.decision-records.js')).default;

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RECORD_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const HASH_AT_RUN = 'abcdef0123456789';
const COMPUTED_AT = '2026-07-10T12:00:00.000Z';
const GRAPH_HASH = `${AAG_V1_GRAPH_HASH_PREFIX}${HASH_AT_RUN}`;
const NOW = new Date('2026-08-06T09:00:00.000Z');

const secretKey = new TextEncoder().encode(JWT_SECRET);

/** A genuine Supabase-shaped user access token. */
async function userToken(
  sub: string = OWNER_ID,
  opts?: { expired?: boolean; audience?: string | null },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(opts?.expired === true ? now - 7200 : now)
    .setExpirationTime(opts?.expired === true ? now - 3600 : now + 3600);
  if (opts?.audience !== null) {
    jwt = jwt.setAudience(opts?.audience ?? 'authenticated');
  }
  return jwt.sign(secretKey);
}

/**
 * POSITIVE CONTROL for the `aud` guard: the project's anon API key is itself
 * an HS256 JWT on the SAME secret, but carries no `authenticated` audience
 * and no `sub`. If this ever verifies, the guard is not doing the work.
 */
async function anonApiKeyShapedToken(): Promise<string> {
  return new SignJWT({ role: 'anon', iss: 'supabase' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secretKey);
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
    outcomeResult: { record_id: RECORD_ID, deduped: false, event_id: 'evt-outcome' },
    outcomeError: null,
    ...overrides,
  };

  const createRecord = vi.fn(async (write: { record_id: string }) => ({
    ...state.createResult,
    record_id: state.createResult.record_id === 'new-record'
      ? write.record_id
      : state.createResult.record_id,
  }));
  const recordOutcome = vi.fn(async () => {
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
  token = await userToken();
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
    const write = createRecord.mock.calls[0]![0] as {
      record_id: string;
      decision: Record<string, unknown>;
      prediction: Record<string, unknown>;
    };

    // IDENTITY: the auto-capture id for THIS analysed graph, named exactly.
    const autoId = deriveDecisionRecordId(SCENARIO_ID, GRAPH_HASH, COMPUTED_AT);
    expect(write.record_id).not.toBe(autoId);

    expect(write.prediction.confidence_source).toBe('user_stated');
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

    const write = createRecord.mock.calls[0]![0] as { decision: { graph_hash: string } };
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
    const write = createRecord.mock.calls[0]![0] as { prediction: { confidence: number } };
    expect(write.prediction.confidence).toBeCloseTo(expected, 12);
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
    const write = createRecord.mock.calls[0]![0] as { review_date: string };
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
    const write = recordOutcome.mock.calls[0]![0] as {
      record_id: string;
      outcome: Record<string, unknown>;
      event_id: string;
    };
    expect(write.record_id).toBe(RECORD_ID);
    expect(write.outcome.result).toBe('worse');
    expect(write.outcome.brier_component as number).toBeCloseTo(0.5184, 12);
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
    const write = recordOutcome.mock.calls[0]![0] as { outcome: Record<string, unknown> };
    expect(write.outcome.brier_component as number).toBeCloseTo(0.0784, 12);
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
    const write = recordOutcome.mock.calls[0]![0] as { outcome: Record<string, unknown> };
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
    const write = recordOutcome.mock.calls[0]![0] as { outcome: Record<string, unknown> };
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
    const write = recordOutcome.mock.calls[0]![0] as { outcome: Record<string, unknown> };
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
    const write = recordOutcome.mock.calls[0]![0] as { outcome: Record<string, unknown> };
    expect(write.outcome.brier_component as number).toBeCloseTo(0.5184, 12);

    // AND the outcome path never consults the scenario at all — a scoring
    // path routed through `scenarios`/its event journal would have lost this
    // record entirely.
    expect(readScenarioOwner).not.toHaveBeenCalled();
    await app.close();
  });
});
