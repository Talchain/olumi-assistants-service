/**
 * A USER-VISIBLE REFUSAL MUST BE COUNTABLE AS A REFUSAL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, measured on a real session (debug export 44e349fa, scenario
 * 9677de7d-0af8-4bee-b2ac-0e63b45aff8e, 2026-09-14):
 *
 *     recent_conversation_turns: captured 18 | failed 0 | answered 17
 *
 * TWO of those turns told the user *"I couldn't complete that change, and
 * nothing in your model has changed"*, and BOTH are recorded `outcome:
 * answered`, `completed: true`, `status: 200`. The product's own instruments
 * report that session as flawless — which is why the defect went unnoticed and
 * why a first Render query for it returned zero: there was no error to find.
 *
 * ⭐ WHY THE ASSERTION IS AT THE ROUTE, NOT AT THE COMPOSER. The claim under
 * test is "the USER received a refusal". Only the bytes leaving
 * `sendFinalised200` support that claim; a composer-level assertion would pass
 * on a refusal that was later recovered and never shipped.
 *
 * ⚠ THE TWIN ARM IS THE LOAD-BEARING ONE (CLAUDE.md trap 22b). A counter that
 * fires on everything is as useless as one that fires on nothing, and the
 * obvious wrong predicate — `v5.edit_graph.turn` outcome `rejected` — is
 * WITNESSED conflating the two: the same session logged
 * `outcome="rejected" branch="clarify" failure_code=null` at 17:12:57Z for a
 * turn whose user-visible text was a QUESTION. So every refusal arm here is
 * paired with a non-refusal arm that must NOT emit.
 *
 * Live corpus behind the fixtures (deployed staging, 2026-09-14, scenario
 * 95c3dcdc-ec4d-4824-a0d8-42d02c2ba81c) — driven, not imagined:
 *   REFUSAL      "delete the outcome node" -> blocks [error/warn ORPHAN_NODE]
 *   REFUSAL      "remove every option"     -> blocks [error/warn FEWER_THAN_TWO_OPTIONS]
 *   NOT refusal  applied edit              -> blocks []
 *   NOT refusal  no-op fallback copy       -> blocks []
 *   NOT refusal  held proposal             -> blocks [held_proposal]
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { _resetConfigCache } from '../../config/index.js';

const runtimeMocks = vi.hoisted(() => ({
  understandOpenFrameIntake: vi.fn(),
  dispatchDraftGraph: vi.fn(),
  dispatchEditGraph: vi.fn(),
  runTurnExecutor: vi.fn(),
}));

vi.mock('../../orchestrator-v5/routing/open-frame-intake.js', () => ({
  understandOpenFrameIntake: runtimeMocks.understandOpenFrameIntake,
}));
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: runtimeMocks.dispatchDraftGraph,
}));
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: runtimeMocks.dispatchEditGraph,
}));
vi.mock('../../orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runtimeMocks.runTurnExecutor,
}));

// ── Session store: the ONE fact under test is what `loadGraph` does ────────
/** `null` ⇒ no persisted graph (the defect's precondition). */
let persistedGraphForRead: unknown = null;
/** `true` ⇒ `loadGraph` throws ⇒ `session_store_failed`. */
let loadGraphThrows = false;
let hasPriorTurnsForRead = false;

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => {
      if (loadGraphThrows) throw new Error('simulated session store failure');
      return persistedGraphForRead;
    },
    loadGraphAndBriefText: async () => ({
      graph: loadGraphThrows ? null : persistedGraphForRead,
      briefText: null,
    }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => hasPriorTurnsForRead,
    countTurns: async () => 0,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

/** Any model call outside the explicitly mocked semantic/dispatch seams fails. */
const chatWithToolsMock = vi.fn().mockImplementation(async () => {
  throw new Error('unexpected unmocked LLM call');
});
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

// The production constants themselves — this file and the guard cannot drift
// apart on the chip copy or the recovery copy (CLAUDE.md trap 12).
const { ceeOrchestratorRouteV2 } = await import('../route-v2.js');

const SCENARIO_ID = '23880000-2388-4388-8388-238823882388';

function modelRoute(route: 'start_model' | 'continue_conversation') {
  runtimeMocks.understandOpenFrameIntake.mockResolvedValueOnce({
    route,
    source: 'model' as const,
    model: 'test-frontier-model',
    latencyMs: 7,
    inputTokens: 18,
    outputTokens: 2,
  });
}

let events: Array<{ name: string; data: Record<string, unknown> }> = [];
let priorTraceFlag: string | undefined;

function post(app: FastifyInstance, message: string) {
  return app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: '23881111-2388-4388-8388-238823881111',
      scenario_id: SCENARIO_ID,
      stage: 'frame',
      turn_class: 'frame',
      message,
      source: 'composer',
    },
  });
}

