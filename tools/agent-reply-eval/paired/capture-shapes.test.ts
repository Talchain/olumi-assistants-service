/**
 * TASK A — capture the EXACT OpenAI request bodies the served route code (CEE 57f903c) builds,
 * by running the REAL `agentV1TurnRoute` in-process against a product double.
 *
 *   (1) FP3 explicit-Run requests from SERVED data (pricing: complete; hiring: blocked) —
 *       intercepted, answered with the SERVED assistant_text, no paid call.
 *   (3) The R&C fragile-link discussion card, sent after the pricing FP3 turn in the same
 *       session — first hop intercepted, no paid call.
 *   (2) LIVE construction turns (RUN_LIVE_CAPTURE=1) — real, paid OpenAI calls through the
 *       route's own callModel/callStructured for three briefs.
 *
 * OpenAI ONLY: Anthropic env is scrubbed and asserted absent; global fetch is wrapped so any
 * host other than https://api.openai.com/ throws before send (`capture/network-guard.ts`).
 * Every request is written (Authorization redacted) before it is sent; outputs are append-only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import {
  installGuard, beginTurn, endTurn, writeOnce, sha256, guardStats, assertNoAnthropicEnv, type CallRecord,
} from './capture/network-guard.js';
import { ProductDouble, type ServedScenario, type StoreScenario } from './capture/product-double.js';
import { loadServed, durableRowsFor, servedGraph, runResponseFor, fragileLinkFor, type ServedCase } from './capture/served.js';
import { promptsFromSource, type SourcePrompts } from './capture/source-instructions.js';

const H = vi.hoisted(() => {
  const removed: string[] = [];
  for (const k of Object.keys(process.env)) {
    if (/ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY') { delete process.env[k]; removed.push(k); }
  }
  process.env['AGENT_LANE_ENABLED'] = 'true';
  process.env['AGENT_LANE_PREVIEW'] = 'false';
  const durable = new Map<string, unknown[]>();
  const readRecentCalls: string[] = [];
  const store = {
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async () => null,
    append: async () => ({ id: 'row-capture' }),
    // `readRecent` returns NEWEST FIRST, as SupabaseSessionStore does.
    readRecent: async (sid: string) => { readRecentCalls.push(sid); return durable.get(sid) ?? []; },
  };
  return { removed, durable, store, readRecentCalls };
});
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({ getSessionStore: () => H.store }));
vi.mock('../../../src/orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(ROOT, 'Docs/evals/agent-reply/paired/57f903c/shapes');
const ROUTE_FILE = join(ROOT, 'src/routes/agent-v1-turn.ts');
const LIVE = process.env['RUN_LIVE_CAPTURE'] === '1';
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');

type J = Record<string, any>;
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as J)[k]])) : x));
const diffKeys = (a: J | undefined, b: J | undefined): string[] => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].filter((k) => canon((a ?? {})[k]) !== canon((b ?? {})[k])).sort();
};
const rel = (p: string): string => p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p;

let app: FastifyInstance;
let double: ProductDouble;
let prompts: SourcePrompts;
let route: J;
let deps: J;
let toolNames: string[] = [];

interface TurnOutcome { res: { statusCode: number; json: J }; records: CallRecord[]; dir: string }

async function runTurn(ctx: Parameters<typeof beginTurn>[0], payload: J): Promise<TurnOutcome> {
  const dir = beginTurn(ctx);
  writeOnce(join(dir, 'route-request.json'), { method: 'POST', url: '/agent/v1/turn', payload, note: 'in-process app.inject; no turn_id (it drives only the durable claim/answer rows, never the provider request)' });
  const started = Date.now();
  let res;
  try {
    res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
  } finally {
    // Whatever happened, the calls already on disk stay; the dispatch log is saved too.
    writeOnce(join(dir, 'internal-dispatch.json'), double.drainLog());
  }
  const records = endTurn();
  let json: J = {};
  try { json = res.json() as J; } catch { json = { _unparseable: res.body }; }
  writeOnce(join(dir, 'route-response.json'), { status: res.statusCode, wall_ms: Date.now() - started, body: json });
  return { res: { statusCode: res.statusCode, json }, records, dir };
}

function callSummary(r: CallRecord): J {
  return {
    call: r.call, purpose: r.purpose, hop: r.hop, during_hop: r.during_hop, final_reply_hop: r.final_reply_hop,
    paid: r.paid, intercepted: r.intercepted, http_status: r.http_status, wall_ms: r.wall_ms, model: r.model,
    function_calls: r.function_calls,
    usage: r.usage === null ? null : {
      input_tokens: r.usage['input_tokens'], cached_tokens: r.usage['cached_tokens'], output_tokens: r.usage['output_tokens'],
      reasoning_tokens: r.usage['reasoning_tokens'], total_tokens: r.usage['total_tokens'],
    },
  };
}

beforeAll(async () => {
  assertNoAnthropicEnv();
  mkdirSync(OUT, { recursive: true });
  installGuard(OUT);
  prompts = promptsFromSource(ROUTE_FILE);
  vi.resetModules();
  route = await import('../../../src/routes/agent-v1-turn.js');
  const tools = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-tools.js');
  toolNames = (tools.toolsFor('full') as { name: string }[]).map((t) => t.name);
  // Explicit picks (no spread): each helper comes from the module the real register/read routes import it from.
  deps = {
    normaliseGraphNodeKindField: (await import('../../../src/orchestrator-v5/graph-registration/normalise-node-kind.js')).normaliseGraphNodeKindField,
    GraphStateIngressSchema: (await import('../../../src/orchestrator-v5/boundary/request-extensions.js')).GraphStateIngressSchema,
    projectGraphForPersistence: (await import('../../../src/orchestrator-v5/persisted-graph-projection.js')).projectGraphForPersistence,
    computeGraphIdentityHash: (await import('../../../src/orchestrator-v5/context/graph-identity.js')).computeGraphIdentityHash,
    computeAnalysisAffectingGraphHash: (await import('../../../src/orchestrator-v5/context/graph-hash.js')).computeAnalysisAffectingGraphHash,
    computeExpectedGraphCasHashes: (await import('../../../src/orchestrator-v5/context/graph-cas-conflict.js')).computeExpectedGraphCasHashes,
    assertNoIntroducedGraphViolations: (await import('../../../src/orchestrator-v5/persist-graph-write.js')).assertNoIntroducedGraphViolations,
  };
  for (const [k, v] of Object.entries(deps)) if (v === undefined) throw new Error(`capture dependency missing: ${k}`);
  double = new ProductDouble(deps as never);
  app = Fastify({ logger: false });
  double.mount(app);
  await app.register(route['agentV1TurnRoute']);
  await app.ready();
}, 600_000);

afterAll(async () => {
  await app?.close();
  mkdirSync(join(OUT, '_runs'), { recursive: true });
  writeOnce(join(OUT, '_runs', `${RUN_STAMP}-${LIVE ? 'live' : 'intercept'}.json`), {
    run_stamp: RUN_STAMP, live: LIVE, head: '57f903c4652783a9de1a3778d6682a8e5f8414e1',
    anthropic_env_removed_at_start: H.removed, anthropic_env_absent_at_end: Object.keys(process.env).filter((k) => /ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY').length === 0,
    guard: guardStats(), unexpected_internal_dispatch: double?.unexpected ?? [],
    source_prompt_sha256: prompts?.sha256,
  });
});

/* ────────────────────────────── (1)+(3) FP3 from served data ────────────────────────────── */

