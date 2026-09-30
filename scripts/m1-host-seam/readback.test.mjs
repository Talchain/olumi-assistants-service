import { test } from 'vitest';
import assert from 'node:assert/strict';
import { bindingOf, readback, cardsAllowed, sameModel, READBACK_SCHEMA } from './readback.mjs';

const ID = 'a'.repeat(64);
const graphRead = (over = {}) => ({ http: 200, json: {
  graph_present: true, graph: { nodes: [{ id: 'goal' }], edges: [] }, brief_text: 'the brief',
  graph_identity_hash: { kind: 'graph_identity', value: ID, algorithm: 'sha256', projection_version: 'identity.v1' },
  graph_hash: '2170a48bef12f588', ...over } });
const versionsRead = (versions, current = versions[0]?.version_id ?? null) => ({ http: 200, json: {
  schema: 'model_versions_list.v2', versions, current_version_id: current } });
const V1 = { version_id: 'v-1', sequence: 1, full_hash: ID, analysis_affecting_hash: 'b'.repeat(64) };

test('bound: the current version carries the graph identity', () => {
  const r = bindingOf({ graphRead: graphRead(), versionsRead: versionsRead([V1]), signedIn: true });
  assert.equal(r.version_binding, 'bound');
  assert.deepEqual(r.model_version, { ...V1, creation: null });
});

test('served guest (c379bbb3 on 1bfa429): graph present, versions empty → guest_no_version, never bound', () => {
  const r = bindingOf({ graphRead: graphRead(), versionsRead: versionsRead([], null), signedIn: false });
  assert.equal(r.version_binding, 'guest_no_version');
  assert.equal(r.model_version, null);
});

test('signed in but no version → missing (not the guest explanation)', () => {
  assert.equal(bindingOf({ graphRead: graphRead(), versionsRead: versionsRead([], null), signedIn: true }).version_binding, 'missing');
});

test('the current version names another graph → mismatch', () => {
  const r = bindingOf({ graphRead: graphRead(), versionsRead: versionsRead([{ ...V1, full_hash: 'c'.repeat(64) }]), signedIn: true });
  assert.equal(r.version_binding, 'mismatch');
});

test('a version that is not the current one never binds', () => {
  const r = bindingOf({ graphRead: graphRead(), versionsRead: versionsRead([V1], 'v-2'), signedIn: true });
  assert.equal(r.version_binding, 'missing');
});

test('no graph, a refused read, or no identity hash → missing', () => {
  for (const g of [graphRead({ graph_present: false }), { http: 404, json: null }, graphRead({ graph_identity_hash: null })]) {
    assert.equal(bindingOf({ graphRead: g, versionsRead: versionsRead([V1]), signedIn: true }).version_binding, 'missing');
  }
});

function fakeFetch(routes, seen) {
  return async (url, init = {}) => {
    seen.push({ url, headers: init.headers ?? {} });
    const path = new URL(url).pathname;
    const hit = routes[path];
    if (!hit) throw new Error(`unexpected ${path}`);
    return { status: hit.http, text: async () => JSON.stringify(hit.json), json: async () => hit.json };
  };
}

test('readback: the object the Lab consumes, with the bearer sent only when given and never returned', async () => {
  const sid = '11111111-1111-4111-8111-111111111111';
  const routes = {
    '/healthz': { http: 200, json: { build: '147c0ce' } },
    [`/assist/v1/scenarios/${sid}/graph`]: graphRead(),
    [`/assist/v1/scenarios/${sid}/versions`]: versionsRead([V1]),
  };
  const seen = [];
  const secret = 'jwt-secret-value-must-not-leak';
  const rb = await readback({ base: 'https://cee.example/', assistKey: 'k', bearer: secret, scenarioId: sid, fetchImpl: fakeFetch(routes, seen) });
  assert.equal(rb.schema, READBACK_SCHEMA);
  assert.equal(rb.cee_build, '147c0ce');
  assert.equal(rb.brief_text, 'the brief');
  assert.equal(rb.graph_identity_hash.value, ID);
  assert.equal(rb.version_binding, 'bound');
  assert.equal(cardsAllowed(rb), true);
  assert.ok(!JSON.stringify(rb).includes(secret));
  assert.equal(seen.filter((s) => s.headers.authorization === `Bearer ${secret}`).length, 2);

  const guestSeen = [];
  const guest = await readback({ base: 'https://cee.example', assistKey: 'k', scenarioId: sid,
    fetchImpl: fakeFetch({ ...routes, [`/assist/v1/scenarios/${sid}/versions`]: versionsRead([], null) }, guestSeen) });
  assert.equal(guest.version_binding, 'guest_no_version');
  assert.equal(cardsAllowed(guest), false);
  assert.equal(guestSeen.some((s) => 'authorization' in s.headers), false);
});

