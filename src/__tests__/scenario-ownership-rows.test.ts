import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createHash, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgeUserToken, makeEs256Key, type JwksFixture } from '../utils/__tests__/helpers/supabase-jwks-fixture.js';

const jwksKeys = vi.hoisted(() => ({ keys: [] as import('jose').JWK[] }));
vi.mock('jose', async load => { const actual = await load<typeof import('jose')>(); return { ...actual, createRemoteJWKSet: () => actual.createLocalJWKSet({ keys: jwksKeys.keys }) }; });

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const state = vi.hoisted(() => ({ owner: null as string | null, member: false, memberThrows: false, absent: false, oracleThrows: false, entityAbsent: false, existenceThrows: false, members: vi.fn(), writes: vi.fn() }));
const session = vi.hoisted(() => ({
  readExistingScenario: vi.fn(async () => { if (state.oracleThrows || state.existenceThrows) throw new Error('reader down'); return state.absent ? null : { userId: state.owner, graph: null, briefText: null, analysisInvalidatedAt: null }; }),
  getScenarioOwner: vi.fn(async () => state.owner),
  scenarioExists: vi.fn(async () => { if (state.existenceThrows) throw new Error('existence reader down'); return !state.absent; }),
  turnFenceRowExists: vi.fn(async () => true),
  markTurnStopped: vi.fn(async () => ({ stopped: true, claimed: true, alreadyCommitted: false })),
  hasAdmittedTurns: vi.fn(async () => false),
  readMostRecentPendingActions: vi.fn(async () => []),
  readRecent: vi.fn(async () => []),
  ensureScenarioExists: vi.fn(async (id: string, caller: string | null) => { state.writes(id, caller); if (state.absent) { state.owner = caller; state.absent = false; } return { user_id: state.owner }; }),
  isScenarioMember: vi.fn(async (...args: unknown[]) => { state.members(...args); if (state.memberThrows) throw new Error('membership read failed'); return state.member; }),
  loadGraphAndBriefText: vi.fn(async () => ({ graph: null, briefText: null })),
}));
vi.mock('../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => session }));
vi.mock('../services/session-cache.js', () => ({ retrieveSession: vi.fn(async () => ({ degraded: false, session: null })), appendTurn: vi.fn(async () => undefined) }));
vi.mock('../adapters/ask/index.js', () => ({ processAskRequest: vi.fn(async () => ({ response: { message: 'Ask served.', actions: [] }, inferredIntent: 'explain', intentConfidence: 1 })) }));
const cfg = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
vi.mock('../config/index.js', async (load) => {
  const actual = await load<typeof import('../config/index.js')>();
  const config = { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false }, proxy: { ...actual.config.proxy, browserProxyEnabled: true, browserProxyAllowedOrigins: 'https://staging--olumi.netlify.app', agentLaneEnabled: true } };
  cfg.auth = config.auth;
  return { ...actual, config };
});
vi.mock('../utils/telemetry.js', () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => p }) }));

const collab = {
  getScenarioOwnerUserId: async () => state.owner,
  getRound: async () => state.entityAbsent ? null : ({ round_id: RID, scenario_id: SID, created_by: A, status: 'closed' }),
};
const records = {
  readScenarioOwner: async (id: string) => id === SID ? state.owner : null,
  readRecordForOutcome: async () => state.entityAbsent ? null : ({ record_id: RID, scenario_id: SID, owner_user_id: A, hasOutcome: false }),
};
vi.mock('../collab/store.js', () => ({ getCollabStore: () => collab }));
vi.mock('../orchestrator-v5/decision-records/index.js', () => ({ getDecisionRecordStore: () => records }));