async function prepareServedScenario(c: ServedCase): Promise<J> {
  const draft = servedGraph(c);
  const projected = deps['projectGraphForPersistence'](JSON.parse(JSON.stringify(draft)), { scenarioId: c.scenario_id, turnClass: 'direct_answer', source: 'graph_registration' });
  const servedHash = String(c.explicitRun.response['graph_hash']);
  const candidates = [
    { name: 'draft_graph_as_served', graph: draft, hash: deps['computeAnalysisAffectingGraphHash'](draft) },
    { name: 'draft_graph_projected_for_persistence', graph: projected, hash: deps['computeAnalysisAffectingGraphHash'](projected) },
  ];
  const chosen = candidates.find((x) => x.hash === servedHash) ?? candidates[0]!;
  const scenario: ServedScenario = {
    mode: 'served',
    graph: chosen.graph as J,
    graph_hash: servedHash,
    analysis_state: c.explicitRun.response['analysis_state'],
    analysis_result: (c.explicitRun.response['blocks'] as J[]).find((b) => b['type'] === 'analysis_result') ?? null,
    run_response: runResponseFor(c),
  };
  double.scenarios.set(c.scenario_id, scenario);
  // The SERVED code path: the read route sends no analysis_ready, so readBackState derives it.
  const derived = await route['readBackState'](async (path: string) => {
    const id = path.split('/')[4]!;
    return double.readFor(id);
  }, c.scenario_id);
  double.drainLog();
  const servedReady = c.explicitRun.response['analysis_ready'] as J;
  const readyDiff = diffKeys(derived.analysisReady as J, servedReady);
  let readinessMode: 'derived_from_graph' | 'served_verbatim' = 'derived_from_graph';
  if (readyDiff.length > 0) {
    // Fallback: hand the served readiness over verbatim (the route then re-stamps freshness and
    // current_graph_hash from the SAME served inputs). The diff is recorded, not hidden.
    scenario.analysis_ready = servedReady;
    readinessMode = 'served_verbatim';
  }
  return {
    graph_candidates: candidates.map((x) => ({ name: x.name, analysis_hash: x.hash, matches_served_graph_hash: x.hash === servedHash })),
    graph_chosen: chosen.name,
    served_graph_hash: servedHash,
    readiness_mode: readinessMode,
    derived_vs_served_analysis_ready_diff_keys: readyDiff,
  };
}

