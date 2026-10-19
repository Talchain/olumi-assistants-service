/**
 * ⛔ #3468 R1 BLOCK (Codex, outbox/CODEX-REVIEW-3468-R1-report.md): the draft's brief, when the AI does not copy it, is the user's
 * own messages (`verified_user_messages`). After a restart those are reseeded from durable rows, and a row counted as TYPED when
 * its stored hash was the plain hash of its words. A chip press WITHOUT a chip object (`source: 'chip_click'`, no `chip`) stored
 * the plain hash, so its words (Olumi's) came back as the user's and reached the brief. The typed origin now rides the stored hash:
 * a request that was not typed never stores the plain hash, so its row stays source-unknown after a restart.
 * Through the REAL route in core mode, across a REAL restart (a fresh route module, the same durable rows). SYNTHETIC wording.
 */
import { runPressToolResponse } from '../../../agent-lane/__tests__/fixtures/run-press-model.js';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';

type Json = Record<string, any>;
const BRIEF = 'We want weekly bookings to reach at least 300 within 12 months; we could add evening slots.';
const CHIP_WORDS = 'Use the analyst’s figure of 40 evening slots.';
const DRAFT_ASK = 'Please draft the model now.';
const GOAL = 'Weekly bookings';
const DRAFT = {
  goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 300, unit: 'bookings a week', horizon_months: 12,
    provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null,
    quantity_frame: 'level', source_quote: null, deadline_words: null },
  constraints: [],
  options: [
    { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
    { label: 'Add evening slots', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Evening slots', value: 20, value_kind: 'absolute', unit: 'slots a week', provenance: 'ai_proposed' }] },
  ],
  factors: [{ label: 'Evening slots', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'slots a week', provenance: 'ai_proposed', plausible_max: 60 }],
  risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
  links: [{ from: 'Evening slots', to: GOAL, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null,
    effect_provenance: null, definitional: null, basis: null, source_quote: null }],
  statements: [],
};

/** Durable turn rows, as the session store keeps them (newest first on read). */
let durable: Json[] = [];
const conversationIds = new Map<string, string>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => durable.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; userMessage?: string | null; assistantMessage?: string | null }) => {
    const prior = durable.find((r) => r.turn_id === w.turn_id);
    if (prior !== undefined) return { id: prior.id, replayedPriorTurn: true as const };
    const row = { id: `row-${durable.length + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, user_message: w.userMessage ?? null,
      assistant_message: w.assistantMessage ?? null, created_at: new Date(Date.parse('2026-10-19T18:00:00.000Z') + durable.length * 1000).toISOString() };
    durable.push(row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => [...durable].reverse()),
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

let SCENARIO = '';
let registered: Json[] = [];
let saved: Json | null = null;
let draftThisTurn = false;
const emptyRead = (): Json => ({ scenario_id: SCENARIO, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null });
let read: () => Json = emptyRead;

/** ONE route process. `boot()` again is a restart: a fresh route module (its in-process history gone), the same durable rows. */
async function boot(): Promise<FastifyInstance> {
  vi.resetModules();
  const { agentV1TurnRoute } = await import('../../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => read());
  app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
    const b = req.body as Json;
    registered.push(b);
    saved = b.graph as Json;
    const graphHash = computeAnalysisAffectingGraphHash(saved as never);
    read = () => ({ scenario_id: SCENARIO, graph: saved, graph_present: true, brief_text: b.brief_text ?? null,
      graph_identity_hash: { kind: 'graph_identity', value: 'id_1', algorithm: 'sha256' }, graph_hash: graphHash });
    return { model_version: { version_id: 'v_1', version_number: 1 } };
  });
  app.post('/assist/v1/scenarios/:id/versions', async (req) => ({ versions: registered.map((b, i) => ({
    version_id: `v_${i + 1}`, sequence: i + 1, created_at: '2026-10-19T18:00:00.000Z',
    creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId((req.params as { id: string }).id, String(b.operation_id)) } })) }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('the draft’s brief after a restart: the user’s TYPED messages only, never a chip’s words', () => {
  const apps: FastifyInstance[] = [];
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: `conv_${randomUUID()}`, object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      const runCall = runPressToolResponse(body);
      if (runCall) return runCall;
      const ok = (output: Record<string, unknown>[]) => new Response(JSON.stringify(responsesBody(output)), { status: 200, headers: { 'content-type': 'application/json' } });
      if (body.text?.format?.type === 'json_schema') {
        return ok(body.text.format.name === 'whole_candidate' ? [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(DRAFT) }] }] : []);
      }
      const input = Array.isArray(body.input) ? body.input as Json[] : [];
      if (draftThisTurn && !input.some((i) => i.type === 'function_call_output')) {
        // The AI re-types the brief (not the user's words), so the tool takes the user's own messages.
        return ok([{ type: 'function_call', name: 'build_model_from_brief', call_id: 'draft_call', arguments: JSON.stringify({ brief: 'Bookings to 300; evening slots at 40.' }) }]);
      }
      return ok([{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }]);
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    SCENARIO = randomUUID(); durable = []; conversationIds.clear(); registered = []; saved = null; read = emptyRead; draftThisTurn = false;
  });
  afterEach(async () => { for (const a of apps.splice(0)) await a.close(); vi.unstubAllGlobals(); });
  afterAll(() => { delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const send = async (app: FastifyInstance, message: string, extra: Json = {}): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core' }, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', message, source: 'composer', ...extra } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };

  it.each([
    ['without a chip object (RED: its plain hash read as typed)', { source: 'chip_click' }],
    ['with a chip id', { source: 'chip_click', chip: { id: 'chip_evening_slots', action_type: 'prompt' } }],
  ])('a chip press %s whose words are in history never reaches the brief; the typed messages do', async (_name, press) => {
    const first = await boot(); apps.push(first);
    await send(first, BRIEF);
    await send(first, CHIP_WORDS, press);
    expect(durable.filter((r) => typeof r.user_message === 'string').map((r) => r.user_message)).toEqual([BRIEF, CHIP_WORDS]);
    const restarted = await boot(); apps.push(restarted);
    draftThisTurn = true;
    const body = await send(restarted, DRAFT_ASK);
    const call = (body._agent?.tool_calls as Json[] | undefined)?.find((c) => c.name === 'build_model_from_brief');
    expect(call, JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true });
    expect(registered).toHaveLength(1);
    const brief = String(registered[0]!.brief_text);
    expect(brief).toContain(BRIEF);
    expect(brief).toContain(DRAFT_ASK);
    expect(brief).not.toContain(CHIP_WORDS);
  }, 60_000);

  it.each([
    ['a typed message', {}],
    ['a chip press without a chip object', { source: 'chip_click' }],
  ])('the UI\u2019s own retry of %s (same turn id, `source: retry`, no chip) replays its recorded reply, never a reused-id refusal', async (_name, first) => {
    const app = await boot(); apps.push(app);
    const turnId = randomUUID();
    const once = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core' }, payload: {
      kind: 'message', turn_id: turnId, scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', message: CHIP_WORDS, source: 'composer', ...first } });
    expect(once.statusCode, once.body).toBe(200);
    const rows = durable.length;
    const again = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core' }, payload: {
      kind: 'message', turn_id: turnId, scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', message: CHIP_WORDS, source: 'retry' } });
    expect(again.statusCode, again.body).toBe(200);
    expect(durable.length, 'no second row').toBe(rows);
    expect((again.json() as Json).assistant_text).toBe((once.json() as Json).assistant_text);
  }, 60_000);
});
