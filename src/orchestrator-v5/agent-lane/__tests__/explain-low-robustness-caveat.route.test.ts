/**
 * DL BUILD, HIGH — a licensed leader is not proof of a robust result. Press the real
 * bound Explain control with fixed narrator words, through the served-readback/store
 * harness from agent-run-reply-answer-shape.test.ts. No provider is contacted.
 */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFlipClaimPosture } from '../../context/flip-threshold-rows.js';
import { reconciliationPending } from '../goal-scope.js';
import type { PendingAction } from '../../session/pending-action.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { NOT_ROBUST_SENTENCE, robustnessHonestySentence } from '../../coaching/analysis-result-headline.js';
import { collectFactorIdsSetByEveryOption } from '../../context/intervention-controlled-drivers.js';
import { analysedOptionIds } from '../conditional-input-basis.js';
import { decisionInputAsk, textAtRest } from '../decision-input-ask.js';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { sentencesOf } from '../reply/compose-reply.js';

const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: Record<string, unknown>; analysis_ready: {
    analysis_admission: { semantic_signals: Record<string, unknown> };
  } };
};
const SERVED_RUN = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/c19-8428207-B.run-turns.trimmed.json', import.meta.url), 'utf8')) as {
  turns: { t2: { analysis_result: { computed_against_hash: string; enrichment: Record<string, unknown> } & Record<string, unknown> } };
};
const RESULT = SERVED_RUN.turns.t2.analysis_result;
const GRAPH_HASH = RESULT.computed_against_hash;
const SCENARIO = '3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a0f';
const NARRATOR = 'Raise Pro to £59 at release leads in this model.';
const NARRATOR_BULLETS = ['The price assumption changes the modelled outcome.', 'The conversion assumption also matters.', 'The timing assumption remains uncertain.'];
const bulletedNarrator = (n: number) => [NARRATOR, ...NARRATOR_BULLETS.slice(0, n).map(b => `- ${b}`), 'These are model-relative findings.'].join('\n');
/**
 * S-A (lane COPY-SHAPE, 7 Oct): the ONE composer ships a reply whole when it fits the 75-word face budget with one
 * question (AIE #87 6037293086 §5), or when under 15 words would go behind "More detail", so the rows that test the
 * SHAPED face carry a closing long enough to disclose.
 */
const LONG_TAIL = 'They describe what this model implies on current information, not what the market will do, and they change when its assumptions change. '
  + 'The figures behind them are planning assumptions rather than measured evidence, so the next useful step is to check the inputs this result leans on most.';
const shapedNarrator = (n: number) => `${bulletedNarrator(n)} ${LONG_TAIL}`;
const BASIS_UNAVAILABLE = 'The sources of this comparison’s factor starting values are unavailable.';
/** Exact public sentences, pinned independently of the selector so base/mutants cannot redefine the oracle. */
const SENTENCE = 'The result is not yet robust — small changes could flip it.';
const ROBUSTNESS_MARKER = 'Small changes could change the comparison';
const NO_FLIP_SENTENCE = 'The result is not yet robust — no single factor we tested would change the order on its own, but the margin is not settled.';
const count = (text: string, sentence: string) => text.split(sentence).length - 1;
const countSentenceCopies = (text: string, sentence: string) => {
  const pattern = sentence.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[^\\S\\n]+');
  return (text.match(new RegExp(pattern, 'g')) ?? []).length;
};
const NO_FLIP = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/cross-service/witness-2267-attested-no-flip.json', import.meta.url), 'utf8')) as {
  runs: Record<string, { flip_thresholds: unknown[] }>;
};
/** The same producer-attested rows used by headline-flip-evidence-reconciliation.test.ts. */
const FLIP_ROWS = Object.values(NO_FLIP.runs)[0]!.flip_thresholds;