test('sameModel: a new version or a new graph between reads is a different model', () => {
  const a = { schema: READBACK_SCHEMA, scenario_id: 's', version_binding: 'bound', graph_identity_hash: { value: ID }, model_version: V1 };
  assert.equal(sameModel(a, { ...a }), true);
  assert.equal(sameModel(a, { ...a, model_version: { ...V1, version_id: 'v-2' } }), false);
  assert.equal(sameModel(a, { ...a, graph_identity_hash: { value: 'd'.repeat(64) } }), false);
  assert.equal(sameModel(a, { ...a, version_binding: 'guest_no_version' }), false);
});

test('withheldReason: every non-bound model says why; a bound model says nothing', async () => {
  const { withheldReason } = await import('./readback.mjs');
  const base = { schema: READBACK_SCHEMA, scenario_id: 's', graph_identity_hash: { value: ID }, model_version: V1 };
  assert.equal(withheldReason({ ...base, version_binding: 'bound' }), null);
  for (const b of ['guest_no_version', 'mismatch', 'missing']) {
    const said = withheldReason({ ...base, version_binding: b });
    assert.match(said, /^Not shown: /, b);
  }
  assert.match(withheldReason({ ...base, version_binding: 'guest_no_version' }), /not tied to a saved version/);
  assert.match(withheldReason({ ...base, version_binding: 'mismatch' }), /different model/);
  assert.match(withheldReason(null), /not tied to a saved version/);
});

test('constructionSourceTurnId equals the product rule (registrationTurnId ∘ constructionOperationId) — drift pin', async () => {
  const { constructionSourceTurnId } = await import('./readback.mjs');
  const { constructionOperationId } = await import('../../src/orchestrator-v5/agent-lane/runtime/build-model.ts');
  const { registrationTurnId } = await import('../../src/orchestrator-v5/graph-registration/registration-identity.ts');
  for (const [sid, brief] of [['b52e5c53-2ff4-4b31-bf74-9ac581c70e55', 'Our Pro plan is £49 per month.'], ['s', ''], ['x', 'ünïcödé — "quotes"\nnew line']]) {
    assert.equal(constructionSourceTurnId(sid, brief), registrationTurnId(sid, constructionOperationId(sid, brief)));
  }
  assert.notEqual(constructionSourceTurnId('s', 'a'), constructionSourceTurnId('s', 'b'));
}, 120000);

test('readback names the construction version and whether it is still current; raw payloads kept', async () => {
  const { constructionSourceTurnId } = await import('./readback.mjs');
  const sid = '22222222-2222-4222-8222-222222222222';
  const stid = constructionSourceTurnId(sid, 'the brief');
  const built = { ...V1, creation: { kind: 'initial', mutation_id: 'm', source_turn_id: stid } };
  const later = { version_id: 'v-2', sequence: 2, full_hash: ID, analysis_affecting_hash: 'e'.repeat(64), creation: { kind: 'committed_mutation', source_turn_id: 'other' } };
  const routes = (vs, cur) => ({
    '/healthz': { http: 200, json: { build: 'x' } },
    [`/assist/v1/scenarios/${sid}/graph`]: graphRead(),
    [`/assist/v1/scenarios/${sid}/versions`]: versionsRead(vs, cur),
  });
  const a = await readback({ base: 'https://c', assistKey: 'k', bearer: 't', scenarioId: sid, fetchImpl: fakeFetch(routes([built], 'v-1'), []) });
  assert.deepEqual(a.construction, { source_turn_id: stid, version_id: 'v-1', sequence: 1, is_current: true });
  assert.equal(a.raw.versions.versions.length, 1);
  assert.equal(a.raw.graph_read.brief_text, 'the brief');
  const b = await readback({ base: 'https://c', assistKey: 'k', bearer: 't', scenarioId: sid, fetchImpl: fakeFetch(routes([later, built], 'v-2'), []) });
  assert.equal(b.construction.version_id, 'v-1');
  assert.equal(b.construction.is_current, false);
  assert.equal(b.model_version.version_id, 'v-2');
});

test('accountTokenSource signs in once, reuses the token, and signs in again under 5 minutes left', async () => {
  const { accountTokenSource, parseAccountFile } = await import('./readback.mjs');
  const account = parseAccountFile('LAB_SUPABASE_URL=https://p.supabase.co/\nLAB_SUPABASE_ANON_KEY=anon\nLAB_EMAIL=e@x.test\nLAB_PASSWORD=pw\n');
  let calls = 0, t = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://p.supabase.co/auth/v1/token?grant_type=password');
    assert.equal(init.headers.apikey, 'anon');
    return { status: 200, json: async () => ({ access_token: `tok-${calls}`, expires_in: 3600 }) };
  };
  const token = accountTokenSource(account, { fetchImpl, now: () => t });
  assert.equal(await token(), 'tok-1');
  t = 50 * 60_000; assert.equal(await token(), 'tok-1');
  t = 56 * 60_000; assert.equal(await token(), 'tok-2');
  assert.equal(calls, 2);
  const refused = accountTokenSource(account, { fetchImpl: async () => ({ status: 400, json: async () => ({}) }) });
  await assert.rejects(refused(), /sign-in failed \(HTTP 400\)/);
  assert.throws(() => parseAccountFile('LAB_EMAIL=e'), /missing LAB_SUPABASE_URL/);
});

