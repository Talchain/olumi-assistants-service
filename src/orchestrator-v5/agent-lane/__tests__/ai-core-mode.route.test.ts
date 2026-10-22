/**
 * ⭐ PATH-B `core` THROUGH THE ROUTE (Paul 19 Oct: run the AI core apart from Olumi's meaning layer, on the same build, per
 * request; DL-3 13:4xZ: C4 host asks and rewriters OFF, the readiness facts and the science licence reach the AI as typed
 * context, ONE reply). Harness copied from bypass1-host-prose.route.test.ts: the served Wave B9 b9-1 readback, the real
 * route, a scripted AI, no provider contacted. SYNTHETIC user wording; no journey brief.
 *
 * Each row runs the SAME request twice, once per mode, so the contrast is the mode alone.
 */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { runPressToolResponse } from './fixtures/run-press-model.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { approvalChipIdFor } from '../approval-chips.js';
import { editsRefusedSentence } from '../proposal-object/reply.js';
import { streamWhenAsked } from './stream-when-asked.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB9-unseen1-df15c8c-readback-pre-challenge.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCENARIO = '7e6d5c4b-3a2f-4e1d-8c9b-6a5f4e3d2c1b';
const CORE = { 'x-olumi-ai-mode': 'core' };
/** The core instruction's own opening words (agent-v1-turn.ts `CORE_REPLY_INSTRUCTION`). */
const CORE_RULE = 'In this mode Olumi adds nothing to your reply and rewrites none of it';
/**
 * K3 SCOPE (the AIE's exact wording, inbox/DL-3.md "### AIE → current DL and existing owners — scope wording supplied",
 * 19 Oct 19:5xZ). Copied from the AIE's post, never from the source under test: a change to either side turns the row RED.
 */
const AIE_SCOPE = "Keep a clearly separate situation out of the current scenario's Living Model. If the relationship to the current scenario is unclear, ask one brief scope question before building or changing the model, while continuing useful discussion. Do not ask again when the person has already made the scope clear. Ordinary expansion and what-ifs within this scenario remain allowed. If the available tools cannot create or work in a separate scenario, say so; do not claim it was created or put its facts into this model instead.";
const AI_WORDS = 'The analysis ran.';

const rows = new Map<string, { id: string; turn_id: string; request_hash: string; assistant_message?: string; user_message?: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage, user_message: w.userMessage };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  // The scenario's saved Conversation id (`scenarios.openai_conversation_id`); `undefined` = the column is absent.
  readOpenAiConversationId: vi.fn(async (sid: string): Promise<string | null | undefined> => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string): Promise<string | null | undefined> => {
    if (!conversationIds.has(sid)) conversationIds.set(sid, id);
    return conversationIds.get(sid);
  }),
  // The scenario's paused SDK run (`scenarios.openai_paused_run`); none unless a row sets one.
  readOpenAiPausedRun: vi.fn(async (): Promise<{ pause_id: string; proposal_id: string | null; call_id: string; tool: string; state: string } | null> => null),
  saveOpenAiPausedRun: vi.fn(async () => true),
  takeOpenAiPausedRun: vi.fn(async () => true),
};
const conversationIds = new Map<string, string>();
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

/** A whole Responses API body around scripted output items (the SDK reads ids, roles and status as the API sends them). */
let served = 0;
const responsesBody = (output: Record<string, unknown>[]): Json => {
  served += 1;
  return {
    id: `resp_${served}`, object: 'response', model: RETURNED_MODEL, status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed',
          content: (item.content as Json[]).map((c) => ({ ...c, annotations: [] })) }
      : { id: `fc_${served}_${i}`, status: 'completed', ...item }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  };
};
/** The model the scripted provider says served each call (`response.model`). */
const RETURNED_MODEL = 'gpt-scripted-returned';

