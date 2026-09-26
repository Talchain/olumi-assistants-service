/**
 * ⭐ AN ANALYSIS REPLY ON THE AGENT ROUTE ARRIVES HEADLINE FIRST (UI contract UI-SEM-090; agreed design
 * #69 5831886008) — through the real route, `withAnalysisAnswerShape` in `routes/agent-v1-turn.ts`.
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
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS,
  deriveAnswerTextFromShape,
  synthesiseAnswerShapeFromText,
  type AnswerShape,
} from '../../routing/answer-shape.js';

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
const GRAPH_HASH = RESULT_BLOCK.computed_against_hash;

const WITHHELD_STATE = FX.state.analysis_state;
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
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: GRAPH_HASH, blocks: [RESULT_BLOCK],
      analysis_ready: FX.state.analysis_ready, analysis_state: readbackState,
    }));
    // The final readback — the ONLY source of the response's `analysis_result` block.
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: FX.state.draft_graph, graph_hash: GRAPH_HASH, analysis_state: readbackState, analysis_ready: FX.state.analysis_ready,
      ...(readbackCarriesResult ? { analysis_result: RESULT_BLOCK } : {}),
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); callModelOutputs = []; readbackState = PERMITTED_STATE; readbackCarriesResult = true; });

  let turnSeq = 0;
  const nextTurnId = () => { turnSeq += 1; return `5d4c3b2a-1f0e-4d9c-8b7a-${String(turnSeq).padStart(12, '0')}`; };
  const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
  /** The UI's Run control (fast path 3): the analysis runs, then ONE interpreting call answers — scripted here. */
  const typedRun = async (text: string, scenario = SCENARIO) => {
    callModelOutputs = [say(text)];
    const turnId = nextTurnId();
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: scenario, message: 'Run analysis.', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: turnId,
    } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect(callModelOutputs, 'the control: the scripted interpretation was consumed').toEqual([]);
    const b = r.json() as Body;
    expect(b._diagnostic_trace.fast_path, 'the control: the typed Run took fast path 3').toBe('run');
    return { b, turnId };
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

  it('1. RUN: a bulleted served reply → `_answer_shape`; the text IS its derivation; headline = first sentence; bullets = first three, in order; nothing lost', async () => {
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
    expect(shape!.bullets).toEqual(bulletLines.slice(0, 3));
    for (const line of lines) expect(b.assistant_text, `kept: ${line.slice(0, 60)}…`).toContain(unmarked(line));
    expect(shape!.detail, 'the fourth bullet goes behind "Show more", verbatim').toContain(lines.find((l) => l.includes(bulletLines[3]!))!.trim());
    expect(rows.get(turnId)?.assistant_message, 'the answer row a replay returns holds the SAME text').toBe(b.assistant_text);
  });

  it.each([
    ['in its first sentence', RANKS_FIRST, RANKS_FIRST_SENTENCE],
    ['in a bullet', RANKS_IN_BULLET, RANKS_IN_BULLET_SENTENCE],
  ])('2. WITHHELD: a reply that ranks %s → the gate rewrote it, so NOT shaped: the no-leader sentence stays on the face, no ranking anywhere', async (_where, served, rankingSentence) => {
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
    // Review 5832549611: a shape would put the gate's disclosure (and its next action) behind "Show more".
    expect('_answer_shape' in b, 'a gate-rewritten reply ships whole: its disclosure is on the face').toBe(false);
    expect(b.assistant_text).not.toContain(rankingSentence);
    for (const leak of served.leak_phrases) expect(unhyphen(b.assistant_text)).not.toContain(unhyphen(leak));
    expect(rows.get(turnId)?.assistant_message, 'the replayed row holds the same whole text').toBe(b.assistant_text);
  });

  it.each([
    ['one paragraph of two sentences', ONE_PARAGRAPH],
    ['four paragraphs', PARAGRAPHS_NO_BULLETS],
  ])('3. RUN: a reply with NO bullets (%s), below the floor → no `_answer_shape`, text byte-identical', async (_what, text) => {
    const synth = synthesiseAnswerShapeFromText(text);
    expect(synth, 'the control: the synthesiser WOULD shape it, so only the bullet guard declines').not.toBeNull();
    expect(synth!.bullets).toHaveLength(0);
    expect(deriveAnswerTextFromShape(synth!).length).toBeLessThanOrEqual(ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS);

    const { b } = await typedRun(text);
    expect(carriesResult(b), 'the control: an analysis-bearing turn').toBe(true);
    expect('_answer_shape' in b).toBe(false);
    expect(b.assistant_text).toBe(text);
  });

  it('4. NO analysis_result: the same bulleted reply → no `_answer_shape`, text byte-identical; CONTRAST: with the block, shaped', async () => {
    expect(synthesiseAnswerShapeFromText(CLEAN_BULLETS.text)?.bullets.length, 'the control: shapeable, with bullets').toBe(3);

    readbackCarriesResult = false;
    const without = await askedTurn(CLEAN_BULLETS.text);
    expect(carriesResult(without), 'the control: no result block on this response').toBe(false);
    expect('_answer_shape' in without).toBe(false);
    expect(without.assistant_text).toBe(CLEAN_BULLETS.text);

    readbackCarriesResult = true;
    const withBlock = await askedTurn(CLEAN_BULLETS.text);
    expect(carriesResult(withBlock)).toBe(true);
    expect(withBlock._answer_shape, 'the only difference is the block').toBeDefined();
    expect(deriveAnswerTextFromShape(withBlock._answer_shape!)).toBe(withBlock.assistant_text);
  });

  it('5. RUN: a reply LONGER than the collapse floor with no bullets → shaped (the floor branch)', async () => {
    const synth = synthesiseAnswerShapeFromText(LONG_NO_BULLETS);
    expect(synth!.bullets, 'the control: no bullet, so only the floor can license it').toHaveLength(0);
    expect(deriveAnswerTextFromShape(synth!).length, 'the control: above the floor').toBeGreaterThan(ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS);

    const { b } = await typedRun(LONG_NO_BULLETS);
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.bullets).toHaveLength(0);
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

  it('7b. CONSENT: a Run with a bulleted reply that carries a waiting proposal’s approve chip → NOT shaped; text byte-identical', async () => {
    const SID = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a13';
    // Setup: the proposal the Run will carry (its own shape is test 7a's business, not asserted here).
    const proposed = await askedTurn(PROPOSAL_REPLY, SID, [proposeLink('Price-release alignment', 'Pro conversion rate')], PROPOSING) as Offered;
    expect(await offersApprove(proposed), 'the control: a proposal is waiting').toBe(true);

    const { b } = await typedRun(FOUR_BULLETS.text, SID);
    const run = b as Offered;
    expect(carriesResult(run), 'the control: the Run carries the result').toBe(true);
    expect(await offersApprove(run), 'the control: the Run carries the waiting proposal’s chip').toBe(true);
    expect('_answer_shape' in run, 'a Run that offers an approval is not shaped').toBe(false);
    expect(run.assistant_text).toBe(FOUR_BULLETS.text);
  });

  it('8. CONTROL: the SAME Run with no proposal waiting → shaped (the existing behaviour)', async () => {
    const { b } = await typedRun(FOUR_BULLETS.text, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a11');
    expect(await offersApprove(b as Offered), 'the control: nothing to approve').toBe(false);
    expect(b._answer_shape, 'shaped').toBeDefined();
    expect(deriveAnswerTextFromShape(b._answer_shape!)).toBe(b.assistant_text);
  });

  it('9. CONSENT: TWO proposals pending, so the chip rule offers no chip → still NOT shaped; text byte-identical', async () => {
    const proposed = await askedTurn(PROPOSAL_REPLY, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a12', [
      proposeLink('Price-release alignment', 'Pro conversion rate'),
      proposeLink('Perceived Pro value', 'Pro subscriber base'),
    ], PROPOSING) as Offered;
    expect(proposed._agent.tool_calls, 'the control: both proposals were made').toMatchObject([{ name: 'propose_model_change', ok: true }, { name: 'propose_model_change', ok: true }]);
    expect(carriesResult(proposed), 'the control: over a current result').toBe(true);
    expect(await offersApprove(proposed), 'the control: two pending, so no approve chip').toBe(false);
    expect('_answer_shape' in proposed, 'a turn asking for approval in words is not shaped either').toBe(false);
    expect(proposed.assistant_text).toBe(PROPOSAL_REPLY);
  });
});

