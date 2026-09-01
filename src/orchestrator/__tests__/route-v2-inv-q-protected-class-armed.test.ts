/**
 * INV-Q (ROADMAP 2.715) WITH THE OPEN-FRAME CLASSIFIER ARMED — the corpus that
 * `route-v2-inv-q-protected-class.test.ts` structurally cannot be.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS (and why the landed corpus is not evidence here)
 *
 * PR #1110 routes an empty-workspace `frame` turn through an advisory model
 * classifier (`understandOpenFrameIntake`). The landed corpus mocks
 * `chatWithTools` with `{ stop_reason: 'end_turn', content: [text] }`, which
 * `parseOpenFrameIntakeResult` rejects as `invalid_output` — so that suite
 * always measures the FAIL-SAFE, never the model's judgement. Its green is
 * real and says nothing about the case that matters.
 *
 * Measured across the three reachable classifier verdicts, BEFORE this file's
 * accompanying fix:
 *
 *   invalid (what the landed corpus produces) →  0/17 draft   (fail-safe holds)
 *   continue_conversation                     →  0/17 draft
 *   start_model                               → 17/17 DRAFT + auto-run
 *
 * ROADMAP 2.715's protected class therefore went from enforced-by-construction
 * to contingent-on-a-classifier, and no test in the repository could see the
 * reopening — the mock cannot produce the verdict that reopens it.
 *
 * ⭐ THE ASYMMETRY THIS FILE PINS. #1110 kept the deterministic YES path
 * (`isDraftGraphShape` short-circuits before the classifier is consulted — a
 * genuine decision brief costs ZERO extra LLM calls) and removed the
 * deterministic NO path. The fix restores the NO: a deterministic
 * protected-class pre-filter ahead of the classifier, so 2.715 keeps a FLOOR
 * and #1110 keeps its judgement above it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INSTRUMENT DISCIPLINE
 *  - `chatWithTools` is shared by the intake classifier AND by TurnExecutor's
 *    conversational answer. The arming binds by the PRODUCTION tool name
 *    imported from the producer (trap 19 — identity, never a value predicate
 *    another call could satisfy), so arming the router cannot silently rewrite
 *    the conversation reply, and the two are counted separately.
 *  - An INSTRUMENT test proves the armed verdict actually REACHES the route
 *    before any protected-class assertion reads it. Without it, "17 did not
 *    draft" is equally consistent with a classifier that was never armed
 *    (trap 13 — an absence assertion needs a positive control).
 *  - A DISCRIMINATING CONTROL — a broad strategic challenge that is NOT in the
 *    protected class — must STILL draft under `start_model` in the same run.
 *    All seventeen returning one verdict is the shape that hides a blind
 *    instrument (trap 20); the control is the probe whose expected answer
 *    DIFFERS, and it is what proves the pre-filter is bound to the protected
 *    class rather than blanket-refusing the classifier's judgement.
 *  - The corpus is IMPORTED from the single source, never retyped (trap 12).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';
import {
  CAPTURED_QUESTIONS,
  GENUINE_INTERROGATIVE_BRIEFS,
  INV_Q_PROTECTED_CLASS,
} from '../../schemas/__tests__/fixtures/inv-q-protected-class.js';
// NOTE: `open-frame-intake.js` is imported DYNAMICALLY below, after the mock
// factories are registered. A static import here pulls `adapters/llm/router.js`
// into the graph before `chatWithToolsMock` is initialised, and `vi.mock`'s
// hoisting then throws at collection (measured: "Cannot access
// 'chatWithToolsMock' before initialization", 0 tests collected).

const dispatchDraftGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));


const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => false,
    countTurns: async () => 0,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

/**
 * The three reachable classifier verdicts. `invalid` reproduces exactly what
 * the landed corpus's mock emits (text + `end_turn`), which the producer's
 * `parseOpenFrameIntakeResult` rejects.
 */
type IntakeArm = 'start_model' | 'continue_conversation' | 'invalid';
const INTAKE_ARMS: readonly IntakeArm[] = ['invalid', 'continue_conversation', 'start_model'];

let armedVerdict: IntakeArm = 'invalid';
let intakeCallCount = 0;
let conversationCallCount = 0;

/**
 * Bind by the PRODUCTION tool name, never by call ordinal or argument shape.
 * Populated by the dynamic import below and asserted non-empty in the
 * INSTRUMENT test — an empty name would make every call read as "not intake"
 * and manufacture a perfect false pass (trap 13).
 */
let intakeToolName = '';
function isIntakeCall(args: any): boolean {
  return (args?.tools ?? []).some((t: any) => t?.name === intakeToolName);
}

