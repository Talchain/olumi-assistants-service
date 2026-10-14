/** HARNESS item 1: the offered tool alone did not fire on the founder replies. Force the real door from a delivered ask. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CURRENT_LEVEL_TOOL, currentLevelAnswerFirstCall, currentLevelAskOnAnswer, latestCurrentLevelAsk } from '../current-level-answer.js';
import { placeholderAskWords } from '../goal-certainty.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import { deriveAnswerTextFromShape } from '../../routing/answer-shape.js';
import { sentencesOf } from '../reply/compose-reply.js';

const SCENARIO = '689f4bb9-0000-4000-8000-000000000001';
const GOAL = 'productivity';
const SIZES = 'We can fit 4 large, 8 medium, 16 small, roughly';
const UNIT = 'small-update equivalents per sprint';
const graph = (JSON.parse(readFileSync(new URL('./fixtures/founder-58bd5e71-stored-graph-20261006.json', import.meta.url), 'utf8')) as {
  graph: { nodes: Record<string, unknown>[]; edges: { from: string; to: string }[] };
}).graph;
const asked = placeholderAskWords(graph, graph.edges.filter((e) => e.to === GOAL))!;
const question = asked.first?.kind === 'goal_level' ? asked.first.question! : '';
const warning = { code: 'GOAL_FIGURES_PLACEHOLDER_PATH', message: asked.message, first_ask: asked.first };
const analysisResult = { type: 'analysis_result', computed_against_hash: 'h0', enrichment: { inference_warnings: [warning] } };
const state = { ok: true, entities: [{ id: GOAL, kind: 'goal', label: GOAL }], goal: { id: GOAL, target: { unit: '%', frame: 'change_rel' } } };
const now = () => new Date().toISOString();
const initialAsk = (): PendingAction => currentLevelAskOnAnswer({
  graph, analysisResult, sentText: question, scenarioId: SCENARIO, userId: null, emittedAtIso: now(),
  prior: null, answered: false, message: 'Run analysis.', awaitingApproval: false,
})!;
const roundTrip = (p: PendingAction): PendingAction => parsePendingAction(JSON.parse(JSON.stringify(p)))!;
const clarification = (p: PendingAction, message: string, sentText: string): PendingAction => currentLevelAskOnAnswer({
  graph, analysisResult, sentText, scenarioId: SCENARIO, userId: null, emittedAtIso: now(),
  prior: latestCurrentLevelAsk([roundTrip(p)], SCENARIO, null), answered: true, message, awaitingApproval: false,
})!;
const CHOICE = 'Do you mean a mix of sizes in one sprint, or equivalent capacity of 4 large, 8 medium or 16 small?';
const RESTATED = 'I read productivity as 16 small-update equivalents per sprint. Is that correct?';

let pending: PendingAction[] = [];
let priorUser = SIZES;
let priorAssistant = question;
const appends: Record<string, unknown>[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  readRecent: vi.fn(async () => [{ scenario_id: SCENARIO, turn_id: 'prior-answer', request_hash: 'agent_turn:prior',
    user_message: priorUser, assistant_message: priorAssistant, created_at: now() }]),
  readMostRecentPendingActions: vi.fn(async () => pending.map(roundTrip)),
  append: vi.fn(async (w: Record<string, unknown>) => { appends.push(w); return { id: 'answer-row' }; }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('producer, JSONB read and answer gate', () => {
  it('RED at base: the delivered producer question arms a typed pending, which round-trips through the real parser', () => {
    expect(question).toContain('today’s level');
    const p = roundTrip(initialAsk());
    expect(p.action).toMatchObject({ kind: 'elicit_goal_current_level', goal_id: GOAL, goal_label: GOAL, user_id: null, question });
    expect(p.action).not.toHaveProperty('goal_unit'); // +10% is the target's change, not the metric's unit.
  });
  it('a hidden/scrubbed question, or a held approval, arms nothing', () => {
    const input = { graph, analysisResult, sentText: 'The goal is not yet measured.', scenarioId: SCENARIO, userId: null,
      emittedAtIso: now(), prior: null, answered: false, message: '', awaitingApproval: false };
    expect(currentLevelAskOnAnswer(input)).toBeNull();
    expect(currentLevelAskOnAnswer({ ...input, sentText: question, awaitingApproval: true })).toBeNull();
  });
  it('the contract relocates each exact typed ask sentence while preserving its answer licence', () => {
    const [context, ask] = sentencesOf(question);
    expect(context).toContain('today’s level');
    expect(ask).toBe('What is it, in %?');
    const input = { graph, analysisResult, scenarioId: SCENARIO, userId: null, emittedAtIso: now(),
      prior: null, answered: false, message: '', awaitingApproval: false };
    const sentText = deriveAnswerTextFromShape({ headline: context!,
      bullets: ["Olumi's estimates: 3, see Check estimates.", ask!], detail: '' });
    expect(sentText).not.toContain(question);
    const pending = currentLevelAskOnAnswer({ ...input, sentText });
    expect(pending?.action).toMatchObject({ kind: 'elicit_goal_current_level', goal_id: GOAL, goal_label: GOAL, question });
    expect(currentLevelAskOnAnswer({ ...input, sentText: `${ask}\n\n${context}` })?.action).toMatchObject({ goal_id: GOAL, question });
    expect(currentLevelAskOnAnswer({ ...input, sentText: sentText.replace(/[‘’]/g, "'") })?.action).toMatchObject({ goal_id: GOAL, question });
    // Missing, altered or negated context cannot license the otherwise generic question.
    for (const refused of [context!, ask!, `Not ${context}\n\n${ask}`,
      `${context!.replace('today’s', 'tomorrow’s')}\n\n${ask}`]) {
      expect(currentLevelAskOnAnswer({ ...input, sentText: refused })).toBeNull();
    }
  });
  it('RED at base: both clarification carriers keep only user figures, and preserve the original expiry', () => {
    const p = initialAsk();
    const choice = clarification(p, SIZES, CHOICE);
    expect(choice.action).toMatchObject({ figures: ['4 large', '8 medium', '16 small'], confirmation: 'choice' });
    const restated = clarification(choice, 'The latter.', RESTATED);
    expect(restated.action).toMatchObject({ figures: ['4 large', '8 medium', '16 small'], confirmation: 'figure' });
    expect(restated.expires_at_iso).toBe(p.expires_at_iso);
    expect(currentLevelAnswerFirstCall(state, latestCurrentLevelAsk([restated], SCENARIO, null), 'Yes, how do they affect this decision?', false)).toBe(CURRENT_LEVEL_TOOL);
  });
  it('no older ask, expired ask, different subject, missing goal, or competing path claims the answer', () => {
    const p = initialAsk();
    expect(latestCurrentLevelAsk([], SCENARIO, null)).toBeNull();
    expect(latestCurrentLevelAsk([p], SCENARIO, 'another-user')).toBeNull();
    expect(latestCurrentLevelAsk([p], 'another-scenario', null)).toBeNull();
    expect(latestCurrentLevelAsk([{ ...p, expires_at_iso: '2000-01-01T00:00:00Z' }], SCENARIO, null)).toBeNull();
    const a = latestCurrentLevelAsk([p], SCENARIO, null);
    expect(currentLevelAnswerFirstCall({ ok: true, entities: [] }, a, SIZES, false)).toBeUndefined();
    expect(currentLevelAnswerFirstCall(state, a, SIZES, true)).toBeUndefined();
    expect(currentLevelAnswerFirstCall(state, a, 'The latter.', false)).toBeUndefined();
    expect(currentLevelAnswerFirstCall(state, a, 'Yes, how do they affect this decision?', false)).toBeUndefined();
  });
  it('corrupt confirmation without a user figure cannot be read', () => {
    const p = initialAsk();
    expect(parsePendingAction({ ...p, action: { ...p.action, confirmation: 'figure' } })).toBeNull();
    expect(parsePendingAction({ ...p, action: { ...p.action, confirmation: 'figure', figures: ['16 small'], figure_quote: '4 large' } })).toBeNull();
  });
  it('a stated figure in another existing quantity’s unit falls through, including a capacity-shaped sentence', () => {
    const s = { ...state, entities: [...state.entities, { id: 'team', kind: 'factor', label: 'Team size', unit: 'developers' }] };
    const a = latestCurrentLevelAsk([initialAsk()], SCENARIO, null);
    expect(currentLevelAnswerFirstCall(s, a, 'We can fit 6 developers into the team.', false)).toBeUndefined();
  });
  it('F1: an unmodelled office capacity cannot answer the Productivity ask with no native unit', () => {
    const a = latestCurrentLevelAsk([initialAsk()], SCENARIO, null);
    expect(currentLevelAnswerFirstCall(state, a, 'We can fit 6 people in the office.', false)).toBeUndefined();
  });
  it('F1 CONTROL: a capacity answer names Productivity or repeats the same ask’s typed clarification reading', () => {
    const a = latestCurrentLevelAsk([initialAsk()], SCENARIO, null);
    expect(currentLevelAnswerFirstCall(state, a, `Productivity: ${SIZES}`, false)).toBe(CURRENT_LEVEL_TOOL);
    expect(currentLevelAnswerFirstCall(state, a, SIZES, false)).toBeUndefined();
    const clarified = latestCurrentLevelAsk([clarification(initialAsk(), SIZES, CHOICE)], SCENARIO, null);
    expect(currentLevelAnswerFirstCall(state, clarified, SIZES, false)).toBe(CURRENT_LEVEL_TOOL);
    expect(currentLevelAnswerFirstCall(state, clarified, 'We can fit 6 people in the office.', false)).toBeUndefined();
  });
  it.each([
    'We can deliver 16 updates per sprint, probably.',
    'We can deliver 16 updates per sprint if we hire someone.',
    'Productivity: we can deliver 16 updates per sprint, probably.',
    'Productivity: we can deliver 16 updates per sprint if we hire someone.',
  ])('F2: "%s" is not an asserted current level', (message) => {
    const a = latestCurrentLevelAsk([initialAsk()], SCENARIO, null);
    expect(currentLevelAnswerFirstCall(state, a, message, false)).toBeUndefined();
  });
  it('a restated estimate or an unrelated question does not retain an answer licence', () => {
    expect(clarification(initialAsk(), SIZES, 'I estimate 20 updates per sprint. Is that correct?')).toBeNull();
    expect(clarification(initialAsk(), SIZES, '16 small updates. What is your budget?')).toBeNull();
  });
});

describe('the real Agent route and level door', () => {
  let app: FastifyInstance;
  const choices: unknown[] = [];
  let calls = 0;
  let direct = false;
  let levelArgs = { goal_label: GOAL, value: 16, unit: UNIT, user_stated: true };
  let naturalReply = 'Those figures are noted.';
  beforeAll(async () => {
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: globalThis.RequestInit) => {
      const req = JSON.parse(String(init.body)) as { tool_choice?: { name: string } };
      choices.push(req.tool_choice);
      const call = req.tool_choice?.name === CURRENT_LEVEL_TOOL || (direct && calls === 0);
      calls += 1;
      return new Response(JSON.stringify({ output: call ? [{ type: 'function_call', call_id: 'level-answer', name: CURRENT_LEVEL_TOOL,
        arguments: JSON.stringify(levelArgs) }]
        : [{ type: 'message', content: [{ type: 'output_text', text: naturalReply }] }] }), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: 'h0', analysis_result: analysisResult,
      analysis_state: { run_state: { kind: 'complete_current', computed_at: now() }, leader_claim: { permitted: false } } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { pending = [initialAsk()]; priorUser = SIZES; priorAssistant = question; choices.length = 0; appends.length = 0; calls = 0; direct = false; levelArgs = { goal_label: GOAL, value: 16, unit: UNIT, user_stated: true }; naturalReply = 'Those figures are noted.'; });
  const turn = (message: string) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, agent_session_id: `level-answer-${randomUUID()}`, message,
  } });

  it.each([
    [`Productivity: ${SIZES}`, 'initial'],
    [SIZES, 'choice'],
    ['The latter.', 'choice'],
    ['Yes, how do they affect this decision?', 'figure'],
  ])('RED at base: "%s" forces and calls the level door, whose real result offers a card', async (message, phase) => {
    if (phase !== 'initial') pending = [clarification(initialAsk(), SIZES, CHOICE)];
    if (phase === 'figure') pending = [clarification(pending[0]!, 'The latter.', RESTATED)];
    priorAssistant = phase === 'initial' ? question : phase === 'choice' ? CHOICE : RESTATED;
    const res = await turn(message);
    expect(res.statusCode, res.body).toBe(200);
    expect(choices[0]).toEqual({ type: 'function', name: CURRENT_LEVEL_TOOL });
    const b = res.json();
    expect(b._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL }));
    // The card's description is the model's narration of the door's result (served: Acceptance C1b); the mock's
    // narration is fixed, so the row binds to the prepared level card itself: its approve chip and label.
    expect(b.suggested_actions).toContainEqual(expect.objectContaining({ label: 'Record this current level' }));
    expect(b.suggested_actions).toContainEqual(expect.objectContaining({ id: expect.stringContaining('agent-approve-proposal:') }));
    expect(appends.some((w) => w.graph !== undefined)).toBe(false); // preparation is not authorisation.
  });

  it('CONTROL: the direct sentence still reaches the existing door without a pending ask', async () => {
    pending = []; direct = true;
    const res = await turn('We fit 16 small-update equivalents per sprint.');
    expect(res.statusCode, res.body).toBe(200);
    expect(choices[0]).toBeUndefined();
    expect(res.json()._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL }));
  });

  it.each([
    ['Our budget is £200,000.', 200000, 'GBP'],
    ['Would 16 small updates per sprint be enough?', 16, UNIT],
    ["I don't know; not sure.", 16, UNIT],
    ['Productivity is 16% today.', 16, '%'],
    ['We can fit 6 people in the office.', 6, 'people'],
    ['We can deliver 16 updates per sprint, probably.', 16, 'updates per sprint'],
    ['We can deliver 16 updates per sprint if we hire someone.', 16, 'updates per sprint'],
    ['Productivity: we can deliver 16 updates per sprint, probably.', 16, 'updates per sprint'],
    ['Productivity: we can deliver 16 updates per sprint if we hire someone.', 16, 'updates per sprint'],
    [SIZES, 16, UNIT],
  ] as const)('F3 MUST NOT CAPTURE: "%s" is not forced to the level door (a forced call WOULD prepare a card here)', async (message, value, unit) => {
    // The mock calls the level tool whenever the host forces it, with this row's figure, so a wrongly forced call
    // produces a real prepared card and fails the card assertions below. The model's own unforced judgement is left
    // to the door + the user's approval (DL ruling on #2681: no host refusal of model-selected level calls).
    direct = false;
    levelArgs = { goal_label: GOAL, value, unit, user_stated: true };
    const res = await turn(message);
    expect(res.statusCode, res.body).toBe(200);
    expect(choices[0]).toBeUndefined();
    const b = res.json();
    expect(b._agent?.tool_calls ?? []).not.toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL }));
    expect(b.suggested_actions ?? []).not.toContainEqual(expect.objectContaining({ label: 'Record this current level' }));
    expect(appends.some((w) => w.graph !== undefined)).toBe(false);
  });

  it('RED at base: the final delivered producer question is persisted atomically with the Agent answer', async () => {
    pending = []; naturalReply = question;
    const res = await turn('What is missing?');
    expect(res.statusCode, res.body).toBe(200);
    const answer = appends.find((w) => w.assistantMessage !== undefined);
    const p = (answer?.pending_actions as PendingAction[] | undefined)?.find((p) => p.action.kind === 'elicit_goal_current_level');
    expect(p).toBeDefined();
    expect(roundTrip(p!).action).toMatchObject({ goal_id: GOAL, question });
  });
});