function fp3Checks(c: ServedCase, body: J, reconstruction: J): J {
  const input = body['input'] as J[];
  const out = input.find((i) => i['type'] === 'function_call_output');
  const ran = out ? JSON.parse(String(out['output'])) as J : {};
  const canonicalState = (ran['canonical_state'] ?? {}) as J;
  const servedState = c.explicitRun.response['analysis_state'];
  const servedReady = c.explicitRun.response['analysis_ready'] as J;
  const instr = String(body['instructions'] ?? '');
  const seededUserTexts = input.filter((i) => i['role'] === 'user').map((i) => (i['content'] as J[])?.[0]?.['text']);
  return {
    instructions_sha256_equals_source_fp3: { pass: sha256(instr) === prompts.sha256.fast_path_3_instructions, captured: sha256(instr), source: prompts.sha256.fast_path_3_instructions },
    instructions_end_with_exported_v02: { pass: instr.endsWith(String(route['INTERPRETER_V02_BANKED'])) },
    v02_sha256_prefix_is_banked_3d979e8406693be4: { pass: prompts.sha256.interpreter_v02.startsWith('3d979e8406693be4'), source: prompts.sha256.interpreter_v02 },
    source_constants_equal_module_exports: { pass: prompts.interpret_only === route['INTERPRET_ONLY_CONSTRAINT'] && prompts.interpreter_v02 === route['INTERPRETER_V02_BANKED'] },
    tool_choice_none: { pass: body['tool_choice'] === 'none' },
    tools_empty: { pass: Array.isArray(body['tools']) && (body['tools'] as unknown[]).length === 0 },
    model_is_gpt_5_6_terra: { pass: body['model'] === 'gpt-5.6-terra' },
    max_output_tokens_3400: { pass: body['max_output_tokens'] === 3400 },
    no_reasoning_field: { pass: !('reasoning' in body) },
    input_item_shape: { pass: true, types: input.map((i) => i['type'] ?? `role:${i['role']}`) },
    seeded_history_is_served_durable_turns: {
      pass: canon(seededUserTexts.slice(0, 2)) === canon([c.construction.request['message'], c.approve.request['message']]),
      user_texts: seededUserTexts,
    },
    run_pair_present: { pass: input.some((i) => i['type'] === 'function_call' && i['name'] === 'run_analysis') && out !== undefined },
    canonical_state_analysis_state_equals_served: { pass: canon(canonicalState['analysis_state']) === canon(servedState) },
    canonical_state_analysis_ready_equals_served: {
      pass: canon(canonicalState['analysis_ready']) === canon(servedReady),
      diff_keys: diffKeys(canonicalState['analysis_ready'] as J, servedReady),
      readiness_mode: reconstruction['readiness_mode'],
    },
    leader_claim_reaches_interpreter: { pass: JSON.stringify(canonicalState).includes('leader_claim'), leader_claim: (servedState as J)?.['leader_claim'] },
    ran_flags: { ran: ran['ran'], status: ran['status'], what_is_missing: ran['what_is_missing'], result_present: ran['result'] !== undefined, options: Array.isArray(ran['options']) ? ran['options'].length : null, blockers: ran['blockers'] },
    scenario_id_in_request: { present: JSON.stringify(body).includes(c.scenario_id), note: 'informational: the served scenario id is reused in-process' },
  };
}

