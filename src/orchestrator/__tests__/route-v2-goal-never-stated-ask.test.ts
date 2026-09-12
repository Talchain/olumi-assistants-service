/**
 * ROADMAP goalfence — THE USER-VISIBLE HALF.
 *
 * The producer spec (`tests/unit/cee.goal-never-stated-producer.test.ts`) proves
 * the block carries `goal_never_stated`. A stamp nobody acts on changes nothing
 * a user can see, and this estate's dominant failure is building things that
 * never reach a screen. This suite pins the ROUTE behaviour: the turn now
 * ANSWERS with the question whose absence caused the failure, instead of an
 * HTTP 500 whose `BoundaryError` has no `assistant_text` and is therefore
 * invisible in the conversation.
 *
 * ── WHAT IS MEASURED, AND WHAT IS ONLY ASSERTED ────────────────────────────
 * The 73% → 0% figures come from a live capture on build `2212ae0` (n=40). This
 * suite asserts NOTHING about that rate. It asserts the wire contract only:
 * given the producer's stamp, does the user get a question or a dead error?
 * Whether asking the question improves the journey is a live-witness claim and
 * is NOT made here.
 *
 * ── THE THREE CONJUNCTS EACH GET A REFUSAL TWIN ────────────────────────────
 * A suite that only proved "we ask when we should" could not tell a correct
 * fence from a blanket one — and a blanket one would swallow every draft
 * failure into a question about the user's goal, hiding real defects. So every
 * admit has an opposite-direction refusal beside it.
 *
 * Harness mirrors `route-v2-draft-loss-p0.test.ts` (real route, mocked session
 * store + LLM router + dispatchDraftGraph detector).
 *
 * RED at pristine 2212ae05: the draft catch block has exactly one exit — a 500.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { _resetConfigCache } from '../../config/index.js';

const dispatchDraftGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

let persistedGraphForRead: unknown | null = null;
let persistedBriefTextForRead: string | null = null;
let hasPriorTurnsForRead = false;
let hasOtherAdmittedLiveTurnForRead = false;
let draftLossStandsForRead = false;
let pendingActionsForRead: readonly PendingAction[] = [];

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const hasOtherAdmittedLiveTurnMock = vi.fn(async () => hasOtherAdmittedLiveTurnForRead);
const scenarioDraftLossStandsMock = vi.fn(async () => draftLossStandsForRead);
const markGraphWriteFailedMock = vi.fn(async () => undefined);
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraphForRead,
    loadGraphAndBriefText: async () => ({
      graph: persistedGraphForRead,
      briefText: persistedBriefTextForRead,
    }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
    hasPriorTurns: async () => hasPriorTurnsForRead,
    hasOtherAdmittedLiveTurn: hasOtherAdmittedLiveTurnMock,
    scenarioDraftLossStands: scenarioDraftLossStandsMock,
    markGraphWriteFailed: markGraphWriteFailedMock,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const chatWithToolsMock = vi.fn(async () => ({
  content: [{ type: 'text', text: 'Executor reply.' }],
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

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');
const { GOAL_NEVER_STATED_LEAD } = await import(
  '../../orchestrator-v5/clarify-v2/goal-never-stated-ask.js'
);

const SCENARIO_ID = '66666666-6666-4666-8666-666666666666';
const TURN_ID = '88888888-8888-4888-8888-888888888888';

/** Complete on all four rubric dimensions → proceeds silently to draft. */
const COMPLETE_BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

/**
 * The typed throw route-v2 sees when the post-enforcement gate blocks.
 *
 * Shape copied from `route-v2-draft-loss-p0.test.ts`'s typed-metadata case, so
 * both suites drive ONE failure envelope rather than two invented ones. Only
 * `pipelineDetails` varies between the arms below.
 */
function pipelineThrow(details: Record<string, unknown> | null) {
  return Object.assign(new Error('CEE_GRAPH_INVALID'), {
    pipelineStatusCode: 422,
    pipelineErrorCode: 'CEE_GRAPH_INVALID',
    pipelineRetryable: true,
    pipelineRecovery: {
      suggestion: 'Part of the drafted decision model was left unconnected to your goal.',
      hints: ['State the outcome you are optimising for explicitly'],
    },
    ...(details === null ? {} : { pipelineDetails: details }),
  });
}

/** What the fenced case looks like on the wire. */
const SELF_INFLICTED_DETAILS = {
  validation_error_codes: ['NO_PATH_TO_GOAL', 'NO_EFFECT_PATH'],
  last_phase: 'deterministic_enforcement',
  goal_never_stated: true,
};

