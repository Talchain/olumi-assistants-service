/**
 * ⛔ CORE CAN DRAFT THE FIRST MODEL (VERIFIER CORE run on 86c9663a, redteam/core-accept/runs/20261019T174921Z: every case failed at
 * turn 1 — `build_model_from_brief` → unavailable `read_malformed`). A NEW scenario's graph read is `graph: null, graph_present:
 * false, graph_hash: null, graph_identity_hash: null` (assist.v1.scenario-graph.ts, "An EMPTY graph is a valid answer"), and the
 * adapters' one reader called that malformed. Through the REAL route in core mode: a scripted AI, the REAL draft adapter (one
 * drafter call with a scripted answer, Step 8's `candidateToGraph`, create-only registration), and the graph / register / versions
 * routes as doubles that answer in the served shapes. SYNTHETIC wording; no journey brief. (The brief stays the AI's literal copy
 * of the user's words, as on base.)
 */
import { runPressToolResponse } from '../../../agent-lane/__tests__/fixtures/run-press-model.js';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHashSha256, computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { toOutboundGraph } from '../../../goal-target/outbound-graph.js';
import type { DrafterRawRow } from '../../../drafter-raw/index.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';

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


/** THIN CORE: the AI's complete living model of a brief (the build tool's strict arguments). Generic and protocol-shaped: the
 * science of real briefs is the mapper's own tests'; here the save, receipt, readback and narration protocol is under test. */
const livingFor = (brief: string): LivingModelT => {
  const first = brief.split(/(?<=[.?!])\s+/)[0] ?? brief;
  return {
    aims: [{ id: 'aim', text: first, status: 'current', target: null, defined_as: null, source: 'user', party: null, quote: first }],
    options: [
      { id: 'carry_on', label: 'Carry on as now', settings: [], source: 'olumi', party: null, quote: null },
      { id: 'change', label: 'Make the change', source: 'olumi', party: null, quote: null,
        settings: [{ factor_id: 'level', value: 2, low: null, high: null, unit: null, source: 'olumi', party: null, quote: null }] },
    ],
    factors: [{ id: 'level', label: 'Current level', value: 1, low: null, high: null, unit: null, defined_as: null, source: 'olumi', party: null, quote: null }],
    links: [], conditions: [], views: [], history: [],
  };
};

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

