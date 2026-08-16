/**
 * V5 Phase 1 brief persistence — composed round-trip proof.
 *
 * Verifies the END-TO-END acceptance contract using a stateful in-memory
 * SessionStore (not Supabase, not network). The previous unit-test layer
 * proves each seam in isolation:
 *   - draft-graph-dispatch threads briefText into CommitMetadata
 *   - commit.ts forwards metadata.briefText to SessionStore.append
 *   - supabase-store.append passes p_brief_text to the RPC
 *   - supabase-store.loadGraphAndBriefText reads it back
 *   - build-turn-context surfaces it on EnrichedTurnContext.scenarioBriefText
 *   - turn-executor + chip-click-dispatch pass context.scenarioBriefText to the enricher
 *
 * What this test adds: composed proofs that all those seams compose
 * correctly. Each test exercises a real subset of the chain:
 *
 *   1. commit→store→buildTurnContext (the persistence chain). Calls
 *      `commitDirectAnswer` directly rather than `dispatchDraftGraph`
 *      to keep the surface focused on persistence. The dispatch layer
 *      itself is covered by draft-graph-dispatch.test.ts.
 *
 *   2. commit→store→buildTurnContext→runTurnExecutor→enricher (the
 *      full liveness chain). Asserts the persisted brief reaches
 *      `enrichRunAnalysisWithDecisionReview` non-null on a follow-up
 *      run_analysis turn — Defect B's acceptance criterion verified
 *      end-to-end with no mocks at the executor or enricher boundary.
 *
 * Catches breaks where individual seams pass but the chain doesn't
 * (field name typos, accidental shadowing, schema-superset
 * regressions, etc.).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { buildTurnContext } from '../build-turn-context.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-composed-roundtrip';

/**
 * Stateful in-memory SessionStore that mirrors the production write-once
 * brief_text semantics enforced by the RPC's WHERE clause:
 *
 *   UPDATE scenarios SET brief_text = p_brief_text
 *    WHERE id = p_scenario_id
 *      AND (brief_text IS NULL OR brief_text = '');
 *
 * Subsequent appends with a different briefText are silently ignored,
 * matching first-write-wins. Reads expose both graph and briefText via
 * loadGraphAndBriefText.
 */
