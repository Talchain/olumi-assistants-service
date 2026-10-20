/**
 * ⭐ A PROVIDER CAPACITY OR CREDIT REFUSAL IS ONE TYPED CODE (DL-3 20 Oct, from the PL's 00:06 note and Paul's manual tests).
 *
 * Served 19 Oct 23:40Z (staging CEE 4d8080ea, `core`, streamed): OpenAI refused for credits and the route answered
 * 502 `UPSTREAM_ERROR` with the raw provider sentence. The UI filed it as a generic server fault and offered "Please retry";
 * Paul retried three times on an account with no credits. The rule under test: at the route's one 502 producer, a capacity or
 * credit refusal is `PROVIDER_CAPACITY`, never offered as a retry (`retryable: false`). Every 502 says `nothing_saved` from the
 * turn's own write count and keeps the computed `retry_safe`; any other upstream failure keeps its code.
 *
 * The real route over a scripted provider: the captured error bodies are the fixture, and no provider is contacted.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB9-unseen1-df15c8c-readback-pre-challenge.json', import.meta.url), 'utf8')) as { j: Json }).j;
const CAPTURED = JSON.parse(readFileSync(new URL('./fixtures/provider-credits-exhausted-20261019.json', import.meta.url), 'utf8')) as Json;
const SCENARIO = '5c4b3a2f-1e0d-4c9b-8a7f-6e5d4c3b2a19';
const CORE = { 'x-olumi-ai-mode': 'core' };

const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  // A turn that wrote nothing gives its claim back, so the same turn may be sent again (`retry_safe`).
  releaseTurnClaim: vi.fn(async (_sid: string, id: string) => { rows.delete(id); }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  readOpenAiConversationId: vi.fn(async () => 'conv_capacity'),
  claimOpenAiConversationId: vi.fn(async (_sid: string, id: string) => id),
  readOpenAiPausedRun: vi.fn(async () => null),
  saveOpenAiPausedRun: vi.fn(async () => true),
  takeOpenAiPausedRun: vi.fn(async () => true),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

/** What the scripted provider answers every Responses call with this row. */
let provider: (streamed: boolean) => Response;
/** The captured credit refusal: on a stream, the `error` event the SDK reads; unstreamed, the HTTP 429 the route reads. */
const creditsStream = () => new Response(`event: error\ndata: ${JSON.stringify(CAPTURED.provider_error_body)}\n\n`,
  { status: 200, headers: { 'content-type': 'text/event-stream' } });
const credits429 = () => new Response(JSON.stringify(CAPTURED.provider_error_body, null, 2),
  { status: 429, headers: { 'content-type': 'application/json', 'x-should-retry': 'false' } });
/** CONTRAST: a provider fault that is not capacity, on the same streamed entry. */
const serverErrorStream = () => new Response(`event: error\ndata: ${JSON.stringify({ error: { message: 'The server had an error while processing your request.', type: 'server_error', param: null, code: 'server_error' } })}\n\n`,
  { status: 200, headers: { 'content-type': 'text/event-stream' } });

