/**
 * THE COLLAPSE FLOOR — CEE may tell the UI to hide an answer only when the UI
 * would have hidden it anyway.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────
 * MEASURED ON THE LIVE WIRE, 14 Sep 2026, CEE staging `78515b95`, a real
 * pre-mortem turn:
 *
 *     assistant_text          1,372 chars   <- the whole answer, three scenarios
 *     _answer_shape.headline    138 chars   <- ONE sentence, and all the user saw
 *
 * The founder read 138 characters and a "Show more". A reasoning tool that
 * sits on the reasoning it just produced enhances nothing.
 *
 * ── THE DISPUTE THIS SPEC SETTLES ────────────────────────────────────────
 * It was put to this lane that withholding the sidecar changes nothing,
 * because the UI's free-text path truncates too (`findNaturalTruncation`, the
 * `expanded === false` render). SETTLED AT THE DEPLOYED BYTES, 18 Sep 2026:
 * `https://staging--olumi.netlify.app/version.json` served commit
 * `3b7e5d4c050caa75ad4506866109ce76567ac506`, and DecisionGuideAI at that exact
 * SHA carries `CLAMP_CHAR_THRESHOLD = 3000` with
 * `findNaturalTruncation(text) => text.length <= 3000 ? null : ...`. A
 * 1,372-character answer is BELOW that threshold, so the free-text path does
 * not truncate it at all. The 138 -> 1,372 visible-character claim holds.
 *
 * That is also where the floor's value comes from — it is not a taste
 * judgement, it is the deployed UI's own rule, restated on the producer side.
 *
 * ── WHAT THIS SPEC PINS, AND WHY IN PAIRS ────────────────────────────────
 * Every case here has an opposite-direction twin (CLAUDE.md trap 22b): a
 * guard that only ever watches one door cannot tell "the floor works" from
 * "the feature is switched off". Below the floor the sidecar must be ABSENT;
 * above it the sidecar must be PRESENT. A change that killed progressive
 * disclosure outright would pass the first half and RED the second.
 *
 * Both egress sites are covered, because they are different code paths:
 *   - SITE 1, the executor/chip-composed shape re-attach (`ctx.answerShape`);
 *   - SITE 2, the deterministic egress synthesiser
 *     (`synthesiseAnswerShapeFromText`), which also REFLOWS `assistant_text`.
 *
 * The boundary pair (exactly 3,000 vs exactly 3,001 derived characters) pins
 * the comparison operator itself: flipping `>` to `>=` REDs the 3,000 case.
 *
 * Driven through the REAL route (`app.inject` on /orchestrate/v2/turn), so
 * these exercise the real egress chokepoint rather than a helper in isolation.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const configHolder = {
  cee: {
    timingDebugEnabled: false,
    turnDebugEnabled: false,
    contextSummaryEnabled: false,
    coachingStatePackEnabled: false,
  },
  features: {
    optionShortcutRepair: true,
    diagnosticTraceEnabled: false,
    reasoningCaptureEnabled: false,
  },
};
vi.mock('../../../src/config/index.js', () => ({
  config: configHolder,
  isProduction: () => false,
}));

const runTurnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { deriveAnswerTextFromShape, ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS } = await import(
  '../../../src/orchestrator-v5/routing/answer-shape.js'
);

const SCENARIO_ID = '5c011a95-0000-4000-8000-000000000001';

/** The exact length of the pre-mortem answer measured on staging on 14 Sep. */
const FOUNDER_MEASURED_CHARS = 1372;

const HEADLINE = 'Three things could sink this plan.';
/** The sentence a reader only ever reaches if the answer is NOT collapsed. */
const CLOSING_SENTENCE = 'Decide the pricing question before the hiring one.';

/**
 * Build PROSE whose shaped/derived form is EXACTLY `derivedLength` characters.
 *
 * `synthesiseAnswerShapeFromText` splits at the first sentence boundary and
 * `deriveAnswerTextFromShape` re-joins headline and detail with `\n\n`, so a
 * single-space join costs one extra character. Everything is therefore
 * computed from the real functions rather than hand-counted — a fixture whose
 * length is asserted by arithmetic the code does not share is a fixture that
 * silently stops testing the boundary the day the join changes.
 */