/**
 * Drive one conversation turn whose composed response carries EXACTLY the
 * given blocks. The blocks are the only variable across every arm below, so a
 * difference in outcome is attributable to them and to nothing else.
 */
function mockTurnWithBlocks(assistantText: string, blocks: unknown[]): void {
  runtimeMocks.runTurnExecutor.mockResolvedValueOnce({
    response: {
      response_version: 2,
      assistant_text: assistantText,
      blocks,
      suggested_actions: [],
      insights: [],
      stage_indicator: 'frame',
    },
    analysisReady: undefined,
    effectiveGraph: null,
    answerKind: 'substantive',
    mayNameLeadingOption: true,
    mayNameLeadingOptionProvenance: { kind: 'no_analysis' },
    telemetry: {
      stages_completed: ['orient', 'compose', 'commit'],
      response_emitted: true,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      turn_class: 'explore',
      intent_class: 'converse',
      coaching_mode: null,
      validation_error_code: null,
    },
  });
}

function refusalEvents(): Array<Record<string, unknown>> {
  return events.filter((e) => e.name === TelemetryEvents.CeeTurnRefused).map((e) => e.data);
}

/** The exact wire block a refused edit ships, measured on deployed staging. */
function editRefusalBlock(rejectionCode: string) {
  return {
    type: 'error',
    error_code: 'INTERNAL_ERROR',
    severity: 'warn',
    details: { source: 'edit_graph', rejection_code: rejectionCode },
  };
}

