/**
 * SPIKE S3 ACCEPTANCE DRIVER (run by `acceptance-run.mjs`; skipped unless MP_ACCEPT_OUT is set, so it never runs in CI).
 * The REAL core route in process, with the REAL provider (key from the service's .env, never printed) and in-memory stores
 * in the route's served shapes, keyed by scenario so two runs can be in flight: 0 database writes. Per run:
 *   draft (canonical arm) → compile/repair → simulate → present, then ≤ 3 answer turns from the operator (facts sheet by
 *   path), then save → readback → cold reopen from the stored JSON in a fresh module instance.
 * env: MP_ACCEPT_OUT (dir) · MP_BRIEFS (json {briefs:[{id,brief}]}) · MP_IDS (comma list) · MP_RUNS (default 1) ·
 *      MP_FACTS (facts sheet path; absent → every ask is "I don't know") · MP_PARALLEL (default 2, max 2) · MP_MAX_USD (default 5)
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../src/orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../src/orchestrator-v5/context/graph-hash.js';
import { stableStringify } from '../../src/orchestrator/context/stable-stringify.js';
// @ts-expect-error a plain ES module beside this driver
import { answerAsks, envKey, loadFacts } from './operator.mjs';
// @ts-expect-error a plain ES module beside this driver
import { basisOf, chancesFromView, hasChance, renderCanonical, sumTokens, tokensOf, usdOf } from './record.mjs';

type Json = Record<string, any>;
const OUT = process.env.MP_ACCEPT_OUT ?? '';

// ── per-scenario in-memory stores ──────────────────────────────────────────────────────────────────────────────────────
const persisted = new Map<string, Json>();
const registered = new Map<string, number>();
const rowsOf = new Map<string, Map<string, any>>();
const paused = new Map<string, any>();
const convIds = new Map<string, string>();
const rows = (sid: string) => { if (!rowsOf.has(sid)) rowsOf.set(sid, new Map()); return rowsOf.get(sid)!; };
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
const store = {
  readOpenAiPausedRun: vi.fn(async (sid: string) => paused.get(sid) ?? null),
  saveOpenAiPausedRun: vi.fn(async (sid: string, r: any) => { if (paused.has(sid)) return false; paused.set(sid, r); return true; }),
  takeOpenAiPausedRun: vi.fn(async (sid: string, id: string) => { if (paused.get(sid)?.pause_id !== id) return false; paused.delete(sid); return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => convIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!convIds.has(sid)) convIds.set(sid, id); return convIds.get(sid); }),
  loadGraph: async (sid: string) => persisted.get(sid) ?? null,
  loadGraphAndBriefText: async (sid: string) => ({ graph: persisted.get(sid) ?? null, briefText: null }),
  readFactsFor: vi.fn(async () => []),
  readRecent: vi.fn(async (sid: string) => [...rows(sid).values()].reverse()),
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (sid: string, id: string) => rows(sid).get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async (sid: string) => [...rows(sid).values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  releaseTurnClaim: vi.fn(async (sid: string, id: string, hash: string) => { if (rows(sid).get(id)?.request_hash === hash) rows(sid).delete(id); }),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    const r = rows(String(write.scenario_id)); const key = String(write.turn_id); const prior = r.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...write, id: `row-${r.size + 1}`, created_at: new Date(Date.now() + r.size).toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    r.set(key, row); return { id: row.id };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
};
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../src/orchestrator/user-identity.js', async (original) => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));

function graphRead(sid: string): Json {
  const g = persisted.get(sid);
  if (g === undefined) return { scenario_id: sid, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null, content_hash: null };
  return { scenario_id: sid, graph: g, graph_present: true, brief_text: null, graph_hash: hashOf(g), graph_identity_hash: computeGraphIdentityHash(g as never),
    content_hash: computeGraphIdentityHash(g as never)!.value, analysis_ready: { status: 'blocked', may_run: false, options: [], blockers: [] },
    analysis_state: { run_state: { kind: 'never_run' }, usable_for_prose: false, usable_for_chips: false, usable_for_followup: false },
    current_read: { run_state: { kind: 'never_run' }, computed_against_hash: null, run_id: null } };
}

/**
 * The scenario read's body for a program graph, composed in process from the SAME functions the read route calls for one
 * (the register's persistence projection, the analysis hash, the stored Run's view, the canonical readiness builder, the
 * admission projection). Not the route itself: the route's own Run-fact reads have nothing to read for a program.
 */
