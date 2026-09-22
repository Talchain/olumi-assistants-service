/**
 * ⭐⭐⭐ THE STRUCTURAL-PARSE 500 MUST SPEAK. IT IS 16 OF TODAY'S 16 DRAFT 500s.
 *
 * ── THE DEFECT, AS MEASURED ON DEPLOYED STAGING ───────────────────────────
 * `Staging Journey Smoke`, run 35607125991, head `5104b244`:
 *     OBSERVED DRAFT FAILURE RATE: 40.0%
 *     turn 1: HTTP 500 in 29.1s | exit_path=draft_graph_error
 *       draft_error: error="INTERNAL_ERROR" reason="draft_graph_cee_graph_invalid"
 *         violation_code=absent repair_skip_reason=absent retryable=false
 *         recovery_suggestion=absent timed_out=false
 *       ✗ turn 1: assistant_text was empty — the response carried no reply prose
 *
 * Render `cee-staging` (srv-d4slpaili9vc73eiq4og), window 2026-09-21T00:00Z..
 * 23:59Z, BOTH log queries untruncated (`hasMore: false`): 16 draft 500s, 16
 * `cee.structural_parse.failed`, overlap 16, non-structural-parse 500s ZERO.
 *
 * ── WHY IT DID NOT SPEAK ──────────────────────────────────────────────────
 * `composeDraftFailureRecoveryTurn` already exists and is correct. The route
 * gated it on `isPostEnforcementBlock(details.validation_error_codes)` — a
 * signature emitted by exactly ONE site, the post-enforcement gate. The
 * structural-parse emitter emits none, so the gate read false and the request
 * fell through to the bare 500. route-v2.ts:5459-5463 named this in terms:
 * "EVERY other failure class on this path keeps today's 500 ... THAT IS THE
 * RESIDUAL." This suite closes the residual for the ONE class that is
 * measurably all of it, and deliberately not for the others.
 *
 * ── WHAT THIS SUITE ASSERTS, AND WHAT IT DOES NOT ─────────────────────────
 * It asserts the WIRE CONTRACT: a readable turn, a reference the user can send
 * us, a named fault, and NO graph. It asserts NOTHING about recovery rates —
 * no copy shipped by this change claims a retry will succeed, and the producer
 * deliberately composes no recovery sentence, so the route's already-reviewed
 * olumi-fault fallback speaks and promises nothing.
 *
 * RED at pristine `5104b244`: the gate admits only post-enforcement codes, so
 * this envelope returns 500 with an empty `assistant_text`.
 *
 * Harness is `route-v2-draft-failure-speaks.test.ts`'s, reused VERBATIM (sliced
 * from that file rather than retyped) so both suites drive ONE failure envelope
 * rather than two invented ones.
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

import { OLUMI_FAULT_FALLBACK_READABLE } from '../../orchestrator-v5/draft-failure-recovery-turn.js';
import { STRUCTURAL_PARSE_BLOCK_REASON } from '../../cee/unified-pipeline/stages/repair/structural-parse.js';

/**
 * THE MEASURED FAILURE, AS THE PRODUCER NOW EMITS IT.
 *
 * Not a shape imagined at the desk (trap 22). Every field is derived from the
 * deployed emission traced on 2026-09-21:
 *   · `pipelineStatusCode: 400`  — the value carried in the staging log line
 *     "V5 draft_graph pipeline threw — returning 500 BoundaryError"
 *     (`pipeline_status_code: 400`), which is what separates this emitter from
 *     the post-enforcement gate's 422.
 *   · `pipelineReason` — the producer's own exported constant, IMPORTED here
 *     rather than spelled again, so a rename moves this fixture with it.
 *   · `pipelineRetryable: true` — the producer's declaration.
 *   · `pipelineRecovery: null` and `pipelineDetails: null` — the producer
 *     composes no sentence and emits no allowlisted diagnostic, which is
 *     exactly why the wire read `recovery_suggestion=absent`.
 */
function structuralParseFailureThrow() {
  return Object.assign(new Error('CEE_GRAPH_INVALID'), {
    pipelineStatusCode: 400,
    pipelineErrorCode: 'CEE_GRAPH_INVALID',
    pipelineReason: STRUCTURAL_PARSE_BLOCK_REASON,
    pipelineRetryable: true,
    pipelineRecovery: null,
    pipelineDetails: null,
  });
}

