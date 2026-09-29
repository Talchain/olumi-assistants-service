/**
 * Mem0 spike — three-arm benchmark (exp/mem0-context-spike-20260929).
 *
 *   A CONTROL   today's Agent-lane history (8-turn window + older user words, bare)
 *   B IN-HOUSE  the same, older words paired with the question they answered (CEE_CONTEXT_INHOUSE_QA_PAIRING)
 *   C MEM0      B + guarded Mem0 recall (verbatim, infer=false), placed before the canonical state item
 *
 * Same history mechanics (the real `HistoryStore`, `historyFromDurableTurns` on restart), same canonical state (the
 * real `getCanonicalState` over Paul's stored graph), same instructions, tools and loop (`runAgentTurn`). Only history
 * rendering and recall differ between arms.
 *
 * Layer 1 (always): scores the MODEL INPUT each arm would send, with real Mem0 writes/searches.
 * Layer 2 (OPENAI_API_KEY set): runs the real model N times per arm and scores the replies.
 *
 * Run:  set -a; . /root/.config/olumi-mem0.env; set +a
 *       MEM0_TELEMETRY=false pnpm exec tsx tools/mem0-spike/run-ab.ts [--layer2] [--n=3] [--infer-side-run]
 * Writes tools/mem0-spike/out/results-<ts>.json. Never prints keys. Deletes its Mem0 memories at the end.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CASES, paulGraph, type Case, type Graph, type Turn } from './cases.js';
import { HistoryStore, historyFromDurableTurns, questionBefore } from '../../src/orchestrator-v5/agent-lane/history-store.js';
import { runAgentTurn, type CallModel } from '../../src/orchestrator-v5/agent-lane/runtime/agent-loop.js';
import { createAgentCapabilities, type InternalDispatch } from '../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../src/orchestrator-v5/agent-lane/proposal.js';
import { issueContextPacket } from '../../src/orchestrator-v5/agent-lane/runtime/request-assembly.js';
import { guardMemories } from '../../src/orchestrator-v5/agent-lane/memory/memory-guard.js';
import {
  RECALL_LABEL, mem0Client, recallMemories, rememberTurn, renderRecallItem, type Mem0Like,
} from '../../src/orchestrator-v5/agent-lane/memory/supplementary-memory.js';

const args = new Set(process.argv.slice(2));
const N = Number([...args].find((a) => a.startsWith('--n='))?.slice(4) ?? 3);
const LAYER2 = args.has('--layer2');
const INFER_SIDE = args.has('--infer-side-run');
const USER = 'olumi-poc-paul';
const RUN_TAG = `spike-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const SECRET = 'bench-binding-secret';
const T0 = Date.parse('2026-09-29T09:00:00Z');
const at = (i: number) => new Date(T0 + i * 60_000).toISOString();

type Arm = 'A_CONTROL' | 'B_INHOUSE' | 'C_MEM0';
const ARMS: readonly Arm[] = ['A_CONTROL', 'B_INHOUSE', 'C_MEM0'];

const userItem = (t: string) => ({ role: 'user', content: [{ type: 'input_text', text: t }] });
const olumiItem = (t: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] });

function dispatchFor(g: Graph, rev: string, analysisState?: Record<string, unknown>): InternalDispatch {
  return async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: { nodes: g.nodes, edges: g.edges, goal_constraints: g.goal_constraints }, graph_hash: rev, ...(analysisState ? { analysis_state: analysisState } : {}) } }
    : { status: 404, json: {} });
}

/** Replays the conversation through the REAL HistoryStore exactly as the route does, then (optionally) a restart. */
function historyAt(c: Case, pairing: boolean, sessionId: string): unknown[] {
  const store = new HistoryStore(undefined, undefined, () => pairing);
  for (const t of c.turns) {
    store.recordTyped(sessionId, t.user);
    store.set(sessionId, [...store.get(sessionId), userItem(t.user), olumiItem(t.olumi)]);
  }
  if (!c.restart) return store.get(sessionId);
  // A deploy: a NEW process (empty typed/older maps), reseeded from the last 20 durable rows, as text only.
  const rows = c.turns.slice(-20).reverse().map((t) => ({ user_message: t.user, assistant_message: t.olumi }));
  const fresh = new HistoryStore(undefined, undefined, () => pairing);
  fresh.set(sessionId, historyFromDurableTurns(rows));
  return fresh.get(sessionId);
}