const FP3_FIDELITY = (c: ServedCase): J => ({
  exact: [
    'instructions: AGENT_INSTRUCTIONS + "\\n\\n" + INTERPRET_ONLY_CONSTRAINT + "\\n\\n" + INTERPRETER_V02_BANKED, built by the real route at 57f903c and sha256-checked against the same constants re-derived from the source text',
    'model / max_output_tokens / tools [] / tool_choice none, from the real callModel (BANKED_BUDGETS conversation: gpt-5.6-terra, 3400); no reasoning field',
    'the run pair: the real route builds the user message, the synthetic function_call run_analysis and its function_call_output from the real run_analysis capability',
    'canonical_state.analysis_state: the SERVED explicit-run analysis_state, handed through the real readBackState',
    'canonical_state.analysis_ready: see checks.canonical_state_analysis_ready_equals_served (derived by the real readBackState from the served graph when it reproduces the served value; otherwise served verbatim, then re-stamped by the route)',
    `the user message "${c.explicitRun.request['message']}" and chip ${JSON.stringify(c.explicitRun.request['chip'])} exactly as served`,
  ],
  approximated: [
    'HISTORY: seeded from the two durable turns (construction, approve) exactly as the route\'s own restart seeding (historyFromDurableTurns over store.readRecent) presents them — user text + the FINAL served assistant_text. The served process held the construction turn\'s in-process items instead (reasoning items, get_canonical_state/build_model_from_brief/propose_starting_point function_call + function_call_output pairs, and the model\'s pre-post-processing final message). Those raw tool items are NOT reproducible from the served captures; this is the only history approximation.',
    'ran.what_is_missing: the internal conventional Run\'s assistant_text was not captured and the Agent route echoes it nowhere in its response, so the double answers "" (the served value is unknown).',
    'ran.status / ran.options / ran.blockers: read from the SERVED explicit-run analysis_ready (the route\'s final readback), standing in for the internal conventional turn\'s own analysis_ready, which was not captured.',
    'ran.result: the SERVED analysis_result block from the final readback (bound to the same fact), standing in for the block the internal conventional turn returned.',
    'call_id: fast_run_<Fastify req.id> — same shape as served (default Fastify id "req-N"), different N.',
    'no turn_id is sent in-process: turn_id drives only the durable claim/answer rows, never the provider request.',
    'the intercepted answer is the SERVED assistant_text (the route\'s post-processing on this path is a pass-through: no write narration, no stripping) so the turn completes; no model output was generated here.',
  ],
});

