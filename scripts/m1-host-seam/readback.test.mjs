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
  assert.deepEqual(r.model_version, V1);
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
