/**
 * ROADMAP 2.709 — route wiring for the fresh-journey P0 (the phantom model).
 *
 * Diagnosis: PHASE0-EVIDENCE-2026-07-28/fresh-journey-p0-diagnosis-2026-08-08.md.
 * A first draft's commit was destroyed by the turn fence when a mid-draft
 * QUESTION claimed the scenario; the UI kept the rendered preview; every next
 * turn then honestly served the phantom state — the question was captured as a
 * NEW BRIEF (S2), analyse refused (S3), and a one-value edit redrafted the
 * whole model (S4). This suite pins the ROUTE half of the fix:
 *
 *   · invariant 3 — continuation detection SEES in-flight turns: a scenario
 *     with an ADMITTED (fence-claimed) turn by another turn id is a
 *     continuation for classification even before any commit lands, so a
 *     mid-draft question is never intake-captured as a fresh brief;
 *   · invariant 6 — persistence failure is never dark: the two draft-500
 *     exits leave a server-side trace (markGraphWriteFailed), and any later
 *     graph-less 200 on a scenario whose draft loss stands carries the
 *     DRAFT_LOSS_NOTICE to the user (the triggering client may be gone);
 *   · the unstranding term — while the loss stands, a re-sent shaped brief
 *     DRAFTS even on a continuation scenario, so the notice's "send your
 *     brief again and I'll redraft it" is a promise the classifier keeps.
 *
 * Harness mirrors route-v2-clarify-v2.test.ts (real route, mocked session
 * store + LLM router + dispatchDraftGraph detector).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { _resetConfigCache } from '../../config/index.js';
import { CLARIFY_V2_PROCEED_CHIP_ID } from '../../orchestrator-v5/clarify-v2/preflight.js';

// ── dispatchDraftGraph: mocked as a detector + canned success ─────────────
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// ── Mutable per-test session-store behaviour ──────────────────────────────
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

// The TurnExecutor fall-through path calls the router; a canned block-array
// reply keeps those paths 200 without asserting anything about executor
// internals (orient filters `result.content` for tool_use blocks).
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

const { ceeOrchestratorRouteV2, DRAFT_LOSS_NOTICE } = await import('../../orchestrator/route-v2.js');

const SCENARIO_ID = '66666666-6666-4666-8666-666666666666';
const TURN_ID = '88888888-8888-4888-8888-888888888888';

/** Codex's exact mid-draft interrupt — draft-shaped by the `\?$` arm. */
const MID_DRAFT_QUESTION = 'What assumption matters most, and why?';
/** Complete on all four rubric dimensions → proceeds silently to draft. */
const COMPLETE_BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

function makeDraftMockResult(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function messagePayload(
  message: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message,
    source: 'composer',
    ...overrides,
  };
}