/** The b9-1 graph with its goal target removed: the host would add its own ask and lines after the AI's words. */
const NO_TARGET_GRAPH = ((): Json => {
  const g = structuredClone(READ.graph) as Json;
  const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
  for (const k of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold_cap_provenance', 'success_threshold', 'threshold_source']) delete goal[k];
  return g;
})();

describe('PATH-B core: the AI\'s own words are the reply; protocol, cards, results and replay are unchanged', () => {
  let app: FastifyInstance;
  let graph: Json = READ.graph;
  let state: Json = READ.analysis_state;
  const sent: string[] = [];
  let outputs: Record<string, unknown>[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      // The core lane's one OpenAI Conversation per scenario (`core/sdk-turn.ts`).
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_route', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      // A `core` Run press runs on the SDK (gap 4): its forced first call gets a whole Responses body calling run_analysis.
      if (body.conversation !== undefined && (body.tool_choice as Json | undefined)?.name === 'run_analysis') {
        return new Response(JSON.stringify(responsesBody([{ type: 'function_call', name: 'run_analysis', call_id: 'core_run_press',
          arguments: JSON.stringify({ reason: 'The user pressed Run.', effects_timing: null }) }])), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const runCall = runPressToolResponse(body);
      if (runCall) return runCall;
      sent.push(typeof init?.body === 'string' ? init.body : '');
      const output = outputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: AI_WORDS }] }];
      return new Response(JSON.stringify(responsesBody(output)), { status: 200, headers: { 'content-type': 'application/json' } });
    })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [READ.analysis_result], analysis_ready: READ.analysis_ready, analysis_state: state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({
      graph, graph_hash: READ.graph_hash, analysis_state: state,
      analysis_ready: READ.analysis_ready, analysis_result: READ.analysis_result,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); conversationIds.clear(); store.takeOpenAiPausedRun.mockClear(); sent.length = 0; graph = READ.graph; state = READ.analysis_state; outputs = []; });

  const typed = async (message: string, headers: Record<string, string> = {}, turnId = randomUUID()): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers, payload: {
      kind: 'message', turn_id: turnId, scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', message, source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };

  it('⭐ RED→GREEN: a typed turn on a model with no target: full mode adds host lines after the AI; core ships the AI\'s words exactly', async () => {
    graph = NO_TARGET_GRAPH;
    const full = await typed('What should I look at next?');
    expect(full._agent.mode).toBe('full');
    expect(full._diagnostic_trace.reply_author).toBe('ai');
    // Contrast (today): the host adds its own lines after the AI's words.
    expect(full.assistant_text.startsWith(AI_WORDS)).toBe(true);
    expect(full.assistant_text.length).toBeGreaterThan(AI_WORDS.length);
    expect(sent.some((b) => b.includes(CORE_RULE)), 'outside core the instructions are unchanged').toBe(false);
    expect(sent.some((b) => b.includes('Keep a clearly separate situation')), 'the scope wording is core\'s only').toBe(false);

    sent.length = 0;
    const core = await typed('What should I look at next?', CORE);
    expect(core._agent.mode, 'the witness reads the mode on the wire').toBe('core');
    // The ordinary typed turn ran on the Agents SDK: its runtime on the wire, and each provider row's witness fields.
    expect(core._agent.sdk?.runtime).toBe('@openai/agents@0.18.0');
    expect(core._agent.sdk?.state).toBe('openai_conversation');
    expect(core._agent.sdk?.conversation_id).toBe('conv_route');
    const rows = (core._provider_calls as Json[]).filter((c) => c.site === 'agent-core.sdk');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.returned_model).toBe(RETURNED_MODEL);
      expect(row.tool_names).toContain('build_model_from_brief');
      expect(row.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(full._agent.sdk, 'the full lane keeps its own loop').toBeUndefined();
    expect(core._diagnostic_trace.reply_author).toBe('ai');
    expect(core.assistant_text).toBe(AI_WORDS);
    // The facts the host would have said reach the AI as typed context instead, with the core rule.
    const converse = sent.find((b) => b.includes('CURRENT MODEL STATE'));
    expect(converse, 'the converse call carries the state').toBeDefined();
    expect(converse!).toContain('goal_target_missing');
    expect(converse!).toContain(CORE_RULE);
    // K3: the AIE's scope wording rides the SAME instructions, byte for byte, on every core call; the full lane never has it.
    const coreCalls = sent.filter((b) => b.includes(CORE_RULE));
    expect(coreCalls.length).toBeGreaterThan(0);
    for (const b of coreCalls) expect((JSON.parse(b) as Json).instructions as string).toContain(AIE_SCOPE);
    // The graph readback is unchanged; core readiness stays in AI context rather than a host panel.
    expect(core.graph_hash).toBe(full.graph_hash);
    expect(full.analysis_ready).toBeDefined();
    expect(core.analysis_ready).toBeUndefined();
  });

  const press = async (id: string, message: string, headers: Record<string, string> = CORE, turnId = randomUUID()): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers, payload: {
      kind: 'message', turn_id: turnId, scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', message, source: 'chip', chip: { id } } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };

  it('⭐ RED→GREEN (Lenses step 0, served d96a687f): on core, a press whose legacy card can never be saved there runs the core turn on its own words, with no Run', async () => {
    const presses: readonly (readonly [string, string])[] = [
      ['agent-next-widen', 'What else could you do?'],
      ['agent-suggest-starting-assumptions', 'Suggest starting assumptions for what this model is missing, so I can review and approve them.'],
      ['act:confirm_reading', 'Check how Olumi works out the goal.'],
      // No handler answers this press: it went to the legacy loop, whose cards never save on core.
      ['ask:missing-factor', 'What else could change how this turns out that the model doesn’t have yet?'],
    ];
    for (const [id, message] of presses) {
      sent.length = 0;
      const turnId = randomUUID();
      const core = await press(id, message, CORE, turnId);
      expect(core._agent.sdk?.runtime, id).toBe('@openai/agents@0.18.0');
      // ⛔ Codex r1 #3604: still a press on the record. Its row's hash keeps the chip, so a restart never proves its words typed,
      // and typed words under the same turn id are a different request (refused, never this press's answer).
      expect(rows.get(turnId)?.request_hash, id).toContain('#chip:');
      const reused = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE, payload: {
        kind: 'message', turn_id: turnId, scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', message, source: 'composer' } });
      expect(reused.statusCode, id).toBe(409);
      expect(reused.json().error, id).toBe('TURN_ID_REUSED');
      expect(sent.some((b) => b.includes(CORE_RULE) && b.includes(JSON.stringify(message).slice(1, -1))), `${id}: the press's words reach the AI`).toBe(true);
      // A press carries no consent to Run: the core turn is offered every tool but run_analysis.
      const calls = (core._provider_calls as Json[]).filter((c) => c.site === 'agent-core.sdk');
      expect(calls.length, id).toBeGreaterThan(0);
      for (const row of calls) {
        expect(row.tool_names, id).toContain('propose_change');
        expect(row.tool_names, id).not.toContain('run_analysis');
      }
    }
    // CONTRAST: a typed core turn is offered run_analysis, and the full lane keeps its own path for the same press.
    const typedRows = ((await typed('What else could you do?', CORE))._provider_calls as Json[]).filter((c) => c.site === 'agent-core.sdk');
    expect(typedRows.some((r) => (r.tool_names as string[]).includes('run_analysis'))).toBe(true);
    expect((await press('agent-next-widen', 'What else could you do?', {}))._agent.sdk).toBeUndefined();
  });

  it('every core turn takes the core-aligned instructions (buddy SIMPLER on #3571): never the legacy writers core does not have, with or without the old arm header', async () => {
    const instructionsSent = (): string[] => sent.filter((b) => b.includes(CORE_RULE)).map((b) => (JSON.parse(b) as Json).instructions as string);
    for (const headers of [CORE, { ...CORE, 'x-olumi-prompt-arm': 'B' }, { ...CORE, 'x-olumi-prompt-arm': 'A' }]) {
      sent.length = 0;
      await typed('What does the model say now?', headers);
      const calls = instructionsSent();
      expect(calls.length, 'a core provider call was captured').toBeGreaterThan(0);
      for (const i of calls) {
        expect(i).toContain("Do not treat a typed yes or your own interpretation as the card's approval.");
        // The legacy proposing writers are not core tools: the default arm A named them (propose_starting_point).
        expect(i).not.toContain('propose_starting_point');
      }
    }
  });

  it('drafting guidance (Paul 21 Oct, the benchmarked drafting prompt): a core turn with no saved model sends it and says so; the off arm withholds it; a saved model is n/a', async () => {
    // Copied from the guidance's opening, never imported: a change to either side turns the row RED.
    const DRAFTING = 'DRAFTING THE FIRST MODEL. Build the leanest model that captures what decides this situation';
    const instructionsSent = (): string[] => sent.filter((b) => b.includes(CORE_RULE)).map((b) => (JSON.parse(b) as Json).instructions as string);
    graph = null as never;
    const on = await typed('We are weighing two ways to grow next year.', CORE);
    expect(on._agent.draft_arm).toBe('on');
    expect(instructionsSent().length, 'a core provider call was captured').toBeGreaterThan(0);
    for (const i of instructionsSent()) expect(i).toContain(DRAFTING);
    sent.length = 0;
    const off = await typed('We are weighing two ways to grow next year.', { ...CORE, 'x-olumi-draft-arm': 'off' });
    expect(off._agent.draft_arm).toBe('off');
    expect(instructionsSent().length).toBeGreaterThan(0);
    for (const i of instructionsSent()) expect(i).not.toContain(DRAFTING);
    // CONTROL: a saved model never takes it; outside core no arm is said.
    sent.length = 0;
    graph = READ.graph;
    const saved = await typed('What does the model say now?', CORE);
    expect(saved._agent.draft_arm).toBe('n/a');
    expect(instructionsSent().length).toBeGreaterThan(0);
    for (const i of instructionsSent()) expect(i).not.toContain(DRAFTING);
    expect((await typed('What does the model say now?'))._agent.draft_arm).toBeUndefined();
  });

  it('effort arm (programme-docs #94): the header sets the builder\u2019s effort on the provider call; without it the call takes the banked medium', async () => {
    const effortsSent = (): unknown[] => sent.filter((b) => b.includes(CORE_RULE)).map((b) => (JSON.parse(b) as Json).reasoning?.effort);
    await typed('What does the model say now?', { ...CORE, 'x-olumi-core-effort': 'high' });
    expect(effortsSent().length).toBeGreaterThan(0);
    expect(new Set(effortsSent())).toEqual(new Set(['high']));
    // CONTROL: the same core turn without the header takes the banked effort (medium since the 22 Oct A/B/C).
    sent.length = 0;
    await typed('What does the model say now?', CORE);
    expect(new Set(effortsSent())).toEqual(new Set(['medium']));
  });

  it('⛔ a core turn whose scenario cannot hold its Conversation id stops before any model call, with a typed 503', async () => {
    store.readOpenAiConversationId.mockImplementationOnce(async () => undefined);
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', message: 'What next?', source: 'composer' } });
    expect(r.statusCode, r.body).toBe(503);
    expect(r.json()).toMatchObject({ error: 'CORE_STATE_UNAVAILABLE', detail: 'store_cannot_hold_id', _agent: { mode: 'core' } });
    expect(sent.filter((b) => b.includes(CORE_RULE)), 'no model call').toHaveLength(0);
    // Contrast: the same store with the column continues normally.
    await typed('What next?', CORE);
    expect(conversationIds.get(SCENARIO)).toBe('conv_route');
  });

  it('⛔ a core press on the paused change that carries edits (here malformed) is refused before anything resumes: nothing written', async () => {
    const pid = `prop_${'c'.repeat(32)}`;
    store.readOpenAiPausedRun.mockImplementation(async () => ({ pause_id: 'pause-1', proposal_id: pid, call_id: 'call-1', tool: 'apply_change', state: '{}' }));
    try {
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE, payload: {
        kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', source: 'chip',
        message: 'Yes, make this change.', chip: { id: approvalChipIdFor(pid) },
        proposal_edits: { proposal_id: pid, revision: 7, digest: 42, graph_hash: 'h', fields: 'not-a-list' } } });
      expect(r.statusCode, r.body).toBe(200);
      expect(String((r.json() as Json).assistant_text).startsWith(editsRefusedSentence('malformed')), 'the existing refusal, first').toBe(true);
      expect((r.json() as Json)._agent.mutated).toBe(false);
      expect(store.takeOpenAiPausedRun, 'the paused run is never taken, so nothing resumes').not.toHaveBeenCalled();
      expect(sent.filter((b) => b.includes(CORE_RULE)), 'no model call').toHaveLength(0);
    } finally {
      store.readOpenAiPausedRun.mockImplementation(async () => null);
    }
  });

  it('a core turn\'s durable row holds the AI\'s words, and resending the same turn replays those exact bytes', async () => {
    graph = NO_TARGET_GRAPH;
    const turnId = randomUUID();
    const first = await typed('What should I look at next?', CORE, turnId);
    expect(rows.get(turnId)?.assistant_message).toBe(AI_WORDS);
    sent.length = 0;
    const again = await typed('What should I look at next?', CORE, turnId);
    expect(again._agent.stopped_reason).toBe('replayed');
    expect(again.assistant_text).toBe(first.assistant_text);
    expect(sent, 'a replay makes no provider call').toHaveLength(0);
  });

  it('Explain under a withheld leader licence: full mode rewrites the AI\'s ranking; core does not, and the licence reached the AI', async () => {
    state = { ...READ.analysis_state, leader_claim: { permitted: false, separation: 'not_separated', withheld_reason: 'separation_unavailable' } };
    const run = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } } });
    expect(run.statusCode, run.body).toBe(200);
    const chip = ((run.json() as Json).suggested_actions as { id: string }[]).find((c) => c.id.startsWith('agent-explain-run:'));
    expect(chip, 'the Explain control is protocol, unchanged in core').toBeDefined();
    const ranked = `${AI_WORDS} Option A is the one to pick.`;
    const explain = async (headers: Record<string, string>): Promise<Json> => {
      outputs = [[{ type: 'message', content: [{ type: 'output_text', text: ranked }] }]];
      sent.length = 0;
      const e = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers, payload: {
        kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
        message: RUN_EXPLANATION_MESSAGE, source: 'chip_click', chip: { id: chip!.id } } });
      expect(e.statusCode, e.body).toBe(200);
      return e.json() as Json;
    };
    const full = await explain({});
    expect(full._diagnostic_trace.fast_path).toBe('explain');
    expect(full.assistant_text).not.toBe(ranked);
    const core = await explain(CORE);
    expect(core._diagnostic_trace.fast_path).toBe('explain');
    expect(core.assistant_text, 'core: no host rewrite; the AI owns the reply').toBe(ranked);
    // The science licence is typed context for the AI (the withheld claim and its reason), with the core rule.
    expect(sent[0] ?? '').toContain('separation_unavailable');
    expect(sent[0] ?? '').toContain(CORE_RULE);
  });

  it('⛔ never in production: the same header on a production runtime keeps the full lane, its host lines and its instructions', async () => {
    graph = NO_TARGET_GRAPH;
    const before = process.env.OLUMI_ENV;
    process.env.OLUMI_ENV = 'prod';
    try {
      const prod = await typed('What should I look at next?', CORE);
      expect(prod._agent.mode).toBe('full');
      expect(prod.assistant_text.length).toBeGreaterThan(AI_WORDS.length);
      expect(sent.some((b) => b.includes(CORE_RULE))).toBe(false);
    } finally {
      if (before === undefined) delete process.env.OLUMI_ENV; else process.env.OLUMI_ENV = before;
    }
  });
});
