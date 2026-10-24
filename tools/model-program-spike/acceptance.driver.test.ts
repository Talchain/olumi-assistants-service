/**
 * SPIKE S3 ACCEPTANCE DRIVER (run by `acceptance-run.mjs`; skipped unless MP_ACCEPT_OUT is set, so it never runs in CI).
 * The REAL core route in process, with the REAL provider (key from the service's .env, never printed) and in-memory stores
 * in the route's served shapes, keyed by scenario so two runs can be in flight: 0 database writes. Per run:
 *   draft (canonical arm) → compile/repair → simulate → present, then ≤ 3 answer turns from the operator (facts sheet by
 *   path) through the core agent's own chat on #3709 (the operator answers the reply's questions, as the control arm's does;
 *   each card issued in response is approved once, by its own press), then save → readback → cold reopen from the stored
 *   JSON in a fresh module instance. (Batch 1's answer-only turns were a probe the PL retired; #3709 has none.)
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
import { answerQuestions, envKey, loadFacts } from './operator.mjs';
// @ts-expect-error a plain ES module beside this driver
import { basisOf, chancesFromView, hasChance, renderCanonical, sumTokens, tokensOf, usdOf } from './record.mjs';

type Json = Record<string, any>;
const OUT = process.env.MP_ACCEPT_OUT ?? '';

// ── per-scenario in-memory stores ──────────────────────────────────────────────────────────────────────────────────────
const persisted = new Map<string, Json>();
const snapshots = new Map<string, { graph: Json; brief: string }>();
const registered = new Map<string, number>();
const rowsOf = new Map<string, Map<string, any>>();
const paused = new Map<string, any>();
const convIds = new Map<string, string>();
const rows = (sid: string) => { if (!rowsOf.has(sid)) rowsOf.set(sid, new Map()); return rowsOf.get(sid)!; };
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
// Since #3716 the compiler emits typed blockers { id, code, scope } and writes no question; a record made before it
// carries asks (per quantity) and coaching (per goal, guardrail or note). Both read into the same shapes.
const QUANTITY_BLOCKER = new Set(['asked', 'range_kind', 'recount']);
const asksOf = (mp: Json): Json[] => (Array.isArray(mp.blockers)
  ? mp.blockers.filter((b: Json) => QUANTITY_BLOCKER.has(b.code)).map((b: Json) => ({ quantity_id: b.id, question: null, unit: null, feeds: b.scope, code: b.code }))
  : (mp.asks ?? []).map((a: Json) => ({ quantity_id: a.quantity_id, question: a.question, unit: a.unit, feeds: a.feeds })));
const coachingOf = (compile: Json | undefined): Json[] => (Array.isArray(compile?.blockers)
  ? compile!.blockers.filter((b: Json) => !QUANTITY_BLOCKER.has(b.code)).map((b: Json) => ({ record_id: b.id, question: null, kind: b.code }))
  : (compile?.coaching ?? []));
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
  // The scenario read's snapshot, for the REAL read route (`readShapedOf`): the stored graph as the register persisted it.
  readExistingScenario: vi.fn(async (sid: string) => { const g = snapshots.get(sid); return g === undefined ? null : { userId: null, graph: g.graph, briefText: g.brief, analysisInvalidatedAt: null, revision: 1 }; }),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
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
 * The scenario read's body for a program graph from the REAL read route (`assist.v1.scenario-graph.ts`), in process, over the
 * stored graph as the register's persistence projection writes it: the bytes DGAI's reader receives (schema `scenario_graph.v1`).
 */
async function readShapedOf(): Promise<(sid: string, graph: Json, brief: string) => Promise<Json>> {
  const { projectCorePostimageForPersistence } = await import('../../src/orchestrator-v5/persisted-graph-projection.js');
  const readRoute = (await import('../../src/routes/assist.v1.scenario-graph.js')).default;
  const readApp = Fastify({ logger: false });
  await readRoute(readApp);
  await readApp.ready();
  return async (sid, saved, brief) => {
    snapshots.set(sid, { graph: projectCorePostimageForPersistence(JSON.parse(JSON.stringify(saved))) as Json, brief });
    const r = await readApp.inject({ method: 'POST', url: `/assist/v1/scenarios/${sid}/graph`, payload: {} });
    return { _read_status: r.statusCode, ...(r.json() as Json) };
  };
}