type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null };
const rows = new Map<string, Row>();
let retainedScope: PendingAction[] = [];
let canonicalScopeRead: { analysis_state: Record<string, unknown>; analysis_result: typeof RESULT } | undefined;
vi.mock('../../../routes/scenario-graph-analysis-read.js', async original => ({
  ...await original<Record<string, unknown>>(),
  // W11 supplies the same-Run canonical receipt used by the real scope-removal composer.
  readScenarioAnalysis: vi.fn(async () => {
    if (canonicalScopeRead === undefined) throw new Error('Unexpected scope-removal read');
    return canonicalScopeRead;
  }),
}));
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash
      ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => retainedScope),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('Explain: a licensed raw-fragile Run carries one server-owned caveat', () => {
  let app: FastifyInstance;
  let narrator = NARRATOR;
  let providerCalls = 0;
  let emptyNarration = false;
  let readbackState: Record<string, unknown>;
  let readbackReady: typeof FX.state.analysis_ready;
  let readbackResult: typeof RESULT;
  let readbackGraph: typeof FX.state.draft_graph;
  let duringNarration: (() => void) | undefined;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      providerCalls += 1;
      duringNarration?.();
      return new Response(JSON.stringify({ output: emptyNarration ? [] : [
        { type: 'message', content: [{ type: 'output_text', text: narrator }] },
      ] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: GRAPH_HASH,
      blocks: [readbackResult], analysis_ready: readbackReady, analysis_state: readbackState,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({
      graph: readbackGraph, graph_hash: GRAPH_HASH, analysis_state: readbackState,
      analysis_ready: readbackReady, analysis_result: readbackResult,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => {
    rows.clear(); narrator = NARRATOR; providerCalls = 0; emptyNarration = false;
    readbackGraph = structuredClone(FX.state.draft_graph); retainedScope = []; canonicalScopeRead = undefined; duringNarration = undefined;
    readbackState = { ...FX.state.analysis_state,
      run_state: { ...(FX.state.analysis_state.run_state as Record<string, unknown>), computed_at: '2026-10-01T12:00:00.000Z' },
      leader_claim: { permitted: true, separation: 'separated' } };
    readbackReady = structuredClone(FX.state.analysis_ready);
    readbackReady.analysis_admission.semantic_signals.material_parameters_awaiting_user_node_ids = [];
    readbackResult = { ...RESULT, summary: 'Synthetic current result.', leading_option_id: 'raise_pro_to_59_at_release',
      enrichment: { robustness: { level: 'low', is_robust: false } } };
  });
  type Body = { assistant_text: string; narration?: { status: string }; _answer_shape?: AnswerShape;
    analysis_state: { leader_claim: { permitted: boolean } }; _agent: { replayed?: boolean } };
  const run = async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: randomUUID(),
    } });
    expect(r.statusCode, r.body).toBe(200);
    expect(providerCalls).toBe(0);
    const first = r.json();
    const chip = first.suggested_actions.find((c: { id: string }) => c.id.startsWith('agent-explain-run:'));
    expect(chip, r.body).toBeDefined();
    return { scenario_id: SCENARIO, agent_session_id: first._agent.session_id, turn_id: randomUUID(),
      message: RUN_EXPLANATION_MESSAGE, chip: { id: chip.id } };
  };
  const press = async (payload: Record<string, unknown>, replay = false) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(r.statusCode, r.body).toBe(200);
    if (!replay) expect(r.json()._diagnostic_trace.fast_path).toBe('explain');
    return r.json() as Body;
  };
  const assertShapedCaveat = (b: Body, sentence = SENTENCE) => {
    const shape = b._answer_shape!;
    const face = [shape.headline, ...shape.bullets].join('\n');
    expect(shape.bullets[0], 'the caveat marker is must-face, immediately after the headline').toBe(ROBUSTNESS_MARKER);
    expect(face, 'the full caveat belongs behind progressive disclosure').not.toContain(sentence);
    expect(countSentenceCopies(shape.detail, sentence), 'the full sentence appears verbatim once in detail').toBe(1);
    expect(shape.detail).toContain(sentence);
    expect(countSentenceCopies(b.assistant_text, sentence)).toBe(1);
    expect(b.assistant_text).toBe(deriveAnswerTextFromShape(shape));
  };
  const assertCaveat = (b: Body, sentence = SENTENCE) => {
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.headline).toBe(NARRATOR);
    assertShapedCaveat(b, sentence);
    expect(count(b.assistant_text, sentence)).toBe(1);
    expect(count(b.assistant_text, sentence === SENTENCE ? NO_FLIP_SENTENCE : SENTENCE)).toBe(0);
  };

  it('W1: licensed + low/false + no flip rows — marker after narrator, full caveat once detail', async () => {
    const b = await press(await run());
    expect(b.analysis_state.leader_claim.permitted).toBe(true);
    assertCaveat(b);
  });
  it('W2: licensed + high/true — neither caveat', async () => {
    // Approved 5471d752 correction: this exact 76-word contract reply is already within the face.
    narrator = shapedNarrator(2);
    readbackResult.enrichment.robustness = { level: 'high', is_robust: true };
    const b = await press(await run());
    expect(b.assistant_text.slice(0, NARRATOR.length)).toBe(NARRATOR);
    expect(count(b.assistant_text, SENTENCE)).toBe(0);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
    expect(b._answer_shape).toBeUndefined();
    expect(b.assistant_text).toBe(narrator);
    expect(b.assistant_text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(80);
    for (const bullet of NARRATOR_BULLETS.slice(0, 2)) expect(count(b.assistant_text, bullet)).toBe(1);
  });
  it('W3: withheld + low/false — neither caveat', async () => {
    readbackState.leader_claim = { permitted: false, separation: 'separated', withheld_reason: 'constraint_verdict_withheld' };
    const b = await press(await run());
    expect(b.analysis_state.leader_claim.permitted).toBe(false);
    expect(count(b.assistant_text, SENTENCE)).toBe(0);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
  });
  it('W4: an exact Explain retry returns the same caveat once; a chipless retry meets the existing identity gate', async () => {
    const payload = await run();
    const once = await press(payload);
    assertCaveat(once);
    expect(rows.get(payload.turn_id)?.assistant_message).toBe(once.assistant_text);
    const exact = await press(payload, true);
    expect(exact._agent.replayed).toBe(true);
    expect(exact.assistant_text).toBe(once.assistant_text);
    assertCaveat(exact);
    // The Explain id rides INSIDE the request digest (`ownOperation`), so a chipless retry is another request: the
    // existing TURN_ID_REUSED gate (unchanged here) answers it, never a second Explain or a second caveat.
    const { chip: _chip, ...chipless } = payload;
    const retry = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { ...chipless, source: 'retry' } });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error).toBe('TURN_ID_REUSED');
    expect(providerCalls).toBe(1);
  });
  it('W5: the narrator already ends with the exact sentence — no duplicate', async () => {
    narrator = `${NARRATOR} ${SENTENCE}`;
    assertCaveat(await press(await run()));
  });
  it('W6: positive no-flip attestation — the no-flip variant once, ordinary variant zero', async () => {
    readbackResult.enrichment.flip_thresholds = FLIP_ROWS;
    expect(readFlipClaimPosture(readbackResult.enrichment)).toBe('attested_no_flip');
    assertCaveat(await press(await run()), NO_FLIP_SENTENCE);
  });
  // W7: a caveat marker preserves headline-first rendering and narrator bullet order.
  it('W7: licensed + fragile keeps the shape with the exact marker as bullet 1 and full caveat once in detail', async () => {
    narrator = shapedNarrator(2);
    const b = await press(await run());
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.headline).toBe(NARRATOR);
    expect(b._answer_shape!.bullets).toEqual([ROBUSTNESS_MARKER, ...NARRATOR_BULLETS.slice(0, 2)]);
    expect(count(b.assistant_text, SENTENCE)).toBe(1);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
    assertShapedCaveat(b);
  });
  // Exact narrator copies in a shaped answer must move to bullet 1, without surviving elsewhere.
  it.each(['bullet', 'detail'])('W7 contrast: narrator already carries the caveat in %s', async placement => {
    narrator = placement === 'bullet'
      ? [NARRATOR, `- ${SENTENCE}`, ...NARRATOR_BULLETS.slice(0, 2).map(b => `- ${b}`), `These are model-relative findings. ${LONG_TAIL}`].join('\n')
      : `${shapedNarrator(2)} ${SENTENCE}`;
    const b = await press(await run());
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.headline).toBe(NARRATOR);
    expect(b._answer_shape!.bullets).toEqual([ROBUSTNESS_MARKER, ...NARRATOR_BULLETS.slice(0, 2)]);
    expect(count(b.assistant_text, SENTENCE)).toBe(1);
    assertShapedCaveat(b);
  });
  // W8: adding the face caveat displaces only the last narrator bullet, without losing or doubling words.
  it('W8: three narrator bullets move the last to the start of detail', async () => {
    narrator = shapedNarrator(3);
    const b = await press(await run());
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.headline).toBe(NARRATOR);
    expect(b._answer_shape!.bullets).toEqual([ROBUSTNESS_MARKER, ...NARRATOR_BULLETS.slice(0, 2)]);
    // S-A: a bullet in detail keeps its own list marker (the composer moves lines, it never rewrites them).
    expect(b._answer_shape!.detail.startsWith(`- ${NARRATOR_BULLETS[2]!}`)).toBe(true);
    const content = [...b._answer_shape!.bullets, b._answer_shape!.detail].join('\n');
    for (const bullet of NARRATOR_BULLETS) expect(count(content, bullet)).toBe(1);
    expect(count(b.assistant_text, SENTENCE)).toBe(1);
    assertShapedCaveat(b);
  });
  // W9: the marker qualifies the narrator; the independent basis and full caveat remain intact in detail.
  it('W9: an owed basis disclosure stays once in detail beside the full caveat', async () => {
    narrator = bulletedNarrator(2);
    readbackReady = structuredClone(FX.state.analysis_ready);
    const b = await press(await run());
    assertCaveat(b);
    expect(count(b._answer_shape!.detail, BASIS_UNAVAILABLE)).toBe(1);
    for (const line of narrator.split('\n')) expect(count(b.assistant_text, line.replace(/^[-*•]\s+/, ''))).toBe(1);
  });
  // W10: scope can narrow authority after narration; neither ranking nor caveat can rely on the initial licence.
  it('W10: initial permission, final retained scope issue withholds leader and caveat', async () => {
    const payload = await run();
    expect(readbackState.leader_claim).toMatchObject({ permitted: true });
    duringNarration = () => {
      retainedScope = [reconciliationPending(SCENARIO, { kind: 'reconcile_goal_scope', goal_id: 'mrr', goal_label: 'MRR',
        declared_scope: { modelled: 'all revenue', alternative: 'one stream', stated_in_brief: true },
        question: 'Which revenue scope should this model represent?', /* #2613-successor (Science d5 6006584860): an UNTYPED question no longer blocks; this fixture's open issue is a typed one. */ scope: { modelled: 'all revenue', alternative: 'one stream', extent: 'total', stated_in_brief: true, source: { quote: 'all revenue' } }, expected: 'billing_basis', operands: [], derivations: [] })];
    };
    const b = await press(payload);
    expect(b.narration?.status).toBe('ready');
    expect(b.analysis_state.leader_claim).toMatchObject({ permitted: false, withheld_reason: 'goal_scope_unresolved' });
    expect(b.assistant_text).not.toContain(NARRATOR);
    // r15 contract re-pin: "cell-sourced marker". This final leader-scope refusal has no goal-chance
    // cell, so its short fixed reason ships whole. Authority and caveat exclusions stay exact.
    const withheld = 'No single option can be put forward yet, and the reason is not recorded, so I will not guess at one; ask me to run the analysis and I can tell you then.';
    expect(b._answer_shape).toBeUndefined();
    expect(b.assistant_text).toBe(withheld);
    expect(count(b.assistant_text, withheld)).toBe(1);
    expect(b.assistant_text).not.toContain('Not shown yet; why is under More detail');
    expect(count(b.assistant_text, SENTENCE)).toBe(0);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
  });
  // W11: removing scope rereads canonical authority; the same Run's restored licence must add the caveat.
  it('W11: initially scope-withheld, final same-Run canonical read permits', async () => {
    const payload = await run();
    const permitted = readbackState;
    readbackState = { ...permitted, leader_claim: { permitted: false, withheld_reason: 'goal_scope_unresolved' } };
    canonicalScopeRead = { analysis_state: permitted, analysis_result: readbackResult };
    expect(canonicalScopeRead.analysis_state.run_state).toEqual(readbackState.run_state);
    const b = await press(payload);
    expect(b.narration?.status).toBe('ready');
    expect(b.analysis_state.leader_claim.permitted).toBe(true);
    assertCaveat(b);
  });
  const graphWithControlledFlipFactors = () => {
    const graph = structuredClone(FX.state.draft_graph) as { nodes: Record<string, unknown>[] };
    const interventions = Object.fromEntries(FLIP_ROWS.map(row => [(row as { factor_id: string }).factor_id, { value: 1 }]));
    for (const node of graph.nodes) if (node.kind === 'option') node.interventions = interventions;
    return graph;
  };
  // W12: the stored Run headline wins even when the current graph's vacuity rule disagrees.
  it('W12: reuse the summary’s exact no-flip sentence', async () => {
    const graph = graphWithControlledFlipFactors();
    readbackGraph = graph;
    const options = graph.nodes.filter(n => n.kind === 'option');
    readbackResult.enrichment.option_comparison = options.map((n, i) => ({ option_id: n.id, option_label: n.label, win_probability: i === 1 ? .6 : .2 }));
    expect(analysedOptionIds(readbackResult)).toEqual(options.map(n => n.id));
    readbackResult.summary = `Stored deterministic headline. ${NO_FLIP_SENTENCE}`;
    readbackResult.enrichment.flip_thresholds = FLIP_ROWS;
    expect(robustnessHonestySentence(readbackResult.enrichment, collectFactorIdsSetByEveryOption(readbackGraph))).toBe(SENTENCE);
    assertCaveat(await press(await run()), NO_FLIP_SENTENCE);
  });
  // W13: with no stored sentence, only analysed option IDs participate in the structural fallback.
  it('W13: no summary sentence uses the analysed-option fallback, excluding an unanalysed free option', async () => {
    const graph = graphWithControlledFlipFactors();
    const options = graph.nodes.filter(n => n.kind === 'option');
    options[2]!.interventions = {};
    readbackGraph = graph;
    readbackResult.enrichment.flip_thresholds = FLIP_ROWS;
    readbackResult.enrichment.option_comparison = options.slice(0, 2).map((n, i) => ({ option_id: n.id, option_label: n.label, win_probability: i === 0 ? .3 : .7 }));
    expect(analysedOptionIds(readbackResult)).toEqual(options.slice(0, 2).map(n => n.id));
    expect(readbackResult.summary).not.toContain(SENTENCE);
    expect(readbackResult.summary).not.toContain(NO_FLIP_SENTENCE);
    expect(robustnessHonestySentence(readbackResult.enrichment, collectFactorIdsSetByEveryOption(graph))).toBe(NO_FLIP_SENTENCE);
    assertCaveat(await press(await run()), SENTENCE);
  });
  // Missing roster cannot establish vacuity: only positive no-flip attestation selects its scoped variant.
  it.each([false, true])('W13 contrast: unavailable analysed roster, attested no flip=%s', async attested => {
    if (attested) readbackResult.enrichment.flip_thresholds = FLIP_ROWS;
    expect(analysedOptionIds(readbackResult)).toEqual([]);
    assertCaveat(await press(await run()), attested ? NO_FLIP_SENTENCE : SENTENCE);
  });
  // W14: an exact caveat used as the first sentence must not consume the narrator's real headline.
  it('W14: caveat-first narration retains a shape with the second sentence as headline', async () => {
    narrator = `${SENTENCE} ${shapedNarrator(2)}`;
    const b = await press(await run());
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.bullets[0]).toBe(ROBUSTNESS_MARKER);
    expect(b._answer_shape!.headline).toBe(NARRATOR);
    expect(count(b.assistant_text, SENTENCE)).toBe(1);
    for (const bullet of NARRATOR_BULLETS.slice(0, 2)) expect(count(b.assistant_text, bullet)).toBe(1);
    assertShapedCaveat(b);
  });
  // W15: reuse the B3 question-tail variants; neither the caveat nor the independent basis may fold away.
  it.each([[true, true], [false, true], [true, false], [false, false]])('W15: marker faces, full caveat detail stays before questions (basis present=%s punctuated=%s)', async (present, punctuated) => {
    readbackReady = structuredClone(FX.state.analysis_ready);
    const question = punctuated ? 'What baseline should we use?' : 'The baseline is unknown';
    const marker = 'Questions this model does not answer yet:';
    narrator = `${NARRATOR} ${marker} ${question}${present ? `\n\n${BASIS_UNAVAILABLE}` : ''}`;
    const b = await press(await run());
    expect(b.narration?.status).toBe('ready');
    expect(b.analysis_state.leader_claim.permitted).toBe(true);
    assertCaveat(b);
    expect(count(textAtRest(b.assistant_text), SENTENCE)).toBe(1);
    expect(count(b.assistant_text, SENTENCE)).toBe(1);
    expect(b.assistant_text).toContain(`${marker} ${question}`);
    expect(b.assistant_text.indexOf(SENTENCE)).toBeLessThan(b.assistant_text.indexOf(marker));
    expect(b.assistant_text.slice(b.assistant_text.indexOf(marker))).not.toContain(SENTENCE);
    expect(b._answer_shape!.detail).toContain(`${marker} ${question}`);
    expect(b._answer_shape!.detail.indexOf(SENTENCE)).toBeLessThan(b._answer_shape!.detail.indexOf(marker));
    expect(textAtRest(b.assistant_text)).toContain(BASIS_UNAVAILABLE);
  });
  it('W16: spaced caveat-first narration retains one caveat and the second sentence as headline', async () => {
    const sentence = NOT_ROBUST_SENTENCE.trim();
    narrator = `${sentence.replace('robust —', 'robust  —')} ${shapedNarrator(2)}`;
    const b = await press(await run());
    expect(b._answer_shape).toBeDefined();
    const shape = b._answer_shape!;
    expect(shape.bullets[0]).toBe(ROBUSTNESS_MARKER);
    expect(shape.headline).toBe(NARRATOR);
    const shapedText = [shape.headline, ...shape.bullets, shape.detail].join('\n');
    expect(countSentenceCopies(shapedText, sentence)).toBe(1);
    expect(countSentenceCopies(b.assistant_text, sentence)).toBe(1);
    for (const bullet of NARRATOR_BULLETS.slice(0, 2)) {
      expect(count(shapedText, bullet)).toBe(1);
      expect(count(b.assistant_text, bullet)).toBe(1);
    }
    assertShapedCaveat(b, sentence);
  });
  it('W17a: short narration keeps one marker and one full caveat in detail after the narrator', async () => {
    const sentence = NOT_ROBUST_SENTENCE.trim();
    narrator = `${NARRATOR} ${sentence} ${sentence}`;
    const b = await press(await run());
    assertCaveat(b, sentence);
    expect(countSentenceCopies(b.assistant_text, sentence)).toBe(1);
    expect(countSentenceCopies(textAtRest(b.assistant_text), sentence)).toBe(1);
    expect(count(b.assistant_text, NARRATOR)).toBe(1);
    expect(b.assistant_text.indexOf(NARRATOR)).toBeLessThan(b.assistant_text.indexOf(sentence));
    expect(b._answer_shape!.headline).toBe(NARRATOR);
  });
  it('W17b: a caveat at rest and in the questions tail becomes one copy before all questions', async () => {
    const sentence = NOT_ROBUST_SENTENCE.trim();
    readbackReady = structuredClone(FX.state.analysis_ready);
    const marker = 'Questions this model does not answer yet:';
    const questions = ['What baseline should we use?', 'The baseline is unknown'];
    narrator = `${NARRATOR} ${sentence} ${marker} ${questions[0]}\n${sentence}\n${questions[1]}`;
    const b = await press(await run());
    expect(b.narration?.status).toBe('ready');
    expect(b.analysis_state.leader_claim.permitted).toBe(true);
    assertCaveat(b, sentence);
    expect(countSentenceCopies(b.assistant_text, sentence)).toBe(1);
    expect(countSentenceCopies(textAtRest(b.assistant_text), sentence)).toBe(1);
    const markerAt = b.assistant_text.indexOf(marker);
    expect(markerAt).toBeGreaterThan(-1);
    expect(b.assistant_text.indexOf(sentence)).toBeLessThan(markerAt);
    const questionsTail = b.assistant_text.slice(markerAt);
    expect(countSentenceCopies(questionsTail, sentence)).toBe(0);
    for (const question of questions) expect(questionsTail).toContain(question);
  });
  it('W18: a shapeable narrator with a questions tail keeps the caveat on the face', async () => {
    const sentence = NOT_ROBUST_SENTENCE.trim();
    const question = 'What baseline should we use?';
    narrator = `${shapedNarrator(2)}\n\nQuestions this model does not answer yet: ${question}`;
    const b = await press(await run());
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.bullets[0]).toBe(ROBUSTNESS_MARKER);
    expect(countSentenceCopies(b.assistant_text, sentence)).toBe(1);
    expect(countSentenceCopies(textAtRest(b.assistant_text), sentence)).toBe(1);
    expect(b.assistant_text).toContain(question);
    assertShapedCaveat(b, sentence);
  });
  it('W19: display the exact double-space ID-bearing ask before adjacent caveat removal', async () => {
    const sentence = NOT_ROBUST_SENTENCE.trim();
    const graph = structuredClone(FX.state.draft_graph) as { nodes: Record<string, unknown>[] };
    const goal = graph.nodes.find(node => node.kind === 'goal')!;
    goal.label = 'Quarterly  revenue prop_deadbeefdeadbeefdeadbeefdeadbeef';
    goal.provenance = 'ai_inferred';
    readbackGraph = graph;
    // The inferred-objective builder used by rawDecisionInputAsk and the existing D1 route rows.
    const rawAsk = `I used "${goal.label}" as a provisional objective. What should this model help you explore?`;
    const displayAsk = decisionInputAsk(graph, {
      restingText: '', questionsToggle: false, awaitingApproval: false, builtOrRan: true,
    });
    expect(displayAsk).toBe('I used "Quarterly  revenue this proposal" as a provisional objective. What should this model help you explore?');
    // Dedupe intentionally folds horizontal whitespace on the caveat-bearing line, AFTER display.
    const displayedAtRest = displayAsk!.replace(/[^\S\n]+/g, ' ');
    narrator = `${rawAsk} ${sentence}\nCompare with prop_abcdefabcdefabcdefabcdefabcdefab.`;
    const b = await press(await run());
    // Progressive disclosure moves the typed ask's two sentences into their own shape slots; each byte-exact
    // sentence still survives once, with the existing horizontal-whitespace fold already applied by the route.
    for (const part of sentencesOf(displayedAtRest)) expect(count(b.assistant_text, part)).toBe(1);
    expect(b.assistant_text).not.toMatch(/prop_[0-9a-f]{6,}/);
    expect(countSentenceCopies(b.assistant_text, sentence)).toBe(1);
    assertShapedCaveat(b, sentence);
  });
  // One class row: seven narrator variants crossed with both host-obligation states.
  it.each(['plain', 'bulleted', 'questions tail', 'exact copy', 'spaced copy', 'caveat bullet', 'two copies']
    .flatMap(variant => [false, true].map(basisUnavailable => ({ variant, basisUnavailable }))))(
    'W20: $variant / basis-unavailable=$basisUnavailable preserves the caveat and narrator class',
    async ({ variant, basisUnavailable }) => {
      const sentence = NOT_ROBUST_SENTENCE.trim();
      const questionTail = 'Questions this model does not answer yet: What baseline should we use?';
      const cleanNarrator = variant === 'plain' ? NARRATOR
        : variant === 'questions tail' || variant === 'two copies' ? `${bulletedNarrator(2)}\n\n${questionTail}` : bulletedNarrator(2);
      if (basisUnavailable) readbackReady = structuredClone(FX.state.analysis_ready);
      // Route control, independently authored without copies; no production stripper supplies the oracle.
      narrator = cleanNarrator;
      readbackResult.enrichment.robustness = { level: 'high', is_robust: true };
      const control = await press(await run());
      expect(countSentenceCopies(control.assistant_text, sentence)).toBe(0);
      providerCalls = 0;
      readbackResult.enrichment.robustness = { level: 'low', is_robust: false };
      narrator = variant === 'exact copy' ? `${sentence} ${cleanNarrator}`
        : variant === 'spaced copy' ? `${sentence.replace('robust —', 'robust  —')} ${cleanNarrator}`
          : variant === 'caveat bullet' ? `${NARRATOR}\n- ${sentence}\n${cleanNarrator.slice(NARRATOR.length + 1)}`
            : variant === 'two copies' ? `${sentence} ${cleanNarrator}\n${sentence}` : cleanNarrator;
      const b = await press(await run());
      expect(countSentenceCopies(b.assistant_text, sentence)).toBe(1);
      expect(countSentenceCopies(textAtRest(b.assistant_text), sentence)).toBe(1);
      assertCaveat(b, sentence);
      if (basisUnavailable) {
        expect(count(b._answer_shape!.detail, BASIS_UNAVAILABLE)).toBe(1);
        expect(textAtRest(b.assistant_text)).toContain(BASIS_UNAVAILABLE);
      }
      // Shape rendering changes bullet glyphs; every non-caveat line's words still survive once.
      for (const line of cleanNarrator.split('\n').filter(line => line.trim() !== '')) {
        expect(count(b.assistant_text, line.replace(/^\s*[-*•]\s+/, '').trim())).toBe(1);
      }
    },
  );
  it('unavailable narration of a licensed fragile Run carries no caveat', async () => {
    emptyNarration = true;
    const b = await press(await run());
    expect(b.narration?.status).toBe('unavailable');
    expect(count(b.assistant_text, SENTENCE)).toBe(0);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
  });
});
