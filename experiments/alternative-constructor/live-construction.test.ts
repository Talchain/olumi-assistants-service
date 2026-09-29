/** Real Agent + real admission + real provider; in-memory registration only, never a persisted/science witness. */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-ignore experiment-only JS modules, outside production build
import { acquireProviderQueue, reserveAttempt, finishAttempt } from './provider-budget.mjs';
// @ts-ignore experiment-only JS modules, outside production build
import { scoreRecord } from './score.mjs';
// @ts-ignore experiment-only fixture
import { providerFixtureResponse } from './route-fixtures.mjs';
const LIVE = process.env.ALT_CONSTRUCTOR_LIVE === '1';
const OFFLINE_BOOT = process.env.ALT_CONSTRUCTOR_OFFLINE_BOOT === '1';
const FIXTURE = process.env.ALT_CONSTRUCTOR_FIXTURE === '1';
const OFFLINE = OFFLINE_BOOT || FIXTURE;
const dispatches: { path: string; scenario: string; after_register: boolean }[] = [];
const fixtureCalls: Record<string, unknown>[] = [];
const toolPayloads = new Map<string, { name: string; payload: Record<string, unknown> }>();
const ARM = process.env.OLUMI_CONSTRUCTOR_ARM ?? 'pragmatic';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST = process.env.ALT_CONSTRUCTOR_MANIFEST ?? fileURLToPath(new URL('./four-cases.json', import.meta.url));
const OUT = process.env.ALT_CONSTRUCTOR_OUT ?? resolve(ROOT, '.artifacts/alternative-constructor', `${FIXTURE ? `fixture-${ARM}` : OFFLINE_BOOT ? 'offline-boot' : ARM}.jsonl`);
const LEDGER = process.env.ALT_CONSTRUCTOR_LEDGER ?? resolve(ROOT, '.artifacts/alternative-constructor/provider-ledger.jsonl');
const LIMIT = Number(process.env.ALT_CONSTRUCTOR_ATTEMPT_LIMIT ?? '60');
const ONLY = (process.env.ALT_CONSTRUCTOR_ONLY ?? '').split(',').filter(Boolean);
const REPS = Number(process.env.ALT_CONSTRUCTOR_REPS ?? '1');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const graphOf = new Map<string, unknown>();
const registrationOf = new Map<string, unknown>();
const rows = new Map<string, Record<string, unknown>>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string }) => { const k = `${w.scenario_id}:${w.turn_id}`; if (!rows.has(k)) rows.set(k, { ...w, id: `row-${rows.size + 1}` }); return { id: String(rows.get(k)!.id) }; }),
  readRecent: vi.fn(async () => []), readFactsFor: vi.fn(async () => []), readFactsWithTurnFor: vi.fn(async () => []),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  storeDraftGraph: vi.fn(async (sid: string, g: unknown) => { graphOf.set(sid, g); }),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async () => false),
};
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../src/orchestrator/user-identity.js', async (original) => ({ ...(await original<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }) }));
vi.mock('../../src/adapters/llm/router.js', () => {
  const refuse = async () => { throw new Error('route-v2 LLM is excluded from the construction-only replay'); };
  const adapter = { name: 'test', model: 'test-model', chat: refuse, chatWithTools: refuse };
  return { getAdapter: () => adapter, getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }), getMaxTokensFromConfig: () => undefined };
});
type ProviderRow = Record<string, unknown>;
const calls: ProviderRow[] = [];
let activeCase: Record<string, unknown> = {};
let lastError: string | null = null;
let releaseQueue: (() => void) | undefined;
describe.skipIf(!LIVE && !OFFLINE)('Alternative constructor matched real-provider admission replay', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    if (!['control', 'pragmatic', 'source_first'].includes(ARM)) throw new Error(`Unknown constructor arm ${ARM}`);
    if (!Number.isInteger(REPS) || REPS < 1 || REPS > 3) throw new Error('Explicit repetitions must be 1..3');
    if (!OFFLINE && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required; credentials are never printed');
    if (!OFFLINE) releaseQueue = acquireProviderQueue(LEDGER, { arm: ARM, output: OUT });
    mkdirSync(dirname(OUT), { recursive: true });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      if (OFFLINE_BOOT) throw new Error('OFFLINE_BOOT: provider/network calls are disabled');
      const address = new URL(String(url));
      if (address.hostname !== 'api.openai.com') throw new Error(`Non-OpenAI network excluded from this admission-only witness: ${address.origin}`);
      let body: Record<string, any> = {};
      try { body = JSON.parse(String(init?.body ?? '{}')); } catch { /* counted even if malformed */ }
      // Preserve typed unresolved values from the real tool result. Narration is not proof that a value survived.
      const items = Array.isArray(body.input) ? body.input : [];
      const names = new Map(items.filter((i: any) => i.type === 'function_call').map((i: any) => [i.call_id, i.name]));
      for (const item of items.filter((i: any) => i.type === 'function_call_output')) {
        try { const payload = JSON.parse(item.output); if (payload && typeof payload === 'object') toolPayloads.set(`${activeCase.scenario}:${item.call_id}`, { name: String(names.get(item.call_id) ?? ''), payload }); } catch { /* no semantic credit for a malformed tool result */ }
      }
      if (FIXTURE) { fixtureCalls.push({ format: body.text?.format?.type ?? null, model: body.model, effort: body.reasoning?.effort, max_output_tokens: body.max_output_tokens }); return providerFixtureResponse(body, { arm: ARM, brief: activeCase.text, registered: registrationOf.has(String(activeCase.scenario)) }); }
      const sent = { model: body.model ?? null, effort: body.reasoning?.effort ?? null, max_output_tokens: body.max_output_tokens ?? null, instructions_sha256: sha(String(body.instructions ?? '')), schema_sha256: sha(JSON.stringify(body.text?.format?.schema ?? null)), format: body.text?.format?.type ?? null };
      const attempt = reserveAttempt(LEDGER, { arm: ARM, ...activeCase, ...sent }, LIMIT);
      const started = Date.now();
      let status: number | null = null;
      try {
        const result = await realFetch(url as string, init); status = result.status;
        let raw: Record<string, any> = {};
        try { raw = JSON.parse(await result.clone().text()); } catch { /* preserve status; route handles malformed provider result */ }
        const text = (raw.output ?? []).filter((o: any) => o.type === 'message').flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text ?? '').join('');
        const row = { attempt_id: attempt.attempt_id, attempt_number: attempt.attempt_number, ...sent, ms: Date.now() - started, status, output_text: text, usage: raw.usage ?? null, provider_error: raw.error ?? null };
        calls.push(row); finishAttempt(LEDGER, attempt, { status, ms: row.ms });
        return result;
      } catch (error) {
        const row = { attempt_id: attempt.attempt_id, attempt_number: attempt.attempt_number, ...sent, ms: Date.now() - started, status, error: String(error) };
        calls.push(row); finishAttempt(LEDGER, attempt, row); throw error;
      }
    });
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../src/routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../src/orchestrator-v5/context/graph-hash.js');
    const hashOf = (g: unknown) => g === null ? null : computeAnalysisAffectingGraphHash(g as never);
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => { const scenario = (req.params as { id: string }).id; dispatches.push({ path: 'graph', scenario, after_register: registrationOf.has(scenario) }); const graph = graphOf.get(scenario) ?? { nodes: [], edges: [] }; return { graph, graph_hash: hashOf(graph) }; });
    app.post('/assist/v1/scenarios/:id/versions', async (_req, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));
    app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      const id = (req.params as { id: string }).id;
      dispatches.push({ path: 'graph/register', scenario: id, after_register: registrationOf.has(id) });
      const body = req.body as { graph?: unknown };
      const copy = JSON.parse(JSON.stringify(body.graph)); graphOf.set(id, copy); registrationOf.set(id, copy);
      return { ok: true, graph_hash: hashOf(copy), model_version: { version_id: randomUUID(), version_number: 1 } };
    });
    app.post('/orchestrate/v2/turn', async (_req, reply) => reply.code(503).send({ error: 'ENGINE_NOT_IN_CONSTRUCTION_REPLAY' }));
    app.addHook('onError', async (_req, _reply, error) => { lastError = String(error.stack ?? error); });
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120_000);
  afterAll(async () => { try { await app?.close(); } finally { vi.unstubAllGlobals(); releaseQueue?.(); } });
  it('preserves each original brief and scores the actual registered payload', async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const selected = manifest.briefs.filter((b: { id: string }) => ONLY.length === 0 || ONLY.includes(b.id));
    const cases = OFFLINE ? selected.slice(0, 1) : selected;
    if (ONLY.some((id) => !cases.some((b: { id: string }) => b.id === id))) throw new Error('Requested unknown case; no silent empty run');
    let commit = 'unavailable'; try { commit = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* output records this gap */ }
    const sourceManifestPath = resolve(ROOT, 'CONTROL-MANIFEST.json');
    const sourceManifest = existsSync(sourceManifestPath) ? JSON.parse(readFileSync(sourceManifestPath, 'utf8')) : null;
    for (let rep = 0; rep < REPS; rep += 1) for (const brief of cases) {
      if (sha(brief.text) !== brief.source_sha256) throw new Error(`Frozen source bytes changed: ${brief.id}`);
      const scenario = randomUUID(); const turnId = randomUUID(); const before = calls.length; const started = Date.now();
      activeCase = { brief: brief.id, rep, scenario, source_sha256: brief.source_sha256, ...(FIXTURE ? { text: brief.text } : {}) }; lastError = null;
      let status = 0; let body: Record<string, any> = {};
      try { const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario, turn_id: turnId, message: brief.text, source: 'composer' } }); status = response.statusCode; body = response.json(); } catch (error) { body = { error: String(error) }; }
      const capturedTools = [...toolPayloads.entries()].filter(([key]) => key.startsWith(`${scenario}:`)).map(([, value]) => value);
      const constructor = body._constructor ?? body.constructor_diagnostics ?? capturedTools.find((t) => t.name === 'build_model_from_brief')?.payload ?? null;
      const record = { arm: ARM, label: ARM, control_is_independent: ARM !== 'control' || process.env.ALT_CONTROL_INDEPENDENT === '1', brief: brief.id, rep, scenario, turn_id: turnId, source_sha256: brief.source_sha256, manifest_sha256: sha(readFileSync(MANIFEST, 'utf8')), commit, source_manifest: sourceManifest, evidence_level: FIXTURE ? 'injected_provider_route_fixture_only' : OFFLINE_BOOT ? 'offline_boot_only' : 'admitted_registration_payload_only', status, ms: Date.now() - started, provider_calls: calls.slice(before), assistant_text: body.assistant_text ?? '', questions: body._build_questions ?? body.open_questions ?? body._agent?.open_questions ?? constructor?.questions ?? [], proposals: constructor?.proposals ?? [], constructor_diagnostics: constructor, fixture_calls: FIXTURE ? fixtureCalls : undefined, canonical_dispatches: dispatches.filter((d)=>d.scenario===scenario), tool_calls: body._agent?.tool_calls ?? [], registered: registrationOf.has(scenario), registration_readback_confirmed: (body._agent?.tool_calls ?? []).some((c: {name?: string;ok?: boolean;mutated?: boolean}) => c.name === 'build_model_from_brief' && c.ok === true && c.mutated === true), graph: registrationOf.get(scenario) ?? null, unregistered_draft: registrationOf.has(scenario) ? null : graphOf.get(scenario) ?? null, reply: body, error_stack: lastError };
      appendFileSync(OUT, `${JSON.stringify(record)}\n`);
      if (FIXTURE) { expect(status).toBe(200); expect(record.registered, JSON.stringify(body)).toBe(true); expect(dispatches.some((d)=>d.scenario===scenario && d.path==='graph/register')).toBe(true); expect(dispatches.some((d)=>d.scenario===scenario && d.path==='graph' && d.after_register)).toBe(true); expect(calls).toHaveLength(0); }
      appendFileSync(`${OUT}.scores.jsonl`, `${JSON.stringify(scoreRecord(record))}\n`);
      console.log(JSON.stringify({ arm: ARM, brief: brief.id, rep, status, registered: record.registered, provider_attempts: calls.length - before, ms: record.ms }));
      const providerFault = calls.slice(before).some((c) => typeof c.status === 'number' && c.status >= 400);
      const formatFault = (body._agent?.tool_calls ?? []).some((c: { refusal?: string }) => /construction_failed|construction_incomplete|schema|invalid_candidate/.test(c.refusal ?? ''));
      const failedBuild = (body._agent?.tool_calls ?? []).some((c: { name?: string; ok?: boolean; mutated?: boolean }) => c.name === 'build_model_from_brief' && (c.ok !== true || c.mutated !== true));
      if (!OFFLINE && (providerFault || status >= 500 || formatFault || failedBuild)) { console.warn('Stopping batch after provider/format fault; fix and explicitly resume within the same ledger.'); break; }
    }
    expect(cases.length).toBeGreaterThan(0);
  }, 7_200_000);
});