/**
 * 6. A response that ALREADY carries `_answer_shape` is returned by reference. Unreachable through this
 * route today (nothing on it produces a shape before this step), so the exported helper is driven directly —
 * the same function the route calls.
 */
describe('6. withAnalysisAnswerShape leaves an existing `_answer_shape` alone', () => {
  it('returned by reference, text and sidecar untouched; CONTRAST: the same body without one is shaped', async () => {
    const { withAnalysisAnswerShape } = await import('../../../routes/agent-v1-turn.js');
    const existing: AnswerShape = { headline: 'An earlier shape.', bullets: [], detail: 'Its own detail.' };
    const body = { assistant_text: CLEAN_BULLETS.text, blocks: [RESULT_BLOCK], _answer_shape: existing };
    const out = withAnalysisAnswerShape(body);
    expect(out).toBe(body);
    expect(out.assistant_text).toBe(CLEAN_BULLETS.text);
    expect(out._answer_shape).toBe(existing);

    const { _answer_shape: _drop, ...bare } = body;
    const shaped = withAnalysisAnswerShape(bare) as typeof bare & { _answer_shape?: AnswerShape };
    expect(shaped._answer_shape, 'the control: without one, this body IS shaped').toBeDefined();
    expect(deriveAnswerTextFromShape(shaped._answer_shape!)).toBe(shaped.assistant_text);
  });
});
