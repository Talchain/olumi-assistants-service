/**
 * ⭐ EVERY REPLY ON THE AGENT ROUTE ARRIVES IN ONE SHAPE (S-A REPLY SHAPE v1, lane COPY-SHAPE, 7 Oct 2026; Paul: "It was a
 * better length before with the three bullets as a construct"): a headline, at most three bullets, the rest under "More
 * detail" — through the real route, the ONE composer (`agent-lane/reply/compose-reply.ts`) at the end of
 * `routes/agent-v1-turn.ts`. It replaced `withAnalysisAnswerShape` (Run replies only, UI-SEM-090 / #69 5831886008).
 *
 * RE-PINNED ROWS, each against a DL ruling of 7 Oct (lane-copy-shape-DESIGN.md §8), never against the failure mode:
 *   · TYPED RESPONSE PROFILES by turn kind (AIE line review 6037446159 item 5): coaching (≤3 bullets, ≤75 face words),
 *     method_step and proposal (never reshaped: rows 7a, 9 unchanged).
 *   · Must-face on coaching: the ONE ask, the withheld reason, the Explain caveat (#2565, bullet 1) and required evidence
 *     (the basis: B3-8). Receipts and status MAY move to detail (R1: rows 3, 12); every line is still kept exactly once.
 *   · A gate-edited reply (row 2), a reply with no result block (row 4) and a Run beside an earlier proposal's chip
 *     (row 7b) are shaped: the composer runs after every gate, so the "shape describes a stale text" reason is gone.
 *   · R2 a proposal that sets figures ships whole (rows 7a, 9: unchanged).
 *
 * The replies are REAL gpt-5.6-terra Run replies from AI Quality's corpus (the same fixture
 * `agent-turn-withheld-leader-fail-closed.test.ts` drives), and the readback serves that corpus's own
 * served pricing state — withheld (`constraint_verdict_withheld`), or the same state with the claim
 * permitted. The `analysis_result` block the readback carries is a SERVED pricing Run's block (witness
 * c19 on CEE 8428207, `c19-8428207-B` turn t2, also withheld on `constraint_verdict_withheld`); what is
 * under test is that the response CARRIES one, not what it says.
 *
 * The model call is a stubbed `fetch`: no provider is contacted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS,
  deriveAnswerTextFromShape,
  synthesiseAnswerShapeFromText,
  type AnswerShape,
} from '../../routing/answer-shape.js';

import { RUN_RESULT_READY_TEXT } from '../run-explanation.js';
import { goalChanceScreenLinesForAgent } from '../goal-chance-screen-lines.js';
import { sentenceMultiset, sentencesOf } from '../reply/compose-reply.js';
import { textAtRest } from '../decision-input-ask.js';

type Reply = { id: string; label: string; leak_phrases: string[]; text: string };
const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: { leader_claim: Record<string, unknown> } & Record<string, unknown>; analysis_ready: unknown };
  replies: Reply[];
};
const reply = (id: string): Reply => {
  const r = FX.replies.find((x) => x.id === id);
  if (r === undefined) throw new Error(`fixture reply missing: ${id}`);
  return r;
};
const SERVED_RUN = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/c19-8428207-B.run-turns.trimmed.json', import.meta.url), 'utf8')) as {
  turns: { t2: { analysis_result: { type: string; computed_against_hash: string } & Record<string, unknown> } };
};
const RESULT_BLOCK = SERVED_RUN.turns.t2.analysis_result;
const ROBUSTNESS_CAVEAT = 'The result is not yet robust — small changes could flip it.';
let readbackResult = RESULT_BLOCK;
let runRequests = 0;
const GRAPH_HASH = RESULT_BLOCK.computed_against_hash;

const WITHHELD_STATE = { ...FX.state.analysis_state, run_state: { ...(FX.state.analysis_state.run_state as Record<string, unknown>), computed_at: '2026-10-01T12:00:00.000Z' } };
const PERMITTED_STATE = { ...WITHHELD_STATE, leader_claim: { permitted: true, separation: 'separated' } };

/** First sentence, 4 bullets (one ranks, which is lawful on a PERMITTED turn), a closing line — 833 chars. */
const FOUR_BULLETS = reply('stack-1854-714677d5/pricing-run-complete.W.V1.rep1');
/** First sentence, 3 bullets, a closing line; labelled clean (names no leader) — 854 chars. */
const CLEAN_BULLETS = reply('stack-1854-714677d5/pricing-run-complete.W.V2.rep1');
/** Ranks in its FIRST sentence; 3 bullets and a closing line follow. */
const RANKS_FIRST = reply('paired-57f903c/C1.rep1');
const RANKS_FIRST_SENTENCE = 'The £59-at-release path produces the highest MRR outcome in this model, but it does **not** answer whether it keeps churn below 4%.';
/** Ranks in its FIRST BULLET (the reply `agent-turn-withheld-leader-fail-closed.test.ts` drives). */
const RANKS_IN_BULLET = reply('stack-1854-714677d5/pricing-run-complete.W.V1.rep2');
const RANKS_IN_BULLET_SENTENCE =
  'Its unconstrained comparison favours the £59-at-release path, driven by higher MRR per Pro subscriber and the assumed **100%** price–release alignment.';