let drafterAnswer: Json | string = DRAFT;
const rawDraftText = (): string => typeof drafterAnswer === 'string' ? drafterAnswer : `\n${JSON.stringify(drafterAnswer, null, 2)}\n`;

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
  let toolModel: LivingModelT | undefined;
  /** The instructions each core agent call was given (the turn's own facts ride there). */
  const instructionsSeen: string[] = [];
  const bodiesSeen: Json[] = [];
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
        if (body.text.format.name === 'whole_candidate') drafterCalls += 1;
        return ok(body.text.format.name === 'whole_candidate' ? [{ type: 'message', content: [{ type: 'output_text', text: rawDraftText() }] }] : []);
      }
      // The core agent: first the draft call, then its words.
      instructionsSeen.push(String(body.instructions ?? ''));
      bodiesSeen.push(body);
      const input = Array.isArray(body.input) ? body.input as Json[] : [];
      toolOutputs.push(...input.filter((i) => i.type === 'function_call_output'));
      if (!input.some((i) => i.type === 'function_call_output')) {
        if (skipDraft) return ok([{ type: 'function_call', name: 'run_analysis', call_id: 'refused_run',
          arguments: JSON.stringify({ reason: 'Check the model.', effects_timing: null }) }]);
        return ok([{ type: 'function_call', name: 'build_model_from_brief', call_id: 'draft_call', arguments: JSON.stringify({ brief: toolBrief ?? briefArg, model: toolModel ?? livingFor(toolBrief ?? briefArg) }) }]);
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
    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const b = req.body as Json;
      registered.push(b);
      saved = b.graph as Json;
      if (proofFault === 'postimage' || proofFault === 'receipt-postimage') saved = { ...saved, nodes: (saved.nodes as Json[]).map((n, i) => i === 0 ? { ...n, label: 'A different framing' } : n) };
      const graphHash = computeAnalysisAffectingGraphHash(saved as never);
      let identity = computeGraphIdentityHash(saved as never)!;
      read = () => ({ scenario_id: SCENARIO, graph: saved, graph_present: true, brief_text: b.brief_text ?? null,
        graph_identity_hash: identity, graph_hash: graphHash });
      const receipt = { version_id: 'v_1', version_number: 1, mutation_id: 'm_1', creation_kind: 'initial',
        graph_identity_hash: identity.value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(saved as never) };
      if (proofFault === 'ack-status') return reply.code(503).send({});
      if (proofFault === 'operation-reused') return reply.code(409).send({ details: { code: 'OPERATION_ID_REUSED' } });
      if (proofFault === 'receipt-invalid') receipt.version_id = '';
      if (proofFault === 'revision-invalid') receipt.version_number = 0;
      if (proofFault === 'mutation-invalid') receipt.mutation_id = '';
      if (proofFault === 'receipt-hash') receipt.graph_identity_hash = 'a'.repeat(64);
      if (proofFault === 'analysis-hash') receipt.analysis_affecting_hash = 'a'.repeat(64);
      if (proofFault === 'read-identity') {
        const normalRead = read;
        read = () => ({ ...normalRead(), graph_identity_hash: { value: 'a'.repeat(64) } });
      }
      if (proofFault === 'recomputed-identity') {
        identity = { ...identity, value: 'a'.repeat(64) }; receipt.graph_identity_hash = identity.value;
      }
      return { registered: true, graph_identity_hash: identity, graph_hash: proofFault === 'revision' ? 'a'.repeat(16) : graphHash,
        ...(proofFault === 'receipt' || proofFault === 'receipt-postimage' ? {} : { model_version: receipt }),
        ...(proofFault === 'ack' ? { graph_identity_hash: { ...identity, value: 'foreign' } } : {}),
        ...(proofFault === 'ack-missing' ? { graph_identity_hash: null } : {}) };
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
  beforeEach(() => { rawRecorder.rows.length = 0; rawRecorder.mode = 'ok'; rawRecorder.release = undefined; SCENARIO = randomUUID(); rows.clear(); conversationIds.clear(); saved = null; registered = []; read = EMPTY_READ; toolOutputs.length = 0; drafterAnswer = DRAFT; briefArg = BRIEF; versionsUnavailable = false; readUnavailable = false; proofFault = ''; toolBrief = undefined; toolModel = undefined; drafterCalls = 0; cutShortAfterRun = false; runFails = false; runs = 0; skipDraft = false; });

  const turn = async (): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core', 'x-request-id': REQUEST_ID }, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', message: briefArg, source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };
  const draftCall = (body: Json): Json => (body._agent?.tool_calls as Json[] | undefined)?.find((c) => c.name === 'build_model_from_brief') ?? {};

  const draftOutcome = (): Json => JSON.parse(String(toolOutputs.find((o) => o.call_id === 'draft_call')?.output ?? '{}')) as Json;

  it.each([BRIEF, OTHER_BRIEF])(
    'L13 own registration receipt verifies the full postimage without history availability: %s', async (brief) => {
      briefArg = brief; versionsUnavailable = true;
      const body = await turn();
      expect(draftOutcome()).toMatchObject({ status: 'ok', mutated: true, data: { save_outcome: 'VERIFIED_SAVED' } });
      expect(body.assistant_text).toBe('Here is the first model I built.');
      expect(registered).toHaveLength(1);
      expect(draftCall(body)).toMatchObject({ ok: true, mutated: true });
      expect(draftCall(body)).not.toHaveProperty('draft_verification');
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
    expect(drafterCalls).toBe(0);
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
    expect(drafterCalls).toBe(0);
  });

  it.each([BRIEF, OTHER_BRIEF])('L13C a saved model and cut-short failed Run keep the save: %s', async (brief) => {
    briefArg = brief; cutShortAfterRun = true; runFails = true;
    const body = await turn();
    expect(draftOutcome()).toMatchObject({ status: 'ok', mutated: true, data: { save_outcome: 'VERIFIED_SAVED' } });
    expect(draftCall(body).mutated).toBe(true);
    expect(body._agent.tool_calls.map((c: Json) => c.name)).toEqual(['build_model_from_brief', 'run_analysis']);
    expect(body._agent.tool_calls[1].refusal).toBe('run_failed');
    // The save is kept and said; the readiness lines that follow depend on the model's content, not on this protocol.
    expect(body.assistant_text).toMatch(/^The analysis could not start\./);
    expect(body.assistant_text).toContain('Your model was updated this turn. Please try again in a moment.');
    expect(body.assistant_text).not.toContain('Nothing in your model changed');
    expect(registered).toHaveLength(1);
    expect(drafterCalls).toBe(0);
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
    expect(drafterCalls).toBe(0);
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

  it.each(['ack', 'postimage', 'receipt-postimage'])('L13 proof negative: %s is missing or mismatched despite a nonempty graph', async (fault) => {
    proofFault = fault;
    await turn();
    expect(draftOutcome()).toMatchObject({ status: 'unavailable', write: 'unknown', data: { save_outcome: 'UNKNOWN' } });
    expect(registered).toHaveLength(1);
  });

  it.each([BRIEF, OTHER_BRIEF].flatMap((brief) => [
    ['receipt-postimage', { check: 'postimage_diff', keys: ['nodes'] }],
    ['receipt-invalid', { check: 'receipt_invalid', field: 'version_id' }],
    ['revision-invalid', { check: 'revision_mismatch', field: 'version_number' }],
    ['mutation-invalid', { check: 'receipt_invalid', field: 'mutation_id' }],
    ['ack-status', { check: 'ack_status', status: 503 }],
    ['operation-reused', { check: 'ack_status', status: 409 }],
    ['ack-missing', { check: 'ack_status', status: 200 }],
    ['ack', { check: 'hash_mismatch', field: 'ack_identity', expected: null }],
    ['receipt-hash', { check: 'hash_mismatch', field: 'receipt_identity', actual: 'a'.repeat(12) }],
    ['read-identity', { check: 'hash_mismatch', field: 'ack_identity', actual: 'a'.repeat(12) }],
    ['recomputed-identity', { check: 'hash_mismatch', field: 'read_identity', expected: 'a'.repeat(12) }],
    ['revision', { check: 'revision_mismatch', field: 'graph_hash', expected: 'a'.repeat(12) }],
    ['analysis-hash', { check: 'hash_mismatch', field: 'analysis_hash', actual: 'a'.repeat(12) }],
    ['postimage', { check: 'postimage_diff', keys: ['nodes'] }],
    ['readback', { check: 'readback_unavailable', code: 'read_failed' }],
  ].map(([fault, diagnostic]) => ({ brief, fault: String(fault), diagnostic: diagnostic as Json }))))(
    'L26B first failed check $fault is trace-only ($brief)', async ({ brief, fault, diagnostic }) => {
      briefArg = brief; proofFault = fault; readUnavailable = fault === 'readback'; versionsUnavailable = true;
      const body = await turn();
      const identity = computeGraphIdentityHash(saved as never)!.value.slice(0, 12);
      const analysis = computeAnalysisAffectingGraphHashSha256(saved as never)!.slice(0, 12);
      const revision = computeAnalysisAffectingGraphHash(saved as never)!.slice(0, 12);
      const defaults = fault === 'receipt-hash' || fault === 'read-identity' ? { expected: identity }
        : fault === 'ack' || fault === 'recomputed-identity' ? { actual: identity }
        : fault === 'revision' ? { actual: revision }
        : fault === 'analysis-hash' ? { expected: analysis } : {};
      const reason = ['ack-status', 'operation-reused'].includes(fault) ? 'not_confirmed' : 'not_verified';
      // Lane-base SDK output and reply bytes; diagnostics may not change either.
      expect(toolOutputs.find((o) => o.call_id === 'draft_call')?.output).toBe(JSON.stringify({
        status: 'unavailable', reason, write: 'unknown', data: { save_outcome: 'UNKNOWN' },
        detail: 'The construction was dispatched, but its save could not be verified. It may already be saved. Do not say nothing was saved, and do not repeat a write or Run to repair the reply.',
      }));
      expect(body.assistant_text).toBe('I could not verify whether the model was saved. Any saved work is kept.');
      expect(registered).toHaveLength(1); expect(drafterCalls).toBe(0); expect(runs).toBe(0);
      expect(body._agent.receipts).toEqual([]);
      expect(draftCall(body).draft_verification).toEqual({ ...defaults, ...diagnostic });
    });

  it('L26B first failure wins; a later unrelated mismatch cannot replace it or leak content', async () => {
    proofFault = 'receipt-invalid'; readUnavailable = true;
    const body = await turn();
    expect(draftCall(body).draft_verification).toEqual({ check: 'receipt_invalid', field: 'version_id' });
    expect(JSON.stringify(draftCall(body).draft_verification)).not.toContain(BRIEF);
  });

  it('a guest\u2019s write mints no version: saved on this registration\u2019s acknowledgement and an exact read of the model', async () => {
    proofFault = 'receipt';
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(draftCall(body)).not.toHaveProperty('draft_verification');
    expect(registered).toHaveLength(1);
  });

  it('L13 refusal before dispatch is VERIFIED_NO_WRITE', async () => {
    toolBrief = 'Someone else asked for a different model.';
    const body = await turn();
    expect(draftOutcome()).toMatchObject({ status: 'refused', reason: 'brief_not_users_words', data: { save_outcome: 'VERIFIED_NO_WRITE' } });
    expect(body.assistant_text).toBe('Nothing was saved.');
    expect(draftCall(body)).not.toHaveProperty('draft_verification');
    expect(registered).toHaveLength(0);
  });

  it('RED: a NEW scenario (graph null) → ONE draft saved, by its own receipt and a model read back', async () => {
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ brief_text: BRIEF, expected_graph_identity_hash: null });
    expect((saved?.nodes as Json[]).length).toBeGreaterThan(0);
  });

  // A core postimage through the real ingress, the core persisted form, the strict reparse and the public projection,
  // without carrying any turn history.
  const coldReload = async (): Promise<Json> => {
    const ingress = GraphStateIngressSchema.parse(saved);
    const persisted = projectCorePostimageForPersistence(ingress);
    saved = JSON.parse(JSON.stringify(persisted)) as Json;
    saved = GraphV3.parse(saved);
    const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    expect(response.statusCode).toBe(200);
    return toOutboundGraph(response.json<Json>().graph);
  };
  it.each(['user', 'party', 'olumi', 'unverified'] as const)('THIN CORE labels (real route): a %s figure keeps its label through registration and a cold reload', async (source) => {
    const quote = source === 'user' || source === 'party' ? 'Bookings are 180 a week today.' : null;
    const model = livingFor(BRIEF);
    model.factors[0] = { ...model.factors[0]!, source, party: source === 'party' ? 'our manager' : null, quote };
    toolModel = model;
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: true, mutated: true });
    const reloaded = await coldReload();
    expect(((reloaded.living_model as Json).factors as Json[])[0]).toMatchObject({ source, quote });
    const node = (reloaded.nodes as Json[]).find((n) => n.id === 'level')!;
    expect(node.observed_state?.source).toBe(source === 'olumi' ? 'cee_inference' : source === 'unverified' ? undefined : 'brief_extraction');
  });

  it('THIN CORE labels negative (real route): a "user" figure whose words the person never wrote is saved unverified, never as theirs or Olumi\'s', async () => {
    const model = livingFor(BRIEF);
    model.factors[0] = { ...model.factors[0]!, source: 'user', quote: 'Bookings were 250 a week last year.' };
    toolModel = model;
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: true, mutated: true });
    const reloaded = await coldReload();
    expect(((reloaded.living_model as Json).factors as Json[])[0]).toMatchObject({ source: 'unverified' });
    expect((reloaded.nodes as Json[]).find((n) => n.id === 'level')!.observed_state?.source).toBeUndefined();
  });

  it('THIN CORE budget (real route): every core call runs at the bake-off configuration, with room for a whole model', async () => {
    bodiesSeen.length = 0;
    expect(draftCall(await turn())).toMatchObject({ ok: true, mutated: true });
    expect(bodiesSeen.length).toBeGreaterThan(0);
    for (const b of bodiesSeen) expect({ model: b.model, effort: b.reasoning?.effort, max: b.max_output_tokens }).toEqual({ model: 'gpt-6.1-sol', effort: 'high', max: 12000 });
  });

  it('THIN CORE context (real route): the next turn starts from the saved living model, with its labels and quotes', async () => {
    const model = livingFor(BRIEF);
    model.factors[0] = { ...model.factors[0]!, source: 'user', quote: 'Bookings are 180 a week today.' };
    toolModel = model;
    instructionsSeen.length = 0;
    expect(draftCall(await turn())).toMatchObject({ ok: true, mutated: true });
    expect(instructionsSeen.length).toBeGreaterThan(0);
    expect(instructionsSeen.some((t) => t.includes('living_model')), 'CONTRAST: an empty scenario has none').toBe(false);
    instructionsSeen.length = 0;
    await turn();
    expect(instructionsSeen[0]).toContain('living_model');
    expect(instructionsSeen[0]).toContain('Bookings are 180 a week today.');
  });

  it('CONTRAST: a non-null read that is not a graph is still malformed: refused, nothing registered', async () => {
    read = () => ({ scenario_id: SCENARIO, graph: 'not a graph', graph_present: true, graph_hash: 'h', graph_identity_hash: null });
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: false, mutated: false, outcome: 'unavailable', refusal: 'read_malformed' });
    expect(registered).toHaveLength(0);
  });
});