async function writeMemories(client: Mem0Like, scenarioId: string, turns: readonly Turn[], infer = false): Promise<{ ms: number[]; chars: number; failures: number }> {
  const ms: number[] = [];
  let chars = 0;
  let failures = 0;
  let prior: unknown[] = [];
  for (let i = 0; i < turns.length; i += 1) {
    const t = turns[i]!;
    const answeredQuestion = questionBefore(prior, prior.length);
    const r = await rememberTurn({ client, userId: USER, scenarioId, turnId: `t${i + 1}`, userWords: t.user, ...(answeredQuestion !== undefined ? { answeredQuestion } : {}), graphRevision: t.rev, saidAt: at(i), infer });
    ms.push(r.ms);
    chars += r.chars;
    if (!r.ok) failures += 1;
    prior = [...prior, userItem(t.user), olumiItem(t.olumi)];
  }
  return { ms, chars, failures };
}

const textsOf = (input: readonly unknown[]): string[] => input.map((i) => {
  const c = (i as { content?: unknown }).content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? '').join('\n') : '';
});
const lineHas = (texts: readonly string[], words: readonly string[]) =>
  texts.some((t) => t.split('\n').some((line) => words.every((w) => line.toLowerCase().includes(w.toLowerCase()))));

interface ArmInput { input: unknown[]; recall?: string; recallStats?: Record<string, unknown> }

async function buildInput(c: Case, arm: Arm, scenarioId: string, client: Mem0Like | undefined, state: unknown, caps: ReturnType<typeof createAgentCapabilities>): Promise<ArmInput> {
  const history = historyAt(c, arm !== 'A_CONTROL', scenarioId);
  let recall: string | undefined;
  let recallStats: Record<string, unknown> | undefined;
  if (arm === 'C_MEM0' && client !== undefined) {
    const r = await recallMemories({ client, userId: USER, scenarioId, query: c.probe });
    const g = guardMemories(r.memories, { scenarioId, userId: USER, state });
    recall = renderRecallItem(scenarioId, g.kept, g.discrepancies);
    recallStats = { search_ms: r.ms, error: r.error, recalled: r.memories.length, kept: g.kept.length, unreconciled: g.discrepancies.length, suppressed: g.suppressed.map((s) => s.reason), chars: recall?.length ?? 0, recall };
  }
  const packet = issueContextPacket({ scenario_id: scenarioId, authenticated_user_id: USER, graph_revision: c.rev, captured_at_turn: 0, state: state as never }, SECRET);
  let seen: unknown[] = [];
  const capture: CallModel = async (req) => { seen = [...(req.input as unknown[])]; return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '.' }] }] } as never; };
  await runAgentTurn({
    ctx: { scenario_id: scenarioId, authenticated_user_id: USER, request_id: randomUUID(), user_turn_text: c.probe, user_text: [c.probe] } as never,
    history, message: c.probe, instructions: 'x', maxOutputTokens: 64,
    canonicalContext: { packet, expectation: { scenario_id: scenarioId, authenticated_user_id: USER, graph_revision: c.rev, current_turn: 0, binding_secret: SECRET } },
    ...(recall !== undefined ? { supplementaryRecall: recall } : {}),
  }, caps, capture);
  return { input: seen, ...(recall !== undefined ? { recall } : {}), ...(recallStats !== undefined ? { recallStats } : {}) };
}