/** No bullets: one paragraph of two sentences (the first paragraph of a served reply, verbatim). */
const ONE_PARAGRAPH = reply('paired-57f903c/C2.rep3').text.split('\n\n')[0]!;
/** No bullets, four paragraphs — 1,435 chars. */
const PARAGRAPHS_NO_BULLETS = reply('paired-57f903c/M.rep1').text;
/** Three served no-bullet replies back to back: longer than the collapse floor, and not one bullet. */
const LONG_NO_BULLETS = ['paired-57f903c/M.rep1', 'paired-57f903c/M.rep3', 'paired-57f903c/M.rep5'].map((id) => reply(id).text).join('\n\n');

const SCENARIO = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a0f';
let readbackState: unknown = PERMITTED_STATE;
let readbackCarriesResult = true;
// Isolate the unchanged shaping controls with a known-empty bounded census.
// The original capture's goal/risk IDs are retained in the unavailable contrasts below.
function shapeControlReady() {
  const ready = structuredClone(FX.state.analysis_ready) as { analysis_admission: { semantic_signals: Record<string, unknown> } };
  ready.analysis_admission.semantic_signals.material_parameters_awaiting_user_node_ids = [];
  return ready;
}
let readbackReady: unknown = shapeControlReady();
const b3WireCases: { source: string; text: string; line: string; question: string }[] = [];
const BASIS_UNAVAILABLE = 'The sources of this comparison’s factor starting values are unavailable.';
/** The readback's graph: the corpus's served pricing graph, or a variant a row sets (reset before each row). */
let readbackGraph: unknown = FX.state.draft_graph;
/** The durable turn rows, keyed by turn id — the store fake from `agent-turn-withheld-leader-fail-closed.test.ts`. */
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
  blocks?: { type?: string }[];
  _answer_shape?: AnswerShape;
  _diagnostic_trace: { fast_path?: string; leader_claim_enforced?: boolean };
};
/** A line's words without its list marker: the synthesiser re-renders the first three bullets as `• `. */
const unmarked = (line: string) => line.trim().replace(/^[•\-*]\s+/, '');
/** The corpus's leak phrases are recorded with and without hyphens; compare with hyphens as spaces. */
const unhyphen = (s: string) => s.replace(/-/g, ' ');
const faceOf = (s: AnswerShape) => [s.headline, ...s.bullets].join('\n');

