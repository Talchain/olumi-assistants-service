/**
 * S6 / issue #1108 — INV-Q DEFLECTS TO NOWHERE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, observed on deployed staging:
 *
 *   USER:  How can I accelerate securing pre-seed investment for my startup?
 *   OLUMI: I need a single decision question to start. For example: …
 *   USER:  What's wrong with what I entered?
 *   OLUMI: (byte-identical string, again)
 *
 * Founder ruling: Olumi is a strategic reasoning enhancement system, not a
 * discrete-decision form. A broad strategic challenge is valid Core input.
 *
 * ⭐ WHY THE FIX IS ADDITIVE AND `isQuestionToAssistant` (INV-Q) IS UNTOUCHED.
 * INV-Q exists to stop the product's OWN coaching prompts being modelled as
 * decisions, and it genuinely discriminates. It is not wrong here — it is
 * RIGHT, and it deflects to nowhere: a complete manifest over CEE `src/`
 * (tests excluded) gives it exactly two lines, its definition
 * (`schemas/assist.ts`) and its single call site in `isDraftShapedText`.
 * There was no "question to the assistant" ANSWER branch at all, so a
 * correctly-classified question had nowhere to land except the canned
 * refusal. The classification is right; the destination was missing.
 *
 * ⭐⭐ THE MEASUREMENT THAT DECIDES THE DESTINATION (executed at
 * 5f2e3fd0 against the real predicates, contrast controls in the same run).
 * These four classes are BYTE-IDENTICAL on every predicate CEE computes —
 * `invQ=true, draftShaped=false, procMeta=false, briefRegex=true`:
 *
 *   (a) the strategic challenges this lane must admit
 *       ("Why are enterprise customers not converting?");
 *   (b) the conversational-repair turn ("What's wrong with what I entered?");
 *   (c) the eleven coaching prompts INV-Q was built to protect
 *       ("What assumption matters most, and why?");
 *   (d) the six assistant-subject cases from the A7 corpus.
 *
 * They occupy ONE CELL. No predicate over message text can admit (a) while
 * still refusing (c)/(d) — and any branch that DRAFTS from that cell would
 * draft from (b) and (c) too, which is precisely the defect INV-Q exists to
 * prevent. So the destination is NOT drafting. It is the reasoning layer:
 * the turn reaches `runTurnExecutor` and gets an ANSWER, which is correct for
 * all four classes at once. The architecture here is forced by that
 * measurement, not chosen.
 *
 * ⚠ THE OPPOSITE-DIRECTION TWINS ARE THE POINT OF THIS FILE (traps 22b/22f).
 * This seam has had four consecutive rounds where each fix opened the
 * opposite defect, so every direction below is pinned WITH its twin:
 *   §A  strategic challenges reach the reasoning layer      (the fix)
 *   §B  INV-Q's protected corpus still NEVER drafts          (twin of §A)
 *   §C  a genuine decision still drafts, untouched           (regression control)
 *   §D  the frame guard still claims what it was built for   (twin of §A)
 *
 * §B's invariant is written against the SPEC ("a question to the assistant is
 * never MODELLED as a decision"), not against the destination it used to
 * reach. Writing it as "still gets the guard copy" would have been an
 * invariant with the code's own blind spot: the protected corpus shares a
 * cell with the cases we are admitting, so a destination-shaped invariant
 * could only be satisfied by re-breaking the thing INV-Q protects.
 *
 * CORPUS PROVENANCE (trap 22 — outside this lane's head):
 *   - §A: the five founder-authored acceptance cases from issue #1108, plus
 *     the founder-observed repair turn, verbatim.
 *   - §B: `schemas/__tests__/question-to-assistant.test.ts`, verbatim — the
 *     eleven MEASURED captures from capture-semantics-derivation-2026-08-08
 *     and the A7 reviewer corpus. Not retyped from memory, and not extended.
 *   - §D: `route-v2-no-persisted-graph-fallthrough.test.ts`'s L56 measured
 *     dead ends, plus the pricing-brief retry fragment named in the guard's
 *     own docblock as the case it was built for.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../utils/telemetry.js';
import { _resetConfigCache } from '../../config/index.js';
import {
  DRAFT_GRAPH_MIN_BRIEF_LENGTH,
  isQuestionToAssistant,
  isDraftShapedText,
} from '../../schemas/assist.js';
import { isProcessMetaIntake } from '../../orchestrator-v5/routing/process-meta-intake.js';

/**
 * ⭐ THE THREE DESTINATIONS ARE MOCKED AT THEIR OWN BOUNDARIES, so every
 * assertion below binds to WHERE THE TURN WENT by identity (trap 19) rather
 * than inferring a destination from body copy:
 *
 *   draft dispatch   → `dispatchDraftGraphMock` called
 *   reasoning layer  → `runTurnExecutorMock` called
 *   the frame guard  → NEITHER called, and the guard copy is on the wire
 *
 * The three are mutually exclusive by construction, so "not the guard" and
 * "reached the reasoning layer" are separately observable — a single negative
 * assertion could be satisfied by any other exit and would prove nothing.
 */
const dispatchDraftGraphMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

const runTurnExecutorMock = vi.fn();
vi.mock('../../orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../../../tests/utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () => createMockSessionStore({ append: appendMock }),
    resetSessionStoreForTests: () => {},
  };
});

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

/** A minimal successful TurnExecutor run, shaped from the route's own reads. */
function mkRun(assistantText: string) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: assistantText,
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    analysisReady: null,
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

const { ceeOrchestratorRouteV2, DRAFT_OFFER_CHIP_LABEL } = await import('../route-v2.js');
const { FRAME_NO_BRIEF_ASSISTANT_TEXT } = await import(
  '../../orchestrator-v5/routing/frame-no-brief.js'
);

const SCENARIO_ID = '23880000-2388-4388-8388-238823882388';

/** The guard's opening clause — imported from the producer, never retyped (trap 12). */
const FRAME_GUARD_COPY = FRAME_NO_BRIEF_ASSISTANT_TEXT.slice(0, 42);

// ── §A corpus: the founder's acceptance cases, verbatim from issue #1108 ────
const STRATEGIC_CHALLENGES: readonly string[] = [
  'How can I accelerate securing pre-seed investment for my startup?',
  'Why are enterprise customers not converting?',
  'What are we not thinking about?',
];
/** The founder-observed repair turn — must be explained, never replayed at. */
const REPAIR_TURN = "What's wrong with what I entered?";

/** §C — the REGRESSION CONTROL. A genuine decision must still behave as one. */
const GENUINE_DECISION = 'Should we expand into the US this year?';

// ── §B corpus: verbatim from schemas/__tests__/question-to-assistant.test.ts ─
const INV_Q_PROTECTED: readonly string[] = [
  'What assumption matters most, and why?',
  'What risks and upsides am I missing from my model?',
  'Is this the right question for me to be asking here?',
  'What should I be checking before I run this?',
  'Can you take the outside view on this one, what do base rates suggest?',
  'Could you run a pre-mortem with me on this decision?',
  'How confident are you in the estimate you used for churn?',
  'Where do you and I differ on this, and why?',
  'Can you explain what the simulation actually does here?',
  'What does the confidence interval on that edge mean?',
  'Why did you pick 0.4 for that coefficient?',
  'How do you decide which factors matter in the analysis?',
  'How does Olumi decide which options to include?',
  'Would you still choose to invest in this option?',
  'Could Olumi choose the best option for us automatically?',
  'Will you launch the analysis for me once the model is ready?',
  'Did you decide the baseline values yourself when drafting?',
];

// ── §D corpus: what the guard was actually built for ───────────────────────
const GUARD_STILL_CLAIMS: readonly string[] = [
  // The pricing-brief retry fragment, from the guard's own docblock.
  'no status quo, just three options',
  // L56 measured dead ends (route-v2-no-persisted-graph-fallthrough.test.ts).
  'Increase annual revenue from £4 million today to £6 million within 12 months.',
  'We need to reduce churn to under 5% this year.',
  'Raise the price from £49 to £59.',
];

/**
 * §E — THE SHORT-END TWIN, and it is here because it BIT.
 *
 * The first cut of this branch was bounded only by "is it a question", and it
 * captured `"can you?"` from the retired-A1/A2 fixture pins in
 * `tests/integration/orchestrator/route-v2-frame-no-brief-guard.test.ts`. A
 * contentless interrogative fragment is not a strategic challenge, and paying
 * a broad LLM call for one is precisely the cost the guard exists to avoid.
 *
 * These are interrogative AND INV-Q-true AND below the product's existing
 * brief-length floor, so they are the exact shape that separates "a question
 * with something in it" from "a question with nothing in it". Verbatim from
 * that integration file and from the readiness-intake pins — not invented
 * here, which is the point: this lane's own corpus did not contain them.
 */
const SHORT_INTERROGATIVE_FRAGMENTS: readonly string[] = [
  'can you?',
  'ready?',
  'am i ready?',
];

let events: Array<{ name: string; data: Record<string, unknown> }> = [];
let priorTraceFlag: string | undefined;

function turnBody(message: string) {
  return {
    kind: 'message',
    turn_id: '23881111-2388-4388-8388-238823881111',
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message,
    source: 'composer',
  };
}

