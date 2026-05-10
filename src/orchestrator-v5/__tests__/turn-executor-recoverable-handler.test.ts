/**
 * V5 alpha hardening Phase 2.6 — TurnExecutor recoverable-handler tests.
 *
 * Mirrors `turn-executor-recoverable-validator.test.ts`. Coverage:
 *
 *   1. **Recoverable cause-kind round-trip** — for each locked recoverable
 *      cause (per `RECOVERABLE_HANDLER_CAUSES`), a handler that throws
 *      `HandlerInvocationFailedError` produces a clean direct_answer 200
 *      with no error block, at least one recovery chip, and the
 *      `RecoveryResponse` + `TurnExecutorFailureResponse` telemetry events.
 *
 *   2. **Fatal cause stays fatal** — `plot_error` and `graph_invariant_violated`
 *      do NOT recover; they retain `failure_type === 'INTERNAL_ERROR'` and
 *      surface the error block via `composeHandlerFailure`.
 *
 *   3. **Commit failure on recoverable path** — appendShouldThrow forces
 *      commit failure on a recoverable cause; result is STATE_COMMIT_FAILED
 *      with two distinct log records (`v5.recoverable_outcome_pre_commit_failure`
 *      + `v5.state_commit_failed`). Original recoverable outcome is not
 *      hidden behind the infrastructure failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';

import { log, setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import {
  HandlerInvocationFailedError,
  type HandlerInvocationFailedCause,
} from '../tools/handler-errors.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';

// Shared session-store mock — flip `appendShouldThrow` to simulate
// commit failure on the recoverable path.
let appendShouldThrow: Error | null = null;
const appendCalls: Array<unknown> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      if (appendShouldThrow) throw appendShouldThrow;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

// Graph + proposal that pass validation so the handler is actually invoked
// (and given the chance to throw the cause-kind under test).
const PROPOSAL_RUN_ANALYSIS = {
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
    cited_context_fields: [],
  },
};

const GRAPH_WITH_OPTIONS: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } },
    { id: 'opt_b', status: 'ready', interventions: { f1: { value: 0 } } },
  ],
} as GraphStateIngress;

function mkToolUseResult(input: unknown, textBefore?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (textBefore) content.push({ type: 'text', text: textBefore });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

type ChatWithToolsMock = (
  args: ChatWithToolsArgs,
  opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>;

function mockRoutingAdapter(impl: ChatWithToolsMock) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

/**
 * Build a handler registry with a single `run_analysis` entry that throws
 * a `HandlerInvocationFailedError` with the requested cause-kind.
 */
function makeThrowingRegistry(
  cause_kind: HandlerInvocationFailedCause,
  retryable = false,
): HandlerRegistry {
  const handler: HandlerFn = async () => {
    throw new HandlerInvocationFailedError('test-induced failure', {
      cause_kind,
      retryable,
      details: { handler_id: 'run_analysis', specific_issue: 'simulated' },
    });
  };
  return new Map([['run_analysis', handler]]);
}

const RECOVERABLE_CAUSES: readonly HandlerInvocationFailedCause[] = [
  'args_validation_failed',
  'options_not_configured',
  'analysis_blocked',
  'parameter_invalid_at_execute',
  'entity_not_found_in_graph',
  'entity_kind_mismatch_at_execute',
  'precondition_unmet_at_execute',
];

const FATAL_CAUSES: readonly HandlerInvocationFailedCause[] = [
  'plot_error',
  'graph_invariant_violated',
];