const routes = [
  ['POST', '/orchestrate/v2/turn', 422], ['POST', '/orchestrate/v2/turn/stop', 404], ['POST', '/orchestrate/v2/turn/stream', 422],
  ['POST', '/proxy/v5/turn', 422], ['POST', '/proxy/v5/turn/stop', 404], ['POST', '/proxy/v5/turn/stream', 422], ['POST', '/agent/v1/turn', 404],
  ['POST', '/assist/v1/scenarios/:scenario_id/graph', 404], ['POST', '/assist/v1/scenarios/:scenario_id/graph/register', 404],
  ['POST', '/assist/v1/scenarios/:scenario_id/versions', 404], ['POST', '/assist/v1/scenarios/:scenario_id/versions/compare', 404],
  ['POST', '/assist/v1/scenarios/:scenario_id/versions/save', 404], ['POST', '/assist/v1/scenarios/:scenario_id/versions/restore', 404],
  ['POST', '/assist/v1/scenarios/:scenario_id/copy', 404], ['POST', '/assist/v1/decision-records/commit', 403],
  ['POST', '/assist/v1/decision-records/:record_id/outcome', 403], ['POST', '/assist/v1/decision-records/list', 404],
  ['POST', '/collab/v1/rounds', 403], ['POST', '/collab/v1/rounds/:round_id/close', 403],
  ['GET', '/collab/v1/rounds/:round_id/preview', 403], ['GET', '/collab/v1/rounds/:round_id/reveal', 403], ['GET', '/collab/v1/rounds/:round_id/disagreement', 403],
  ['POST', '/assist/v1/ask', 404], ['POST', '/assist/v1/graph-readiness', 404],
] as const;
const pathname = (p: string) => p.replace(':scenario_id', SID).replace(':record_id', RID).replace(':round_id', RID);
const admitted = new Set<string>(routes.map(([, p]) => p));
let app: FastifyInstance;
let jwks: JwksFixture;
let tokenA: string;
let tokenB: string;
async function ownership(app: FastifyInstance) {
  // Missing on base: exercise the same registrations with no new source present.
  if (existsSync('src/plugins/scenario-ownership.ts')) {
    const { scenarioOwnershipPlugin } = await import('../plugins/scenario-ownership.js');
    await app.register(scenarioOwnershipPlugin);
  }
}
async function mount(app: FastifyInstance) {
  const files = ['assist.v1.ask', 'assist.v1.graph-readiness', 'assist.v1.scenario-graph', 'assist.v1.scenario-graph-register', 'assist.v1.scenario-versions', 'assist.v1.scenario-copy', 'assist.v1.decision-records', 'collab.v1.rounds', 'orchestrate.v2.turn-stream', 'proxy-v5-turn', 'proxy-v5-turn-stream', 'agent-v1-turn'];
  for (const name of files) { const mod = await import(`../routes/${name}.ts`); await (mod.default ?? mod.agentV1TurnRoute ?? mod.proxyV5TurnRoute)(app); }
  const { ceeOrchestratorRouteV2 } = await import('../orchestrator/route-v2.js');
  await ceeOrchestratorRouteV2(app);
}
async function request(p: string, token: string | null, method: 'POST' | 'GET' = 'POST', body: Record<string, unknown> = {}) {
  return app.inject({ method, url: pathname(p), headers: { 'x-request-id': 'row', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(method === 'POST' ? { payload: { scenario_id: SID, turn_id: RID, user_id: A, ...body } } : {}) });
}
const normalise = (payload: string) => payload.replace(/"request_id":"[^"]*"/g, '"request_id":"row"');
beforeAll(async () => {
  const key = await makeEs256Key('kid-1');
  jwksKeys.keys = [key.jwk];
  // Sandbox forbids listen(); substitute JWKS TRANSPORT only, retaining real ES256 verification.
  jwks = { base: 'https://owniso.invalid', issuer: 'https://owniso.invalid/auth/v1', close: async () => {} } as JwksFixture;
  await import('../config/index.js');
  cfg.auth.supabaseUrl = jwks.base;
  cfg.auth.supabaseJwksUrl = undefined;
  const { resetSupabaseJwksCacheForTests } = await import('../utils/supabase-user-jwt.js'); resetSupabaseJwksCacheForTests();
  tokenA = await forgeUserToken(key.privateKey, jwks.issuer, { sub: A, aud: 'authenticated' });
  tokenB = await forgeUserToken(key.privateKey, jwks.issuer, { sub: B, aud: 'authenticated' });
  expect(await (await import('../utils/supabase-user-jwt.js')).verifySupabaseUserJwt(tokenA)).toEqual({ ok: true, userId: A });
  app = Fastify();
  await ownership(app);
  // Real production registrations, terminal route hook measures ADMISSION only.
  // Business validation, scientific restrictions and RPCs are covered separately.
  app.addHook('onRoute', options => {
    if (!admitted.has(options.url)) return;
    options.preHandler = [async (req: FastifyRequest, reply) => reply.header('x-owniso-scenario', (req as any).scenarioAccess?.scenarioId ?? SID).header('x-owniso-caller', (req as any).scenarioAccess?.callerUserId ?? '').code(200).send({ admitted: true, scenario_id: (req as any).scenarioAccess?.scenarioId ?? SID, caller: (req as any).scenarioAccess?.callerUserId, member_read: (req as any).scenarioAccess?.memberRead ?? false })];
  });
  await mount(app); await app.ready();
});
afterAll(async () => { await app?.close(); await jwks?.close(); });
beforeEach(() => { state.owner = A; state.member = false; state.memberThrows = false; state.absent = false; state.oracleThrows = false; state.entityAbsent = false; state.existenceThrows = false; session.markTurnStopped.mockClear(); state.members.mockClear(); state.writes.mockClear(); });

describe('24 real registrations: ownership admission (terminal hook, business handlers excluded)', () => {
  for (const [method, path, refusal] of routes) {
    it(`${method} ${path} id=${SID} owner=A caller=B valid JWT -> ${refusal}`, async () => {
      const r = await request(path, tokenB, method); expect(r.statusCode).toBe(refusal); expect(r.payload).not.toContain('"admitted":true');
    });
    it(`${method} ${path} id=${SID} owner=A caller=A valid JWT -> 200 admission`, async () => {
      const r = await request(path, tokenA, method); expect(r.statusCode).toBe(200); expect(r.headers['x-owniso-scenario']).toBe(SID); expect(r.headers['x-owniso-caller']).toBe(A);
    });
    it(`${method} ${path} id=${SID} owner=A no JWT -> refusal`, async () => {
      const r = await request(path, null, method); expect([refusal, 401]).toContain(r.statusCode); expect(r.payload).not.toContain('"admitted":true');
    });
    // Features requiring sign-in (copy, collab, decision records) retain that requirement.
    if (!path.includes('/copy') && !path.includes('/collab/') && !path.includes('/decision-records/')) {
      it(`${method} ${path} id=${SID} guest owner=NULL no JWT -> 200 unchanged admission`, async () => {
        state.owner = null; const r = await request(path, null, method); expect(r.statusCode).toBe(200); expect(r.headers['x-owniso-scenario']).toBe(SID);
      });
    }
  }
});
it('member B reads A graph -> 200 with memberRead', async () => {
  state.member = true; const r = await request('/assist/v1/scenarios/:scenario_id/graph', tokenB); expect(r.statusCode).toBe(200); expect(r.json().member_read).toBe(true); expect(state.members).toHaveBeenCalledWith(SID, B);
});
it.each(['/assist/v1/scenarios/:scenario_id/graph/register', '/assist/v1/scenarios/:scenario_id/versions/save', '/orchestrate/v2/turn'])('member B cannot write %s', async p => {
  state.member = true; const r = await request(p, tokenB); expect(r.statusCode).toBe(p.startsWith('/orchestrate') ? 422 : 404); expect(state.members).not.toHaveBeenCalled();
});
it('membership throw gives bytes identical to non-member refusal, never 503', async () => {
  const no = await request('/assist/v1/scenarios/:scenario_id/graph', tokenB); state.memberThrows = true;
  const failed = await request('/assist/v1/scenarios/:scenario_id/graph', tokenB); expect(failed.statusCode).toBe(404); expect(normalise(failed.payload)).toBe(normalise(no.payload)); expect(state.members).toHaveBeenCalledTimes(2);
});
it.each([
  ['/collab/v1/rounds', 403, 'collab_owner_only', 'Only the scenario owner can open a round on it.'],
  ['/assist/v1/decision-records/commit', 403, 'not_scenario_owner', 'This scenario belongs to someone else.'],
  ['/assist/v1/decision-records/:record_id/outcome', 403, 'not_record_owner', 'This record belongs to someone else.'],
  ['/assist/v1/decision-records/list', 404, 'scenario_not_found', 'No such scenario.'],
] as const)('exact refusal %s', async (p, status, code, message) => {
  const r = await request(p, tokenB); expect(r.statusCode).toBe(status); expect(normalise(r.payload)).toBe(JSON.stringify({ error: code, code, message, request_id: 'row' }));
});
it('a body user_id=A and valid JWT B cannot impersonate A on ask', async () => {
  const r = await request('/assist/v1/ask', tokenB, 'POST', { user_id: A }); expect(r.statusCode).toBe(404);
});

// Served-change rows use REAL business handlers; no terminal admission hook.
it.each(['/assist/v1/ask', '/assist/v1/graph-readiness'])('real handler %s: cross-owner refusal and guest unchanged', async p => {
  const real = Fastify(); await ownership(real);
  const mod = await import(`../routes/${p.endsWith('ask') ? 'assist.v1.ask' : 'assist.v1.graph-readiness'}.ts`); await mod.default(real);
  const graph = { nodes: [], edges: [] };
  const payload = { scenario_id: SID, message: 'What matters?', graph, graph_snapshot: graph, graph_schema_version: '2.2', brief: 'What should our team explore?', market_context: { id: 'market', version: '1', hash: 'h' } };
  const denied = await real.inject({ method: 'POST', url: p, headers: { authorization: `Bearer ${tokenB}` }, payload });
  state.owner = null;
  const guest = await real.inject({ method: 'POST', url: p, payload }); expect(guest.statusCode).toBe(200);
  await real.close();
  expect(denied.statusCode).toBe(404);
});

it.each(['/assist/v1/ask', '/assist/v1/graph-readiness'])('base/head real guest no JWT %s -> 200', async p => {
  state.owner = null; const real = Fastify(); await ownership(real); const mod = await import(`../routes/${p.endsWith('ask') ? 'assist.v1.ask' : 'assist.v1.graph-readiness'}.ts`); await mod.default(real);
  const graph = { nodes: [], edges: [] }; const payload = { scenario_id: SID, message: 'What matters?', graph, graph_snapshot: graph, graph_schema_version: '2.2', brief: 'What should our team explore?', market_context: { id: 'market', version: '1', hash: 'h' } };
  const guest = await real.inject({ method: 'POST', url: p, payload }); await real.close(); expect(guest.statusCode).toBe(200);
});

it('outcome derives scenario from record; body scenario_id cannot choose its authority', async () => {
  const r = await request('/assist/v1/decision-records/:record_id/outcome', tokenB, 'POST', { scenario_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', result: 'as_expected' }); expect(r.statusCode).toBe(403); expect(r.json().code).toBe('not_record_owner');
});


it('real member graph read retains conversation suppression; owner still reads conversation', async () => {
  const real = Fastify(); await ownership(real); const { default: graphRoute } = await import('../routes/assist.v1.scenario-graph.js'); await graphRoute(real);
  state.member = true; session.readRecent.mockClear();
  const member = await real.inject({ method: 'POST', url: pathname('/assist/v1/scenarios/:scenario_id/graph'), headers: { authorization: `Bearer ${tokenB}` }, payload: { include_conversation_turns: true } });
  expect(member.statusCode).toBe(200); expect(member.json()).not.toHaveProperty('conversation_turns'); expect(session.readRecent).not.toHaveBeenCalled();
  const owner = await real.inject({ method: 'POST', url: pathname('/assist/v1/scenarios/:scenario_id/graph'), headers: { authorization: `Bearer ${tokenA}` }, payload: { include_conversation_turns: true } });
  expect(owner.statusCode).toBe(200); expect(owner.json()).toHaveProperty('conversation_turns'); expect(session.readRecent).toHaveBeenCalled(); await real.close();
});
it('unknown turn keeps CREATE with verified JWT subject; body user_id is ignored', async () => {
  state.absent = true; state.owner = null;
  const r = await request('/orchestrate/v2/turn', tokenB, 'POST', { kind: 'message', message: 'Explore this strategy', turn_class: 'frame', stage: 'frame', source: 'composer' });
  expect(r.statusCode).toBe(200); expect(state.writes).toHaveBeenCalledWith(SID, B); expect(r.headers['x-owniso-caller']).toBe(B);
});
it('unknown turn with invalid ingress does not CREATE before handler validation', async () => {
  state.absent = true; state.owner = null; await request('/orchestrate/v2/turn', tokenA);
  expect(state.writes).not.toHaveBeenCalled();
});
it('unknown invalid graph import keeps 422 and does not CREATE', async () => {
  state.absent = true; state.owner = null; const real = Fastify(); await ownership(real);
  const { default: registerRoute } = await import('../routes/assist.v1.scenario-graph-register.js'); await registerRoute(real);
  const r = await real.inject({ method: 'POST', url: pathname('/assist/v1/scenarios/:scenario_id/graph/register'), headers: { authorization: `Bearer ${tokenA}` }, payload: { graph: { nodes: [], edges: [] } } });
  expect(r.statusCode).toBe(422); expect(state.writes).not.toHaveBeenCalled(); await real.close();
});
it('ownership reader outage fails closed on ask, readiness and graph', async () => {
  state.oracleThrows = true;
  for (const p of ['/assist/v1/ask', '/assist/v1/graph-readiness', '/assist/v1/scenarios/:scenario_id/graph']) {
    const r = await request(p, tokenA); expect(r.statusCode).toBe(503); expect(state.writes).not.toHaveBeenCalled();
  }
});
it('only VERIFIED HMAC turn/stop service claims retain their existing authority', async () => {
  cfg.auth.hmacSecret = 'local-test-hmac-secret'; cfg.auth.assistApiKey = 'local-test-assist-key';
  const real = Fastify(); const { authPlugin } = await import('../plugins/auth.js'); await real.register(authPlugin); await ownership(real);
  for (const p of ['/orchestrate/v2/turn', '/orchestrate/v2/turn/stop', '/assist/v1/scenarios/:scenario_id/graph']) {
    real.post(p, { config: { scenarioId: { from: p.includes('/scenarios/') ? 'params' : 'body', key: 'scenario_id' } } }, async req => ({ caller: req.scenarioAccess?.callerUserId }));
  }
  for (const p of ['/orchestrate/v2/turn', '/orchestrate/v2/turn/stop', '/assist/v1/scenarios/:scenario_id/graph']) {
    const path = pathname(p), payload = JSON.stringify({ scenario_id: SID, turn_id: RID, user_id: A });
    const signature = createHmac('sha256', 'local-test-hmac-secret').update(`POST\n${path}\n${createHash('sha256').update(payload).digest('hex')}`).digest('hex');
    const signed = await real.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/json', 'x-olumi-signature': signature }, payload });
    expect(signed.statusCode).toBe(p.includes('/scenarios/') ? 404 : 200);
    if (!p.includes('/scenarios/')) expect(signed.json().caller).toBe(A);
    const forged = await real.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/json', 'x-olumi-signature': 'forged', 'x-olumi-assist-key': 'local-test-assist-key' }, payload });
    expect(forged.statusCode).toBe(p.endsWith('/stop') || p.includes('/scenarios/') ? 404 : 422);
  }
  await real.close();
});
it('internal dispatch headers preserve the SAME verified caller and do not bypass admission', async () => {
  const { internalHeaders } = await import('../orchestrator-v5/agent-lane/internal-headers.js');
  const headers = internalHeaders('local-test-assist-key', `Bearer ${tokenB}`); expect(headers.authorization).toBe(`Bearer ${tokenB}`);
  const r = await app.inject({ method: 'POST', url: pathname('/assist/v1/scenarios/:scenario_id/graph'), headers, payload: { user_id: A } }); expect(r.statusCode).toBe(404);
});

it('missing derived record/round is refused by the hook before the handler can reread', async () => {
  state.entityAbsent = true;
  const outcome = await request('/assist/v1/decision-records/:record_id/outcome', tokenB); expect(outcome.statusCode).toBe(404); expect(outcome.json().code).toBe('DR404');
  const round = await request('/collab/v1/rounds/:round_id/reveal', tokenB, 'GET'); expect(round.statusCode).toBe(403); expect(round.json().message).toBe('No round you own with that id.');
});

// ROUND 2: actual Stop handlers on both mounted ingresses, not terminal admission probes.
it.each(['/orchestrate/v2/turn/stop', '/proxy/v5/turn/stop'])('Stop %s: thrown existence reader records exact base success bytes', async path => {
  state.existenceThrows = true;
  const real = Fastify(); await ownership(real);
  const { ceeOrchestratorRouteV2 } = await import('../orchestrator/route-v2.js'); await ceeOrchestratorRouteV2(real);
  const { proxyV5TurnRoute } = await import('../routes/proxy-v5-turn.js'); await proxyV5TurnRoute(real);
  try {
    const r = await real.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${tokenA}`, 'x-request-id': 'row', origin: 'https://staging--olumi.netlify.app' }, payload: { scenario_id: SID, turn_id: RID } });
    expect(r.statusCode).toBe(200);
    expect(normalise(r.payload)).toBe(JSON.stringify({ stopped: true, claimed: true, already_committed: false, scenario_id: SID, turn_id: RID, request_id: 'row' }));
    expect(session.markTurnStopped).toHaveBeenCalledWith(SID, RID);
  } finally { await real.close(); }
});
it.each(['/orchestrate/v2/turn/stop', '/proxy/v5/turn/stop'])('Stop %s: non-UUID, clean no-row and known owner mismatch keep exact base refusal bytes', async path => {
  const real = Fastify(); await ownership(real);
  const { ceeOrchestratorRouteV2 } = await import('../orchestrator/route-v2.js'); await ceeOrchestratorRouteV2(real);
  const { proxyV5TurnRoute } = await import('../routes/proxy-v5-turn.js'); await proxyV5TurnRoute(real);
  const refusal = JSON.stringify({ error: { code: 'TURN_STOP_UNKNOWN_SCENARIO', message: 'That turn could not be stopped.', source: 'cee', request_id: 'row' } });
  try {
    for (const kind of ['non-UUID', 'no-row', 'owner-mismatch', 'existence-throw-owner-mismatch']) {
      session.scenarioExists.mockClear(); session.getScenarioOwner.mockClear();
      state.absent = kind === 'no-row'; state.existenceThrows = kind === 'existence-throw-owner-mismatch';
      const r = await real.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${kind.includes('owner-mismatch') ? tokenB : tokenA}`, 'x-request-id': 'row', origin: 'https://staging--olumi.netlify.app' }, payload: { scenario_id: kind === 'non-UUID' ? 'not-a-uuid' : SID, turn_id: RID } });
      expect(r.statusCode, kind).toBe(404); expect(normalise(r.payload), kind).toBe(refusal);
      expect(session.markTurnStopped, kind).not.toHaveBeenCalled();
      if (kind === 'non-UUID') expect(session.scenarioExists).not.toHaveBeenCalled();
      if (kind === 'non-UUID' || kind === 'no-row') expect(session.getScenarioOwner).not.toHaveBeenCalled();
      else expect(session.getScenarioOwner).toHaveBeenCalledWith(SID);
    }
  } finally { await real.close(); }
});
