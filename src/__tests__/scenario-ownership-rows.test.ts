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
const OTHER_SID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const fixtureId = (id: string) => id.trim().replace(/[{}-]/g, '').toLowerCase() === 'cccccccccccc4ccc8ccccccccccccccc' ? SID : id;
const state = vi.hoisted(() => ({ owner: null as string | null, member: false, memberThrows: false, absent: false, oracleThrows: false, entityAbsent: false, existenceThrows: false, admitted: false, persisted: false, members: vi.fn(), writes: vi.fn() }));
const session = vi.hoisted(() => ({
  readExistingScenario: vi.fn(async (id: string) => { if (state.oracleThrows || state.existenceThrows) throw new Error('reader down'); if (fixtureId(id) === OTHER_SID) return { userId: B, graph: null, briefText: null, analysisInvalidatedAt: null }; return fixtureId(id) !== SID || state.absent ? null : { userId: state.owner, graph: null, briefText: null, analysisInvalidatedAt: null }; }),
  getScenarioOwner: vi.fn(async (id: string) => fixtureId(id) === SID ? state.owner : id === OTHER_SID ? B : null),
  scenarioExists: vi.fn(async (id: string) => { if (state.existenceThrows) throw new Error('existence reader down'); return fixtureId(id) === SID && !state.absent; }),
  turnFenceRowExists: vi.fn(async () => true),
  markTurnStopped: vi.fn(async () => ({ stopped: true, claimed: true, alreadyCommitted: false })),
  hasAdmittedTurns: vi.fn(async () => false),
  scenarioHasAdmittedTurn: vi.fn(async () => state.admitted),
  readMostRecentPendingActions: vi.fn(async () => []),
  readRecent: vi.fn(async () => []),
  ensureScenarioExists: vi.fn(async (id: string, caller: string | null) => { state.writes(id, caller); if (state.absent) { state.owner = caller; state.absent = false; } return { user_id: state.owner }; }),
  isScenarioMember: vi.fn(async (...args: unknown[]) => { state.members(...args); if (state.memberThrows) throw new Error('membership read failed'); return state.member; }),
  loadGraphAndBriefText: vi.fn(async (id: string) => ({ graph: fixtureId(id) === SID && !state.absent && state.persisted ? { nodes: [], edges: [] } : null, briefText: null })),
  loadGraph: vi.fn(async (id: string) => fixtureId(id) === SID && !state.absent ? { nodes: [], edges: [] } : null),
  append: vi.fn(async (input: { scenario_id: string }) => { state.writes(input); return { id: 'row' }; }),
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
  getScenarioOwnerUserId: vi.fn(async (id: string) => fixtureId(id) === SID ? state.owner : id === OTHER_SID ? B : null),
  createModelVersion: vi.fn(async (input: { scenario_id: string }) => { state.writes(input); return { model_version_id: RID }; }),
  insertRound: vi.fn(async (input: { scenario_id: string }) => { state.writes(input); }),
  appendRoundEvent: vi.fn(async (input: unknown) => { state.writes(input); }),
  getRound: async (id: string) => state.entityAbsent || id !== RID ? null : ({ round_id: RID, scenario_id: SID, created_by: A, status: 'closed' }),
};
const records = {
  readScenarioOwner: async (id: string) => id === SID ? state.owner : null,
  readRecordForOutcome: async (id: string) => state.entityAbsent || id !== RID ? null : ({ record_id: RID, scenario_id: SID, owner_user_id: A, hasOutcome: false }),
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
  return app.inject({ method, url: pathname(p), headers: { 'x-request-id': 'row', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(method === 'POST' ? { payload: { scenario_id: p.includes(':scenario_id') || p.includes(':round_id') || p.includes(':record_id') ? OTHER_SID : SID, turn_id: RID, user_id: A, ...body } } : {}) });
}
const normalise = (payload: string) => payload.replace(/"request_id":"[^"]*"/g, '"request_id":"row"');
beforeAll(async () => {
  const { createMockSessionStore } = await import('../../tests/utils/mock-session-store.js');
  const originalPorts = { ...session }; Object.assign(session, createMockSessionStore(), originalPorts);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Consider the scope of the work.' }] }] }), { status: 200 })));
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
afterAll(async () => { await app?.close(); await jwks?.close(); vi.unstubAllGlobals(); });
beforeEach(() => { state.owner = A; state.member = false; state.memberThrows = false; state.absent = false; state.oracleThrows = false; state.entityAbsent = false; state.existenceThrows = false; state.admitted = false; state.persisted = false; vi.clearAllMocks(); session.markTurnStopped.mockClear(); state.members.mockClear(); state.writes.mockClear(); });

describe('24 real registrations: ownership admission (terminal hook, business handlers excluded)', () => {
  for (const [method, path, refusal] of routes) {
    it(`${method} ${path} id=${SID} owner=A caller=B valid JWT -> ${refusal}`, async () => {
      const r = await request(path, tokenB, method); expect(r.statusCode).toBe(refusal); expect(r.payload).not.toContain('"admitted":true');
    });
    it(`${method} ${path} id=${SID} owner=A caller=A valid JWT -> 200 admission`, async () => {
      const r = await request(path, tokenA, method); expect(r.statusCode).toBe(200); expect(r.headers['x-owniso-scenario']).toBe(SID); expect(r.headers['x-owniso-caller']).toBe(A);
    });
    it(`${method} ${path} id=${SID} owner=A no JWT -> refusal`, async () => {
      const r = await request(path, null, method); expect(r.statusCode).toBe(path.includes('/copy') || path.includes('/collab/') || path.includes('/decision-records/') ? 401 : refusal); expect(r.payload).not.toContain('"admitted":true');
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
  const real = await businessApp('turn');
  const r = await real.inject({ method: 'POST', url: '/orchestrate/v2/turn', headers: { authorization: `Bearer ${tokenB}` }, payload: spellingPayload('/orchestrate/v2/turn', SID) }); await real.close();
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

// ROUND 3: properties moved from the retired per-route ownership helper.
it("moved preflight property: ALLOW: stored owner null + caller null (guest scenario, anonymous caller)", async () => {
  state.owner = null;
  const r = await request('/orchestrate/v2/turn', null);
  expect(r.statusCode).toBe(200);
  expect(state.writes).not.toHaveBeenCalled();
  expect(r.headers['x-owniso-caller']).toBe('');
 });
it("moved preflight property: ALLOW: stored owner null + caller present (guest scenario, any caller)", async () => {
  state.owner = null;
  const r = await request('/orchestrate/v2/turn', tokenB);
  expect(r.statusCode).toBe(200);
  expect(state.writes).not.toHaveBeenCalled();
  expect(r.headers['x-owniso-caller']).toBe(B);
 });
it("moved preflight property: ALLOW: stored owner present + caller is the owner", async () => {
  state.owner = A;
  const r = await request('/orchestrate/v2/turn', tokenA);
  expect(r.statusCode).toBe(200);
  expect(state.writes).not.toHaveBeenCalled();
  expect(r.headers['x-owniso-caller']).toBe(A);
 });
it("moved preflight property: REFUSE: stored owner present + caller is a DIFFERENT user (cross-tenant)", async () => {
  state.owner = A;
  const r = await request('/orchestrate/v2/turn', tokenB);
  expect(r.statusCode).toBe(422);
  expect(state.writes).not.toHaveBeenCalled();
  expect(r.payload).not.toContain('"admitted":true');
  expect(r.json().details.reason).toBe('scenario_owned_by_other_user');
 });
it("moved preflight property: REFUSE (IDOR fail-closed): stored owner present + caller ABSENT (null)", async () => {
  state.owner = A;
  const r = await request('/orchestrate/v2/turn', null);
  expect(r.statusCode).toBe(422);
  expect(state.writes).not.toHaveBeenCalled();
  expect(r.payload).not.toContain('"admitted":true');
  expect(r.json().details.reason).toBe('scenario_requires_authenticated_owner');
 });
it("moved preflight property: POSITIVE CONTROL: a healthy oracle on a guest scenario is OPEN (ok:true)", async () => {
  state.owner = null;
  const r = await request('/orchestrate/v2/turn', null);
  expect(r.statusCode).toBe(200);
  expect(state.writes).not.toHaveBeenCalled();
  expect(r.headers['x-owniso-caller']).toBe('');
 });
it("moved preflight property: POSITIVE CONTROL: the same probe reports ok:true for a store that DOES answer", async () => {
  state.owner = null;
  const r = await request('/orchestrate/v2/turn', null);
  expect(r.statusCode).toBe(200);
  expect(state.writes).not.toHaveBeenCalled();
  expect(r.headers['x-owniso-caller']).toBe('');
 });
it("moved resurrection property: existing owned scenario still refuses anonymous caller", async () => {
 const r = await request('/orchestrate/v2/turn', null);
 expect(r.statusCode).toBe(422); expect(r.json().details.reason).toBe('scenario_requires_authenticated_owner'); expect(state.writes).not.toHaveBeenCalled();
});
it.each([() => tokenA, () => null])('deleted scenario refuses without CREATE and retains recovery copy', async token => {
 state.absent = true; state.admitted = true;
 const real = await businessApp('turn'); const credential = token();
 const r = await real.inject({ method: 'POST', url: '/orchestrate/v2/turn', headers: credential ? { authorization: `Bearer ${credential}` } : {}, payload: spellingPayload('/orchestrate/v2/turn', SID) }); await real.close();
 const { SCENARIO_DELETED_RECOVERY_BODY } = await import('../orchestrator/route-v2-preflight.js');
 expect(r.statusCode).toBe(422); expect(r.json().details).toEqual({ reason: 'scenario_deleted', scenario_id: SID, recovery: SCENARIO_DELETED_RECOVERY_BODY, recovery_suggestion: SCENARIO_DELETED_RECOVERY_BODY.suggestion }); expect(state.writes).not.toHaveBeenCalled();
});
it('copy ownership-reader outage retains exact copy_unavailable 503 bytes', async () => {
 state.oracleThrows = true; const r = await request('/assist/v1/scenarios/:scenario_id/copy', tokenA); expect(r.statusCode).toBe(503); expect(normalise(r.payload)).toBe(JSON.stringify({ error: 'copy_unavailable', code: 'copy_unavailable', message: 'Your decision could not be copied just now. Try again shortly.', request_id: 'row' }));
});

it('ROUND 4: JWT-shaped garbage refuses with the flag off, before any scenario read or CREATE', async () => {
  state.owner = null;
  session.readExistingScenario.mockClear();
  const r = await request('/orchestrate/v2/turn', 'garbage.garbage.garbage');
  expect(r.statusCode).toBe(401);
  expect(r.json().details).toEqual({ reason: 'sign_in_required', code: 'sign_in_required', recoverable: true, auth_reason: 'invalid_token' });
  expect(session.readExistingScenario).not.toHaveBeenCalled();
  expect(state.writes).not.toHaveBeenCalled();
});


// ROUND 5: real business handlers; ES256 verification above is never mocked.
const versions = {
  getCurrentVersionPointer: vi.fn(async () => ({ status: 'ok', value: null })),
  saveVersion: vi.fn(async (input: { scenario_id: string }) => {
    state.writes(input);
    return { status: 'ok', value: { version_id: RID, version_number: 1, graph_identity_hash: 'a'.repeat(64), deduped: false, event_id: 'event-1' } };
  }),
};
vi.mock('../orchestrator-v5/model-management/index.js', async load => {
  const actual = await load<typeof import('../orchestrator-v5/model-management/index.js')>();
  return { ...actual, getModelManagementService: () => versions };
});
const spellingRows = [
  ['graph-readiness', '/assist/v1/graph-readiness', 404, 'assist.v1.graph-readiness'],
  ['collab mint', '/collab/v1/rounds', 403, 'collab.v1.rounds'],
  ['agent turn', '/agent/v1/turn', 404, 'agent-v1-turn'],
  ['graph read', '/assist/v1/scenarios/:scenario_id/graph', 404, 'assist.v1.scenario-graph'],
  ['a turn', '/orchestrate/v2/turn', 422, 'turn'],
  ['versions/save', '/assist/v1/scenarios/:scenario_id/versions/save', 404, 'assist.v1.scenario-versions'],
] as const;
const spellings = [['braces', `{${SID}}`], ['UNHYPHENATED', SID.replaceAll('-', '')], ['UPPER-CASE', SID.toUpperCase()]] as const;
let agentRequestSequence = 0;
function spellingPayload(path: string, rawId: string) {
  if (path === '/orchestrate/v2/turn' || path === '/proxy/v5/turn') return { scenario_id: rawId, turn_id: RID, user_id: A, kind: 'message', message: 'Run analysis', turn_class: 'propose', stage: 'decide', source: 'chip_click', chip: { action_type: 'run_analysis' } };
  return { scenario_id: path.includes(':scenario_id') ? OTHER_SID : rawId, user_id: A, ...(path === '/agent/v1/turn' ? { agent_session_id: `r5-session-${++agentRequestSequence}` } : {}),
    kind: 'message', message: 'What should we consider?', turn_class: 'frame', stage: 'frame', source: 'composer',
    graph: { nodes: [], edges: [] }, include_conversation_turns: true,
    targets: [{ target: { kind: 'factor', id: 'fac_risk' }, label: 'Risk' }], participants: [], label: 'Named version' };
}
async function businessApp(module: string) {
  const real = Fastify(); await ownership(real);
  // Transport seams are test-only; the handler/request field is observed AFTER the real handler ran.
  real.addHook('onSend', async (req, reply, payload) => {
    const id = req.routeOptions.url?.includes(':scenario_id') ? (req.params as { scenario_id: string }).scenario_id : (req.body as { scenario_id?: string })?.scenario_id;
    if (id) reply.header('x-handler-scenario', id);
    reply.header('x-owniso-caller', req.scenarioAccess?.callerUserId ?? '');
    return payload;
  });
  if (module === 'turn') await (await import('../orchestrator/route-v2.js')).ceeOrchestratorRouteV2(real);
  else { const mod = await import(`../routes/${module}.ts`); await (mod.default ?? mod.agentV1TurnRoute ?? mod.proxyV5TurnRoute)(real); }
  if (module === 'agent-v1-turn') {
    // The Agent's state readback still re-enters real graph admission.
    await (await import('../routes/assist.v1.scenario-graph.js')).default(real);
  }
  await real.ready(); return real;
}
function spellingRefusal(name: string, anonymous: boolean) {
  if (name === 'collab mint') return { status: anonymous ? 401 : 403, body: { error: anonymous ? 'sign_in_required' : 'collab_owner_only', code: anonymous ? 'sign_in_required' : 'collab_owner_only', message: anonymous ? 'Opening or closing a round is owner-only: sign in and retry.' : 'Only the scenario owner can open a round on it.', request_id: 'row' } };
  if (name === 'agent turn') return { status: 404, body: { error: 'NOT_FOUND', detail: 'No readable conversation for that scenario.' } };
  if (name === 'a turn') return { status: 422, body: { error: 'INGRESS_CONTRACT_VIOLATION', boundary: 'B1', direction: 'ingress', validator: 'scenario_preflight', details: { reason: anonymous ? 'scenario_requires_authenticated_owner' : 'scenario_owned_by_other_user', scenario_id: SID }, request_id: 'row', retryable: false } };
  return { status: 404, body: { schema: 'error.v1', code: 'NOT_FOUND', message: name === 'versions/save' ? 'No readable versions for that scenario.' : 'No readable graph for that scenario.', request_id: 'row' } };
}
for (const [name, path, , module] of spellingRows) for (const [spelling, rawId] of spellings) {
  for (const caller of ['B', 'no-JWT'] as const) it(`R5 real ${name}: ${caller} ${spelling} refuses exact bytes, no protected read/write`, async () => {
    const real = await businessApp(module);
    try {
      const r = await real.inject({ method: 'POST', url: path.replace(':scenario_id', rawId), headers: { 'x-request-id': 'row', ...(caller === 'B' ? { authorization: `Bearer ${tokenB}` } : {}) }, payload: spellingPayload(path, rawId) });
      const expected = spellingRefusal(name, caller === 'no-JWT');
      expect(r.statusCode).toBe(expected.status); expect(normalise(r.payload)).toBe(JSON.stringify(expected.body));
      expect(session.readRecent).not.toHaveBeenCalled(); expect(session.loadGraphAndBriefText).not.toHaveBeenCalled(); expect(session.loadGraph).not.toHaveBeenCalled();
      expect(collab.createModelVersion).not.toHaveBeenCalled(); expect(collab.insertRound).not.toHaveBeenCalled(); expect(collab.appendRoundEvent).not.toHaveBeenCalled(); expect(versions.saveVersion).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
      if (name !== 'collab mint') expect(session.readExistingScenario).toHaveBeenCalledWith(SID);
    } finally { await real.close(); }
  });
  it(`R5 real ${name}: owner A ${spelling} admitted; handler uses canonical checked id`, async () => {
    const real = await businessApp(module);
    const oldFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Consider the scope of the work.' }] }] }), { status: 200 }));
    try {
      const r = await real.inject({ method: 'POST', url: path.replace(':scenario_id', rawId), headers: { 'x-request-id': 'row', authorization: `Bearer ${tokenA}` }, payload: spellingPayload(path, rawId) });
      expect(r.statusCode, r.payload).toBe(name === 'collab mint' ? 201 : 200); expect(r.headers['x-handler-scenario']).toBe(SID);
      if (name === 'graph-readiness') expect(session.loadGraphAndBriefText).toHaveBeenCalledWith(SID);
      if (name === 'graph read' || name === 'agent turn') expect(session.readRecent).toHaveBeenCalledWith(SID, expect.any(Number));
      if (name === 'collab mint') { expect(collab.createModelVersion).toHaveBeenCalledWith({ scenario_id: SID, provenance: 'elicitation_round_mint' }); expect(collab.insertRound).toHaveBeenCalledWith(expect.objectContaining({ scenario_id: SID, created_by: A })); }
      if (name === 'versions/save') expect(versions.saveVersion).toHaveBeenCalledWith(expect.objectContaining({ scenario_id: SID }));
    } finally { globalThis.fetch = oldFetch; await real.close(); }
  });
}
it('R5 P2: proxy missing Origin with fresh UUID returns exact 403 and creates no row', async () => {
  state.absent = true; const real = await businessApp('proxy-v5-turn');
  try { const r = await real.inject({ method: 'POST', url: '/proxy/v5/turn', headers: { 'x-request-id': 'row' }, payload: spellingPayload('/proxy/v5/turn', SID) }); expect(r.statusCode).toBe(403); expect(r.json()).toEqual({ error: { code: 'PROXY_ORIGIN_REJECTED', message: 'Origin not allowed', source: 'proxy', request_id: 'row' } }); expect(state.writes).not.toHaveBeenCalled(); expect(state.absent).toBe(true); } finally { await real.close(); }
});
it('R5 P2: fresh agent with malformed turn_id returns exact 422 and creates no row', async () => {
  state.absent = true; const real = await businessApp('agent-v1-turn');
  try { const r = await real.inject({ method: 'POST', url: '/agent/v1/turn', headers: { authorization: `Bearer ${tokenA}` }, payload: { scenario_id: SID, message: 'Explore this', turn_id: 'bad-turn-id' } }); expect(r.statusCode).toBe(422); expect(r.json()).toEqual({ error: 'BAD_INPUT', detail: '`turn_id` must be a UUID when supplied.' }); expect(state.writes).not.toHaveBeenCalled(); expect(state.absent).toBe(true); } finally { await real.close(); }
});
it('R5 P2: unknown readiness uses request_graph, guest uses persisted, other owner refuses', async () => {
  const real = await businessApp('assist.v1.graph-readiness');
  try {
    state.absent = true; const missing = await real.inject({ method: 'POST', url: '/assist/v1/graph-readiness', payload: { scenario_id: SID, graph: { nodes: [], edges: [] } } });
    expect(missing.statusCode).toBe(200); expect(missing.json().assessed_from).toBe('request_graph'); expect(state.writes).not.toHaveBeenCalled(); expect(state.absent).toBe(true);
    state.absent = false; state.owner = null; state.persisted = true; const guest = await real.inject({ method: 'POST', url: '/assist/v1/graph-readiness', payload: { scenario_id: SID, graph: { nodes: [], edges: [] } } }); expect(guest.statusCode).toBe(200); expect(guest.json().assessed_from).toBe('persisted');
    state.owner = A; const denied = await real.inject({ method: 'POST', url: '/assist/v1/graph-readiness', headers: { authorization: `Bearer ${tokenB}` }, payload: { scenario_id: SID, graph: { nodes: [], edges: [] } } }); expect(denied.statusCode).toBe(404); expect(state.writes).not.toHaveBeenCalled();
  } finally { await real.close(); }
});

it.each([
  ` ${SID} `, `{${SID}}`, SID.replaceAll('-', ''), SID.toUpperCase(),
  'cccc-cccc-cccc-4ccc-8ccc-cccc-cccc-cccc', '{cccccccc-cccc4ccc-8ccccccc-cccccccc}',
])('R5 canonicaliser maps PostgreSQL UUID spelling %s to S', async raw => {
  const { canonicalScenarioId } = await import('../plugins/scenario-ownership.js'); expect(canonicalScenarioId(raw)).toBe(SID);
});
it.each(['not-a-uuid', `{${SID}`, `${SID}}`, `{{${SID}}}`, SID + 'f', 'g'.repeat(32), '', '   '])('R5 canonicaliser rejects non-canonicalisable %s', async raw => {
  const { canonicalScenarioId } = await import('../plugins/scenario-ownership.js'); expect(canonicalScenarioId(raw)).toBe(null);
});
for (const [method, path] of routes) it(`R5 malformed id: ${method} ${path} cannot select data or write`, async () => {
  const real = Fastify(); await ownership(real); await mount(real); await real.ready();
  try {
    const url = pathname(path).replace(SID, 'not-a-uuid');
    const r = await real.inject({ method, url, headers: { 'x-request-id': 'row', authorization: `Bearer ${tokenB}`, origin: 'https://staging--olumi.netlify.app' }, ...(method === 'POST' ? { payload: { ...spellingPayload(path, 'not-a-uuid'), turn_id: RID, scenario_id: 'not-a-uuid' } } : {}) });
    expect(session.readRecent).not.toHaveBeenCalled(); expect(session.loadGraphAndBriefText).not.toHaveBeenCalled(); expect(session.loadGraph).not.toHaveBeenCalled(); expect(collab.createModelVersion).not.toHaveBeenCalled(); expect(versions.saveVersion).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
    const cache = await import('../services/session-cache.js'); expect(cache.retrieveSession).not.toHaveBeenCalled(); expect(cache.appendTurn).not.toHaveBeenCalled();
    if (path.includes(':round_id') || path.includes(':record_id')) expect(r.statusCode).toBe(403); // The malformed shadow body id has no authority over a derived entity.
    else if (path.endsWith('/stream')) { expect(r.statusCode).toBe(200); expect(r.payload).toContain('INGRESS_CONTRACT_VIOLATION'); }
    else expect(r.statusCode).toBe(path === '/collab/v1/rounds' || path.includes('/decision-records') ? 400 : path === '/orchestrate/v2/turn' || path === '/proxy/v5/turn' ? 422 : 404);
  } finally { await real.close(); }
});
it('R5 central denial emits exactly one ownership-refusal event without credentials', async () => {
  const { log } = await import('../utils/telemetry.js'); await request('/assist/v1/graph-readiness', tokenB);
  const denied = vi.mocked(log.warn).mock.calls.filter(c => (c[0] as { event?: string })?.event === 'scenario_ownership.refused');
  expect(denied).toHaveLength(1); expect(denied[0][0]).toMatchObject({ event: 'scenario_ownership.refused', route_family: '/assist/v1/graph-readiness', reason: 'scenario_owned_by_other_user', scenario_id_prefix: SID.slice(0, 8) }); expect(JSON.stringify(denied)).not.toContain(tokenB); expect(JSON.stringify(denied)).not.toContain(SID);
});

it.each([() => tokenB, () => null])('R5 CREATE race: the RPC returns owner A; another caller refuses before business reads/writes', async token => {
  state.absent = true; session.ensureScenarioExists.mockResolvedValueOnce({ user_id: A });
  const real = await businessApp('turn');
  try {
    const credential = token(); const r = await real.inject({ method: 'POST', url: '/orchestrate/v2/turn', headers: { 'x-request-id': 'row', ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, payload: spellingPayload('/orchestrate/v2/turn', SID) });
    const expected = spellingRefusal('a turn', credential === null); expect(r.statusCode).toBe(422); expect(normalise(r.payload)).toBe(JSON.stringify(expected.body)); expect(session.ensureScenarioExists).toHaveBeenCalledWith(SID, credential ? B : null); expect(session.readRecent).not.toHaveBeenCalled(); expect(session.loadGraph).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
  } finally { await real.close(); }
});
it('R5 malformed ask id with otherwise valid payload refuses before the session cache', async () => {
  const real = await businessApp('assist.v1.ask'); const graph = { nodes: [], edges: [] };
  try {
    const r = await real.inject({ method: 'POST', url: '/assist/v1/ask', headers: { 'x-request-id': 'row', authorization: `Bearer ${tokenB}` }, payload: { scenario_id: 'not-a-uuid', message: 'What matters?', graph_snapshot: graph, graph_schema_version: '2.2', brief: 'What should our team explore?', market_context: { id: 'market', version: '1', hash: 'h' } } });
    expect(r.statusCode).toBe(404); expect(normalise(r.payload)).toBe(JSON.stringify({ schema: 'error.v1', code: 'NOT_FOUND', message: 'No readable graph for that scenario.', request_id: 'row' }));
    const cache = await import('../services/session-cache.js'); expect(cache.retrieveSession).not.toHaveBeenCalled(); expect(cache.appendTurn).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
  } finally { await real.close(); }
});


const malformedSeparators = [
  ['leading hyphen', `-${SID}`],
  ['trailing hyphen', `${SID}-`],
  ['doubled hyphen', SID.replace('-', '--')],
  ['hyphen after three digits', `ccc-ccccc-cccc-4ccc-8ccc-cccccccccccc`],
] as const;
it.each(malformedSeparators)('F1 canonicaliser rejects %s', async (_name, raw) => {
  const { canonicalScenarioId } = await import('../plugins/scenario-ownership.js');
  expect(canonicalScenarioId(raw)).toBeNull();
});
for (const [name, raw] of malformedSeparators) {
  it.each([
    ['/agent/v1/turn', 'agent-v1-turn'],
    ['/assist/v1/graph-readiness', 'assist.v1.graph-readiness'],
  ])(`F1 real handler %s rejects ${name} with exact bytes and no store read`, async (path, module) => {
    const real = await businessApp(module);
    try {
      const r = await real.inject({ method: 'POST', url: path,
        headers: { 'x-request-id': 'row', authorization: `Bearer ${tokenA}` },
        payload: { ...spellingPayload(path, raw), turn_id: RID } });
      expect(r.statusCode).toBe(404);
      expect(r.payload).toBe(JSON.stringify(spellingRefusal(path === '/agent/v1/turn' ? 'agent turn' : 'graph-readiness', false).body));
      expect(session.readExistingScenario).not.toHaveBeenCalled();
      expect(session.getScenarioOwner).not.toHaveBeenCalled();
      expect(session.scenarioExists).not.toHaveBeenCalled();
      expect(session.readRecent).not.toHaveBeenCalled();
      expect(session.loadGraphAndBriefText).not.toHaveBeenCalled();
      expect(session.loadGraph).not.toHaveBeenCalled();
      expect(session.ensureScenarioExists).not.toHaveBeenCalled();
      expect(state.writes).not.toHaveBeenCalled();
    } finally { await real.close(); }
  });
}
it('F1 real readiness admits mixed four-digit boundaries and reads the canonical id', async () => {
  const real = await businessApp('assist.v1.graph-readiness');
  try {
    const r = await real.inject({ method: 'POST', url: '/assist/v1/graph-readiness',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { scenario_id: '{cccccccc-cccc4ccc-8ccccccc-cccccccc}', graph: { nodes: [], edges: [] } } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-handler-scenario']).toBe(SID);
    expect(session.readExistingScenario).toHaveBeenCalledWith(SID);
    expect(session.loadGraphAndBriefText).toHaveBeenCalledWith(SID);
  } finally { await real.close(); }
});

// ID-sensitive durable-row fixture: CREATEs are separate from Agent answer writes.
async function residualAgentRows(run: (real: FastifyInstance, rows: Map<string, string | null>, creates: string[]) => Promise<void>) {
  const rows = new Map<string, string | null>();
  const creates: string[] = [];
  const turns = new Map<string, import('../orchestrator-v5/session/store.js').CommittedTurnRecord>();
  const store = (await import('../orchestrator-v5/session/index.js')).getSessionStore();
  const readTurn = store.readCommittedTurn;
  const append = store.append;
  store.readCommittedTurn = async (id, turnId) => turns.get(`${id}:${turnId}`) ?? null;
  store.append = async write => {
    const key = `${write.scenario_id}:${write.turn_id}`;
    if (!turns.has(key)) turns.set(key, { id: key, request_hash: write.request_hash,
      assistant_message: write.assistantMessage ?? null, user_message: write.userMessage ?? null, llm_calls_used: write.llm_calls_used });
    state.writes(write);
    return { id: key };
  };
  const readOwner = session.getScenarioOwner.getMockImplementation()!;
  // Admission and the writer door read the same authoritative fixture row.
  session.getScenarioOwner.mockImplementation(async id => rows.get(id) ?? null);
  const read = session.readExistingScenario.getMockImplementation()!;
  const ensure = session.ensureScenarioExists.getMockImplementation()!;
  session.readExistingScenario.mockImplementation(async id => rows.has(id)
    ? { userId: rows.get(id)!, graph: null, briefText: null, analysisInvalidatedAt: null } : null);
  session.ensureScenarioExists.mockImplementation(async (id, caller) => {
    if (!rows.has(id)) { creates.push(id); rows.set(id, caller); }
    return { user_id: rows.get(id)! };
  });
  const real = await businessApp('agent-v1-turn');
  try { await run(real, rows, creates); }
  finally {
    await real.close(); session.readExistingScenario.mockImplementation(read); session.ensureScenarioExists.mockImplementation(ensure);
    session.getScenarioOwner.mockImplementation(readOwner);
    store.append = append; store.readCommittedTurn = readTurn;
  }
}
function residualAgentRequest(real: FastifyInstance, scenarioId: string, sessionId: string, token = tokenA) {
  return real.inject({ method: 'POST', url: '/agent/v1/turn', headers: { authorization: `Bearer ${token}` },
    payload: { scenario_id: scenarioId, agent_session_id: sessionId, message: 'What should we consider?', turn_id: RID } });
}
it.each(['scenario', 'user'] as const)('F2a refused session bound to another %s creates no fresh Y row', async mismatch => {
  await residualAgentRows(async (real, rows, creates) => {
    const sessionId = `f2-refused-${++agentRequestSequence}`;
    rows.set(SID, mismatch === 'user' ? B : A);
    const bound = await residualAgentRequest(real, SID, sessionId, mismatch === 'user' ? tokenB : tokenA);
    expect(bound.statusCode, bound.payload).toBe(200);
    expect(creates).toEqual([]);
    const denied = await residualAgentRequest(real, OTHER_SID, sessionId);
    expect(denied.statusCode).toBe(404);
    expect(denied.payload).toBe('{"error":"NOT_FOUND","detail":"No readable conversation for that scenario."}');
    expect(creates).toEqual([]);
    expect(rows.has(OTHER_SID)).toBe(false);
    expect(session.ensureScenarioExists).not.toHaveBeenCalled();
  });
});
it('F2b CONTRAST fresh session and fresh Y provisions exactly once, then binds', async () => {
  await residualAgentRows(async (real, rows, creates) => {
    const { SessionBindingRegistry } = await import('../orchestrator-v5/agent-lane/session-binding.js');
    const bind = vi.spyOn(SessionBindingRegistry.prototype, 'bind');
    const sessionId = `f2-fresh-${++agentRequestSequence}`;
    try {
      const admitted = await residualAgentRequest(real, OTHER_SID, sessionId);
      expect(admitted.statusCode, admitted.payload).toBe(200);
      expect(creates).toEqual([OTHER_SID]);
      expect(rows.get(OTHER_SID)).toBe(A);
      expect(session.ensureScenarioExists).toHaveBeenCalledExactlyOnceWith(OTHER_SID, A);
      expect(bind).toHaveBeenCalledExactlyOnceWith(sessionId, A, OTHER_SID);
      expect(session.ensureScenarioExists.mock.invocationCallOrder[0]).toBeLessThan(bind.mock.invocationCallOrder[0]);
      // Reuse against X witnesses that Y binding persisted, without mocking check().
      rows.set(SID, A);
      const refused = await residualAgentRequest(real, SID, sessionId);
      expect(refused.statusCode).toBe(404);
      expect(refused.payload).toBe('{"error":"NOT_FOUND","detail":"No readable conversation for that scenario."}');
      expect(creates).toEqual([OTHER_SID]);
    } finally { bind.mockRestore(); }
  });
});
it('F2c matching session and existing Y is admitted with no CREATE', async () => {
  await residualAgentRows(async (real, rows, creates) => {
    rows.set(OTHER_SID, A);
    const sessionId = `f2-matching-${++agentRequestSequence}`;
    const first = await residualAgentRequest(real, OTHER_SID, sessionId);
    expect(first.statusCode, first.payload).toBe(200);
    const { SessionBindingRegistry } = await import('../orchestrator-v5/agent-lane/session-binding.js');
    const bind = vi.spyOn(SessionBindingRegistry.prototype, 'bind');
    try {
      const matching = await residualAgentRequest(real, OTHER_SID, sessionId);
      expect(matching.statusCode, matching.payload).toBe(200);
      expect(creates).toEqual([]);
      expect(session.ensureScenarioExists).not.toHaveBeenCalled();
      expect(bind).not.toHaveBeenCalled();
    } finally { bind.mockRestore(); }
  });
});