async function turn(app: FastifyInstance, message: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: turnBody(message),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function exitPath(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.exit_path;
}

describe('S6 #1108 — a strategic question reaches the reasoning layer, not a canned refusal', () => {
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
    setTestSink(null);
  });

  beforeEach(() => {
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data: data as Record<string, unknown> });
    });
    dispatchDraftGraphMock.mockReset();
    dispatchDraftGraphMock.mockResolvedValue(undefined);
    runTurnExecutorMock.mockReset();
    runTurnExecutorMock.mockResolvedValue(mkRun('reasoning-layer reply'));
    appendMock.mockClear();
  });

  // ── INSTRUMENT FIRST — an unmeasurable assertion is a vacuous one ─────────

  describe('INSTRUMENT', () => {
    it('`_diagnostic_trace.exit_path` is on the wire (every assertion below reads it)', async () => {
      const { body } = await turn(app, GUARD_STILL_CLAIMS[0]!);
      expect(exitPath(body)).toBeDefined();
    });

    it('the guard copy constant is non-empty and comes from the PRODUCER', () => {
      expect(FRAME_GUARD_COPY.length).toBeGreaterThan(20);
      expect(FRAME_NO_BRIEF_ASSISTANT_TEXT).toContain(FRAME_GUARD_COPY);
    });

    it('PRECONDITION — every §A case really does sit in INV-Q\'s cell, so this '
      + 'file is testing the class it claims to test', () => {
      for (const m of [...STRATEGIC_CHALLENGES, REPAIR_TURN]) {
        expect(isQuestionToAssistant(m), m).toBe(true);
        expect(isDraftShapedText(m), m).toBe(false);
        expect(isProcessMetaIntake(m), m).toBe(false);
      }
    });

    it('PRECONDITION — §B\'s protected corpus sits in the SAME cell as §A. This is '
      + 'the collision that forces the destination to be an answer, not a draft', () => {
      for (const m of INV_Q_PROTECTED) {
        expect(isQuestionToAssistant(m), m).toBe(true);
        expect(isProcessMetaIntake(m), m).toBe(false);
      }
      expect(INV_Q_PROTECTED).toHaveLength(17);
    });

    it('DISCRIMINATION CONTROL — the corpora are not all the same input class '
      + '(a blind instrument would agree with itself everywhere)', () => {
      expect(isQuestionToAssistant(GENUINE_DECISION)).toBe(false);
      expect(isDraftShapedText(GENUINE_DECISION)).toBe(true);
      expect(isQuestionToAssistant(GUARD_STILL_CLAIMS[0]!)).toBe(false);
      expect(isDraftShapedText(GUARD_STILL_CLAIMS[0]!)).toBe(false);
    });
  });

  // ── §A — THE FIX ─────────────────────────────────────────────────────────

  describe('§A a broad strategic challenge reaches the reasoning layer', () => {
    it.each(STRATEGIC_CHALLENGES)('is not refused: %s', async (message) => {
      const { body } = await turn(app, message);

      expect(
        exitPath(body),
        'a genuine strategic challenge must not exit through the no-brief guard',
      ).not.toBe('frame_no_brief_guard');
      expect(
        body.assistant_text ?? '',
        'the canned refusal must be gone from this turn entirely',
      ).not.toContain(FRAME_GUARD_COPY);
      expect(
        runTurnExecutorMock,
        'reaching the reasoning layer IS the fix — bound to the executor call by '
          + 'identity, never inferred from the body copy',
      ).toHaveBeenCalled();
    });

    it('the founder\'s repair turn is answered, never replayed at', async () => {
      const { body } = await turn(app, REPAIR_TURN);

      expect(exitPath(body)).not.toBe('frame_no_brief_guard');
      expect(
        body.assistant_text ?? '',
        'replaying the guard byte-identically is the observed defect',
      ).not.toContain(FRAME_GUARD_COPY);
      expect(runTurnExecutorMock).toHaveBeenCalled();
    });
  });

  // ── §B — THE OPPOSITE-DIRECTION TWIN ─────────────────────────────────────

  describe('§B INV-Q\'s protected corpus still never gets MODELLED as a decision', () => {
    /**
     * THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE DESTINATION. INV-Q's
     * protection is "a question to the assistant is never MODELLED as a
     * decision" — NOT "it lands on the frame guard". Writing it the second way
     * would be an invariant carrying the code's own blind spot: §B shares a
     * predicate cell with §A, so a destination-shaped invariant could only be
     * satisfied by re-breaking what INV-Q protects. This assertion must hold
     * both BEFORE and AFTER the change, and it does.
     */
    it.each(INV_Q_PROTECTED)('is never drafted from: %s', async (message) => {
      await turn(app, message);
      expect(
        dispatchDraftGraphMock,
        'a question to the assistant must never open a draft dispatch',
      ).not.toHaveBeenCalled();
    });

    /**
     * ⚠ A PRE-EXISTING GAP, MEASURED AT PRISTINE AND RECORDED RATHER THAN
     * HIDDEN (trap 22f's known-set discipline). At `5f2e3fd0`, ALL 17
     * protected questions were answered by the frame guard AND handed a
     * one-tap "Build the model" chip seeded with the question itself — the
     * "poisoned brief one tap later" defect `process-meta-intake.ts` names, in
     * the very corpus INV-Q exists to protect. INV-Q stopped the AUTO-draft;
     * nothing stopped the offer.
     *
     * Routing this cell to the reasoning layer removes the offer as a side
     * effect. This test pins that as an IMPROVEMENT this change delivers, not
     * as a property it preserved — it was RED at pristine for all 17.
     */
    it.each(INV_Q_PROTECTED)('is no longer handed a one-tap draft offer: %s', async (message) => {
      const { body } = await turn(app, message);
      expect(
        ((body.suggested_actions ?? []) as Array<Record<string, unknown>>).map((a) => a.label),
      ).not.toContain(DRAFT_OFFER_CHIP_LABEL);
    });

    it('the predicate itself is UNCHANGED — this lane weakened nothing', () => {
      for (const m of INV_Q_PROTECTED) {
        expect(isQuestionToAssistant(m), m).toBe(true);
        expect(isDraftShapedText(m), m).toBe(false);
      }
    });
  });

  // ── §C — THE REGRESSION CONTROL (hard constraint) ────────────────────────

  describe('§C a genuine decision still behaves as a decision', () => {
    it('CASE 3 CONTROL: "Should we expand into the US this year?" still dispatches '
      + 'to draft_graph — never the guard, never the new branch', async () => {
      const { body } = await turn(app, GENUINE_DECISION);

      expect(
        dispatchDraftGraphMock,
        'generalising Olumi must not degrade decision reasoning — hard constraint',
      ).toHaveBeenCalled();
      expect(
        runTurnExecutorMock,
        'a genuine decision must NOT be diverted into the new question branch',
      ).not.toHaveBeenCalled();
      expect(body.assistant_text ?? '').not.toContain(FRAME_GUARD_COPY);
    });

    it('CASE 3 CONTROL: its predicate posture is untouched by this lane', () => {
      expect(isQuestionToAssistant(GENUINE_DECISION)).toBe(false);
      expect(isDraftShapedText(GENUINE_DECISION)).toBe(true);
      expect(isProcessMetaIntake(GENUINE_DECISION)).toBe(false);
    });
  });

  // ── §D — THE OTHER TWIN: the guard still exists and still claims its case ─

  describe('§D the frame guard still claims what it was built for', () => {
    it.each(GUARD_STILL_CLAIMS)('still gets the deterministic guard: %s', async (message) => {
      const { status, body } = await turn(app, message);

      expect(status).toBe(200);
      expect(
        exitPath(body),
        'the guard is narrowed by INV-Q only — non-question text is untouched',
      ).toBe('frame_no_brief_guard');
      expect(body.assistant_text).toContain(FRAME_GUARD_COPY);
    });

    it('the guard\'s turns remain deterministic — neither the drafter nor the '
      + 'reasoning layer is paid for', async () => {
      await turn(app, GUARD_STILL_CLAIMS[0]!);
      expect(runTurnExecutorMock).not.toHaveBeenCalled();
      expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    });
  });

  // ── §E — THE SHORT-END TWIN (this one bit; see the corpus note) ──────────

  describe('§E a contentless interrogative fragment stays with the guard', () => {
    it.each(SHORT_INTERROGATIVE_FRAGMENTS)(
      'does not buy a broad LLM call: %s',
      async (message) => {
        const { body } = await turn(app, message);

        expect(
          runTurnExecutorMock,
          '"is it a question" alone was too wide — a question with nothing in it '
            + 'is what the guard is FOR',
        ).not.toHaveBeenCalled();
        expect(body.assistant_text ?? '').toContain(FRAME_GUARD_COPY);
      },
    );

    it('PRECONDITION — these really are below the floor while §A is above it, '
      + 'so this section discriminates on the term it names', () => {
      for (const m of SHORT_INTERROGATIVE_FRAGMENTS) {
        expect(m.length, m).toBeLessThan(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
      }
      for (const m of [...STRATEGIC_CHALLENGES, REPAIR_TURN]) {
        expect(m.length, m).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
      }
    });

    it('the floor is the PRODUCT\'S existing constant, not one invented here', () => {
      expect(DRAFT_GRAPH_MIN_BRIEF_LENGTH).toBe(30);
    });
  });
});
