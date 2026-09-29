/**
 * ⭐⭐⭐ THE CAPTURED 500 MUST NOT BE REACHABLE. ONE TEST, BOUND BY IDENTITY.
 *
 * ── THE DEFECT, AS MEASURED ────────────────────────────────────────────────
 * On build `07da2c0b`, roughly one fresh brief in three came back HTTP 500 with
 * NO MODEL AT ALL: 30/96 at concurrency <= 4, 6/35 non-throttled, 7/34
 * estate-wide, 1/5 in the journey battery, and 3/8 on a SEQUENTIAL
 * concurrency=1 control — so it is the product, not harness load. IDENTICAL
 * brief bytes gave 200 / 200 / 500 across three runs.
 *
 * The captured envelope, reproduced VERBATIM below as `CAPTURED_FAILURE`:
 *   HTTP 500 INTERNAL_ERROR, boundary B1, validator `draft_graph_pipeline`,
 *   reason `draft_graph_cee_graph_invalid`,
 *   validation_error_codes [NO_PATH_TO_GOAL, NO_EFFECT_PATH],
 *   last_phase `deterministic_enforcement`,
 *   auto_retry { attempted: true, attempts: 2 }
 *
 * ── WHAT THIS SUITE ASSERTS, AND WHAT IT DOES NOT ─────────────────────────
 * It asserts the WIRE CONTRACT on that exact envelope: the user gets a turn
 * they can read, carrying a reference they can send us and a named fault, and
 * NO graph. It asserts NOTHING about recovery rates — whether a user-tapped
 * retry succeeds more often than the auto-retry is an unmeasured inference and
 * is deliberately not claimed here (the shipped copy's "usually transient"
 * inherits a BASELINE 3/5 figure measured for a different arm).
 *
 * RED at pristine `07da2c0b`: the draft catch block's only exit for a block
 * with no `goal_never_stated` stamp is `reply.code(500)`.
 *
 * Harness is `route-v2-goal-never-stated-ask.test.ts`'s, reused verbatim so
 * both suites drive ONE failure envelope rather than two invented ones.
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

/**
 * The model-routed open-frame intake. Defaulted to the FALLBACK verdict
 * (`continue_conversation`), which is what the real call degrades to with no
 * adapter — so every case that does not opt in behaves exactly as it did
 * before this mock existed. Only the semantic-intake case below overrides it.
 */
const understandOpenFrameIntakeMock = vi.fn(async () => ({
  route: 'continue_conversation' as const,
  source: 'fallback' as const,
  fallbackReason: 'adapter_unavailable' as const,
}));
vi.mock('../../orchestrator-v5/routing/open-frame-intake.js', async (importOriginal) => ({
  // ⚠ `vi.mock`'s factory REPLACES the module, so a hand-listed mock silently
  // drops every other export (trap 12). Spread the original and override the
  // ONE seam this suite drives.
  ...(await importOriginal<Record<string, unknown>>()),
  understandOpenFrameIntake: understandOpenFrameIntakeMock,
}));

let persistedGraphForRead: unknown | null = null;
let persistedBriefTextForRead: string | null = null;
let hasPriorTurnsForRead = false;
let hasOtherAdmittedLiveTurnForRead = false;
let draftLossStandsForRead = false;
let pendingActionsForRead: readonly PendingAction[] = [];
/**
 * The pendings read, as an OVERRIDABLE implementation. The default simply
 * serves `pendingActionsForRead`; a case that needs the read to FAIL swaps it,
 * and `beforeEach` restores the default so no case can inherit another's.
 */
const defaultPendingActionsRead = async (
  _scenarioId: string,
): Promise<readonly PendingAction[]> => pendingActionsForRead;
let pendingActionsReadImpl: (scenarioId: string) => Promise<readonly PendingAction[]> =
  defaultPendingActionsRead;

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
    readMostRecentPendingActions: (scenarioId: string) =>
      pendingActionsReadImpl(scenarioId),
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
const SCENARIO_ID = '66666666-6666-4666-8666-666666666666';
const TURN_ID = '88888888-8888-4888-8888-888888888888';

/** Complete on all four rubric dimensions → proceeds silently to draft. */
const COMPLETE_BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

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


const CAPTURED_FAILURE_RECOVERY = {
  suggestion:
    'Part of the drafted decision model was left unconnected to your goal, so it was rejected instead of being shown to you — this is usually transient. Try again.',
  hints: [
    'Retrying the same brief usually succeeds',
    'If it keeps happening, state the outcome you are optimising for explicitly',
    'Naming how each consideration affects that outcome helps the model connect them',
  ],
};