test('an async token source is resolved per call and sent as the bearer', async () => {
  const sid = '33333333-3333-4333-8333-333333333333';
  const seen = [];
  let n = 0;
  const rb = await readback({ base: 'https://c', assistKey: 'k', bearer: async () => `t${++n}`, scenarioId: sid,
    fetchImpl: fakeFetch({ '/healthz': { http: 200, json: {} }, [`/assist/v1/scenarios/${sid}/graph`]: graphRead(),
      [`/assist/v1/scenarios/${sid}/versions`]: versionsRead([V1]) }, seen) });
  assert.equal(rb.version_binding, 'bound');
  assert.deepEqual(seen.filter((s) => s.headers.authorization).map((s) => s.headers.authorization), ['Bearer t1', 'Bearer t2']);
});

test('a read retries once on a network error; an HTTP refusal is never retried; the turn is never retried', async () => {
  const { sendTurn } = await import('./readback.mjs');
  const sid = '44444444-4444-4444-8444-444444444444';
  const counts = {};
  let failGraphOnce = true;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    counts[path] = (counts[path] ?? 0) + 1;
    if (path.endsWith('/graph') && failGraphOnce) { failGraphOnce = false; throw new TypeError('fetch failed'); }
    if (path === '/agent/v1/turn') throw new TypeError('fetch failed');
    const body = path === '/healthz' ? {} : path.endsWith('/graph') ? graphRead().json : { schema: 'model_versions_list.v2', versions: [], current_version_id: null };
    const status = path.endsWith('/versions') ? 403 : 200;
    return { status, text: async () => JSON.stringify(body), json: async () => body };
  };
  const rb = await readback({ base: 'https://c', assistKey: 'k', bearer: 't', scenarioId: sid, fetchImpl });
  assert.equal(counts[`/assist/v1/scenarios/${sid}/graph`], 2);
  assert.equal(counts[`/assist/v1/scenarios/${sid}/versions`], 1);
  assert.equal(rb.version_binding, 'missing');
  await assert.rejects(sendTurn({ base: 'https://c', assistKey: 'k', scenarioId: sid, message: 'm', fetchImpl }), /fetch failed/);
  assert.equal(counts['/agent/v1/turn'], 1);
});

test('editedSinceConstruction reads the served history: later current version ⇒ edited; else not', async () => {
  const { editedSinceConstruction } = await import('./readback.mjs');
  const rb = (cons, cur) => ({ construction: cons, model_version: cur });
  assert.equal(editedSinceConstruction(rb({ version_id: 'v1', sequence: 1, is_current: true }, { version_id: 'v1', sequence: 1 })), false);
  assert.equal(editedSinceConstruction(rb({ version_id: 'v1', sequence: 1, is_current: false }, { version_id: 'v2', sequence: 2 })), true);
  // construction not found in history (a brief the Agent did not build): never "edited" — the first M2 must bind the construction
  assert.equal(editedSinceConstruction(rb({ version_id: null, sequence: null, is_current: false }, { version_id: 'v2', sequence: 2 })), false);
  assert.equal(editedSinceConstruction(rb({ version_id: 'v1', sequence: 1 }, null)), false);
  assert.equal(editedSinceConstruction(null), false);
});

test('sendTurn carries a chip press as the served UI does ({ chip } beside the message) and returns the offered chips', async () => {
  const { sendTurn } = await import('./readback.mjs');
  const bodies = [];
  const offeredChips = [{ id: 'agent-approve-proposal:prop_abc123', label: 'Set Paying subscribers to 1600' }];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const json = { assistant_message: 'ok', suggested_actions: offeredChips };
    return { status: 200, text: async () => JSON.stringify(json), json: async () => json };
  };
  const pressed = await sendTurn({ base: 'https://c', assistKey: 'k', scenarioId: 's', message: 'Set Paying subscribers to 1600',
    chip: { id: 'agent-approve-proposal:prop_abc123' }, fetchImpl });
  assert.deepEqual(bodies[0].chip, { id: 'agent-approve-proposal:prop_abc123' });
  assert.equal(bodies[0].kind, 'message');
  assert.deepEqual(pressed.suggested_actions, offeredChips);
  await sendTurn({ base: 'https://c', assistKey: 'k', scenarioId: 's', message: 'hi', fetchImpl });
  assert.equal('chip' in bodies[1], false);
});
