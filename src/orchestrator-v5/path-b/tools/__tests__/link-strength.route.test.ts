/**
 * LINK STRENGTH THROUGH THE ROUTE (C5, candidate 2; DL one-line lease on agent-v1-turn.ts): a core turn's `propose_change` with
 * Olumi's band reaches the existing link-set capability through the route's own `dispatchTool`, on the SAME proposal store, so
 * the AI gets a card, never "not available on this path". Harness: ai-core-mode.route.test.ts (the served b9-1 readback, the
 * real route, a scripted AI, no provider contacted). SYNTHETIC wording; no journey brief.
 */
import { withCanonicalAnalysisView } from '../../../agent-lane/__tests__/fixtures/canonical-analysis-read.js';
import { runPressToolResponse } from '../../../agent-lane/__tests__/fixtures/run-press-model.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { streamWhenAsked } from '../../../agent-lane/__tests__/stream-when-asked.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/waveB9-unseen1-df15c8c-readback-pre-challenge.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCENARIO = '7e6d5c4b-3a2f-4e1d-8c9b-6a5f4e3d2c1c';

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

describe('LINK STRENGTH: a core turn’s band for a link reaches the existing capability through the route', () => {
  let app: FastifyInstance;
  const sent: string[] = [];
  let outputs: Record<string, unknown>[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_link', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const runCall = runPressToolResponse(JSON.parse(String(init?.body ?? '{}')));
      if (runCall) return runCall;
      sent.push(typeof init?.body === 'string' ? init.body : '');
      const output = outputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify(responsesBody(output)), { status: 200, headers: { 'content-type': 'application/json' } });
    })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({
      graph: READ.graph, graph_hash: READ.graph_hash, analysis_state: READ.analysis_state,
      graph_identity_hash: { kind: 'graph_identity', value: createHash('sha256').update(JSON.stringify(READ.graph)).digest('hex'), algorithm: 'sha256' },
      analysis_ready: READ.analysis_ready, analysis_result: READ.analysis_result,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: propose_change with Olumi’s band → the capability’s card (a proposal), never "not available on this path"', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'link_call', arguments: JSON.stringify({
      public_label: 'Size the link', basis: 'Deploying the app drives more repeat purchases, from the model.',
      ops: [{ op: 'set_link_strength', from: 'loyalty_app_deployment', to: 'loyalty_app_monthly_gross_profit', band: 'strong', stance: 'estimate',
        source: { origin: 'olumi', quote: null, named_source: null } }] }) }]];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core' }, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', message: 'Please size that link.', source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    const back = sent.map((b) => JSON.parse(b) as Json).flatMap((b) => (Array.isArray(b.input) ? b.input as Json[] : []))
      .find((i) => i.type === 'function_call_output' && i.call_id === 'link_call');
    expect(back, sent.join('\n')).toBeDefined();
    const outcome = JSON.parse(String(back!.output)) as Json;
    expect(outcome, String(back!.output)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
  });

  it('L1b RED: an Olumi-authored supposition reaches a card through the real core route', async () => {
    sent.length = 0;
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'supposition_call', arguments: JSON.stringify({
      public_label: 'Explore an Olumi assumption', basis: 'A conditional Olumi figure, not today’s level.',
      ops: [{ op: 'set_factor_value', factor_id: 'wholesale_salespeople', value: 3, unit: 'part-time salespeople', stance: 'hypothetical',
        source: { origin: 'olumi', quote: null, named_source: null } }] }) }]];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core' }, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'Explore a conditional starting assumption; I have not stated a current figure.', source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    const back = sent.map((b) => JSON.parse(b) as Json).flatMap((b) => Array.isArray(b.input) ? b.input as Json[] : [])
      .find((i) => i.type === 'function_call_output' && i.call_id === 'supposition_call');
    expect(back).toBeDefined();
    expect(JSON.parse(String(back!.output)), String(back!.output)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
  });
});
