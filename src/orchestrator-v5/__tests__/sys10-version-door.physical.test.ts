import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { ModelManagementService } from '../model-management/service.js';
import { SupabaseModelVersionStore } from '../model-management/store-adapter.js';
import { bindWriteCaller, ModelWriteOwnershipRefused } from '../ownership/door-ownership.js';
import { PersistedGraphInvariantError } from '../persisted-graph-invariants.js';
import { BASE_GRAPH, FIX_OWNER, FIX_SCENARIO, FIX_VERSION_ID, versionRecord } from '../model-management/__tests__/fixtures.js';
import { storageFixture, captureResult, MUTATION, type Op, type Mode } from './sys10-version-storage.fixture.js';
import { BASELINE, BYPASS_EXEMPTIONS, requireOnlyExemptedWrites } from '../../../scripts/census/model-writer-exemptions.mjs';
import scenarioVersionsRoute from '../../routes/assist.v1.scenario-versions.js';
import { commitModelChange } from '../persist-graph-write.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { raiseRefHighWaterForRestore } from '../graph/entity-refs.js';
import { receiptGraphIssues } from '../model-management/mutation-receipt.js';
import { modelVersionDoorOutcome } from '../../../tests/utils/model-version-door-outcome.js';

// Only singleton storage wiring is replaced. Both classes and the route/door are real.
const runtime = vi.hoisted(() => ({ current: null as any }));
vi.mock('../model-management/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../model-management/index.js')>(),
  getModelManagementService: () => runtime.current.service,
}));
vi.mock('../session/index.js', () => ({ getSessionStore: () => runtime.current.reader }));

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BASE = 'b8ca7448e';
const temp = mkdtempSync(join(tmpdir(), 'sys10-version-door-'));
const original: Record<string, any> = {};
let measured: any;
function service(h: ReturnType<typeof storageFixture>) {
  return new ModelManagementService({ store: new SupabaseModelVersionStore(h.client), isEnabled: () => true, eventSink: h.sink });
}
function call(s: ModelManagementService, op: Op, request: any) {
  return bindWriteCaller({ userId: FIX_OWNER, verified: true }, () => op === 'A' ? s.saveVersion(request) : s.restoreVersionAtomic(request));
}
function routeApp() {
  const app = Fastify();
  // Match src/plugins/scenario-ownership.ts:312's request-lifecycle binding. Binding
  // outside inject cannot cross Fastify's request AsyncResource boundary.
  app.addHook('preHandler', (req, _reply, done) =>
    bindWriteCaller({ userId: FIX_OWNER, verified: true }, done, req));
  return app;
}
const cases: Array<[Op, Mode]> = [
  ['A', 'success'], ['A', 'userSave'], ['A', 'dedupe'], ['A', 'fail'], ['A', 'throw'], ['A', 'conflict'],
  ['B', 'success'], ['B', 'replay'], ['B', 'fail'], ['B', 'throw'], ['B', 'conflict'], ['B', 'missing'], ['B', 'reuse'],
];

beforeAll(() => {
  // Original base source fixtures (imports relocated only) work in shallow CI.
  // Both original classes run with exactly the same storage transport script used below.
  const adapter = fileURLToPath(new URL('./fixtures/sys10-version-door-pre-migration-store-adapter.ts', import.meta.url));
  const façade = fileURLToPath(new URL('./fixtures/sys10-version-door-pre-migration-service.ts', import.meta.url));
  const driver = join(temp, 'capture.mts');
  writeFileSync(driver, `
    import { ModelManagementService } from ${JSON.stringify(façade)};
    import { SupabaseModelVersionStore } from ${JSON.stringify(adapter)};
    import { storageFixture, captureResult } from ${JSON.stringify(join(ROOT, 'src/orchestrator-v5/__tests__/sys10-version-storage.fixture.ts'))};
    const captures = {};
    for (const [op, mode] of ${JSON.stringify(cases)}) {
      const h = storageFixture(op, mode);
      const s = new ModelManagementService({ store: new SupabaseModelVersionStore(h.client), isEnabled: () => true, eventSink: h.sink });
      const result = op === 'A' ? await s.saveVersion(h.request) : await s.restoreVersionAtomic(h.request);
      captures[op + ':' + mode] = captureResult(h, result);
    }
    console.log('SYS10_CAPTURE ' + JSON.stringify(captures));
  `);
  const output = execFileSync(process.execPath, ['--import', 'tsx', driver], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  const capture = output.split('\n').find(line => line.startsWith('SYS10_CAPTURE '));
  if (!capture) throw new Error('Pre-migration capture was not produced');
  Object.assign(original, JSON.parse(capture.slice('SYS10_CAPTURE '.length)));
  const capturePath = new URL('./fixtures/sys10-version-door-captures.json', import.meta.url);
  const captures = JSON.stringify({ base: BASE, cases: original }, null, 2) + '\n';
  // The committed original capture is read-only and must agree with base execution.
  expect(readFileSync(capturePath, 'utf8')).toBe(captures);
  measured = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'scripts/census/model-writer-census.mjs')],
    { cwd: ROOT, encoding: 'utf8', timeout: 120_000 }));
}, 120_000);