async function readShapedOf(): Promise<(sid: string, graph: Json, brief: string) => Json> {
  const { projectCorePostimageForPersistence } = await import('../../src/orchestrator-v5/persisted-graph-projection.js');
  const { reopenProgram } = await import('../../src/orchestrator-v5/model-program-turn/program-store.js');
  const { buildCanonicalAnalysisReadyFromGraph } = await import('../../src/orchestrator/tools/analysis-ready-helper.js');
  const { projectAnalysisAdmission } = await import('../../src/routes/analysis-admission-projection.js');
  return (sid, saved, brief) => {
    const graph = projectCorePostimageForPersistence(JSON.parse(JSON.stringify(saved))) as Json;
    const identity = computeGraphIdentityHash(graph as never);
    return { schema: 'scenario-graph-read.composed.v1', scenario_id: sid, graph, graph_present: true, graph_hash: hashOf(graph), content_hash: identity?.value ?? null,
      graph_identity_hash: identity, brief_text: brief, analysis_state: null, analysis_result: null,
      canonical_analysis_view: reopenProgram(graph)?.view ?? null,
      current_read: { analysis_ready: buildCanonicalAnalysisReadyFromGraph(graph), run_state: null, computed_against_hash: null, current_analysis_hash: null, figures: [] },
      analysis_admission: projectAnalysisAdmission(graph, true) };
  };
}