describe('a user-visible refusal is countable as a refusal', () => {
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
    persistedGraphForRead = null;
    loadGraphThrows = false;
    hasPriorTurnsForRead = true;
    events = [];
    setTestSink((name, data) => {
      events.push({ name, data: data as Record<string, unknown> });
    });
    runtimeMocks.understandOpenFrameIntake.mockReset();
    runtimeMocks.dispatchDraftGraph.mockReset();
    runtimeMocks.dispatchEditGraph.mockReset();
    runtimeMocks.runTurnExecutor.mockReset();
    chatWithToolsMock.mockClear();
    appendMock.mockClear();
  });

  // ── THE DEFECT ARM ────────────────────────────────────────────────────────

  it('emits cee.turn.refused, joinable by BOTH request_id and scenario_id, when a refusal ships', async () => {
    modelRoute('continue_conversation');
    mockTurnWithBlocks(
      "I couldn't complete that change, and nothing in your model has changed. "
        + 'Try again in a moment, or describe the change a different way.',
      [editRefusalBlock('OPERATION_DID_NOT_LAND')],
    );

    const res = await post(app, 'Set the churn factor to 4%.');
    expect(res.statusCode).toBe(200);

    const refusals = refusalEvents();
    expect(refusals).toHaveLength(1);

    // request_id AND scenario_id together — the whole point. Before this
    // change no single event carried both, so a refusal seen in the logs could
    // not be joined to the session it happened in.
    expect(refusals[0].scenario_id).toBe(SCENARIO_ID);
    expect(typeof refusals[0].request_id).toBe('string');
    expect((refusals[0].request_id as string).length).toBeGreaterThan(0);

    // The producer's OWN code, not a re-spelling of it.
    expect(refusals[0].refusal_code).toBe('OPERATION_DID_NOT_LAND');
    expect(refusals[0].refusal_source).toBe('edit_graph');
    expect(refusals[0].error_code).toBe('INTERNAL_ERROR');
    expect(refusals[0].severity).toBe('warn');
  });

  it('counts the OTHER measured rejection codes too — the counter is not bound to one symptom', async () => {
    for (const code of ['ORPHAN_NODE', 'FEWER_THAN_TWO_OPTIONS'] as const) {
      events = [];
      modelRoute('continue_conversation');
      mockTurnWithBlocks('I wasn’t able to apply that change.', [editRefusalBlock(code)]);
      await post(app, 'Remove every option from the model.');
      const refusals = refusalEvents();
      expect(refusals, `rejection code ${code}`).toHaveLength(1);
      expect(refusals[0].refusal_code, `rejection code ${code}`).toBe(code);
    }
  });

  // ── THE TWIN ARMS: these are answers, and must NOT be counted ─────────────

  it('does NOT count a clarification — the product asking a question is not the product refusing', async () => {
    modelRoute('continue_conversation');
    mockTurnWithBlocks(
      'Which option should I update: Raise Price to £54 (Soft Increase) or Hold Price at £49?',
      [],
    );

    const res = await post(app, 'Change the price.');
    expect(res.statusCode).toBe(200);
    expect(refusalEvents()).toHaveLength(0);
  });

  it('does NOT count an ordinary answered turn', async () => {
    modelRoute('continue_conversation');
    mockTurnWithBlocks('Raising price to £59 leads in 72% of simulations.', []);

    await post(app, 'What does the analysis say?');
    expect(refusalEvents()).toHaveLength(0);
  });

  it('does NOT count a held proposal, which carries a block but is not a refusal', async () => {
    modelRoute('continue_conversation');
    // Schema-valid HeldProposalBlockSchema. ⚠ An INVALID block here does not
    // merely fail the fixture — egress validation replaces the whole body with
    // the fallback envelope, which carries a real error block, and this arm
    // then fires for a reason that has nothing to do with held proposals. That
    // is not a flaw in the counter (see the arm below); it is why this fixture
    // is pinned to the published schema's required fields.
    mockTurnWithBlocks("Heads up: that option has no effect values yet. I'm holding these changes.", [
      {
        type: 'held_proposal',
        proposal_id: 'p1',
        summary: 'Add an option to discontinue the Pro plan',
        mutation_class: 'structural',
        reason_code: 'ADD_OPTION_APPLY_UNWIRED',
        confirm_action_id: 'confirm-1',
      },
    ]);

    await post(app, 'Add an option to discontinue the Pro plan.');
    expect(refusalEvents()).toHaveLength(0);
  });

  it('DOES count an egress-validation failure — the user receives an error block, so it is a refusal', async () => {
    // Found while writing the arm above: a body that fails egress validation is
    // replaced by the validator-built fallback, which ships
    // `error_code: EGRESS_CONTRACT_VIOLATION`. The user genuinely receives a
    // failure, so counting it is correct — recorded as its own arm rather than
    // left as a surprise inside another test.
    modelRoute('continue_conversation');
    mockTurnWithBlocks('This body will not validate.', [
      { type: 'held_proposal', proposal_id: 'p1' },
    ]);

    await post(app, 'Add an option.');
    const refusals = refusalEvents();
    expect(refusals).toHaveLength(1);
    expect(refusals[0].scenario_id).toBe(SCENARIO_ID);
  });

  it('counts a refusal EXACTLY ONCE per turn, even when the response carries other blocks', async () => {
    modelRoute('continue_conversation');
    // ⚠ Both blocks must be SCHEMA-VALID. An invalid companion block fails
    // egress validation, and the fallback envelope's own error block then
    // satisfies a bare `toHaveLength(1)` — so this arm would pass while the
    // predicate ignored edit refusals entirely (CLAUDE.md trap 19: a test that
    // passes on a different object than the one it was written for). The
    // identity assertions below are what bind it to THIS refusal.
    mockTurnWithBlocks('I wasn’t able to apply that change.', [
      { type: 'text', content: 'Consider the outside view.' },
      editRefusalBlock('ORPHAN_NODE'),
    ]);

    await post(app, 'Delete the outcome node.');
    const refusals = refusalEvents();
    expect(refusals).toHaveLength(1);
    // Identity, not a value predicate another object could satisfy: the
    // fallback envelope ships EGRESS_CONTRACT_VIOLATION / null, so these two
    // assertions fail if this fired for any reason but the block under test.
    expect(refusals[0].error_code).toBe('INTERNAL_ERROR');
    expect(refusals[0].refusal_code).toBe('ORPHAN_NODE');
  });
});