describe.skipIf(OUT === '')('model-program spike acceptance (live provider)', () => {
  let app: FastifyInstance;
  let reopenFresh: (graph: unknown) => any;
  let readShaped: (sid: string, graph: Json, brief: string) => Promise<Json>;
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
      const post = async (payload: Json, kind: 'draft' | 'answer' | 'approve' = 'draft') => {
        const s = Date.now();
        const r = await app.inject({ method: 'POST', url: '/agent/v1/core-turn',
          payload: { kind: 'message', scenario_id: sid, stage: 'frame', turn_class: 'frame', turn_id: randomUUID(), source: 'composer', ...payload } });
        let body: Json = {}; try { body = r.json() as Json; } catch { body = { raw: r.body.slice(0, 2000) }; }
        const calls = (body._provider_calls ?? []).map((c: Json) => ({ purpose: c.purpose ?? null, alias: c.prompt_alias ?? null, model: c.returned_model ?? c.model ?? null,
          effort: c.reasoning_effort ?? null, outcome: c.attempt?.outcome ?? c.outcome ?? null, ms: c.duration_ms ?? null, tokens: tokensOf(c.usage), usd: +usdOf(c.usage).toFixed(4) }));
        const usd = calls.reduce((a: number, c: Json) => a + c.usd, 0); spent += usd;
        const mp = body.model_program ?? {};
        turns.push({ kind, status: r.statusCode, cards: (body.cards ?? []).map((c: Json) => ({ proposal_id: c.proposal_id ?? null, approve: c.approve_action?.message ?? null })), ms: Date.now() - s, calls, usd: +usd.toFixed(4),
          tool_calls: body._agent?.tool_calls ?? null, error: body.error ?? null, saved: mp.saved ?? null, write: mp.write ?? null, readback: mp.readback ?? null,
          draft_attempts: mp.draft?.attempts?.map((a: Json) => ({ attempt: a.attempt, errors: a.errors?.map((e: Json) => `${e.code}: ${e.message}`) ?? null, failed: a.failed ?? null, ms: a.ms, status: a.status })) ?? null,
          fills: mp.fills ?? null, compile: mp.compile ? { compiles: mp.compile.compiles, executable: mp.compile.executable, errors: mp.compile.errors?.length ?? null,
            per_goal: mp.compile.per_goal?.map((g: Json) => ({ goal_id: g.goal_id, status: g.status, asks: g.asks, needs_measure: g.needs_measure, needs_deadline: g.needs_deadline })),
            per_limit: mp.compile.per_limit?.map((l: Json) => ({ limit_id: l.limit_id, status: l.status, asks: l.asks })), joint: mp.compile.joint?.status, within_limits: mp.compile.within_limits?.status } : null,
          asks: asksOf(mp),
          assistant_text: body.assistant_text ?? null });
        return body;
      };

      let last = await post({ message: brief });
      // Every reply since the operator's last message is what the person has read (class 3: never only the last press's).
      let unread: string[] = [last.assistant_text].filter((t): t is string => typeof t === 'string' && t.trim() !== '');
      let shown = new Set(((last.cards ?? []) as Json[]).map((c) => c.proposal_id));
      for (let k = 1; k <= Number(process.env.MP_ANSWER_TURNS ?? '3'); k += 1) {
        if (existsSync(STOP) || unread.length === 0) break;
        const op = await answerQuestions({ facts, replyText: unread.join('\n\n'), apiKey, fetchImpl: globalThis.fetch });
        if (op.call) { operatorCalls.push({ turn: k, ...op.call, tokens: tokensOf(op.call.usage), usd: +usdOf(op.call.usage).toFixed(4) }); spent += usdOf(op.call.usage); }
        for (const q of op.questions as Json[]) qa.push({ turn: k, question: q.question, status: q.status, answer: q.answer, fact: q.fact, flags: q.flags });
        if ((op.questions as Json[]).length === 0) qa.push({ turn: k, question: null, status: 'no_question', answer: null, flags: op.flags });
        if (op.message === null) break;
        const displayed = ((last.cards ?? []) as Json[]).filter((c) => typeof c.proposal_id === 'string').map((c) => (c.revision === undefined ? { proposal_id: c.proposal_id } : { proposal_id: c.proposal_id, revision: c.revision }));
        last = await post({ message: op.message, ...(displayed.length ? { displayed_proposals: displayed } : {}) }, 'answer');
        unread = [last.assistant_text].filter((t): t is string => typeof t === 'string' && t.trim() !== '');
        // The cards issued in response to these answers: the person approves each once, with its own press.
        for (const card of ((last.cards ?? []) as Json[]).filter((c) => typeof c.proposal_id === 'string' && !shown.has(c.proposal_id) && c.approve_action?.id)) {
          if (existsSync(STOP)) break;
          const pressed = await post({ message: card.approve_action.message, source: 'chip_click', chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } }, 'approve');
          qa.push({ turn: k, press: card.proposal_id, status: pressed.error ? 'press_refused' : 'pressed', error: pressed.error?.code ?? null });
          if (typeof pressed.assistant_text === 'string' && pressed.assistant_text.trim() !== '') { last = pressed; unread.push(pressed.assistant_text); }
        }
        shown = new Set([...shown, ...((last.cards ?? []) as Json[]).map((c) => c.proposal_id)]);
      }
      const storedRun = persisted.get(sid)?.living_model?.runs?.at(-1)?.result as Json | undefined;
      const coaching = coachingOf(storedRun?.compile);
      for (const c of coaching) qa.push({ turn: null, record_id: c.record_id, question: c.question, status: 'not_answerable_by_a_fill', kind: c.kind });

      // Cold reopen: the stored JSON alone, in a fresh module instance.
      const saved = persisted.get(sid);
      const cold = saved === undefined ? undefined : reopenFresh(JSON.parse(JSON.stringify(saved)));
      const reopen = cold === undefined ? { saved: false } : {
        saved: true, version: cold.program.canonical.version, seed: cold.program.seed,
        // The turn's payload no longer repeats the model; the stored program (as written) is what a cold reopen must give back.
        canonical_bytes_identical: JSON.stringify(cold.program.canonical) === JSON.stringify(saved!.living_model?.canonical),
        view_identical: stableStringify(cold.view) === stableStringify(last.canonical_analysis_view),
      };
      const view = (cold?.view ?? last.canonical_analysis_view ?? null) as Json | null;
      const optionLabel = new Map(((saved?.living_model?.canonical?.options ?? []) as Json[]).map((o) => [o.id, o.label]));
      const chances = { per_option: (storedRun?.chances ?? null) as Json[] | null, ...chancesFromView(view, optionLabel) };
      const calls = turns.reduce((a, t) => a + t.calls.length, 0) + operatorCalls.length;
      const rec = { arm: 'spike', id, rep, scenario_id: sid, at: new Date(t0).toISOString(), seconds: +((Date.now() - t0) / 1000).toFixed(1), facts_sheet: facts === null ? 'none' : `${facts.length} lines`,
        calls, usd: +(turns.reduce((a, t) => a + t.usd, 0) + operatorCalls.reduce((a, c) => a + c.usd, 0)).toFixed(4),
        tokens: sumTokens([...turns.flatMap((t) => t.calls.map((c: Json) => c.tokens)), ...operatorCalls.map((c) => c.tokens)]),
        first_attempt: (() => { const a0 = turns[0]?.draft_attempts?.[0]; return a0 ? { compiles: a0.errors !== null && a0.errors.length === 0, errors: a0.errors?.length ?? null, failed: a0.failed } : null; })(),
        post_repair: (() => { const at = turns[0]?.draft_attempts ?? []; const z = at.at(-1); return { repairs: Math.max(0, at.length - 1), compiles: z ? z.errors !== null && z.errors.length === 0 : false, errors: z?.errors?.length ?? null, saved: turns[0]?.saved ?? false }; })(),
        has_chance: hasChance(view), answer_turns: turns.filter((t) => t.kind === 'answer').length, compile_states: turns.map((t) => ({ kind: t.kind, ...(t.compile ?? { compiles: false }) })), chances, qa, operator_calls: operatorCalls, reopen, turns,
        final_saved: last.model_program?.saved ?? false };
      writeFileSync(file, JSON.stringify(rec, null, 1));
      const model = saved?.living_model?.canonical ?? null;
      if (model) {
        writeFileSync(`${OUT}/${id}-r${rep}.canonical.json`, JSON.stringify(model, null, 1));
        writeFileSync(`${OUT}/${id}-r${rep}.readable.md`, renderCanonical(model, saved?.living_model?.runs?.at(-1)?.result?.compile ?? null));
      }
      writeFileSync(`${OUT}/${id}-r${rep}.view.json`, JSON.stringify(view, null, 1));
      if (saved !== undefined) writeFileSync(`${OUT}/${id}-r${rep}.read.json`, JSON.stringify(await readShaped(sid, saved, brief), null, 1));
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
