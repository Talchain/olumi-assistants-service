/**
 * S4c THROUGH THE ROUTE: on a Run turn the screen's range line is in the reply (Wave B4: both Run narrations said "only as
 * a range" with no figure). The REAL agent route, a scripted OpenAI `fetch` (no provider is contacted), and the SERVED
 * b3-2 readback (`waveB3-unseen2-7addf05-readback-run1.json`, keys untouched). The expected line is the one the UI drew on
 * that Run (`waveB-screen-chance-lines-20261007.json`, source unseen-b3-2). Harness copied from the S2e route test.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import { SPREAD_NOTE_WITHOUT_DOWNSIDE } from '../../goal-target/goal-chance-licence.js';
import type { AnswerShape } from '../../routing/answer-shape.js';

type Json = Record<string, any>;
const READ_B3 = (JSON.parse(readFileSync(new URL('./fixtures/waveB3-unseen2-7addf05-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
/** B5 T1b on 3fce64f: three point lines on the `each` licence, leader withheld (near tie); the gate deleted the chat's copy. */
const READ_T1B = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
let READ: Json = READ_B3;
const VIEW = {
  view: 'Before comparing, size how strongly running a fourth shop changes its monthly operating profit.',
  reasoning: 'That relationship remains unsized.',
  confirm_step: 'Tell me roughly how much monthly profit the fourth shop would add, and I can propose it.',
};
const SCENARIO = '7a5e4d3c-2b1a-4d0e-9f8a-7b6c5d4e3f2a';
const ALL_SCREEN = JSON.parse(readFileSync(new URL('./fixtures/waveB-screen-chance-lines-20261007.json', import.meta.url), 'utf8')) as { line: string; source: string }[];
const SCREEN = ALL_SCREEN.filter((s) => s.source.includes('/unseen-b3-2/')).map((s) => s.line);
const SCREEN_T1B = ALL_SCREEN.filter((s) => s.source.includes('/t1b-b5-1/')).map((s) => s.line);
const SIZE_QUESTION = 'How sure are you of that size?';
// RC6 keeps the first screen unit intact and drops only the later copy of its question.
const SCREEN_T1B_SAID_ONCE = SCREEN_T1B.map((line, i) => i === 1 ? line.replace(` ${SIZE_QUESTION}`, '') : line);
let analysisResult: Json = READ.analysis_result;

const rows = new Map<string, Json>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: Json) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...w, assistant_message: w.assistantMessage, user_message: w.userMessage, id: `row-${rows.size + 1}` };
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
type Body = { assistant_text: string; _answer_shape?: AnswerShape; _agent: { tool_calls: { name: string; ok: boolean }[]; replayed?: boolean } };