function scoreLayer1(c: Case, a: ArmInput) {
  const texts = textsOf(a.input);
  const needed = (c.expect.needed ?? []).map((w) => ({ words: w, present: lineHas(texts, w) }));
  // The envelope only: the fixed label's own words ("CURRENT MODEL STATE wins") are not recalled content.
  const recall = a.recall === undefined ? '' : a.recall.slice(RECALL_LABEL.length + 1);
  const staleInRecall = (c.expect.notInRecall ?? []).filter((s) => recall.toLowerCase().includes(s.toLowerCase()));
  const leak = (c.expect.notInInput ?? []).filter((s) => texts.some((t) => t.includes(s)));
  const unreconciledJson = recall === '' ? undefined : JSON.parse(recall) as { unreconciled?: { user_said: string }[] };
  const unreconciled = (c.expect.unreconciled ?? []).map((u) => ({ want: u, present: (unreconciledJson?.unreconciled ?? []).some((x) => x.user_said.toLowerCase().includes(u.toLowerCase())) }));
  return {
    needed_present: needed.filter((n) => n.present).length, needed_total: needed.length, needed,
    stale_in_recall: staleInRecall, cross_scenario_leak: leak, unreconciled,
    input_chars: texts.join('\n').length,
  };
}

// ── Layer 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Token usage per model call, keyed by the job that made it (Layer 2 cost accounting). */
const usageLedger: { input: number; cached: number; output: number; calls: number } = { input: 0, cached: 0, output: 0, calls: 0 };

