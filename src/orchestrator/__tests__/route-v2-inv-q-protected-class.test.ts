/**
 * INV-Q (ROADMAP 2.715) AT THE ROUTING LAYER — the protected class's first
 * route-level guard.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PINS, AND WHY IT IS NOT A REGRESSION TEST
 *
 * ROADMAP 2.715 protects 17 specific messages from being modelled as
 * decisions. Until now that class had coverage at the PREDICATE layer only
 * (`src/schemas/__tests__/question-to-assistant.test.ts` — `isDraftShapedText`
 * / `isQuestionToAssistant` / `isProcessMetaIntake` in isolation). Two of the
 * seventeen also appear incidentally in route-level suites:
 *
 *   - "What assumption matters most, and why?" — route-v2-draft-loss-p0
 *     .test.ts (which carries an explicit `2.715:` case), and
 *   - "How do you decide which factors matter in the analysis?" —
 *     tests/integration/orchestrator/route-v2-draft-first-intake.test.ts.
 *
 * The other FIFTEEN had no route-level assertion of any kind. Measured
 * repo-wide at `013d1cf9` by exact-string sweep, with a contrast control
 * proving the sweep reached the routing suites (50 files under
 * tests/integration/orchestrator/, 116 under src/orchestrator-v5/routing/
 * __tests__/). ⚠ A SUBSTRING sweep gives the wrong answer here: the product's
 * own coaching copy "Run a pre-mortem with me: imagine this choice failed a
 * year from now. What went wrong?" is a DIFFERENT string from the class's
 * typed paraphrase "Could you run a pre-mortem with me on this decision?" —
 * and it is precisely that gap between the exact-string mirror and the
 * paraphrase that 2.715 exists to close.
 *
 * This file PINS CURRENT BEHAVIOUR. Every case below passes at the tip it was
 * written against. That is the point, not a weakness: the class is now
 * anchored at the routing layer, so any future change to it becomes a
 * conscious, reasoned update rather than a silent drift. The evidence that
 * these assertions BITE is a discriminating mutant, recorded in the PR body —
 * RED-first is inapplicable to a behaviour-pinning corpus, so the mutant is
 * the only evidence available and it is not optional.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ UPDATED 2026-08-26 — THE FRAME BELOW DESCRIBED THE PRE-INTAKE TIP AND IS
 * NO LONGER CURRENT. WHAT CHANGED, AND WHAT THIS FILE NOW PINS:
 *
 *   - the seventeen no longer reach `frame_no_brief_guard`; they reach
 *     `turn_executor` and get a real conversational ANSWER instead of the
 *     canned "I need a single decision question" deflection;
 *   - the seed leak described below is CLOSED for all seventeen (the chip that
 *     carried it is gone), and the block that pinned it now asserts its
 *     ABSENCE;
 *   - "no LLM call" no longer holds for every case: the empty-workspace intake
 *     classifier is consulted for the five prompts the deterministic floor
 *     does not reach.
 *
 * ⚠ THIS SUITE CANNOT SEE THE CASE THAT MATTERS MOST. Its adapter mock returns
 * text + `end_turn`, which the intake producer rejects as `invalid_output`, so
 * every case here measures the FAIL-SAFE rather than the classifier's
 * judgement. The armed corpus —
 * `route-v2-inv-q-protected-class-armed.test.ts` — drives all three verdicts
 * and carries the KNOWN-UNFLOORED pin. Read the two together; neither is
 * sufficient alone.
 *
 * The superseded frame, kept because it records what was true when written:
 *
 * Measured at that tip: all seventeen reach `frame_no_brief_guard` and build
 * NOTHING on the turn — no draft dispatch, no auto-run, no LLM call. But the
 * guard also seeds a one-tap "Build the model" chip whose PERSISTED
 * `brief_seed` is THE PROTECTED QUESTION ITSELF. One tap therefore models the
 * meta-question — the exact defect 2.715 exists to prevent, one click away.
 *
 * ⭐ THE MECHANISM, named because it is a differently-named-twin defect (the
 * estate's chronic class — cf. the two `generateGraphHash` twins):
 *
 *   - `deriveBriefTextSeed` (src/orchestrator-v5/session/derive-brief-seed.ts
 *     :118) REFUSES any trailing-`?` message outright, with the comment "A
 *     permanent first-write-wins field must not be claimable by any
 *     mid-conversation question". It implements the 2.715 principle.
 *   - `deriveDraftOfferSeed` (src/orchestrator/route-v2.ts:585) applies a
 *     length floor, a `chip_click` refusal and a self-replay refusal — and
 *     has NO trailing-`?` refusal at all. It does not.
 *
 * Two seed derivations, same purpose, different names, disagreeing on exactly
 * this class. The suite below pins BOTH the protection that is real and the
 * leak that is real. The leak case is recorded as CURRENT BEHAVIOUR, not
 * endorsed; if it is later closed, that case is the one that goes red and it
 * should be updated deliberately.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INSTRUMENT DISCIPLINE
 *  - The corpus is imported, never retyped (CLAUDE.md trap 12 — the
 *    hand-maintained mirror). It is single-sourced at
 *    `src/schemas/__tests__/fixtures/inv-q-protected-class.ts` and shared with
 *    the predicate suite, so a change to the class is a change in ONE place.
 *  - Chip identity binds to the PRODUCTION constants imported from
 *    `route-v2.ts`, never a retyped label (trap 19).
 *  - An INSTRUMENT test proves `_diagnostic_trace.exit_path` is actually on
 *    the wire before any exit assertion reads it — an unmeasurable assertion
 *    is a vacuous one (trap 13).
 *  - A DISCRIMINATING CONTROL (a genuine decision brief) must reach
 *    `draft_graph` in the same run. All seventeen returning an identical
 *    verdict is expected here, and uniformity is exactly the shape that hides
 *    a blind instrument (trap 20) — the control is the probe whose expected
 *    answer DIFFERS, and it is what makes the seventeen meaningful.
 *  - Opposite-direction twins (trap 22b): the genuine interrogative briefs
 *    must all STILL draft. A guard that only watches one door is how the
 *    precision bias gets violated silently.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';
import {
  A7_MUST_DEFLECT,
  CAPTURED_QUESTIONS,
  GENUINE_INTERROGATIVE_BRIEFS,
  INV_Q_PROTECTED_CLASS,
} from '../../schemas/__tests__/fixtures/inv-q-protected-class.js';

// ── Mocks: the seams that would reveal a `start_model`-shaped verdict ──────
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

const chatWithToolsMock = vi.fn().mockImplementation(async () => ({
  content: [{ type: 'text', text: 'A conversational answer from the assistant.' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
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

// Production constants — this file and the route cannot drift apart on chip
// copy (CLAUDE.md trap 12 / trap 19).
const { ceeOrchestratorRouteV2, DRAFT_OFFER_CHIP_LABEL, DRAFT_OFFER_CHIP_MESSAGE } = await import(
  '../route-v2.js'
);

const SCENARIO_ID = '2715a5a5-2715-4715-8715-271527152715';

/** The draft narrative the mocked dispatcher would emit if a draft ever fired. */
const DRAFT_MARKER = 'S10_DRAFT_DISPATCH_FIRED';