describe.skipIf(OUT === '')('model-program spike acceptance (live provider)', () => {
  let app: FastifyInstance;
  let reopenFresh: (graph: unknown) => any;
  let readShaped: (sid: string, graph: Json, brief: string) => Json;
  const STOP = process.env.MP_STOP ?? `${OUT}/STOP-429.txt`;
  const realFetch = globalThis.fetch;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    const key = envKey();
    if (!key) throw new Error('no OpenAI key in .env');
    process.env.OPENAI_API_KEY = key;
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: any) => {
      const u = String((url as any)?.href ?? (url as any)?.url ?? url);
      if (!u.startsWith('https://api.openai.com/')) return new Response(JSON.stringify({ error: 'blocked by the spike harness' }), { status: 599 });
      if (existsSync(STOP)) throw new Error('STOP-429 present');
      const res = await realFetch(url as any, init);
      if (res.status === 429) writeFileSync(STOP, `429 at ${u} ${new Date().toISOString()}\n`);
      return res;
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../src/routes/core-turn.js');
    vi.resetModules();
    reopenFresh = (await import('../../src/orchestrator-v5/model-program-turn/program-store.js')).reopenProgram;
    readShaped = await readShapedOf();
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => graphRead((req.params as Json).id));
    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const sid = (req.params as Json).id as string; const b = req.body as Json;
      const prior = persisted.get(sid);
      const current = prior === undefined ? null : computeGraphIdentityHash(prior as never)!.value;
      if ((b.expected_graph_identity_hash ?? null) !== current) return reply.code(409).send({ details: { code: 'GRAPH_STALE' } });
      const g = JSON.parse(JSON.stringify(b.graph)) as Json; persisted.set(sid, g);
      const n = (registered.get(sid) ?? 0) + 1; registered.set(sid, n);
      const identity = computeGraphIdentityHash(g as never)!;
      return { registered: true, graph_identity_hash: identity, graph_hash: hashOf(g),
        model_version: { version_id: `v_${n}`, version_number: n, mutation_id: `m_${n}`, creation_kind: n === 1 ? 'initial' : 'committed_mutation',
          graph_identity_hash: identity.value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(g as never) } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
    app.post('/orchestrate/v2/turn', async (_req, reply) => reply.code(500).send({ error: 'no Run in this harness' }));
    await app.register(route.coreTurnRoute);
    await app.ready();
  }, 180_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); });

  it('runs', async () => {
    const briefs = (JSON.parse(readFileSync(process.env.MP_BRIEFS!, 'utf8')) as Json).briefs as Json[];
    const ids = (process.env.MP_IDS ?? briefs.map((b) => b.id).join(',')).split(',');
    const runs = Number(process.env.MP_RUNS ?? '1');
    const parallel = Math.min(2, Math.max(1, Number(process.env.MP_PARALLEL ?? '2')));
    const maxUsd = Number(process.env.MP_MAX_USD ?? '5');
    const factsFile = process.env.MP_FACTS ?? '';
    const apiKey = process.env.OPENAI_API_KEY!;
    let spent = 0;
    const jobs = Array.from({ length: runs }, (_, i) => ids.map((id) => ({ id, rep: i + 1 }))).flat();

    const runOne = async (id: string, rep: number) => {
      const file = `${OUT}/${id}-r${rep}.json`;
      if (existsSync(file)) return;
      const brief = briefs.find((b) => b.id === id)?.brief as string | undefined;
      if (brief === undefined) throw new Error(`no brief ${id}`);
      const facts = loadFacts(factsFile, (briefs.find((b) => b.id === id)?.facts_key as string | undefined) ?? id);
      const sid = randomUUID();
      const t0 = Date.now();
      const turns: Json[] = []; const qa: Json[] = []; const operatorCalls: Json[] = [];
      const post = async (payload: Json, headers: Record<string, string> = {}) => {
        const s = Date.now();
        const r = await app.inject({ method: 'POST', url: '/agent/v1/core-turn', headers,
          payload: { kind: 'message', scenario_id: sid, stage: 'frame', turn_class: 'frame', turn_id: randomUUID(), source: 'composer', ...payload } });
        let body: Json = {}; try { body = r.json() as Json; } catch { body = { raw: r.body.slice(0, 2000) }; }
        const calls = (body._provider_calls ?? []).map((c: Json) => ({ purpose: c.purpose ?? null, alias: c.prompt_alias ?? null, model: c.returned_model ?? c.model ?? null,
          effort: c.reasoning_effort ?? null, outcome: c.attempt?.outcome ?? c.outcome ?? null, ms: c.duration_ms ?? null, tokens: tokensOf(c.usage), usd: +usdOf(c.usage).toFixed(4) }));
        const usd = calls.reduce((a: number, c: Json) => a + c.usd, 0); spent += usd;
        const mp = body.model_program ?? {};
        turns.push({ kind: payload.model_program_answers ? 'answer' : 'draft', status: r.statusCode, ms: Date.now() - s, calls, usd: +usd.toFixed(4),
          tool_calls: body._agent?.tool_calls ?? null, error: body.error ?? null, saved: mp.saved ?? null, write: mp.write ?? null, readback: mp.readback ?? null,
          draft_attempts: mp.draft?.attempts?.map((a: Json) => ({ attempt: a.attempt, errors: a.errors?.map((e: Json) => `${e.code}: ${e.message}`) ?? null, failed: a.failed ?? null, ms: a.ms, status: a.status })) ?? null,
          fills: mp.fills ?? null, compile: mp.compile ? { compiles: mp.compile.compiles, executable: mp.compile.executable, errors: mp.compile.errors?.length ?? null,
            per_goal: mp.compile.per_goal?.map((g: Json) => ({ goal_id: g.goal_id, status: g.status, asks: g.asks, needs_measure: g.needs_measure, needs_deadline: g.needs_deadline })),
            per_limit: mp.compile.per_limit?.map((l: Json) => ({ limit_id: l.limit_id, status: l.status, asks: l.asks })), joint: mp.compile.joint?.status, within_limits: mp.compile.within_limits?.status } : null,
          asks: (mp.asks ?? []).map((a: Json) => ({ quantity_id: a.quantity_id, question: a.question, unit: a.unit, feeds: a.feeds })),
          assistant_text: body.assistant_text ?? null });
        return body;
      };

      let last = await post({ message: brief });
      const attempted = new Set<string>();
      for (let k = 1; k <= 3; k += 1) {
        if (existsSync(STOP)) break;
        const asks = ((last.model_program?.asks ?? []) as Json[]).filter((a) => a.feeds.length > 0 && !attempted.has(a.quantity_id));
        if (asks.length === 0 || last.model_program?.saved !== true) break;
        for (const a of asks) attempted.add(a.quantity_id);
        const op = await answerAsks({ facts, asks, apiKey, fetchImpl: globalThis.fetch });
        if (op.call) { operatorCalls.push({ turn: k, ...op.call, tokens: tokensOf(op.call.usage), usd: +usdOf(op.call.usage).toFixed(4) }); spent += usdOf(op.call.usage); }
        for (const a of op.answers) qa.push({ turn: k, quantity_id: a.quantity_id, question: a.question, unit: a.unit, status: a.status, answer: a.said,
          value: a.value ?? null, low: a.low ?? null, high: a.high ?? null, fact: a.fact ?? null, flags: a.flags });
        const fills = op.answers.filter((a: Json) => a.status === 'answered').map((a: Json) => ({ quantity_id: a.quantity_id, value: a.value, low: a.low, high: a.high, words: a.words }));
        if (fills.length === 0) break;
        last = await post({ message: fills.map((f: Json) => f.words).join(' '), model_program_answers: fills });
      }
      const coaching = (last.model_program?.compile?.coaching ?? []) as Json[];
      for (const c of coaching) qa.push({ turn: null, record_id: c.record_id, question: c.question, status: 'not_answerable_by_a_fill', kind: c.kind });

      // Cold reopen: the stored JSON alone, in a fresh module instance.
      const saved = persisted.get(sid);
      const cold = saved === undefined ? undefined : reopenFresh(JSON.parse(JSON.stringify(saved)));
      const reopen = cold === undefined ? { saved: false } : {
        saved: true, version: cold.program.canonical.version, seed: cold.program.seed,
        canonical_bytes_identical: JSON.stringify(cold.program.canonical) === JSON.stringify(last.model_program?.canonical),
        view_identical: stableStringify(cold.view) === stableStringify(last.canonical_analysis_view),
      };
      const view = last.canonical_analysis_view as Json | null;
      const optionLabel = new Map(((last.model_program?.canonical?.options ?? []) as Json[]).map((o) => [o.id, o.label]));
      const chances = { per_option: (last.model_program?.chances ?? null) as Json[] | null, ...chancesFromView(view, optionLabel) };
      const calls = turns.reduce((a, t) => a + t.calls.length, 0) + operatorCalls.length;
      const rec = { arm: 'spike', id, rep, scenario_id: sid, at: new Date(t0).toISOString(), seconds: +((Date.now() - t0) / 1000).toFixed(1), facts_sheet: facts === null ? 'none' : `${facts.length} lines`,
        calls, usd: +(turns.reduce((a, t) => a + t.usd, 0) + operatorCalls.reduce((a, c) => a + c.usd, 0)).toFixed(4),
        tokens: sumTokens([...turns.flatMap((t) => t.calls.map((c: Json) => c.tokens)), ...operatorCalls.map((c) => c.tokens)]),
        first_attempt: (() => { const a0 = turns[0]?.draft_attempts?.[0]; return a0 ? { compiles: a0.errors !== null && a0.errors.length === 0, errors: a0.errors?.length ?? null, failed: a0.failed } : null; })(),
        post_repair: (() => { const at = turns[0]?.draft_attempts ?? []; const z = at.at(-1); return { repairs: Math.max(0, at.length - 1), compiles: z ? z.errors !== null && z.errors.length === 0 : false, errors: z?.errors?.length ?? null, saved: turns[0]?.saved ?? false }; })(),
        has_chance: hasChance(view), answer_turns: turns.filter((t) => t.kind === 'answer').length, compile_states: turns.map((t) => ({ kind: t.kind, ...(t.compile ?? { compiles: false }) })), chances, qa, operator_calls: operatorCalls, reopen, turns,
        final_saved: last.model_program?.saved ?? false };
      writeFileSync(file, JSON.stringify(rec, null, 1));
      const model = last.model_program?.canonical ?? null;
      if (model) {
        writeFileSync(`${OUT}/${id}-r${rep}.canonical.json`, JSON.stringify(model, null, 1));
        writeFileSync(`${OUT}/${id}-r${rep}.readable.md`, renderCanonical(model, last.model_program?.compile ?? null));
      }
      writeFileSync(`${OUT}/${id}-r${rep}.view.json`, JSON.stringify(view, null, 1));
      if (saved !== undefined) writeFileSync(`${OUT}/${id}-r${rep}.read.json`, JSON.stringify(readShaped(sid, saved, brief), null, 1));
      console.log(`${id}-r${rep}: ${rec.calls} calls · $${rec.usd} · ${rec.seconds}s · saved ${rec.final_saved} · reopen ${JSON.stringify(reopen)}`);
    };

    let next = 0;
    await Promise.all(Array.from({ length: parallel }, async () => {
      while (next < jobs.length) {
        if (existsSync(STOP)) return;
        if (spent >= maxUsd) { console.log(`spend cap $${maxUsd} reached at $${spent.toFixed(2)}`); return; }
        while (loadavg()[0] >= 25) await new Promise((r) => setTimeout(r, 30_000));
        if (next >= jobs.length) return;
        const job = jobs[next++]!;
        try { await runOne(job.id, job.rep); } catch (err) { writeFileSync(`${OUT}/${job.id}-r${job.rep}.FAILED.txt`, String(err instanceof Error ? err.stack : err)); }
      }
    }));
  }, 4 * 60 * 60_000);
});