/**
 * THE CAPTURED FAILURE, VERBATIM.
 *
 * Not a shape imagined at the desk (trap 22: a corpus drawn from the author's
 * head cannot see the class the author did not imagine). Every field is the one
 * measured on build `07da2c0b`, including `auto_retry`, which records that the
 * pipeline had ALREADY re-drawn twice before giving up — the reason a
 * server-side retry is not the remedy here.
 */
function capturedFailureThrow() {
  return Object.assign(new Error('CEE_GRAPH_INVALID'), {
    pipelineStatusCode: 422,
    pipelineErrorCode: 'CEE_GRAPH_INVALID',
    pipelineRetryable: true,
    pipelineRecovery: CAPTURED_FAILURE_RECOVERY,
    pipelineDetails: {
      validation_error_codes: ['NO_PATH_TO_GOAL', 'NO_EFFECT_PATH'],
      last_phase: 'deterministic_enforcement',
      auto_retry: { attempted: true, attempts: 2 },
    },
  });
}

describe('POST /orchestrate/v2/turn — the captured draft 500 speaks instead of dying', () => {
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
    pendingActionsReadImpl = defaultPendingActionsRead;
    understandOpenFrameIntakeMock.mockClear();
  });

  it('the captured failure returns a COMMITTED, SPEAKING 200 carrying request_id, fault and readable — never a bare 500', async () => {
    dispatchDraftGraphMock.mockRejectedValue(capturedFailureThrow());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    // ── THE ACCEPTANCE CONDITION ────────────────────────────────────────
    // A bare 500 with no model is the worst outcome available: the user gets
    // nothing, learns nothing, and we learn nothing.
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // ── THE USER CAN READ IT ────────────────────────────────────────────
    // Bound BY IDENTITY to the producer's own sentence, not by a substring
    // another string could satisfy: `assistant_text` must carry the EXACT copy
    // `selectEnforcementBlockRecovery` composed, so a reword at the producer
    // moves this assertion with it instead of passing on copy we no longer
    // emit. A `toContain('unconnected')` would pass on any sentence containing
    // that word, including one this product never wrote.
    expect(body.assistant_text).toContain(CAPTURED_FAILURE_RECOVERY.suggestion);
    for (const hint of CAPTURED_FAILURE_RECOVERY.hints) {
      expect(body.assistant_text).toContain(hint);
    }

    // ── AND WE CAN DIAGNOSE IT (Paul's ruling, 2026-09-15) ──────────────
    const errorBlock = (body.blocks ?? []).find(
      (b: { type?: string }) => b.type === 'error',
    );
    expect(errorBlock, 'the failure must be a user-visible block, not silence').toBeDefined();
    // request_id — copyable: the user can send it to us.
    expect(typeof errorBlock.details.request_id).toBe('string');
    expect(errorBlock.details.request_id.length).toBeGreaterThan(0);
    // …and it is the SAME id the turn was served under, not a fresh one, or it
    // diagnoses nothing.
    expect(body.assistant_text).toContain(errorBlock.details.request_id);
    // fault — this class is OURS: identical brief bytes gave 200/200/500, node
    // count was statistically normal and only edges were under-supplied.
    expect(errorBlock.details.fault).toBe('olumi');
    // readable — plain English, not a code.
    expect(errorBlock.details.readable).toBe(CAPTURED_FAILURE_RECOVERY.suggestion);
    expect(errorBlock.details.readable).not.toMatch(/NO_PATH_TO_GOAL|NO_EFFECT_PATH/);
    // The machine-readable cause rides alongside it, for us rather than the user.
    expect(errorBlock.details.reason).toBe('draft_graph_cee_graph_invalid');
    expect(errorBlock.details.validation_error_codes).toEqual([
      'NO_PATH_TO_GOAL',
      'NO_EFFECT_PATH',
    ]);

    // ── NOTHING PARTIAL, NOTHING INVENTED ───────────────────────────────
    // No graph is shipped, so no edge is synthesised, no strength is minted,
    // and there is no gutted model to mistake for a whole one. The safety
    // argument is structural, not a matter of care.
    expect(body.draft_graph).toBeUndefined();
    expect(body.stage_indicator).toBe('frame');

    // ── THE TURN IS REAL ────────────────────────────────────────────────
    // An uncommitted answer is worse than the 500 it replaces: the user's next
    // message would arrive at a route with no memory of what was said.
    expect(appendMock).toHaveBeenCalled();
    // …so the turn is NOT marked dead.
    expect(markGraphWriteFailedMock).not.toHaveBeenCalled();

    // ── AND THE RETRY IS ONE TAP, CARRYING THE BRIEF ────────────────────
    const chips = (body.suggested_actions ?? []) as Array<{ id: string; label: string }>;
    expect(chips.length).toBe(1);
    expect(chips[0].label).toBe('Try again');
  });
});
