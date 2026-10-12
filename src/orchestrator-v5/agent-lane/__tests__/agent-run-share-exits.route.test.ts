/**
 * ⭐ THE WIN-SHARE CLASS AT THE REAL AGENT EXITS (`agent_lane_v1_final`, `agent_lane_v1_replay`) — the route rows of the one
 * exit-sweep property (`compose/__tests__/support/run-share-property.support.ts`; the sweep is `run-share-exit-sweep.test.ts`).
 *
 * The real `POST /agent/v1/turn` (the harness of `agent-run-reply-answer-shape.test.ts`: the model call is a stubbed `fetch`,
 * the Run is the product's own turn route as the run_analysis capability dispatches it, the readback is the corpus's served
 * pricing state with the claim permitted). The one filter is wrapped by a spy recording, per exit, what it was given, the
 * evidence the route passed and what came back. Rows:
 *   · the f5689c76 check's blocking case — a model reply that ran NOTHING states a share: reasoning, returned BY REFERENCE,
 *     never "Ran analysis on your current scenario.";
 *   · the Agent's own run_analysis call that RAN: the reply's share sentences are removed; with nothing else left, the locked
 *     Run template (true: this turn ran);
 *   · the typed Run's Explain turn on the current Run: removal; with nothing else left, the whole words and the AIE's
 *     qualifier, never the template;
 *   · REPLAY, by the STORED ROW's own evidence: a pre-rule explanation row is filtered; a pre-rule row with no proof ships
 *     untouched; a row carrying Olumi's fixed Run line is filtered.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { RUN_RESULT_READY_TEXT } from '../run-explanation.js';
import { runShareViolations } from '../../compose/__tests__/support/run-share-property.support.js';
import type { ReplyRunEvidence } from '../../compose/run-share-text.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';

type Rec = Record<string, any>;
const spy = vi.hoisted(() => ({ exits: [] as { exitPath: string; evidence: ReplyRunEvidence; input: Rec; output: Rec }[] }));
vi.mock('../../compose/run-share-text.js', async () => {
  const actual = await vi.importActual<typeof import('../../compose/run-share-text.js')>('../../compose/run-share-text.js');
  return { ...actual, withRunShareFreeResult: <T extends object>(body: T, opts: Parameters<typeof actual.withRunShareFreeResult>[1]): T => {
    const output = actual.withRunShareFreeResult(body, opts);
    spy.exits.push({ exitPath: opts.exitPath, evidence: opts.evidence, input: body as Rec, output: output as Rec });
    return output;
  } };
});
const { RUN_RESULT_TEMPLATE, RUN_SHARE_QUALIFIER, statesRunShare } = await import('../../compose/run-share-text.js');

const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: { leader_claim: Record<string, unknown> } & Record<string, unknown>; analysis_ready: unknown };
};
const SERVED_RUN = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/c19-8428207-B.run-turns.trimmed.json', import.meta.url), 'utf8')) as {
  turns: { t2: { analysis_result: { type: string; computed_against_hash: string } & Record<string, unknown> } };
};
const RESULT_BLOCK = SERVED_RUN.turns.t2.analysis_result;
const GRAPH_HASH = RESULT_BLOCK.computed_against_hash;
const PERMITTED_STATE = { ...FX.state.analysis_state, leader_claim: { permitted: true, separation: 'separated' },
  run_state: { ...(FX.state.analysis_state.run_state as Record<string, unknown>), computed_at: '2026-10-01T12:00:00.000Z' } };
const READY = (() => {
  const ready = structuredClone(FX.state.analysis_ready) as { analysis_admission: { semantic_signals: Record<string, unknown> } };
  ready.analysis_admission.semantic_signals.material_parameters_awaiting_user_node_ids = [];
  return ready;
})();

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
  readRecent: vi.fn(async (): Promise<Row[]> => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

/** The share-text flips (the property support's own words would do; these are the Agent's prose about a Run). */
const SHARE = 'In this model, ‘Raise to £59’ was supported by 62% of runs.';
const KEEP = 'Check the conversion rate before you commit.';
const PARTIAL = `${SHARE} ${KEEP}`;
const ALL = `${SHARE} ‘Hold at £49’ was supported by the next most runs (38%).`;
/** The host's robustness caveat on this served Run (`agent-run-reply-answer-shape.test.ts`'s ROBUSTNESS_CAVEAT). */
const ROBUST = 'The result is not yet robust — small changes could flip it.';