describe('POST /orchestrate/v2/turn — the structural-parse draft 500 speaks instead of dying', () => {
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

  it('THE ACCEPTANCE CONDITION: the user gets a readable 200, never a bare 500 with empty prose', async () => {
    dispatchDraftGraphMock.mockRejectedValue(structuralParseFailureThrow());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // The single worst thing the product did: an empty reply on a 500.
    expect(typeof body.assistant_text).toBe('string');
    expect(body.assistant_text.trim().length).toBeGreaterThan(0);
  });

  it('speaks the reviewed OLUMI-FAULT sentence verbatim, and blames nothing the user wrote', async () => {
    dispatchDraftGraphMock.mockRejectedValue(structuralParseFailureThrow());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    const body = JSON.parse(res.body);

    // Bound BY IDENTITY to the composer's own exported constant, never a
    // substring another sentence could satisfy (trap 19). The producer composes
    // no recovery sentence for this class, so this fallback is what speaks —
    // and it is already-reviewed copy that claims nothing about a retry.
    expect(body.assistant_text).toContain(OLUMI_FAULT_FALLBACK_READABLE);

    // It must NOT tell the user their brief was deficient. Every measured
    // failure here is one stochastic field, not a bad brief, and the cruel
    // inversion (asking for a vaguer/longer brief) is documented estate-wide.
    expect(body.assistant_text).not.toMatch(/be more specific|add more detail|too vague/i);
    // …and it must not leak the internal schema path at the user.
    expect(body.assistant_text).not.toMatch(/observed_state|invalid_union|DraftGraphOutput|Zod/);
  });

  it('carries a reference the user can send us, and it is the id the turn was served under', async () => {
    dispatchDraftGraphMock.mockRejectedValue(structuralParseFailureThrow());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    const body = JSON.parse(res.body);

    const errorBlock = (body.blocks ?? []).find(
      (b: { type?: string }) => b.type === 'error',
    );
    expect(errorBlock, 'the failure must be a user-visible block, not silence').toBeDefined();
    expect(typeof errorBlock.details.request_id).toBe('string');
    expect(errorBlock.details.request_id.length).toBeGreaterThan(0);
    // The SAME id, not a fresh one, or it diagnoses nothing.
    expect(body.assistant_text).toContain(errorBlock.details.request_id);

    // This class is OURS: our repair pipeline declared the graph valid and our
    // own output schema then rejected it.
    expect(errorBlock.details.fault).toBe('olumi');
    expect(errorBlock.details.readable).toBe(OLUMI_FAULT_FALLBACK_READABLE);
    expect(errorBlock.details.reason).toBe('draft_graph_cee_graph_invalid');
    // The producer's declaration survived the hop, rather than being floored.
    expect(errorBlock.details.retryable).toBe(true);
  });

  it('ships NO graph and does not advance the stage', async () => {
    dispatchDraftGraphMock.mockRejectedValue(structuralParseFailureThrow());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    const body = JSON.parse(res.body);

    // Nothing partial, nothing invented: no gutted model to mistake for a
    // whole one. The safety argument is structural, not a matter of care.
    expect(body.draft_graph).toBeUndefined();
    expect(body.stage_indicator).toBe('frame');
  });

  it('commits the turn, so the next message arrives at a route that remembers it', async () => {
    dispatchDraftGraphMock.mockRejectedValue(structuralParseFailureThrow());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    expect(res.statusCode).toBe(200);

    // An uncommitted answer is worse than the 500 it replaces.
    expect(appendMock).toHaveBeenCalled();
    expect(markGraphWriteFailedMock).not.toHaveBeenCalled();
  });

  it('offers the one-tap retry, because the producer declared the failure retryable', async () => {
    dispatchDraftGraphMock.mockRejectedValue(structuralParseFailureThrow());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });
    const body = JSON.parse(res.body);

    const chips = (body.suggested_actions ?? []) as Array<{ id: string; label: string }>;
    expect(chips.length).toBe(1);
    expect(chips[0].label).toBe('Try again');
  });

  /**
   * ⭐ THE DISCRIMINATING TWIN (trap 19). The gate must bind to THIS producer's
   * reason, not merely to "some draft failure". A sibling class that the
   * residual deliberately still covers must keep today's 500 — otherwise the
   * change silently widened to failure classes whose honest remedy differs and
   * whose copy nobody reviewed.
   */
  it('a DIFFERENT failure class with no producer signature still keeps today\'s 500', async () => {
    dispatchDraftGraphMock.mockRejectedValue(
      Object.assign(new Error('CEE_TIMEOUT'), {
        pipelineStatusCode: 504,
        pipelineErrorCode: 'CEE_TIMEOUT',
        pipelineReason: null,
        pipelineRetryable: null,
        pipelineRecovery: null,
        pipelineDetails: null,
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(500);
  });
});
