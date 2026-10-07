import { explainRun } from './fixtures/run-explanation-follow-up.js';
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
 *   - the labelled provisional view is TYPED on `_agent` (heading, view, reasoning, the ONE step), never in the prose;
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
const RESULT = { type: 'analysis_result', computed_against_hash: '0123456789abcdef', summary: 'Synthetic completed comparison' };
const WITHHELD_STATE = { ...FX.state.analysis_state, run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' } };
const PERMITTED_STATE = { ...WITHHELD_STATE, leader_claim: { permitted: true, separation: 'separated' } };

const VIEW = {
  view: 'Before comparing, it is worth testing how much churn moves the MRR goal.',
  reasoning: 'You said most Pro subscribers asked for the release, and the model holds churn at 4% either way. The comparison needs the churn assumption checked.',
  confirm_step: 'Tell me the churn you actually expect at £59, and I can propose it so the analysis can check the limit.',
};

const SCENARIO = '5e3d2c1b-6f7a-4b8c-9d0e-1f2a3b4c5d6f';
let readbackState: unknown = WITHHELD_STATE;
let readbackGraph: unknown = FX.state.draft_graph;
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
/** Every model request the route sent, in order. */
const modelRequests: Record<string, unknown>[] = [];

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
  let heading: string;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const req = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelRequests.push(req);
      // The Run turn's forced provisional-view call runs IN PARALLEL with the interpreter: answer it by content, not order.
      if ((req['tool_choice'] as { name?: unknown } | undefined)?.name === 'give_provisional_view') {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(VIEW), call_id: 'forced' }] }), { status: 200 });
      }
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    noLeaderSentence = (await import('../withheld-leader-fail-closed.js')).agentNoLeaderSentence('constraint_verdict_withheld', FX.state.analysis_ready);
    // Written out here, not imported from the module under test: the reason is the gate's own clause, before its ask.
    because = noLeaderSentence.replace(/^No single option can be put forward yet, /, '').split(';')[0]!.trim();
    // The heading is the label alone; the gate's reason travels typed as `because` (the chat opens its why with it).
    heading = `Provisional view \u2014 the analysis can't confirm this yet.`;
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: 'h-run', blocks: [RESULT],
      analysis_ready: FX.state.analysis_ready, analysis_state: readbackState,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: readbackGraph, graph_hash: 'h-corpus', analysis_result: RESULT, analysis_state: readbackState, analysis_ready: FX.state.analysis_ready,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); modelRequests.length = 0; readbackState = WITHHELD_STATE; readbackGraph = FX.state.draft_graph; });

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

  const runWithView = (view: typeof VIEW) => {
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(view), call_id: 'c2' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis cannot put an option forward yet.' }] }],
    ];
    return post('Should we raise Pro to £59?');
  };

  it('RED (DL 5857437282): an internal graph id in the Agent\'s reasoning never egresses — it reads as the node\'s label', async () => {
    readbackState = WITHHELD_STATE;
    const leaky = { ...VIEW, reasoning: 'Your churn limit rests on pro_plan_price, which the model cannot yet check against the limit.' };
    const b = (await runWithView(leaky)).json() as Body;
    const pv = b._agent.provisional_view as { reasoning?: string } | undefined;
    expect(pv, JSON.stringify(b._agent)).toBeDefined();
    expect(pv!.reasoning).not.toContain('pro_plan_price');
    expect(pv!.reasoning).toContain('Pro plan price');
    expect(JSON.stringify(b._agent.provisional_view)).not.toContain('pro_plan_price');
  });

  it('RED (DL 5857437282): a raw code left in the reasoning refuses the view — never repaired, never shown', async () => {
    readbackState = WITHHELD_STATE;
    const coded = { ...VIEW, reasoning: 'The run returned constraint_verdict_withheld, so the limit is unchecked.' };
    const b = (await runWithView(coded)).json() as Body;
    expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
    expect(JSON.stringify(b._agent)).not.toContain('constraint_verdict_withheld, so the limit');
  });

  it('CONTROL: clean words pass the scrub unchanged', async () => {
    readbackState = WITHHELD_STATE;
    const b = (await runWithView(VIEW)).json() as Body;
    expect(b._agent.provisional_view).toEqual({ heading, ...VIEW, because });
  });

  it('fixture control: the reply carries the ranking sentence exactly once', () => {
    expect(REPLY.text.split(RANKING_SENTENCE).length).toBe(2);
  });

  it('RED: a withheld Run turn — prose ranking still stripped, the labelled view is typed on `_agent`, never in the prose', async () => {
    readbackState = WITHHELD_STATE;
    const r = await runViewThenReply();
    expect(r.statusCode).toBe(200);
    expect(callModelOutputs, 'the control: all three scripted outputs were consumed').toEqual([]);
    const b = r.json() as Body;
    expect(b._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['run_analysis', true], ['give_provisional_view', true]]);
    // The gate is unchanged: the model's own ranking sentence is gone and its no-leader sentence is there.
    expect(b.assistant_text).not.toContain(RANKING_SENTENCE.trim());
    expect(b.assistant_text).toContain(noLeaderSentence);
    // ⭐ TYPED ONLY (AIC 5855633777): the view is on `_agent`, with its exact heading, and never in the prose.
    expect(b.assistant_text).not.toContain(VIEW.view);
    expect(b.assistant_text).not.toContain('Provisional view');
    expect(b._agent.provisional_view).toEqual({ heading, ...VIEW, because });
    expect(rows.get(turnId)?.assistant_message, 'the answer row a replay returns holds the same text').toBe(b.assistant_text);
  });

  it('RED: the analysis is untouched — blocks, analysis_state and analysis_ready equal the same turn WITHOUT the tool call, and the text is IDENTICAL (the view is typed only)', async () => {
    readbackState = WITHHELD_STATE;
    const withView = (await runViewThenReply()).json() as Body;
    const without = (await runThenReply()).json() as Body;
    expect(without._agent.tool_calls.map((c) => c.name)).toEqual(['run_analysis']);
    expect(withView.blocks).toEqual(without.blocks);
    expect(withView.analysis_state).toEqual(without.analysis_state);
    expect(withView.analysis_ready).toEqual(without.analysis_ready);
    expect(JSON.stringify(withView.blocks ?? null)).not.toContain('Provisional view');
    expect(JSON.stringify(withView.analysis_state ?? null)).not.toContain(VIEW.view);
    expect(withView.assistant_text, 'the prose is untouched: the view is typed only').toBe(without.assistant_text);
    expect(withView._agent.provisional_view).toEqual({ heading, ...VIEW, because });
    // No tool call → nothing added (never fabricated).
    expect(without.assistant_text).not.toContain('Provisional view');
    expect(Object.hasOwn(without._agent, 'provisional_view')).toBe(false);
  });

  it('RED: an ordinary follow-up turn ("what would you do?") over the withheld result gets the typed view too', async () => {
    readbackState = WITHHELD_STATE;
    callModelOutputs = [
      [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(VIEW), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis cannot put an option forward yet. Here is my own reading, set apart below.' }] }],
    ];
    const b = (await post('So what would you do?')).json() as Body;
    expect(callModelOutputs).toEqual([]);
    expect(b.assistant_text).toBe('The analysis cannot put an option forward yet. Here is my own reading, set apart below.');
    expect(b._agent.provisional_view).toEqual({ heading, ...VIEW, because });
  });

  const pressRun = async (interpretation: string = REPLY.text) => {
    turnSeq += 1;
    turnId = `7a1b2c3d-4e5f-4a6b-8c7d-${String(turnSeq).padStart(12, '0')}`;
    callModelOutputs = [[{ type: 'message', content: [{ type: 'output_text', text: interpretation }] }]];
    return await explainRun(app, SCENARIO, await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: turnId,
      stage: 'analyse', source: 'chip', message: 'Run analysis.', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } } }));
  };

  /**
   * ⭐ C5b — THE RUN BUTTON (DL #70 5856336579, option 1: "fold it into the ONE interpreting call"). Paul met the dead
   * end on the Run button: all 4 Runs in `08bf9a1f` opened "No option can be put forward". The fast path stays ONE
   * interpreting call with no tools (pinned in run-fast-path, unchecked-limit-no-remedy-clause-pinned,
   * run-answer-completeness, agent-run-reply-answer-shape); on a WITHHELD completed run that one call returns a strict
   * JSON `{answer, provisional_view}`, and the view goes to the SAME sidecar as the Agent's tool call, after the gate.
   */
  const pressRunAnswering = (answer: string, view: typeof VIEW | null) => pressRun(JSON.stringify({ answer, provisional_view: view }));

  const withTechLead = () => {
    const graph = FX.state.draft_graph as { nodes: unknown[] };
    readbackGraph = { ...graph, nodes: [...graph.nodes, { id: 'tech_lead', kind: 'option', label: 'Tech lead' }] };
  };

  it.each(['Tech lead should be explored first.', 'We should begin with Tech lead.'])(
    'finding 2 RED: final Run-button sidecar withholds %s', async (line) => {
      withTechLead();
      for (const field of ['view', 'reasoning', 'confirm_step'] as const) {
        const r = await pressRunAnswering('The analysis cannot put an option forward yet.', { ...VIEW, [field]: line });
        expect(r.statusCode).toBe(200);
        const b = r.json() as Body;
        expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
        expect(b.assistant_text).not.toContain(line);
      }
    },
  );

  it('finding 3 RED: final Run-button sidecar retains a question about Tech lead hiring costs', async () => {
    withTechLead();
    const view = { ...VIEW, view: 'Test how much Tech lead hiring costs.' };
    const r = await pressRunAnswering('The analysis cannot put an option forward yet.', view);
    expect(r.statusCode).toBe(200);
    expect((r.json() as Body)._agent.provisional_view).toEqual({ heading, ...view, because });
  });

  it.each([
    'I would explore a Tech lead first, without committing to a hire yet.',
    "I'd start with Tech lead.",
    'Tech lead is worth trying first.',
  ])('HARNESS 3 RED at base: Run-button egress withholds the option preference %s', async (view) => {
    const r = await pressRunAnswering(REPLY.text, { ...VIEW, view });
    expect(r.statusCode).toBe(200);
    const b = r.json() as Body;
    expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
    expect(b.assistant_text).not.toContain(view);
  });

  it('HARNESS 3 must pass: Run-button egress retains a model-relative test', async () => {
    const view = { ...VIEW, view: "Before comparing, it's worth testing how much ‘churn’ moves the goal." };
    const r = await pressRunAnswering(REPLY.text, view);
    expect(r.statusCode).toBe(200);
    const b = r.json() as Body;
    expect(b._agent.provisional_view).toMatchObject(view);
  });

  it('C5b RED: the Run BUTTON on a withheld result → ONE interpreting call, no tools, a strict schema; the labelled view is typed on `_agent`, never in the prose', async () => {
    const r = await pressRunAnswering(REPLY.text, VIEW);
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    const b = r.json() as Body & { _diagnostic_trace?: { fast_path?: string } };
    expect(b._diagnostic_trace?.fast_path).toBe('explain');
    expect(modelRequests, 'exactly one model call').toHaveLength(1);
    expect(modelRequests[0]!['tool_choice']).toBe('none');
    expect(modelRequests[0]!['tools']).toEqual([]);
    const format = (modelRequests[0]!['text'] as { format?: { type?: string; strict?: boolean } } | undefined)?.format;
    expect(format?.type, 'the one call returns a typed answer').toBe('json_schema');
    expect(format?.strict).toBe(true);
    // The view line is asked for, BEFORE the interpret-only line: the banked Interpreter v0.2 text stays last.
    const { INTERPRETER_V02_BANKED, INTERPRET_ONLY_CONSTRAINT } = await import('../../../routes/agent-v1-turn.js');
    const { RUN_INTERPRETATION_VIEW_INSTRUCTION } = await import('../provisional-view.js');
    const instructions = String(modelRequests[0]!['instructions']);
    expect(instructions.endsWith(`${RUN_INTERPRETATION_VIEW_INSTRUCTION}\n\n${INTERPRET_ONLY_CONSTRAINT}\n\n${INTERPRETER_V02_BANKED}`)).toBe(true);
    // No tool was called: the view is a field of the interpreting call, never a fabricated tool call.
    expect(b._agent.tool_calls.map((c) => c.name)).toEqual([]);
    // The gate is unchanged over the ANSWER: its ranking sentence is gone and the no-leader sentence is there.
    expect(b.assistant_text).not.toContain(RANKING_SENTENCE.trim());
    expect(b.assistant_text).toContain(noLeaderSentence);
    // Typed only: the reply text is the answer, never the JSON and never the view.
    expect(b.assistant_text).not.toContain('"provisional_view"');
    expect(b.assistant_text).not.toContain(VIEW.view);
    expect(b.assistant_text).not.toContain('Provisional view');
    expect(b._agent.provisional_view).toEqual({ heading, ...VIEW, because });
    expect([...rows.values()].at(-1)?.assistant_message, 'the separate explanation is saved as its own answer row').toBe(b.assistant_text);
  });

  it('C5b: a view the leader gate would NOT strip (it ranks nothing) still never reaches the prose — typed only', async () => {
    const quiet = {
      view: 'I would wait for one month of churn data before changing the price.',
      reasoning: 'You said churn is the risk that worries you most, and the model cannot check your churn limit yet.',
      confirm_step: 'Tell me the churn you expect at £59, and I can propose it so the analysis can check the limit.',
    };
    const b = (await pressRunAnswering('The analysis cannot put an option forward yet.', quiet)).json() as Body;
    expect(b.assistant_text).toContain('The analysis cannot put an option forward yet.');
    expect(b.assistant_text, 'not in the prose, even where the gate would let it through').not.toContain(quiet.view);
    expect(b.assistant_text).not.toContain(quiet.confirm_step);
    expect(b._agent.provisional_view).toEqual({ heading, ...quiet, because });
  });

  it('C5b: the Run button, and the model gives no view (null) → nothing added; the answer is the reply', async () => {
    const b = (await pressRunAnswering('The analysis cannot put an option forward yet.', null)).json() as Body;
    expect(modelRequests).toHaveLength(1);
    expect(b.assistant_text).toContain('The analysis cannot put an option forward yet.');
    expect(b.assistant_text, 'the reply is the answer, never the JSON').not.toContain('"answer"');
    expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
  });

  it('C5b: a view that breaks its own limits is refused, never repaired (3 sentences in `view`) → no view', async () => {
    const tooLong = { ...VIEW, view: 'I would raise the price. It is stronger. It wins on MRR.' };
    const b = (await pressRunAnswering(REPLY.text, tooLong)).json() as Body;
    expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
    expect(b.assistant_text).not.toContain('It wins on MRR');
    expect(b.assistant_text, 'the reply is the answer, never the JSON').not.toContain('"provisional_view"');
    expect(b.assistant_text).toContain(noLeaderSentence);
  });

  it('C5b: an interpretation that is not the typed answer (plain text) is kept as the reply, with no view', async () => {
    const b = (await pressRun('In the current model, the result turns on churn.')).json() as Body;
    expect(b.assistant_text).toContain('In the current model, the result turns on churn.');
    expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
  });

  it('CONTRAST: the Run button on a result that PERMITS a leader → no schema is asked for, no view (even if one came back)', async () => {
    readbackState = PERMITTED_STATE;
    const b = (await pressRunAnswering(REPLY.text, VIEW)).json() as Body;
    expect(modelRequests).toHaveLength(1);
    expect(modelRequests[0]!['text'], 'a permitted run asks for no view').toBeUndefined();
    const { RUN_INTERPRETATION_VIEW_INSTRUCTION } = await import('../provisional-view.js');
    expect(String(modelRequests[0]!['instructions'])).not.toContain(RUN_INTERPRETATION_VIEW_INSTRUCTION);
    expect(modelRequests.filter((q) => (q['tool_choice'] as { name?: unknown } | undefined)?.name === 'give_provisional_view')).toHaveLength(0);
    expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
  });

  it('CONTRAST: a readback that PERMITS the leader refuses the tool — no view, narrator prose plus the unavailable bounded basis', async () => {
    readbackState = PERMITTED_STATE;
    const r = await runViewThenReply();
    const b = r.json() as Body;
    expect(callModelOutputs).toEqual([]);
    expect(b._agent.tool_calls.find((c) => c.name === 'give_provisional_view')).toMatchObject({ ok: false, refusal: 'not_withheld' });
    // Re-pinned for S-A (DL ruling R1, 7 Oct): the basis is a host disclosure; it is kept exactly once and MAY sit under
    // "More detail". The reply passes the ONE composer (its text is the shape's derivation when shaped).
    const BASIS = 'The sources of this comparison’s factor starting values are unavailable.';
    expect(b.assistant_text.split(BASIS)).toHaveLength(2);
    for (const line of REPLY.text.split('\n').filter((l) => l.trim() !== '')) expect(b.assistant_text).toContain(line.replace(/^\s*[-•*]\s+/, '').trim());
    expect(Object.hasOwn(b._agent, 'provisional_view')).toBe(false);
  });
});