async function realModel(): Promise<{ callModel: CallModel; instructions: string; model: string; maxOutputTokens: number; effort?: string } | undefined> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return undefined;
  const [{ AGENT_INSTRUCTIONS }, { budgetFor }] = await Promise.all([
    import('../../src/routes/agent-v1-turn.js'),
    import('../../src/orchestrator-v5/agent-lane/model-budgets.js'),
  ]);
  const budget = budgetFor('gpt-5.6-terra', 'conversation');
  const callModel: CallModel = async (req) => {
    const body = {
      model: budget.model, instructions: req.instructions, input: req.input, tools: req.tools,
      ...(budget.reasoning_effort !== undefined ? { reasoning: { effort: budget.reasoning_effort } } : {}),
      max_output_tokens: req.max_output_tokens,
    };
    const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`openai_${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { output: Record<string, unknown>[]; status?: string; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } };
    usageLedger.calls += 1;
    usageLedger.input += j.usage?.input_tokens ?? 0;
    usageLedger.cached += j.usage?.input_tokens_details?.cached_tokens ?? 0;
    usageLedger.output += j.usage?.output_tokens ?? 0;
    return { output: j.output, ...(typeof j.status === 'string' ? { status: j.status } : {}) };
  };
  return { callModel, instructions: String(AGENT_INSTRUCTIONS), model: budget.model, maxOutputTokens: budget.max_output_tokens, ...(budget.reasoning_effort !== undefined ? { effort: budget.reasoning_effort } : {}) };
}

async function main(): Promise<void> {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) throw new Error('MEM0_API_KEY not set');
  const client = await mem0Client(apiKey);
  const model = LAYER2 ? await realModel() : undefined;
  const out: Record<string, unknown> = { run_tag: RUN_TAG, started_at: new Date().toISOString(), layer2: model !== undefined ? model.model : 'not run (no OPENAI_API_KEY or --layer2 absent)', n: N, cases: {} as Record<string, unknown> };
  const scenarios: string[] = [];
  const writeLat: number[] = [];
  const searchLat: number[] = [];
  let sentChars = 0;
  let sentCount = 0;

  await Promise.all(CASES.map(async (c) => {
    const scenarioId = `${RUN_TAG}-${c.id}`;
    scenarios.push(scenarioId);
    const w = await writeMemories(client, scenarioId, c.turns);
    writeLat.push(...w.ms); sentChars += w.chars; sentCount += c.turns.length;
    if (c.otherScenario) {
      const other = `${scenarioId}-other`;
      scenarios.push(other);
      const w2 = await writeMemories(client, other, c.otherScenario.turns);
      writeLat.push(...w2.ms); sentChars += w2.chars; sentCount += c.otherScenario.turns.length;
    }
  }));

  const jobs: (() => Promise<void>)[] = [];
  for (const c of CASES) {
    const scenarioId = `${RUN_TAG}-${c.id}`;
    const g = paulGraph();
    c.graphEdits?.(g);
    const caps = createAgentCapabilities(dispatchFor(g, c.rev, c.analysisState), new ProposalStore());
    const st = await caps.getCanonicalState({ scenario_id: scenarioId, authenticated_user_id: USER, request_id: 'bench' } as never);
    const perArm: Record<string, unknown> = {};
    for (const arm of ARMS) {
      const a = await buildInput(c, arm, scenarioId, client, st, caps);
      if (a.recallStats?.search_ms !== undefined) searchLat.push(a.recallStats.search_ms as number);
      const l1 = scoreLayer1(c, a);
      const l2: unknown[] = [];
      if (model !== undefined) {
        for (let k = 0; k < N; k += 1) {
          jobs.push(async () => {
            const caps2 = createAgentCapabilities(dispatchFor(g, c.rev, c.analysisState), new ProposalStore());
            const history = historyAt(c, arm !== 'A_CONTROL', scenarioId);
            const packet = issueContextPacket({ scenario_id: scenarioId, authenticated_user_id: USER, graph_revision: c.rev, captured_at_turn: 0, state: st as never }, SECRET);
            const t0 = performance.now();
            try {
              const res = await runAgentTurn({
                ctx: { scenario_id: scenarioId, authenticated_user_id: USER, request_id: randomUUID(), user_turn_text: c.probe, user_text: [c.probe] } as never,
                history, message: c.probe, instructions: model.instructions, maxOutputTokens: model.maxOutputTokens,
                canonicalContext: { packet, expectation: { scenario_id: scenarioId, authenticated_user_id: USER, graph_revision: c.rev, current_turn: 0, binding_secret: SECRET } },
                ...(a.recall !== undefined ? { supplementaryRecall: a.recall } : {}),
              }, caps2, model.callModel);
              const text = res.assistant_text;
              l2.push({
                k, ms: Math.round(performance.now() - t0), text, stopped: res.stopped_reason,
                must_not_hits: (c.expect.replyMustNot ?? []).filter((x) => x.re.test(text)).map((x) => x.id),
                should_hits: (c.expect.replyShould ?? []).filter((x) => x.re.test(text)).map((x) => x.id),
                should_total: (c.expect.replyShould ?? []).length,
                mutated_calls: res.tool_calls.filter((x) => x.mutated).map((x) => x.name),
                tool_calls: res.tool_calls.map((x) => `${x.name}:${x.ok ? 'ok' : x.refusal ?? 'refused'}`),
              });
            } catch (err) {
              l2.push({ k, error: String(err).slice(0, 200) });
            }
          });
        }
      }
      // `l2` is filled LATER by the queued jobs: attach the array itself, never a snapshot of it.
      perArm[arm] = { layer1: l1, ...(a.recallStats ? { recall: a.recallStats } : {}), ...(model !== undefined ? { layer2: l2 } : {}) };
    }
    (out.cases as Record<string, unknown>)[c.id] = { title: c.title, klass: c.klass, arms: perArm };
  }

  // Layer 2: the model runs, AFTER Layer 1 (so recall latencies are measured without contention), 6 at a time.
  if (jobs.length > 0) {
    const started = Date.now();
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { while (next < jobs.length) { const j = jobs[next++]!; await j(); } }));
    out.layer2_wall_ms = Date.now() - started;
    out.layer2_usage = { ...usageLedger };
    out.layer2_model = { model: model!.model, effort: model!.effort, max_output_tokens: model!.maxOutputTokens };
  }

  // Mem0's own extraction (infer=true) on B, D, E — so a verdict is not reached with its core feature switched off.
  if (INFER_SIDE) {
    const side: Record<string, unknown> = {};
    for (const c of CASES.filter((x) => ['B-correction', 'D-canonical-moved', 'E-analysis-stale'].includes(x.id))) {
      const scenarioId = `${RUN_TAG}-${c.id}-infer`;
      scenarios.push(scenarioId);
      const w = await writeMemories(client, scenarioId, c.turns, true);
      sentChars += w.chars; sentCount += c.turns.length;
      // Inference is asynchronous on the platform (probe: 13–20 s): wait until the count is stable for two polls, ≤ 120 s.
      const getAll = client as unknown as { getAll(o: { filters: unknown }): Promise<{ results?: unknown[] }> };
      const t0 = Date.now();
      let last = -1; let stable = 0;
      while (Date.now() - t0 < 120_000 && stable < 2) {
        await new Promise((r) => setTimeout(r, 5_000));
        const n = (await getAll.getAll({ filters: { AND: [{ user_id: USER }, { run_id: scenarioId }] } })).results?.length ?? 0;
        stable = n > 0 && n === last ? stable + 1 : 0; last = n;
      }
      const indexedAfterMs = Date.now() - t0;
      const g = paulGraph(); c.graphEdits?.(g);
      const caps = createAgentCapabilities(dispatchFor(g, c.rev, c.analysisState), new ProposalStore());
      const st = await caps.getCanonicalState({ scenario_id: scenarioId, authenticated_user_id: USER, request_id: 'bench' } as never);
      const r = await recallMemories({ client, userId: USER, scenarioId, query: c.probe });
      const gd = guardMemories(r.memories, { scenarioId, userId: USER, state: st });
      const recall = (renderRecallItem(scenarioId, gd.kept, gd.discrepancies) ?? '').slice(RECALL_LABEL.length + 1);
      side[c.id] = {
        indexed_after_ms: indexedAfterMs, extracted: last, search_ms: r.ms, recalled: r.memories.map((m) => m.user_words), kept: gd.kept.map((m) => m.user_words),
        suppressed: gd.suppressed.map((s) => s.reason), stale_in_recall: (c.expect.notInRecall ?? []).filter((s) => recall.toLowerCase().includes(s.toLowerCase())),
      };
    }
    out.infer_side_run = side;
  }

  // Latency sample: 20 searches with rerank on and 20 off, on a populated scenario (the R case: 24 memories).
  const sample: Record<string, number[]> = { rerank_on: [], rerank_off: [] };
  const probeScenario = `${RUN_TAG}-R-restart`;
  for (let i = 0; i < 20; i += 1) {
    for (const rerank of [true, false]) {
      const r = await recallMemories({ client, userId: USER, scenarioId: probeScenario, query: CASES[i % CASES.length]!.probe, rerank });
      sample[rerank ? 'rerank_on' : 'rerank_off']!.push(r.ms);
    }
  }
  const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? null : s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
  out.latency = {
    add_ms: { n: writeLat.length, p50: pct(writeLat, 50), p95: pct(writeLat, 95), max: Math.max(...writeLat) },
    search_ms: { n: searchLat.length, p50: pct(searchLat, 50), p95: pct(searchLat, 95), max: Math.max(...searchLat), within_300ms: searchLat.filter((x) => x <= 300).length },
    sample: Object.fromEntries(Object.entries(sample).map(([k, xs]) => [k, { n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: Math.max(...xs), within_300ms: xs.filter((x) => x <= 300).length, within_400ms: xs.filter((x) => x <= 400).length }])),
  };
  out.sent_to_mem0 = { messages: sentCount, chars: sentChars, scenarios: scenarios.length };

  // Clean up everything this run wrote.
  const cleanup: unknown[] = [];
  const del = client as unknown as { deleteAll(o: { userId: string; runId: string }): Promise<unknown> };
  for (const s of scenarios) { try { await del.deleteAll({ userId: USER, runId: s }); cleanup.push(s); } catch (e) { cleanup.push(`${s}: ${String(e).slice(0, 80)}`); } }
  out.cleanup = { deleted_scenarios: cleanup.length };

  mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  const file = new URL(`./out/results-${RUN_TAG}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`wrote ${file.pathname}`);
}

main().catch((err) => { console.error('run-ab failed:', String(err).slice(0, 500)); process.exit(1); });
