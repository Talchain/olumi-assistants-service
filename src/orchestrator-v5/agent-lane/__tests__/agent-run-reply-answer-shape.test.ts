/**
 * ⭐ EVERY REPLY ON THE AGENT ROUTE ARRIVES IN ONE SHAPE (S-A REPLY SHAPE v1, lane COPY-SHAPE, 7 Oct 2026; Paul: "It was a
 * better length before with the three bullets as a construct"): a headline and the typed face lines, the rest under "More
 * detail" — through the real route, the ONE composer (`agent-lane/reply/compose-reply.ts`) at the end of
 * `routes/agent-v1-turn.ts`. It replaced `withAnalysisAnswerShape` (Run replies only, UI-SEM-090 / #69 5831886008).
 *
 * RE-PINNED ROWS, each against a DL ruling of 7 Oct (lane-copy-shape-DESIGN.md §8), never against the failure mode:
 *   · TYPED RESPONSE PROFILES by turn kind (AIE line review 6037446159 item 5): coaching (≤3 bullets within 80 words),
 *     method_step and proposal (never reshaped: rows 7a, 9 unchanged).
 *   · Draft/Run contracts carry the finding, typed chance lines, their horizon, the bounded estimates line and one next
 *     step. Unrelated caveats, generic basis and narrator supporting points move to detail; every sentence stays once.
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
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
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
import { HORIZON_MARKER, ROBUSTNESS_MARKER, WITHHOLD_FALLBACK_MARKER, sentenceMultiset, sentencesOf } from '../reply/compose-reply.js';
import { textAtRest, untestedHorizonLine } from '../decision-input-ask.js';
import type { CanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';

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
let readbackCellRows: CanonicalAnalysisView['options'] | undefined;
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
  readRecent: vi.fn(async (_sid: string, _limit?: number): Promise<Row[]> => []),
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
const faceWords = (s: AnswerShape) => faceOf(s).split(/\s+/).filter(Boolean).length;
const occurrences = (text: string, exact: string): number => text.split(exact).length - 1;
const expectRobustnessDisclosure = (b: Body): void => {
  expect(b._answer_shape, 'typed robustness marker requires a face/detail presentation').toBeDefined();
  const shape = b._answer_shape!;
  expect(shape.bullets[0], 'the robustness marker is bullet 1').toBe(ROBUSTNESS_MARKER);
  expect(occurrences(faceOf(shape), ROBUSTNESS_CAVEAT), 'the expert caveat is off face').toBe(0);
  expect(occurrences(shape.detail, ROBUSTNESS_CAVEAT), 'the full robustness caveat is verbatim once in detail').toBe(1);
  expect(occurrences(b.assistant_text, ROBUSTNESS_CAVEAT), 'the whole reply retains one full caveat').toBe(1);
  expect(b.assistant_text).toBe(deriveAnswerTextFromShape(shape));
};

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
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      const read = withCanonicalAnalysisView({
        graph: readbackGraph, graph_hash: GRAPH_HASH, analysis_state: readbackState, analysis_ready: readbackReady,
        ...(readbackCarriesResult ? { analysis_result: readbackResult } : {}),
      }, SCENARIO);
      return readbackCellRows === undefined ? read : {
        ...read, canonical_analysis_view: { ...read.canonical_analysis_view, options: readbackCellRows },
      };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { vi.mocked(fetch).mockClear(); store.readRecent.mockReset().mockResolvedValue([]); runRequests = 0; rows.clear(); callModelOutputs = []; readbackState = PERMITTED_STATE; readbackCarriesResult = true; readbackGraph = FX.state.draft_graph; readbackReady = shapeControlReady(); readbackResult = RESULT_BLOCK; readbackCellRows = undefined; });

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
  const A7 = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £20,000 within 12 months.";
  const A7_WITHOUT_CHANCE = "This model doesn't yet say whether any option gets there within 12 months.";

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

  // AI-first Lane 2 N1: row 4 pinned the removed ordinary-turn face pool; it went with the fold (one-reply-build-contract's N1 row).

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
    const proposed = await askedTurn(PROPOSAL_REPLY, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a10', [proposeLink('Price-release alignment', 'Pro conversion rate')], PROPOSING) as Offered;
    expect(proposed._agent.tool_calls, 'the control: the proposal was made').toMatchObject([{ name: 'propose_model_change', ok: true }]);
    expect(carriesResult(proposed), 'the control: over a current result').toBe(true);
    expect(await offersApprove(proposed), 'the control: the approve chip is offered').toBe(true);
    expect('_answer_shape' in proposed, 'the proposing turn is not shaped').toBe(false);
    expect(proposed.assistant_text).toBe(PROPOSAL_REPLY);
  });

  it('7b. a Run keeps the earlier proposal card and ships the AI answer whole', async () => {
    const SID = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a13';
    const proposed = await askedTurn(PROPOSAL_REPLY, SID, [proposeLink('Price-release alignment', 'Pro conversion rate')], PROPOSING) as Offered;
    expect(await offersApprove(proposed), 'the control: a proposal is waiting').toBe(true);

    const { b } = await typedRun(FOUR_BULLETS.text, SID);
    const run = b as Offered;
    expect(carriesResult(run), 'the control: the Run carries the result').toBe(true);
    expect(await offersApprove(run), 'the control: the Run carries the waiting proposal’s chip').toBe(true);
    expect(run._answer_shape).toBeUndefined();
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

  it('12. HOST STATUS (CODEX on #2517): an unsupported "Saved" claim → the host\'s own status line, kept once (R1: status may sit in detail)', async () => {
    const claim = `${CLEAN_BULLETS.text}\n\nSaved the change.`;
    const b = await askedTurn(claim, '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a16') as Offered;
    expect(carriesResult(b), 'the control: over a current result').toBe(true);
    expect(b.assistant_text.split('Nothing was saved this turn.'), 'the host removed the claim and said so, once').toHaveLength(2);
    expect(b.assistant_text).not.toContain('Saved the change.');
    // AI-first N1: an ordinary turn ships whole (this row pinned the removed fold); the write-truth negatives above stay.
    expect(b._answer_shape, 'no fold on an ordinary turn').toBeUndefined();
  });


});