/** The same failure WITHOUT the producer's stamp — an ordinary block. */
const ORDINARY_DETAILS = {
  validation_error_codes: ['NO_PATH_TO_GOAL', 'NO_EFFECT_PATH'],
  last_phase: 'deterministic_enforcement',
};

function messagePayload(message: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message,
    source: 'composer',
  };
}

describe('POST /orchestrate/v2/turn — a draft blocked on CEE\'s OWN goal asks instead of dying', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    _resetConfigCache();
  });
  beforeEach(() => {
    dispatchDraftGraphMock.mockReset();
    appendMock.mockClear();
    appendMock.mockResolvedValue({ id: 'mock-row-id' });
    chatWithToolsMock.mockClear();
    markGraphWriteFailedMock.mockClear();
    persistedGraphForRead = null;
    persistedBriefTextForRead = null;
    hasPriorTurnsForRead = false;
    hasOtherAdmittedLiveTurnForRead = false;
    draftLossStandsForRead = false;
    pendingActionsForRead = [];
  });

  it('ADMITS: a self-inflicted block answers 200 with the outcome question, not a 500', async () => {
    dispatchDraftGraphMock.mockRejectedValue(pipelineThrow(SELF_INFLICTED_DETAILS));

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    // The whole point: the user gets a turn they can read and answer.
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // The question itself — bound to the PRODUCT's own template text
    // (`questions.ts:120`), not to a string retyped here, so a reword at the
    // template moves this assertion with it rather than silently passing on
    // copy the product no longer emits.
    expect(body.assistant_text).toContain('What outcome would make this decision a success?');
    expect(body.assistant_text).toContain(GOAL_NEVER_STATED_LEAD);

    // NOTHING PARTIAL IS SHIPPED — the safety argument, asserted at the wire.
    // No graph means no option can silently vanish from a comparison, and no
    // gutted model can be mistaken for a whole one.
    expect(body.draft_graph).toBeUndefined();
    expect(body.blocks).toEqual([]);

    // The stage must NOT advance: there is no model to analyse.
    expect(body.stage_indicator).toBe('frame');

    // Tappable answers, so the question is not a dead end.
    const chips = (body.suggested_actions ?? []) as Array<{ id: string; message: string }>;
    expect(chips.length).toBeGreaterThan(0);

    // ⭐ AND NOT A CHIP THAT REPLAYS THE FAILURE. "Draft it anyway" is the one
    // action just measured to fail on this input; offering it would be a dead
    // end wearing a button.
    expect(chips.every((c) => !/draft it anyway/i.test(c.message ?? ''))).toBe(true);
  });

  it('ADMITS: the ask is COMMITTED, so the user\'s answer lands on a turn that remembers the question', async () => {
    dispatchDraftGraphMock.mockRejectedValue(pipelineThrow(SELF_INFLICTED_DETAILS));

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(200);
    // An uncommitted question is worse than the 500 it replaces: the user
    // answers into a turn that was never recorded.
    expect(appendMock).toHaveBeenCalled();
    // …and the turn is NOT marked dead — it produced a real answer.
    expect(markGraphWriteFailedMock).not.toHaveBeenCalled();
  });

  /**
   * ⭐⭐ THE FENCE. Same codes, same failure, NO stamp — and the 500 must stand.
   *
   * Without this, a fence that fired on every draft failure would pass the
   * admit cases above while swallowing genuine defects into a question about
   * the user's goal.
   */
  it('REFUSES: an ordinary block with the SAME codes but no stamp still 500s', async () => {
    dispatchDraftGraphMock.mockRejectedValue(pipelineThrow(ORDINARY_DETAILS));

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.details.reason).toBe('draft_graph_cee_graph_invalid');
    // The unchanged path still leaves its server-side trace.
    expect(markGraphWriteFailedMock).toHaveBeenCalled();
  });

  it('REFUSES: a pipeline throw carrying no details at all still 500s', async () => {
    dispatchDraftGraphMock.mockRejectedValue(pipelineThrow(null));

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(500);
  });

  /**
   * ⭐ FAIL-CLOSED ON A FAILED COMMIT. A question the user answers into an
   * unrecorded turn is worse than an error, so a commit failure must fall
   * through to the unchanged 500 rather than ship an orphan question.
   */
  it('REFUSES: when the commit fails, the ask is abandoned and the 500 stands', async () => {
    dispatchDraftGraphMock.mockRejectedValue(pipelineThrow(SELF_INFLICTED_DETAILS));
    appendMock.mockRejectedValue(new Error('session store unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.details.reason).toBe('draft_graph_cee_graph_invalid');
  });
});
