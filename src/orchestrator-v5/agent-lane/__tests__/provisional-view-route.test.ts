/**
 * ⭐ C5 THROUGH THE ROUTE — the Agent's provisional view on a WITHHELD turn (Paul's ruling, DL #70 5855324470).
 *
 * The REAL agent route, a scripted OpenAI `fetch` (no provider is contacted), and the corpus's own served `57f903c`
 * pricing state — withheld (`constraint_verdict_withheld`) or, for the contrast, the same state with the claim
 * permitted. The model runs the analysis, calls `give_provisional_view`, then writes a real corpus reply that RANKS an
 * option (gpt-5.6-terra, W.V1.rep2). Harness copied from `agent-turn-withheld-leader-fail-closed.test.ts`.
 *
 * What must hold:
 *   - the model's ranking prose is still stripped by the gate (the truth boundary for analysis claims is unchanged);
 *   - the labelled provisional block follows the gated text, with the view, the reasoning and the ONE step;
 *   - `_agent.provisional_view` carries it typed; `blocks` / `analysis_state` / `analysis_ready` are byte-for-byte what
 *     the same turn returns WITHOUT the tool call — the view is never placed in the analysis;
 *   - with no tool call, nothing is added (never fabricated); with a permitted leader, the tool is refused.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: { leader_claim: Record<string, unknown> } & Record<string, unknown>; analysis_ready: unknown };
  replies: Array<{ id: string; label: string; leak_phrases: string[]; text: string }>;
};
const REPLY = FX.replies.find((r) => r.id === 'stack-1854-714677d5/pricing-run-complete.W.V1.rep2')!;
/** The one ranking sentence in REPLY, exactly as served (trailing space included — it rides with the sentence). */
const RANKING_SENTENCE =
  'Its unconstrained comparison favours the £59-at-release path, driven by higher MRR per Pro subscriber and the assumed **100%** price–release alignment. ';
const WITHHELD_STATE = FX.state.analysis_state;
const PERMITTED_STATE = { ...WITHHELD_STATE, leader_claim: { permitted: true, separation: 'separated' } };

const VIEW = {
  view: 'I would raise Pro to £59 at release: on this model it is the strongest path to your MRR goal.',
  reasoning: 'You said most Pro subscribers asked for the release, and the model holds churn at 4% either way. The price rise carries MRR further than holding at £49 does.',
  confirm_step: 'Tell me the churn you actually expect at £59, and I can propose it so the analysis can check the limit.',
};

const SCENARIO = '5e3d2c1b-6f7a-4b8c-9d0e-1f2a3b4c5d6f';
let readbackState: unknown = WITHHELD_STATE;
type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null };
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let callModelOutputs: Record<string, unknown>[][] = [];

type Body = {
  assistant_text: string;
  blocks?: unknown;
  analysis_state?: unknown;
  analysis_ready?: unknown;
  _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[]; provisional_view?: Record<string, unknown> };
};

