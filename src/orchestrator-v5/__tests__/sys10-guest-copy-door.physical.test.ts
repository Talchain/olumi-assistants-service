import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { SupabaseGuestCopyStore } from '../guest-copy/index.js';
import { SupabaseGuestCopyStore as BeforeStore } from './fixtures/sys10-guest-copy-pre-migration-store.js';
import beforeRoute from './fixtures/sys10-guest-copy-pre-migration-route.js';
import route from '../../routes/assist.v1.scenario-copy.js';
import { bindWriteCaller } from '../ownership/door-ownership.js';
import { commitModelChange } from '../persist-graph-write.js';
import { guestStorage, SOURCE, DEST, USER, OTHER, GRAPH, type Mode } from './sys10-guest-copy-storage.fixture.js';
import { BASELINE, BYPASS_EXEMPTIONS, requireOnlyExemptedWrites } from '../../../scripts/census/model-writer-exemptions.mjs';

const captures = JSON.parse(readFileSync(new URL('./fixtures/sys10-guest-copy-captures.json', import.meta.url), 'utf8'));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MODES: Mode[] = ['success', 'replay', 'owned', 'missing', 'no_model', 'too_large', 'unknown_user', 'fail', 'throw'];
const adapter = (h: ReturnType<typeof guestStorage>) => new SupabaseGuestCopyStore(h.client as never);
const call = (h: ReturnType<typeof guestStorage>, userId = USER, verified = true, requested = USER) =>
  bindWriteCaller({ userId, verified }, () => commitModelChange({ operation: 'COPY_GUEST_SCENARIO',
    store: adapter(h), sourceScenarioId: SOURCE, userId: requested }));
