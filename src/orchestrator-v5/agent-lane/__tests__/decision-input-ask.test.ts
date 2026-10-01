/**
 * ⭐ D1 + A7 (DL #75 5923918068; lease 5923944336; AIQ words 5923963470): on the brief and Run turns, at rest — A7 a TRUE line
 * (the deadline is held but nothing answers it), then D1 ONE ask (the least the goal must reach) while no target is stated.
 * Goal nodes are R3's served `train-0258Z` (`eea49f5b`): after the build (no target) and after Paul's "at least £1,000,000".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { decisionInputAsk, decisionInputLines, goalHasStatedTarget, textAtRest } from '../decision-input-ask.js';
import { narrateWriteOutcome, openQuestionsForReply, withWriteOutcome } from '../write-outcome.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/served-goal-target-train-0258Z.json', import.meta.url), 'utf8')) as { goal_after_build: Rec; goal_after_target: Rec };
const graphWith = (goal: Rec) => ({ nodes: [goal, { id: 'opt_a', kind: 'option', label: 'Angel pilot' }], edges: [] });
const ASK = 'What is the least that "Funding secured" must reach within 2 months? I\'ll propose it as your target.';
const A7 = 'This model doesn\'t yet say whether any option gets there within 2 months.';
const base = { restingText: 'The model is a sketch to challenge.', questionsToggle: false, awaitingApproval: false, builtOrRan: true };

describe('the lines, on the served goal', () => {
  it('RED: after the build (no stated target, a 2-month horizon, no duration limit) → the A7 line, then the one ask', () => {
    expect(goalHasStatedTarget(FX.goal_after_build)).toBe(false);
    expect(decisionInputLines(graphWith(FX.goal_after_build), base)).toEqual([A7, ASK]);
    expect(decisionInputAsk(graphWith(FX.goal_after_build), base)).toBe(ASK);
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
    expect(decisionInputLines(graphWith(noHorizon), base)).toEqual(['What is the least that "Funding secured" must reach? I\'ll propose it as your target.']);
    expect(decisionInputAsk(graphWith({ ...FX.goal_after_build, goal_horizon_months: 1 }), base)).toContain('within 1 month?');
    expect(decisionInputLines({ nodes: [], edges: [] }, base)).toEqual([]);
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

// ── The route: a Run button turn on the served no-target goal, model stubbed (0 LLM) ──
// In memory, so a named turn's claim reads back and its answer row is what a replay returns.
const rows = new Map<string, Rec>();
const store = {
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
      analysis_state: { run_state: { kind: 'complete_current' }, usable_for_chips: true },
    }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [{ type: 'analysis_result', data: {} }], analysis_ready: { status: 'ready', may_run: true } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { goal = FX.goal_after_build; modelSays = 'This run is a sketch, not a basis for choosing.'; n += 1; });
  const runTurn = async (turnId?: string) => (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    ...(turnId !== undefined ? { turn_id: turnId } : {}), kind: 'message', scenario_id: `7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c${String(n).padStart(2, '0')}`, message: 'Run analysis.', source: 'chip',
    chip: { id: 'agent-run-analysis', action_type: 'run_analysis' },
  } })).json() as { assistant_text: string };

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

  it('CONTROL: the same Run turn after the target was stated → no ask (the deadline line stays)', async () => {
    goal = FX.goal_after_target;
    const text = (await runTurn()).assistant_text;
    expect(text).not.toContain('as your target');
    expect(text).toContain(A7);
  });

  it('CONTROL: the model asked its own question → the host adds no ask (one "?" in the turn)', async () => {
    modelSays = 'Which option matters most to you?';
    const text = (await runTurn()).assistant_text;
    expect(text).not.toContain('as your target');
    expect(text.match(/\?/g) ?? []).toHaveLength(1);
  });
});