describe.skipIf(LIVE)('FP3 explicit Run + discussion card, from SERVED 57f903c data (intercepted, no paid call)', () => {
  let pricing: ServedCase;
  it('pricing-run-complete: the exact FP3 request for a COMPLETE run with leader_claim withheld', async () => {
    pricing = loadServed('pricing');
    const reconstruction = await prepareServedScenario(pricing);
    H.durable.set(pricing.scenario_id, durableRowsFor(pricing));
    const servedText = String(pricing.explicitRun.response['assistant_text']);
    const payload = Object.fromEntries(Object.entries(pricing.explicitRun.request).filter(([k]) => k !== 'turn_id'));
    const t = await runTurn({
      caseId: 'pricing-run-complete', turn: 'explicit-run', mode: 'intercept',
      intercept: () => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: servedText }] }],
    }, payload);
    const body = JSON.parse(readFileSync(join(t.dir, 'call-01.request.json'), 'utf8'))['body'] as J;
    const checks = fp3Checks(pricing, body, reconstruction);
    writeOnce(join(t.dir, 'turn-summary.json'), {
      case: 'pricing-run-complete', turn: 'explicit-run', purpose: 'fp3-explicit-run', status: t.res.statusCode,
      fast_path: t.res.json['_diagnostic_trace']?.['fast_path'], tools_called: t.res.json['_diagnostic_trace']?.['tools_called'],
      calls: t.records.map(callSummary), reply_writing_request: rel(join(t.dir, 'call-01.request.json')),
      assistant_text_matches_served: t.res.json['assistant_text'] === servedText,
      served_reference: { files: pricing.files, served_input_tokens: pricing.explicitRun.response['_provider_calls']?.[0]?.['usage']?.['input_tokens'] ?? null, served_usage: pricing.explicitRun.response['_provider_calls']?.[0]?.['usage'] ?? null },
      reconstruction, checks, fidelity: FP3_FIDELITY(pricing), readRecent_calls: H.readRecentCalls.filter((s) => s === pricing.scenario_id).length,
    });
    expect(t.res.statusCode).toBe(200);
    expect(t.records).toHaveLength(1);
    expect(t.res.json['_diagnostic_trace']?.['fast_path']).toBe('run');
    for (const [name, v] of Object.entries(checks)) if ((v as J)['pass'] === false && name !== 'canonical_state_analysis_ready_equals_served') expect.soft((v as J)['pass'], name).toBe(true);
  });

  it('pricing-discussion-card: R&C fragile-link card as an ordinary Agent message — FIRST hop only', async () => {
    const link = fragileLinkFor(pricing);
    expect(link, 'a fragile edge exists in the served pricing analysis').not.toBeNull();
    const message = `Talk me through what would change if the link from ${link!.from_label} to ${link!.to_label} were weaker or stronger. Don't change the model or re-run anything yet.`;
    const payload = { kind: 'message', scenario_id: pricing.scenario_id, stage: 'frame', message, source: 'chip', chip: { id: 'evidence-apply-1790000000000' } };
    const t = await runTurn({
      caseId: 'pricing-discussion-card', turn: 'discussion-card', mode: 'intercept',
      intercept: () => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '(capture only: no reply was generated for this hop)' }] }],
    }, payload);
    const body = JSON.parse(readFileSync(join(t.dir, 'call-01.request.json'), 'utf8'))['body'] as J;
    const input = body['input'] as J[];
    const instr = String(body['instructions'] ?? '');
    const checks = {
      instructions_equal_source_agent_instructions: { pass: sha256(instr) === prompts.sha256.agent_instructions, captured: sha256(instr), source: prompts.sha256.agent_instructions },
      tools_are_full_mode_toolset: { pass: canon((body['tools'] as J[]).map((x) => x['name'])) === canon(toolNames), names: (body['tools'] as J[]).map((x) => x['name']) },
      no_tool_choice: { pass: !('tool_choice' in body) },
      last_item_is_the_card_message: { pass: input.at(-1)?.['role'] === 'user' && (input.at(-1)?.['content'] as J[])?.[0]?.['text'] === message },
      carries_the_fp3_run_pair_and_answer: { pass: input.some((i) => i['type'] === 'function_call_output') && input.some((i) => i['type'] === 'message' && i['role'] === 'assistant') },
      not_a_fast_path: { pass: t.res.json['_diagnostic_trace']?.['fast_path'] === undefined },
      input_item_types: input.map((i) => i['type'] ?? `role:${i['role']}`),
    };
    writeOnce(join(t.dir, 'turn-summary.json'), {
      case: 'pricing-discussion-card', turn: 'discussion-card', purpose: 'discussion-card-first-hop', status: t.res.statusCode,
      session: `sess_${pricing.scenario_id} (same in-process session as pricing-run-complete, immediately after it)`,
      message, chip: payload.chip, fragile_link: link,
      calls: t.records.map(callSummary), reply_writing_request: rel(join(t.dir, 'call-01.request.json')),
      reply_writing_note: 'FIRST hop only. In a live turn this hop may instead call a tool (e.g. get_canonical_state), in which case a later hop writes the reply; the paired test replays this first-hop request.',
      checks,
      fidelity: {
        exact: ['instructions = AGENT_INSTRUCTIONS (sha256-checked against the source text)', 'tools = toolsFor("full") (9 tools), no tool_choice', 'model / max_output_tokens from the real callModel', 'the card message and chip id exactly as specified; typed as neither approval nor Run, so it takes runAgentTurn'],
        approximated: ['history = the pricing FP3 turn\'s items (durable-seeded construction + approve text, the FP3 run pair, the SERVED interpretation as a plain assistant message with no reasoning item or id) — see pricing-run-complete fidelity', 'source "chip" and no turn_class are assumptions about the UI payload; the route reads neither'],
      },
    });
    expect(t.res.statusCode).toBe(200);
    expect(t.records).toHaveLength(1);
    for (const [name, v] of Object.entries(checks)) if (typeof v === 'object' && !Array.isArray(v) && (v as J)['pass'] === false) expect.soft((v as J)['pass'], name).toBe(true);
  });

  it('hiring-run-blocked: the exact FP3 request for a BLOCKED run (status-quo option acts on no factor)', async () => {
    const hiring = loadServed('hiring');
    const reconstruction = await prepareServedScenario(hiring);
    H.durable.set(hiring.scenario_id, durableRowsFor(hiring));
    const servedText = String(hiring.explicitRun.response['assistant_text']);
    const payload = Object.fromEntries(Object.entries(hiring.explicitRun.request).filter(([k]) => k !== 'turn_id'));
    const t = await runTurn({
      caseId: 'hiring-run-blocked', turn: 'explicit-run', mode: 'intercept',
      intercept: () => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: servedText }] }],
    }, payload);
    const body = JSON.parse(readFileSync(join(t.dir, 'call-01.request.json'), 'utf8'))['body'] as J;
    const checks = fp3Checks(hiring, body, reconstruction);
    writeOnce(join(t.dir, 'turn-summary.json'), {
      case: 'hiring-run-blocked', turn: 'explicit-run', purpose: 'fp3-explicit-run', status: t.res.statusCode,
      fast_path: t.res.json['_diagnostic_trace']?.['fast_path'], tools_called: t.res.json['_diagnostic_trace']?.['tools_called'],
      suggested_actions: t.res.json['suggested_actions'],
      calls: t.records.map(callSummary), reply_writing_request: rel(join(t.dir, 'call-01.request.json')),
      assistant_text_matches_served: t.res.json['assistant_text'] === servedText,
      served_reference: { files: hiring.files, served_input_tokens: hiring.explicitRun.response['_provider_calls']?.[0]?.['usage']?.['input_tokens'] ?? null, served_usage: hiring.explicitRun.response['_provider_calls']?.[0]?.['usage'] ?? null, served_suggested_actions: hiring.explicitRun.response['suggested_actions'] },
      reconstruction, checks, fidelity: FP3_FIDELITY(hiring),
    });
    expect(t.res.statusCode).toBe(200);
    expect(t.records).toHaveLength(1);
    expect(t.res.json['_diagnostic_trace']?.['fast_path']).toBe('run');
    for (const [name, v] of Object.entries(checks)) if ((v as J)['pass'] === false && name !== 'canonical_state_analysis_ready_equals_served') expect.soft((v as J)['pass'], name).toBe(true);
  });
});

