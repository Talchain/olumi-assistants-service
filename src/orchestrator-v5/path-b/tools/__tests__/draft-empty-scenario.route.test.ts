/**
 * ⛔ CORE CAN DRAFT THE FIRST MODEL (VERIFIER CORE run on 86c9663a, redteam/core-accept/runs/20261019T174921Z: every case failed at
 * turn 1 — `build_model_from_brief` → unavailable `read_malformed`). A NEW scenario's graph read is `graph: null, graph_present:
 * false, graph_hash: null, graph_identity_hash: null` (assist.v1.scenario-graph.ts, "An EMPTY graph is a valid answer"), and the
 * adapters' one reader called that malformed. Through the REAL route in core mode: a scripted AI, the REAL draft adapter (one
 * drafter call with a scripted answer, Step 8's `candidateToGraph`, create-only registration), and the graph / register / versions
 * routes as doubles that answer in the served shapes. SYNTHETIC wording; no journey brief. (The brief stays the AI's literal copy
 * of the user's words, as on base.)
 */
import liveRows from './fixtures/l23-live-drafter-raw-5203fed5.json';
import { runPressToolResponse } from '../../../agent-lane/__tests__/fixtures/run-press-model.js';
import { randomUUID, createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHashSha256, computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { candidateToGraph } from '../candidate-to-graph.js';
import { readCanonicalContext } from '../context-tool.js';
import { resolveRunAdmission } from '../../../tools/handlers/analysis-ready-core.js';
import { settingProvenanceOf, valueProvenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { placeholderGoalPaths, unsizedLeaderGoalPaths } from '../../../agent-lane/goal-certainty.js';
import type { DrafterRawRow } from '../../../drafter-raw/index.js';

const rawRecorder = vi.hoisted(() => ({
  rows: [] as DrafterRawRow[], mode: 'ok' as 'ok' | 'throws' | 'failed' | 'pending',
  release: undefined as (() => void) | undefined,
}));
vi.mock('@supabase/supabase-js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  createClient: () => ({ from: (table: string) => ({ insert: (row: DrafterRawRow) => {
    expect(table).toBe('cee_drafter_raw_responses');
    rawRecorder.rows.push(row);
    if (rawRecorder.mode === 'throws') throw new Error('diagnostic write failed');
    return { abortSignal: () => rawRecorder.mode === 'pending'
      ? new Promise((resolve) => { rawRecorder.release = () => resolve({ error: null }); })
      : Promise.resolve({ error: rawRecorder.mode === 'failed' ? { code: '23503', message: 'refused' } : null }) };
  } }) }),
}));

type Json = Record<string, any>;
/** A NEW scenario per row: the route keeps each scenario's verified typed messages for the process. */
let SCENARIO = '';
const AIM = 'We want to grow weekly bookings to at least 300 within 12 months.';
const BRIEF = [AIM, 'Bookings are 180 a week today.', 'We could add evening slots or run a referral offer.'].join('\n');
const GOAL = 'Weekly bookings';
const OTHER_BRIEF = 'We run a repair workshop and could add a technician or extend opening hours.';

/** The drafter's answer (the lean-core real-path draft shape, lean-core-authorship.route.test.ts). */
const DRAFT = (() => {
  const link = (from: string, to: string): Json => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 300, unit: 'bookings a week', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 180, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Add evening slots', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Evening slots', value: 20, value_kind: 'absolute', unit: 'slots a week', provenance: 'ai_proposed' }] },
    ],
    factors: [{ label: 'Evening slots', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'slots a week', provenance: 'ai_proposed', plausible_max: 60 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [link('Evening slots', GOAL)],
    statements: [{ quote: AIM, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound',
      value: 300, low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null }],
  };
})();

/**
 * ⭐ K5 LOOP SHAPE (VERIFIER 23:47Z on 4d8080ea), synthetic: an added part at 0 today the AI declared `inferred` with no statement of it, and
 * its one-for-one definition into the goal declared `inferred` with no quote.
 */
const ADDED = 'Extra bookings from evening slots';
const ADDED_DRAFT: Json = {
  ...DRAFT,
  factors: [...DRAFT.factors, { label: ADDED, role: 'observable', baseline_known: true, baseline_value: 0, unit: 'bookings a week', provenance: 'inferred', origin: 'olumi', stance: 'estimate', plausible_max: null }],
  links: [{ ...DRAFT.links[0], to: ADDED }, { ...DRAFT.links[0], from: ADDED, effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'inferred', definitional: true }],
};
/**
 * ⭐ K5 P0 RULING SHAPE (option 2, 20 Oct), synthetic: what B's drafter text asks for. The goal's current level is its own fixed factor
 * carrying the goal baseline; the option's effect is a setting on the addition; the goal is declared as their sum, each operand linked one
 * for one in the same unit.
 */