describe('POST /orchestrate/v2/turn — draft-loss P0 wiring (2.709)', () => {
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
    dispatchDraftGraphMock.mockResolvedValue(makeDraftMockResult());
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    hasOtherAdmittedLiveTurnMock.mockClear();
    scenarioDraftLossStandsMock.mockClear();
    markGraphWriteFailedMock.mockClear();
    persistedGraphForRead = null;
    persistedBriefTextForRead = null;
    hasPriorTurnsForRead = false;
    hasOtherAdmittedLiveTurnForRead = false;
    draftLossStandsForRead = false;
    pendingActionsForRead = [];
  });

  // ═══ Invariant 3 — continuation sees in-flight turns (kills S2) ═════════

  it('S2 REPRO→FIX: a question sent MID-DRAFT (admitted fence row, zero committed turns) is NOT captured as a fresh brief', async () => {
    hasPriorTurnsForRead = false; // the draft's atomic commit has not landed
    hasOtherAdmittedLiveTurnForRead = true; // …but its fence claim is visible

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(MID_DRAFT_QUESTION),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // The phantom capture's signature: clarify round-1 chips + "Before I
    // draft the model…" intake. A continuation turn must produce neither.
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    // No clarify-round pending may be committed for this turn.
    const committedPendingKinds = appendMock.mock.calls
      .flatMap((c) => ((c[0] as Record<string, unknown>).pending_actions as PendingAction[]) ?? [])
      .map((p) => p.action.kind);
    expect(committedPendingKinds).not.toContain('clarify_v2_round');
    // The read is identity-bound: this scenario, excluding THIS turn id.
    expect(hasOtherAdmittedLiveTurnMock).toHaveBeenCalledWith(SCENARIO_ID, TURN_ID);
  });

  /**
   * ⚠ THIS CONTROL WAS RE-BASED BY ROADMAP 2.715 (INV-Q), AND ITS OWN COMMENT
   * ANTICIPATED IT ("capture semantics themselves are rows 2.714-2.716, out of
   * scope here"). `MID_DRAFT_QUESTION` is 2.715's own example string: a
   * question TO the assistant is no longer draft-shaped, so it now opens no
   * clarify round on a FRESH scenario either.
   *
   * That change would have HOLLOWED this control — it must show that the
   * 2.709 continuation guard is what suppresses above, not something else, and
   * a message suppressed on both paths shows nothing (trap 12b: a control that
   * stops discriminating still passes). So it is split: the question's new
   * fresh-scenario behaviour is pinned HERE, and the discriminating half moves
   * to a genuine brief, which still engages clarify on a fresh scenario and is
   * still suppressed on a continuation.
   */
  it('2.715: the same question on a FRESH scenario opens no clarify round either', async () => {
    hasPriorTurnsForRead = false;
    hasOtherAdmittedLiveTurnForRead = false;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(MID_DRAFT_QUESTION),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).not.toContain(CLARIFY_V2_PROCEED_CHIP_ID);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });

  it('CONTROL (discriminating): a genuine BRIEF on a FRESH scenario still engages clarify', async () => {
    hasPriorTurnsForRead = false;
    hasOtherAdmittedLiveTurnForRead = false;

    // Track-1 intake fix (2026-08-13): the previous control brief ("…expand
    // into Germany or double down on the UK next year") drifted to a
    // SINGLE-GAP brief (goal-only missing — "double" satisfies quantities,
    // "next year" timeframe), which now correctly drafts first with a
    // deferred ask instead of blocking. The control's job is unchanged —
    // prove the fresh-scenario refusal above discriminates on QUESTION
    // SHAPE, not on scenario state — so it uses a ≥2-missing brief that
    // still takes the blocking ask.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(
        'We are weighing whether to expand into Germany or focus on the UK instead.',
      ),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const chipIds = ((body.suggested_actions ?? []) as Array<{ id: string }>).map((a) => a.id);
    expect(chipIds).toContain(CLARIFY_V2_PROCEED_CHIP_ID);
  });

  // ═══ Invariant 6 — the two draft-500 exits leave a trace ════════════════

  it('a draft whose COMMIT is refused (commitPerformed=false) 500s AND marks the failure trace', async () => {
    dispatchDraftGraphMock.mockResolvedValue(
      makeDraftMockResult({ commitPerformed: false, graph: { nodes: [{ id: 'n1' }], edges: [] } }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(500);
    expect(markGraphWriteFailedMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      TURN_ID,
      expect.stringContaining('draft'),
      // ROADMAP 2.735 — an ATTEMPTED COMMIT is a real loss: the pipeline had
      // produced a graph and the append was tried. Disclosed.
      'draft_loss',
    );
  });

  it('a draft whose PIPELINE throws (e.g. CEE_GRAPH_INVALID) 500s AND marks the failure trace', async () => {
    dispatchDraftGraphMock.mockRejectedValue(new Error('CEE_GRAPH_INVALID: validation failed'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(500);
    expect(markGraphWriteFailedMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      TURN_ID,
      expect.stringContaining('draft'),
      // ROADMAP 2.735 — this harness injects into the BUFFERED
      // /orchestrate/v2/turn, which emits no stage frames at all, so no client
      // was ever shown a graph. The turn is marked dead (continuation
      // detection must stop counting it) and NOTHING is disclosed. The
      // post-GRAPH_READY twin — same throw, `draft_loss` — is pinned in
      // route-v2-draft-loss-disclosure.test.ts, which drives the streamed seam.
      'turn_dead_only',
    );
  });

  it('a typed-metadata pipeline throw (CEE_GRAPH_INVALID, producer retryable:true) STILL 500s, marks the trace, AND the wire honours the producer retryable (2.718)', async () => {
    // Invariant 6 must hold on the typed-envelope path too — the witnessed
    // 2026-08-06 failures (runs de79da/39cf53) travel exactly this path: the
    // post-enforcement gate's 422 body becomes a typed throw, route-v2 maps
    // it, and the fence row must be marked BEFORE the 500 leaves. The
    // retryable assertion is the 2.718 fix: producer-declared true must
    // survive to the wire, not be flipped by the static per-code map.
    dispatchDraftGraphMock.mockRejectedValue(
      Object.assign(new Error('CEE_GRAPH_INVALID'), {
        pipelineStatusCode: 422,
        pipelineErrorCode: 'CEE_GRAPH_INVALID',
        pipelineRetryable: true,
        pipelineRecovery: {
          suggestion:
            'Part of the drafted decision model was left unconnected to your goal, so it was rejected instead of being shown to you — this is usually transient. Try again.',
          hints: ['Retrying the same brief usually succeeds'],
        },
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(500);
    expect(markGraphWriteFailedMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      TURN_ID,
      expect.stringContaining('draft'),
      // ROADMAP 2.735 — this harness injects into the BUFFERED
      // /orchestrate/v2/turn, which emits no stage frames at all, so no client
      // was ever shown a graph. The turn is marked dead (continuation
      // detection must stop counting it) and NOTHING is disclosed. The
      // post-GRAPH_READY twin — same throw, `draft_loss` — is pinned in
      // route-v2-draft-loss-disclosure.test.ts, which drives the streamed seam.
      'turn_dead_only',
    );
    const body = JSON.parse(res.body);
    expect(body.details.reason).toBe('draft_graph_cee_graph_invalid');
    expect(body.details.retryable).toBe(true);
    expect(body.retryable).toBe(true);
  });

  it('CONTROL: a draft that commits marks nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    expect(markGraphWriteFailedMock).not.toHaveBeenCalled();
  });

  // ═══ Invariant 6 — the next turn surfaces the loss ══════════════════════

  it('while the loss stands, a graph-less 200 carries the DRAFT_LOSS_NOTICE (the client that lost it may be gone)', async () => {
    draftLossStandsForRead = true;
    hasPriorTurnsForRead = false;
    hasOtherAdmittedLiveTurnForRead = false;

    // A thin draft-shaped brief → clarify v2 asks questions (a graph-less 200).
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload('Should we expand into the German market?'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text.startsWith(DRAFT_LOSS_NOTICE)).toBe(true);
    expect(scenarioDraftLossStandsMock).toHaveBeenCalledWith(SCENARIO_ID);
  });

  it('CONTROL: no standing loss → byte-identical assistant_text (no notice)', async () => {
    draftLossStandsForRead = false;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload('Should we expand into the German market?'),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text.includes(DRAFT_LOSS_NOTICE)).toBe(false);
  });

  it('CONTROL: a turn that carries a fresh committed graph does NOT prepend the notice (the loss just healed)', async () => {
    draftLossStandsForRead = true;
    dispatchDraftGraphMock.mockResolvedValue(
      makeDraftMockResult({
        commitPerformed: true,
        graph: { nodes: [{ id: 'n1', kind: 'factor', label: 'X' }], edges: [] },
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text.includes(DRAFT_LOSS_NOTICE)).toBe(false);
  });

  // ═══ The unstranding term — the notice's promise must be keepable ═══════

  it('while the loss stands, a re-sent COMPLETE brief DRAFTS even on a continuation scenario', async () => {
    draftLossStandsForRead = true;
    hasPriorTurnsForRead = true; // e.g. the interrupt question committed

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: with no standing loss, a continuation scenario still suppresses the draft shortcut', async () => {
    draftLossStandsForRead = false;
    hasPriorTurnsForRead = true;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });
});