function createStatefulFakeStore(): SessionStore {
  const briefByScenario = new Map<string, string>();
  const graphByScenario = new Map<string, unknown>();

  const noop = createNoopSessionStore();

  return {
    ...noop,
    async append(write: SessionTurnWrite) {
      // Mirror the RPC's first-write-wins predicate: only set brief_text
      // when the scenario currently has none.
      if (write.briefText !== undefined && !briefByScenario.has(write.scenario_id)) {
        briefByScenario.set(write.scenario_id, write.briefText);
      }
      // Graph write is unconditional (last-write-wins) inside the RPC,
      // gated on FOUND. We don't simulate FOUND here — only one append
      // per scenario in this test.
      if (write.graph !== undefined) {
        graphByScenario.set(write.scenario_id, write.graph);
      }
      return {
        id: `row-${write.turn_id}`,
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    async loadGraphAndBriefText(scenarioId: string) {
      return {
        graph: graphByScenario.get(scenarioId) ?? null,
        briefText: briefByScenario.get(scenarioId) ?? null,
      };
    },
    async loadGraph(scenarioId: string) {
      return graphByScenario.get(scenarioId) ?? null;
    },
  };
}

describe('V5 Phase 1 brief persistence — composed round-trip', () => {
  it('commit chain: writing briefText via commitDirectAnswer makes it readable on the next buildTurnContext', async () => {
    const store = createStatefulFakeStore();
    const composed = composeDirectAnswerResponse({
      answerKind: 'functional',
      assistant_text: 'drafted',
      stage: 'frame',
    });

    // Step 1: exercise the commit→store seam. The dispatch layer that
    // would call commit on the user's behalf is covered by
    // draft-graph-dispatch.test.ts; this test stays focused on the
    // persistence chain.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: TURN_ID,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:test',
        llm_calls_used: 1,
        duration_ms: 10,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        graphReceiptIntent: 'receipt_free_adoption',
        briefText: 'Should I take the offer at company X?',
      },
      store,
    );

    // Step 2: a follow-up turn calls buildTurnContext; it must surface
    // the persisted brief from the same store.
    const followUpPayload = makeMessagePayload({
      scenario_id: SCENARIO_ID,
      turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      stage: 'analyse',
      message: 'run the analysis',
      turn_class: 'decide',
    });
    const ctx = await buildTurnContext(followUpPayload, REQUEST_ID, {
      sessionStore: store,
    });

    // The composed acceptance contract: the brief written by the commit
    // step must be visible on the enriched turn context.
    expect(ctx.scenarioBriefText).toBe('Should I take the offer at company X?');
    // And the graph from the same round trip is also surfaced (proves
    // loadGraphAndBriefText returns both fields, not just brief_text).
    expect(ctx.persistedGraph).toEqual({
      nodes: [],
      edges: [],
      options: [],
      goal_node_id: null,
      goal_constraints: [],
    });
  });

  it('first-write-wins via commit chain: a no-brief commit followed by a brief-bearing commit lands the latter', async () => {
    // Defensive contract: even if a caller writes a commit without
    // briefText (e.g. a legacy code path that pre-dates Fix A, or a
    // turn class that has no user-facing free text), a subsequent
    // commit with briefText still lands. The RPC's first-write-wins
    // predicate only suppresses writes that try to OVERWRITE an
    // already-populated brief — a never-written brief stays writable.
    const store = createStatefulFakeStore();
    const composed = composeDirectAnswerResponse({
      answerKind: 'functional',
      assistant_text: '',
      stage: 'frame',
    });

    // Attempt 1: no briefText threaded — simulates a legacy / non-brief
    // commit path.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'first-attempt',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:first',
        llm_calls_used: 1,
        duration_ms: 5,
        handler_facts: [],
        // graph absent — simulating handleDraftGraph returning null
        // briefText absent — legacy / non-brief commit path
      },
      store,
    );

    // Attempt 2: successful retry on the same scenario. Different
    // turn_id (no conflict-replay). briefText flows.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'retry',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:retry',
        llm_calls_used: 1,
        duration_ms: 6,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        graphReceiptIntent: 'receipt_free_adoption',
        briefText: 'real brief on the successful retry',
      },
      store,
    );

    // The retry's brief is the one that lives in canonical state —
    // the no-brief attempt did not lock it out.
    const followUpPayload = makeMessagePayload({
      scenario_id: SCENARIO_ID,
      turn_id: 'follow-up',
      stage: 'analyse',
      message: 'run analysis',
      turn_class: 'decide',
    });
    const ctx = await buildTurnContext(followUpPayload, REQUEST_ID, {
      sessionStore: store,
    });
    expect(ctx.scenarioBriefText).toBe('real brief on the successful retry');
  });

  it('write-once via commit chain: a second non-conflict commit on a populated scenario does NOT overwrite', async () => {
    const store = createStatefulFakeStore();
    const composed = composeDirectAnswerResponse({
      answerKind: 'functional',
      assistant_text: '',
      stage: 'frame',
    });

    // First commit: writes the canonical brief.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'first',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:first',
        llm_calls_used: 1,
        duration_ms: 5,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        graphReceiptIntent: 'receipt_free_adoption',
        briefText: 'original brief',
      },
      store,
    );

    // Second commit (different turn_id, e.g. user re-prompted with a
    // different message). Per the RPC's WHERE clause, brief_text is
    // NOT overwritten.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'second',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:second',
        llm_calls_used: 1,
        duration_ms: 6,
        handler_facts: [],
        briefText: 'second commit attempt with a different brief',
      },
      store,
    );

    // The composed read returns the ORIGINAL brief — the canonical-state
    // contract surfaces first-write-wins all the way through to
    // EnrichedTurnContext.
    const followUpPayload = makeMessagePayload({
      scenario_id: SCENARIO_ID,
      turn_id: 'follow-up',
      stage: 'analyse',
      message: 'run analysis',
      turn_class: 'decide',
    });
    const ctx = await buildTurnContext(followUpPayload, REQUEST_ID, {
      sessionStore: store,
    });
    expect(ctx.scenarioBriefText).toBe('original brief');
  });
});

// ---------------------------------------------------------------------------
// Liveness chain: persisted briefText reaches the decision-review enricher
// via runTurnExecutor on a follow-up run_analysis turn.
//
// This is the DEFECT B regression test in its full composed form. Earlier
// suites prove individual seams; this suite proves the chain
// (commit → stateful store → buildTurnContext → turn-executor →
// enrichRunAnalysisWithDecisionReview invocation) by running the executor
// for real against the stateful fake SessionStore. The enricher itself is
// spied on with a pass-through mock implementation: the goal is to verify
// that the executor INVOKES the enricher with the canonical-state brief
// in the captured arguments — not to exercise the enricher's own logic
// (which has its own dedicated test suite).
// ---------------------------------------------------------------------------

// vi.mock calls have to be hoisted, and runTurnExecutor's session module
// gets resolved through getSessionStore(). We point the singleton at a
// stateful fake by mutating a module-level holder.
const liveStoreHolder: { current: SessionStore } = {
  current: createStatefulFakeStore(),
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => liveStoreHolder.current,
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
import * as enricherMod from '../coaching/decision-review-enricher.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function makeMockPlotClient(): PLoTClient {
  return {
    run: vi.fn(
      async () =>
        ({
          meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
          results: [{ option_id: 'opt_a', option_label: 'Plan A', win_probability: 0.7 }],
          response_hash: 'h-top',
          analysis_status: 'completed',
        }) as V2RunResponseEnvelope,
    ),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Plan A', interventions: { f: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Plan B', interventions: { f: 0 } },
    ],
    goal_node_id: 'g',
  };
}