const CURRENT = 'Current weekly bookings';
const SUM_DRAFT: Json = {
  ...DRAFT,
  options: [DRAFT.options[0], { ...DRAFT.options[1], interventions: [{ factor_label: ADDED, value: 20, value_kind: 'absolute', unit: 'bookings a week', provenance: 'explicit' }] }],
  factors: [{ label: CURRENT, role: 'observable', baseline_known: true, baseline_value: 180, unit: 'bookings a week', provenance: 'explicit', plausible_max: null },
    { label: ADDED, role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'bookings a week', provenance: 'inferred', plausible_max: 60 }],
  links: [CURRENT, ADDED].map((from) => ({ ...DRAFT.links[0], from, effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'inferred', definitional: true })),
  identities: [{ operation: 'sum', outcome: GOAL, factors: [CURRENT, ADDED], provenance: 'inferred', evidence: null }],
};
let drafterAnswer: Json | string = DRAFT;
let draftSchema: Json = {};
let draftInstructions = '';
const rawDraftText = (): string => typeof drafterAnswer === 'string' ? drafterAnswer : `\n${JSON.stringify(drafterAnswer, null, 2)}\n`;
const ACTION_TIMING_SENTENCE = 'Declare stated additions in interventions with value_kind=additional, leaving unknown current levels as questions, and stated goal time limits in horizon_months and verbatim deadline_words, keeping relative periods relative without inventing dates.';
const ESTIMATE_SENTENCE = 'Where the brief does not state a level, setting or size the model needs, propose a defensible Olumi starting estimate with origin=olumi and stance=estimate, explaining its basis, unit and period for the person to approve through the existing card, never presenting it as theirs; if no defensible estimate is possible, state the limitation and ask for the missing input rather than silently leaving the model unrunnable; in every draft with a supported additive goal, declare the sum identity with the separate current-level factor and every distinct addition as bound operands under the rules above.';

const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const conversationIds = new Map<string, string>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return { id: prior.id, replayedPriorTurn: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  readOpenAiConversationId: vi.fn(async (sid: string): Promise<string | null | undefined> => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string): Promise<string | null | undefined> => {
    if (!conversationIds.has(sid)) conversationIds.set(sid, id);
    return conversationIds.get(sid);
  }),
  readOpenAiPausedRun: vi.fn(async () => null),
  saveOpenAiPausedRun: vi.fn(async () => true),
  takeOpenAiPausedRun: vi.fn(async () => true),
};
vi.mock('../../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let served = 0;
/** What the route hands the AI after each tool call (`function_call_output`), as sent. */
const toolOutputs: Json[] = [];
const responsesBody = (output: Record<string, unknown>[]): Json => {
  served += 1;
  return {
    id: `resp_${served}`, object: 'response', model: 'gpt-scripted-returned', status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed',
          content: (item.content as Json[]).map((c) => ({ ...c, annotations: [] })) }
      : { id: `fc_${served}_${i}`, status: 'completed', ...item }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  };
};

/** The served empty-scenario read (assist.v1.scenario-graph.ts:541–590, `graphPresent` false). */
const EMPTY_READ = (): Json => ({ scenario_id: SCENARIO, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null });