/**
 * A genuine decision brief. THE DISCRIMINATING CONTROL: if this does not reach
 * `draft_graph` in the same run, the seventeen verdicts below are measuring a
 * broken harness rather than the product (trap 20 — uniformity across inputs
 * that ought to differ is evidence about the instrument).
 */
const CONTROL_GENUINE_BRIEF =
  'Should we expand into Germany or double down on the UK for the next financial year?';

let priorTraceFlag: string | undefined;
let turnCounter = 0;

function nextTurnId(): string {
  turnCounter += 1;
  return `27150000-2715-4715-8715-${String(turnCounter).padStart(12, '0')}`;
}

function turnPayload(message: string) {
  return {
    kind: 'message',
    turn_id: nextTurnId(),
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    message,
    turn_class: 'frame',
    source: 'composer',
  };
}

async function turn(app: FastifyInstance, message: string) {
  dispatchDraftGraphMock.mockReset();
  chatWithToolsMock.mockClear();
  appendMock.mockClear();
  // If the route ever decides to draft, the dispatcher answers — so a draft is
  // observable as a call AND as a marker on the wire, not inferred from a body.
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
    payload: turnPayload(message),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function exitPath(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.exit_path;
}

/** The draft-offer pending the guard committed on this turn, if any. */
function committedDraftOfferPending(): Record<string, any> | undefined {
  return appendMock.mock.calls
    .flatMap((c: any) => c?.[0]?.pending_actions ?? [])
    .find((p: any) => p?.action?.kind === 'draft_graph');
}

describe('ROADMAP 2.715 at the routing layer — a question to the assistant is never modelled as a decision', () => {
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
    dispatchDraftGraphMock.mockReset();
    chatWithToolsMock.mockClear();
    appendMock.mockClear();
  });

  // ── INSTRUMENT FIRST — an unmeasurable assertion is a vacuous one ─────────

  it('INSTRUMENT: `_diagnostic_trace.exit_path` really is on the wire', async () => {
    const { body } = await turn(app, INV_Q_PROTECTED_CLASS[0]!);
    expect(
      exitPath(body),
      'the flag-gated trace is the surface every exit_path assertion below reads',
    ).toBeDefined();
  });

  // ── THE DISCRIMINATING CONTROL — it must reach a DIFFERENT verdict ────────

  it('CONTROL (discriminating): a genuine decision brief DOES reach draft_graph and dispatches a draft', async () => {
    const { status, body } = await turn(app, CONTROL_GENUINE_BRIEF);

    expect(status).toBe(200);
    expect(exitPath(body)).toBe('draft_graph');
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    expect(String(body.assistant_text ?? '')).toContain(DRAFT_MARKER);
  });

  // ── THE PROTECTED CLASS — all seventeen ──────────────────────────────────

  describe('the 17 protected prompts build nothing on the turn', () => {
    it.each(INV_Q_PROTECTED_CLASS)('is not modelled as a decision: %s', async (message) => {
      const { status, body } = await turn(app, message);

      expect(status).toBe(200);
      // ⚠ UPDATED DELIBERATELY (2026-08-26) — this asserted
      // `frame_no_brief_guard` when written. That guard was the CANNED
      // REJECTION ("I need a single decision question"), and removing it for
      // this class is the whole value of the open-frame intake work: the
      // seventeen now get a real conversational answer instead of a deflection.
      // The protection that matters — nothing is BUILT on the turn — is
      // unchanged and asserted below. This file's own header invited exactly
      // this update rather than absorbing it silently.
      expect(exitPath(body)).toBe('turn_executor');
      // No model was built for the meta-question.
      expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
      // And the draft narrative never reached the user.
      expect(String(body.assistant_text ?? '')).not.toContain(DRAFT_MARKER);
    });
  });

  /**
   * ⭐ THE LEAK IS CLOSED — UPDATED DELIBERATELY (2026-08-26), AND THE
   * ASSERTIONS ARE INVERTED RATHER THAN DELETED.
   *
   * When this block was written it pinned a real defect as CURRENT BEHAVIOUR:
   * the guard handed every protected prompt a one-tap "Build the model" chip
   * whose persisted `brief_seed` was the question itself (`deriveDraftOfferSeed`,
   * route-v2.ts:585, which — unlike its twin `deriveBriefTextSeed`,
   * derive-brief-seed.ts:118 — has no trailing-`?` refusal). The class was
   * protected on the TURN and one click from the defect.
   *
   * Removing the canned guard for this class removed the chip that carried the
   * seed, so the leak is closed UNCONDITIONALLY — for all seventeen, including
   * the five the deterministic floor does not reach. That closure is now the
   * thing under test: these cases assert the ABSENCE of the chip and of any
   * pending seeded with the protected question, so a future change that
   * re-introduces either goes RED here. The block's original instruction was
   * that closing the leak should be "recorded rather than absorbed" — this is
   * that record.
   */
  describe('LEAK CLOSED: no one-tap chip carries the protected question as a brief seed', () => {
    it.each(INV_Q_PROTECTED_CLASS)(
      'offers no "Build the model" chip and persists no seed: %s',
      async (message) => {
        const { body } = await turn(app, message);

        const chips = (body.suggested_actions ?? []) as Array<Record<string, any>>;
        expect(
          chips.find((c) => c.label === DRAFT_OFFER_CHIP_LABEL),
          'the draft-offer chip was the carrier of the 2.715 seed leak',
        ).toBeUndefined();
        expect(chips.some((c) => c.message === DRAFT_OFFER_CHIP_MESSAGE)).toBe(false);

        // The seed was the load-bearing half: the chip's copy is generic, but
        // what a tap RESUMED with was the protected question verbatim.
        const pending = committedDraftOfferPending();
        expect(
          pending?.action?.brief_seed,
          'no persisted draft_graph pending may carry the protected question',
        ).not.toBe(message);
      },
    );
  });

  // ── OPPOSITE-DIRECTION TWINS — the precision bias (trap 22b) ─────────────

  describe('the precision bias holds: genuine interrogative briefs still draft', () => {
    it.each(GENUINE_INTERROGATIVE_BRIEFS)('still drafts: %s', async (message) => {
      const { status, body } = await turn(app, message);

      expect(status).toBe(200);
      expect(exitPath(body)).toBe('draft_graph');
      expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
      expect(String(body.assistant_text ?? '')).toContain(DRAFT_MARKER);
    });
  });

  // ── COMPLETENESS — a corpus that can silently shrink protects nothing ────

  describe('the corpus cannot silently shrink', () => {
    it('covers exactly the 17 protected prompts (11 captured + 6 A7), no duplicates', () => {
      expect(CAPTURED_QUESTIONS).toHaveLength(11);
      expect(A7_MUST_DEFLECT).toHaveLength(6);
      expect(INV_Q_PROTECTED_CLASS).toHaveLength(17);
      expect(new Set(INV_Q_PROTECTED_CLASS).size).toBe(17);
    });

    it('every protected prompt is long enough and question-shaped — so each WOULD have captured through the regex\'s `\\?$` arm', async () => {
      for (const message of INV_Q_PROTECTED_CLASS) {
        expect(message.length).toBeGreaterThanOrEqual(30);
        expect(message.trim().endsWith('?')).toBe(true);
      }
    });
  });
});
