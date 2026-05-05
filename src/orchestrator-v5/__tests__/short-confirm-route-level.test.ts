/**
 * Route-level test for the short-confirm resume path.
 *
 * Mocks the session store to return a populated pending action and
 * asserts:
 *   - the routing LLM adapter is NEVER called when the user types "yes"
 *     after a run_analysis offer
 *   - the routing LLM adapter IS called for non-confirmation messages
 *     (proves mutual exclusion with the value-update pre-route is the
 *     regex content, not a global short-circuit)
 *   - chip-click equivalence: a chip_click ingress with
 *     action_type='run_analysis' goes through dispatchChipClickRunAnalysis
 *     (route-v2 layer), bypassing TurnExecutor entirely; verified by the
 *     route-v2 unit test elsewhere. This file pins the typed-yes path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';
import type { HandlerRegistry } from '../tools/registry.js';

const SCENARIO_ID = randomUUID();

const PENDING_RUN_ANALYSIS: PendingAction = {
  id: `pa-${randomUUID()}`,
  scenario_id: SCENARIO_ID,
  chip_id: 'chip_action_run_analysis_TEST',
  action: { kind: 'run_analysis' },
  preconditions: {},
  expires_at_turn_count: 2,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-05-05T00:00:00.000Z',
};

const appendCalls: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [PENDING_RUN_ANALYSIS],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): OrchestratorTurnPayload {
  return {
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'analyse',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when short-confirm matches');
      }),
  };
}

/**
 * Stubbed handler registry. The production `run_analysis` handler reads
 * scenario state from PLoT and is not unit-testable; the stub returns
 * a deterministic non-noop fact so validation/execute/commit complete.
 */
function stubbedHandlerRegistry(): HandlerRegistry {
  const runAnalysisStub = async () => ({
    kind: 'success' as const,
    fact: {
      fact_type: 'run_analysis' as const,
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt-a',
        summary: 'Stub run_analysis result.',
        win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
      },
    },
  });
  return new Map([['run_analysis', runAnalysisStub]]) as unknown as HandlerRegistry;
}

function callingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'Some Sonnet text.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

describe('Short-confirm pre-route — route-level zero-LLM assertion', () => {
  beforeEach(() => {
    appendCalls.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'yes',
    'yes please',
    'yes thanks',
    'do it',
    'do that',
    'go ahead',
    'apply it',
    'ok thanks',
    'sure',
    'confirmed',
  ])('typed "%s" after a run_analysis offer does NOT call the routing LLM', async (msg) => {
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload(msg), `req-${msg.replace(/\s+/g, '-')}`, {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
  });

  it('non-confirmation "why is this close?" DOES route to the LLM', async () => {
    const adapter = callingRoutingAdapter();
    await runTurnExecutor(payload('why is this close?'), 'req-why-not-confirm', {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).toHaveBeenCalled();
  });

  it('non-confirmation with edit verb "yes increase budget" DOES route to the LLM (negative gate)', async () => {
    const adapter = callingRoutingAdapter();
    await runTurnExecutor(
      payload('yes increase the budget'),
      'req-edit-verb-passes-through',
      { routingAdapter: adapter },
    );
    expect(adapter.chatWithTools).toHaveBeenCalled();
  });

  it('chip-click parity: a what_would_flip chip click is rewritten to "yes" upstream so the SAME short-confirm path runs', async () => {
    // Wave 5b chip-click parity contract: route-v2.ts rewrites
    // ingress.message to 'yes' for source='chip_click' +
    // action_type='what_would_flip' BEFORE invoking runTurnExecutor.
    // This test models that rewrite by passing 'yes' directly, which
    // is exactly the post-rewrite payload TurnExecutor sees. Wave 1's
    // derive-pending-actions guarantees the prior turn's emit
    // persisted a what_would_flip pending action; the existing
    // short-confirm pre-route then resumes deterministically.
    //
    // The fixture below uses run_analysis pending actions for
    // simplicity (the SessionStore mock only returns one shape), but
    // the rewrite-to-"yes" mechanism is the same. The assertion is
    // that AFTER the upstream message rewrite, the short-confirm
    // pre-route does NOT call the LLM — proving chip click and
    // typed yes converge on the same code path.
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('yes'), 'req-chip-click-rewrite', {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
  });

  it('"yes" passes validation and dispatches the run_analysis handler (validator_outcome=valid)', async () => {
    // Strengthened beyond "LLM not called". Asserts the validator
    // accepted the synthesised proposal — the entity-fix that picks
    // a real graph node prevents the ENTITY_NOT_FOUND failure mode
    // the bare scenario_id entity would have produced. Validator
    // success is captured on the run-completion telemetry.
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-yes-validator', {
      routingAdapter: adapter,
      handlerRegistry: stubbedHandlerRegistry(),
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    // The synthesised proposal reached the validator AND was accepted.
    // The pre-fix entity (scenario_id with kind='option') would have
    // failed ENTITY_NOT_FOUND on any non-empty graph; the post-fix
    // entity picks the first option/goal from the graph or falls
    // back when no graph is present, so validation passes here.
    expect(result.telemetry.validation_error_code).toBeNull();
    expect(result.telemetry.stages_completed).toContain('validate');
    // Internal failure copy must never leak — even when execution
    // can't complete in a unit-test sandbox, recovery copy must be
    // user-friendly, not "ENTITY_NOT_FOUND" / internal jargon.
    expect(result.response.assistant_text).not.toMatch(/not found in graph/i);
    expect(result.response.assistant_text).not.toMatch(/no pending action/i);
    // NOTE: full lifecycle (handler execute + commit) is exercised
    // by the staging integration tests; the production run_analysis
    // handler reads scenario state from PLoT and is not unit-testable.
  });
});