const chatWithToolsMock = vi.fn().mockImplementation(async (args: any) => {
  if (isIntakeCall(args)) {
    intakeCallCount += 1;
    if (armedVerdict === 'invalid') {
      return {
        content: [{ type: 'text', text: 'A conversational answer from the assistant.' }],
        stop_reason: 'end_turn',
        model: 'test-model',
        latencyMs: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }
    return {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_intake',
          name: intakeToolName,
          input: { route: armedVerdict },
        },
      ],
      stop_reason: 'tool_use',
      model: 'test-model',
      latencyMs: 1,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
  conversationCallCount += 1;
  return {
    content: [{ type: 'text', text: 'A conversational answer from the assistant.' }],
    stop_reason: 'end_turn',
    model: 'test-model',
    latencyMs: 1,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
});

// The adapter object is built INSIDE each accessor, not once in the factory
// body: `vi.mock` factories are hoisted above `chatWithToolsMock`'s
// initialisation, so an eagerly-built adapter throws at collection.
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2, DRAFT_OFFER_CHIP_LABEL } = await import('../route-v2.js');
({ OPEN_FRAME_INTAKE_TOOL_NAME: intakeToolName } = await import(
  '../../orchestrator-v5/routing/open-frame-intake.js'
));

const SCENARIO_ID = '2715b6b6-2715-4715-8715-271527152715';
const DRAFT_MARKER = 'S10_DRAFT_DISPATCH_FIRED';

/**
 * ⭐ THE DISCRIMINATING CONTROL. A broad strategic challenge with no discrete
 * decision question — exactly what #1110 exists to accept. It is NOT in the
 * protected class and it is NOT `isDraftShapedText` (no decision verb, no
 * trailing `?`), so it reaches the classifier and can only draft BECAUSE the
 * classifier said `start_model`. If the pre-filter were a blanket refusal
 * rather than a class-bound one, this case goes red and #1110's whole value is
 * gone.
 */
const CONTROL_OPEN_CHALLENGE =
  'Our enterprise renewal rates have been sliding for three quarters and leadership disagrees about why.';

/** Case 3 — the deterministic decision fast path, which must never pay for a classifier call. */
const CASE_3_DECISION = 'Should we expand into the US this year?';

/**
 * ⚠⚠ THE KNOWN-UNFLOORED SET — THE HONEST GAP, ENUMERATED AND ENFORCED.
 *
 * The deterministic floor requires BOTH `isQuestionToAssistant` (interrogative,
 * no decision verb) AND `mentionsAssistantSubject` ("you" / "Olumi"). The
 * second conjunct is not optional: without it the floor also refuses PR
 * #1110's own acceptance prompts ("Why are enterprise customers not
 * converting?"), which is the harm #1110 exists to remove — measured
 * 2026-08-26 at +9 regressions, 8 of them in #1110's own suite.
 *
 * These FIVE protected prompts name a workspace ARTEFACT rather than the
 * assistant, so the floor does not reach them and they remain contingent on
 * the classifier's verdict. Separating them from business-domain questions
 * needs a referent vocabulary, which would be a second hand-maintained mirror
 * beside `process-meta-intake.ts`'s already-acknowledged one. The durable fix
 * is a widened `isProcessMetaIntake` — rowed, not done in passing.
 *
 * ⭐ THE POINT OF WRITING THEM DOWN: a gap recorded in the suite is honest; a
 * gap invisible to it is exactly how this class was lost. The pin below asserts
 * the measured set equals this list EXACTLY — it REDs if the gap GROWS (the
 * floor thinned) and equally if it SHRINKS (the floor improved and this list
 * is now stale). Neither direction may pass silently.
 *
 * Entries are REFERENCED from the single-source fixture, never retyped; the
 * trailing comments are annotations, and an index drift would be caught by the
 * behavioural pin itself rather than trusted.
 */
const KNOWN_UNFLOORED: readonly string[] = [
  CAPTURED_QUESTIONS[0]!, // What assumption matters most, and why?
  CAPTURED_QUESTIONS[1]!, // What risks and upsides am I missing from my model?
  CAPTURED_QUESTIONS[2]!, // Is this the right question for me to be asking here?
  CAPTURED_QUESTIONS[3]!, // What should I be checking before I run this?
  CAPTURED_QUESTIONS[9]!, // What does the confidence interval on that edge mean?
];

/** The twelve the deterministic floor DOES reach. */
const FLOORED_PROTECTED: readonly string[] = INV_Q_PROTECTED_CLASS.filter(
  (message) => !KNOWN_UNFLOORED.includes(message),
);

let priorTraceFlag: string | undefined;
let turnCounter = 0;

function nextTurnId(): string {
  turnCounter += 1;
  return `27150001-2715-4715-8715-${String(turnCounter).padStart(12, '0')}`;
}

async function turn(app: FastifyInstance, message: string, source: string = 'composer') {
  dispatchDraftGraphMock.mockReset();
  appendMock.mockClear();
  chatWithToolsMock.mockClear();
  intakeCallCount = 0;
  conversationCallCount = 0;

  dispatchDraftGraphMock.mockResolvedValue({
    response: {
      response_version: 2 as const,
      assistant_text: DRAFT_MARKER,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
    graph: { nodes: [], edges: [] },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: nextTurnId(),
      scenario_id: SCENARIO_ID,
      stage: 'frame',
      message,
      turn_class: 'frame',
      source,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function exitPath(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.exit_path;
}

function committedDraftOfferPending(): Record<string, any> | undefined {
  return appendMock.mock.calls
    .flatMap((c: any) => c?.[0]?.pending_actions ?? [])
    .find((p: any) => p?.action?.kind === 'draft_graph');
}

describe('ROADMAP 2.715 holds with the open-frame classifier ARMED', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
    _resetConfigCache();
  });

  beforeEach(() => {
    armedVerdict = 'invalid';
  });

  /**
   * ⭐ THE FLOOR'S PRECONDITION, PINNED IN-TEST (trap 13b).
   *
   * The pre-filter is not a string list — it reuses `isQuestionToAssistant`,
   * the existing ROADMAP 2.715 semantic authority that already gates
   * `isDraftShapedText`. That reuse is only sound if the predicate actually
   * partitions this corpus, so the partition is asserted here rather than
   * assumed. If the predicate ever stops covering the class, THIS goes red and
   * names the message — instead of the floor silently thinning while the
   * route-level assertions still pass for some other reason.
   */
  describe('PRECONDITION: the floor predicate partitions the corpus', () => {
    it('conjunct 1 (`isQuestionToAssistant`) covers all 17 and NO genuine brief', async () => {
      const { isQuestionToAssistant } = await import('../../schemas/assist.js');

      for (const message of INV_Q_PROTECTED_CLASS) {
        expect(isQuestionToAssistant(message), `protected: ${message}`).toBe(true);
      }
      for (const message of GENUINE_INTERROGATIVE_BRIEFS) {
        expect(isQuestionToAssistant(message), `genuine: ${message}`).toBe(false);
      }
      expect(isQuestionToAssistant(CASE_3_DECISION), 'case 3').toBe(false);
    });

    /**
     * ⭐ THE CONJUNCT THAT PROTECTS #1110. `isQuestionToAssistant` is TRUE of a
     * broad strategic challenge phrased as a question — so on its own it is a
     * drafting floor that refuses this PR's own acceptance prompts. This pins
     * WHY the second conjunct exists, with the opposite-direction twin in the
     * same test (trap 22b): the referent test must be FALSE for the broad
     * challenge and TRUE for the twelve.
     */
    it('conjunct 2 (`mentionsAssistantSubject`) is what spares the broad strategic challenge', async () => {
      const { isQuestionToAssistant, mentionsAssistantSubject } = await import(
        '../../schemas/assist.js'
      );

      expect(
        isQuestionToAssistant(CONTROL_OPEN_CHALLENGE),
        'sanity: the broad challenge is not decision-verb-shaped either',
      ).toBe(false);

      for (const message of FLOORED_PROTECTED) {
        expect(mentionsAssistantSubject(message), `floored: ${message}`).toBe(true);
      }
      for (const message of KNOWN_UNFLOORED) {
        expect(
          mentionsAssistantSubject(message),
          `KNOWN-UNFLOORED names no assistant subject: ${message}`,
        ).toBe(false);
      }
      for (const message of GENUINE_INTERROGATIVE_BRIEFS) {
        expect(mentionsAssistantSubject(message), `genuine: ${message}`).toBe(false);
      }
    });
  });

  // ── INSTRUMENT FIRST — prove the arming reaches the route ─────────────────

  describe('INSTRUMENT: the armed verdict actually reaches the route', () => {
    it('the intake tool name resolved — the arming binds to a real production identity', () => {
      expect(
        intakeToolName,
        'an empty binding makes every call read as "not intake" and fakes a perfect pass',
      ).toBe('olumi_route_open_frame_intake');
    });

    it('a NON-protected open challenge reaches the classifier and drafts on `start_model`', async () => {
      armedVerdict = 'start_model';
      const { body } = await turn(app, CONTROL_OPEN_CHALLENGE);

      expect(
        intakeCallCount,
        'the classifier must be consulted — otherwise every protected-class verdict below is measuring a classifier that never ran',
      ).toBe(1);
      expect(exitPath(body)).toBe('draft_graph');
      expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    });

    it('the same challenge does NOT draft on `continue_conversation` — the arming is what moves it', async () => {
      armedVerdict = 'continue_conversation';
      const { body } = await turn(app, CONTROL_OPEN_CHALLENGE);

      expect(intakeCallCount).toBe(1);
      expect(exitPath(body)).not.toBe('draft_graph');
      expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    });
  });

  // ── ACCEPTANCE 1 — the floor, under the verdict that reopens the defect ───

  describe('ACCEPTANCE 1: with the classifier armed to `start_model`, the floored class never drafts', () => {
    it.each(FLOORED_PROTECTED)('is not modelled as a decision: %s', async (message) => {
      armedVerdict = 'start_model';
      const { status, body } = await turn(app, message);

      expect(status).toBe(200);
      expect(dispatchDraftGraphMock, 'no model may be built for a meta-question').not.toHaveBeenCalled();
      expect(exitPath(body)).not.toBe('draft_graph');
      expect(String(body.assistant_text ?? '')).not.toContain(DRAFT_MARKER);
    });
  });

  /**
   * ⭐⭐ THE GAP PIN. Measured behaviour vs the declared KNOWN-UNFLOORED list,
   * as an EXACT set equality. This is the difference between an honest partial
   * floor and guarantee theatre: the five are not merely absent from the
   * assertions above, they are named here and enforced in BOTH directions.
   */
  describe('the KNOWN-UNFLOORED gap is exactly what it claims to be', () => {
    it('the set of protected prompts that still draft on `start_model` equals KNOWN_UNFLOORED exactly', async () => {
      const stillDrafts: string[] = [];
      for (const message of INV_Q_PROTECTED_CLASS) {
        armedVerdict = 'start_model';
        await turn(app, message);
        if (dispatchDraftGraphMock.mock.calls.length > 0) stillDrafts.push(message);
      }

      expect(
        [...stillDrafts].sort(),
        'RED if the gap GREW (floor thinned) or SHRANK (floor improved, list now stale) — neither may pass silently',
      ).toEqual([...KNOWN_UNFLOORED].sort());
    });

    it('KNOWN_UNFLOORED is a real subset of the protected class, sized 5 of 17', () => {
      expect(KNOWN_UNFLOORED).toHaveLength(5);
      expect(new Set(KNOWN_UNFLOORED).size).toBe(5);
      expect(FLOORED_PROTECTED).toHaveLength(12);
      for (const message of KNOWN_UNFLOORED) {
        expect(INV_Q_PROTECTED_CLASS, `not a member of the class: ${message}`).toContain(message);
      }
    });
  });

  describe('the floor holds under every reachable classifier verdict, not just the armed one', () => {
    for (const arm of INTAKE_ARMS) {
      it(`no floored prompt drafts when the classifier returns \`${arm}\``, async () => {
        for (const message of FLOORED_PROTECTED) {
          armedVerdict = arm;
          const { body } = await turn(app, message);
          expect(exitPath(body), `arm=${arm} message=${message}`).not.toBe('draft_graph');
          expect(dispatchDraftGraphMock, `arm=${arm} message=${message}`).not.toHaveBeenCalled();
        }
      });
    }
  });

  // ── ACCEPTANCE 3 — the conversational answer survives ─────────────────────

  describe('ACCEPTANCE 3: the 17 get a conversational answer, not the restored canned deflection', () => {
    it.each(INV_Q_PROTECTED_CLASS)(
      'does not fall back to `frame_no_brief_guard`: %s',
      async (message) => {
        armedVerdict = 'start_model';
        const { body } = await turn(app, message);

        expect(
          exitPath(body),
          "#1110's improvement must survive the floor — the floor blocks DRAFTING, not ANSWERING",
        ).not.toBe('frame_no_brief_guard');
      },
    );

    /**
     * ⭐ THE POSITIVE HALF. "Not the canned guard" is an ABSENCE claim, and an
     * absence is consistent with answering nothing at all. This asserts a real
     * conversational answer was actually PRODUCED for every floored prompt —
     * TurnExecutor reached the adapter — so the floor is demonstrably a
     * redirect to conversation rather than a silent drop.
     */
    it.each(FLOORED_PROTECTED)('produces a real conversational answer: %s', async (message) => {
      armedVerdict = 'start_model';
      await turn(app, message);

      expect(
        conversationCallCount,
        'the floor must route to an ANSWER, not to silence',
      ).toBeGreaterThanOrEqual(1);
      expect(intakeCallCount, 'and it must do so without a classifier call').toBe(0);
    });
  });

  // ── ACCEPTANCE 4 — #1110's seed-leak closure is not regressed ─────────────

  describe('ACCEPTANCE 4: the 2.715 seed leak stays closed', () => {
    it.each(INV_Q_PROTECTED_CLASS)(
      'commits no draft_graph pending seeded with the protected question: %s',
      async (message) => {
        armedVerdict = 'start_model';
        const { body } = await turn(app, message);

        const pending = committedDraftOfferPending();
        expect(
          pending?.action?.brief_seed,
          'the old guard persisted the protected question verbatim as a one-tap brief_seed',
        ).not.toBe(message);
        const chips = (body.suggested_actions ?? []) as Array<Record<string, any>>;
        expect(chips.find((c) => c.label === DRAFT_OFFER_CHIP_LABEL)).toBeUndefined();
      },
    );
  });

  // ── ACCEPTANCE 2 — genuine briefs keep drafting at ZERO extra cost ────────

  describe('ACCEPTANCE 2: genuine decision briefs draft with ZERO classifier calls, in every arm', () => {
    for (const arm of INTAKE_ARMS) {
      it(`case 3 drafts with no classifier call — arm \`${arm}\``, async () => {
        armedVerdict = arm;
        const { body } = await turn(app, CASE_3_DECISION);

        expect(exitPath(body)).toBe('draft_graph');
        expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
        expect(
          intakeCallCount,
          'the deterministic decision fast path must short-circuit BEFORE the classifier',
        ).toBe(0);
      });

      it(`all 7 genuine interrogative briefs draft with no classifier call — arm \`${arm}\``, async () => {
        for (const message of GENUINE_INTERROGATIVE_BRIEFS) {
          armedVerdict = arm;
          const { body } = await turn(app, message);
          expect(exitPath(body), `arm=${arm} message=${message}`).toBe('draft_graph');
          expect(dispatchDraftGraphMock, `arm=${arm} message=${message}`).toHaveBeenCalledTimes(1);
          expect(intakeCallCount, `arm=${arm} message=${message}`).toBe(0);
        }
      });
    }
  });

  // ── THE PRE-FILTER IS CLASS-BOUND, NOT A BLANKET REFUSAL ─────────────────

  describe('#1110 keeps its judgement above the floor', () => {
    it('a broad strategic challenge still drafts on `start_model` — the floor is bound to the protected class', async () => {
      armedVerdict = 'start_model';
      const { body } = await turn(app, CONTROL_OPEN_CHALLENGE);

      expect(exitPath(body)).toBe('draft_graph');
      expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
      expect(intakeCallCount).toBe(1);
    });

    /**
     * ⭐ THE SCOPE CONJUNCT, PINNED — added because a mutant survived without it.
     *
     * The floor is conjoined with `shouldConsiderOpenFrameIntake` so it can only
     * affect turns that would otherwise have reached the classifier. Dropping
     * that conjunct left every suite GREEN (measured), which means the
     * restraint was real but unenforced — and an unenforced restraint is one
     * tidy-up away from a silent widening (trap 22b: the defect lives in the
     * BREADTH of the predicate, not the invariant).
     *
     * `source: 'chip'` is outside the intake's scope, so the floor must NOT
     * fire and the pre-existing `frame_no_brief_guard` behaviour must survive
     * untouched. This is the one place the suite asserts the guard STILL fires
     * — everywhere else it asserts the opposite, which is exactly why the
     * discrimination is worth having.
     */
    it('does NOT reach outside the intake scope: a non-composer turn keeps its pre-existing guard', async () => {
      armedVerdict = 'start_model';
      const { body } = await turn(app, FLOORED_PROTECTED[0]!, 'chip');

      expect(
        exitPath(body),
        'the floor may only affect turns the classifier would otherwise have judged',
      ).toBe('frame_no_brief_guard');
      expect(intakeCallCount, 'a non-composer turn never consults the classifier').toBe(0);
    });

    it('a floored prompt never even reaches the classifier — the floor is DETERMINISTIC and costs no call', async () => {
      armedVerdict = 'start_model';
      await turn(app, FLOORED_PROTECTED[0]!);

      expect(
        intakeCallCount,
        'the pre-filter must sit AHEAD of the classifier, mirroring the decision fast path',
      ).toBe(0);
    });
  });
});
