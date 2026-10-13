import { runPressToolResponse } from './fixtures/run-press-model.js';
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
import { readFlipClaimPosture as _readFlipClaimPosture } from '../../context/flip-threshold-rows.js';
import { reconciliationPending as _reconciliationPending } from '../goal-scope.js';
import type { PendingAction } from '../../session/pending-action.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { NOT_ROBUST_SENTENCE as _NOT_ROBUST_SENTENCE, robustnessHonestySentence as _robustnessHonestySentence } from '../../coaching/analysis-result-headline.js';
import { collectFactorIdsSetByEveryOption as _collectFactorIdsSetByEveryOption } from '../../context/intervention-controlled-drivers.js';
import { analysedOptionIds as _analysedOptionIds } from '../conditional-input-basis.js';
import { decisionInputAsk as _decisionInputAsk, textAtRest as _textAtRest } from '../decision-input-ask.js';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { sentencesOf as _sentencesOf } from '../reply/compose-reply.js';

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
const _shapedNarrator = (n: number) => `${bulletedNarrator(n)} ${LONG_TAIL}`;
const _BASIS_UNAVAILABLE = 'The sources of this comparison’s factor starting values are unavailable.';
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
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const runCall = runPressToolResponse(body);
      if (runCall) return runCall;
      if (body.tool_choice !== 'none') return new Response(JSON.stringify({ output: [
        { type: 'message', content: [{ type: 'output_text', text: 'The analysis result is available.' }] },
      ] }), { status: 200 });
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
      kind: 'message', agent_session_id: randomUUID(), scenario_id: SCENARIO, message: 'Run analysis.',
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
  const _assertCaveat = (b: Body, sentence = SENTENCE) => {
    expect(b._answer_shape).toBeDefined();
    expect(b._answer_shape!.headline).toBe(NARRATOR);
    assertShapedCaveat(b, sentence);
    expect(count(b.assistant_text, sentence)).toBe(1);
    expect(count(b.assistant_text, sentence === SENTENCE ? NO_FLIP_SENTENCE : SENTENCE)).toBe(0);
  };

  // W7: a caveat marker preserves headline-first rendering and narrator bullet order.

  // Exact narrator copies in a shaped answer must move to bullet 1, without surviving elsewhere.

  // W8: adding the face caveat displaces only the last narrator bullet, without losing or doubling words.

  // W9: the marker qualifies the narrator; the independent basis and full caveat remain intact in detail.

  // W10: scope can narrow authority after narration; neither ranking nor caveat can rely on the initial licence.

  // W11: removing scope rereads canonical authority; the same Run's restored licence must add the caveat.

  const _graphWithControlledFlipFactors = () => {
    const graph = structuredClone(FX.state.draft_graph) as { nodes: Record<string, unknown>[] };
    const interventions = Object.fromEntries(FLIP_ROWS.map(row => [(row as { factor_id: string }).factor_id, { value: 1 }]));
    for (const node of graph.nodes) if (node.kind === 'option') node.interventions = interventions;
    return graph;
  };
  // W12: the stored Run headline wins even when the current graph's vacuity rule disagrees.

  // W13: with no stored sentence, only analysed option IDs participate in the structural fallback.

  // Missing roster cannot establish vacuity: only positive no-flip attestation selects its scoped variant.

  // W14: an exact caveat used as the first sentence must not consume the narrator's real headline.

  // W15: reuse the B3 question-tail variants; neither the caveat nor the independent basis may fold away.

  // One class row: seven narrator variants crossed with both host-obligation states.

  it('unavailable narration of a licensed fragile Run carries no caveat', async () => {
    emptyNarration = true;
    const b = await press(await run());
    expect(b.narration?.status).toBe('unavailable');
    expect(count(b.assistant_text, SENTENCE)).toBe(0);
    expect(count(b.assistant_text, NO_FLIP_SENTENCE)).toBe(0);
  });
});