async function result(fn: () => Promise<unknown>) {
  try { return { value: await fn() }; }
  catch (error) { const e = error as Error; return { error: { name: e.name, message: e.message } }; }
}
async function http(h: ReturnType<typeof guestStorage>, before = false, userId: string | null = USER) {
  const app = Fastify();
  // Exactly the binder used by src/plugins/scenario-ownership.ts:312; binding
  // in preHandler crosses Fastify's request AsyncResource, as production does.
  app.addHook('preHandler', (req, _reply, done) => {
    req.scenarioAccess = { callerUserId: userId, caller: { userId, verified: userId !== null },
      scenarioId: SOURCE, ownerUserId: null, memberRead: false };
    bindWriteCaller({ userId, verified: userId !== null }, done, req);
  });
  if (before) await beforeRoute(app, { store: new BeforeStore(h.client as never) });
  else await route(app, { store: adapter(h) });
  try {
    const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SOURCE}/copy`, payload: { user_id: OTHER } });
    return { status: response.statusCode, body: response.json() };
  } finally { await app.close(); }
}

describe('C checked atomic guest-copy door — real door/adapter/routes; storage transport only', () => {
  it.each(MODES)('a baseline %s: captured bytes/value/error preserved', async mode => {
    const old = guestStorage(mode), next = guestStorage(mode);
    expect(await result(() => new BeforeStore(old.client as never).copyGuestScenario(SOURCE, USER))).toEqual(captures[mode]);
    expect(await result(() => call(next))).toEqual(captures[mode]);
    expect(next.state.source).toEqual(old.state.source);
    if (mode === 'success' || mode === 'replay') {
      expect(next.calls).toEqual([{ name: 'copy_guest_scenario_checked', args: {
        p_source_scenario_id: SOURCE, p_user_id: USER, p_checked_source_graph: GRAPH,
        p_checked_source_revision: mode === 'replay' ? 0 : 7,
      } }]);
    }
  });
  it.each(MODES)('a HTTP %s: original status and complete response bytes preserved; body owner ignored', async mode => {
    const old = guestStorage(mode), next = guestStorage(mode);
    expect(await http(next)).toEqual(await http(old, true));
    for (const rpc of next.calls) {
      expect(rpc.name).toBe('copy_guest_scenario_checked');
      expect(rpc.args.p_user_id).toBe(USER);
      expect(Object.keys(rpc.args).sort()).toEqual(['p_checked_source_graph', 'p_checked_source_revision', 'p_source_scenario_id', 'p_user_id']);
      expect(Object.values(rpc.args).every(value => value !== null && value !== undefined)).toBe(true);
    }
  });
  it('a direct existing adapter façade also takes the same door', async () => {
    const h = guestStorage();
    const outcome = await bindWriteCaller({ userId: USER, verified: true }, () => adapter(h).copyGuestScenario(SOURCE, USER));
    expect(outcome).toEqual(captures.success.value);
    expect(h.calls[0].args.p_checked_source_graph).toEqual(GRAPH);
  });
  it('b structural refusal returns existing no_model/404, before any writing RPC', async () => {
    const h = guestStorage(); h.state.source.graph = { ...GRAPH, nodes: [GRAPH.nodes[0], GRAPH.nodes[0]] };
    expect(await call(h)).toEqual({ kind: 'refused', reason: 'no_model' });
    expect(h.calls).toEqual([]); expect(h.state.copies).toEqual([]);
    const response = await http(h);
    expect(response.status).toBe(404); expect(response.body.code).toBe('scenario_not_copyable');
    expect(h.calls).toEqual([]);
  });
  it('b stale-source CG412 is typed 409, one checked dispatch and no acknowledged write', async () => {
    const h = guestStorage('stale');
    expect(await call(h)).toEqual({ kind: 'refused', reason: 'stale_source' });
    const response = await http(guestStorage('stale'));
    expect(response.status).toBe(409); expect(response.body.code).toBe('copy_conflict');
    expect(h.calls).toHaveLength(1); expect(h.state.copies).toEqual([]);
  });
  it('c concurrent transports bind the same source revision/owner; replay response stays original (not SQL race proof)', async () => {
    const h = guestStorage(); let n = 0;
    h.client.rpc = async (name, args) => { h.calls.push({ name, args }); return { data: { scenario_id: DEST, created: n++ === 0 }, error: null }; };
    const outcomes = await Promise.all([call(h), call(h)]);
    expect(outcomes).toEqual([{ kind: 'copied', scenarioId: DEST, created: true }, { kind: 'copied', scenarioId: DEST, created: false }]);
    expect(h.calls.map(c => c.args)).toEqual([h.calls[0].args, h.calls[0].args]);
    expect(h.calls[0].args.p_checked_source_revision).toBe(7);
  });
  it.each(['fail', 'throw'] as const)('d %s after admission preserves original caller error and can retry; no acknowledged half-state', async mode => {
    const h = guestStorage(mode), before = structuredClone(h.state.source);
    expect(await result(() => call(h))).toEqual(captures[mode]);
    expect(h.calls).toHaveLength(1); expect(h.state.source).toEqual(before); expect(h.state.copies).toEqual([]);
    const good = guestStorage(); h.client.rpc = good.client.rpc;
    expect(await call(h)).toEqual(captures.success.value);
    expect(good.calls[0].args.p_checked_source_graph).toEqual(GRAPH);
  });
  it('e persisted acknowledgement reloaded through existing adapter read equals exact checked bytes', async () => {
    const h = guestStorage(); expect(await call(h)).toEqual(captures.success.value);
    const cold = adapter(h);
    expect(await cold.readGuestCopy(SOURCE, USER)).toEqual({ user_id: USER, graph: GRAPH, revision: 0 });
    expect(await cold.readGuestSource(SOURCE)).toEqual({ user_id: null, graph: GRAPH, revision: 7 });
  });
  it('e replay survives a moved/owned/invalid source, recovers original id and does not read/copy the new source', async () => {
    const h = guestStorage('replay'); h.state.source = { user_id: OTHER, graph: { changed: true }, revision: 99 };
    expect(await call(h)).toEqual(captures.replay.value);
    expect(h.reads).toEqual([{ source_scenario_id: SOURCE, user_id: USER }]);
    expect(h.state.copies).toHaveLength(1); expect(h.calls[0].args.p_checked_source_graph).toEqual(GRAPH);
  });
  it('P2-4 replay found after checking a newer source surfaces created:false and recovers the older copy', async () => {
    const makeRace = () => {
      const h = guestStorage('replay_race');
      h.state.source.graph = { ...GRAPH, extra: { words: 'Newer source checked' } };
      h.state.source.revision = 8;
      return h;
    };
    const h = makeRace(), originalCopy = structuredClone(h.state.copies);
    expect(await call(h)).toEqual(captures.replay.value);
    expect(h.reads).toEqual([{ source_scenario_id: SOURCE, user_id: USER }, { id: SOURCE }]);
    expect(h.calls).toEqual([{ name: 'copy_guest_scenario_checked', args: {
      p_source_scenario_id: SOURCE, p_user_id: USER,
      p_checked_source_graph: h.state.source.graph, p_checked_source_revision: 8,
    } }]);
    expect(h.state.copies).toEqual(originalCopy);
    expect(h.state.copies[0].graph).toEqual(GRAPH);
    expect(h.state.copies[0].graph).not.toEqual(h.calls[0].args.p_checked_source_graph);
    const viaHttp = makeRace();
    expect(await http(viaHttp)).toEqual({ status: 200, body: { scenario_id: DEST, created: false } });
    expect(viaHttp.state.copies).toEqual(originalCopy);
  });
  it.each([[USER, false, USER], [OTHER, true, USER], [null, true, USER]] as const)('f bound caller %s/%s cannot forge destination %s; no reads or writes', async (userId, verified, requested) => {
    const h = guestStorage();
    const outcome = await bindWriteCaller({ userId, verified }, () => commitModelChange({ operation: 'COPY_GUEST_SCENARIO',
      store: adapter(h), sourceScenarioId: SOURCE, userId: requested }));
    expect(outcome).toEqual({ kind: 'refused', reason: 'unknown_user' });
    expect(h.reads).toEqual([]); expect(h.calls).toEqual([]); expect(h.state.copies).toEqual([]);
  });
  it('f anonymous HTTP request stays original 401 before store writes', async () => {
    const h = guestStorage(); expect(await http(h, false, null)).toEqual(await http(guestStorage(), true, null));
    expect(h.calls).toEqual([]); expect(h.reads).toEqual([]);
  });
  it('missing checked RPC PGRST202/404 fails closed with existing 503 body; no legacy fallback', async () => {
    const h = guestStorage('missing_rpc');
    expect(await http(h)).toEqual(await http(guestStorage('fail'), true));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe('copy_guest_scenario_checked');
    expect(Object.keys(h.calls[0].args).sort()).toEqual(['p_checked_source_graph', 'p_checked_source_revision', 'p_source_scenario_id', 'p_user_id']);
    // The adapter treats any unexpected error, including a code-less HTTP 404, as unavailable.
    const noCode = guestStorage(); noCode.client.rpc = async (name, args) => { noCode.calls.push({ name, args }); return { data: null, error: { code: undefined as never, status: 404 } }; };
    expect((await http(noCode)).status).toBe(503); expect(noCode.calls).toHaveLength(1);
    expect(noCode.calls[0].name).toBe('copy_guest_scenario_checked');
    expect(noCode.state.copies).toEqual([]);
  });
  it('census zero/empty, both C direct-write mutants and prohibited legacy RPC mutant are RED', () => {
    const temp = mkdtempSync(join(tmpdir(), 'sys10-guest-census-'));
    const files = [
      ['guest-adapter-copy_guest_scenario_checked', "declare const client: { rpc(n: string, args: object): void }; client.rpc('copy_guest_scenario_checked', {});"],
      ['legacy-direct-copy_guest_scenario', "declare const client: { rpc(n: string, args: object): void }; export function commitModelChange() { client.rpc('copy_guest_scenario', {}); }"],
      ['route-copyGuestScenarioChecked', `import type { GuestCopyStorePort } from ${JSON.stringify(join(ROOT, 'src/orchestrator-v5/guest-copy/index.js'))}; declare const store: GuestCopyStorePort; store.copyGuestScenarioChecked({sourceScenarioId:'s',userId:'u',graph:{},revision:0});`],
    ].map(([name, text]) => { const file = join(temp, `${name}.ts`); writeFileSync(file, text); return file; });
    const driver = join(temp, 'driver.mjs');
    writeFileSync(driver, `import { census } from ${JSON.stringify(new URL('../../../scripts/census/model-writer-census.mjs', import.meta.url).href)};
      const all = census({root:${JSON.stringify(ROOT)}, extraFiles:${JSON.stringify(files)}});
      const legacyFile = ${JSON.stringify(files[1])};
      const protectedLegacy = census({root:${JSON.stringify(ROOT)}, extraFiles:[legacyFile], doorFile:${JSON.stringify(relative(ROOT, files[1]))}});
      console.log(JSON.stringify({all, legacySites:protectedLegacy.sites.filter(s => s.file===${JSON.stringify(relative(ROOT, files[1]))}),
        legacyExcluded:protectedLegacy.excluded.filter(s => s.file===${JSON.stringify(relative(ROOT, files[1]))})}));`);
    const parsed = JSON.parse(execFileSync(process.execPath, [driver], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 }));
    const { all, legacySites, legacyExcluded } = parsed;
    expect(legacySites).toHaveLength(1); expect(legacySites[0].callee).toBe('copy_guest_scenario');
    expect(legacyExcluded).toEqual([]);
    const mutants = all.sites.filter((s: { file: string }) => files.some(f => s.file.endsWith(f.split('/').at(-1)!)));
    const clean = { ...all, sites: all.sites.filter((s: { file: string }) => !mutants.includes(s)), outside_door: all.outside_door - mutants.length };
    expect(BASELINE).toBe(0); expect(BYPASS_EXEMPTIONS).toEqual([]); expect(clean.outside_door).toBe(0);
    requireOnlyExemptedWrites(clean); expect(all.diagnostics).toEqual([]);
    expect(mutants).toHaveLength(3);
    process.stdout.write(`CENSUS baseline=${BASELINE} exemptions=${BYPASS_EXEMPTIONS.length} outside_door=${clean.outside_door} door_callers=${clean.door_callers} diagnostics=${all.diagnostics.length} mutants=${mutants.length} legacy_inside_door_counted=${legacySites.length}\n`);
    for (const mutant of mutants) expect(() => requireOnlyExemptedWrites({ ...clean, sites: [...clean.sites, mutant], outside_door: 1 })).toThrow('Unexempted graph write');
  }, 120_000);
  // Real-DB concurrency/rollback/durable reload remains UNRUN in the source-only lane;
  // this storage transport double is not SQL atomicity or rollout proof.
});
