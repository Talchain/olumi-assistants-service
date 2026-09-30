/**
 * Opt-in disposable manual preview for #2290. Two kinds of session:
 * - FRESH (`{mode:'fresh', brief}`): the AUTHENTIC M1 host. The brief goes to the served CEE's Agent
 *   (`build_model_from_brief` → `/graph/register`), and every read comes back through the served graph read +
 *   versions routes (`scripts/m1-host-seam/readback.mjs`). There is no store, constructor or route of this file's own.
 *   A card is shown only on `version_binding: 'bound'` (J1); anything else says why.
 * - FROZEN (`{arm}`): Runtime's real-role replay seam over the C3 fixture, in an in-memory store. It is labelled FROZEN.
 * OpenAI only. Only the fresh-session seam reaches the CEE host; every other outbound call is refused.
 */
import { it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Row = Record<string, unknown> & { scenario_id: string; turn_id: string; pending_actions: unknown[] };
const rows = new Map<string, Row>();
const graphs = new Map<string, unknown>();
const briefs = new Map<string, string>();
const clone = <T,>(value: T): T => structuredClone(value);
const recent = (sid: string) => [...rows.values()].reverse().filter(r => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
let tick = 0;
const store = {
  ensureScenarioExists: async () => ({ user_id: null }),
  readCommittedTurn: async (sid: string, tid: string) => rows.get(`${sid}:${tid}`) ?? null,
  readMostRecentPendingActions: async (sid: string) => {
    const { parsePendingAction } = await import('../../session/pending-action.js');
    return (recent(sid)[0]?.pending_actions ?? []).map(x => parsePendingAction(clone(x))).filter(x => x !== null);
  },
  append: async (w: Record<string, unknown> & { scenario_id: string; turn_id: string }) => {
    const key = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(key)) {
      rows.set(key, {
        id: `lab-row-${++tick}`, scenario_id: w.scenario_id, turn_id: w.turn_id,
        request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null,
        user_message: w.userMessage ?? null, llm_calls_used: 0, turn_class: 'direct_answer', handler_id: null,
        pending_actions: clone((w.pending_actions ?? []) as unknown[]), handler_facts: clone(w.handler_facts ?? []),
        created_at: new Date(Date.now() + tick).toISOString(),
      });
      if (w.graph !== undefined && w.graph !== null) graphs.set(w.scenario_id, clone(w.graph));
    }
    return { id: rows.get(key)!.id };
  },
  readRecent: async (sid: string) => recent(sid),
  readFactsFor: async () => [], readFactsWithTurnFor: async () => [],
  readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
  invalidateScoped: async (_sid: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  storeDraftGraph: async (sid: string, graph: unknown) => { graphs.set(sid, clone(graph)); },
  loadGraph: async (sid: string) => graphs.get(sid) ?? null,
  loadGraphAndBriefText: async (sid: string) => ({ graph: graphs.get(sid) ?? null, briefText: briefs.get(sid) ?? null }),
  hasPriorTurns: async (sid: string) => recent(sid).length > 0,
};

vi.mock('../../session/index.js', async (original) => ({
  ...(await original<Record<string, unknown>>()), getSessionStore: () => store, resetSessionStoreForTests: () => {},
}));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...(await original<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../../../adapters/llm/router.js', () => {
  const refuse = async () => { throw new Error('The disposable lab does not run the route-v2 provider.'); };
  const adapter = { name: 'lab-disabled', model: 'lab-disabled', chat: refuse, chatWithTools: refuse };
  return { getAdapter: () => adapter, getAdapterWithResolution: () => ({ adapter,
    resolution: { task: 'narrate', resolved_model: 'lab-disabled', resolution_source: 'task_default' } }),
    getMaxTokensFromConfig: () => undefined };
});

it.skipIf(process.env.RUN_AI_EXPERIENCE_LAB !== '1')('hosts the disposable manual lab until stopped', async () => {
  const fixturePath = resolve('scripts/ai-experience-lab/pricing-fixture.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    run: string; draft_graph: unknown; history: { user: string; assistant: string }[];
  };
  const evidence = process.env.AI_EXPERIENCE_LAB_EVIDENCE!;
  const port = Number(process.env.AI_EXPERIENCE_LAB_PORT ?? '8793');
  const head = process.env.AI_EXPERIENCE_LAB_HEAD ?? 'unknown';
  const source_hash = process.env.AI_EXPERIENCE_LAB_SOURCE_HASH ?? 'unknown';
  const m2Enabled = process.env.AI_EXPERIENCE_LAB_M2_ENABLED === '1';
  const m2Evidence = process.env.AI_EXPERIENCE_LAB_M2_EVIDENCE;
  const arms = {
    baseline: { model: 'gpt-5.6-terra', coaching: false },
    A: { model: 'gpt-5.6-terra', coaching: true },
    B: { model: 'gpt-6-luna', coaching: false },
    C: { model: 'gpt-6-luna', coaching: true },
  } as const;
  const sessions = new Map<string, keyof typeof arms>();
  const network = globalThis.fetch;
  // ── FRESH (authentic M1) — the served CEE is the host. Credentials: the assist key is read from the CEE env file
  // (never copied); the Lab account file (600-mode, outside every repo) signs in and refreshes its own token.
  type Readback = Record<string, unknown> & { version_binding: string; brief_text: string | null; graph: unknown;
    http?: { graph?: number; versions?: number };
    graph_identity_hash: { value?: string } | null; model_version: { version_id?: string } | null; raw?: unknown };
  const seam = await import(pathToFileURL(resolve('scripts/m1-host-seam/readback.mjs')).href) as {
    readback(o: Record<string, unknown>): Promise<Readback>;
    buildFromBrief(o: Record<string, unknown>): Promise<Record<string, unknown> & { scenario_id: string; response?: unknown }>;
    sendTurn(o: Record<string, unknown>): Promise<Record<string, unknown> & { http: number; response?: unknown }>;
    cardsAllowed(rb: Readback): boolean; withheldReason(rb: Readback): string | null; sameModel(a: Readback, b: Readback): boolean;
    parseAccountFile(text: string): Record<string, string>;
    accountTokenSource(account: Record<string, string>, o: { fetchImpl: typeof fetch }): () => Promise<string>;
    editedSinceConstruction(rb: Readback): boolean;
  };
  const { parse: parseEnv } = await import('dotenv');
  const ceeBase = process.env.LAB_CEE_BASE ?? 'https://cee-staging.onrender.com';
  const assistKey = process.env.LAB_ASSIST_ENV_FILE
    ? parseEnv(readFileSync(process.env.LAB_ASSIST_ENV_FILE, 'utf8')).ASSIST_API_KEY : undefined;
  const bearer = process.env.LAB_ACCOUNT_FILE
    ? seam.accountTokenSource(seam.parseAccountFile(readFileSync(process.env.LAB_ACCOUNT_FILE, 'utf8')), { fetchImpl: network })
    : undefined;
  const host = { base: ceeBase, assistKey, bearer, fetchImpl: network };
  const fresh = new Set<string>();
  // Build's guard (scripts/ai-experience-lab/canonical-m1-guard.mjs) is the ONE binding rule for M2 (Build 5908596263).
  const guard = await import(pathToFileURL(resolve('scripts/ai-experience-lab/canonical-m1-guard.mjs')).href) as {
    bindCanonicalM1(o: Record<string, unknown>): { accepted: boolean; withheld_reason?: string; binding?: Record<string, unknown> };
    settleCanonicalM2(o: Record<string, unknown>): { accepted: boolean; proposals: unknown[]; withheld_reason: string | null; receipt?: unknown };
  };
  // The served CEE is the authority, not this process: after a host restart a fresh scenario re-attaches by reading it
  // back (its owner's token decides whether it can be read at all).
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const attachFresh = async (sid: unknown): Promise<boolean> => {
    if (typeof sid !== 'string') return false;
    if (fresh.has(sid)) return true;
    if (!assistKey || !UUID.test(sid) || sessions.has(sid)) return false;
    const rb = await seam.readback({ ...host, scenarioId: sid });
    if (rb.http?.graph !== 200 || rb.graph === null) return false;
    fresh.add(sid);
    return true;
  };

  const view = (rb: Readback) => {
    const { raw: _raw, ...rest } = rb;
    // A fresh session's id IS its scenario id; every readback carries it (Build 5908635393: the UI rejects a readback
    // without its session).
    return { session_id: rb.scenario_id, ...rest, model_version_id: rb.model_version?.version_id ?? null,
      withheld_reason: seam.withheldReason(rb) };
  };
  const readFresh = async (sid: string) => {
    const rb = await seam.readback({ ...host, scenarioId: sid });
    if (evidence) appendFileSync(evidence, JSON.stringify({ timestamp: new Date().toISOString(), head, source_hash,
      session_id: sid, mode: 'fresh', readback: rb }) + '\n');
    return rb;
  };
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== 'https://api.openai.com') throw new Error('This lab permits only OpenAI provider traffic; external services are unavailable.');
    return network(input, init);
  });
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
  const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
  const internal = Fastify({ logger: false });
  internal.post('/assist/v1/scenarios/:id/graph', async req => {
    const graph = graphs.get((req.params as { id: string }).id) ?? null;
    return { graph, graph_hash: graph === null ? null : computeAnalysisAffectingGraphHash(graph as never) };
  });
  await internal.register(ceeOrchestratorRouteV2);
  await internal.register(agentV1TurnRoute);
  await internal.ready();
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) {
      return reply.code(403).send({ error: 'This preview accepts same-origin requests only.' });
    }
  });
  app.get('/', async (_req, reply) => reply.type('text/html').send(readFileSync(resolve('scripts/ai-experience-lab/index.html'), 'utf8')));
  app.get('/lab/rehearsal', async () => JSON.parse(readFileSync(resolve('scripts/ai-experience-lab/rehearsal.json'), 'utf8')));
  for (const name of ['rehearsal.mjs', 'rehearsal-ui.mjs']) {
    app.get(`/lab/${name}`, async (_req, reply) => reply.type('text/javascript').send(readFileSync(resolve('scripts/ai-experience-lab', name), 'utf8')));
  }
  app.get('/lab/status', async () => ({ status: 'ISOLATED_MANUAL_PREVIEW', head, source_hash, arms, fixture: fixture.run,
    persistence: 'disposable_in_memory', external_analysis: 'unavailable', m2_available: m2Enabled,
    // `fresh_available`: the authentic CEE host path is configured (Build 5908534036). Signed out, a fresh model still
    // opens but reads `guest_no_version`, and M2 is withheld.
    fresh_available: typeof assistKey === 'string' && assistKey.length > 0,
    fresh: { host: ceeBase, available: typeof assistKey === 'string' && assistKey.length > 0, signed_in: bearer !== undefined } }));
  app.get('/lab/session/:id', async (req, reply) => {
    const sid = (req.params as { id: string }).id;
    if (await attachFresh(sid)) return { mode: 'fresh', ...view(await readFresh(sid)) };
    if (!sessions.has(sid)) return reply.code(404).send({ error: 'Lab session not found; reset to start again.' });
    return { session_id: sid, arm: sessions.get(sid), graph: graphs.get(sid) };
  });
  app.post('/lab/session', async (req, reply) => {
    const body = req.body as { mode?: unknown; brief?: unknown } | null;
    if (body?.mode === 'fresh') {
      if (!assistKey) return reply.code(503).send({ error: 'The CEE host is not configured (LAB_ASSIST_ENV_FILE).' });
      if (typeof body.brief !== 'string' || !body.brief.trim() || body.brief.length > 12000) {
        return reply.code(400).send({ error: 'Enter a brief (maximum 12,000 characters).' });
      }
      if (busy) return reply.code(409).send({ error: 'Another Lab call is still running.' });
      busy = true;
      try {
        const turn = await seam.buildFromBrief({ ...host, brief: body.brief.trim() });
        fresh.add(turn.scenario_id);
        const rb = await readFresh(turn.scenario_id);
        const { response: _response, ...turnView } = turn;
        return { mode: 'fresh', ...view(rb), turn: turnView };
      } catch (error) {
        return reply.code(502).send({ error: `The CEE host could not build the model: ${error instanceof Error ? error.message : String(error)}` });
      } finally { busy = false; }
    }
    const arm = (req.body as { arm?: keyof typeof arms })?.arm;
    if (!arm || !Object.hasOwn(arms, arm)) return reply.code(400).send({ error: 'Choose a supported arm.' });
    const sid = randomUUID(); sessions.set(sid, arm);
    graphs.set(sid, clone(fixture.draft_graph)); briefs.set(sid, fixture.history[0]!.user);
    for (const [i, h] of fixture.history.entries()) {
      const tid = `seed-${i}`;
      rows.set(`${sid}:${tid}`, { id: `${sid}:${tid}`, scenario_id: sid, turn_id: tid, request_hash: 'frozen-fixture',
        user_message: h.user, assistant_message: h.assistant, pending_actions: [], handler_facts: [],
        llm_calls_used: 0, turn_class: 'direct_answer', handler_id: null, created_at: new Date(Date.UTC(2026, 8, 27, 0, 0, i)).toISOString() });
    }
    return { session_id: sid, arm, ...arms[arm], frozen: true, label: 'FROZEN C3 fixture',
      brief: fixture.history[0]!.user, history: fixture.history, graph: graphs.get(sid) };
  });
  let busy = false;
  // The opt-in M2 child reads only this session's current brief/model and the existing pinned MM-1 contract.
  // It has no session store or model-write handle. Only validated proposals may reach the browser.
  async function callReadOnlyM2(snapshot: { session_id: string; brief: string; graph: unknown } | { canonical_binding: Record<string, unknown> }) {
    const script = resolve('scripts/ai-experience-lab/m2-runner.mjs');
    return await new Promise<Record<string, unknown>>((done, fail) => {
      const child = spawn(process.execPath, ['--import', 'tsx', script], {
        cwd: resolve('.'),
        env: { PATH: process.env.PATH ?? '', OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '', diagnostics = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), 65_000);
      child.stdout.on('data', (part: Buffer) => { output += part.toString(); if (output.length > 2_000_000) child.kill('SIGTERM'); });
      child.stderr.on('data', (part: Buffer) => { diagnostics += part.toString(); if (diagnostics.length > 4_000) child.kill('SIGTERM'); });
      child.on('error', fail);
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) return fail(new Error(`M2 worker failed (${code}); no proposal was shown.`));
        try { done(JSON.parse(output) as Record<string, unknown>); }
        catch { fail(new Error('M2 worker returned no readable result.')); }
      });
      child.stdin.end(JSON.stringify(snapshot));
    });
  }
  app.post('/lab/widen', async (req, reply) => {
    if (!m2Enabled) return reply.code(404).send({ error: 'Live M2 is not enabled in this preview.' });
    const sid = (req.body as { session_id?: unknown })?.session_id;
    if (typeof sid === 'string' && await attachFresh(sid)) {
      if (busy) return reply.code(409).send({ error: 'Another Lab call is still running.' });
      busy = true;
      try {
        // J1: read before and bind (Build's guard), M2 on the bound model only, read after and settle (same model).
        const before = await readFresh(sid);
        if (!seam.cardsAllowed(before)) {
          return reply.code(409).send({ error: seam.withheldReason(before), withheld_reason: before.version_binding, readback: view(before) });
        }
        // The first M2 binds only the brief's construction; once the served history shows a later current version (an
        // edit), that version binds — read from the history, so a host restart changes nothing.
        const bound = guard.bindCanonicalM1({ session_id: sid, scenario_id: sid, readback: before,
          require_construction_current: !seam.editedSinceConstruction(before) });
        if (!bound.accepted || !bound.binding) {
          return reply.code(409).send({ error: 'Not shown: this model could not be tied to its saved version.',
            withheld_reason: bound.withheld_reason, readback: view(before) });
        }
        const result = await callReadOnlyM2({ canonical_binding: bound.binding });
        const after = await readFresh(sid);
        const settled = guard.settleCanonicalM2({ binding: bound.binding, readback: after, m2: result });
        if (m2Evidence && result.receipt) appendFileSync(m2Evidence, JSON.stringify({
          timestamp: new Date().toISOString(), head, source_hash, mode: 'fresh', settled: settled.accepted,
          withheld_reason: settled.withheld_reason, ...result.receipt as object,
        }) + '\n');
        if (settled.withheld_reason === 'earlier_model') {
          return reply.code(409).send({ error: 'The model changed during M2; its proposals were withheld.', withheld_reason: 'earlier_model', readback: view(after) });
        }
        if (!result.receipt) return reply.code(502).send({ error: 'M2 could not finish; nothing was shown.' });
        const identity = bound.binding as { graph_identity_hash?: { value?: string }; model_version?: { version_id?: string } };
        return { accepted: settled.accepted, proposals: settled.accepted ? settled.proposals : [],
          withheld_reason: settled.accepted ? null : settled.withheld_reason,
          graph_identity_hash: identity.graph_identity_hash?.value ?? null, model_version_id: identity.model_version?.version_id ?? null,
          version_binding: before.version_binding,
          model: (result.receipt as { model?: string }).model,
          graph_hash: (result.receipt as { graph_hash?: string }).graph_hash,
          latency_ms: (result.receipt as { latency_ms?: number }).latency_ms };
      } catch (error) {
        return reply.code(502).send({ error: 'M2 could not finish; nothing was shown.',
          detail: error instanceof Error ? error.message : String(error) });
      } finally { busy = false; }
    }
    if (typeof sid !== 'string' || !sessions.has(sid)) return reply.code(404).send({ error: 'Start a Lab session first.' });
    if (busy) return reply.code(409).send({ error: 'Another Lab call is still running.' });
    const graph = graphs.get(sid), brief = briefs.get(sid);
    if (graph === undefined || !brief) return reply.code(409).send({ error: 'The current model or brief is unavailable.' });
    const before = JSON.stringify({ graph, brief });
    busy = true;
    try {
      const result = await callReadOnlyM2({ session_id: sid, brief, graph: clone(graph) });
      const current = JSON.stringify({ graph: graphs.get(sid), brief: briefs.get(sid) });
      const stale = current !== before;
      if (m2Evidence && result.receipt) appendFileSync(m2Evidence, JSON.stringify({
        timestamp: new Date().toISOString(), head, source_hash, stale, ...result.receipt as object,
      }) + '\n');
      if (stale) return reply.code(409).send({ error: 'The model changed during M2; its proposals were withheld.' });
      if (!result.receipt) return reply.code(502).send({ error: 'M2 could not finish; nothing was shown.' });
      return { accepted: result.accepted === true, proposals: result.accepted === true ? result.proposals : [],
        withheld_reason: result.accepted === true ? null : 'proposal_validation_or_provider_incomplete',
        model: (result.receipt as { model?: string }).model,
        graph_hash: (result.receipt as { graph_hash?: string }).graph_hash,
        latency_ms: (result.receipt as { latency_ms?: number }).latency_ms };
    } catch {
      return reply.code(502).send({ error: 'M2 could not finish; nothing was shown.' });
    } finally { busy = false; }
  });
  app.post('/lab/turn', async (req, reply) => {
    const body = req.body as { session_id?: string; message?: string };
    const sid = body?.session_id;
    if (sid && await attachFresh(sid)) {
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 12000) {
        return reply.code(400).send({ error: 'Enter a message (maximum 12,000 characters).' });
      }
      if (busy) return reply.code(409).send({ error: 'One lab turn is already running. Please wait.' });
      busy = true; const start = Date.now();
      try {
        const turn = await seam.sendTurn({ ...host, scenarioId: sid, message: body.message });
        const rb = await readFresh(sid);
        const receipt = { timestamp: new Date().toISOString(), head, source_hash, session_id: sid, mode: 'fresh',
          status: turn.http, latency_ms: Date.now() - start, message: body.message, response: turn.response };
        appendFileSync(evidence, JSON.stringify({ ...receipt, readback: rb }) + '\n');
        return reply.code(turn.http === 200 ? 200 : 502).send({ ...receipt, readback: view(rb) });
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
      } finally { busy = false; }
    }
    const arm = sid ? sessions.get(sid) : undefined;
    if (!sid || !arm || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 12000) {
      return reply.code(400).send({ error: 'Start a lab session and enter a message (maximum 12,000 characters).' });
    }
    if (busy) return reply.code(409).send({ error: 'One lab turn is already running. Please wait.' });
    busy = true;
    process.env.CEE_AI_EXPERIENCE_SPIKE_MODEL = arms[arm].model;
    process.env.CEE_AI_EXPERIENCE_SPIKE_COACHING = String(arms[arm].coaching);
    const before = JSON.stringify(graphs.get(sid)); const start = Date.now();
    try {
      const response = await internal.inject({ method: 'POST', url: '/agent/v1/turn',
        payload: { kind: 'message', scenario_id: sid, turn_id: randomUUID(), message: body.message } });
      const payload = response.json() as Record<string, unknown>;
      const receipt = { timestamp: new Date().toISOString(), head, source_hash, session_id: sid, arm, ...arms[arm],
        status: response.statusCode, latency_ms: Date.now() - start, message: body.message,
        graph_changed: before !== JSON.stringify(graphs.get(sid)), response: payload };
      appendFileSync(evidence, JSON.stringify(receipt) + '\n');
      return reply.code(response.statusCode).send(receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendFileSync(evidence, JSON.stringify({ timestamp: new Date().toISOString(), head, arm, status: 'failed', error: message }) + '\n');
      return reply.code(500).send({ error: message });
    } finally { busy = false; }
  });
  await app.listen({ host: '127.0.0.1', port });
  console.log(`AI_EXPERIENCE_LAB_READY http://127.0.0.1:${port} head=${head}`);
  await new Promise<void>(done => { process.once('SIGTERM', done); process.once('SIGINT', done); });
  await app.close(); await internal.close(); vi.unstubAllGlobals();
}, 43_200_000);
