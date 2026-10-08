/**
 * S4d THROUGH THE ROUTE: the Explain turn says the screen's chance lines too.
 *
 * Wave B5 X1 (7 Oct, CEE 3fce64f, request 42e5c40d) was the EXPLAIN turn (fast_path explain, `agent.interpret`). It said
 * "For reaching at least £126,000 monthly recurring revenue, on current information:" and then nothing: the leader gate
 * deleted the three chance lines (Render: withheld_leader_ranking_dropped, 3). S4c covered only turns that ran an analysis.
 * The harness is the real route with a fixed narrator (no provider is contacted), pressing the real Explain control
 * (harness from explain-low-robustness-caveat.route.test.ts), on the SERVED B5 T1b readback (keys untouched). The expected
 * lines are the ones the UI drew on that Run (`waveB-screen-chance-lines-20261007.json`, source t1b-b5-1). The narrator's
 * pre-gate words were not captured; the narrator here writes the screen's own lines (author-reconstructed, which the gate
 * deletes, as Render shows it did).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { HORIZON_MARKER, REPLY_FACE_WORD_BUDGET } from '../reply/compose-reply.js';
import { untestedHorizonLine } from '../decision-input-ask.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCREEN = (JSON.parse(readFileSync(new URL('./fixtures/waveB-screen-chance-lines-20261007.json', import.meta.url), 'utf8')) as { line: string; source: string }[])
  .filter((s) => s.source.includes('/t1b-b5-1/')).map((s) => s.line);
const LEAD = 'For reaching at least £126,000 monthly recurring revenue, on current information:';
const SIZE_QUESTION = 'How sure are you of that size?';
const SCENARIO = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const count = (text: string, s: string): number => text.split(s).length - 1;

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
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('S4d: the Explain turn on a current Run says the screen’s chance lines', () => {
  let app: FastifyInstance;
  let narrator = '';
  let state: Json = READ.analysis_state;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [
      { type: 'message', content: [{ type: 'output_text', text: narrator }] },
    ] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [READ.analysis_result], analysis_ready: READ.analysis_ready, analysis_state: state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: READ.graph, graph_hash: READ.graph_hash, analysis_state: state,
      analysis_ready: READ.analysis_ready, analysis_result: READ.analysis_result,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); narrator = ''; state = READ.analysis_state; });

  const runThenExplainPayload = async (): Promise<Record<string, unknown>> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: randomUUID(),
    } });
    expect(r.statusCode, r.body).toBe(200);
    const first = r.json();
    const chip = first.suggested_actions.find((c: { id: string }) => c.id.startsWith('agent-explain-run:'));
    expect(chip, r.body).toBeDefined();
    return { scenario_id: SCENARIO, agent_session_id: first._agent.session_id, turn_id: randomUUID(), message: RUN_EXPLANATION_MESSAGE, chip: { id: chip.id } };
  };
  const press = async (payload: Record<string, unknown>): Promise<{ assistant_text: string; _answer_shape?: AnswerShape; _diagnostic_trace: { fast_path: string } }> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };

  it('fixture control: the served T1b readback is a current Run, leader withheld, 3 screen lines', () => {
    expect(READ.analysis_state.run_state.kind).toBe('complete_current');
    expect(READ.analysis_state.leader_claim.permitted).toBe(false);
    expect(SCREEN).toHaveLength(3);
    expect(count(SCREEN[0]!, SIZE_QUESTION)).toBe(1);
    expect(count(SCREEN[1]!, SIZE_QUESTION)).toBe(1);
  });

  it('RED at base: the narrator writes the screen’s lines, the leader gate deletes them, and the Explain reply still leads with each exact finding, moving its optional frame to detail on mandatory overflow', async () => {
    const nearTie = 'No single option can be put forward: the comparison is a near tie.';
    narrator = `${nearTie}\n\n${LEAD}\n\n${SCREEN.join(' ')}`;
    const b = await press(await runThenExplainPayload());
    expect(b._diagnostic_trace.fast_path).toBe('explain');
    // RC6: the repeated question stays with the first typed chance+depends unit; only its later copy is dropped.
    const saidOnceLines = SCREEN.map((line, i) => i === 1 ? line.replace(` ${SIZE_QUESTION}`, '') : line);
    for (const line of saidOnceLines) expect(count(b.assistant_text, line), b.assistant_text).toBe(1);
    expect(count(b.assistant_text, SIZE_QUESTION), b.assistant_text).toBe(1);
    expect(b._answer_shape, 'RC6 re-binds the second unit instead of shipping obligation_unlocated whole').toBeDefined();
    const shape = b._answer_shape!;
    const horizon = untestedHorizonLine(READ.graph, { besideChance: true, plural: true });
    expect(horizon).not.toBeNull();
    const mandatory = [...saidOnceLines, HORIZON_MARKER];
    const face = [shape.headline, ...shape.bullets];
    // r5 item 2: exact chance findings, their own notes/question and horizon marker remain mandatory over 80 words.
    // The optional narrator frame is demoted with E/W; no screen finding or its question is shortened to make room.
    expect(mandatory.join(' ').trim().split(/\s+/)).toHaveLength(113);
    expect(mandatory.join(' ').trim().split(/\s+/).length).toBeGreaterThan(REPLY_FACE_WORD_BUDGET);
    expect(face).toEqual(mandatory);
    expect(shape.headline, 'the first unit and its question still lead, unchanged').toBe(SCREEN[0]!);
    expect(b.assistant_text.startsWith(SCREEN[0]!), b.assistant_text).toBe(true);
    expect(face.join('\n')).not.toContain(LEAD);
    expect(count(shape.detail, LEAD), 'the optional frame remains exactly once under More detail').toBe(1);
    expect(count(shape.detail, nearTie)).toBe(1);
    expect(count(b.assistant_text, nearTie)).toBe(1);
    expect(face.join('\n')).not.toContain(horizon!);
    expect(count(face.join('\n'), HORIZON_MARKER), 'one plural marker after the chance lines').toBe(1);
    expect(face.at(-1), 'the mandatory plural marker follows all exact chance findings').toBe(HORIZON_MARKER);
    expect(count(shape.detail, horizon!), 'full producer horizon is verbatim once in detail').toBe(1);
    expect(count(b.assistant_text, horizon!)).toBe(1);
    expect(b.assistant_text).toBe(deriveAnswerTextFromShape(shape));
    expect(b._answer_shape!.bullets).toContain(saidOnceLines[1]!);
    expect(b._answer_shape!.bullets.join(' ')).not.toContain(SIZE_QUESTION);
    expect(count(b.assistant_text, LEAD)).toBe(1);
    expect(b.assistant_text.trimEnd().endsWith(':'), 'never ends on a colon').toBe(false);
  });

  it('a narrator that gives each figure in its own words gets nothing added (never two wordings)', async () => {
    narrator = `${LEAD}\n- Raise prices 10%: about 47%.\n- Launch £49 starter tier: about 34%.\n- Keep pricing as it is: less than 1%.`;
    const b = await press(await runThenExplainPayload());
    expect(b._diagnostic_trace.fast_path).toBe('explain');
    expect(count(b.assistant_text, 'chance of meeting your goal, in this model'), b.assistant_text).toBe(0);
  });

  it('CONTROL: an Explain for a Run that is no longer the current one (a newer Run since) says no chance line', async () => {
    narrator = `${LEAD}\n\n${SCREEN.join(' ')}`;
    const payload = await runThenExplainPayload();
    // A newer Run, still complete and current: the old Explain control no longer matches it (narration `stale`).
    state = { ...READ.analysis_state, run_state: { ...READ.analysis_state.run_state, computed_at: '2026-10-07T07:59:00.000Z' } };
    const b = await press(payload);
    expect(count(b.assistant_text, 'chance of meeting your goal, in this model'), b.assistant_text).toBe(0);
  });
});