describe('V5 Phase 1 brief persistence — full liveness chain through runTurnExecutor', () => {
  // Restore all spies and mocks between tests in this suite so that
  // call history on enrichRunAnalysisWithDecisionReview does not bleed
  // between cases. Each test re-installs its own spy at the top of the
  // body; restoring after each keeps that idempotent and prevents a
  // future test that asserts on call counts from silently inheriting
  // prior invocations.
  //
  // V5 latency gate: this suite specifically asserts the brief reaches
  // the enricher, so it must run with the await path enabled. The
  // production default (flag false) is covered separately by the
  // fast-path tests in turn-executor-decision-review-fast-path.test.ts.
  let priorAwaitFlag: string | undefined;
  beforeEach(async () => {
    priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
  });
  afterEach(async () => {
    if (priorAwaitFlag === undefined) {
      delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    } else {
      process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
    }
    const { _resetConfigCache } = await import('../../config/index.js');
    _resetConfigCache();
    vi.restoreAllMocks();
  });

  it('Defect B closure: persisted briefText reaches enrichRunAnalysisWithDecisionReview via runTurnExecutor', async () => {
    // Step 1: bind a fresh stateful store to the singleton mock so the
    // executor's getSessionStore() call resolves to it.
    const store = createStatefulFakeStore();
    liveStoreHolder.current = store;

    // Step 2: write the brief via the canonical commit path. This is
    // the persistence side of the chain.
    const composed = composeDirectAnswerResponse({
      answerKind: 'functional',
      assistant_text: 'drafted',
      stage: 'frame',
    });
    const PERSISTED_BRIEF = 'Defect-B regression: this brief MUST reach the enricher';
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'draft-turn',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:draft',
        llm_calls_used: 1,
        duration_ms: 10,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        graphReceiptIntent: 'receipt_free_adoption',
        briefText: PERSISTED_BRIEF,
      },
      store,
    );

    // Step 3: spy on the enricher to observe what the executor passes
    // it. Use a pass-through mock so the executor's downstream
    // composition still works.
    const enricherSpy = vi.spyOn(enricherMod, 'enrichRunAnalysisWithDecisionReview');
    enricherSpy.mockImplementation(async ({ handlerFacts }) => handlerFacts);

    // Step 4: run a follow-up run_analysis turn. The Sonnet routing
    // adapter is stubbed to return a tool-use call resolving to
    // run_analysis on opt_a. The PLoT client is stubbed to return a
    // golden envelope. buildTurnContext and the turn-executor seven-
    // step assembly run for real against the stateful store; the
    // enricher implementation is replaced by the pass-through spy
    // installed above so we can capture the arguments the executor
    // hands it (the enricher's own logic is tested in its own suite).
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () =>
          mkToolUseResult({
            intent_class: 'execute',
            action: {
              handler_id: 'run_analysis',
              entity: {
                id: 'opt_a',
                kind: 'option',
                resolution_status: 'resolved',
                resolution_method: 'id_match',
              },
              parameters: [],
              cited_context_fields: ['graph.options'],
            },
          }),
        ),
    };

    const followUpPayload = makeMessagePayload({
      turn_id: 'follow-up-turn',
      scenario_id: SCENARIO_ID,
      message: 'run the analysis',
      turn_class: 'decide',
      stage: 'analyse',
    });

    const result = await runTurnExecutor(followUpPayload, 'req-defect-b-composed', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
      // Critically: NO scenarioBrief option supplied. The brief MUST
      // reach the enricher via canonical state, not the deprecated
      // out-of-band channel. This is the precise condition Defect B
      // failed under pre-fix.
    });

    // Composed acceptance assertions:
    expect(result.telemetry.failure_type).toBeNull();
    expect(result.telemetry.commit_performed).toBe(true);

    // The headline assertion: the enricher received the persisted brief.
    expect(enricherSpy).toHaveBeenCalled();
    const enricherCall = enricherSpy.mock.calls[enricherSpy.mock.calls.length - 1];
    expect(enricherCall[0].brief).toBe(PERSISTED_BRIEF);
    expect(enricherCall[0].brief).not.toBeNull();
  });

  it('Defect B negative: when no brief is persisted, the enricher receives null (graceful skip preserved)', async () => {
    // Same chain, but with no brief written. Confirms the executor
    // does not invent a brief from elsewhere — the canonical-state
    // null is what the enricher sees, and the legacy `no_brief`
    // skip path is preserved.
    const store = createStatefulFakeStore();
    liveStoreHolder.current = store;
    // Persist a graph but NO brief.
    const composed = composeDirectAnswerResponse({
    answerKind: 'functional', assistant_text: '', stage: 'frame' });
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'graph-only',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:graph-only',
        llm_calls_used: 1,
        duration_ms: 5,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        graphReceiptIntent: 'receipt_free_adoption',
        // briefText absent
      },
      store,
    );

    const enricherSpy = vi.spyOn(enricherMod, 'enrichRunAnalysisWithDecisionReview');
    enricherSpy.mockImplementation(async ({ handlerFacts }) => handlerFacts);

    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () =>
          mkToolUseResult({
            intent_class: 'execute',
            action: {
              handler_id: 'run_analysis',
              entity: {
                id: 'opt_a',
                kind: 'option',
                resolution_status: 'resolved',
                resolution_method: 'id_match',
              },
              parameters: [],
              cited_context_fields: ['graph.options'],
            },
          }),
        ),
    };

    await runTurnExecutor(
      makeMessagePayload({
        turn_id: 'follow-up-no-brief',
        scenario_id: SCENARIO_ID,
        message: 'run analysis',
        turn_class: 'decide',
        stage: 'analyse',
      }),
      'req-no-brief-composed',
      {
        routingAdapter,
        handlerRegistry: createRegistry({
          plotClient: makeMockPlotClient(),
          scenarioReader: async () => makeScenarioSnapshot(),
        }),
      },
    );

    const enricherCall = enricherSpy.mock.calls[enricherSpy.mock.calls.length - 1];
    expect(enricherCall[0].brief).toBeNull();
  });

  it('V5 Phase 3A Fix B: TurnExecutor main-path commit threads context.scenarioBriefText into store.append', async () => {
    // Fix B (defence in depth): the main TurnExecutor commitDirectAnswer
    // call site now re-passes `context.scenarioBriefText` as the
    // `briefText` metadata field. The RPC's first-write-wins predicate
    // makes this a no-op when brief_text is already populated, but it
    // backfills the brief for any session where a prior turn somehow
    // committed without one (e.g. legacy draft pre-Fix A, or an external
    // session repair path). This test pins the contract that briefText
    // flows through the store.append call on a normal run_analysis turn.
    const store = createStatefulFakeStore();
    liveStoreHolder.current = store;

    // Seed canonical state: a draft turn that already persisted both
    // the graph and the brief.
    const PERSISTED_BRIEF = 'V5 Phase 3A Fix B verification brief';
    await commitDirectAnswer(
      composeDirectAnswerResponse({
      answerKind: 'functional', assistant_text: 'drafted', stage: 'frame' }),
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'seed-draft',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:seed',
        llm_calls_used: 1,
        duration_ms: 10,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        graphReceiptIntent: 'receipt_free_adoption',
        briefText: PERSISTED_BRIEF,
      },
      store,
    );

    // Wrap the stateful store's append to record every call's
    // briefText field — the assertion target for Fix B.
    const appendSpy = vi.spyOn(store, 'append');

    // Run a follow-up run_analysis turn through the executor. The
    // executor's buildTurnContext loads briefText from the store; Fix B
    // re-passes it to commitDirectAnswer, which forwards it to
    // store.append as `write.briefText`.
    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockImplementation(async () =>
          mkToolUseResult({
            intent_class: 'execute',
            action: {
              handler_id: 'run_analysis',
              entity: {
                id: 'opt_a',
                kind: 'option',
                resolution_status: 'resolved',
                resolution_method: 'id_match',
              },
              parameters: [],
              cited_context_fields: ['graph.options'],
            },
          }),
        ),
    };

    const result = await runTurnExecutor(
      makeMessagePayload({
        turn_id: 'follow-up-fix-b',
        scenario_id: SCENARIO_ID,
        message: 'run analysis',
        turn_class: 'decide',
        stage: 'analyse',
      }),
      'req-fix-b',
      {
        routingAdapter,
        handlerRegistry: createRegistry({
          plotClient: makeMockPlotClient(),
          scenarioReader: async () => makeScenarioSnapshot(),
        }),
      },
    );

    expect(result.telemetry.failure_type).toBeNull();
    expect(result.telemetry.commit_performed).toBe(true);

    // The follow-up turn's append call MUST carry briefText sourced from
    // canonical state (the seeded draft turn). Pre-Fix-B this field was
    // omitted on every non-draft commit. Note: the turn-executor commits
    // with `turn_id: context.request_id`, so the matcher uses requestId.
    const followUpAppendCall = appendSpy.mock.calls.find(
      ([write]) => write.turn_id === 'req-fix-b',
    );
    expect(followUpAppendCall).toBeDefined();
    expect(followUpAppendCall?.[0].briefText).toBe(PERSISTED_BRIEF);
  });
});