/* ─────────────────────────────── (2) LIVE construction turns ─────────────────────────────── */

const BRIEFS = [
  { caseId: 'hiring-construction', served: 'hiring' as const, brief: 'Should I hire a Tech lead or two developers to increase productivity?' },
  { caseId: 'pricing-construction', served: 'pricing' as const, brief: 'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?' },
  { caseId: 'heldout-ed-triage-construction', served: null, brief: 'Should our hospital emergency department add a second triage nurse on night shifts or open a rapid-assessment unit, given 4-hour waits breach 30% of nights?' },
];

describe.skipIf(!LIVE)('LIVE construction turns through the real route (paid OpenAI calls)', () => {
  for (const b of BRIEFS) {
    it(`${b.caseId}: every hop of a first-turn construction`, async () => {
      expect(typeof process.env['OPENAI_API_KEY'] === 'string' && process.env['OPENAI_API_KEY']!.length > 20, 'OpenAI key present in this process').toBe(true);
      const servedRef = b.served !== null ? loadServed(b.served) : null;
      const sid = randomUUID();
      const neverRun = (servedRef ?? loadServed('hiring')).construction.response['analysis_state'];
      const scenario: StoreScenario = { mode: 'store', graph: null, brief_text: null, never_run_analysis_state: neverRun };
      double.scenarios.set(sid, scenario);
      H.durable.set(sid, []);
      const payload = { kind: 'message', scenario_id: sid, stage: 'frame', turn_class: 'frame', message: b.brief, source: 'user' };
      const t = await runTurn({ caseId: b.caseId, turn: 'construction', mode: 'live' }, payload);
      const conv = t.records.filter((r) => r.purpose === 'conversation');
      const finals = t.records.filter((r) => r.final_reply_hop);
      const finalCall = finals.at(-1) ?? null;
      const toolsCalled = ((t.res.json['_agent']?.['tool_calls'] ?? []) as J[]).map((x) => x['name']);
      const servedTools = servedRef?.construction.response['_diagnostic_trace']?.['tools_called'] ?? null;
      const servedCalls = (servedRef?.construction.response['_provider_calls'] ?? []) as J[];
      const firstHopIn = conv[0]?.usage?.['input_tokens'] ?? null;
      const servedFirstHopIn = servedCalls[0]?.['usage']?.['input_tokens'] ?? null;
      const instrOk = conv.every((r) => r.instructions_sha256 === prompts.sha256.agent_instructions);
      const assistantText = String(t.res.json['assistant_text'] ?? '');
      const summary = {
        case: b.caseId, turn: 'construction', purpose: 'live-construction', status: t.res.statusCode, brief: b.brief,
        scenario_id: sid, stopped_reason: t.res.json['_agent']?.['stopped_reason'], hops: t.res.json['_agent']?.['hops'],
        tools_called: toolsCalled, served_tools_called: servedTools,
        tool_sequence_resembles_served: {
          starts_get_canonical_state_then_build: toolsCalled[0] === 'get_canonical_state' && toolsCalled[1] === 'build_model_from_brief',
          proposes_starting_point: toolsCalled.includes('propose_starting_point'),
          no_run_or_write_on_build_turn: !toolsCalled.includes('run_analysis') && !toolsCalled.includes('authorise_change'),
          identical_to_served: servedTools === null ? null : canon(toolsCalled) === canon(servedTools),
        },
        calls: t.records.map(callSummary),
        paid_calls: t.records.filter((r) => r.paid).length,
        final_reply_call: finalCall?.call ?? null,
        reply_writing_request: finalCall !== null ? rel(join(t.dir, `call-${finalCall.call}.request.json`)) : null,
        final_hop_output_text_in_assistant_text: finalCall !== null ? assistantText.includes(finalCall.output_text.trim().slice(0, 200)) : null,
        assistant_text: assistantText,
        suggested_actions: t.res.json['suggested_actions'],
        first_hop_input_tokens: { captured: firstHopIn, served: servedFirstHopIn, equal: servedFirstHopIn === null ? null : firstHopIn === servedFirstHopIn },
        served_provider_calls: servedCalls.map((p) => ({ purpose: p['purpose'], duration_ms: p['duration_ms'], input_tokens: p['usage']?.['input_tokens'], output_tokens: p['usage']?.['output_tokens'], reasoning_tokens: p['usage']?.['raw']?.['output_tokens_details']?.['reasoning_tokens'] })),
        conversation_instructions_equal_source_agent_instructions: instrOk,
        internal_dispatch_unexpected: double.unexpected.filter((u) => JSON.stringify(u.body).includes(sid)),
        stored_graph_counts: scenario.graph === null ? null : { nodes: (scenario.graph['nodes'] as unknown[]).length, edges: (scenario.graph['edges'] as unknown[]).length },
        fidelity: {
          exact: [
            'every provider request is built by the real route/runtime at 57f903c (AGENT_INSTRUCTIONS, toolsFor("full"), BUILD_INSTRUCTIONS, buildCandidateSchema, BANKED_BUDGETS) and sent by its own callModel/callStructured',
            'tool results come from the real capabilities (get_canonical_state, build_model_from_brief incl. admission and the size gate, propose_* incl. completeness admission)',
            'registration applies the real node-kind normalisation, GraphStateIngress parse, projectGraphForPersistence and invariant check; reads return the real analysis-affecting and identity hashes',
            'empty first turn: no history (a fresh scenario, as served)',
          ],
          approximated: [
            'the product double stands in for Supabase/PLoT: a guest scenario (no versions, no model_version receipt — served receipts were []), and the never_run analysis_state the served read returned after a build',
            'a different generation from the served one: the model output (and so later hops) differs by draw; the served turn is a reference, not a replay',
            'no turn_id: it drives only durable rows, never the provider request',
          ],
        },
      };
      writeOnce(join(t.dir, 'turn-summary.json'), summary);
      expect(t.res.statusCode).toBe(200);
      expect(conv.length).toBeGreaterThanOrEqual(1);
      expect.soft(instrOk, 'conversation instructions are the source AGENT_INSTRUCTIONS').toBe(true);
      expect.soft(finalCall, 'a final reply-writing hop exists').not.toBeNull();
    });
  }

  it('token counts of the captured FP3 + card requests (OpenAI input_tokens endpoint; no generation)', async () => {
    const targets = [
      { caseId: 'pricing-run-complete', turn: 'explicit-run', served: 'pricing' as const },
      { caseId: 'hiring-run-blocked', turn: 'explicit-run', served: 'hiring' as const },
      { caseId: 'pricing-discussion-card', turn: 'discussion-card', served: null },
    ];
    const results: J[] = [];
    for (const x of targets) {
      let req: J;
      try { req = JSON.parse(readFileSync(join(OUT, x.caseId, x.turn, 'call-01.request.json'), 'utf8'))['body'] as J; } catch { results.push({ ...x, error: 'no captured request' }); continue; }
      const countBody = { model: req['model'], instructions: req['instructions'], input: req['input'], tools: req['tools'], ...(req['tool_choice'] !== undefined ? { tool_choice: req['tool_choice'] } : {}) };
      beginTurn({ caseId: x.caseId, turn: `token-count-${RUN_STAMP}`, mode: 'live' });
      let status = 0; let json: J = {};
      try {
        const r = await fetch('https://api.openai.com/v1/responses/input_tokens', {
          method: 'POST',
          headers: { authorization: `Bearer ${process.env['OPENAI_API_KEY'] ?? ''}`, 'content-type': 'application/json' },
          body: JSON.stringify(countBody),
        });
        status = r.status; json = await r.json() as J;
      } catch (err) { json = { error: String(err).slice(0, 200) }; }
      endTurn();
      const servedIn = x.served === null ? null : loadServed(x.served).explicitRun.response['_provider_calls']?.[0]?.['usage']?.['input_tokens'] ?? null;
      results.push({ ...x, status, counted_input_tokens: json['input_tokens'] ?? null, served_input_tokens: servedIn, response: json });
    }
    writeOnce(join(OUT, `_token-counts-${RUN_STAMP}.json`), { note: 'input token counts of the captured (approximated-history) requests vs the served call\'s usage.input_tokens', results });
    expect(results.length).toBe(3);
  });
});