describe('A provider capacity or credit refusal is PROVIDER_CAPACITY at the route\'s one 502 producer, on both lanes', () => {
  let app: FastifyInstance;
  let runWithStageStream: typeof import('../../../cee/unified-pipeline/stage-stream-context.js').runWithStageStream;
  let providerCalls = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_capacity', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      return provider(body.stream === true);
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    // Imported AFTER resetModules: the SAME AsyncLocalStorage the route reads, as `/proxy/v5/turn/stream` installs it.
    ({ runWithStageStream } = await import('../../../cee/unified-pipeline/stage-stream-context.js'));
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: READ.graph_hash }));
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({
      graph: READ.graph, graph_hash: READ.graph_hash, analysis_state: READ.analysis_state,
      analysis_ready: READ.analysis_ready, analysis_result: READ.analysis_result,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); providerCalls = 0; });

  /** One typed turn, as the composer sends it; streamed through the stage-stream context when asked. */
  const turn = async (headers: Record<string, string>, streamed: boolean) => {
    // Awaited INSIDE the context: `inject` dispatches only when awaited, so a bare chain would run outside the stream.
    const send = async () => await app.inject({ method: 'POST', url: '/agent/v1/turn', headers, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame',
      message: 'Correction: the weekly figure is a little lower than I said.', source: 'composer' } });
    const r = streamed ? await runWithStageStream(() => {}, send) : await send();
    return { status: r.statusCode, body: r.json() as Json };
  };

  it('⭐ RED→GREEN core (the captured 19 Oct turn): the streamed credit refusal is PROVIDER_CAPACITY, not retryable, nothing saved', async () => {
    provider = () => creditsStream();
    const { status, body } = await turn(CORE, true);
    expect(providerCalls, 'the scripted provider answered').toBeGreaterThan(0);
    expect(status).toBe(CAPTURED.core_response.status_code);
    expect(body.detail, 'the same provider refusal the served turn carried').toBe(CAPTURED.core_response.detail);
    expect(body.error, `served as ${CAPTURED.core_response.error}`).toBe('PROVIDER_CAPACITY');
    expect(body.retryable).toBe(false);
    expect(body.nothing_saved).toBe(true);
    expect(body.retry_safe).toBe(CAPTURED.core_response.retry_safe);
  });

  it('⭐ RED→GREEN openai lane (the captured 18 Oct turn): the HTTP 429 credit refusal is the same one code', async () => {
    provider = () => credits429();
    const { status, body } = await turn({}, false);
    expect(status).toBe(502);
    expect(body.detail, 'the same provider refusal the served turn carried').toBe(CAPTURED.openai_lane_response.detail);
    expect(body.error, `served as ${CAPTURED.openai_lane_response.error}`).toBe('PROVIDER_CAPACITY');
    expect(body.retryable).toBe(false);
    expect(body.nothing_saved).toBe(true);
    expect(body.retry_safe).toBe(true);
  });

  it('⛔ CONTRAST: a provider fault that is not capacity stays UPSTREAM_ERROR and keeps the UI\'s own retry rule', async () => {
    provider = () => serverErrorStream();
    const { status, body } = await turn(CORE, true);
    expect(status).toBe(502);
    expect(body.error).toBe('UPSTREAM_ERROR');
    expect(body.detail).toBe('Error: The server had an error while processing your request.');
    expect(body).not.toHaveProperty('retryable');
    expect(body.nothing_saved).toBe(true);
    expect(body.retry_safe).toBe(true);
  });
  it.each([
    ['exhausted credits', 'credit_balance_exhausted', 'insufficient_quota', 'PROVIDER_CAPACITY', false],
    ['quota exhausted', 'insufficient_quota', 'insufficient_quota', 'PROVIDER_CAPACITY', false],
    ['transient rate limit', 'rate_limit_exceeded', 'rate_limit_error', 'UPSTREAM_ERROR', true],
    ['unclassified 429', null, null, 'UPSTREAM_ERROR', undefined],
  ])('L2 recorded contrast on both HTTP producers: %s preserves typed reason and retry-after', async (_name, code, type, error, retryable) => {
    provider = () => new Response(JSON.stringify({ error: { message: 'Recorded provider refusal.', code, type } }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '17', 'retry-after-ms': '17000', 'x-should-retry': 'false' } });
    for (const headers of [CORE, {}]) {
      providerCalls = 0;
      const { status, body } = await turn(headers, false);
      expect(status).toBe(502);
      expect(body.error).toBe(error);
      expect(body.retryable).toBe(retryable);
      expect(body.provider_error).toEqual({ code, type, status: 429 });
      expect(body.retry_after).toBe('17');
      expect(body.retry_after_ms).toBe('17000');
      expect(body.nothing_saved).toBe(true);
      expect(body.save_outcome).toBe('VERIFIED_NO_WRITE');
      expect(body.retry_safe).toBe(true);
      expect(providerCalls, 'one scripted response, no automatic HTTP retry').toBe(1);
    }
  });

});
