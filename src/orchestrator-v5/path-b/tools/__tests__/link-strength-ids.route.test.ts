/**
 * ⭐ PATH-B GAP 2 (DL-3, after PL 19:44): A CORE LINK IS BOUND BY ITS IDS, NEVER RE-MATCHED BY ITS LABELS. The core caller
 * (`change-tools.ts` `proposeLinks`) already holds the link's exact node ids; the link-set capability (`proposeLinkStrengths`)
 * resolved the labels it was handed, so two entities sharing a label refused the change as `ambiguous_entity`. The capability
 * now takes the caller's ids (`from_id` / `to_id`) and resolves by id only; the A lane's labels are unchanged.
 * Harness: `link-strength.route.test.ts` (served b9-1 readback, the real route, C5's adapter, the real capability, a scripted AI,
 * no provider). The readback is the served one with ONE label made to collide. SYNTHETIC wording; no journey brief.
 */
import { withCanonicalAnalysisView } from '../../../agent-lane/__tests__/fixtures/canonical-analysis-read.js';
import { runPressToolResponse } from '../../../agent-lane/__tests__/fixtures/run-press-model.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/waveB9-unseen1-df15c8c-readback-pre-challenge.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCENARIO = '7e6d5c4b-3a2f-4e1d-8c9b-6a5f4e3d2c1d';
const FROM = 'loyalty_app_deployment';
const TO = 'loyalty_app_monthly_gross_profit';
/** The served model, with a second entity carrying the link's source label: the collision a label lookup cannot settle. */
const COLLIDING = { ...READ.graph, nodes: (READ.graph.nodes as Json[]).map((n) => n.id === 'clifton_shop_opening' ? { ...n, label: 'Loyalty app deployment' } : n) };

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
/** The capability's own proposal, read back by its id from the SAME store (the door's operations, by identity). */
const seen = vi.hoisted(() => ({ doors: [] as { refusal: unknown; operations: Record<string, unknown>[] }[], caps: null as any }));
vi.mock('../../../agent-lane/runtime/agent-capabilities.js', async (original) => {
  const actual = await original<any>();
  return { ...actual, createAgentCapabilities: (...input: any[]) => {
    const capabilities = actual.createAgentCapabilities(...input);
    const inner = capabilities.proposeLinkStrengths;
    const wrapped = { ...capabilities, proposeLinkStrengths: async (...args: any[]) => {
      const result = await inner(...args);
      const proposal = input[1].get(String(result.proposal_id));
      seen.doors.push({ refusal: result.refusal, operations: [...(proposal?.operations ?? [])] });
      return result;
    } };
    seen.caps = wrapped;
    return wrapped;
  } };
});

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

describe('PATH-B gap 2: a core link set is bound by its ids, so a label collision never refuses it; the A lane is unchanged', () => {
  let app: FastifyInstance;
  const sent: string[] = [];
  let outputs: Record<string, unknown>[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_link_ids', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const runCall = runPressToolResponse(JSON.parse(String(init?.body ?? '{}')));
      if (runCall) return runCall;
      sent.push(typeof init?.body === 'string' ? init.body : '');
      const output = outputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify(responsesBody(output)), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({
      graph: COLLIDING, graph_hash: READ.graph_hash, analysis_state: READ.analysis_state,
      analysis_ready: READ.analysis_ready, analysis_result: READ.analysis_result,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { sent.length = 0; seen.doors.length = 0; rows.clear(); conversationIds.clear(); });

  const turn = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers, payload: {
    kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', message: 'Please size that link.', source: 'composer' } });
  /** The tool output the AI received for one call. */
  const outputOf = (callId: string): Json | undefined => {
    const item = sent.map((b) => JSON.parse(b) as Json).flatMap((b) => (Array.isArray(b.input) ? b.input as Json[] : []))
      .find((i) => i.type === 'function_call_output' && i.call_id === callId);
    return item === undefined ? undefined : JSON.parse(String(item.output)) as Json;
  };

  it('CONTROL: the model really does hold two entities labelled as the link\'s source', () => {
    expect((COLLIDING.nodes as Json[]).filter((n) => n.label === 'Loyalty app deployment').map((n) => n.id).sort())
      .toEqual(['clifton_shop_opening', FROM]);
  });

  it('⭐ RED→GREEN core: propose_change for the link by its ids → ONE card for exactly that link, never ambiguous_entity', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'link_call', arguments: JSON.stringify({
      public_label: 'Size the link', basis: 'Deploying the app drives more repeat purchases, from the model.',
      ops: [{ op: 'set_link_strength', from: FROM, to: TO, band: 'strong', stance: 'estimate',
        source: { origin: 'olumi', quote: null, named_source: null } }] }) }]];
    const r = await turn({ 'x-olumi-ai-mode': 'core' });
    expect(r.statusCode, r.body).toBe(200);
    const outcome = outputOf('link_call');
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(seen.doors).toHaveLength(1);
    // The proposal's own operation, by the link's identity (`from::to`): exactly that link, never the colliding entity's.
    expect(seen.doors[0]!.operations.map((o) => [o.op, o.path]), JSON.stringify(seen.doors[0]!.operations))
      .toEqual([['set_link_strength', `${FROM}::${TO}`]]);
  });

  it('⭐ an id that is not in the model is unresolved, never matched by the label beside it', async () => {
    const r = await turn({ 'x-olumi-ai-mode': 'core' });
    expect(r.statusCode).toBe(200);
    const out = await seen.caps.proposeLinkStrengths({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-ids', turn_id: randomUUID(),
      user_turn_text: '', user_text: '', verified_user_messages: [] }, { rationale: 'From the model.',
      links: [{ from_id: 'no_such_node', to_id: TO, from_label: 'Loyalty app deployment', to_label: 'Loyalty app monthly gross profit',
        strength: 'strong', origin: 'olumi', basis: 'From the model.' }] });
    expect(out).toMatchObject({ ok: false, refusal: 'unresolved_entity' });
  });

  it('A LANE UNCHANGED: the same collision by LABELS (the full lane\'s own tool) still refuses as ambiguous_entity', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_link_strengths', call_id: 'a_lane_call', arguments: JSON.stringify({
      rationale: 'From the model.', links: [{ from_label: 'Loyalty app deployment', to_label: 'Loyalty app monthly gross profit',
        strength: 'strong', origin: 'olumi', basis: 'From the model.' }] }) }]];
    const r = await turn({});
    expect(r.statusCode, r.body).toBe(200);
    expect(seen.doors.map((d) => d.refusal), JSON.stringify(seen.doors)).toEqual(['ambiguous_entity']);
  });
});