describe('core drafts the FIRST model of a new scenario (graph null is a valid empty state)', () => {
  let app: FastifyInstance;
  let rawStore: typeof import('../../../drafter-raw/index.js');
  const REQUEST_ID = 'diagnostic-request-not-the-turn-id';
  let saved: Json | null = null;
  let registered: Json[] = [];
  let read: () => Json = EMPTY_READ;
  let briefArg = BRIEF;
  let versionsUnavailable = false;
  let readUnavailable = false;
  let proofFault = '';
  let toolBrief: string | undefined;
  let drafterCalls = 0;
  let cutShortAfterRun = false;
  let runFails = false;
  let runs = 0;
  let skipDraft = false;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_draft', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      const runCall = runPressToolResponse(body);
      if (runCall) return runCall;
      const ok = (output: Record<string, unknown>[]) => new Response(JSON.stringify(responsesBody(output)), { status: 200, headers: { 'content-type': 'application/json' } });
      // The construction's structured calls: the whole candidate gets the drafter's answer; any other structured step answers nothing.
      if (body.text?.format?.type === 'json_schema') {
        if (body.text.format.name === 'whole_candidate') { draftSchema = body.text.format.schema; draftInstructions = body.instructions; drafterCalls += 1; }
        return ok(body.text.format.name === 'whole_candidate' ? [{ type: 'message', content: [{ type: 'output_text', text: rawDraftText() }] }] : []);
      }
      // The core agent: first the draft call, then its words.
      const input = Array.isArray(body.input) ? body.input as Json[] : [];
      toolOutputs.push(...input.filter((i) => i.type === 'function_call_output'));
      if (!input.some((i) => i.type === 'function_call_output')) {
        if (skipDraft) return ok([{ type: 'function_call', name: 'run_analysis', call_id: 'refused_run',
          arguments: JSON.stringify({ reason: 'Check the model.', effects_timing: null }) }]);
        return ok([{ type: 'function_call', name: 'build_model_from_brief', call_id: 'draft_call', arguments: JSON.stringify({ brief: toolBrief ?? briefArg }) }]);
      }
      if (cutShortAfterRun) {
        if (!input.some((i) => i.call_id === 'refused_run')) return ok([{ type: 'function_call', name: 'run_analysis',
          call_id: 'refused_run', arguments: JSON.stringify({ reason: 'Check the new model.', effects_timing: null }) }]);
        return ok([{ type: 'message', content: [{ type: 'output_text', text: '' }] }]);
      }
      // Scripted narration of the actual tool facts, not an assertion about a live model's wording.
      const outcome = JSON.parse(String(input.find((i) => i.type === 'function_call_output')?.output ?? '{}')) as Json;
      const text = outcome.data?.save_outcome === 'UNKNOWN' ? 'I could not verify whether the model was saved. Any saved work is kept.'
        : outcome.status === 'ok' ? 'Here is the first model I built.' : 'Nothing was saved.';
      return ok([{ type: 'message', content: [{ type: 'output_text', text }] }]);
    }));
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../../routes/agent-v1-turn.js');
    rawStore = await import('../../../drafter-raw/index.js');
    app = Fastify({ logger: false, requestIdHeader: 'x-request-id' });
    app.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => {
      if (saved !== null && readUnavailable) return reply.code(503).send({});
      return read();
    });
    app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      const b = req.body as Json;
      registered.push(b);
      saved = b.graph as Json;
      if (proofFault === 'postimage') saved = { ...saved, nodes: (saved.nodes as Json[]).map((n, i) => i === 0 ? { ...n, label: 'A different framing' } : n) };
      const graphHash = computeAnalysisAffectingGraphHash(saved as never);
      const identity = computeGraphIdentityHash(saved as never)!;
      read = () => ({ scenario_id: SCENARIO, graph: saved, graph_present: true, brief_text: b.brief_text ?? null,
        graph_identity_hash: identity, graph_hash: graphHash });
      const receipt = { version_id: 'v_1', version_number: 1, mutation_id: 'm_1', creation_kind: 'initial',
        graph_identity_hash: identity.value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(saved as never) };
      return { registered: true, graph_identity_hash: identity, graph_hash: graphHash,
        ...(proofFault === 'receipt' ? {} : { model_version: receipt }),
        ...(proofFault === 'ack' ? { graph_identity_hash: { ...identity, value: 'foreign' } } : {}) };
    });
    app.post('/assist/v1/scenarios/:id/versions', async (req, reply) => versionsUnavailable ? reply.code(503).send({}) : ({ versions: registered.map((b, i) => ({
      version_id: `v_${i + 1}`, sequence: i + 1, created_at: '2026-10-19T18:00:00.000Z',
      creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId((req.params as { id: string }).id, String(b.operation_id)) } })) }));
    app.post('/orchestrate/v2/turn', async (_req, reply) => {
      runs += 1;
      if (runFails) return reply.code(500).send({ error: 'INTERNAL_ERROR' });
      return { response_version: 2, assistant_text: '', suggested_actions: [], insights: [],
        graph_hash: 'h1', blocks: [{ type: 'analysis_result', data: { marker: 'offline-run' } }],
        analysis_ready: { status: 'ready', options: [], blockers: [] } };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await rawStore.settleDrafterRawWritesForTests(); await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rawRecorder.rows.length = 0; rawRecorder.mode = 'ok'; rawRecorder.release = undefined; SCENARIO = randomUUID(); rows.clear(); conversationIds.clear(); saved = null; registered = []; read = EMPTY_READ; toolOutputs.length = 0; drafterAnswer = DRAFT; briefArg = BRIEF; draftSchema = {}; versionsUnavailable = false; readUnavailable = false; proofFault = ''; toolBrief = undefined; drafterCalls = 0; cutShortAfterRun = false; runFails = false; runs = 0; skipDraft = false; });

  const turn = async (): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core', 'x-request-id': REQUEST_ID }, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', message: briefArg, source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };
  const draftCall = (body: Json): Json => (body._agent?.tool_calls as Json[] | undefined)?.find((c) => c.name === 'build_model_from_brief') ?? {};

  const draftOutcome = (): Json => JSON.parse(String(toolOutputs.find((o) => o.call_id === 'draft_call')?.output ?? '{}')) as Json;

  it.each([BRIEF, OTHER_BRIEF])('L17 records exactly one raw B draft with its own scenario and request: %s', async (brief) => {
    briefArg = brief;
    const body = await turn();
    await rawStore.settleDrafterRawWritesForTests();
    expect(rawRecorder.rows).toHaveLength(1);
    const row = rawRecorder.rows[0]!;
    expect(row.scenario_id).toBe(SCENARIO);
    expect(row.request_id).toBe(REQUEST_ID);
    expect(row.operation_id).toBe(registered[0]!.operation_id);
    expect(row.brief_sha256).toBe(createHash('sha256').update(brief).digest('hex'));
    expect(row.outcome).toBe('registered');
    expect(row.calls).toHaveLength(1);
    expect(row.calls[0]!.raw_text).toBe(rawDraftText());
    expect(row.calls[0]!.threw).toBe(false);
    expect(draftCall(body)).toMatchObject({ ok: true, mutated: true });
    expect(body.assistant_text).toBe('Here is the first model I built.');
    expect(drafterCalls).toBe(1);
    // A new request for the saved construction makes no second draft or diagnostic write.
    await turn();
    await rawStore.settleDrafterRawWritesForTests();
    expect(rawRecorder.rows).toHaveLength(1);
    expect(registered).toHaveLength(1);
    expect(drafterCalls).toBe(1);
  });

  it.each(['throws', 'failed', 'pending'] as const)('L17 recorder %s preserves the exact draft outcome without blocking or retrying', async (mode) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00Z'));
    await turn();
    const baseline = draftOutcome();
    const baselineGraph = registered[0]!.graph;
    SCENARIO = randomUUID(); rows.clear(); saved = null; registered = []; read = EMPTY_READ; toolOutputs.length = 0;
    rawRecorder.rows.length = 0; rawRecorder.mode = mode;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const pendingTurn = turn();
    try {
      const body = await Promise.race([pendingTurn, new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('diagnostic write blocked the turn')), 2_000);
      })]);
      expect(draftOutcome()).toEqual(baseline);
      expect(registered[0]!.graph).toEqual(baselineGraph);
      expect(body.assistant_text).toBe('Here is the first model I built.');
      expect(rawRecorder.rows).toHaveLength(1);
    } finally {
      clearTimeout(timeout);
      rawRecorder.release?.();
      await pendingTurn;
      await rawStore.settleDrafterRawWritesForTests();
      vi.useRealTimers();
    }
    expect(rawRecorder.rows).toHaveLength(1);
    expect(registered).toHaveLength(1);
  });

  it('L17 no-draft negative: another scenario and unrelated brief cannot create a raw record', async () => {
    toolBrief = OTHER_BRIEF;
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: false, refusal: 'brief_not_users_words' });
    expect(rawRecorder.rows).toEqual([]);
    expect(drafterCalls).toBe(0);
  });

  it('L24 recorded capacity through POST /agent/v1/turn retains the per-specialist rate', async () => {
    drafterAnswer = liveRows[0]!.calls[0]!.raw_text;
    briefArg = 'We are comparing two staffing options, labelled exactly "Keep current staffing" and "Add one specialist". Use the exact goal label "Weekly support capacity". Our existing team resolves 80 tickets per week. Keep current staffing adds no specialist. Add one specialist adds one specialist. Each additional specialist resolves about 20 tickets per week, between 10 and 30. Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity. Goal: weekly support capacity of at least 100 tickets per week. This target is an absolute level, with no deadline.';
    await turn();
    expect(draftOutcome()).toMatchObject({ status: 'ok', mutated: true });
    expect(registered).toHaveLength(1);
    expect(saved!.edges.find((e: Json) => e.from === 'additional_specialists' && e.to === 'additional_specialist_capacity')
      .provenance.natural_effect).toMatchObject({ amount: 20, per_source_change: 1, per_source_change_unit: 'specialist',
        stated_range: { low: 10, high: 30 } });
  });

  it.each([BRIEF, OTHER_BRIEF])(
    'L13 own registration receipt verifies the full postimage without history availability: %s', async (brief) => {
      briefArg = brief; versionsUnavailable = true;
      const body = await turn();
      expect(draftOutcome()).toMatchObject({ status: 'ok', mutated: true, data: { save_outcome: 'VERIFIED_SAVED' } });
      expect(body.assistant_text).toBe('Here is the first model I built.');
      expect(registered).toHaveLength(1);
      expect(draftCall(body)).toMatchObject({ ok: true, mutated: true });
    });

  it.each([BRIEF, OTHER_BRIEF])('L13 unavailable readback is UNKNOWN; retry does not write or Run: %s', async (brief) => {
    briefArg = brief; readUnavailable = true;
    const body = await turn();
    expect(draftOutcome()).toMatchObject({ status: 'unavailable', write: 'unknown', data: { save_outcome: 'UNKNOWN' } });
    expect(body.assistant_text).toBe('I could not verify whether the model was saved. Any saved work is kept.');
    expect(registered).toHaveLength(1);
    readUnavailable = false;
    const retry = await turn();
    expect(draftOutcome()).toMatchObject({ status: 'unavailable', write: 'unknown', data: { save_outcome: 'UNKNOWN' } });
    const lastOutcome = JSON.parse(String(toolOutputs.at(-1)?.output)) as Json;
    expect(lastOutcome).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true, save_outcome: 'VERIFIED_SAVED' } });
    expect(registered).toHaveLength(1);
    expect(drafterCalls).toBe(1);
    expect([body, retry].flatMap((b) => b._agent.tool_calls).map((c) => c.name)).toEqual(['build_model_from_brief', 'build_model_from_brief']);
    expect(toolOutputs.map((o) => JSON.parse(String(o.output))).filter((o) => o.ran === true)).toEqual([]);
  });

  it.each([BRIEF, OTHER_BRIEF])('L13C UNKNOWN with cut-short narration never claims no model change: %s', async (brief) => {
    briefArg = brief; readUnavailable = true; cutShortAfterRun = true;
    const body = await turn();
    expect(draftOutcome()).toMatchObject({ write: 'unknown', data: { save_outcome: 'UNKNOWN' } });
    expect(draftCall(body).mutated).toBe(false);
    expect(body._agent.tool_calls.map((c: Json) => c.name)).toEqual(['build_model_from_brief', 'run_analysis']);
    expect(body._agent.tool_calls[1].refusal).toBe('run_not_confirmed');
    expect(body.assistant_text).toBe('The analysis didn’t run this time (run not confirmed). Ask me what it still needs.'
      + '\n\nThe change was sent, but it could not be confirmed: the model may have changed again straight afterwards, so Olumi cannot yet say what it now holds. Look at the model, or ask me to check it.');
    expect(body.assistant_text).not.toContain('Nothing in the model was changed');
    expect(registered).toHaveLength(1);
    expect(drafterCalls).toBe(1);
  });

  it.each([BRIEF, OTHER_BRIEF])('L13C a saved model and cut-short failed Run keep the save: %s', async (brief) => {
    briefArg = brief; cutShortAfterRun = true; runFails = true;
    const body = await turn();
    expect(draftOutcome()).toMatchObject({ status: 'ok', mutated: true, data: { save_outcome: 'VERIFIED_SAVED' } });
    expect(draftCall(body).mutated).toBe(true);
    expect(body._agent.tool_calls.map((c: Json) => c.name)).toEqual(['build_model_from_brief', 'run_analysis']);
    expect(body._agent.tool_calls[1].refusal).toBe('run_failed');
    expect(body.assistant_text).toBe('The analysis could not start.'
      + '\n\n• Roughly how much Weekly bookings in bookings a week does a change in Evening slots bring?'
      + '\n\nYour model was updated this turn. Please try again in a moment.'
      + "\n\nThis model doesn't yet say whether any option gets there within 12 months."
      + "\n\nOlumi can compare your options, but can't yet test them against your target (at least 300 bookings a week), because it needs a size for the link from Evening slots to Weekly bookings.");
    expect(body.assistant_text).not.toContain('Nothing in your model changed');
    expect(registered).toHaveLength(1);
    expect(drafterCalls).toBe(1);
    expect(runs).toBe(1);
  });

  it.each([BRIEF, OTHER_BRIEF])('L13C UNKNOWN save and cut-short failed Run make no save claim: %s', async (brief) => {
    briefArg = brief; readUnavailable = true; cutShortAfterRun = true; runFails = true;
    const body = await turn();
    expect(draftOutcome()).toMatchObject({ write: 'unknown', data: { save_outcome: 'UNKNOWN' } });
    expect(draftCall(body).mutated).toBe(false);
    expect(body._agent.tool_calls.map((c: Json) => c.name)).toEqual(['build_model_from_brief', 'run_analysis']);
    expect(body._agent.tool_calls[1].refusal).toBe('run_failed');
    expect(body.assistant_text).toBe('The analysis could not start. Please try again in a moment.'
      + '\n\nThe change was sent, but it could not be confirmed: the model may have changed again straight afterwards, so Olumi cannot yet say what it now holds. Look at the model, or ask me to check it.');
    expect(body.assistant_text).not.toContain('Nothing in your model changed');
    expect(registered).toHaveLength(1);
    expect(drafterCalls).toBe(1);
    expect(runs).toBe(1);
  });

  it('L13C cut-short failed Run without any save makes no save claim', async () => {
    skipDraft = true; cutShortAfterRun = true; runFails = true;
    const body = await turn();
    expect(body._agent.tool_calls).toEqual([expect.objectContaining({ name: 'run_analysis', refusal: 'run_failed', mutated: false })]);
    expect(body.assistant_text).toBe('The analysis could not start. Please try again in a moment.');
    expect(registered).toHaveLength(0);
    expect(drafterCalls).toBe(0);
    expect(runs).toBe(1);
  });

  it.each(['receipt', 'ack', 'postimage'])('L13 proof negative: %s is missing or mismatched despite a nonempty graph', async (fault) => {
    proofFault = fault;
    await turn();
    expect(draftOutcome()).toMatchObject({ status: 'unavailable', write: 'unknown', data: { save_outcome: 'UNKNOWN' } });
    expect(registered).toHaveLength(1);
  });

  it('L13 refusal before dispatch is VERIFIED_NO_WRITE', async () => {
    toolBrief = 'Someone else asked for a different model.';
    const body = await turn();
    expect(draftOutcome()).toMatchObject({ status: 'refused', reason: 'brief_not_users_words', data: { save_outcome: 'VERIFIED_NO_WRITE' } });
    expect(body.assistant_text).toBe('Nothing was saved.');
    expect(registered).toHaveLength(0);
  });

  it.each([
    BRIEF,
    'We run a repair workshop and want to serve more customers; we could add a technician or extend opening hours.',
  ])('L5 sent bytes: estimates and every supported sum, on the real route (%s)', async (brief) => {
    briefArg = brief;
    await turn();
    const addition = draftInstructions.slice(0, -(ACTION_TIMING_SENTENCE.length + 1)).slice(-ESTIMATE_SENTENCE.length);
    expect(addition).toBe(ESTIMATE_SENTENCE);
    expect(createHash('sha256').update(addition, 'utf8').digest('hex')).toBe('15c1eae82146b2ef05b6e3a78af3a9568af58643e41472fcee15410a628c9085');
  });

  it('RED: a NEW scenario (graph null) → ONE draft saved, by its own receipt and a model read back', async () => {
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ brief_text: BRIEF, expected_graph_identity_hash: null });
    expect((saved?.nodes as Json[]).length).toBeGreaterThan(0);
  });

  it('⭐ STEP 8 gap 3 (RED on the bridge): the model saved is candidateToGraph\'s conversion of the ONE draft, and the draft travels to the AI beside the receipt', async () => {
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    // ⭐ The draft's statements are recorded on their subjects from the brief's own words (gap 3 carry): the aim, on the goal's target.
    const goal = (registered[0]!.graph.nodes as Json[]).find((n) => n.kind === 'goal')!;
    expect(goal.user_statements).toEqual([{ subject_key: `goal|${goal.id}|||target`, field: 'target', recorded_at: expect.any(String),
      attest: { recorded_by: 'construction' }, statements: [{ said_by: 'unknown', quote: AIM, source: AIM, form: 'lower_bound', low: 300,
        unit: 'bookings a week', reading: 'olumi', subject: { quantity: `goal|${goal.id}|||target`, node_id: goal.id } }] }]);
    const converted = candidateToGraph(DRAFT, { words: BRIEF, recorded_at: goal.user_statements[0].recorded_at });
    if ('refused' in converted) throw new Error(converted.refused);
    // The registered bytes are the conversion's: A's numbers on a label-blind copy, each figure with the origin the AI declared.
    expect(registered[0]!.graph).toEqual(converted.graph);
    // The AI reads the drafter's JSON verbatim, and what the conversion said, in the tool's answer (the conversation keeps them).
    const answer = JSON.parse(String(toolOutputs.find((o) => o.call_id === 'draft_call')?.output ?? '{}')) as Json;
    expect(answer).toMatchObject({ status: 'ok', mutated: true, data: { provisional: 'olumi', draft: { declared: DRAFT, not_expressible: converted.blocked_schema } } });
    expect(answer.data.draft.said).toEqual([...new Set(converted.loss.map((l) => l.reason))]);
  });

  it('⭐ GAP 1 + K5 LOOP (real path): the added part\'s 0 is saved as Olumi\'s, and a size with no quote is never said as the brief\'s', async () => {
    drafterAnswer = ADDED_DRAFT;
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    const part = (registered[0]!.graph.nodes as Json[]).find((n) => n.label === ADDED)!;
    expect(part.observed_state).toMatchObject({ value: 0, source: 'cee_inference' });
    const said = (JSON.parse(String(toolOutputs.find((o) => o.call_id === 'draft_call')?.output ?? '{}')) as Json).data.draft.said as string[];
    expect(said).toContain(`This link was drafted at 1 per 1; this path doesn't use that size in the calculation yet, so the link from "${ADDED}" to "${GOAL}" keeps Olumi's placeholder size.`);
    expect(said.filter((x) => x.includes('says "1 per 1"'))).toEqual([]);
  });

  it('L23 real core route: the exact recorded drafter output registers its Olumi-derived total and complete sum', async () => {
    drafterAnswer = liveRows[0]!.calls[0]!.raw_text;
    briefArg = "We are comparing two staffing options, labelled exactly \"Keep current staffing\" and \"Add one specialist\". Use the exact goal label \"Weekly support capacity\". Our existing team resolves 80 tickets per week. Keep current staffing adds no specialist. Add one specialist adds one specialist. Each additional specialist resolves about 20 tickets per week, between 10 and 30. Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity. Goal: weekly support capacity of at least 100 tickets per week. This target is an absolute level, with no deadline.";
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    const graph = registered[0]!.graph as Json;
    const goal = graph.nodes.find((n: Json) => n.id === 'weekly_support_capacity');
    expect(goal.observed_state).toMatchObject({ raw_value: 80, baseline: 80 / 125, source: 'cee_inference', extractionType: 'inferred' });
    expect(goal.nonlinear_identity).toEqual({ operation: 'sum',
      factor_ids: ['existing_team_capacity', 'additional_specialist_capacity'], stated_in_brief: false });
    expect(graph.nodes.find((n: Json) => n.id === 'additional_specialist_capacity').scale_frame).toBe(125);
    expect(saved).toEqual(graph);
    expect(drafterCalls).toBe(1);
  });

  it('L18 real route: a zero indirect sum operand is registered on the goal coordinate frame', async () => {
    drafterAnswer = { ...SUM_DRAFT, options: DRAFT.options,
      factors: [DRAFT.factors[0], { ...SUM_DRAFT.factors[0], plausible_max: 300 }, { ...SUM_DRAFT.factors[1], role: 'observable', plausible_max: null }],
      links: [{ ...DRAFT.links[0], to: ADDED }, ...SUM_DRAFT.links] };
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    const graph = registered[0]!.graph as Json;
    const goal = graph.nodes.find((n: Json) => n.kind === 'goal');
    const zero = graph.nodes.find((n: Json) => n.label === ADDED);
    expect(zero.observed_state.cap).toBeUndefined();
    expect(zero.scale_frame).toBe(goal.goal_threshold_cap);
    expect(zero.observed_state.value).toBe(0);
    expect(goal.nonlinear_identity).toEqual({ operation: 'sum',
      factor_ids: [graph.nodes.find((n: Json) => n.label === CURRENT).id, zero.id], stated_in_brief: false });
    expect(drafterCalls).toBe(1);
  });

  it('⭐ K5 P0 RULING (real path): the sum the drafter text asks for is carried exact, and no placeholder stands between the option and the goal', async () => {
    const savedFor = async (answer: Json): Promise<Json> => {
      SCENARIO = randomUUID(); registered = []; saved = null; read = EMPTY_READ; drafterAnswer = answer;
      const body = await turn();
      expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
      return registered[0]!.graph as Json;
    };
    const g = await savedFor(SUM_DRAFT);
    const id = (label: string): string => (g.nodes as Json[]).find((n) => n.label === label)!.id;
    const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'sum', factor_ids: [id(CURRENT), id(ADDED)] });
    // Exact: each operand is the sum's definition (existence 1, Olumi's, never the person's); the Run evaluates the identity itself.
    for (const from of [CURRENT, ADDED]) {
      expect((g.edges as Json[]).find((e) => e.from === id(from) && e.to === goal.id)).toMatchObject({ exists_probability: 1, provenance: { definitional: true, magnitude: 'olumi_estimate' } });
    }
    const optionsOf = (graph: Json): string[] => (graph.nodes as Json[]).filter((n) => n.kind === 'option').map((n) => n.id as string);
    const options = optionsOf(g);
    expect((g.nodes as Json[]).find((n) => n.label === 'Add evening slots')!.interventions[id(ADDED)]).toMatchObject({ raw_value: 20 });
    // The goal chance is computable: no placeholder link on any option's path to the goal (the gate that withheld it in the K5 loop) …
    expect(placeholderGoalPaths(g, options)).toEqual([]);
    expect(unsizedLeaderGoalPaths(g, options)).toEqual([]);
    // … while the K5 loop's served shape (no declared sum) still has one, so the gate is not vacuous.
    const loop = await savedFor(ADDED_DRAFT);
    expect(placeholderGoalPaths(loop, optionsOf(loop))).not.toEqual([]);
  });

  it.each([
    ['user', 'stated_current', 'We run 6 evening slots today.', 'human'],
    ['olumi', 'estimate', 'We are exploring evening opening.', 'ai'],
    ['unknown', 'estimate', 'Someone mentioned 6 evening slots.', 'unknown'],
    ['user', 'hypothetical', 'Suppose we run 6 evening slots if the trial starts.', null],
  ] as const)('ONE declared pair (real route): %s/%s survives registration and a cold canonical read', async (origin, stance, words, expected) => {
    briefArg = `${BRIEF}\n${words}`;
    drafterAnswer = { ...DRAFT, factors: [{ ...DRAFT.factors[0], baseline_known: true, baseline_value: 6, origin, stance }],
      statements: origin === 'olumi' ? [] : [{ quote: words, subject: { kind: 'factor', label: 'Evening slots', to_label: null, factor_label: null },
        field: 'level', form: 'point', value: 6, low: null, high: null, unit: 'slots a week', qualifier: null,
        conditions: stance === 'hypothetical' ? 'if the trial starts' : null, speaker: origin === 'user' ? 'user' : 'unknown' }] };
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    expect(draftSchema.properties.factors.items.required).toEqual(expect.arrayContaining(['origin', 'stance']));
    // Serialise the store then read it through a fresh canonical reader, with no turn history.
    saved = JSON.parse(JSON.stringify(saved)) as Json;
    const factor = (saved!.nodes as Json[]).find((n) => n.label === 'Evening slots')!;
    if (expected === null) expect(factor.observed_state).toBeUndefined();
    else expect(valueProvenanceOf(factor.observed_state).origin).toBe(expected);
    const cold = await readCanonicalContext({ dispatch: async () => ({ status: 200, json: read() }) }, { scenario_id: SCENARIO });
    expect(cold.status).toBe('ok');
    const node = ((cold as { data: Json }).data.nodes as Json[]).find((n) => n.id === factor.id)!;
    if (origin === 'olumi') expect(node.statements ?? []).toEqual([]);
    else expect(node.statements[0].statements).toEqual([expect.objectContaining({
      ...(origin === 'user' ? { speaker: 'user' } : { said_by: 'unknown' }), quote: words, low: 6, high: 6, stance,
      ...(stance === 'hypothetical' ? { conditions: 'if the trial starts' } : {}),
    })]);
    if (expected === null) expect(node).not.toHaveProperty('observed');
    else expect(node.observed_source.origin).toBe(expected);
  });

  it('ONE declared pair negative (real route): another subject\'s literal figure never credits this factor as the user\'s', async () => {
    briefArg = `${BRIEF}\nWe run 6 evening slots; the studio has 9 rooms.`;
    drafterAnswer = { ...DRAFT, factors: [{ ...DRAFT.factors[0], baseline_known: true, baseline_value: 9, origin: 'user', stance: 'stated_current' }],
      statements: [{ quote: 'the studio has 9 rooms', subject: { kind: 'factor', label: 'Studio rooms', to_label: null, factor_label: null },
        field: 'level', form: 'point', value: 9, low: null, high: null, unit: 'slots a week', speaker: 'user' }] };
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: true, mutated: true });
    const factor = (saved!.nodes as Json[]).find((n) => n.label === 'Evening slots')!;
    expect(valueProvenanceOf(factor.observed_state).origin).toBe('unknown');
    expect(factor.user_statements ?? []).toEqual([]);
  });


  // Replayed strict output, not simulated model intelligence: the sent-text assertion proves the prompt change separately.
  it.each(([
    ['library', 'Librarians on shift'], ['workshop', 'Workshop technicians'],
  ] as const).flatMap(([domain, label]) => [true, false].flatMap((known) => [true, false].map((timed) => ({ domain, label, known, timed })))))('L14 real route: $domain known=$known timed=$timed', async ({ domain, label, known, timed }) => {
    const aim = `We want to serve 300 customers${timed ? ' in the next three months' : ''}.`;
    const today = known ? `Our ${domain} has six people today.` : `We have not counted our ${domain} team.`;
    const action = 'We could add two people.';
    // Another entity's number and date cannot become this team's level or the goal's deadline.
    briefArg = `${aim} ${today} ${action} The other branch has eight people as of 2026-09-01.`;
    const subject = (kind: string, name: string, factor_label: string | null = null) => ({ kind, label: name, factor_label, to_label: null });
    const statement = (quote: string, kind: string, name: string, value: number, factor_label: string | null = null) => ({
      quote, subject: subject(kind, name, factor_label), field: 'level', form: 'point', value, low: null, high: null, unit: 'people',
      qualifier: null, conditions: null, speaker: 'user', stance: kind === 'option' ? 'hypothetical' : 'stated_current',
    });
    drafterAnswer = { ...DRAFT,
      goal: { ...DRAFT.goal, source_quote: aim, horizon_months: timed ? 3 : null, deadline_words: timed ? 'in the next three months' : null },
      factors: [{ ...DRAFT.factors[0], label, baseline_known: known, baseline_value: known ? 6 : null, plausible_max: 12,
        unit: 'people', provenance: known ? 'explicit' : 'inferred', origin: known ? 'user' : 'unknown', stance: 'stated_current' }],
      options: [DRAFT.options[0], { ...DRAFT.options[1], label: 'Add two people', interventions: [
        { factor_label: label, value: 2, value_kind: 'additional', unit: 'people', provenance: 'explicit', origin: 'user', stance: 'hypothetical' },
      ] }],
      links: [{ ...DRAFT.links[0], from: label }],
      statements: [...(known ? [statement(today, 'factor', label, 6)] : []), statement(action, 'option', 'Add two people', 2, label)],
    };
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: true, mutated: true });
    expect(registered).toHaveLength(1);
    const graph = JSON.parse(JSON.stringify(saved)) as Json;
    const factor = (graph.nodes as Json[]).find((n) => n.label === label)!;
    const option = (graph.nodes as Json[]).find((n) => n.label === 'Add two people')!;
    const goal = (graph.nodes as Json[]).find((n) => n.kind === 'goal')!;
    const gaps = resolveRunAdmission(graph).assessment.blockingIssues.filter((i) => i.factor_id === factor.id);
    if (known) {
      expect(option.interventions[factor.id].raw_value).toBe(8);
      expect(settingProvenanceOf(option.interventions[factor.id]).origin).toBe('ai');
      expect(gaps.filter((i) => i.code === 'MISSING_OPTION_VALUE')).toEqual([]);
      expect(factor.observed_state.raw_value).toBe(6);
    } else {
      expect(option.interventions?.[factor.id]).toBeUndefined();
      expect(factor.observed_state).toBeUndefined();
      expect(gaps.map((i) => i.code)).toContain('MISSING_FACTOR_LEVEL');
    }
    expect(goal.goal_horizon_months).toBe(timed ? 3 : undefined);
    expect(goal.goal_deadline_as_stated).toBe(timed ? 'in the next three months' : undefined);
    expect(goal.source_quote).toBe(aim);
    expect(goal.goal_horizon?.deadline).toBeUndefined();
    expect(draftInstructions.slice(-ACTION_TIMING_SENTENCE.length)).toBe(ACTION_TIMING_SENTENCE);
  });

  it('CONTRAST: a non-null read that is not a graph is still malformed: refused, nothing registered', async () => {
    read = () => ({ scenario_id: SCENARIO, graph: 'not a graph', graph_present: true, graph_hash: 'h', graph_identity_hash: null });
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: false, mutated: false, outcome: 'unavailable', refusal: 'read_malformed' });
    expect(registered).toHaveLength(0);
  });
});
