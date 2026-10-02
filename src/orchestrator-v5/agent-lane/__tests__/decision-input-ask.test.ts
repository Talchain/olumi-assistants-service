import { explainRun } from './fixtures/run-explanation-follow-up.js';
/**
 * ⭐ D1 + A7 (DL #75 5923918068; lease 5923944336; AIQ words 5923963470): on the brief and Run turns, at rest — A7 a TRUE line
 * (the deadline is held but nothing answers it), then D1 ONE ask (the least the goal must reach) while no target is stated.
 * Goal nodes are R3's served `train-0258Z` (`eea49f5b`): after the build (no target) and after Paul's "at least £1,000,000".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { decisionInputAsk, decisionInputLines, goalHasStatedTarget, textAtRest, withA7AfterGate } from '../decision-input-ask.js';
import { narrateWriteOutcome, openQuestionsForReply, withWriteOutcome } from '../write-outcome.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/served-goal-target-train-0258Z.json', import.meta.url), 'utf8')) as { goal_after_build: Rec; goal_after_target: Rec };
const graphWith = (goal: Rec) => ({ nodes: [goal, { id: 'opt_a', kind: 'option', label: 'Angel pilot' }], edges: [] });
// "Funding secured" reads no direction (`deriveGoalIntent` undetermined, no minimise), so the neutral words (AIQ 5924149215).
const ASK = 'What figure should "Funding secured" reach or stay under within 2 months? I\'ll propose it as your target.';
const A7 = 'This model doesn\'t yet say whether any option gets there within 2 months.';
const base = { restingText: 'The model is a sketch to challenge.', questionsToggle: false, awaitingApproval: false, builtOrRan: true };

describe('the lines, on the served goal', () => {
  it('RED: after the build (no stated target, a 2-month horizon, no duration limit) → the A7 line, then the one ask', () => {
    expect(goalHasStatedTarget(FX.goal_after_build)).toBe(false);
    expect(decisionInputLines(graphWith(FX.goal_after_build), base)).toEqual([A7, ASK]);
    expect(decisionInputAsk(graphWith(FX.goal_after_build), base)).toBe(ASK);
  });

  it('RED (PANEL 5944136475): the ask already in a recent answer is still OPEN → not said again; A7 stays', () => {
    const earlier = `Your results are ready. You can view them now or ask me to explain them. ${ASK}`;
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, recentReplies: ['Unrelated.', earlier] })).toEqual([A7]);
  });

  it('CONTROL: no recent answer carries THIS ask (none read, or another goal\'s ask) → the ask is said, as before', () => {
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, recentReplies: [] })).toEqual([A7, ASK]);
    const other = ASK.replace('Funding secured', 'Monthly spend');
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, recentReplies: [other] })).toEqual([A7, ASK]);
  });

  it('CONTROL: once Paul stated "at least £1,000,000" → no ask; the deadline line stays (still not answered)', () => {
    expect(goalHasStatedTarget(FX.goal_after_target)).toBe(true);
    expect(decisionInputLines(graphWith(FX.goal_after_target), base)).toEqual([A7]);
  });

  it('CONTROL: a duration limit the analysis scores → no A7 line (the deadline is answered)', () => {
    const g = { ...graphWith(FX.goal_after_build), goal_constraints: [{ constraint_id: 'k1', unit: 'months', operator: '<=', value: 2 }] };
    expect(decisionInputLines(g, base)).toEqual([ASK]);
  });

  it.each([
    ['the model already asked (≤1 ask per turn)', { restingText: 'What minimum would count as success?' }],
    ['a proposal awaits its yes (that card is the step)', { awaitingApproval: true }],
    ['a turn that neither built nor ran (an answer turn)', { builtOrRan: false }],
  ])('CONTROL: %s → no ask', (_l, over) => {
    expect(decisionInputAsk(graphWith(FX.goal_after_build), { ...base, ...over })).toBeNull();
  });

  it('A7 asks nothing, so it holds beside the model\'s own question or a pending proposal — never on an answer turn', () => {
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, restingText: 'Which matters most?' })).toEqual([A7]);
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, awaitingApproval: true })).toEqual([A7]);
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, builtOrRan: false })).toEqual([]);
  });

  it('no horizon → no A7 line and the ask drops "within…"; one month is singular; no goal → nothing', () => {
    const { goal_horizon_months: _h, ...noHorizon } = FX.goal_after_build;
    expect(decisionInputLines(graphWith(noHorizon), base)).toEqual(['What figure should "Funding secured" reach or stay under? I\'ll propose it as your target.']);
    expect(decisionInputAsk(graphWith({ ...FX.goal_after_build, goal_horizon_months: 1 }), base)).toContain('within 1 month?');
    expect(decisionInputLines({ nodes: [], edges: [] }, base)).toEqual([]);
  });
});

describe('the ask follows the goal\'s direction — never a floor on a cost goal (AIQ CR 5924149215)', () => {
  const askFor = (label: string) => decisionInputAsk(graphWith({ ...FX.goal_after_build, label }), base);
  it('RED: a cost goal ("Reduce monthly costs", minimised) is asked for the MOST it can be, never the least', () => {
    expect(askFor('Reduce monthly costs')).toBe('What is the most that "Reduce monthly costs" can be within 2 months? I\'ll propose it as your target.');
    expect(askFor('Lower churn')).toContain('What is the most that "Lower churn" can be');
  });
  it('an increase goal ("Increase MRR") is asked for the least it must reach', () => {
    expect(askFor('Increase MRR')).toBe('What is the least that "Increase MRR" must reach within 2 months? I\'ll propose it as your target.');
  });
  it('no direction ("Monthly spend", "MRR", the served "Funding secured") → the neutral words', () => {
    for (const label of ['Monthly spend', 'MRR', 'Funding secured']) {
      expect(askFor(label)).toBe(`What figure should "${label}" reach or stay under within 2 months? I'll propose it as your target.`);
    }
  });
});

describe('what counts as a stated target (CODEX 5923981385)', () => {
  it('the served goal already carries the normalising frame (`scale_frame`, `goal_threshold_frame`) — a frame is not a target', () => {
    expect(FX.goal_after_build.scale_frame).toBe(5000000);
    expect(FX.goal_after_build.goal_threshold_frame).toBe('level');
    expect(decisionInputAsk(graphWith(FX.goal_after_build), base)).toBe(ASK);
  });
  it('an explicit target of 0 is stated → no ask; a baseline of 0 is not a target → the ask stays', () => {
    expect(decisionInputAsk(graphWith({ ...FX.goal_after_build, goal_threshold_raw: 0 }), base)).toBeNull();
    expect(decisionInputAsk(graphWith({ ...FX.goal_after_build, observed_state: { baseline: 0 } }), base)).toBe(ASK);
  });
  it('two goal nodes, or a goal with no label → nothing is minted', () => {
    expect(decisionInputLines({ nodes: [FX.goal_after_build, { ...FX.goal_after_build, id: 'g2' }], edges: [] }, base)).toEqual([]);
    expect(decisionInputLines(graphWith({ ...FX.goal_after_build, label: ' ' }), base)).toEqual([]);
  });
});

describe('≤1 ask on the FINAL composed reply at rest — the host\'s own asks count (CODEX 5923981385 collision pair)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `Science question ${i + 1}?`);
  const restingOf = (n: number) => {
    const r = { ok: true, mutated: true, open_questions: many(n), treated_as_context: ['Recruitment fee'] };
    const status = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [r as never]).status!;
    return { status, resting: textAtRest(withWriteOutcome('The model is a sketch to challenge.', status)) };
  };

  it('RED: 40 build questions + a held-fixed factor → #2420 asks AT REST ("Should one of the options change it?") → no goal ask; A7 stays', () => {
    const { resting } = restingOf(40);
    expect(resting).toContain('Should one of the options change it?');
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, restingText: resting })).toEqual([A7]);
  });

  it('CONTROL: 39 build questions → that ask is behind the toggle, nothing asks at rest → the goal ask is said', () => {
    const { resting } = restingOf(39);
    expect(resting).not.toMatch(/\?/);
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, restingText: resting })).toEqual([A7, ASK]);
  });

  it('the levels ask at rest ("One level is not set yet: …?") also counts → no goal ask', () => {
    const resting = textAtRest(withWriteOutcome('The model is a sketch.', 'The model was saved. One level is not set yet: what does "Angel pilot" set Hours to?'));
    expect(decisionInputAsk(graphWith(FX.goal_after_build), { ...base, restingText: resting })).toBeNull();
  });

  it('the questions behind the toggle are NOT an ask at rest, and every one of the 40 is still in the text', () => {
    const { status, resting } = restingOf(39);
    const text = withWriteOutcome(`The model is a sketch.\n\n${A7}\n\n${ASK}`, status);
    expect(text.endsWith(status), 'the status — and the toggle list it heads — is untouched').toBe(true);
    const r = { ok: true, mutated: true, open_questions: many(39), treated_as_context: ['Recruitment fee'] };
    expect(openQuestionsForReply(r as never), 'the wire list the toggle renders: all 39 + the context ask').toHaveLength(40);
    expect(textAtRest(text).match(/\?/g)).toHaveLength(1);
    expect(resting).not.toContain('Science question');
  });

  it('the route judges the ask on the composed reply at rest — model words + owed lines + host status (source pin)', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(src).toContain('const composedWithout = withWriteOutcome(withDisclosures(narration.text, owed), statusText);');
    expect(src).toContain('restingText: textAtRest(composedWithout),');
    expect(src).toContain('...decisionTurn,');
    expect(src).toContain('questionsToggle: textAtRest(composedWithout) !== composedWithout,');
    expect(src).toContain('withWriteOutcome(withDisclosures(narration.text, [...owed, ...decisionLines]), statusText)');
  });

  it('textAtRest is the panel\'s own split: the same marker and producer-sentence predicate as the pinned DGAI copy', () => {
    const lit = (src: string, name: string) => src.slice(src.indexOf(`const ${name}`)).split(';')[0].replace(/\s+/g, ' ');
    const mine = readFileSync(new URL('../decision-input-ask.ts', import.meta.url), 'utf8');
    const dgai = readFileSync(new URL('./host-tail-at-rest.test.ts', import.meta.url), 'utf8');
    expect(lit(mine, 'PRODUCER_SENTENCE')).toBe(lit(dgai, 'PRODUCER_SENTENCE'));
    expect(lit(mine, 'AFTER_THE_QUESTIONS')).toBe(lit(dgai, 'AFTER_THE_QUESTIONS'));
    expect(lit(mine, 'NO_QUESTION_FIRST')).toBe(lit(dgai, 'NO_QUESTION_FIRST'));
    expect(mine).toContain("const QUESTIONS_MARKER = 'Questions this model does not answer yet:';");
    expect(dgai).toContain("const SERVER_OPEN_QUESTIONS_MARKER = 'Questions this model does not answer yet:';");
  });
});

describe('≤160 words on screen (DL 5923219186 · AIQ 5923963470): over the bound, A7 folds back behind the toggle — never the ask', () => {
  const prose = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const a7w = A7.split(/\s+/).length; const askw = ASK.split(/\s+/).length;
  it('the measured line sizes: A7 13 words, the ask 18', () => { expect([a7w, askw]).toEqual([13, 18]); });
  it('RED: at rest + toggle label + both lines = 161 → A7 stays behind the toggle; the ask is said', () => {
    const resting = prose(160 - 7 - a7w - askw + 1);
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, restingText: resting, questionsToggle: true })).toEqual([ASK]);
  });
  it('CONTROL: exactly 160 → both lines', () => {
    const resting = prose(160 - 7 - a7w - askw);
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, restingText: resting, questionsToggle: true })).toEqual([A7, ASK]);
  });
  it('CONTROL: over the bound with NO toggle (a Run turn: nowhere to fold it) → A7 is still said', () => {
    expect(decisionInputLines(graphWith(FX.goal_after_build), { ...base, restingText: prose(200), questionsToggle: false })).toEqual([A7, ASK]);
  });
  it('over the bound with the target stated → A7 alone still folds (nothing at rest from these lines)', () => {
    expect(decisionInputLines(graphWith(FX.goal_after_target), { ...base, restingText: prose(150), questionsToggle: true })).toEqual([]);
  });
});

describe('A7 is folded on the reply the user SEES — after the leader gate (R3 #75 5924618869; served 5ab41dda 5924604707)', () => {
  const SV = JSON.parse(readFileSync(new URL('./fixtures/served-a7-folded-5ab41dda.json', import.meta.url), 'utf8')) as {
    served_assistant_text: string; status_text: string; goal: Rec;
  };
  const g = { nodes: [SV.goal], edges: [] };
  const turnCtx = { awaitingApproval: false, builtOrRan: true };
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

  it('the served precondition: 116 words at rest after the gate, A7 owed (2-month horizon, no limit) and absent', () => {
    expect(words(textAtRest(SV.served_assistant_text))).toBe(116);
    expect(SV.served_assistant_text).not.toContain(A7);
    expect(SV.goal.goal_horizon_months).toBe(2);
  });

  it('RED (served): A7 returns once, at rest, before the status line — and nothing else moves', () => {
    const out = withA7AfterGate(SV.served_assistant_text, g, turnCtx, SV.status_text);
    expect(out.split(A7).length - 1).toBe(1);
    expect(textAtRest(out)).toContain(A7);
    expect(out.indexOf(A7)).toBeLessThan(out.indexOf('The model was saved.'));
    expect(out.replace(`\n\n${A7}`, '')).toBe(SV.served_assistant_text);
    expect(words(textAtRest(out)) + 8).toBeLessThanOrEqual(160);
  });

  it('CONTROL: still over the bound after the gate → unchanged (A7 stays behind the toggle)', () => {
    const long = `${'word '.repeat(40)}${SV.served_assistant_text}`;
    expect(withA7AfterGate(long, g, turnCtx, SV.status_text)).toBe(long);
  });

  it('CONTROL: A7 already said, no horizon, a duration limit, or a turn that neither built nor ran → unchanged', () => {
    const said = SV.served_assistant_text.replace('\n\nThe model was saved.', `\n\n${A7}\n\nThe model was saved.`);
    expect(withA7AfterGate(said, g, turnCtx, SV.status_text)).toBe(said);
    const { goal_horizon_months: _h, ...noHorizon } = SV.goal;
    expect(withA7AfterGate(SV.served_assistant_text, { nodes: [noHorizon], edges: [] }, turnCtx, SV.status_text)).toBe(SV.served_assistant_text);
    const limited = { ...g, goal_constraints: [{ unit: 'months', operator: '<=', value: 2 }] };
    expect(withA7AfterGate(SV.served_assistant_text, limited, turnCtx, SV.status_text)).toBe(SV.served_assistant_text);
    expect(withA7AfterGate(SV.served_assistant_text, g, { ...turnCtx, builtOrRan: false }, SV.status_text)).toBe(SV.served_assistant_text);
  });

  it('the ask was said → A7 goes right before it (where it was composed); no status found and no ask → unchanged', () => {
    const t = `Model words.\n\n${ASK}\n\nThe model was saved.`;
    expect(withA7AfterGate(t, g, turnCtx, 'The model was saved.')).toBe(`Model words.\n\n${A7}\n\n${ASK}\n\nThe model was saved.`);
    expect(withA7AfterGate('Model words.', g, turnCtx, 'The model was saved.')).toBe('Model words.');
  });

  it('route source pin: AFTER the leader gate and every later prose rewrite (break-even), BEFORE the shape and the answer row', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const call = src.indexOf('withA7AfterGate(wireBody.assistant_text, readbackGraph, decisionTurn, statusText)');
    expect(call).toBeGreaterThan(src.indexOf('enforceAgentLaneLeaderClaimsAtWire(wireBody'));
    expect(call).toBeGreaterThan(src.indexOf('withBreakEvenAnswer(wireBody.assistant_text'));
    expect(call).toBeLessThan(src.indexOf('wireBody = withAnalysisAnswerShape(wireBody'));
    expect(call).toBeLessThan(src.indexOf('assistantMessage: String(wireBody.assistant_text'));
    // The ONLY assistant_text rewrites after it are the shape (built from this prose) — none appends prose.
    const after = src.slice(call, src.indexOf('assistantMessage: String(wireBody.assistant_text'));
    expect(after.match(/assistant_text: with(?!A7)/g) ?? []).toEqual([]);
  });
});

// ── The route: a Run button turn on the served no-target goal, model stubbed (0 LLM) ──
// In memory, so a named turn's claim reads back and its answer row is what a replay returns.
const rows = new Map<string, Rec>();
let recentFails = false;
const store = {
  // The durable answers, newest first, as `readRecent` returns them (claims excluded); a switch makes the read fail.
  // …and only the newest `limit` rows, as the store's own LIMIT does: a mock that returned every row hid the window (MG).
  readRecent: vi.fn(async (sid: string, limit: number) => {
    if (recentFails) throw new Error('read failed');
    return [...rows.values()].filter((r) => r.scenario_id === sid && !String(r.turn_id).endsWith(':claim')).reverse().slice(0, limit);
  }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, tid: string) => rows.get(`${sid}|${tid}`) ?? null),
  append: vi.fn(async (w: Rec) => { rows.set(`${String(w.scenario_id)}|${String(w.turn_id)}`, { ...w, assistant_message: w.assistantMessage ?? null }); return { id: `row-${rows.size}` }; }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('on the wire: the Run turn says them at rest, once each', () => {
  let app: FastifyInstance;
  let goal: Rec = FX.goal_after_build;
  let modelSays = 'This run is a sketch, not a basis for choosing.';
  let blocked = false;
  let n = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: modelSays }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: graphWith(goal), graph_hash: 'h0', analysis_ready: { status: 'ready', may_run: true },
      analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' }, usable_for_chips: true },
      analysis_result: blocked ? undefined : { type: 'analysis_result', computed_against_hash: '0123456789abcdef', data: { marker: 'synthetic' } },
    }));
    app.post('/orchestrate/v2/turn', async () => (blocked
      ? { assistant_text: 'Set a level for Hours first.', blocks: [], analysis_ready: { status: 'blocked', may_run: false } }
      : { assistant_text: 'ok', blocks: [{ type: 'analysis_result', data: {} }], analysis_ready: { status: 'ready', may_run: true } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { goal = FX.goal_after_build; modelSays = 'This run is a sketch, not a basis for choosing.'; blocked = false; recentFails = false; n += 1; });
  const scenarioNow = () => `7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c${String(n).padStart(2, '0')}`;
  const runTurn = async (turnId?: string, explain = false) => {
    const scenarioId = scenarioNow();
    const first = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    ...(turnId !== undefined ? { turn_id: turnId } : {}), kind: 'message', scenario_id: scenarioId, message: 'Run analysis.', source: 'chip',
    chip: { id: 'agent-run-analysis', action_type: 'run_analysis' },
  } });
    return (explain ? await explainRun(app, scenarioId, first) : first).json() as { assistant_text: string };
  };

  it('RED: the Run turn on the no-target goal says the A7 line then the ask, once each, before any questions marker', async () => {
    const turnId = '5c0d7e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f';
    const text = (await runTurn(turnId)).assistant_text;
    expect(text.split(ASK).length - 1).toBe(1);
    // A cold replay of the same turn returns the answer row, written AFTER the text was composed: the same words.
    expect((await runTurn(turnId)).assistant_text).toBe(text);
    expect(text.split(A7).length - 1).toBe(1);
    expect(text.indexOf(A7)).toBeLessThan(text.indexOf(ASK));
    const marker = text.indexOf('Questions this model does not answer yet:');
    expect(marker === -1 || text.indexOf(ASK) < marker).toBe(true);
  });

  it('CONTROL: a BLOCKED Run (answered, nothing ran) already names what it needs → neither line', async () => {
    blocked = true;
    const text = (await runTurn()).assistant_text;
    expect(text).not.toContain('as your target');
    expect(text).not.toContain(A7);
  });

  it('CONTROL: the same Run turn after the target was stated → no ask (the deadline line stays)', async () => {
    goal = FX.goal_after_target;
    const text = (await runTurn()).assistant_text;
    expect(text).not.toContain('as your target');
    expect(text).toContain(A7);
  });

  it('CONTROL: the model asked its own question → the host adds no ask (one "?" in the turn)', async () => {
    modelSays = 'Which option matters most to you?';
    const text = (await runTurn(undefined, true)).assistant_text;
    expect(text).not.toContain('as your target');
    expect(text.match(/\?/g) ?? []).toHaveLength(1);
  });

  it('RED (PANEL 5944136475): a Rerun on the same scenario does NOT repeat the open target ask; the A7 fact stays', async () => {
    const first = (await runTurn('6d1e8f20-3b4c-4d5e-8f60-718293a4b5c6')).assistant_text;
    expect(first.split(ASK).length - 1, 'control: the first Run asks').toBe(1);
    const again = (await runTurn('7e2f9031-4c5d-4e6f-8071-8293a4b5c6d7')).assistant_text;
    expect(again).not.toContain('as your target');
    expect(again).toContain(A7);
  });

  it('RED (R3 5944174003, journey-12 shape): the first Run asks, then FOUR more Run + Explain pairs → the ask is said ONCE in all', async () => {
    const first = (await runTurn('c374e586-91a2-43b4-a5c6-d7e8f90a1b23')).assistant_text;
    expect(first.split(ASK).length - 1, 'precondition: the first Run asks').toBe(1);
    const ids = ['d485f697-a2b3-44c5-b6d7-e8f90a1b2c34', 'e596a7b8-b3c4-45d6-87e8-f90a1b2c3d45', 'f6a7b8c9-c4d5-46e7-98f9-0a1b2c3d4e56', '07b8c9d0-d5e6-47f8-a90a-1b2c3d4e5f67'];
    for (const id of ids) await runTurn(id, true);
    // Bound to the durable ANSWER ROWS — what each turn shipped and a replay returns (the Explain reply is not the Run's).
    const sid = [...rows.values()].find((r) => r.turn_id === 'c374e586-91a2-43b4-a5c6-d7e8f90a1b23')?.scenario_id;
    const answers = [...rows.values()].filter((r) => r.scenario_id === sid && !String(r.turn_id).endsWith(':claim'));
    expect(answers.length, 'precondition: 9 answers — beyond a 6-row window').toBe(9);
    const asking = answers.filter((r) => String(r.assistant_message ?? '').includes(ASK)).map((r) => String(r.turn_id));
    expect(asking, 'only the first Run asked').toEqual(['c374e586-91a2-43b4-a5c6-d7e8f90a1b23']);
  });

  it('RED (Codex P2 @4433c99f): a lost Rerun response retried stays ask-free; the first Run retried still asks', async () => {
    const A = '1a2b3c4d-0e1f-4a2b-8c3d-4e5f6a7b8c90', B = '2b3c4d5e-1f2a-4b3c-9d4e-5f6a7b8c9d01';
    expect((await runTurn(A)).assistant_text.split(ASK).length - 1, 'precondition: the first Run asks').toBe(1);
    expect((await runTurn(B)).assistant_text, 'precondition: the Rerun does not').not.toContain('as your target');
    // A replay of a lost Run response is REBUILT from the current readback (never the stored words): it reads the history too.
    expect((await runTurn(B)).assistant_text, 'B retried').not.toContain('as your target');
    // …but never its OWN row: a response the user never received has not said the ask.
    expect((await runTurn(A)).assistant_text.split(ASK).length - 1, 'A retried').toBe(1);
  });

  it('CONTROL (Codex): an in-process sub-turn row holding the ask text (never shown) does not count as said → the Run asks', async () => {
    const sid = scenarioNow();
    rows.set(`${sid}|sub-1`, { scenario_id: sid, turn_id: 'sub-1', request_hash: 'sha256:0f1e2d3c', assistant_message: `Earlier: ${ASK}` });
    expect((await runTurn('3c4d5e6f-2a3b-4c4d-8e5f-6a7b8c9d0e12')).assistant_text.split(ASK).length - 1).toBe(1);
  });

  it('RED (Codex r2): 21 sub-turn rows NEWER than the ask do not push it out of the window — the cap counts AFTER the drop', async () => {
    const first = (await runTurn('4d5e6f70-3b4c-4d5e-9f60-7a8b9c0d1e23')).assistant_text;
    expect(first.split(ASK).length - 1, 'precondition: the first Run asks').toBe(1);
    const sid = scenarioNow();
    for (let i = 0; i < 21; i += 1) rows.set(`${sid}|sub-${i}`, { scenario_id: sid, turn_id: `sub-${i}`, request_hash: `sha256:${i}`, assistant_message: 'handler text' });
    expect((await runTurn('5e6f7081-4c5d-4e6f-8071-8b9c0d1e2f34')).assistant_text, 'the Rerun').not.toContain('as your target');
  });

  it('CONTROL (DL 5944162815): the goal CHANGES between Runs → its new ask is said (an open ask binds to its own goal)', async () => {
    const first = (await runTurn('a152c364-7f80-4192-83a4-b5c6d7e8f901')).assistant_text;
    expect(first.split(ASK).length - 1, 'precondition: the first Run asks').toBe(1);
    goal = { ...FX.goal_after_build, label: 'Monthly spend' };
    const again = (await runTurn('b263d475-8091-42a3-94b5-c6d7e8f90a12')).assistant_text;
    expect(again.split(ASK.replace('Funding secured', 'Monthly spend')).length - 1, 'the changed goal is asked for').toBe(1);
    expect(again).not.toContain(ASK);
  });

  it('CONTROL: the recent answers cannot be read → the Rerun asks again (today\'s behaviour, never a silent drop)', async () => {
    await runTurn('8f30a142-5d6e-4f70-8182-93a4b5c6d7e8');
    recentFails = true;
    const again = (await runTurn('9041b253-6e7f-4081-8293-a4b5c6d7e8f9')).assistant_text;
    expect(again.split(ASK).length - 1).toBe(1);
  });
});
