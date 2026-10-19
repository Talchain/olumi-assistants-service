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
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { candidateToGraph } from '../candidate-to-graph.js';

type Json = Record<string, any>;
/** A NEW scenario per row: the route keeps each scenario's verified typed messages for the process. */
let SCENARIO = '';
const AIM = 'We want to grow weekly bookings to at least 300 within 12 months.';
const BRIEF = [AIM, 'Bookings are 180 a week today.', 'We could add evening slots or run a referral offer.'].join('\n');
const GOAL = 'Weekly bookings';

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
  let saved: Json | null = null;
  let registered: Json[] = [];
  let read: () => Json = EMPTY_READ;
  const briefArg = BRIEF;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_draft', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      const runCall = runPressToolResponse(body);
      if (runCall) return runCall;
      const ok = (output: Record<string, unknown>[]) => new Response(JSON.stringify(responsesBody(output)), { status: 200, headers: { 'content-type': 'application/json' } });
      // The construction's structured calls: the whole candidate gets the drafter's answer; any other structured step answers nothing.
      if (body.text?.format?.type === 'json_schema') {
        return ok(body.text.format.name === 'whole_candidate' ? [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(DRAFT) }] }] : []);
      }
      // The core agent: first the draft call, then its words.
      const input = Array.isArray(body.input) ? body.input as Json[] : [];
      toolOutputs.push(...input.filter((i) => i.type === 'function_call_output'));
      if (!input.some((i) => i.type === 'function_call_output')) {
        return ok([{ type: 'function_call', name: 'build_model_from_brief', call_id: 'draft_call', arguments: JSON.stringify({ brief: briefArg }) }]);
      }
      return ok([{ type: 'message', content: [{ type: 'output_text', text: 'Here is a first model.' }] }]);
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
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
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { SCENARIO = randomUUID(); rows.clear(); conversationIds.clear(); saved = null; registered = []; read = EMPTY_READ; toolOutputs.length = 0; });

  const turn = async (): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core' }, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', message: BRIEF, source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };
  const draftCall = (body: Json): Json => (body._agent?.tool_calls as Json[] | undefined)?.find((c) => c.name === 'build_model_from_brief') ?? {};

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
    const converted = candidateToGraph(DRAFT);
    if ('refused' in converted) throw new Error(converted.refused);
    // The registered bytes are the conversion's: A's numbers on a label-blind copy, each figure with the origin the AI declared.
    expect(registered).toHaveLength(1);
    expect(registered[0]!.graph).toEqual(converted.graph);
    // The AI reads the drafter's JSON verbatim, and what the conversion said, in the tool's answer (the conversation keeps them).
    const answer = JSON.parse(String(toolOutputs.find((o) => o.call_id === 'draft_call')?.output ?? '{}')) as Json;
    expect(answer).toMatchObject({ status: 'ok', mutated: true, data: { provisional: 'olumi', draft: { declared: DRAFT, not_expressible: converted.blocked_schema } } });
    expect(answer.data.draft.said).toEqual([...new Set(converted.loss.map((l) => l.reason))]);
  });

  it('CONTRAST: a non-null read that is not a graph is still malformed: refused, nothing registered', async () => {
    read = () => ({ scenario_id: SCENARIO, graph: 'not a graph', graph_present: true, graph_hash: 'h', graph_identity_hash: null });
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: false, mutated: false, outcome: 'unavailable', refusal: 'read_malformed' });
    expect(registered).toHaveLength(0);
  });
});