describe('SYS10 real door → real service → real adapter; storage transport double only', () => {
  it.each(cases)('%s %s: exact pre-migration RPC bytes, result, event and visible fixture state', async (op, mode) => {
    const h = storageFixture(op, mode);
    const result = await call(service(h), op, h.request);
    expect(captureResult(h, result)).toEqual(original[`${op}:${mode}`]);
    for (const event of h.events as Array<{ occurred_at_iso: string }>) expect(Number.isFinite(Date.parse(event.occurred_at_iso))).toBe(true);
    expect(h.reads.some(r => r.table === 'scenarios' && r.columns === 'user_id')).toBe(true);
  });

  it.each(['A', 'B'] as const)('%s violating graph: original structural class, no writing RPC', async op => {
    const h = storageFixture(op);
    h.request.graph = { ...BASE_GRAPH, nodes: [...BASE_GRAPH.nodes, BASE_GRAPH.nodes[0]] };
    const before = structuredClone(h.state);
    await expect(call(service(h), op, h.request)).rejects.toBeInstanceOf(PersistedGraphInvariantError);
    expect(h.calls).toEqual([]); expect(h.state).toEqual(before); expect(h.events).toEqual([]);
  });

  it.each(['A', 'B'] as const)('%s non-owner/anonymous writes are refused before any RPC', async op => {
    for (const caller of [{ userId: 'other-owner', verified: true }, { userId: null, verified: false }]) {
      const h = storageFixture(op);
      const before = structuredClone(h.state);
      await expect(bindWriteCaller(caller, () => op === 'A' ? service(h).saveVersion(h.request) : service(h).restoreVersionAtomic(h.request)))
        .rejects.toBeInstanceOf(ModelWriteOwnershipRefused);
      expect(h.calls).toEqual([]); expect(h.state).toEqual(before);
    }
  });

  it.each(['A', 'B'] as const)('%s guest version history: real service and route outcome seam preserve sign-in-required/401 without a writing RPC', async op => {
    const h = storageFixture(op); h.state.owner = null;
    const result = await call(service(h), op, h.request);
    expect(result).toMatchObject({ status: 'error', error: { code: 'sign_in_required', recoverable: true } });
    const store = new SupabaseModelVersionStore(h.client);
    const seam = await bindWriteCaller({ userId: FIX_OWNER, verified: true }, () => modelVersionDoorOutcome(() =>
      op === 'A' ? commitModelChange({ operation: 'SAVE_VERSION', store, write: h.request })
        : commitModelChange({ operation: 'RESTORE_VERSION', store, write: h.request })));
    expect(seam).toEqual(result);
    // The exact helper used by the existing route outcome-spy tests equals the
    // real service result; the real service/adapter then witnesses its HTTP map.
    runtime.current = { service: service(h), reader: {
      scenarioExists: async () => true,
      readExistingScenario: async () => ({ graph: h.state.graph, revision: h.state.revision }),
    } };
    const app = routeApp();
    try {
      await app.register(scenarioVersionsRoute);
      const response = await app.inject({ method: 'POST',
        url: `/assist/v1/scenarios/${FIX_SCENARIO}/versions/${op === 'A' ? 'save' : 'restore'}`,
        payload: op === 'A' ? {} : { version_id: FIX_VERSION_ID, mutation_id: MUTATION, expected_graph_identity_hash: null },
      });
      expect(response.statusCode, response.body).toBe(401);
      expect(response.json().details.code).toBe('SIGN_IN_REQUIRED');
    } finally { await app.close(); }
    expect(h.calls).toEqual([]); expect(h.events).toEqual([]);
  });

  it.each(['A', 'B'] as const)('%s one RPC rejects while two requests keep the original revision/head (transport witness)', async op => {
    const h = storageFixture(op); h.plan.splice(0, h.plan.length, 'success', 'conflict');
    const s = service(h);
    const outcomes = await Promise.all([call(s, op, h.request), call(s, op, h.request)]);
    expect(outcomes.filter(r => r.status === 'ok')).toHaveLength(1);
    expect(outcomes.find(r => r.status === 'conflict')).toEqual(original[`${op}:conflict`].result);
    expect(h.calls.map(c => c.args.p_expected_revision)).toEqual([7, 7]);
    if (op === 'A') expect(h.calls.map(c => c.args.p_expected_head_version_id)).toEqual([null, null]);
    expect(h.events).toHaveLength(1);
    // The conflict was SCRIPTED. This proves propagation, not database serialisation/atomicity.
  });

  it.each(['A', 'B'] as const)('%s storage rejection/throw leaves fixture state unchanged; retry dispatches original bytes', async op => {
    for (const failure of ['fail', 'throw'] as const) {
      const h = storageFixture(op, failure); const before = structuredClone(h.state);
      const s = service(h);
      expect(await call(s, op, h.request)).toEqual(original[`${op}:${failure}`].result);
      expect(h.state).toEqual(before); expect(h.events).toEqual([]);
      h.plan.push('success');
      expect(await call(s, op, h.request)).toEqual(original[`${op}:success`].result);
      expect(h.calls[1].args).toEqual(h.calls[0].args);
    }
  });

  it.each(['A', 'B'] as const)('%s cold adapter reads the scripted version/head through existing readers', async op => {
    const h = storageFixture(op); await call(service(h), op, h.request);
    const cold = service(h);
    const head = await cold.getCurrentVersion(FIX_SCENARIO);
    expect(head).toMatchObject({ status: 'ok', value: { id: h.state.head, graph: h.calls[0].args.p_graph } });
    const listed = await cold.listVersions(FIX_SCENARIO);
    expect(listed.status).toBe('ok');
    if (listed.status === 'ok') expect(listed.value.map(v => v.id)).toEqual(h.state.versions.map(v => v.id));
    if (op === 'B') {
      const receipt = original['B:success'].result.value;
      expect(await cold.getVersion(FIX_SCENARIO, receipt.undo_version_id)).toMatchObject({ status: 'ok', value: { graph: h.current } });
      expect(h.state.graph).toEqual(h.calls[0].args.p_graph);
      expect(h.state.events).toEqual([receipt.event_id]);
    }
  });

  it('B identity-bound return leg admits the held corrupt target; an unbound head cannot grant admission', async () => {
    const dirty = { ...BASE_GRAPH, nodes: [...BASE_GRAPH.nodes, BASE_GRAPH.nodes[0]] };
    const h = storageFixture('B');
    const head = versionRecord(h.current, { provenance: 'restore', parent_version_id: FIX_VERSION_ID });
    h.request.graph = dirty; h.request.restore_head = head;
    await expect(call(service(h), 'B', h.request)).resolves.toMatchObject({ status: 'ok' });
    expect(h.calls[0].args.p_graph).toEqual(dirty);
    const refused = storageFixture('B'); refused.request.graph = dirty;
    refused.request.restore_head = { ...head, graph_identity_hash: 'f'.repeat(64) };
    await expect(call(service(refused), 'B', refused.request)).rejects.toBeInstanceOf(PersistedGraphInvariantError);
    expect(refused.calls).toEqual([]);
  });

  it.each([['A', 'conflict', 409], ['B', 'conflict', 409], ['A', 'fail', 503],
    ['B', 'throw', 503], ['B', 'missing', 404], ['B', 'reuse', 409]] as const)('%s %s retains real route status %s with the real service/adapter', async (op, mode, status) => {
    const h = storageFixture(op, mode);
    runtime.current = { service: service(h), reader: {
      scenarioExists: async () => true,
      readExistingScenario: async () => ({ graph: h.state.graph, revision: h.state.revision }),
    } };
    const app = routeApp();
    try {
      await app.register(scenarioVersionsRoute);
      const response = await app.inject({
        method: 'POST', url: `/assist/v1/scenarios/${FIX_SCENARIO}/versions/${op === 'A' ? 'save' : 'restore'}`,
        payload: op === 'A' ? {} : { version_id: FIX_VERSION_ID, mutation_id: MUTATION, expected_graph_identity_hash: null },
      });
      expect(response.statusCode, response.body).toBe(status);
      expect(h.calls).toHaveLength(1);
    } finally { await app.close(); }
  });

  it.each(['A', 'B'] as const)('%s structural refusal stays 422 in the real route with no writing RPC (B precedes receipt refusal)', async op => {
    const h = storageFixture(op);
    const dirty = { ...h.graph, nodes: [...h.graph.nodes, h.graph.nodes[0]] };
    if (op === 'B') {
      // Also fail the receipt's shape guard, so moving that guard before the
      // structural preflight changes the error code and makes this row RED.
      const unreceiptable = { ...dirty, edges: dirty.edges.map(e => ({ ...e, strength: 0.4 })) };
      const admitted = GraphStateIngressSchema.parse(unreceiptable);
      const projected = raiseRefHighWaterForRestore(projectGraphForPersistence(admitted), h.state.graph);
      expect(receiptGraphIssues(projected).length).toBeGreaterThan(0);
      h.state.versions[0] = versionRecord(unreceiptable);
    }
    if (op === 'A') h.state.graph = dirty;
    runtime.current = { service: service(h), reader: {
      scenarioExists: async () => true,
      readExistingScenario: async () => ({ graph: h.state.graph, revision: h.state.revision }),
    } };
    const app = routeApp();
    try {
      await app.register(scenarioVersionsRoute);
      const response = await app.inject({
        method: 'POST', url: `/assist/v1/scenarios/${FIX_SCENARIO}/versions/${op === 'A' ? 'save' : 'restore'}`,
        payload: op === 'A' ? {} : { version_id: FIX_VERSION_ID, mutation_id: MUTATION, expected_graph_identity_hash: null },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().details.code).toBe('GRAPH_INVARIANT_VIOLATION');
      expect(h.calls).toEqual([]);
    } finally { await app.close(); }
  });

  it('the same shrink-only assertion certifies zero residual bypasses after C', () => {
    expect(BASELINE).toBe(0); expect(BYPASS_EXEMPTIONS).toEqual([]);
    expect(measured.outside_door).toBe(0); expect(measured.diagnostics).toEqual([]);
    requireOnlyExemptedWrites(measured);
    expect(measured.excluded.filter((s: any) => s.reason === 'version adapter reached by door').map((s: any) => s.callee))
      .toEqual(['create_model_version_cas_v1', 'restore_model_version_atomic_cas_v1']);
  });

  it('eight scratch mutants reintroduce a raw RPC/store write at each migrated site and make the production guard RED', () => {
    const prelude = `import type { ModelVersionStorePort, SaveVersionWrite, AtomicRestoreVersionWrite } from ${JSON.stringify(join(ROOT, 'src/orchestrator-v5/model-management/store-adapter.js'))};
      declare const adapter: ModelVersionStorePort; declare const write: SaveVersionWrite; declare const restore: AtomicRestoreVersionWrite;
      declare const client: { rpc(name: string, args: object): void };`;
    const mutants = [
      ['rounds-service-createModelVersion', 'class Store { createModelVersion() { return adapter.saveVersion(write); } } new Store().createModelVersion();'],
      ['collab-store-saveVersion', 'class Service { saveVersion() { return adapter.saveVersion(write); } } new Service().saveVersion();'],
      ['model-service-saveVersion', 'adapter.saveVersion(write);'],
      ['model-service-restoreVersionAtomic', 'adapter.restoreVersionAtomic!(restore);'],
      ['adapter-create_model_version_cas_v1', "client.rpc('create_model_version_cas_v1', { p_graph: write.graph });"],
      ['adapter-restore_model_version_atomic_cas_v1', "client.rpc('restore_model_version_atomic_cas_v1', { p_graph: restore.graph });"],
      ['route-saveVersion', 'class Service { saveVersion() { return adapter.saveVersion(write); } } new Service().saveVersion();'],
      ['route-restoreVersionAtomic', 'class Service { restoreVersionAtomic() { return adapter.restoreVersionAtomic!(restore); } } new Service().restoreVersionAtomic();'],
    ];
    const files = mutants.map(([name, source]) => {
      const file = join(temp, `${name}.ts`); writeFileSync(file, `${prelude}\n${source}\n`); return file;
    });
    const driver = join(temp, 'mutants.mjs');
    writeFileSync(driver, `import { census } from ${JSON.stringify(new URL('../../../scripts/census/model-writer-census.mjs', import.meta.url).href)};
      console.log(JSON.stringify(census({ root: ${JSON.stringify(ROOT)}, extraFiles: ${JSON.stringify(files)} })));`);
    const result = JSON.parse(execFileSync(process.execPath, [driver], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 }));
    for (const [name] of mutants) {
      const found = result.sites.filter((s: any) => s.file.endsWith(`/${name}.ts`) && s.kind !== 'door_caller');
      expect(found.length, name).toBeGreaterThan(0);
      for (const site of found) expect(() => requireOnlyExemptedWrites({ ...measured,
        sites: [...measured.sites, site], outside_door: measured.outside_door + 1 })).toThrow('Unexempted graph write');
    }
    expect(result.diagnostics).toEqual([]);
  }, 120_000);

  // Real transaction/concurrency/rollback/reload bodies live in the existing
  // env-gated tests/integration/slice-b-concurrent-writes.test.ts suite.
});
