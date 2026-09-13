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
import type { PipelineStageEvent } from '../../cee/unified-pipeline/types.js';
import { runWithStageStream } from '../../cee/unified-pipeline/stage-stream-context.js';
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

/**
 * A GRAPH_READY frame, exactly as the streamed-turn route's own observer sees
 * it. Built from the pipeline's `PipelineStageEvent` union so it cannot drift
 * from the real emission shape. Copied from
 * `route-v2-draft-loss-disclosure.test.ts`, which owns this seam.
 */
const GRAPH_READY_EVENT: PipelineStageEvent = {
  kind: 'GRAPH_READY',
  graph: { nodes: [], edges: [] },
  schema_version: 'v3',
  elapsed_ms: 33_000,
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
    pendingActionsReadImpl = defaultPendingActionsRead;
    understandOpenFrameIntakeMock.mockClear();
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
   * ⭐⭐ THE CONJUNCT A SURVIVING MUTANT EXPOSED — AND IT GUARDS A REAL HARM.
   *
   * Deleting `!previewWasStreamed` left the whole suite GREEN, because every
   * other case here injects into the BUFFERED `/orchestrate/v2/turn`, which
   * emits no stage frames at all: `graphPreviewEmitted()` is structurally
   * false on all of them, so the conjunct was never exercised in either
   * direction.
   *
   * It matters. On the STREAMED route a GRAPH_READY frame can already have
   * handed the client a graph to render. Answering that turn with a question
   * would silently retract a model the user is looking at — replacing a
   * visible draft with "what outcome would make this a success?" and no
   * explanation. That case belongs to the existing draft-loss disclosure,
   * which is why the fence declines it and the 500 path stands.
   */
  it('REFUSES: a self-inflicted block AFTER a GRAPH_READY frame streamed keeps the 500', async () => {
    dispatchDraftGraphMock.mockRejectedValue(pipelineThrow(SELF_INFLICTED_DETAILS));

    const seen: PipelineStageEvent[] = [];
    const res = await runWithStageStream(
      (event) => {
        seen.push(event);
      },
      async () => {
        const emitFrame = (
          await import('../../cee/unified-pipeline/stage-stream-context.js')
        ).currentStageEmitter();
        emitFrame?.(GRAPH_READY_EVENT);
        return await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: messagePayload(COMPLETE_BRIEF),
        });
      },
    );

    // PRECONDITION PINNED IN-TEST: the frame really did travel the seam.
    // Without this the assertion below could pass because the emitter
    // silently did nothing — a guard agreeing with itself (trap 13b).
    expect(seen.map((e) => e.kind)).toContain('GRAPH_READY');

    expect(res.statusCode).toBe(500);
    // The user saw a graph, so this IS a loss and must be disclosed as one.
    expect(markGraphWriteFailedMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      TURN_ID,
      expect.any(String),
      'draft_loss',
    );
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

/**
 * ⭐⭐⭐ THE CONTINUATION — AND THE ONLY THING THAT CAN OBSERVE THE DEFECT.
 *
 * The suite above stops at the question. That is STRUCTURALLY INCAPABLE of
 * observing what Codex's P1 names: the ask promises *"You don't need to rewrite
 * anything else"*, and whether that promise is TRUE is a fact about the NEXT
 * turn's DRAFT INPUT. A one-request test never reaches it, so it can be fully
 * green while the original brief is being thrown away.
 *
 * So every case here drives TWO requests through the real route, and
 * **the append mock feeds the subsequent ingress read** — without that wiring
 * the second turn reads an empty pending set and proves nothing.
 *
 * ⚠ THE ASSERTION IS ON `dispatchDraftGraph`'s ACTUAL ARGUMENT, never on the
 * response copy. The brief the pipeline drafts from is
 * `params.briefOverride ?? payload.message` (`draft-graph-dispatch.ts:591`) —
 * mirrored here in ONE helper so the test reads the same quantity the producer
 * resolves, rather than a second spelling that could agree while the product
 * diverges (trap 21).
 */
describe('POST /orchestrate/v2/turn — the goal ask RESUMES: the answer redrafts the ORIGINAL brief', () => {
  let app: FastifyInstance;

  /** A second turn id — the same scenario, the user's next message. */
  const TURN_ID_2 = '99999999-9999-4999-8999-999999999999';
  /** A third, for the case that already carries an effective-brief override. */
  const TURN_ID_3 = '77777777-7777-4777-8777-777777777777';

  /**
   * The brief the user actually sent. Names alternatives and a constraint —
   * the two things the P1 says can be lost — and NO outcome, which is the
   * input class the fence exists for.
   */
  const BRIEF_WITH_ALTERNATIVES =
    'Should we open a Berlin office or expand the Lisbon team, '
    + 'given we cannot exceed a headcount of forty this year?';

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

  /** A successful draft, for the SECOND turn. */
  function draftSucceeds() {
    return {
      response: {
        response_version: 2 as const,
        assistant_text: 'Drafted the model.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
      graph: null,
    };
  }

  /**
   * The brief the pipeline WILL draft from, read the dispatcher's own way.
   * `draft-graph-dispatch.ts:591` — `effectiveBrief = params.briefOverride ??
   * payload.message`. One authority, two readers.
   */
  function effectiveBriefOfCall(callIndex: number): string {
    const args = dispatchDraftGraphMock.mock.calls[callIndex]![0] as {
      briefOverride?: string;
      payload: { message: string };
    };
    return args.briefOverride ?? args.payload.message;
  }

  /**
   * Turn 1: the draft fails self-inflicted, the ask commits — and THIS is the
   * wiring the P1 says was missing from the old suite: whatever the commit
   * PERSISTED becomes what the next ingress READS.
   */
  async function askTurnThenArmNextIngress(
    message: string,
    priorPendings: readonly PendingAction[] = [],
  ): Promise<{ askBody: Record<string, unknown> }> {
    pendingActionsForRead = priorPendings;
    dispatchDraftGraphMock.mockRejectedValueOnce(pipelineThrow(SELF_INFLICTED_DETAILS));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(message),
    });
    expect(res.statusCode, 'turn 1 must be the ask, not a 500').toBe(200);
    expect(appendMock, 'the ask must have committed').toHaveBeenCalled();
    // ⭐⭐ PIN THE PRECONDITION IN-TEST (trap 13b / trap 19). `200 + append` is
    // satisfied by SEVERAL other route exits — this helper was written with
    // exactly those two assertions and was silently satisfied by the
    // analysis-authority-unavailable degrade on a brief that never reached the
    // draft at all (measured at pristine, draftCalls=0). Both halves below are
    // load-bearing: the draft must have been ATTEMPTED, and the turn the user
    // received must be THIS ask, bound to the composer's own exported lead.
    const askBodyParsed = JSON.parse(res.body) as Record<string, unknown>;
    expect(
      dispatchDraftGraphMock.mock.calls.length,
      'precondition: turn 1 must have attempted a draft',
    ).toBe(1);
    expect(
      String(askBodyParsed.assistant_text),
      'precondition: turn 1 must be the goal ask, not another 200 exit',
    ).toContain(GOAL_NEVER_STATED_LEAD);

    const write = appendMock.mock.calls.at(-1)![0] as {
      pending_actions?: readonly PendingAction[];
    };
    // ⭐ THE APPEND MOCK FEEDS THE SUBSEQUENT INGRESS READ.
    pendingActionsForRead = write.pending_actions ?? [];
    hasPriorTurnsForRead = true;
    return { askBody: askBodyParsed };
  }

  it('CONTINUES (CHIP answer): the next draft input is the ORIGINAL brief PLUS the answer', async () => {
    const { askBody } = await askTurnThenArmNextIngress(BRIEF_WITH_ALTERNATIVES);

    // The answer is the product's OWN chip — taken off the wire it just sent,
    // never a string retyped here. A reword of the candidate moves this case.
    const chips = (askBody.suggested_actions ?? []) as Array<{ id: string; message: string }>;
    const chipMessage = chips[0]!.message;

    dispatchDraftGraphMock.mockResolvedValueOnce(draftSucceeds());
    const res2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: { ...messagePayload(chipMessage), turn_id: TURN_ID_2 },
    });

    expect(res2.statusCode).toBe(200);
    // The answer must REACH a draft — not another question, not a conversation.
    expect(
      dispatchDraftGraphMock.mock.calls.length,
      'the answer must dispatch a SECOND draft',
    ).toBe(2);

    const next = effectiveBriefOfCall(1);
    // ⛔ THE P1, ASSERTED. The alternatives and the constraint must survive.
    expect(next).toContain('Berlin office');
    expect(next).toContain('Lisbon team');
    expect(next).toContain('headcount of forty');
    // …AND the answer is folded in, so the goal is now stated.
    expect(next).toContain(chipMessage.trim());
    // ⛔ THE EXACT FAILURE CODEX NAMED: the suggested answer must NOT become
    // the whole drafting brief.
    expect(next).not.toBe(chipMessage);
    expect(next).not.toBe(chipMessage.trim());
  });

  it('CONTINUES (TYPED answer): a free-text outcome folds into the original brief too', async () => {
    await askTurnThenArmNextIngress(BRIEF_WITH_ALTERNATIVES);

    // Not a chip — the user typing their own outcome, which the ask's closing
    // line explicitly invites ("or type your own").
    const typed = 'Grow EU revenue by 15% within 12 months.';

    dispatchDraftGraphMock.mockResolvedValueOnce(draftSucceeds());
    const res2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: { ...messagePayload(typed), turn_id: TURN_ID_2 },
    });

    expect(res2.statusCode).toBe(200);
    expect(dispatchDraftGraphMock.mock.calls.length).toBe(2);

    const next = effectiveBriefOfCall(1);
    expect(next).toContain('Berlin office');
    expect(next).toContain('Lisbon team');
    expect(next).toContain('headcount of forty');
    expect(next).toContain(typed.trim());
    expect(next).not.toBe(typed);
  });

  /**
   * ⭐⭐ THE CASE THAT PROVES IT IS THE *EFFECTIVE* BRIEF AND NOT THE WIRE
   * MESSAGE. Turn 1 already carries a `briefOverride` (a live clarify round
   * resumes and hands the dispatcher an answer-augmented brief), so
   * `ingress.message` is a one-line answer while the brief the pipeline drafts
   * from is much larger. Retaining the message would silently discard the
   * larger brief — and every assertion in the two cases above would still pass,
   * because they send the brief AS the message.
   */
  it('CONTINUES (an existing briefOverride): the retained brief is the EFFECTIVE one, not the wire message', async () => {
    const priorRound: PendingAction = {
      id: 'cv2_prior-round',
      scenario_id: SCENARIO_ID,
      chip_id: 'cv2_proceed_default',
      action: {
        kind: 'clarify_v2_round',
        brief: BRIEF_WITH_ALTERNATIVES,
        asked_dimensions: ['options'],
        // At the round budget, so this prior round PROCEEDS to the draft
        // rather than asking again — the shape that produces a briefOverride.
        round: 2,
      },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: new Date(Date.now() + 60_000).toISOString(),
      emitted_at_iso: new Date(Date.now() - 1_000).toISOString(),
    } as PendingAction;

    const firstAnswer = 'Also consider a fully remote team.';
    await askTurnThenArmNextIngress(firstAnswer, [priorRound]);

    // Turn 1 drafted from the OVERRIDE, not the message — the precondition
    // this case exists to exercise. Pinned IN-TEST so the case cannot quietly
    // stop reaching the branch it names (trap 13b).
    const firstEffective = effectiveBriefOfCall(0);
    expect(firstEffective, 'precondition: turn 1 must carry a briefOverride').not.toBe(firstAnswer);
    expect(firstEffective).toContain('Berlin office');
    expect(firstEffective).toContain(firstAnswer);

    dispatchDraftGraphMock.mockResolvedValueOnce(draftSucceeds());
    const res2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: { ...messagePayload('The goal is to increase revenue.'), turn_id: TURN_ID_3 },
    });

    expect(res2.statusCode).toBe(200);
    expect(dispatchDraftGraphMock.mock.calls.length).toBe(2);

    const next = effectiveBriefOfCall(1);
    // Everything the effective brief carried at turn 1 survives…
    expect(next).toContain('Berlin office');
    expect(next).toContain('Lisbon team');
    expect(next).toContain('headcount of forty');
    expect(next).toContain(firstAnswer);
    // …plus the goal answer.
    expect(next).toContain('The goal is to increase revenue.');
  });

  /**
   * ⭐ "PRESERVE UNRELATED PENDING ACTIONS" — the hold-wipe class, asserted.
   * The old exit sent `pending_actions: []`, which the commit respects
   * verbatim; threading the prior set is what keeps an unrelated live hold
   * alive across the ask turn.
   */
  it('PRESERVES: an unrelated live hold survives the ask turn', async () => {
    const unrelatedHold: PendingAction = {
      id: 'pc_prior-turn',
      scenario_id: SCENARIO_ID,
      chip_id: 'pc_chip-1',
      action: {
        kind: 'proposed_concept',
        concept: 'a churn-risk factor',
        preferred_kind: 'factor',
        public_label: 'Add churn risk',
        public_message: 'Yes, add the churn-risk factor.',
      },
      preconditions: {},
      expires_at_turn_count: 3,
      expires_at_iso: new Date(Date.now() + 60_000).toISOString(),
      emitted_at_iso: new Date(Date.now()).toISOString(),
    } as PendingAction;

    await askTurnThenArmNextIngress(BRIEF_WITH_ALTERNATIVES, [unrelatedHold]);

    const persisted = pendingActionsForRead;
    const kinds = persisted.map((pa) => pa.action.kind);
    // The unrelated hold is still live…
    expect(kinds, 'the unrelated hold must not be wiped').toContain('proposed_concept');
    // …alongside the resumable round the ask armed.
    expect(kinds, 'the ask must arm a resumable round').toContain('clarify_v2_round');
  });

  /**
   * ⭐ THE NEW FAIL-CLOSED BRANCH GETS ITS OWN CONTROL.
   *
   * Arming the round needs the PRIOR pending set, because committing without
   * carry-forward wipes live holds. When that read fails we cannot prove the
   * prior set, so the ask is abandoned and the unchanged 500 stands — losing
   * the memory of this question is strictly better than losing the user's own
   * live proposal. Without this case the branch is unobserved, and a change
   * that made it fail OPEN (ask anyway, wiping holds) would stay green.
   */
  it('REFUSES: when the prior-pending read fails, the ask is abandoned and the 500 stands', async () => {
    const failingRead = vi.fn(async () => {
      throw new Error('pending read exploded');
    });
    pendingActionsReadImpl = failingRead;
    dispatchDraftGraphMock.mockRejectedValueOnce(pipelineThrow(SELF_INFLICTED_DETAILS));

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(BRIEF_WITH_ALTERNATIVES),
    });

    // Precondition: the read we broke is the one this branch depends on.
    expect(failingRead, 'precondition: the prior-pending read must have run').toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    // The unchanged path still leaves its server-side trace.
    expect(markGraphWriteFailedMock).toHaveBeenCalled();
  });

  /**
   * ⭐⭐ THE SEMANTIC-INTAKE PATH — the one the P1 named by name, and the ONLY
   * path on which the retained brief falls back to `ingress.message`.
   *
   * On every draft-SHAPED turn, clarify v2's round 1 hands the route a
   * `briefOverride`, so `draftEffectiveBrief`'s `?? ingress.message` arm never
   * runs. It runs here: a NON-draft-shaped message that the model-routed
   * open-frame intake sends to `start_model`. Clarify declines the turn
   * (`clarify-v2-dispatch.ts:514` — not draft-shaped, no explicit generate),
   * the draft dispatches with no override, and `payload.message` IS the
   * effective brief — which is exactly the path the review warned could end up
   * drafting from the one-line answer alone.
   *
   * Found by a SURVIVING MUTANT: replacing the fallback with `''` left the
   * suite green, because no case reached it. A survivor is a claim either way,
   * so it is covered rather than declared equivalent.
   */
  it('CONTINUES (semantic intake, no override): the message IS the effective brief, and it is retained', async () => {
    understandOpenFrameIntakeMock.mockResolvedValue({
      route: 'start_model' as const,
      source: 'model' as const,
      model: 'test-model',
      latencyMs: 5,
      inputTokens: 1,
      outputTokens: 1,
    } as never);

    // Deliberately NOT draft-shaped: no decision verb, no question mark — so
    // clarify v2 declines and cannot supply a briefOverride.
    const openFrame =
      'We keep going back and forth between a Berlin office and the Lisbon team, '
      + 'and headcount is capped at forty.';

    await askTurnThenArmNextIngress(openFrame);

    // Precondition: turn 1 really took the no-override path (trap 13b).
    const args0 = dispatchDraftGraphMock.mock.calls[0]![0] as { briefOverride?: string };
    expect(
      args0.briefOverride,
      'precondition: this path must carry NO briefOverride',
    ).toBeUndefined();

    dispatchDraftGraphMock.mockResolvedValueOnce(draftSucceeds());
    const res2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: { ...messagePayload('The goal is to increase revenue.'), turn_id: TURN_ID_2 },
    });

    expect(res2.statusCode).toBe(200);
    expect(dispatchDraftGraphMock.mock.calls.length).toBe(2);

    const next = effectiveBriefOfCall(1);
    expect(next).toContain('Berlin office');
    expect(next).toContain('Lisbon team');
    expect(next).toContain('capped at forty');
    expect(next).toContain('The goal is to increase revenue.');
    expect(next).not.toBe('The goal is to increase revenue.');
  });

  /**
   * ⭐ THE RESUMABLE STATE ITSELF, pinned at the row. The two-turn cases above
   * prove the BEHAVIOUR; this pins the mechanism they ride, so a change that
   * keeps them green by some other route is still visible.
   */
  it('ARMS: the committed round carries the effective brief and the goal as asked', async () => {
    await askTurnThenArmNextIngress(BRIEF_WITH_ALTERNATIVES);

    const round = pendingActionsForRead.find((pa) => pa.action.kind === 'clarify_v2_round');
    expect(round, 'a clarify_v2_round must be armed').toBeDefined();
    const action = round!.action as unknown as {
      brief: string;
      asked_dimensions: readonly string[];
      round: number;
    };
    expect(action.brief).toBe(BRIEF_WITH_ALTERNATIVES);
    expect(action.asked_dimensions).toEqual(['goal']);
  });
});