function proseWithDerivedLength(derivedLength: number): string {
  // derived = HEADLINE + '\n\n' + detail  =>  |detail| = n - |HEADLINE| - 2
  const detailLength = derivedLength - HEADLINE.length - 2;
  const filler = 'Pricing power is the weakest link in the model. '.repeat(200);
  const body = (filler + CLOSING_SENTENCE).slice(0, detailLength - CLOSING_SENTENCE.length);
  const detail = body + CLOSING_SENTENCE;
  const prose = `${HEADLINE} ${detail}`;
  // Fail loud rather than silently test the wrong length.
  if (detail.length !== detailLength) {
    throw new Error(`fixture builder produced detail ${detail.length}, wanted ${detailLength}`);
  }
  return prose;
}

/** An executor run WITHOUT a shape — the egress synthesiser's target (SITE 2). */
function mkProseRun(assistantText: string) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: assistantText,
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
    effectiveGraph: null,
    answerKind: 'substantive' as const,
    telemetry: {
      stages_completed: ['orient', 'compose'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      turn_class: 'explore',
      intent_class: 'converse',
      coaching_mode: 'reframe',
      validation_error_code: null,
    },
  };
}

/**
 * An executor run WITH a model-authored shape whose derived text is exactly
 * `derivedLength` characters — SITE 1, the re-attach path. `assistant_text` is
 * set to the derived text, which is the executor's own capture contract and
 * what the route's fail-closed tie check requires.
 */