type SinkEvent = { event: string; data: Record<string, unknown> };
let events: SinkEvent[] = [];
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  appendShouldThrow = null;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('TurnExecutor — recoverable handler outcomes (Phase 2.6)', () => {
  it.each(RECOVERABLE_CAUSES)(
    'recoverable cause %s → 200 + clean body + recovery chip + telemetry',
    async (cause) => {
      const routingAdapter = mockRoutingAdapter(async () =>
        mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…'),
      );
      const handlerRegistry = makeThrowingRegistry(cause);

      const result = await runTurnExecutor(BASE_PAYLOAD, `req-rec-${cause}`, {
        routingAdapter,
        handlerRegistry,
        graphState: GRAPH_WITH_OPTIONS,
      });

      // 1. HTTP 200 signal: commit happened, no failure_type.
      expect(result.telemetry.commit_performed, cause).toBe(true);
      expect(result.telemetry.failure_type, cause).toBeNull();
      expect(result.telemetry.turn_class, cause).toBe('direct_answer');

      // 2. Clean body — no error block.
      expect(result.response.blocks, cause).toEqual([]);
      expect(result.response.response_version).toBe(2);

      // 3. Recovery chip present, product-voice text.
      expect(result.response.suggested_actions.length, cause).toBeGreaterThan(0);
      expect(result.response.assistant_text.length, cause).toBeGreaterThan(0);

      // 4. No internal-term leakage in user copy.
      expect(result.response.assistant_text, cause).not.toContain(cause);
      expect(result.response.assistant_text, cause).not.toContain('cause_kind');
      expect(result.response.assistant_text, cause).not.toContain('handler_id');

      // 5. Telemetry — recovery_response event with handler payload.
      const recovery = events.find((e) => e.event === 'v5.recovery_response');
      expect(recovery, `${cause}: v5.recovery_response not emitted`).toBeDefined();
      expect(recovery!.data.failure_origin).toBe('handler');
      expect(recovery!.data.handler_cause_kind).toBe(cause);
      expect(recovery!.data.template_used).toBeTruthy();
      expect(recovery!.data.chip_count).toBeGreaterThan(0);

      // 6. Telemetry — failure_response event marks recoverable=true.
      const failure = events.find(
        (e) => e.event === 'turn_executor.failure_response' && e.data.failure_origin === 'handler',
      );
      expect(failure, `${cause}: turn_executor.failure_response not emitted`).toBeDefined();
      expect(failure!.data.recoverable).toBe(true);
      expect(failure!.data.error_code).toBe(cause);
      expect(failure!.data.template_used).toBeTruthy();

      // 7. handler_invocation event still records the failure for raw debugging.
      const handlerInvocation = events.find(
        (e) => e.event === 'v5.handler_invocation' && e.data.outcome === 'error',
      );
      expect(handlerInvocation, `${cause}: handler_invocation error not emitted`).toBeDefined();
      expect(handlerInvocation!.data.cause_kind).toBe(cause);

      // 8. Commit happened exactly once, as a direct_answer turn.
      expect(appendCalls.length, cause).toBe(1);
    },
  );

  it.each(FATAL_CAUSES)(
    'fatal cause %s → stays fatal (500 / failure_type set / error block present)',
    async (cause) => {
      const routingAdapter = mockRoutingAdapter(async () =>
        mkToolUseResult(PROPOSAL_RUN_ANALYSIS, ''),
      );
      const handlerRegistry = makeThrowingRegistry(cause);

      const result = await runTurnExecutor(BASE_PAYLOAD, `req-fatal-${cause}`, {
        routingAdapter,
        handlerRegistry,
        graphState: GRAPH_WITH_OPTIONS,
      });

      // Failure type set; commit did NOT happen as a recoverable direct_answer.
      expect(result.telemetry.failure_type, cause).toBe('INTERNAL_ERROR');
      expect(result.telemetry.commit_performed, cause).toBe(false);

      // Fatal envelope carries an error block.
      const errorBlock = result.response.blocks.find(
        (b) => (b as { type?: string }).type === 'error',
      );
      expect(errorBlock, `${cause}: fatal response should include error block`).toBeDefined();

      // Recovery telemetry must NOT fire for the fatal path.
      const recovery = events.find(
        (e) => e.event === 'v5.recovery_response' && e.data.failure_origin === 'handler',
      );
      expect(recovery, `${cause}: recovery_response should not fire on fatal path`).toBeUndefined();
    },
  );

  it('handler_not_registered (Sonnet-proposed) stays fatal in this tranche — distinguishability gap', async () => {
    // The runtime cannot distinguish "Sonnet proposed an unavailable
    // action" (recoverable in spirit) from "registry tampered / dispatch
    // invariant broken" (fatal). Per the locked plan, this stays fatal
    // until the cause-kind is split or enriched. Pinned regression so
    // any future change that flips it to recoverable trips this assertion.
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult({
        intent_class: 'execute',
        action: {
          handler_id: 'set_factor_value',
          entity: {
            id: 'fac_unknown',
            kind: 'factor',
            resolution_status: 'resolved',
            resolution_method: 'id_match',
          },
          parameters: [],
          cited_context_fields: [],
        },
      }),
    );
    // Pass an empty handler registry — proposed handler is in V5ActionType
    // but not registered, so dispatch raises UnhandledTurnClassError with
    // reason='handler_not_registered'.
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-hnr', {
      routingAdapter,
      handlerRegistry: new Map(),
      graphState: GRAPH_WITH_OPTIONS,
    });

    expect(result.telemetry.commit_performed).toBe(false);
    expect(result.telemetry.failure_type).toBeTruthy();
    // Runtime maps to FEATURE_NOT_ENABLED via UNSUPPORTED_ACTION; the
    // user-facing block IS present (fatal envelope).
    const errorBlock = result.response.blocks.find(
      (b) => (b as { type?: string }).type === 'error',
    );
    expect(errorBlock).toBeDefined();
  });

  it.each(RECOVERABLE_CAUSES)(
    'commit failure on recoverable %s path → STATE_COMMIT_FAILED + two distinct log records',
    async (cause) => {
      appendShouldThrow = new Error('simulated supabase append failure');

      const routingAdapter = mockRoutingAdapter(async () =>
        mkToolUseResult(PROPOSAL_RUN_ANALYSIS, ''),
      );
      const handlerRegistry = makeThrowingRegistry(cause);

      const result = await runTurnExecutor(BASE_PAYLOAD, `req-cf-${cause}`, {
        routingAdapter,
        handlerRegistry,
        graphState: GRAPH_WITH_OPTIONS,
      });

      // Commit failure maps to STATE_COMMIT_FAILED → HTTP 500 at route-v2.
      expect(result.telemetry.commit_performed, cause).toBe(false);
      expect(result.telemetry.failure_type, cause).toBe('INTERNAL_ERROR');

      // Two distinct log records — original recoverable outcome must
      // not be hidden behind the commit failure.
      const warnCalls = warnSpy!.mock.calls;
      const errorCalls = errorSpy!.mock.calls;

      const preCommitOutcome = warnCalls.find((c) => {
        const payload = c[0] as Record<string, unknown>;
        return payload?.event === 'v5.recoverable_outcome_pre_commit_failure';
      });
      const commitFailed = errorCalls.find((c) => {
        const payload = c[0] as Record<string, unknown>;
        return payload?.event === 'v5.state_commit_failed';
      });

      expect(
        preCommitOutcome,
        `${cause}: v5.recoverable_outcome_pre_commit_failure must be logged separately`,
      ).toBeDefined();
      expect(
        commitFailed,
        `${cause}: v5.state_commit_failed must be logged separately`,
      ).toBeDefined();

      // Both records carry the same handler_cause_kind so a log query
      // can join them by cause + request_id.
      expect((preCommitOutcome![0] as Record<string, unknown>).handler_cause_kind).toBe(cause);
      expect((commitFailed![0] as Record<string, unknown>).handler_cause_kind).toBe(cause);
      expect((preCommitOutcome![0] as Record<string, unknown>).failure_origin).toBe('handler');
      expect((commitFailed![0] as Record<string, unknown>).failure_origin).toBe('handler');
    },
  );
});