describe('S4c through the route: the screen’s range line is in the Run narration', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const req = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if ((req['tool_choice'] as { name?: unknown } | undefined)?.name === 'give_provisional_view') {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(VIEW), call_id: 'forced' }] }), { status: 200 });
      }
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [analysisResult], analysis_ready: READ.analysis_ready, analysis_state: READ.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: READ.graph, graph_hash: READ.graph_hash, analysis_result: analysisResult, analysis_state: READ.analysis_state,
      analysis_ready: READ.analysis_ready,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); READ = READ_B3; analysisResult = JSON.parse(JSON.stringify(READ.analysis_result)); });
  const useT1b = (): void => { READ = READ_T1B; analysisResult = JSON.parse(JSON.stringify(READ.analysis_result)); };

  let seq = 0;
  const turn = async (outputs: Record<string, unknown>[][], message: string): Promise<Body> => {
    seq += 1;
    callModelOutputs = outputs;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message, turn_id: `9c3d4e5f-6a7b-4c8d-9e0f-${String(seq).padStart(12, '0')}`,
    } });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as Body;
    expect(b._agent.replayed).not.toBe(true);
    return b;
  };
  const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
  const run = (reply: string) => [[{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }], say(reply)];
  const count = (text: string, s: string): number => text.split(s).length - 1;
  const estimateScreenLine = () => {
    READ = structuredClone(READ_T1B);
    READ.graph.nodes.find((n: Json) => n.id === 'raise_prices_10').label = 'Raise to £59';
    READ.analysis_state.leader_claim = { permitted: true, separation: 'separated' };
    analysisResult = structuredClone(READ.analysis_result);
    analysisResult.enrichment.inference_warnings = [{
      code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance of meeting your goal is licensed on this Run.',
      form: 'each', option_ids: ['raise_prices_10'], pct_by_option: { raise_prices_10: 67 },
      target: { comparator: 'at_least', value: 126000, unit: '£/month' }, olumi_estimate_link_count: 1,
      goal_node_id: 'monthly_recurring_revenue', goal_label: 'Monthly recurring revenue',
      option_labels_by_option: { raise_prices_10: 'Raise to £59' },
    }];
    return goalChanceScreenLinesForAgent(analysisResult, READ.graph, true)[0]!;
  };
  const shortfallScreenLine = () => {
    READ = structuredClone(READ_T1B);
    READ.analysis_state.leader_claim = { permitted: true };
    analysisResult = structuredClone(READ.analysis_result);
    // Authored stored licence strings isolate the route/composer contract from the producer's numerical rows.
    analysisResult.enrichment.inference_warnings = [{
      code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance of meeting your goal is licensed on this Run.',
      form: 'each', option_ids: ['raise_prices_10'], pct_by_option: { raise_prices_10: 55 },
      target: { comparator: 'at_least', value: 126000, unit: '£/month' },
      sent_threshold: { value: 126000, field: 'goal_threshold_raw', frame: 'delta' },
      spread_note_by_option: { raise_prices_10: SPREAD_NOTE_WITHOUT_DOWNSIDE },
      shortfall_note_by_option: {
        raise_prices_10: 'In its worst 1 in 20 runs of this model, ‘Raise prices 10%’ falls short of your target by £16,000 / month or more.',
      },
    }];
    const lines = goalChanceScreenLinesForAgent(analysisResult, READ.graph, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.spread_note).toBe(SPREAD_NOTE_WITHOUT_DOWNSIDE);
    expect(lines[0]!.shortfall_note).toBeDefined();
    return lines[0]!;
  };

  it('GP review P1: zero added lines still applies cleaned narration and removes a fabricated link count', async () => {
    shortfallScreenLine();
    analysisResult.enrichment.inference_warnings[0].olumi_estimate_link_count = 1;
    const line = goalChanceScreenLinesForAgent(analysisResult, READ.graph, true)[0]!;
    expect(line.olumi_estimate_link_count).toBe(1);
    const canonical = [line.chance, line.depends].filter(Boolean).join(' ');
    const narration = `${canonical} Olumi's estimates feed 99 links.`;
    const cleaned = withScreenLinesOwed(narration, [line]);
    expect(cleaned.added).toBe(0);
    expect(cleaned.text).not.toContain('99 links');
    const b = await turn(run(narration), 'Run it');
    expect(b.assistant_text).not.toContain('99 links');
    expect(b.assistant_text).toContain(line.chance);
  });

  it.each(['run', 'follow-up', 'added=0'] as const)('r10 %s: qualified points are labelled on wire, storage and replay', async kind => {
    const line = estimateScreenLine();
    const bare = kind === 'follow-up' ? 'The recorded chance for Raise to £59 is 67%.' : '‘Raise to £59’: about 67% in this model.';
    const unrelated = 'The chance of supplier failure is 10%. The chance of supplier failure is 67%.';
    const narration = `${bare} ${unrelated}${kind === 'added=0' ? `\n${line.chance}` : ''}`;
    const outputs = kind === 'follow-up' ? [say(narration)] : run(narration);
    const message = kind === 'follow-up' ? 'What was the recorded chance for Raise to £59?' : 'Run it';
    const b = await turn(outputs, message);
    const assertLabelled = (text: string) => {
      expect(text).not.toContain(bare);
      expect(count(text, line.chance), text).toBe(1);
      expect(text).toContain(unrelated);
    };
    assertLabelled(b.assistant_text);
    const saved = [...rows.values()].find(r => r.assistant_message === b.assistant_text);
    expect(saved, 'the exact labelled wire text is the durable answer').toBeDefined();
    assertLabelled(saved!.assistant_message);
    // Even a historical ordinary answer with the old bare sentence crosses the current licence boundary on replay.
    if (kind === 'follow-up') saved!.assistant_message = narration;
    const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message, turn_id: saved!.turn_id,
    } });
    expect(replay.statusCode, replay.body).toBe(200);
    const replayed = replay.json() as Body;
    expect(replayed._agent.replayed).toBe(true);
    assertLabelled(replayed.assistant_text);
  });

  it('fixture control: the served readback carries a range record and withholds the leader on a current Run', () => {
    expect(READ.analysis_result.enrichment.inference_warnings.map((w: Json) => w.code)).toContain('GOAL_CHANCE_RANGE');
    expect(READ.analysis_state.leader_claim.permitted).toBe(false);
    expect(READ.analysis_state.run_state.kind).toBe('complete_current');
    expect(SCREEN).toHaveLength(1);
  });

  it('RED at base: a Run reply with no range figure ends up saying the screen’s line, once', async () => {
    const b = await turn(run('The analysis ran, but it cannot put an option forward yet.'), 'Run it');
    expect(b._agent.tool_calls.map((c) => c.name)).toContain('run_analysis');
    expect(count(b.assistant_text, SCREEN[0]!), b.assistant_text).toBe(1);
  });

  it('a Run reply that already says the line keeps ONE copy (the leader gate and egress leave it)', async () => {
    const b = await turn(run(`The analysis ran. ${SCREEN[0]}`), 'Run it');
    expect(count(b.assistant_text, 'between about 5% and 50%'), b.assistant_text).toBe(1);
  });

  it('CONTRAST: the same Run with no range record says no range', async () => {
    analysisResult.enrichment.inference_warnings = analysisResult.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE');
    const b = await turn(run('The analysis ran, but it cannot put an option forward yet.'), 'Run it');
    expect(b.assistant_text).not.toContain('between about');
  });

  it('POINTS, RED at base (B5 T1b readback): a Run reply whose figures are gone ends up with the screen’s three lines, once each', async () => {
    useT1b();
    expect(READ.analysis_state.leader_claim.permitted).toBe(false);
    expect(SCREEN_T1B).toHaveLength(3);
    expect(count(SCREEN_T1B[0]!, SIZE_QUESTION)).toBe(1);
    expect(count(SCREEN_T1B[1]!, SIZE_QUESTION)).toBe(1);
    const b = await turn(run('No single option can be put forward: the comparison is a near tie.\n\nFor reaching at least £126,000 monthly recurring revenue, on current information:'), 'Run it');
    for (const line of SCREEN_T1B_SAID_ONCE) expect(count(b.assistant_text, line), b.assistant_text).toBe(1);
    expect(count(b.assistant_text, SIZE_QUESTION), b.assistant_text).toBe(1);
    // B15 (#2783, DL): the lead-in opens the headline and is directly followed by the first screen chance finding; it
    // still introduces the list and never ends the reply on a colon.
    const lead = 'For reaching at least £126,000 monthly recurring revenue, on current information:';
    expect(b.assistant_text.startsWith(`${lead}\n${SCREEN_T1B[0]!}`), b.assistant_text).toBe(true);
    expect(count(b.assistant_text, lead)).toBe(1);
    expect(b.assistant_text.trimEnd().endsWith(':'), 'never ends on a colon').toBe(false);
  });

  it('POINTS through the REAL leader gate: the Agent writes the screen’s lines, the gate deletes them, and the user still reads each once', async () => {
    useT1b();
    const b = await turn(run(`For reaching at least £126,000 monthly recurring revenue, on current information:\n\n${SCREEN_T1B.join(' ')}`), 'Run it');
    for (const line of SCREEN_T1B_SAID_ONCE) expect(count(b.assistant_text, line), b.assistant_text).toBe(1);
    expect(count(b.assistant_text, SIZE_QUESTION), b.assistant_text).toBe(1);
    expect(b.assistant_text.startsWith(`For reaching at least £126,000 monthly recurring revenue, on current information:\n${SCREEN_T1B[0]!}`), 'the first chance+depends unit keeps its question and still leads').toBe(true);
  });

  it('B19 r3: a completed reply preserves Agent chance phrasing and keeps the appended canonical unit on the face', async () => {
    const line = shortfallScreenLine();
    const phrased = 'Raise prices 10%: about 55%.';
    const reply = `Analysis is ready. Review the evidence. Check the assumptions. ${phrased} Keep unresolved disagreements visible in the model for the team’s next review and keep the conversation grounded in evidence.`;
    const completed = withScreenLinesOwed(reply, [line]);
    expect(completed.added, 'the control: the route owes the complete canonical line').toBe(1);
    expect(completed.text.trim().split(/\s+/).length, 'the reply really crosses the composer boundary').toBeGreaterThanOrEqual(80);
    expect(completed.text).toBe(`${reply}\n\n${line.chance}`);
    const b = await turn(run(reply), 'Run it');
    expect(b._agent.tool_calls.map((c) => c.name)).toContain('run_analysis');
    expect(callModelOutputs, 'the control: the scripted Agent phrasing was consumed').toEqual([]);
    expect(b._answer_shape, 'the control: the reply really passes the face/detail split').toBeDefined();
    const face = [b._answer_shape!.headline, ...b._answer_shape!.bullets].join(' ');
    for (const note of [line.spread_note!, line.shortfall_note!]) {
      expect(count(b.assistant_text, note), b.assistant_text).toBe(1);
      expect(face, 'each licensed note is evidence on the face').toContain(note);
      expect(b._answer_shape!.detail).not.toContain(note);
    }
    expect(b.assistant_text).toContain(phrased);
    expect(count(b.assistant_text, line.chance)).toBe(1);
    expect(face).toContain(line.chance);
  });

  it('B19 r1 CONTROL: a canonical chance already carrying spread and shortfall keeps both notes on the face once', async () => {
    const line = shortfallScreenLine();
    const reply = `Analysis is ready. Review the evidence. Check the assumptions. ${line.chance} Keep unresolved disagreements visible in the model for the team’s next review and keep the conversation grounded in evidence.`;
    expect(withScreenLinesOwed(reply, [line]), 'the positive control: the complete unit is already present').toEqual({ text: reply, added: 0 });
    const b = await turn(run(reply), 'Run it');
    expect(callModelOutputs, 'the control: the scripted canonical chance was consumed').toEqual([]);
    expect(b._answer_shape).toBeDefined();
    const face = [b._answer_shape!.headline, ...b._answer_shape!.bullets].join(' ');
    expect(face).toContain(line.chance);
    for (const note of [line.spread_note!, line.shortfall_note!]) {
      expect(count(b.assistant_text, note), b.assistant_text).toBe(1);
      expect(b._answer_shape!.detail).not.toContain(note);
    }
  });

  it('CONTROL: a turn that ran nothing adds nothing', async () => {
    const b = await turn([say('Happy to help with the next step.')], 'Thanks');
    expect(b._agent.tool_calls.map((c) => c.name)).not.toContain('run_analysis');
    expect(b.assistant_text).not.toContain('between about');
  });
});
