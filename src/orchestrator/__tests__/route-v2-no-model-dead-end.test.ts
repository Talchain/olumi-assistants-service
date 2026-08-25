/**
 * THE NO-MODEL CONTINUATION DEAD END — a user who wants a model and has none
 * must be able to obtain one.
 *
 * ── The invariant, stated against the SPEC, not against a failure mode ──
 * Olumi's Core journey begins by turning a decision brief into a shared model.
 * Whatever else is true of a scenario, a user who (a) has NO model and (b)
 * sends a decision brief must end up with a model drafted. That is the claim
 * this suite pins. It is deliberately NOT phrased as "this particular
 * condition combination is handled".
 *
 * ── What was broken ──
 * `route-v2`'s refresh-continuation guard (V5 Signature Loop, commit
 * c24d38dac) suppresses the draft shortcut once a scenario has prior turns.
 * It was written to stop a UI REFRESH being misread as a fresh brief and the
 * assistant "starting over" on a decision that already has a model — a real
 * and important protection.
 *
 * But the guard keys on the SCENARIO having history, never on whether a model
 * actually exists. So:
 *
 *     continuation  +  NO persisted model  +  a decision brief   →  no draft
 *
 * and, because re-sending the brief is suppressed by the same term, that state
 * was a STANDING dead end rather than a transient one. The two pre-existing
 * escape hatches do not cover it: `draftOfferMarker` requires the last
 * committed turn to have been a draft offer, and `draftLossRedraftUnstrand`
 * requires a failure-marked fence row. A user who simply chatted first, then
 * asked for a model, matched neither.
 *
 * PR #1098 replaced the false capability denial on this path with honest copy
 * that ends "Tell me the decision you're weighing and the options you're
 * choosing between, and I'll draft it." That sentence made the hole VISIBLE —
 * and made it a promise the classifier could not keep. This suite makes it
 * keepable, which is the same standard ROADMAP 2.709 invariant 6 already set
 * for the draft-loss notice ("a promise the classifier does not keep is a
 * dead-end").
 *
 * ── Both directions ──
 * The guard's protection is preserved and pinned here, not traded away:
 *   · CLOBBER — a mid-conversation brief on a scenario that HAS a persisted
 *     model must still be refused the draft shortcut (the refresh case the
 *     guard exists for);
 *   · INVARIANT 3 — a scenario whose continuation comes from an IN-FLIGHT
 *     admitted draft (fence row, zero committed rows, no persisted graph yet)
 *     must still be refused. This is the fresh-journey P0's S2, and it shares
 *     the "no persisted graph" signature with the dead end — narrowing on
 *     persisted-model presence ALONE would have re-opened it;
 *   · FAIL-CLOSED — when the persisted-state read fails, model presence is
 *     unknown and the guard must hold, matching the explicit-generate path's
 *     stated doctrine (never draft over a graph that might exist).
 *
 * Harness mirrors route-v2-draft-loss-p0.test.ts (real route, mocked session
 * store + LLM router + dispatchDraftGraph detector).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { _resetConfigCache } from '../../config/index.js';
import { GraphV3 } from '../../schemas/cee-v3.js';

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
/** When true, `loadGraph` throws — the store-unreachable class. */
let loadGraphThrows = false;

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const loadGraphMock = vi.fn(async () => {
  if (loadGraphThrows) throw new Error('session store unreachable');
  return persistedGraphForRead;
});
const hasOtherAdmittedLiveTurnMock = vi.fn(async () => hasOtherAdmittedLiveTurnForRead);
const scenarioDraftLossStandsMock = vi.fn(async () => draftLossStandsForRead);
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
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({
      graph: persistedGraphForRead,
      briefText: persistedBriefTextForRead,
    }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
    hasPriorTurns: async () => hasPriorTurnsForRead,
    hasOtherAdmittedLiveTurn: hasOtherAdmittedLiveTurnMock,
    scenarioDraftLossStands: scenarioDraftLossStandsMock,
    markGraphWriteFailed: async () => undefined,
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

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const TURN_ID = '99999999-9999-4999-8999-999999999999';

/**
 * A decision brief. Draft-shaped by `isDraftShapedText` (length + decision
 * verb) and not a process-meta question, so the ONLY thing that can stop it
 * drafting is the continuation guard.
 */
const COMPLETE_BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

/** Not draft-shaped — shape must keep governing after the fix. */
const UNSHAPED_MESSAGE = 'ok thanks';

/** Minimal strict GraphV3 fixture — "this scenario HAS a model". */
const STRICT_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'goal-g', kind: 'goal', label: 'The goal' },
    {
      id: 'fac-f',
      kind: 'factor',
      label: 'A factor',
      observed_state: { value: 0.1, raw_value: 5, cap: 50 },
    },
  ],
  edges: [
    {
      from: 'fac-f',
      to: 'goal-g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};
{
  const parsed = GraphV3.safeParse(STRICT_GRAPH);
  if (!parsed.success) {
    throw new Error('Fixture failed GraphV3.safeParse: ' + JSON.stringify(parsed.error.issues));
  }
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

function makeDraftMockResult() {
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

describe('POST /orchestrate/v2/turn — the no-model continuation dead end', () => {
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
    loadGraphMock.mockClear();
    hasOtherAdmittedLiveTurnMock.mockClear();
    scenarioDraftLossStandsMock.mockClear();
    persistedGraphForRead = null;
    persistedBriefTextForRead = null;
    hasPriorTurnsForRead = false;
    hasOtherAdmittedLiveTurnForRead = false;
    draftLossStandsForRead = false;
    pendingActionsForRead = [];
    loadGraphThrows = false;
  });

  // ═══ THE SPEC INVARIANT ═════════════════════════════════════════════════

  it('THE DEAD END: a user with NO model who sends a decision brief GETS a model, even after prior turns', async () => {
    // The user chatted first (committed turns), never got a model, and now
    // asks for one. No draft is in flight, and nothing is persisted.
    hasPriorTurnsForRead = true;
    hasOtherAdmittedLiveTurnForRead = false;
    persistedGraphForRead = null;
    draftLossStandsForRead = false; // NOT the 2.709 loss-notice route

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  // ═══ THE GUARD'S PROTECTION — preserved, not traded away ════════════════

  it('CLOBBER CASE: a mid-conversation brief on a scenario that HAS a model is still refused the draft shortcut', async () => {
    // This is the refresh-continuation case the guard was written for: same
    // scenario_id, stage=frame, no graph on the REQUEST — but a model exists
    // server-side. Drafting here would start over on a live decision.
    hasPriorTurnsForRead = true;
    hasOtherAdmittedLiveTurnForRead = false;
    persistedGraphForRead = STRICT_GRAPH;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });

  it('INVARIANT 3 PRESERVED: a brief arriving while a draft is IN FLIGHT is still refused (S2, same no-persisted-graph signature)', async () => {
    // The fresh-journey P0's S2 shares the dead end's signature exactly —
    // zero committed rows, NOTHING persisted yet — and differs only by the
    // fence row. Narrowing the guard on persisted-model presence alone would
    // have re-opened it, so the fence is consulted before the lift.
    hasPriorTurnsForRead = false;
    hasOtherAdmittedLiveTurnForRead = true;
    persistedGraphForRead = null;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    // Identity-bound: this scenario, excluding THIS turn id.
    expect(hasOtherAdmittedLiveTurnMock).toHaveBeenCalledWith(SCENARIO_ID, TURN_ID);
  });

  it('INVARIANT 3 PRESERVED: an in-flight draft blocks the lift even when the scenario ALSO has committed turns', async () => {
    // The committed-rows read short-circuits the fence read in the
    // continuation predicate, so this combination is the one where a lift
    // could consult a fence answer it never measured.
    hasPriorTurnsForRead = true;
    hasOtherAdmittedLiveTurnForRead = true;
    persistedGraphForRead = null;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: when the persisted-state read fails, model presence is unknown and the guard HOLDS', async () => {
    hasPriorTurnsForRead = true;
    hasOtherAdmittedLiveTurnForRead = false;
    loadGraphThrows = true;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });

  // ═══ Controls ═══════════════════════════════════════════════════════════

  it('CONTROL (contrast): a fresh scenario with no model still drafts — the harness CAN produce a draft', async () => {
    hasPriorTurnsForRead = false;
    hasOtherAdmittedLiveTurnForRead = false;
    persistedGraphForRead = null;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: shape still governs — an unshaped message on the same no-model continuation does NOT draft', async () => {
    hasPriorTurnsForRead = true;
    hasOtherAdmittedLiveTurnForRead = false;
    persistedGraphForRead = null;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(UNSHAPED_MESSAGE),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });

  it('CONTROL: a chip_click carrying the same brief text does NOT draft (the heuristic never captures product-authored text)', async () => {
    hasPriorTurnsForRead = true;
    hasOtherAdmittedLiveTurnForRead = false;
    persistedGraphForRead = null;

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF, { source: 'chip_click' }),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });
});