describe('an analysis reply on the Agent route arrives headline first (`_answer_shape`)', () => {
  let app: FastifyInstance;
  let noLeaderSentence: string;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    noLeaderSentence = (await import('../withheld-leader-fail-closed.js')).agentNoLeaderSentence('constraint_verdict_withheld', FX.state.analysis_ready);
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    // The Run itself: the product's own turn route, as the `run_analysis` capability dispatches it.
    app.post('/orchestrate/v2/turn', async () => {
      runRequests += 1;
      return {
        response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: GRAPH_HASH, blocks: [readbackResult],
        analysis_ready: readbackReady, analysis_state: readbackState,
      };
    });
    // The final readback — the ONLY source of the response's `analysis_result` block.
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: readbackGraph, graph_hash: GRAPH_HASH, analysis_state: readbackState, analysis_ready: readbackReady,
      ...(readbackCarriesResult ? { analysis_result: readbackResult } : {}),
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { vi.mocked(fetch).mockClear(); runRequests = 0; rows.clear(); callModelOutputs = []; readbackState = PERMITTED_STATE; readbackCarriesResult = true; readbackGraph = FX.state.draft_graph; readbackReady = shapeControlReady(); readbackResult = RESULT_BLOCK; });

  let turnSeq = 0;
  const nextTurnId = () => { turnSeq += 1; return `5d4c3b2a-1f0e-4d9c-8b7a-${String(turnSeq).padStart(12, '0')}`; };
  const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
  /** The UI's Run control (fast path 3): the analysis runs, then ONE interpreting call answers — scripted here. */
  const typedRun = async (text: string, scenario = SCENARIO) => {
    callModelOutputs = [say(text)];
    const turnId = nextTurnId();
    const first = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: scenario, message: 'Run analysis.', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: turnId,
    } });
    expect(first.statusCode, first.body.slice(0, 300)).toBe(200);
    expect(callModelOutputs).toHaveLength(1);
    const chip = first.json().suggested_actions.find((c: { id: string }) => c.id.startsWith('agent-explain-run:'));
    expect(chip).toBeDefined();
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: scenario, agent_session_id: first.json()._agent.session_id, turn_id: nextTurnId(),
      message: chip.message, chip: { id: chip.id },
    } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect(callModelOutputs, 'the control: the scripted interpretation was consumed').toEqual([]);
    const b = r.json() as Body;
    expect(b._diagnostic_trace.fast_path, 'the control: the follow-up only explains').toBe('explain');
    return { b, turnId: [...rows.keys()].at(-1)! };
  };
  /** An ordinary composer message the Agent answers directly, with no tool call. */
  const askedTurn = async (text: string, scenario = SCENARIO, calls: Record<string, unknown>[][] = [], message = 'What does the analysis say?') => {
    callModelOutputs = [...calls, say(text)];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario, message, turn_id: nextTurnId() } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect(callModelOutputs, 'the control: the scripted reply was consumed').toEqual([]);
    return r.json() as Body;
  };
  const carriesResult = (b: Body) => (b.blocks ?? []).some((x) => x.type === 'analysis_result');

  const runOnlyPayload = (turnId: string) => ({
    kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.',
    chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: turnId,
  });
  const runOnly = async (turnId = nextTurnId()) => {
    const payload = runOnlyPayload(turnId);
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(response.statusCode, response.body).toBe(200);
    return { b: response.json() as Body & { narration?: { status: string; run_key: string }; _agent: { replayed?: boolean } }, turnId };
  };
  const RUN_DISCLOSURE = "How much each of ‘Pro subscriber base’ and ‘MRR per Pro subscriber’ counts towards ‘MRR’ is Olumi's assumption, not your stated priority. Set them to match what matters to you.";
  const hostRunFixture = () => {
    // Two licensed screen findings, no interpreter output; the Run's typed methods-note carrier owes a disclosure.
    readbackResult = { ...RESULT_BLOCK, enrichment: { ...(RESULT_BLOCK.enrichment as Record<string, unknown>), inference_warnings: [
      { code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance is licensed.', form: 'each',
        target: { value: 20000, unit: '£ per month', comparator: 'at_least' },
        option_ids: ['keep_pro_at_49', 'raise_pro_to_59_at_release'],
        pct_by_option: { keep_pro_at_49: 34, raise_pro_to_59_at_release: 47 },
        display_rounding_by_option: { keep_pro_at_49: 'whole', raise_pro_to_59_at_release: 'whole' } },
      { code: 'GOAL_INDEX_WEIGHTS_ASSUMED', severity: 'info', message: RUN_DISCLOSURE, goal_id: 'mrr',
        links: [{ from: 'pro_subscriber_base', to: 'mrr' }, { from: 'mrr_per_pro_subscriber', to: 'mrr' }] },
    ] } };
  };

  it('B15 / 2b-0: uninterpreted Run leads with the first screen finding; ready and disclosure in More detail', async () => {
    hostRunFixture();
    const screen = goalChanceScreenLinesForAgent(readbackResult, readbackGraph, true);
    expect(screen, 'positive control: two typed screen findings').toHaveLength(2);
    const { b, turnId } = await runOnly();
    expect(b._diagnostic_trace.fast_path).toBe('run');
    expect(carriesResult(b)).toBe(true);
    expect(fetch, 'the Run has no interpreter output').not.toHaveBeenCalled();
    expect(b._answer_shape, 'base keeps host_composed whole').toBeDefined();
    expect(b._answer_shape!.headline).toBe([screen[0]!.chance, screen[0]!.depends].filter(Boolean).join(' '));
    expect(b._answer_shape!.detail).toContain(RUN_RESULT_READY_TEXT);
    expect(b._answer_shape!.bullets.length).toBeLessThanOrEqual(3);
    expect(b.assistant_text).toBe(deriveAnswerTextFromShape(b._answer_shape!));
    expect(b._answer_shape!.detail).toContain(RUN_DISCLOSURE);
    for (const line of screen) {
      expect(faceOf(b._answer_shape!)).toContain(line.chance);
      expect(b.assistant_text.split(line.chance)).toHaveLength(2);
    }
    for (const part of [RUN_RESULT_READY_TEXT, RUN_DISCLOSURE]) for (const sentence of sentencesOf(part)) {
      expect(sentenceMultiset(b.assistant_text).filter(s => s === sentence), 'each host sentence exactly once').toHaveLength(1);
    }
    const deliveredSentences = sentenceMultiset(b.assistant_text);
    expect(new Set(deliveredSentences).size, 'all delivered host sentences occur once').toBe(deliveredSentences.length);
    expect(rows.get(turnId)?.assistant_message).toBe(b.assistant_text);
  });

  it('B15 route: interpreted Run with share-first narrator → first typed screen chance headline', async () => {
    hostRunFixture();
    const screen = goalChanceScreenLinesForAgent(readbackResult, readbackGraph, true);
    expect(screen, 'positive control: two current licensed screen findings').toHaveLength(2);
    const share = 'In this model, 71% of runs supported ‘Raise Pro to £59 at release’.';
    const narrated = [share, ...screen.map(l => [l.chance, l.depends].filter(Boolean).join(' '))].join('\n\n');
    const { b, turnId } = await typedRun(narrated);
    expect(b._diagnostic_trace.fast_path).toBe('explain');
    expect(carriesResult(b)).toBe(true);
    expect(fetch, 'positive control: the interpreter was called').toHaveBeenCalled();
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.headline).toBe([screen[0]!.chance, screen[0]!.depends].filter(Boolean).join(' '));
    expect([...b._answer_shape!.bullets, b._answer_shape!.detail].join('\n')).toContain(share);
    for (const line of screen) expect(faceOf(b._answer_shape!)).toContain(line.chance);
    expect(b.assistant_text).toBe(deriveAnswerTextFromShape(b._answer_shape!));
    for (const sentence of sentenceMultiset(narrated)) {
      expect(sentenceMultiset(b.assistant_text).filter(s => s === sentence)).toHaveLength(1);
    }
    expect(rows.get(turnId)?.assistant_message).toBe(b.assistant_text);
  });

  it('B15 route, Agent wording (DL CHANGES_REQUIRED 6049287605, Codex P1): share first, then each chance in the narrator’s own words → the first option-bound chance sentence leads', async () => {
    hostRunFixture();
    const screen = goalChanceScreenLinesForAgent(readbackResult, readbackGraph, true);
    expect(screen, 'positive control: two current licensed screen findings').toHaveLength(2);
    const share = 'In this model, 71% of runs supported ‘Raise Pro to £59 at release’.';
    // The narrator's own accepted wording: label + the screen's figure, never the canonical sentence.
    const own = [...screen].reverse().map(l => `${l.label}: ${l.figure}.`);
    const narrated = [share, ...own].join('\n\n');
    for (const l of screen) expect(narrated, 'control: canonical sentence absent').not.toContain(l.chance);
    const { b, turnId } = await typedRun(narrated);
    expect(b._answer_shape, b.assistant_text).toBeDefined();
    expect(b._answer_shape!.headline).toBe(own[0]);
    expect(b._answer_shape!.headline).not.toContain(share);
    expect(b.assistant_text).toBe(deriveAnswerTextFromShape(b._answer_shape!));
    for (const sentence of sentenceMultiset(narrated)) {
      expect(sentenceMultiset(b.assistant_text).filter(s => s === sentence)).toHaveLength(1);
    }
    expect(rows.get(turnId)?.assistant_message).toBe(b.assistant_text);
  });

  it('2b-0 REPLAY: the stored composed derivation still enters the current-Run rebuild, without another Run or interpreter', async () => {
    hostRunFixture();
    const screen = goalChanceScreenLinesForAgent(readbackResult, readbackGraph, true);
    expect(screen, 'positive control: the replayed Run has screen chance lines').toHaveLength(2);
    const { b: first, turnId } = await runOnly();
    expect(first._answer_shape).toBeDefined();
    expect(first._answer_shape!.headline, 'B15: the live Run leads with its first chance finding').toBe([screen[0]!.chance, screen[0]!.depends].filter(Boolean).join(' '));
    expect(rows.get(turnId)?.assistant_message).toBe(deriveAnswerTextFromShape(first._answer_shape!));
    expect(rows.get(turnId)?.assistant_message!.startsWith(first._answer_shape!.headline)).toBe(true);
    expect(first._answer_shape!.detail).toContain(RUN_RESULT_READY_TEXT);
    const { b: replay } = await runOnly(turnId);
    expect(replay._agent.replayed).toBe(true);
    expect(runRequests, 'the replay did not run again').toBe(1);
    expect(replay.narration).toEqual(first.narration);
    expect(replay.narration!.status).toBe('pending');
    expect(carriesResult(replay)).toBe(true);
    // DL (reload = same): the replay re-applies the same composer to the same typed parts — same bytes, same shape.
    expect(replay.assistant_text).toBe(first.assistant_text);
    expect(replay._answer_shape).toEqual(first._answer_shape);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('2b-0 REPLAY PARITY GUARD: stored words the rebuild does not reproduce → the rebuilt text ships whole, no shape', async () => {
    hostRunFixture();
    const { b: first, turnId } = await runOnly();
    expect(first._answer_shape, 'control: the live Run was shaped').toBeDefined();
    // A live branch the rebuild does not mirror changed the words the user saw (e.g. the leader gate's closing).
    const row = rows.get(turnId)!;
    rows.set(turnId, { ...row, assistant_message: `${row.assistant_message}\n\nA live-only closing sentence.` });
    const { b: replay } = await runOnly(turnId);
    expect(replay._agent.replayed).toBe(true);
    expect(replay._answer_shape, 'no shape the stored words do not prove').toBeUndefined();
    expect(replay.assistant_text).not.toBe(first.assistant_text);
    for (const line of goalChanceScreenLinesForAgent(readbackResult, readbackGraph, true)) expect(replay.assistant_text).toContain(line.chance);
  });

  it('2b-0 CONTRAST: missing approve card remains host_composed, byte-identical, without a shape', async () => {
    const { approvalChipIdFor } = await import('../approval-chips.js');
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Approve', turn_id: nextTurnId(),
      chip: { id: approvalChipIdFor('prop_2b0000') },
    } });
    expect(response.statusCode, response.body).toBe(200);
    const b = response.json() as Body;
    expect(b._diagnostic_trace.fast_path, 'positive control: typed approve path').toBe('approve');
    expect(b._answer_shape).toBeUndefined();
    expect(b.assistant_text).toBe('Not saved: that proposal is no longer available, so nothing was changed — ask me to suggest it again and approve the new one.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('1. RUN: a bulleted served reply → `_answer_shape`; the text IS its derivation; headline = first sentence; the robustness caveat opens the face (#2565), then the reply’s own points in order within the 75-word face budget; nothing lost', async () => {
    const { b, turnId } = await typedRun(FOUR_BULLETS.text);
    expect(carriesResult(b), 'the control: the response carries the readback’s analysis_result').toBe(true);
    const shape = b._answer_shape;
    expect(shape, '_answer_shape is on the wire').toBeDefined();
    expect(deriveAnswerTextFromShape(shape!), 'the tie, by identity').toBe(b.assistant_text);

    const lines = FOUR_BULLETS.text.split('\n').filter((l) => l.trim().length > 0);
    const bulletLines = lines.filter((l) => /^\s*-\s+/.test(l)).map(unmarked);
    expect(bulletLines, 'the control: the served reply has four bullets').toHaveLength(4);
    expect(shape!.headline).toBe('The model cannot yet support a yes/no on the £59 increase because it could not test your **monthly churn under 4%** requirement.');
    expect(FOUR_BULLETS.text.startsWith(shape!.headline), 'the headline is the reply’s own first sentence').toBe(true);
    expect(shape!.bullets[0], 'the caveat on a named finding opens the face').toBe(ROBUSTNESS_CAVEAT);
    const points = shape!.bullets.slice(1);
    expect(points.length).toBeGreaterThan(0);
    expect(points, 'the reply’s own points, in order').toEqual(bulletLines.slice(0, points.length));
    expect(shape!.detail.startsWith(`- ${bulletLines[points.length]!}`), 'the next point goes behind More detail, verbatim').toBe(true);
    expect(b.assistant_text.split(ROBUSTNESS_CAVEAT), 'the caveat is said exactly once').toHaveLength(2);
    for (const line of lines) expect(b.assistant_text, `kept: ${line.slice(0, 60)}…`).toContain(unmarked(line));
    expect(rows.get(turnId)?.assistant_message, 'the answer row a replay returns holds the SAME text').toBe(b.assistant_text);
  });

  it.each([
    ['in its first sentence', RANKS_FIRST, RANKS_FIRST_SENTENCE],
    ['in a bullet', RANKS_IN_BULLET, RANKS_IN_BULLET_SENTENCE],
  ])('2. WITHHELD: a reply that ranks %s → the gate drops the ranking and appends its reason; the composer, after the gate, keeps that reason ON THE FACE', async (_where, served, rankingSentence) => {
    // The controls: the sentence is in the served reply, and shaping BEFORE the gate would have put it on the face.
    expect(served.text).toContain(rankingSentence);
    const early = synthesiseAnswerShapeFromText(served.text);
    expect(early, 'the control: the raw reply is shapeable').not.toBeNull();
    expect(faceOf(early!), 'the control: derived before the gate, the face would carry the ranking').toContain(rankingSentence);
    expect(unhyphen(faceOf(early!))).toContain(unhyphen(served.leak_phrases[0]!));

    readbackState = WITHHELD_STATE;
    const { b, turnId } = await typedRun(served.text);
    expect(b._diagnostic_trace.leader_claim_enforced, 'the control: the gate edited this turn').toBe(true);
    expect(b.assistant_text, 'the control: the gate’s own sentence is in the reply').toContain(noLeaderSentence);
    expect(b._answer_shape, 'shaped after the gate').toBeDefined();
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
    expect(faceOf(b._answer_shape!), 'R1: the withheld reason is on the face').toContain(noLeaderSentence);
    expect(b.assistant_text.split(noLeaderSentence)).toHaveLength(2);
    expect(b.assistant_text).not.toContain(rankingSentence);
    for (const leak of served.leak_phrases) expect(unhyphen(b.assistant_text)).not.toContain(unhyphen(leak));
    expect(rows.get(turnId)?.assistant_message, 'the replayed row holds the same text').toBe(b.assistant_text);
  });

  it.each([
    ['one paragraph of two sentences', ONE_PARAGRAPH],
    ['four paragraphs', PARAGRAPHS_NO_BULLETS],
  ])('3. RUN: a reply with NO bullets (%s): too little to hide → ships whole; longer → its sentences become the face bullets', async (what, text) => {
    const { b } = await typedRun(text);
    expect(carriesResult(b), 'the control: an analysis-bearing turn').toBe(true);
    if (what === 'one paragraph of two sentences') {
      // Headline + two bullets hold all of it: already in shape, byte-identical (the caveat follows the narrator).
      expect('_answer_shape' in b).toBe(false);
      expect(b.assistant_text).toBe(`${text} ${ROBUSTNESS_CAVEAT}`);
      return;
    }
    expect(b._answer_shape).toBeDefined();
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
    expect(b._answer_shape!.bullets.length).toBeGreaterThan(0);
    expect(b._answer_shape!.bullets.length).toBeLessThanOrEqual(3);
    expect(text.startsWith(b._answer_shape!.headline)).toBe(true);
    expect(b.assistant_text.split(ROBUSTNESS_CAVEAT), 'the caveat is kept, once (R1: in detail)').toHaveLength(2);
    for (const para of text.split('\n\n')) for (const s of para.split(/(?<=[.!?])\s+(?=[A-Z])/)) expect(b.assistant_text).toContain(s.trim());
  });

  it('4. RED on base: NO analysis_result → the SAME bulleted reply is shaped too (every reply passes the composer, not only Run replies)', async () => {
    readbackCarriesResult = false;
    const without = await askedTurn(CLEAN_BULLETS.text);
    expect(carriesResult(without), 'the control: no result block on this response').toBe(false);
    expect(without._answer_shape, 'base shipped this whole (Run replies only)').toBeDefined();
    expect(deriveAnswerTextFromShape(without._answer_shape!)).toBe(without.assistant_text);
    expect(without._answer_shape!.headline).toBe('The comparison cannot yet answer whether to raise Pro to £59, because neither of your decision constraints was successfully checked.');
    // The narrator's points, in order, until the 75-word face budget (AIE §5); the rest sits in detail, verbatim.
    const points = without._answer_shape!.bullets;
    expect(points.length).toBeGreaterThan(0);
    expect(CLEAN_BULLETS.text).toContain(`- ${points[0]!}`);
    expect(without._answer_shape!.detail).toContain('The next reasoning step is to define the churn limit on a measurable model quantity and supply the current MRR baseline.');

    readbackCarriesResult = true;
    const withBlock = await askedTurn(CLEAN_BULLETS.text);
    expect(carriesResult(withBlock)).toBe(true);
    expect(withBlock._answer_shape, 'the control: with the block, the same shape').toEqual(without._answer_shape);
  });

  it('5. RUN: a reply LONGER than the old collapse floor with no bullets → shaped; its first sentences are the face bullets', async () => {
    const synth = synthesiseAnswerShapeFromText(LONG_NO_BULLETS);
    expect(deriveAnswerTextFromShape(synth!).length, 'the control: above the old floor').toBeGreaterThan(ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS);

    // This row isolates the no-bullet floor branch, so only its Run is robust; all other rows retain the served block.
    readbackResult = { ...RESULT_BLOCK, enrichment: {
      ...(RESULT_BLOCK.enrichment as Record<string, unknown>), robustness: { level: 'high', is_robust: true },
    } };
    const { b } = await typedRun(LONG_NO_BULLETS);
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.bullets.length).toBeGreaterThan(0);
    expect(b._answer_shape!.bullets.length).toBeLessThanOrEqual(3);
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
    expect(b._answer_shape!.headline).toBe(synth!.headline);
  });

  /**
   * ⛔ CONSENT BEFORE BREVITY. A turn that offers an approval is never shaped: the shape would put what the
   * user is being asked to approve behind "Show more" beside the chip that approves it. Each case runs on its
   * OWN scenario, because a proposal waits in the process-local store and would reach every later Run.
   */
  const proposeLink = (from: string, to: string) => [{
    type: 'function_call', name: 'propose_model_change', call_id: `p-${from}-${to}`,
    arguments: JSON.stringify({ from_label: from, to_label: to, direction: 'positive', strength: 'strong', rationale: 'Timing changes how the price lands.' }),
  }];
  /** A link is proposed only with the band the user typed THIS turn (#70 5845493088). */
  const PROPOSING = 'Timing strongly shapes how the price lands, so add that link.';
  /** A proposal reply over a current result: first sentence, four bullets, a closing ask. */
  const PROPOSAL_REPLY = [
    'The run turns on how the price rise lands, so I suggest one change to the model before you rely on it.',
    '',
    '- Add a link from Price-release alignment to Pro conversion rate (positive)',
    '- Why: a price rise that lands with the release is easier to accept',
    '- What it changes: conversion responds to timing as well as to price',
    '- What it leaves alone: every value in the model stays as it is',
    '',
    'Approve this change and I will apply it.',
  ].join('\n');
  type Offered = Body & { suggested_actions: { id: string }[]; _agent: { tool_calls: { name: string; ok: boolean }[] } };
  const APPROVE_PREFIX = async () => (await import('../approval-chips.js')).approvalChipIdFor('');
  const offersApprove = async (b: Offered) => { const p = await APPROVE_PREFIX(); return b.suggested_actions.some((c) => c.id.startsWith(p)); };

  it('7a. CONSENT: a proposal offered over a current result (bulleted, approve chip) → NOT shaped; text byte-identical', async () => {
    const would = synthesiseAnswerShapeFromText(PROPOSAL_REPLY)!;
    expect(would.detail, 'the control: shaped, the fourth bullet would go behind "Show more"').toContain('What it leaves alone');

    const proposed = await askedTurn(PROPOSAL_REPLY, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a10', [proposeLink('Price-release alignment', 'Pro conversion rate')], PROPOSING) as Offered;
    expect(proposed._agent.tool_calls, 'the control: the proposal was made').toMatchObject([{ name: 'propose_model_change', ok: true }]);
    expect(carriesResult(proposed), 'the control: over a current result').toBe(true);
    expect(await offersApprove(proposed), 'the control: the approve chip is offered').toBe(true);
    expect('_answer_shape' in proposed, 'the proposing turn is not shaped').toBe(false);
    expect(proposed.assistant_text).toBe(PROPOSAL_REPLY);
  });

  it('7b. a Run beside an EARLIER proposal’s approve chip → shaped: this reply states no change to consent to (R1), the chip and its card do', async () => {
    const SID = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a13';
    const proposed = await askedTurn(PROPOSAL_REPLY, SID, [proposeLink('Price-release alignment', 'Pro conversion rate')], PROPOSING) as Offered;
    expect(await offersApprove(proposed), 'the control: a proposal is waiting').toBe(true);

    const { b } = await typedRun(FOUR_BULLETS.text, SID);
    const run = b as Offered;
    expect(carriesResult(run), 'the control: the Run carries the result').toBe(true);
    expect(await offersApprove(run), 'the control: the Run carries the waiting proposal’s chip').toBe(true);
    expect(run._answer_shape, 'shaped').toBeDefined();
    expect(deriveAnswerTextFromShape(run._answer_shape!)).toBe(run.assistant_text);
  });

  it('8. CONTROL: the SAME Run with no proposal waiting → shaped (the existing behaviour)', async () => {
    const { b } = await typedRun(FOUR_BULLETS.text, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a11');
    expect(await offersApprove(b as Offered), 'the control: nothing to approve').toBe(false);
    expect(b._answer_shape, 'shaped').toBeDefined();
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
  });

  it('B3-8 (AIE line review: required evidence is never hidden): the unavailable basis stays on the face, exactly once', async () => {
    readbackReady = FX.state.analysis_ready;
    const { b, turnId } = await typedRun(CLEAN_BULLETS.text);
    expect(b.assistant_text.split(BASIS_UNAVAILABLE)).toHaveLength(2);
    if (b._answer_shape !== undefined) expect(faceOf(b._answer_shape), 'on the face').toContain(BASIS_UNAVAILABLE);
    expect(rows.get(turnId)?.assistant_message).toBe(b.assistant_text);
  });

  it('B3-8 (R1): a basis already in the narrator’s words is said once, not twice', async () => {
    readbackReady = FX.state.analysis_ready;
    const narrated = `${CLEAN_BULLETS.text}\n\n${BASIS_UNAVAILABLE}`;
    const { b, turnId } = await typedRun(narrated);
    expect(b.assistant_text.split(BASIS_UNAVAILABLE)).toHaveLength(2);
    expect(rows.get(turnId)?.assistant_message).toBe(b.assistant_text);
  });

  it.each([[true, true], [false, true], [true, false], [false, false]])('B3-8 RED: question-tail basis is visible once (present=%s punctuated=%s)', async (present, punctuated) => {
    readbackReady = FX.state.analysis_ready;
    const question = punctuated ? 'What baseline should we use?' : 'The baseline is unknown';
    const narrated = `The comparison is conditional. Questions this model does not answer yet: ${question}${present ? `\n\n${BASIS_UNAVAILABLE}` : ''}`;
    const { b, turnId } = await typedRun(narrated);
    expect(textAtRest(b.assistant_text)).toContain(BASIS_UNAVAILABLE);
    expect(b.assistant_text.split(BASIS_UNAVAILABLE)).toHaveLength(2);
    expect(b.assistant_text).toContain(question);
    expect('_answer_shape' in b).toBe(false);
    expect(rows.get(turnId)?.assistant_message).toBe(b.assistant_text);
    if (process.env.B3_WIRE_EVIDENCE) {
      b3WireCases.push({ source: 'actual Agent route; stubbed model/Run/readback', text: b.assistant_text, line: BASIS_UNAVAILABLE, question });
      writeFileSync(`${process.env.B3_WIRE_EVIDENCE}/b3-question-tail-basis-wire.json`, JSON.stringify(b3WireCases, null, 2) + '\n');
    }
  });

  it('9. CONSENT: a SECOND proposal in the turn is refused (one change per approval), so ONE chip is offered → still NOT shaped; text byte-identical', async () => {
    const proposed = await askedTurn(PROPOSAL_REPLY, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a12', [
      proposeLink('Price-release alignment', 'Pro conversion rate'),
      proposeLink('Perceived Pro value', 'Pro subscriber base'),
    ], PROPOSING) as Offered;
    expect(proposed._agent.tool_calls, 'the control: the first is proposed, the second refused before it is stored').toMatchObject([{ name: 'propose_model_change', ok: true }, { name: 'propose_model_change', ok: false, refusal: 'one_change_per_approval' }]);
    expect(carriesResult(proposed), 'the control: over a current result').toBe(true);
    expect(await offersApprove(proposed), 'the control: ONE pending, so its approve chip').toBe(true);
    expect('_answer_shape' in proposed, 'a turn asking for approval in words is not shaped either').toBe(false);
    expect(proposed.assistant_text).toBe(PROPOSAL_REPLY);
  });

  /**
   * ⛔ OLUMI'S OWN LINES STAY ON THE FACE (DL item 3; CODEX r2 P1 on #2509). The UI renders `_answer_shape` INSTEAD of the
   * text, so a shape over the whole reply put the host's appended ask behind "Show more" whenever the narrator wrote
   * bullets. The served pricing graph with its target removed: the Agent's own Run then owes D1's target ask (the host's
   * exact string, `decision-input-ask.ts`), appended after the narrator's bulleted reply.
   */
  const runCall = [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'run-1' }];
  const noTargetGraph = () => {
    const g = structuredClone(FX.state.draft_graph) as { nodes: Record<string, unknown>[] };
    for (const n of g.nodes) if (n.kind === 'goal') { n.goal_threshold = null; n.goal_threshold_raw = null; n.success_threshold = null; }
    return g;
  };
  /** D1's ask as the host writes it for this goal (`targetAsk`, neutral words: MRR's direction is not read as a floor). */
  const TARGET_ASK = 'What figure should "MRR" reach or stay under? I\'ll propose it as your target.';

  it('10. RED on base: HOST ASK — the Agent’s Run, a bulleted reply, and D1’s target ask appended → shaped, the ask closes the face (R1)', async () => {
    readbackGraph = noTargetGraph();
    const b = await askedTurn(CLEAN_BULLETS.text, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a14', [runCall], 'Run the analysis and tell me what it says.') as Offered;
    expect(b._agent.tool_calls, 'the control: the Agent ran the analysis').toMatchObject([{ name: 'run_analysis', ok: true }]);
    expect(carriesResult(b), 'the control: the reply carries the result').toBe(true);
    expect(b.assistant_text.split(TARGET_ASK), 'the control: the host appended its target ask, once').toHaveLength(2);
    expect(b._answer_shape, 'base shipped this whole (a host line was in the text)').toBeDefined();
    expect(b._answer_shape!.bullets.at(-1), 'the one ask closes the face').toBe(TARGET_ASK);
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
  });

  it('12. HOST STATUS (CODEX on #2517): an unsupported "Saved" claim → the host\'s own status line, kept once (R1: status may sit in detail)', async () => {
    const claim = `${CLEAN_BULLETS.text}\n\nSaved the change.`;
    const b = await askedTurn(claim, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a16') as Offered;
    expect(carriesResult(b), 'the control: over a current result').toBe(true);
    expect(b.assistant_text.split('Nothing was saved this turn.'), 'the host removed the claim and said so, once').toHaveLength(2);
    expect(b.assistant_text).not.toContain('Saved the change.');
    expect(b._answer_shape, 'shaped').toBeDefined();
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
  });

  it('11. CONTROL: the SAME Agent Run on the graph WITH its target → no host ask is owed → the reply is still shaped', async () => {
    const b = await askedTurn(CLEAN_BULLETS.text, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a15', [runCall], 'Run the analysis and tell me what it says.') as Offered;
    expect(b._agent.tool_calls, 'the control: the Agent ran the analysis').toMatchObject([{ name: 'run_analysis', ok: true }]);
    expect(b.assistant_text.includes(TARGET_ASK), 'nothing owed').toBe(false);
    expect(b._answer_shape, 'shaped, as before').toBeDefined();
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
  });
});
