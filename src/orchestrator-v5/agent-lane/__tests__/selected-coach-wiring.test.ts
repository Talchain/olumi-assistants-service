/** Selected coaching reaches the real Agent route on every conversation path. No provider is called. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SELECTED_COACH_V02_TEMPLATE } from '../coach-route-v0_2.js';

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const TEMPLATE_SHA = '170ac5e7a629f8408fd92857b34d196aede92b99e2ebbce281c23a900c9ed66d';
const RENDERED_SHA = 'a8593fbc685460df603b21471f3c75f03a932a39b4402802c9826267b56c19f7';
const RENDERED_BYTES = 8_523;
const SCENARIO = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a0f';
const fx = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: Record<string, unknown>; analysis_ready: unknown };
};
const runFixture = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/c19-8428207-B.run-turns.trimmed.json', import.meta.url), 'utf8')) as {
  turns: { t2: { analysis_result: { computed_against_hash: string } & Record<string, unknown> } };
};
const runBlock = runFixture.turns.t2.analysis_result;

type Sent = { model: string; instructions: string; reasoning?: { effort?: string }; max_output_tokens: number; tools?: unknown[]; tool_choice?: unknown };
const sent: Sent[] = [];
let scripted: Record<string, unknown>[][] = [];
const rows = new Map<string, { id: string; turn_id: string; request_hash: string; assistant_message: string | null }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const proposeLink = [{ type: 'function_call', name: 'propose_model_change', call_id: 'link-1',
  arguments: JSON.stringify({ from_label: 'Price-release alignment', to_label: 'Pro conversion rate',
    direction: 'positive', strength: 'strong', rationale: 'Timing changes how the price lands.' }) }];

describe('selected Sol-high coach on the actual Agent route', () => {
  let app: FastifyInstance;
  let turn = 0;
  let interpretOnlyConstraint: string;
  let interpreterV02: string;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body?: unknown }) => {
      sent.push(JSON.parse(String(init.body)) as Sent);
      return new Response(JSON.stringify({ status: 'completed', output: scripted.shift() ?? say('Done.') }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../routes/agent-v1-turn.js');
    interpretOnlyConstraint = route.INTERPRET_ONLY_CONSTRAINT;
    interpreterV02 = route.INTERPRETER_V02_BANKED;
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: runBlock.computed_against_hash, blocks: [runBlock],
      analysis_ready: fx.state.analysis_ready, analysis_state: fx.state.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: fx.state.draft_graph, graph_hash: runBlock.computed_against_hash,
      analysis_ready: fx.state.analysis_ready, analysis_state: fx.state.analysis_state,
      analysis_result: runBlock,
    }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    if (app) await app.close();
    vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED;
    delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.clear(); sent.length = 0; scripted = []; });

  const sendTurn = async (message: string, output: Record<string, unknown>[][], chip?: { id: string; action_type: string }) => {
    scripted = [...output];
    turn += 1;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message, turn_id: `5d4c3b2a-1f0e-4d9c-8b7a-${String(turn).padStart(12, '0')}`,
      ...(chip ? { chip } : {}),
    } });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(200);
    expect(scripted, 'each scripted model hop was consumed').toEqual([]);
    return response.json() as { _diagnostic_trace?: { fast_path?: string } };
  };
  const selected = (body: Sent) => {
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body.reasoning?.effort).toBe('high');
    expect(body.max_output_tokens).toBe(3400);
  };

  it('uses the exact selected template and host authority on an ordinary conversation', async () => {
    expect(sha256(SELECTED_COACH_V02_TEMPLATE)).toBe(TEMPLATE_SHA);
    expect(SELECTED_COACH_V02_TEMPLATE.split('{{MODE_AND_AUTHORITY}}')).toHaveLength(2);
    await sendTurn('What does the analysis say?', [say('The comparison is provisional.')]);
    expect(sent).toHaveLength(1);
    selected(sent[0]!);
    expect(Buffer.byteLength(sent[0]!.instructions)).toBe(RENDERED_BYTES);
    expect(sha256(sent[0]!.instructions)).toBe(RENDERED_SHA);
    expect(sent[0]!.instructions).toContain('To change the model you must first call a proposing tool');
    expect(sent[0]!.instructions).toContain('authorise_change');
  });

  it('keeps the same selected prompt and budget on a tool-followup conversation', async () => {
    await sendTurn('Timing strongly shapes how the price lands, so add that link.',
      [proposeLink, say('The proposed link is ready for approval.')]);
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      selected(body);
      expect(sha256(body.instructions)).toBe(RENDERED_SHA);
    }
  });

  it('uses selected coach bytes as the prefix of the typed Run interpretation', async () => {
    const response = await sendTurn('Run analysis.', [say('The Run is provisional.')],
      { id: 'agent-run-analysis', action_type: 'run_analysis' });
    expect(response._diagnostic_trace?.fast_path).toBe('run');
    expect(sent).toHaveLength(1);
    const body = sent[0]!;
    selected(body);
    expect(body.tool_choice).toBe('none');
    expect(body.tools).toEqual([]);
    // A withheld Run inserts its view instruction before the interpret-only constraint.
    // The selected coach remains the exact first 8,523 UTF-8 bytes in either case.
    const prefix = Buffer.from(body.instructions).subarray(0, RENDERED_BYTES);
    expect(sha256(prefix)).toBe(RENDERED_SHA);
    expect(body.instructions).toContain(interpretOnlyConstraint);
    expect(body.instructions).toContain(interpreterV02);
  });
});