let callModelOutputs: Record<string, unknown>[][] = [];
const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const runCall = [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'run-1' }];

describe('the Agent route: the class property at its final and replay exits', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: GRAPH_HASH, blocks: [RESULT_BLOCK],
      analysis_ready: READY, analysis_state: PERMITTED_STATE,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async (req) => withCanonicalAnalysisView({
      graph: FX.state.draft_graph, graph_hash: GRAPH_HASH, analysis_state: PERMITTED_STATE, analysis_ready: READY, analysis_result: RESULT_BLOCK,
    }, (req.params as { id: string }).id));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { vi.mocked(fetch).mockClear(); rows.clear(); callModelOutputs = []; spy.exits.length = 0; });

  let seq = 0;
  const nextScenario = () => { seq += 1; return `4b3a2c1d-0e9f-4a8b-8c7d-${String(seq).padStart(12, '0')}`; };
  const nextTurnId = () => { seq += 1; return `6e5d4c3b-2a1f-4e0d-9c8b-${String(seq).padStart(12, '0')}`; };
  const post = async (payload: Rec) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return r.json() as Rec;
  };
  /** An ordinary composer message the Agent answers (after any scripted tool calls); returns the payload for a replay. */
  const asked = async (text: string, calls: Record<string, unknown>[][] = [], message = 'What does the analysis say?') => {
    callModelOutputs = [...calls, say(text)];
    const payload = { kind: 'message', scenario_id: nextScenario(), message, turn_id: nextTurnId() };
    const b = await post(payload);
    expect(callModelOutputs, 'the control: the scripted reply was consumed').toEqual([]);
    return { b, payload };
  };
  /** The UI's Run control, then its Explain press — the model interprets the Run on the Explain turn. */
  const explained = async (text: string) => {
    const scenario = nextScenario();
    callModelOutputs = [say(text)];
    const run = await post({ kind: 'message', scenario_id: scenario, message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: nextTurnId() });
    const chip = run.suggested_actions.find((c: { id: string }) => c.id.startsWith('agent-explain-run:'));
    expect(chip, 'the control: the Run offered its Explain press').toBeDefined();
    const payload = { scenario_id: scenario, agent_session_id: run._agent.session_id, turn_id: nextTurnId(), message: chip.message, chip: { id: chip.id } };
    spy.exits.length = 0;
    const b = await post(payload);
    expect(b._diagnostic_trace.fast_path, 'the control: the press only explains').toBe('explain');
    return { b, payload };
  };
  const exitAt = (exitPath: string) => {
    const found = spy.exits.filter((e) => e.exitPath === exitPath);
    expect(found, `${exitPath} ran once`).toHaveLength(1);
    return found[0]!;
  };
  const truthOf = (e: ReplyRunEvidence) => ({ ran: e.surface === 'run_result', explains: e.surface === 'run_explanation',
    replayed: e.surface !== 'reasoning' && e.basis.startsWith('replayed_') });
  /** AIE #94 6132355107: the FINAL edited body at the real exit — its V5 members pass the strict schema, and a shape that
   *  ships still derives exactly the words that ship. */
  const V5_KEYS = ['response_version', 'assistant_text', 'blocks', 'suggested_actions', 'insights', 'stage_indicator'] as const;
  const expectValidAtExit = (b: Rec) => {
    const v5 = Object.fromEntries(V5_KEYS.filter((k) => k in b).map((k) => [k, b[k]]));
    const parsed = OlumiResponseSchema.safeParse(v5);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    if (b._answer_shape !== undefined) expect(deriveAnswerTextFromShape(b._answer_shape as AnswerShape)).toBe(b.assistant_text);
  };

  it('(f5689c76 blocker) a model reply that ran NOTHING states a share: reasoning, by reference, never a Run claim', async () => {
    const { b } = await asked(ALL);
    const exit = exitAt('agent_lane_v1_final');
    expect(b._agent.tool_calls, 'the control: no tool ran').toEqual([]);
    expect(exit.evidence).toEqual({ surface: 'reasoning' });
    expect(exit.output).toBe(exit.input);
    expect(exit.input.assistant_text, 'the control: the model\'s share sentences reached the exit').toContain(SHARE);
    expect(b.assistant_text).not.toContain(RUN_RESULT_TEMPLATE);
    expect(runShareViolations({ ran: false, explains: false }, exit.input, exit.output)).toEqual([]);
    expectValidAtExit(b);
  });

  it('the Agent\'s own run_analysis call RAN, all-share reply: the locked Run template, and no share anywhere on the reply', async () => {
    const { b } = await asked(ALL, [runCall], 'Run the analysis and tell me what it says.');
    expect(b._agent.tool_calls, 'the control: the Agent ran the analysis').toMatchObject([{ name: 'run_analysis', ok: true }]);
    const exit = exitAt('agent_lane_v1_final');
    expect(exit.evidence).toEqual({ surface: 'run_result', basis: 'ran_this_turn' });
    expect(exit.output.assistant_text).toBe(RUN_RESULT_TEMPLATE);
    expect(runShareViolations(truthOf(exit.evidence), exit.input, b)).toEqual([]);
    expect(statesRunShare(b.assistant_text)).toBe(false);
    expectValidAtExit(b);
  });

  it('the Agent\'s own run_analysis call RAN, partial reply: the share sentence is removed and the rest ships', async () => {
    const { b } = await asked(PARTIAL, [runCall], 'Run the analysis and tell me what it says.');
    const exit = exitAt('agent_lane_v1_final');
    expect(exit.evidence).toEqual({ surface: 'run_result', basis: 'ran_this_turn' });
    expect(exit.output.assistant_text).toBe(KEEP);
    expect(b.assistant_text).toContain(KEEP);
    expect(b.assistant_text).not.toContain(RUN_RESULT_TEMPLATE);
    expect(runShareViolations(truthOf(exit.evidence), exit.input, b)).toEqual([]);
    expectValidAtExit(b);
  });

  it('Explain on the current Run: removal only — the host\'s own caveat after the model\'s words is kept, never the template', async () => {
    // The host appends its robustness caveat on this Run, so the reply always has something besides the share sentences;
    // the all-share qualifier path is proven at the real replay exit below (and in the sweep).
    const partial = await explained(PARTIAL);
    const p = exitAt('agent_lane_v1_final');
    expect(p.evidence).toEqual({ surface: 'run_explanation', basis: 'explains_current_run' });
    expect(p.input.assistant_text, 'the control: the model\'s words, then the host caveat').toBe(`${PARTIAL} ${ROBUST}`);
    expect(p.output.assistant_text).toBe(`${KEEP} ${ROBUST}`);
    expect(partial.b.assistant_text).not.toContain(SHARE);
    expect(runShareViolations(truthOf(p.evidence), p.input, partial.b)).toEqual([]);
    expectValidAtExit(partial.b);

    const all = await explained(ALL);
    const a = exitAt('agent_lane_v1_final');
    expect(a.input.assistant_text).toBe(`${ALL} ${ROBUST}`);
    expect(a.output.assistant_text).toBe(ROBUST);
    expect(all.b.assistant_text).not.toContain(RUN_RESULT_TEMPLATE);
    expect(runShareViolations(truthOf(a.evidence), a.input, all.b)).toEqual([]);
    expectValidAtExit(all.b);
  });

  it('REPLAY of a pre-rule explanation row is filtered by THAT ROW\'s evidence (the Explain press on the current Run)', async () => {
    const { payload } = await explained(KEEP);
    const turnId = payload.turn_id;
    rows.set(turnId, { ...rows.get(turnId)!, assistant_message: PARTIAL }); // the row as stored before the rule
    spy.exits.length = 0;
    const replay = await post(payload);
    expect(replay._agent.replayed, 'the control: a replay').toBe(true);
    const exit = exitAt('agent_lane_v1_replay');
    expect(exit.evidence).toEqual({ surface: 'run_explanation', basis: 'replayed_row_explained' });
    expect(exit.input.assistant_text, 'the control: the stored share sentence reached the replay exit').toContain(SHARE);
    expect(replay.assistant_text).not.toContain(SHARE);
    expect(replay.assistant_text).toContain(KEEP);
    expect(runShareViolations(truthOf(exit.evidence), exit.input, exit.output)).toEqual([]);
    expectValidAtExit(replay);

    // The same row stored with ONLY share sentences: the whole words and the AIE qualifier, never the Run template.
    rows.set(turnId, { ...rows.get(turnId)!, assistant_message: ALL });
    spy.exits.length = 0;
    const replayAll = await post(payload);
    const exitAll = exitAt('agent_lane_v1_replay');
    expect(exitAll.output.assistant_text).toBe(`${ALL}\n\n${RUN_SHARE_QUALIFIER}`);
    expect(replayAll.assistant_text).toContain(RUN_SHARE_QUALIFIER);
    expect(replayAll.assistant_text).not.toContain(RUN_RESULT_TEMPLATE);
    expect(runShareViolations(truthOf(exitAll.evidence), exitAll.input, exitAll.output)).toEqual([]);
    expectValidAtExit(replayAll);
  });

  it('REPLAY of a pre-rule row with NO proof ships untouched (today\'s readback lends it nothing), never a Run claim', async () => {
    const { payload } = await asked(KEEP);
    rows.set(payload.turn_id, { ...rows.get(payload.turn_id)!, assistant_message: ALL });
    spy.exits.length = 0;
    const replay = await post(payload);
    expect(replay._agent.replayed, 'the control: a replay').toBe(true);
    const exit = exitAt('agent_lane_v1_replay');
    expect(exit.evidence).toEqual({ surface: 'reasoning' });
    expect(exit.output).toBe(exit.input);
    expect(exit.input.assistant_text, 'the control: the stored share sentences reached the replay exit').toContain(SHARE);
    expect(replay.assistant_text).not.toContain(RUN_RESULT_TEMPLATE);
    expectValidAtExit(replay);
  });

  it('REPLAY of a row carrying Olumi\'s fixed Run line is a Run reply BY ITS OWN ROW: filtered', async () => {
    const { payload } = await asked(KEEP);
    rows.set(payload.turn_id, { ...rows.get(payload.turn_id)!, assistant_message: `${RUN_RESULT_READY_TEXT}\n\n${PARTIAL}` });
    spy.exits.length = 0;
    const replay = await post(payload);
    expect(replay._agent.replayed, 'the control: a replay').toBe(true);
    const exit = exitAt('agent_lane_v1_replay');
    expect(exit.evidence).toEqual({ surface: 'run_result', basis: 'replayed_row_ran' });
    expect(exit.input.assistant_text).toContain(SHARE);
    expect(replay.assistant_text).not.toContain(SHARE);
    expect(replay.assistant_text).toContain(KEEP);
    expect(runShareViolations(truthOf(exit.evidence), exit.input, exit.output)).toEqual([]);
    expectValidAtExit(replay);
  });
});