function mkShapedRun(derivedLength: number) {
  const detailLength = derivedLength - HEADLINE.length - 2;
  const filler = 'Pricing power is the weakest link in the model. '.repeat(200);
  const body = (filler + CLOSING_SENTENCE).slice(0, detailLength - CLOSING_SENTENCE.length);
  const shape = { headline: HEADLINE, bullets: [] as string[], detail: body + CLOSING_SENTENCE };
  const derived = deriveAnswerTextFromShape(shape);
  if (derived.length !== derivedLength) {
    throw new Error(`shaped fixture derived ${derived.length}, wanted ${derivedLength}`);
  }
  return {
    response: {
      response_version: 2 as const,
      assistant_text: derived,
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
    effectiveGraph: null,
    answerShape: shape,
    answerKind: 'substantive' as const,
    telemetry: {
      stages_completed: ['orient', 'compose'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      turn_class: 'explore',
      intent_class: 'coach',
      coaching_mode: 'reframe',
      validation_error_code: null,
    },
  };
}

async function postTurn(app: FastifyInstance, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: turnId,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message: 'What could go wrong with this plan?',
      turn_class: 'decide',
      source: 'composer',
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('route-v2 — the collapse floor on `_answer_shape`', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    runTurnExecutorMock.mockReset();
  });

  it('the floor is the shortest answer the deployed UI can truncate (3b7e5d4c: 3000 + 150)', () => {
    // ⭐ PINS THE VALUE, AND THE VALUE WAS FOUND BY EXECUTION. Reading
    // `findNaturalTruncation` suggests 3,000. Running it — extracted from the
    // deployed source at `3b7e5d4c` — gives null at 3,001 as well, because
    // truncation also requires a cut point hiding at least MIN_HIDDEN_CHARS
    // (150) and the largest available cut point is 3,000. Nothing shorter than
    // 3,150 can be truncated at all.
    //
    // A floor of 3,000 would have left a ~150-character band where CEE
    // collapses an answer the UI would have shown whole — this PR's own defect,
    // surviving inside its fix. If someone moves this number, the deployed
    // derivation must be re-run, and this assertion is where they are told so.
    expect(ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS).toBe(3150);
    expect(FOUNDER_MEASURED_CHARS).toBeLessThan(ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS);
  });

  // ── SITE 2 — the egress synthesiser ────────────────────────────────────

  it("the founder's measured 1,372-character answer ships WHOLE — no collapse directive, closing sentence intact", async () => {
    const prose = proseWithDerivedLength(FOUNDER_MEASURED_CHARS);
    runTurnExecutorMock.mockResolvedValue(mkProseRun(prose));
    const { status, body } = await postTurn(app, '5c011a95-1111-4000-8000-000000000001');
    expect(status).toBe(200);

    // THE DIRECTIVE IS WITHHELD — the UI renders the free-text body, which at
    // 1,372 chars its own clamp leaves untruncated.
    expect(body).not.toHaveProperty('_answer_shape');

    // THE USER OUTCOME, asserted on the substance and not merely on a missing
    // key: the whole answer is on the wire, including its LAST sentence — the
    // one that was behind "Show more". Binding by identity (CLAUDE.md trap 19):
    // the closing sentence, not "some text is present".
    expect(body.assistant_text).toBe(prose);
    expect(body.assistant_text).toContain(CLOSING_SENTENCE);
    expect(body.assistant_text.length).toBe(FOUNDER_MEASURED_CHARS - 1);

    // And no half-treatment: declining to collapse must not reflow the text
    // either, or the author's bytes and the shape drift apart for nothing.
    expect(body.assistant_text.includes('\n\n')).toBe(false);
  });

  it('OPPOSITE DIRECTION — a 3,500-character answer is STILL collapsed (the capability is intact, not switched off)', async () => {
    // 3,500 sits above the 3,150 floor AND is genuinely truncated by the
    // deployed UI (measured: cut to 2,987, hiding 513), so this is the regime
    // where the structured view is the better of the two clamps.
    const prose = proseWithDerivedLength(3500);
    runTurnExecutorMock.mockResolvedValue(mkProseRun(prose));
    const { status, body } = await postTurn(app, '5c011a95-1111-4000-8000-000000000002');
    expect(status).toBe(200);
    expect(body._answer_shape).toBeDefined();
    expect(body._answer_shape.headline).toBe(HEADLINE);
    // The sidecar contract still holds by construction.
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
    expect(body.assistant_text.length).toBe(3500);
  });

  // ── The boundary pair — pins the comparison operator ───────────────────

  it('exactly at the floor (3,000 derived characters) → NOT collapsed', async () => {
    const prose = proseWithDerivedLength(ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS);
    runTurnExecutorMock.mockResolvedValue(mkProseRun(prose));
    const { status, body } = await postTurn(app, '5c011a95-1111-4000-8000-000000000003');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
    expect(body.assistant_text).toBe(prose);
  });

  it('one character above the floor (3,001) → collapsed', async () => {
    const prose = proseWithDerivedLength(ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS + 1);
    runTurnExecutorMock.mockResolvedValue(mkProseRun(prose));
    const { status, body } = await postTurn(app, '5c011a95-1111-4000-8000-000000000004');
    expect(status).toBe(200);
    expect(body._answer_shape).toBeDefined();
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
  });

  // ── SITE 1 — the executor/chip-composed shape re-attach ────────────────

  it('SITE 1 — a model-authored shape below the floor is NOT re-attached, and the answer survives whole', async () => {
    const run = mkShapedRun(FOUNDER_MEASURED_CHARS);
    const derived = run.response.assistant_text;
    runTurnExecutorMock.mockResolvedValue(run);
    const { status, body } = await postTurn(app, '5c011a95-2222-4000-8000-000000000001');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
    // Nothing is lost by declining: the executor had already set assistant_text
    // to this exact derived text, so the user receives every character.
    expect(body.assistant_text).toBe(derived);
    expect(body.assistant_text).toContain(CLOSING_SENTENCE);
  });

  it('SITE 1, OPPOSITE DIRECTION — a model-authored shape above the floor IS re-attached', async () => {
    const run = mkShapedRun(3500);
    runTurnExecutorMock.mockResolvedValue(run);
    const { status, body } = await postTurn(app, '5c011a95-2222-4000-8000-000000000002');
    expect(status).toBe(200);
    expect(body._answer_shape).toBeDefined();
    expect(body._answer_shape.headline).toBe(HEADLINE);
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
  });
});
