/**
 * ⛔ PATH-B `core`: ONE consent check for every approval of a paused SDK run (Codex #3461 R1/R2, DL-3 rulings 2a/2b and the
 * R2 stop-rule exception). The route, the SDK and the card carrier are real; the paused tool is a counted `needsApproval`
 * write (Codex's probe, kept as a permanent row), so these rows isolate WHO may resume it:
 *  · a press on the card, or the person's typed words EQUAL to that card's button (#3013 doctrine), on the CURRENT displayed
 *    offer, resumes it once;
 *  · either one carrying edits (malformed, or a wrong digest) is refused before anything resumes; the pause stays held;
 *  · other words, no displayed card or a stale one never resume it.
 * Harness: the route spec `ai-core-mode.route.test.ts` (served Wave B9 b9-1 readback, scripted AI, no provider). SYNTHETIC wording.
 */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { runPressToolResponse } from './fixtures/run-press-model.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ enabled: false, applied: 0, proposalId: '' }));
vi.mock('../../path-b/tools/index.js', async (original) => {
  const real = await original<any>();
  const { tool } = await import('@openai/agents');
  const { z } = await import('zod-v4');
  const { createProposal } = await import('../proposal.js');
  return { ...real, pathBTools: (deps: any, ctx: any, mode: any, onCall: any) => {
    if (!probe.enabled) return real.pathBTools(deps, ctx, mode, onCall);
    const p = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id,
      base_graph_identity_hash: READ.graph_hash,
      operations: [{ op: 'set_factor_value', path: 'wholesale_salespeople', value: { value: 2, unit: 'part-time salespeople', stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } } }],
      provenance: { authored_by: 'model_proposed', basis: 'Synthetic probe' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Set the salesperson level' });
    deps.proposals.put(p); probe.proposalId = p.proposal_id;
    return [tool({ name: 'apply_change', description: 'A counted probe write.', parameters: z.object({ proposal_id: z.string() }).strict(), needsApproval: true,
      execute: async () => { probe.applied += 1; onCall({ name: 'apply_change', ok: true, mutated: true, outcome: 'ok', refusal: null, ran: null },
        { ok: true, mutated: true, outcome: 'ok', proposal_id: p.proposal_id }); return JSON.stringify({ saved: true }); } })];
  }};
});
let pausedProbe: any = null;
type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB9-unseen1-df15c8c-readback-pre-challenge.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCENARIO = '7e6d5c4b-3a2f-4e1d-8c9b-6a5f4e3d2c1b';
const CORE = { 'x-olumi-ai-mode': 'core' };
const AI_WORDS = 'The analysis ran.';

const rows = new Map<string, any>();
const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedProbe),
  saveOpenAiPausedRun: vi.fn(async (_s, r) => { if (pausedProbe !== null) return false; pausedProbe = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s, id) => { if (pausedProbe?.pause_id !== id) return false; pausedProbe = null; return true; }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...w, pending_actions: (w as any).pending_actions, scenario_id: SCENARIO, created_at: new Date().toISOString(), id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage, user_message: w.userMessage };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => [...rows.values()].filter(r => !r.turn_id.endsWith(':claim')).reverse()),
  readMostRecentPendingActions: vi.fn(async () => [...rows.values()].filter(r => !r.turn_id.endsWith(':claim')).at(-1)?.pending_actions ?? []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  // The scenario's saved Conversation id (`scenarios.openai_conversation_id`); `undefined` = the column is absent.
  readOpenAiConversationId: vi.fn(async (sid: string): Promise<string | null | undefined> => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string): Promise<string | null | undefined> => {
    if (!conversationIds.has(sid)) conversationIds.set(sid, id);
    return conversationIds.get(sid);
  }),
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


describe('PATH-B core: the AI\'s own words are the reply; protocol, cards, results and replay are unchanged', () => {
  let app: FastifyInstance;
  let graph: Json = READ.graph;
  let state: Json = READ.analysis_state;
  const sent: string[] = [];
  let outputs: Record<string, unknown>[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      // The core lane's one OpenAI Conversation per scenario (`core/sdk-turn.ts`).
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_route', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const runCall = runPressToolResponse(JSON.parse(String(init?.body ?? '{}')));
      if (runCall) return runCall;
      sent.push(typeof init?.body === 'string' ? init.body : '');
      const output = outputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: AI_WORDS }] }];
      if (probe.enabled) for (const o of output) if (o.type === 'function_call') o.arguments = JSON.stringify({ proposal_id: probe.proposalId });
      return new Response(JSON.stringify(responsesBody(output)), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
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
  beforeEach(() => { rows.clear(); conversationIds.clear(); sent.length = 0; graph = READ.graph; state = READ.analysis_state; outputs = []; });
  const typed = async (message: string, headers: Record<string, string> = {}, turnId = randomUUID()): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers, payload: {
      kind: 'message', turn_id: turnId, scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', message, source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };

  it.each(['typed_valid','malformed_chip','malformed_typed','digest_chip','digest_typed','wrong_message_chip','no_display_typed','stale_display_typed'])('consent on a paused core change: %s', async (kind) => {
    probe.enabled = true; probe.applied = 0; pausedProbe = null;
    outputs = [[{ type: 'message', content: [{ type: 'output_text', text: 'I have prepared the change.' }] },
      { type: 'function_call', name: 'apply_change', call_id: 'probe_call', arguments: '{}' }]];
    const first = await typed('Prepare a change.', CORE);
    expect(first._agent.sdk?.paused).toBeDefined(); expect(probe.applied).toBe(0);
    const approve = first.suggested_actions.find((c: any) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve).toBeDefined();
    const rec = first._proposal_fields?.proposals?.find((f: any) => f.proposal_id === probe.proposalId);
    expect(store.readMostRecentPendingActions.mock).toBeDefined();
    expect([...rows.values()].at(-1)?.pending_actions?.length, 'the real route retained its pending carrier').toBeGreaterThan(0);
    const before = pausedProbe.pause_id;
    const malformed = { proposal_id: probe.proposalId, digest: 'wrong', fields: 'malformed' };
    const wrongDigest = { proposal_id: probe.proposalId, revision: rec.revision, digest: 'wrong', graph_hash: READ.graph_hash, fields: [] };
    outputs = [[{ type: 'message', content: [{ type: 'output_text', text: 'Applied.' }] }]];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', source: 'composer',
      message: kind === 'wrong_message_chip' ? 'Do not apply that change.' : approve.message,
      ...(kind.startsWith('no_display') ? {} : {displayed_proposals:[{proposal_id:probe.proposalId, revision:kind.startsWith('stale_display') ? 'stale' : rec.revision}]}),
      ...(kind.endsWith('_chip') ? {chip:{id:approve.id}} : {}),
      ...(kind.startsWith('malformed') ? {proposal_edits:malformed} : kind.startsWith('digest') ? {proposal_edits:wrongDigest} : {})
    } });
    expect(r.statusCode,r.body).toBe(200);
    const j=r.json();
    try {
      if(kind==='typed_valid') { expect(probe.applied).toBe(1); expect(j._agent.sdk?.resumed?.answer).toBe('approved'); }
      else { expect(probe.applied,'unvalidated or non-current consent must not execute').toBe(0);
        expect(j._agent?.sdk?.resumed?.answer).not.toBe('approved');
        if(kind.startsWith('malformed')||kind.startsWith('digest')) expect(pausedProbe?.pause_id).toBe(before);
      }
    } finally {probe.enabled=false;}
  });
});