describe('C5: the provisional view reaches the user labelled, after the gate, on a withheld turn', () => {
  let app: FastifyInstance;
  let noLeaderSentence: string;
  let because: string;
  let block: string;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    noLeaderSentence = (await import('../withheld-leader-fail-closed.js')).agentNoLeaderSentence('constraint_verdict_withheld', FX.state.analysis_ready);
    // Written out here, not imported from the module under test: the reason is the gate's own clause, before its ask.
    because = noLeaderSentence.replace(/^No single option can be put forward yet, /, '').split(';')[0]!.trim();
    block = `**Provisional view \u2014 the analysis can't confirm this yet ${because}.** ${VIEW.view} ${VIEW.reasoning} To let the analysis confirm it: ${VIEW.confirm_step}`;
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: 'h-run', blocks: [],
      analysis_ready: FX.state.analysis_ready, analysis_state: readbackState,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: FX.state.draft_graph, graph_hash: 'h-corpus', analysis_state: readbackState, analysis_ready: FX.state.analysis_ready,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); });

  let turnSeq = 0;
  let turnId = '';
  const post = (message: string) => {
    turnSeq += 1;
    turnId = `7a1b2c3d-4e5f-4a6b-8c7d-${String(turnSeq).padStart(12, '0')}`;
    return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, turn_id: turnId } });
  };
  const runViewThenReply = () => {
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(VIEW), call_id: 'c2' }],
      [{ type: 'message', content: [{ type: 'output_text', text: REPLY.text }] }],
    ];
    return post('Should we raise Pro to £59?');
  };
  const runThenReply = () => {
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: REPLY.text }] }],
    ];
    return post('Should we raise Pro to £59?');
  };

  it('fixture control: the reply carries the ranking sentence exactly once', () => {
    expect(REPLY.text.split(RANKING_SENTENCE).length).toBe(2);
  });

  it('RED: a withheld Run turn — prose ranking still stripped, the labelled block follows, typed on `_agent`', async () => {
    readbackState = WITHHELD_STATE;
    const r = await runViewThenReply();
    expect(r.statusCode).toBe(200);
    expect(callModelOutputs, 'the control: all three scripted outputs were consumed').toEqual([]);
    const b = r.json() as Body;
    expect(b._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['run_analysis', true], ['give_provisional_view', true]]);
    // The gate is unchanged: the model's own ranking sentence is gone and its no-leader sentence is there.
    expect(b.assistant_text).not.toContain(RANKING_SENTENCE.trim());
    expect(b.assistant_text).toContain(noLeaderSentence);
    // The block is the LAST paragraph, after the gate's sentence, whole — view, reasoning and the one step.
    expect(b.assistant_text.endsWith(`\n\n${block}`)).toBe(true);
    expect(b.assistant_text.indexOf(noLeaderSentence)).toBeLessThan(b.assistant_text.indexOf('**Provisional view'));
    expect(block).toContain(VIEW.view);
    expect(block).toContain(VIEW.reasoning);
    expect(block).toContain(`To let the analysis confirm it: ${VIEW.confirm_step}`);
    expect(b._agent.provisional_view).toEqual({ ...VIEW, because });
    expect(rows.get(turnId)?.assistant_message, 'the answer row a replay returns holds the same text').toBe(b.assistant_text);
  });

  it('RED: the analysis is untouched — blocks, analysis_state and analysis_ready equal the same turn WITHOUT the tool call, and the text differs ONLY by the block', async () => {
    readbackState = WITHHELD_STATE;
    const withView = (await runViewThenReply()).json() as Body;
    const without = (await runThenReply()).json() as Body;
    expect(without._agent.tool_calls.map((c) => c.name)).toEqual(['run_analysis']);
    expect(withView.blocks).toEqual(without.blocks);
    expect(withView.analysis_state).toEqual(without.analysis_state);
    expect(withView.analysis_ready).toEqual(without.analysis_ready);
    expect(JSON.stringify(withView.blocks ?? null)).not.toContain('Provisional view');
    expect(JSON.stringify(withView.analysis_state ?? null)).not.toContain(VIEW.view);
    expect(withView.assistant_text).toBe(`${without.assistant_text}\n\n${block}`);
    // No tool call → nothing added (never fabricated).
    expect(without.assistant_text).not.toContain('Provisional view');
    expect(Object.hasOwn(without._agent, 'provisional_view')).toBe(false);
  });

  it('RED: an ordinary follow-up turn ("what would you do?") over the withheld result gets the block too', async () => {
    readbackState = WITHHELD_STATE;
    callModelOutputs = [
      [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(VIEW), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis cannot put an option forward yet. Here is my own reading, set apart below.' }] }],
    ];
    const b = (await post('So what would you do?')).json() as Body;
    expect(callModelOutputs).toEqual([]);
    expect(b.assistant_text).toBe(`The analysis cannot put an option forward yet. Here is my own reading, set apart below.\n\n${block}`);
    expect(b._agent.provisional_view).toEqual({ ...VIEW, because });
  });

  it('CONTRAST: a readback that PERMITS the leader refuses the tool — no block, the reply byte-identical', async () => {
    readbackState = PERMITTED_STATE;
    const r = await runViewThenReply();
    const b = r.json() as Body;
    expect(callModelOutputs).toEqual([]);
    expect(b._agent.tool_calls.find((c) => c.name === 'give_provisional_view')).toMatchObject({ ok: false, refusal: 'not_withheld' });
    expect(b.assistant_text).toBe(REPLY.text);
    expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
  });
});
